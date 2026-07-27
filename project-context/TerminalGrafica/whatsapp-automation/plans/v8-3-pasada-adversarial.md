# v8.3 — Pasada adversarial (2 lentes) + el diagnóstico del log

> Corrida el 2026-07-27 sobre el diseño de [`v8-3-busqueda-por-palabra.md`](./v8-3-busqueda-por-palabra.md),
> antes de escribir código, como manda §6 del handoff. Dos agentes Opus en paralelo,
> una lente cada uno (plata y costo por mensaje), los dos con la consigna de refutar.
> **Nada construido todavía.** Este archivo dice qué sobrevivió y en qué orden se construye.

---

## 0. El paso 1 quedó resuelto sin la consulta: el log está roto, y se sabe por qué

La consulta de §5 quater ya no hace falta para decidir. El mapeo es demostrablemente
incorrecto, leyendo el workflow:

```
Aplicar Compositor  →  Enviar Mensaje (HTTP POST a Chatwoot)  →  Log Turno
```

`Log Turno` mapea `borrador`, `final`, `senales` y `notas` desde **`$json`**. Pero su nodo
anterior es `Enviar Mensaje`, un HTTP Request: en n8n el ítem de salida de un HTTP node
**es la respuesta del API**, no el ítem que entró. Chatwoot devuelve
`{id, content, message_type, conversation_id, ...}` — ninguno de los cuatro campos existe
ahí. **Las cuatro columnas se escriben null en todos los turnos, siempre**, y no por falta
de datos: los datos están completos en `Aplicar Compositor`, que retorna
`Object.assign({}, j, {final, notas, ...})` con todo el sobre intacto.

**Alcance del daño.** Es peor que perder telemetría de depuración:
`Get Ruta Cotizador` lee `borrador` de `bot.decisiones` para alimentar `borradoresPrevios`,
y de ahí comen **los dos anti-loops** (el de respuesta repetida en `Parsear Respuesta` y el
de repregunta en `Armar Respuesta Precio`). Con la columna en null, `borradoresPrevios`
llega vacío y **los dos anti-loops nunca cuentan**. El consejo del 07-26 encontró que v8
había matado cuatro anti-loops; dos de ellos se arreglaron en el código y quedaron
desarmados por el log.

**El arreglo (código, 4 expresiones):** en `Log Turno`, cambiar la fuente de los cuatro
campos de `$json` a `$('Aplicar Compositor').first().json`. `conversation_id`,
`mensaje_cliente`, `producto_resuelto`, `accion` y `filas_sql` tienen el mismo problema y
van igual. Es prerrequisito duro de v8.3: sin esto el pipeline nuevo se depura a ciegas
**y arranca con los anti-loops muertos**.

La consulta de §5 quater sigue valiendo la pena correrla **después** del fix, como
verificación de que quedó bien.

---

## 1. Lo que las dos lentes tumbaron (convergencia)

Las dos llegaron por caminos distintos al mismo lugar: **el diseño está presupuestado como
si fuera gratis, y no lo es.**

### 1.1. La premisa de costo del plan es falsa — y con ella cae la política 1

El plan §1 dice "sin agregar una llamada (el LLM 1 ya existe)". Verificado contra el
workflow: hoy hay **3 nodos HTTP a OpenRouter** (`Llamar LLM Respuesta`, `Llamar LLM
Aclarador`, `Llamar LLM Compositor`) **más** `Guardrails Tier-2`, que también es una llamada
de modelo. El LLM 2 es **nueva y adicional**, y el Aclarador **no muere** con el diseño tal
como está escrito. Peor caso: **5 llamadas secuenciales** en un turno.

Y la corrección que cambia una decisión, no sólo un número:

> **La puerta abierta y la repregunta cuestan EXACTAMENTE lo mismo en dinero.** Las dos son
> un mensaje saliente (~USD 0,026 desde el 1-oct). El plan justifica la política 2 con "la
> repregunta cuesta un mensaje pago y la puerta informa lo mismo gratis": eso es falso. El
> ahorro de la puerta es **un turno de latencia**, no plata.

Con esa corrección, **las políticas 1 y 2 del plan se contradicen**: la 2 dice "no
repreguntes, informá con la puerta abierta"; la 1 dice "con >4 candidatos, repreguntá". Y la
1 es cara: los tokens frecuentes son justo los que la gente usa (`papel` 30 productos ·
`impresion` 10 · `color` 10 · `a4` 15), así que dispararía seguido. Estimado sobre 540
consultas de precio/mes: entre 162 y 324 repreguntas extra = **USD 4 a 8/mes**, o sea tanto
como el gasto de LLM del bot entero (~USD 12/mes), **más un turno de abandono cada vez**.

**Sobrevive:** invertir la política 1. Con muchos candidatos, **listar el corte con el piso
incluido + una puerta abierta** ("hay más opciones de papel, decime cuál te interesa") en un
solo mensaje. Es la política 2 aplicada al caso >1, que es lo que el plan ya justificó.

### 1.2. `hayCompetencia` no sobrevive al cambio, y es el guard que detecta el confident-wrong

**El hallazgo más caro de la pasada.** El GUARD DE ANCLA condiciona la puerta a
`hayCompetencia = descartados.length > 0 || main.filas > 1`, calculado sobre las filas que
devuelve `Get Precio` **con el nombre ya elegido**. En v8.3 el LLM 2 entrega un producto
**copiado de una lista que le pusieron delante**, así que `Get Precio` lo resuelve exacto,
fila única, `descartados = []` → **`hayCompetencia = false` → puerta apagada**.

O sea: el diseño elimina el ruido de resolución y **con él elimina la señal**. Es la misma
causa raíz del 27 (la compuerta se deriva de un dato posterior a la elección del LLM), sólo
que movida un nodo más adelante.

**Sobrevive, y es una línea:** `hayCompetencia` deja de leerse de `Get Precio` y pasa a
leerse del **candidato-set del SQL de tokens, antes del filtro del LLM 2**. Es el mismo dato
medido *antes* de la elección en vez de después — que es literalmente el diagnóstico del 27
aplicado en el lugar correcto.

---

## 2. Los guards de negocio que el diseño elude

Patrón común: hoy los guards de nicho, `solo_descuentos` y `oculto` viven **aguas abajo** de
la elección, en `Armar Respuesta Precio`. El diseño pone la lista **delante del LLM 2**, y
el menú y la repregunta-de-eje **no pasan por `nichoDe`**.

- **Nicho (medicina / promo inmobiliarias).** Medido sobre el catálogo real: *"imprimir un
  apunte de 200 páginas"* trae `Impresión de módulos/apuntes de medicina` primero, porque
  `apuntes` es sinónimo literal de ese producto. Si entra al menú y el cliente elige, el
  turno siguiente ya tiene "medicina" en la ventana → el guard **pasa** → $45/página a un
  cliente que no califica. Ídem *"un cartel de 1x0.65"*, que trae la promo de inmobiliarias
  ($15.000) por encima del corrugado real ($19.500).
- **`solo_descuentos`** (54 de 185 variantes) es una **regla comercial de TG**, no un flag de
  UX. Delegarle a un LLM la decisión de ofrecerla o no es de la misma clase que dejarlo
  tipear un monto.

**Sobrevive:** los tres son **filtro SQL en la búsqueda por token, no instrucción de
prompt**. `where not oculto and (nicho is null or <ventana> ~* nicho) and (not
solo_descuentos or <el cliente lo nombró>)`. El LLM 2 nunca ve lo que no debe ofrecer.
Beneficio lateral: elimina 2 de las 5 frases de la leyenda de §4 y baja el payload.

---

## 3. El hallazgo que ninguna de las dos lentes tenía en el brief: el `LIMIT` determinístico

La lente de costo lo puso mejor: **el paso de 46 candidatos a ~8 es aritmética, no
criterio.** Con IDF sobre las frecuencias ya medidas — `papel` en 30/88 → idf 1,08;
`ilustracion` en ~3/88 → 3,38; `kraft` en 2/88 → 3,78 — en *"papel ilustración para 500
folletos"* la palabra `ilustración` pesa **3× más** que `papel`: las 2 ilustraciones suben
al tope y los 44 que sólo matchean por `papel` caen solos. **El LLM 2 no hace falta para
eso.**

Donde el LLM 2 sí aporta es en el eje que el ranking no ve: elegir entre `Ilustración Mate
250` y `Ilustración Brillo 250` sabiendo que el cliente dijo "para folletos" y que tres
mensajes atrás dijo "algo económico". Eso son 6 candidatos, no 46.

**Sobrevive:** `where score >= 0.4 * max(score) limit 8` **en el SQL, antes del LLM 2**. El
fail-safe del plan se conserva íntegro (sigue degradando "hacia de más", sólo que de más = 8
en vez de 46), el payload del LLM 2 baja de ~25k tokens a ~700, y **la política 1 casi nunca
dispara** porque el corte ya redujo. Este solo arreglo desactiva la mitad de los hallazgos de
las dos lentes.

Corolario del mismo hallazgo: **proyección slim obligatoria** para el LLM 2. Sólo
`{nombre_display, rubro, atributos curados de la variante}`. Prohibido pasarle `unidad` (ya
estaba en §4), y además `precio_lista`, `precio_actualizado`, todos los `*_id`,
`rangos_cantidad`, `n_reglas_cantidad`, `mostrable`. Filtrar es más barato que explicar.

---

## 4. El anti-loop no cubre el camino nuevo

El anti-loop de repregunta compara **igualdad de string** contra los borradores previos. La
repregunta de v8.3 pregunta **el eje que separa los candidatos**, y los ejes están ordenados
(color → faz → gramaje → papel → material → acabado → tamaño): **cada vuelta pregunta un eje
distinto, o sea un string distinto, o sea el contador nunca llega a 2.**

Loop reproducible de 4 mensajes pagos: "quiero imprimir algo en papel" → ¿color o b/n? →
¿simple o doble faz? → ¿qué gramaje? → "no sé" → ¿qué gramaje? (recién ahí empieza a contar).
**USD 0,104 en un solo cliente**, y es exactamente el agujero que el consejo del 07-26 cerró.

**Sobrevive:** cota de **2 repreguntas de resolución por consulta**, contada sobre
`bot.decisiones` por `conversation_id` **cualquiera sea el eje**, no sobre texto. Al llegar
a 2: cotizar el piso con la puerta abierta (no email — los fallos de resolución no derivan a
email, es invariante). Es la misma forma que la cota de 1 vuelta que ya existe para `volver`.

**Y esta cota depende del fix del log de §0**: se cuenta sobre `bot.decisiones`, que hoy
escribe null.

---

## 5. Lo que NO sobrevivió del ataque (se descarta con razón)

- **"El LLM 1 puede dejar de ver el catálogo y ahorrar 11k tokens."** No. El LLM 1 no sólo
  emite el producto: decide la `action`, aplica el mundo cerrado y el freno
  anti-confabulación. Sin catálogo, "¿hacen tazas con foto?" deja de poder negarse con
  conocimiento y cae al Aclarador. El backlog §7 ya rechazó este movimiento por su nombre
  ("retrieval por categoría con clasificador LLM → rompe el mundo cerrado"). **Queda escrito
  en el plan para que nadie lo re-proponga como optimización obvia en la fase de código.**
- **Un guard de orden de magnitud contra la mediana del set** (propuesto por la lente de
  plata para cubrir la clase entera de errores >5×). La idea es buena y puede que sea el
  próximo escalón, pero es un guard nuevo con su propia superficie de falsos positivos, y
  meterlo en el mismo lote que un cambio de arquitectura hace imposible atribuir una
  regresión. **Va al backlog, no a v8.3.**
- **Subir o sacar el cupo de 4 del menú.** Se descarta **para este lote**, y la lente de
  costo dio la razón que faltaba: el compositor se aflojó el 27 (commit `42c7359`) y su
  comportamiento con listas largas **no se midió después del aflojamiento** — la evidencia
  de "17 opciones → tres oraciones" es de antes. Además, con el `LIMIT 8` de §3 el cupo deja
  de ser el cuello de botella. Y la lente de plata encontró que el cupo tapa por accidente
  un bug real: `esFamilia` (el pivot de packs) exige que todos los miembros tengan las
  mismas variantes, y `100 Tarjetas Papel Kraft 280 gr` tiene 2 contra las 4 de `100
  Tarjetas Color/Negro` → sin cupo, "200 tarjetas" cae a un menú plano de 14 líneas.
  **El cupo no es sólo legibilidad: es el guard que evita que los renderers menos probados
  vean listas para las que no se calibraron.**

---

## 6. Una pregunta para TG que el plan daba por contestada

El caso de aceptación pide traer `Impresiones papel obra 75 gr` ($100 s/f b/n, riso,
`por_pagina`) junto al rubro láser color ($750–$1.600, `solo_descuentos`). El plan lo trata
como requisito cerrado. **No son sustitutos**: no es la misma calidad ni el mismo trabajo.
Ofrecerlos en la misma frase dice implícitamente "son alternativas", y el cliente racional
elige la barata — el bot estaría canibalizando el producto de mayor margen sin que nadie lo
haya decidido. Ratio medido en el caso real: **5×** ($15.000 contra $75.000 por 100 hojas).

A favor del plan: el catálogo **ya declara** `default_familia: true` en `Impresiones` y
`default_variante: true` en `OBRA 75 GR S/F` (curación E0). Pero eso es evidencia sobre el
*default*, no sobre *mostrar ambos juntos*.

**Va a `preguntas-tg.md`:** *¿Ante "imprimir hojas a color", querés que el bot ofrezca la
opción riso de $100/$400 junto a la láser de $750, o que ofrezca primero la láser y mencione
la económica sólo si el cliente pregunta por precio?* Es una pregunta de negocio de una
línea y define el caso de aceptación entero.

**No bloquea la construcción:** el pipeline se construye igual, y la respuesta de TG cambia
el orden del ranking, no la arquitectura.

---

## 6 bis. La 1ª corrida real (2026-07-27, noche) — tres bugs y una corrección al plan

Martin corrió el caso A1 (*"cuánto sale imprimir 100 hojas a color?"*, conversación 346) y
**`Buscar Candidatos` devolvió vacío**. `Extraer Palabras` había funcionado bien: emitió
`impresiones laser color papel obra a4 imprimir 100 hojas`. El fallo era del SQL.

**1. El CTE que se leía a sí mismo (el que vaciaba el resultado).** El corte estaba escrito
como `where score >= 0.4 * (select max(score) from filtrado)` **dentro del propio CTE
`filtrado`**. Un CTE no puede referenciarse a sí mismo sin `RECURSIVE`: Postgres lo rechaza, y
con `onError: continueRegularOutput` el nodo devuelve el ítem de error en vez de filas — o sea
**la búsqueda salía vacía sin ninguna señal de que hubo un error**. El corte se mudó a su propio
CTE (`tope`). Nota: la misma sub-consulta en el `SELECT` final **sí** es legal; la ilegalidad es
estar adentro del CTE que se nombra.

**2. `oculto` no existe en `bot.variantes`.** Vive en `bot.producto_meta`, y **`bot.taxonomia` ya
lo aplica en su `WHERE`**. El filtro que yo había escrito leía una clave inexistente (inofensivo
por `coalesce`), pero el `flags` agregaba sobre `bot.variantes` **sin pasar por `taxonomia`**, así
que resucitaba productos que la vista ya había descartado. Ahora la búsqueda parte de `taxonomia`
y usa `variantes` sólo para agregar flags.

**3. `solo_descuentos` no significa lo que decía el plan §4 — y esto corrige el plan.** En la
vista real (`db/curacion-e0-2026-07-26.sql`) es `bool_and(r.rule_type = 'discount')`: *"todas las
reglas de precio de esta variante son descuentos"*, o sea **la lista es techo garantizado**. Es
mecánica de precio —`totalPermitidoFijo` la usa para decidir si puede multiplicar sobre
`ok_caveat`— y **no** la política comercial *"no ofrecer espontáneamente"* que el plan le
atribuía. Filtrar por él habría escondido productos legítimos: 54 de 185 variantes, entre ellas
los kraft y las ilustraciones. **El filtro se sacó.** El guard de nicho, que sí es una regla
comercial real, se conserva.

### Y un cuarto, de ranking: la cantidad no es un sustantivo

Con el SQL arreglado, la simulación contra el catálogo real mostró que el token `100` (de "100
hojas") metía **`100 Tarjetas`, `1000 Tarjetas` y `Talonarios Rifas 100 numeros`** en el top-8 de
una consulta de impresiones — su IDF es alto (3,09) porque está en sólo 4 productos. Los números
puros salieron de la tokenización. Es la misma clase que la regla de sustantivo de v8 ("anillado
para 120 hojas" no son 120 anillados). Los packs se siguen encontrando por "tarjetas"; los
gramajes sobreviven porque van pegados a su unidad (`80gr`).

### El caso de aceptación, medido

Simulando el ranking real (export del 27 + los 7 renames de la curación de ese día, que el export
no refleja):

| # | score | producto |
|---|---|---|
| 1 | 9,77 | Impresiones láser color papel obra 106 gr |
| 2 | 9,77 | Impresiones láser color papel obra 80 gr |
| **3** | **8,91** | **Impresiones papel obra 75 gr** ← el caso de aceptación |
| 4-7 | 7,49 | las 4 ilustraciones/opalina láser |
| 8 | 7,30 | Impresiones a4 papel obra 106 gr |

**Obra 75 entra tercera y pasa el corte.** Y un efecto secundario que conviene registrar: los 7
renames de la curación comparten el prefijo *"Impresiones láser color papel"*, así que ahora
**compiten entre sí por las mismas 4 palabras** y empujan a obra 75 hacia abajo. Con cupo 8 entra;
**con el cupo viejo de 4 se habría caído**. Es evidencia medida a favor de la decisión de mostrar
todo de una.

> `laser` da **df=0**: no aparece en ningún nombre del catálogo, así que el sesgo del LLM hacia el
> láser (emitió `Impresiones láser color papel obra 80 gr`) **no contamina la búsqueda**. Es
> exactamente el efecto que el diseño buscaba: que errar el eje deje de importar.

**Lo que esto dejó construido:** `tests/validate-sql-busqueda.js`, un validador estructural del
SQL. No reemplaza a Postgres (no hay instancia en el entorno), pero caza las tres clases de bug de
arriba, y está **verificado contra una copia con los bugs reintroducidos a propósito** — un
validador que no falla cuando debe no sirve.

---

## 7. Orden de construcción resultante

Los tres prerrequisitos del plan original siguen en pie (curación ✅ ya aplicada ·
ponderación por rareza · leyenda de atributos). Encima quedan estos, y **el orden importa**:

| # | qué | por qué antes | tamaño |
|---|---|---|---|
| 0a | **Fix del mapeo de `Log Turno`** (§0) | sin esto los anti-loops están muertos y el pipeline nuevo se depura a ciegas | 4 expresiones |
| 0b | **NFC en los slots de `Parsear Respuesta`** (plan §5 bis) | v8.3 no lo "hereda tal cual": lo **agrava**. Un token en NFD no matchea, los otros sí → la lista se arma sin el candidato correcto **y sin señal de que faltó** | 1 línea |
| 0c | **`options.timeout: 6000` en los 4 nodos LLM** | ya especificado en `r7` §336 y nunca aplicado; hoy el default es 300 s. Con 4-5 llamadas encadenadas, un proveedor lento deja al cliente esperando minutos y el debounce de 3 s ya gastó su margen | 4 params |
| 1 | **SQL de búsqueda por token**: IDF + `where not oculto` + nicho + `solo_descuentos` + `limit 8` con corte por score | los guards de negocio son SQL, no prompt. Y el `LIMIT` hace innecesaria media pasada del LLM 2 | el nodo |
| 2 | **`hayCompetencia` desde el candidato-set pre-filtro** | sin esto v8.3 sale con menos guardas de plata que v8.2 | 1 línea |
| 3 | **LLM 2 con proyección slim + leyenda de §4** | | el nodo |
| 4 | **Política de salida invertida** (listar con piso + puerta, en vez de repreguntar) + **cota de 2 repreguntas por conversación** | la cota depende de 0a | prompt + 1 nodo |
| 5 | **¿Muere el Aclarador?** — decisión explícita | si el LLM 2 ve la conversación y los candidatos, el Aclarador es redundante salvo con SQL = 0 filas, y ahí alcanza una repregunta determinística. Matarlo convierte el +1 neto de llamada en 0 neto | decisión |

**Fuera de este lote, al backlog:** el guard de orden de magnitud · el cupo del menú · el
`esFamilia` tolerante para el pivot de packs · `esTotal` desde `unidad_venta='pack'` en vez
de heurística sobre el shape de la tabla.
