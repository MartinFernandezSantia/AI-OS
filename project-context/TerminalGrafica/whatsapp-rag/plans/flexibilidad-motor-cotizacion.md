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
9. **El repo es la verdad; lo que hay en n8n se pisa.** Verificado el 06/09: el flow
   `cotizador-v1` (chat) en n8n tiene un experimento sin portar — la tool `buscar_catalogo`
   partida en `buscar_productos` + `buscar_materiales`, con su prompt (3 tools en vez de 2).
   Ese cambio **no está en el repo ni en producción**: `cotizador-v1-chatwoot` vivo es idéntico
   byte a byte al JSON commiteado. Decisión de Martin: se descarta. Al subir el primer build,
   el chat vuelve a 2 tools — es esperado, no una regresión.

## Git

Rama nueva desde la actual, **un commit por etapa**, formato convencional
(`feat(tg-cotizador): …`). No mergear a main hasta validar en vivo.

### Estado del árbol antes de empezar — resolver PRIMERO

La rama `feat/dashboard-catalogo-b26` tiene cambios sin commitear que **no son de este plan**.
No arrastrarlos a los commits del trabajo nuevo: van en sus propios commits temáticos, antes de
abrir la rama.

**Bloqueante — `Catalogo-TG-v4.xlsx` está sin trackear.** Es el catálogo vigente, el que todo
este plan lee y modifica, y no está en git. Commitearlo **antes** de la etapa 1: sin ese punto
de partida versionado, ningún cambio al Excel es reversible. Junto con él va
`visor/scripts/lib-xlsx.mjs` (default v3→v4), que es el cambio que lo pone en uso — los dos en
un mismo commit, porque uno sin el otro deja el repo incoherente.

El resto, decidir sin mezclar:
- **Borrados** de `Catalogo-TG-v2.xlsx`, `Catalogo-cliente-PENDIENTES.xlsx` y
  `Catalogo_WhatsApp_Terminal_Grafica (1).xlsx`: son catálogos superados. Confirmar con Martin
  y commitear como limpieza aparte.
- **Sin trackear que probablemente no van al repo**: los `.bak-2026*` (respaldos de una sesión
  de edición), `Catalogo-TG-v3-wip.xlsx`, `modal.png`, `tmp-entries.json`. Candidatos a
  `.gitignore` o a borrar, no a commitear.
- `Catalogo-TG-cliente.xlsx` y los scripts `cargar-offset-pliego.mjs` /
  `datos-offset-pliego.mjs`: preguntar — parecen trabajo real de otra tanda.

Recién con el árbol limpio, abrir la rama.

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
  `Casos de prueba` (**28** filas cargadas sobre 131 de datos) es **otra columna** y se conserva
  — el gate sigue leyéndola de ahí: es el único chequeo de rinde contra el Excel.
  **Cuidado: una de esas 28 celdas vale `0`** (fila 45, `20 stickers 30x45 cm` — rinde 0 = la
  pieza no entra en el pliego, y el caso espera derivación). Un conteo o un filtro con
  truthiness de JS (`if (fila.F)`) la descarta y rompe ese caso. `0` es un valor cargado, no
  ausente.
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
  tramo, ignora `cantidad` para el monto, y redondea como los demás modos. Devolver el mismo
  shape de output (`unidades_cobradas: 1`).

**PREGUNTA ABIERTA A TG — resolver antes de codear el mínimo.** El plan original asumía que
`fijo` pasa por el mínimo por trabajo. La nota del Excel dice textualmente: *"Confirmar con TG
si es un recargo POR TRABAJO (una vez, sin importar las piezas) antes de diseñarlo"*. No está
confirmado. Para los $5.000 del corte a medida da igual (supera el mínimo de $4.000), pero como
regla general un recargo que se agrega a un trabajo ya cotizado aplicaría el mínimo **dos
veces**. Si TG confirma que es un agregado, la fila va marcada `Sin mínimo por trabajo` (columna
que ya existe, `COL_SIN_MINIMO`) y no hace falta lógica nueva. **Preguntar antes de asumir.**
- `visor/lib/chunk.ts` `lineasMotor()` (`:357-400`): línea propia para que el chunk diga que el
  precio no depende de la cantidad.

**Prompt:** si el modo cambia cómo el cliente expresa el pedido, ejemplo nuevo en
`plans/system-prompt-v1.md:57-61`. Ojo al techo de tokens.

---

## Etapa 3 — Tramos con precio total (marca POR TRAMO, no por material)

**Corrección sobre el diseño original.** El plan asumía que troquelado y rifas eran el mismo
caso ("modo tramo total"). El texto literal del Excel dice otra cosa:

- **Troquelado** — `1-10 piezas: $10.000 TOTAL fijo (no por pieza). 11-50: $1.000/pieza.
  51-100: $800/pieza. 101-500: $600/pieza.` Es **MIXTO**: solo el primer tramo es total plano;
  los otros tres son precio por pieza, que el motor **ya cotiza bien hoy sin ningún cambio**.
- **Rifas** — los 6 tramos son total puro (`100-249→$7.200 · 250-499→$9.600 · …`).

Un modo a nivel material no puede expresar el troquelado: cotizaría 30 piezas como $1.000 en vez
de $30.000. Por eso la marca de "este precio es el total del tramo" va **en la fila del tramo**,
no en el material. Los tramos sin marca siguen multiplicando como siempre. Con un solo mecanismo
quedan cubiertos los dos casos: troquelado marca 1 tramo de 4, rifas marcan los 6.

**Excel:** columna nueva en `Materiales` (booleana, junto a `Precio por unidad`), marcada por
fila de tramo. Alta de troquelado y las dos rifas; baja de esas filas en `Pendientes`.

**Motor** (`FUENTE_COTIZAR`, `build-flow.mjs:207-299`): **no es un modo nuevo** y `modoDe()` no
se toca. Es una bifurcación dentro del cálculo del total, después de `tramoDe()`: si el tramo
elegido está marcado, el total es el precio del tramo; si no, se multiplica por unidades como
hoy. Mínimo y redondeo iguales para ambos. Propagar la marca desde `parse.ts` al `meta.escala`
del chunk, porque el auditor lee la escala de ahí.

**Casos (imprescindibles, el troquelado es el que puede salir mal en silencio):**
- Troquelado 3 piezas y 9 piezas → **ambos $10.000** (dentro del tramo total no escala).
- Troquelado 30 piezas → **$30.000** (tramo por pieza: 30 × $1.000). Este es el caso que
  atrapa el error de marcar todo el material como total.
- Troquelado 11 y 50 piezas → bordes del tramo por pieza.
- Rifas: un caso por tramo marcado, en el borde inferior y superior del mismo tramo.

**Las rifas tienen un SEGUNDO problema, independiente de este.** Su escala está indexada en
**números de rifa**, no en talonarios (la unidad que pediría el cliente: "2 talonarios" = 200
números). Es una conversión 1:100 — exactamente lo que hace `paquete` en modo `item`, pero al
revés (el paquete divide piezas→unidades; acá hay que multiplicar talonarios→números). Resolver
esto **antes** de dar de alta las rifas, o cargarlas en la etapa siguiente: si se cargan con la
escala en números y el cliente pide talonarios, cotiza 100 veces menos. Decidir con TG en qué
unidad pide el cliente.

---

## Etapa 4 — Cálculo por superficie (entrada por cantidad directa)

Que el cliente pueda declarar la cantidad **en la unidad de cobro** ("3 m² de vinilo") en vez de
pieza + medida. Ambos caminos convergen al mismo cálculo de mínimo, tramo y total.

**Alcance real: solo `m2`.** `metro lineal` ya resuelve el camino directo hoy — cae en modo
`item`, y `item` está explícitamente exento del guard de medida (`build-flow.mjs:242`), así que
acepta la cantidad sin ancho/alto y admite decimales. Ya hay 4 casos verdes que lo prueban
(escaneo de planos: 1 m, 3 m, 2,45 m con decimales, y 0,5 m activando el mínimo), y el chunk ya
le explica al modelo cómo declararlo (`esMedidaContinua()`, `parse.ts:151`, usado en
`chunk.ts:389-397`). **En metro lineal no se toca el motor**: si acaso, sumar un caso más.

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

**Casos:** en m², un caso por cada camino de entrada que dé el mismo total, y uno donde el
mínimo se dispare por el camino directo. En metro lineal alcanza con un caso de confirmación
(el camino ya está cubierto por los 4 existentes).

**Presupuesto de tokens — tarea real de esta etapa, no advertencia.** Enseñarle al modelo el
camino directo suma texto al prompt, que hoy está en 3.024/3.050. **Hay que recortar sí o sí**
antes de agregar. Buscar el recorte en las secciones más redundantes de
`plans/system-prompt-v1.md` (los 4 ejemplos de cantidad sin convertir, `:57-61`, admiten
compresión), medir con `node n8n/armar-prompt.mjs`, y recién después sumar lo nuevo. Si no
entra, el ejemplo del camino directo va al **chunk** del material (como ya hace
`esMedidaContinua()`), no al prompt: el chunk no paga el techo.

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

La coda del chunk de familia (`chunk.ts:569-575`, hoy *"confirmala por mail"*) **no se toca en
esta etapa**: recién deja de ser cierta cuando el bot sabe presentar alternativas, en la 6. Si
se cambia acá, el modelo lee "ofrecé opciones" sin tener precio que mostrar y el Responder lo
manda igual a `CONSULTA`. Se cambia en la etapa 6.

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

### Los guards del Responder tirarían las alternativas — cómo se resuelve

El Responder tiene dos guards duros que un texto con precios redactado por un LLM **no
sobrevive**:

1. `if (cots.some((c) => c.precio == null)) derivar = true;` (`:1007-1009`) — basta una
   cotización sin precio en el turno para derivar el mensaje entero.
2. `RE_PRECIO` (`:1011-1026`) — extrae todo monto con `$` del texto **ya sustituido** y lo
   busca en la lista de precios inyectados, **consumiendo de a uno** (`splice`). Lo que no
   matchea → `derivar = true`. El match es por string exacto, así que también cae un precio
   correcto **formateado distinto** (`$6600` vs `$6.600`) o **repetido** dos veces cuando hay
   una sola cotización.

**Solución: no se toca ningún guard.** Cada alternativa entra al turno como una **cotización
más** en `cots`, con su `precio` ya calculado por el auditor, y el segundo LLM la referencia con
su marcador (`{P1}`, `{P2}`, …) igual que hace hoy con el precio principal. Así los montos que
llegan al texto son *inyectados*, no tipeados, y ambos guards siguen intactos sin excepciones.

Consecuencias a implementar:
- El auditor emite las alternativas como entradas de `cots` con precio, no solo dentro de
  `detalle[]`. Ojo con el guard 1: la cotización original sigue teniendo `precio: null`
  (es la que no se pudo cotizar) — hay que distinguir "sin precio porque falló" de "sin precio
  porque fue reemplazada por alternativas", o el turno deriva igual. Es el punto exacto donde
  esta etapa toca el Responder, y el único.
- El prompt del segundo LLM recibe las alternativas **con su número de marcador**, y tiene
  prohibido escribir cifras: solo marcadores.
- Un caso de prueba que verifique que un mensaje con dos alternativas sale con ambos precios
  inyectados y `via != 'consulta'`.

**Regla que queda para siempre:** cualquier monto visible en un mensaje tiene que pasar por su
propio `{Pn}`. Un desglose explicativo con cifras escritas a mano (ej. "son $10.000 fijos hasta
10 piezas") es incompatible con el guard — si en algún momento hace falta mostrar una escala,
va sin el signo `$` o con marcador por cifra.

**La coda del chunk de familia** (`chunk.ts:569-575`) se actualiza **acá**, no en la etapa 5:
recién ahora el bot puede realmente ofrecer las opciones que el texto promete.

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
