# Plan — Flexibilidad de carga y cotización del bot TG

## Contexto

El bot de cotización de Terminal Gráfica atiende WhatsApp de forma autónoma desde el 31/08. El
Excel es la fuente única: el LLM declara qué pidió el cliente y un auditor determinista en n8n
recalcula el precio contra el catálogo. Funciona, pero el motor solo sabe hacer
`unidades_de_cobro × precio_del_tramo` (con mínimo y redondeo al final), y eso deja afuera
casos reales de imprenta:

- **Cobros no proporcionales.** Un recargo fijo por diseño ($5.000 de "corte a medida") y una
  escala cuyo precio es el TOTAL del tramo (troquelado: 1-10 piezas = $10.000 total, no por
  pieza) no tienen representación. Hoy están apartados en la hoja `Pendientes` y el bot deriva
  a mail. El troquelado además es una **regresión**: antes existía como `$50/unidad` y con el
  catálogo v4 se perdió.
- **Paquetes que no cierran exactos.** Si el cliente pide 150 tarjetas de un paquete de 100, el
  motor devuelve `ok:false` y el Responder reemplaza el mensaje entero por "escribinos a
  terminalgrafica@gmail.com". El caso frecuente (que la cantidad no coincida) corta la
  conversación en vez de ofrecer lo que sí se puede vender.
- **Cantidad declarada en la unidad de cobro.** El cliente que dice "quiero 3 m² de vinilo" no
  entra: el auditor exige `ancho_cm`/`alto_cm`/`cantidad` de una pieza, siempre.
- **Ruido en el Excel.** La columna `Piezas por unidad de cobro` (hoja Productos, col. G) está
  vacía en las tres versiones del catálogo desde que el rinde se calcula por geometría.
- **El modo de cálculo está escondido en el texto de la unidad.** `modoDe()` lo infiere por
  prefijo, así que cambiar cómo se cobra un material exige conocer una convención interna — y
  en la práctica obliga a Martin a mediar cada cambio.

**Resultado buscado:** que TG pueda cargar y cambiar productos sin intermediario, y que el bot
cotice autónomamente los casos que hoy derivan a mail.

**Raíz de ejecución:** `/home/martin/AI-OS/project-context/TerminalGrafica/whatsapp-rag/`
(el Excel, `visor/`, `n8n/` y `plans/` cuelgan de ahí; el repo git es `/home/martin/AI-OS`).

---

## Advertencias para quien implemente

1. **`HANDOFF.md` está desactualizado en números.** Dice "132 casos", "`CATALOGO=…v3.xlsx`",
   "13/16/18 nodos". El estado real: catálogo **v4**, **131 casos**, **18 nodos** (chat) /
   **54** (chatwoot). El código es la fuente, no el HANDOFF. Igual leerlo: el contexto
   arquitectónico sigue vigente.
2. **`CATALOGO=Catalogo-TG-v4.xlsx` en todo comando.** `build-flow.mjs:57` aborta sin la
   variable (su mensaje de error menciona el v2/v3: está desactualizado, ignorarlo).
3. **El prompt está a 3.024 de un techo de 3.050 tokens.** Regla ya declarada en
   `armar-prompt.mjs:14-16`: si choca, **recortar, no subir el techo**.
4. **`rinde()` está triplicado** (`visor/lib/geometria.ts:28`, `visor/scripts/lib-xlsx.mjs:233`,
   `n8n/build-flow.mjs:191` en el string `FUENTE_RINDE`). Ojo: las dos primeras usan
   `utilAncho/utilAlto`, la tercera `util_ancho/util_alto`. `cotizar()` en cambio tiene **una
   sola copia** (`build-flow.mjs:207-299`, `FUENTE_COTIZAR`) que se evalúa para testear y se
   emite literal en el nodo.
5. **`modoDe()` tiene 4 copias**: `visor/lib/parse.ts:112`, `n8n/build-flow.mjs:347`,
   `visor/scripts/validar-catalogo.mjs:99`, y el texto de la hoja `Instrucciones`.
6. **Nunca escribir el `.xlsx` con LibreOffice abierto** (`chequearLock()`). Los scripts son
   dry-run por defecto; `--apply` escribe.
7. **Tocar el Excel o el builder obliga a re-subir el flow a n8n.** El flow vivo es
   `cotizador-v1-chatwoot` (`3vNAAe0sr7sMgPUa`). Nunca re-tipear el JSON: sacarlo del emitido.
8. **REGLA DURA — chat primero, chatwoot después.** Todo cambio se prueba **completo y
   aprobado** en `cotizador-v1.json` (chat, 18 nodos) antes de tocar
   `cotizador-v1-chatwoot.json` (54 nodos, EN PRODUCCIÓN). Vale para las 7 etapas, no solo para
   las que agregan nodos: cualquier cambio de motor, de contrato del LLM o de texto se valida en
   chat primero. El port a chatwoot es siempre el último paso de la etapa, nunca simultáneo.

## Git

Rama nueva desde la actual, **un commit por etapa**, formato convencional
(`feat(tg-cotizador): …`). No mergear a main hasta validar en vivo.

## Verificación de cada etapa

Ninguna etapa cierra sin que estos cuatro comandos pasen:

```bash
cd /home/martin/AI-OS/project-context/TerminalGrafica/whatsapp-rag
CATALOGO=Catalogo-TG-v4.xlsx node n8n/build-flow.mjs --test   # 131 casos + 11 rindes
CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/validar-catalogo.mjs
pnpm --dir visor test
CATALOGO=Catalogo-TG-v4.xlsx node n8n/build-flow.mjs          # emite los 2 flows
```

Regla dura: **cada etapa que toque cálculo suma casos a la hoja `Casos de prueba` ANTES de
tocar el motor**, y el gate de `build-flow.mjs:2422` los tiene que hacer fallar primero (rojo)
y pasar después (verde). Los fixtures mienten si el caso no existe.

Y el cierre de cada etapa es siempre en dos tiempos:

1. **Chat.** Subir `cotizador-v1.json` a n8n, smoke manual de los casos que la etapa habilita,
   revisar `bot.log`. La etapa no avanza hasta que esto esté aprobado por Martin.
2. **Chatwoot.** Recién ahí portar a `cotizador-v1-chatwoot.json` (producción), con diff
   programático vivo-vs-emitido y `activeVersionId == draft`.

---

## Etapa 1 — Quitar `Piezas por unidad de cobro`

La más chica y sin riesgo: la columna está vacía en v3, v4 y v4-wip. Sirve de calentamiento
para verificar que el toolchain de escritura del `.xlsx` funciona en manos de quien implemente.

**Excel:** eliminar la columna G de la hoja `Productos`. Script quirúrgico nuevo en
`visor/scripts/`, molde: cualquiera de los existentes que reescriben una hoja (dry-run +
`--apply` + `chequearLock()`). Verificar el índice real del sheet XML, no asumirlo.

**Código a tocar** (todos los sitios ya relevados):
- `visor/lib/chunk.ts`: borrar `COL_RINDE` (`:41`), sacarlo de `CONOCIDAS` (`:115`), simplificar
  `rindeEfectivo()` (`:125-132`) para que calcule solo por geometría, y ajustar los call sites
  (`:317`, `:700`, `:812`).
- **Avisos** (`chunk.ts:805-835`): el aviso #1 (`:817-822`) pierde la mitad que habla de la
  columna — reescribirlo para que solo señale la geometría faltante. El aviso #2 (drift
  columna-vs-cálculo, `:823-828`) **desaparece entero**: sin columna no hay drift.
- `n8n/build-flow.mjs:435-439`: el gate que verifica el rinde esperado del caso. La columna F de
  `Casos de prueba` (29 filas cargadas) es **otra columna** y se conserva — decidir si el gate
  sigue leyéndola desde ahí (recomendado: sí, es el único chequeo de rinde contra el Excel).
- `n8n/listar-casos.mjs:8`, `visor/scripts/cargar-casos-cobertura.mjs:134` (array `COLS`).
- `cotizar()`: el parámetro `rinde_cargado` y su rama (`build-flow.mjs:267`) quedan muertos —
  borrarlos. No está en `CABLEADOS` (`:2439`), así que no rompe gates.
- Tests de `visor/lib/__tests__/chunk.test.ts`: `:707-712`, `:724-725`, `:737`, `:749`, `:869`.
- Hoja `Instrucciones` (filas 93, 103-113) y `visor/scripts/instrucciones-cliente.md:48,67,75`.

**Verificación extra:** volcar la hoja `Productos` y confirmar 8 columnas; re-ingestar desde el
visor y revisar que ningún chunk cambió de texto (la columna vacía no aportaba nada).

---

## Etapa 2 — Modo de cobro `fijo`

Un monto único que **no depende de la cantidad**. Cubre el recargo por diseño.

**Antes que nada, casos de prueba.** Agregar a la hoja `Casos de prueba` al menos 3 filas del
mismo material fijo con cantidades distintas (1, 8, 50) y el **mismo** `Precio correcto`. Sin el
material cargado esos casos fallan — cargarlo en la misma etapa.

**Excel:** dar de alta en `Materiales` el material de corte a medida con una unidad que dispare
el modo nuevo, con su fila única de escala. Retirar de `Pendientes` la fila correspondiente.

**Motor** (`n8n/build-flow.mjs`):
- `modoDe()` en sus 3 copias de código (`parse.ts:112`, `build-flow.mjs:347`,
  `validar-catalogo.mjs:99`): sumar el prefijo nuevo a la lista blanca. Mantener el criterio de
  que un typo caiga en `otro` y rompa visible.
- `CASOS_MODO` (`build-flow.mjs:550-563`): sumar el par `["<unidad>", "fijo"]` y un par
  defensivo de typo → `"otro"`.
- `FUENTE_COTIZAR` (`:207-299`): rama nueva antes del `else` de `:276`. Toma el precio del único
  tramo, ignora `cantidad` para el monto, y **sigue pasando por mínimo por trabajo y redondeo**
  como los demás modos. Devolver el mismo shape de output (`unidades_cobradas: 1`).
- `visor/lib/chunk.ts` `lineasMotor()` (`:357-400`): línea propia para que el chunk diga que el
  precio no depende de la cantidad.

**Prompt:** si el modo cambia cómo el cliente expresa el pedido, ejemplo nuevo en
`plans/system-prompt-v1.md:57-61`. Ojo al techo de tokens.

---

## Etapa 3 — Modo de cobro `tramo total`

La escala tiene rangos por cantidad, pero el precio del rango es el TOTAL, no el unitario.
Cubre troquelado y talonarios de rifas.

**Casos primero:** por cada material, un caso en el borde inferior y otro en el superior del
mismo tramo con **idéntico** `Precio correcto` (ej. 3 piezas y 9 piezas → $10.000), más uno del
tramo siguiente. Eso fija que dentro del tramo no escala.

**Excel:** alta de troquelado y las dos rifas en `Materiales` con sus escalas; baja de las tres
filas en `Pendientes`.

**Motor:** misma mecánica que la etapa 2 — prefijo en las 3 copias de `modoDe()`, par en
`CASOS_MODO`, rama en `FUENTE_COTIZAR`. La rama es casi el modo `item`: busca el tramo por
cantidad con `tramoDe()` (que ya existe) y **saltea la multiplicación** — el precio del tramo es
el total. Después, mínimo y redondeo normales.

**Riesgo a cubrir con un caso explícito:** que un material `tramo total` mal cargado como `item`
multiplique (5 × $10.000 = $50.000). Un caso de `CASOS_MODO` que fije la unidad → modo evita
que se cuele.

---

## Etapa 4 — Cálculo por superficie (entrada por cantidad directa)

Que el cliente pueda declarar la cantidad **en la unidad de cobro** ("3 m² de vinilo") en vez de
pieza + medida. Ambos caminos convergen al mismo cálculo de mínimo, tramo y total.

Generalizar a **cualquier material en modo `m2` o `metro lineal`**, no solo vinilo.

**Contrato del LLM** (`ESQUEMA_SALIDA`, `build-flow.mjs:671-726`): hoy `ancho_cm`/`alto_cm` son
obligatorios. Sumar un camino alternativo donde el modelo declare la cantidad en la unidad de
cobro. Mantener la regla vigente (*la cantidad va como la dijo el cliente, sin convertir*): si
el cliente habla de m², el modelo declara m²; si habla de piezas, declara piezas y medida. **El
modelo nunca convierte** — esa sigue siendo tarea del auditor.

**Motor:** en `FUENTE_COTIZAR`, la rama `m2` acepta las dos formas de entrada y bifurca una sola
vez al principio (`¿tengo pieza+cantidad, o cantidad directa?`); de ahí en adelante el camino es
idéntico. **No** agregar reglas por material.

**Mínimo facturable:** aplica igual en el camino directo. Cuando se dispara, el cliente tiene
que enterarse ("el mínimo que trabajamos es 0,5 m²"). Eso vive en la presentación, no en el
cálculo: revisar `plans/system-prompt-v1.md:85-91` (`## Presentar el precio`), que ya tiene la
regla de presentar el mínimo como cantidad.

**Casos:** por cada modo (m² y metro lineal), un caso por cada camino de entrada que dé el mismo
total, y uno donde el mínimo se dispare por el camino directo.

---

## Etapa 5 — Alternativas cuando el paquete no da exacto

Hoy `cotizar()` devuelve `ok:false` con motivo
`'se vende en paquetes de N y Q no es múltiplo — derivar a consulta'`
(`FUENTE_COTIZAR:256-258`) y el Responder reemplaza todo el mensaje por la constante `CONSULTA`
(`build-flow.mjs:934`, aplicada en `:1028`).

**Decisión tomada:** el bot **ofrece las opciones válidas con su cantidad y precio reales, y el
cliente elige**. No optimiza por él ni esconde el excedente.

**Alcance de la comparación:** además del paquete inferior y superior de la misma presentación,
comparar contra **las otras presentaciones de la misma familia**. `meta.variantes[]`
(`chunk.ts:601-613`) ya lleva `escala`, `paquete` y `sin_minimo` de cada presentación, y el
auditor ya lo desarma (`build-flow.mjs:809-812`) — **no hace falta ir a la base de nuevo**.

**Implementación:**
- Enriquecer el retorno de `cotizar()`: `{ok:false, motivo, alternativas:[{cantidad, total, material}]}`.
  Cada alternativa es una cotización real ya calculada por el mismo motor, no una estimación.
- Propagarlo en el `detalle[]` del auditor (`build-flow.mjs:851`), junto al `estado:'no_cotizable'`.
- Sumar el campo a `CABLEADOS` (`:2439-2445`) para que no se pueda borrar en silencio.
- La coda del chunk de familia (`chunk.ts:569-575`) hoy dice *"confirmala por mail"* — actualizar
  ese texto, porque deja de ser cierto.

**Casos:** pedido no múltiplo con familia de una sola presentación (solo inferior/superior);
pedido no múltiplo con familia de varias presentaciones (que aparezcan las de otras
presentaciones); y un caso donde la alternativa más barata tiene más unidades que las pedidas.

---

## Etapa 6 — Segundo LLM que redacta las alternativas

El auditor calcula, un LLM redacta. El auditor **nunca** compone texto para el cliente: eso
preserva la garantía de que ningún número que llega al cliente salió de la imaginación del
modelo.

**Ubicación:** entre `Auditar Cotización` y `Responder` — el único tramo donde ya existe el
`detalle[]` con las alternativas y todavía no se decidió el texto. Un `IF` sobre
`auditoria.cotizaciones.some(c => c.estado==='no_cotizable' && c.alternativas)` rutea al nodo
LLM y **vuelve a converger en `Responder`**, que sigue siendo el único emisor de texto (ahí
viven `{Pn}`, el regex de teléfono `RE_TEL:1042` y el aviso de precio provisorio).

**Prompt del nodo:** recibe solo las alternativas ya calculadas y redacta. Prohibido inventar
números o cantidades que no estén en la entrada.

**Los dos flows.** Aplica la regla general (chat primero, chatwoot después), acá con más peso
porque se agregan nodos: `cotizador-v1-chatwoot.json` es copia profunda del medio, así que el
nodo nuevo y su `IF` se replican al portar. Sumar los asserts correspondientes a `CW_CABLEADO`
(`:2520-2569`).

**Verificación:** `node n8n/test-auditor.mjs` contra el JSON emitido, después smoke manual en el
flow de chat con un pedido no múltiplo (verificando que el texto redactado no invente números ni
cantidades fuera de las alternativas calculadas), y recién con eso aprobado, el port.

---

## Etapa 7 — Columna explícita de modo de cálculo

Último, a propósito: los modos nuevos ya nacieron y se probaron con el mecanismo conocido; acá
se cambia el mecanismo, no el comportamiento. **Ningún precio debe moverse en esta etapa** — los
131+ casos son la red.

**Excel:** columna nueva en `Materiales` con valores acotados (`proporcional` / `fijo` /
`tramo total` / `superficie`), con desplegable alimentado desde `_listas` (ya existe ese
mecanismo). `Unidad` queda para lo que TG entiende (paquete de 100, m², hoja) y deja de cargar
la doble función.

**Código:** `modoDe()` pasa a leer la columna. En las 3 copias, mantener el fallback al prefijo
de `Unidad` para materiales sin la columna cargada, y **conservar el bucket `otro` con su gate**
(`build-flow.mjs:564-570`): un valor inválido debe abortar el build, no cotizar en silencio.

**Validación cruzada nueva** (`validar-catalogo.mjs`): avisar cuando unidad y modo son
incoherentes (unidad `m2` con modo `fijo`, por ejemplo). Es aviso, no error — la carga la valida
TG y la puede corregir; el objetivo es que el error sea visible, no bloquear.

**Instrucciones:** la sección `UNA UNIDAD DE COBRO NUEVA` (filas 120-141) hoy **miente** — dice
"Hoy existen dos: 'pliego A3' y 'm2'", falso desde que existe `item`. Regenerarla desde la
fuente real (propuesta ya anotada en `plans/limpieza-catalogo-v4.md:271-276`:
`visor/scripts/instrucciones-unidades.mjs`). Cuidado: `armar-prompt.mjs:62-75` valida 4 regex de
la PARTE 1 y tira si desaparecen.

---

## Cierre

Con las 7 etapas: TG carga y cambia productos sin intermediario, el bot cotiza los casos que hoy
derivan a mail (recargos fijos, troquelado, rifas, paquetes no exactos), acepta que el cliente
pida en la unidad de cobro, y el Excel deja de tener una columna muerta y un modo escondido en
el texto de otra columna.

Actualizar `HANDOFF.md` al cerrar (hoy miente en números) y registrar las decisiones de diseño
en `decisions/log.md` del AIOS.
