# v9.1 — Que la capa determinística emita HECHOS, no una negativa redactada

> **Estado:** ⛔ **REFUTADO — no se construye tal como está escrito.** La pasada
> adversarial del 2026-07-28 (3 lentes Opus, independientes) tumbó la premisa central.
> Se conserva por el §0 (el pedido textual de Martin, que sigue vigente) y como
> registro de por qué no se hizo. **Leer §9 ANTES que cualquier otra sección.**
> **Fecha:** 2026-07-28. **Decisión de Martin** (ver §0).
> **Incidente que lo origina:** conversación real del 28, cartel de inmobiliarias.

> ⚠️ **§3 y §4b son FALSOS.** Están marcados en su lugar. No construir sobre ellos.

---

## 0. Qué pidió Martin, textual

Dos cosas, en dos momentos distintos de la sesión:

1. **La respuesta correcta** al pedido de 3 carteles para inmobiliaria es *"precio de cartel
   normal + mención de la promo y el precio de la misma"*.

2. **La dirección**, que es lo que hace a esto un plan y no un fix:
   > *"estos caminos tan deterministicos no estan buenos, necesitamos que el LLM con los
   > datos y las reglas dadas tome la decision en base al contexto de la conversacion de
   > cual es la mejor respuesta y la más adecuada, estoy de acuerdo en que no pueda
   > escribir precios pero ese es medio que el limite"*

   Y sobre de dónde salen los datos:
   > *"el nodo que busca candidatos deberia traer suficiente info como para que el
   > compositor pueda tomar una decision (…) en este caso la promo es x 6 y cualquier
   > numero menor va por la version normal, sino que muestre ambos"*

3. **El agregado del final**, que amplía el alcance:
   > *"tal vez cuando se arma el mensaje o la respuesta halla que tener en cuenta las
   > opciones filtradas y las que no para que el llm razone"*

---

## 1. El incidente

```
Cliente: cuánto sale un cartel de 1x0.65
Bot:     El cartel de 1 x 0.65 mt te queda en $19.500,00. [...]
Cliente: Necesito 3 para mi inmobiliaria
Bot:     La promocion para inmobiliarias tiene un precio especial desde 6 unidades.
         Cuantos necesitas asi te paso el que corresponde y te lo cotiza el equipo.
Cliente: 3
Bot:     Tenemos un precio especial para inmobiliarias llevando desde 6 unidades.
         ¿Cuántos necesitás así te lo cotiza el equipo?
```

El cliente dijo "3" **dos veces** y nunca recibió un precio. El sistema tenía los dos
números en memoria: $19.500 (normal) y $15.000 (promo desde 6).

**Dos causas independientes**, y las dos hay que arreglarlas:

| # | causa | estado |
|---|---|---|
| A | `Log Turno` escribía `null` en `accion` (NOT NULL) → INSERT rebotaba en silencio → sin fila no hay `senales` → no viaja `pendiente` → el bot llega sin memoria y repregunta | ✅ **arreglado** (commit `1dd3040`) |
| B | el guard `bajoMinimo` descarta el precio ya calculado y emite una negativa, en vez de cotizar el hermano | ⬜ **este plan** |

Con (A) arreglado el mensaje 4 deja de repetirse. El mensaje 3 sale igual: (B) no depende
de la memoria.

---

## 2. El defecto, en una línea

`Armar Respuesta Precio`:

```js
const bajoMinimo = Number.isInteger(atr.min_unidades) && qtyPedida !== null && qtyPedida < atr.min_unidades;
...
if (bajoMinimo && (estado === 'ok' || estado === 'ok_caveat' || estado === 'ok_rangos')) estado = 'fallback: bajo_minimo';
```

El estado ya era `'ok'`: **el precio estaba calculado**. El guard lo tira y salta a un
template de repregunta.

El propio código lo dejó anotado (build-v9.js, bloque 9):

> *"Se niega a cotizar algo que el sistema sabe. El cliente YA dijo 3; el cartel normal a 3
> unidades es un número que existe. Deriva al equipo un pedido que podía cerrar. El (2) es
> más profundo (habría que re-cotizar el hermano sin nicho) y **queda anotado, no
> construido**."*

Este plan construye ese (2).

### 2b. Efecto colateral que hay que recordar

`okEstado` no incluye `fallback: bajo_minimo`, así que **el aviso de cambio de producto
(bloque 8b) y el `supuesto` nunca corren en este camino**. Es parte de por qué el mensaje 3
salió sin contexto: el bot cambió de producto y no lo dijo, porque el nodo que lo dice
estaba apagado por el mismo fallback.

---

## 3. ~~El dato ya está — verificado, no supuesto~~ ⛔ FALSO

> **Esta sección es el error central del plan.** La tabla de abajo describe el turno 2
> (*"Necesito 3 para mi inmobiliaria"*), donde el hermano SÍ está en el candidato-set.
> Pero `bajoMinimo` dispara en el turno 3 (*"3"* pelado), y ahí la búsqueda la maneja el
> eco del LLM (*"promoción inmobiliarias"*): el corte relativo del SQL (`score >= 0.4*max`)
> deja al cartel normal en 0,23 del máximo, o sea **ni entra al pre-filtro**. El fix
> habría sido inerte: el 100% de los casos seguiría cayendo al template.
> Se verificó sobre el turno equivocado. Ver §9.

| paso | qué pasa con el hermano |
|---|---|
| **SQL** (`Buscar Candidatos`) | El guard de nicho es **aditivo**: `where (f.nicho is null or (f.nicho='inmobiliarias' and pe.ventana ~ 'inmobiliari\|inmueble'))`. Con "inmobiliaria" en la ventana salen **los dos** productos, cada uno con sus variantes y su `precio_lista` |
| **`Aplicar Filtro`** | `filasPrecio` los aplana con `idx` 1 y 2 |
| **`Armar Respuesta Precio`** | `porIdx[1]` y `porIdx[2]` **conviven en memoria**. `evaluar()` solo mira `porIdx[1]` — no borra el `[2]` |

En el punto exacto donde dispara `bajoMinimo` están en scope: `atr.min_unidades` (6),
`qtyPedida` (3), `row.precio_lista` (15000), `porIdx[2][0].precio_lista` (19500),
`row.familias`, `atr.material`, y `$('Buscar Candidatos').all()` (candidatos **pre-filtro**).

**No hace falta consulta nueva ni nodo LLM nuevo.**

### 3b. Cómo se reconocen dos hermanos

Verificado en `db/curacion-e0-2026-07-26.sql`:

| | normal (`:1399`) | promo (`:1473`) |
|---|---|---|
| producto base | `carteleria en plastico corrugado` | `carteleria en plastico corrugado` |
| `familias` | `['carteleria']` | `['carteleria']` |
| `material` | `plastico_corrugado` | `plastico_corrugado` |
| `nicho` | ausente | `inmobiliarias` |
| `min_unidades` | ausente | `6` |

**Criterio:** mismo `familias` + mismo `material` + uno tiene `nicho`/`min_unidades` y el
otro no.

⚠️ Ojo: `ejeDiscriminante` hoy **descarta explícitamente** este par (`!!a0.nicho !== !!b0.nicho → return null`).
Eso está bien para "gemelos" (no son la misma cosa) pero significa que no se puede reusar esa
función acá. Es un criterio nuevo, no un reuso.

---

## 4. Lo que se construye

### 4a. `bajoMinimo` deja de ser un callejón

Cuando dispara, en vez de saltar al template:

1. Buscar el **hermano** entre las filas ya disponibles (`porIdx[2..N]`, y si no está,
   `$('Buscar Candidatos').all()` que es pre-filtro).
2. Si existe → **cotizar el hermano** con la cantidad que el cliente pidió, y anexar la
   promo como hecho aparte. Estado `ok` (con su marcador), no fallback.
3. Si **no** existe → cae al template actual. La conducta de hoy queda como piso: nunca
   peor que ahora.

El punto 3 es la respuesta al *"hoy sí mañana no"* de Martin: el fix **no asume** que
siempre haya hermano.

### 4b. La forma del borrador

Los dos montos tokenizados, cada uno pegado a su condición:

```
Cartel 1x0,65 — 3 unidades: [[P1]]
Promoción inmobiliarias — desde 6 unidades: [[P2]] c/u
```

El compositor lo redacta. Nunca ve ni escribe un número de plata (se re-estampan en
`Aplicar Compositor`). ~~Las reglas del gate ya cubren esto: *"separar un monto de su
condición"* está prohibido, así que "desde 6" no se puede despegar de `[[P2]]`.~~

> ⛔ **FALSO.** Esa es una regla del **prompt** — texto que el LLM puede ignorar — no un
> chequeo programático. Y peor: el gate de `Aplicar Compositor` **dejó de bloquear** el
> 2026-07-28 (decisión de Martin, v8.3b). Hoy las conservaciones sólo OBSERVAN y loguean
> en `compositorObs` con prefijo `habria_`; lo único que todavía rechaza es
> `token_residual`. O sea: no hay ninguna garantía de que el monto quede pegado a su
> condición. Un mensaje de dos precios con dos condiciones distintas no está protegido.

### 4c. El aviso de cambio de producto tiene que correr

Como el estado pasa a ser `ok`, `okEstado` se cumple y el bloque 8b vuelve a activarse
solo. Eso arregla de paso el *"Ese precio"* sin referente: el mensaje va a decir de qué
producto es cada monto.

### 4d. Lo filtrado y lo descartado llegan al razonamiento — *(pedido de Martin, §0.3)*

Hoy `Aplicar Filtro` **ya calcula** `filtroDescarto` y `filtroMotivo`, y nadie los lee río
abajo. Es información tirada.

Propuesta: que viajen en `senales` (que ya existe, ya viaja a `Log Turno`, y desde el fix
`1dd3040` **por fin se persiste**). Con eso:

- quedan **medibles**: se puede leer en `bot.decisiones` cuántas veces el filtro descartó
  el hermano, que es justo el riesgo del §6;
- quedan disponibles para el turno siguiente vía `Get Ruta Cotizador`.

**Lo que NO propongo, y quiero que el contraste lo discuta:** pasarle al compositor la
lista de descartados. El compositor está aislado del historial *a propósito* — es lo que
garantiza que no contradiga turnos viejos — y tiene prohibido nombrar productos que el
borrador no nombra. Darle descartados abre exactamente esa puerta: podría ofrecer algo que
el filtro descartó por buenas razones. Si hay que mostrar una alternativa, la decide el
código y la escribe en el borrador.

---

## 5. Lo que NO se toca, y por qué

- **El umbral lo aplica el código, no el LLM.** *"menos de 6 va por la normal"* es una
  comparación numérica. Dársela a un modelo es el patrón que produjo los cuatro
  confident-wrong del 27 (1,42× · 1,25× · 1,76× · 100×).
- **No hay nodo LLM nuevo.** Lo que Martin describe ya existe: `Llamar LLM Filtro` recibe
  candidatos + historial y decide cuáles van. El problema no es que falte quien decida; es
  que **después de que decide, el código descarta todo menos el primero**.
- **El LLM sigue sin tipear plata.** Ese límite es de Martin y no se mueve.

---

## 6. Riesgo conocido: el filtro puede comerse al hermano

Si `Llamar LLM Filtro` devuelve **solo** el índice de la promo (legítimo: el cliente nombró
el rubro), el hermano no llega a `filasPrecio`.

**Mitigación:** releer `$('Buscar Candidatos').all()` — trae los candidatos **pre-filtro**,
donde el hermano está garantizado por el `f.nicho is null` del SQL.

Es el único punto donde el dato *puede* perderse, y es un LLM, no código.

---

## 7. Preguntas para la pasada adversarial

Tres lentes, consigna de **refutar**:

**Plata.** ¿El hermano elegido por familia+material puede ser el producto equivocado? ¿Qué
pasa con cantidades que caen en un bracket (`ok_bracket`) o por página (`ok_paginas`), que
el guard hoy **no** cubre? ¿Se puede construir un caso donde esto cotice de más o de menos?

**Resolución.** ¿`porIdx[2]` es siempre el hermano, o puede ser un tercer producto no
relacionado? ¿Qué pasa con 3+ candidatos? ¿Y si hay dos productos de nicho distintos
(medicina + inmobiliarias) en la misma búsqueda?

**Voz.** Un mensaje con dos precios y dos condiciones, ¿sobrevive al compositor sin que se
despeguen los montos de su condición? ¿No es peor que una repregunta corta? ¿El cliente que
pidió 3 entiende que $58.500 es lo suyo y $15.000 es hipotético?

**Transversal (§4d).** ¿Meter descartados en `senales` tiene algún costo de privacidad,
tamaño de fila o ruido en la telemetría?

---

## 8. Falsación

Cómo sabemos si estuvo bien, medido sobre `bot.decisiones` (ahora que persiste):

- De las respuestas con `bajo_minimo` resuelto por hermano, **si más del ~15% del turno
  siguiente pide igualmente la promo o repregunta**, el formato de dos precios confunde y
  hay que volver a una sola cifra + oferta.
- Si `filtroDescarto` muestra que el hermano se pierde seguido, la mitigación del §6 pasa
  de red a camino principal.

---

## 9. Veredicto adversarial — 2026-07-28

Tres lentes Opus, consigna de refutar, sin coordinación entre ellas. **Las tres tumbaron
el plan**, y por razones distintas que se acumulan:

| # | hallazgo | consecuencia |
|---|---|---|
| 1 | **El hermano no está en el candidato-set en el turno donde el guard dispara** (§3 verificó el turno 2; `bajoMinimo` corre en el turno 3). El corte `score >= 0.4*max` lo deja en 0,23 del máximo. | El fix habría sido **inerte**: 100% de los casos seguía cayendo al template. |
| 2 | **`familias` + `material` no identifica al hermano.** `material` es `null` en la mayoría de las fichas, así que el criterio degenera a 1-a-10 para el otro nicho del catálogo. | Riesgo de cotizar un producto no relacionado. |
| 3 | **Aun encontrándolo, se cotizaba mal.** `elegirVariante()` puntúa sobre el mensaje ACTUAL — en el turno del incidente es *"3"* — y sin medida gana la más barata: **A3 a $10.500 en vez del 1x0,65 a $19.500. Sub-cotización de 1,86×**, la misma magnitud que los confident-wrong del 27. | El fix habría *creado* un bug de plata. |
| 4 | **§4b invocaba una garantía inexistente** (regla de prompt, no chequeo; y el gate ya no bloquea desde el 07-28). | Dos precios con dos condiciones quedaban sin protección. |

**Enmienda #1 de la lente resolución, textual:** *"Antes de construir nada, medir."*

### Qué se hizo en su lugar

- **Curación en vez de inferencia** (`db/curacion-2026-07-28b.sql`, commit `e3f405b`): el
  vínculo promo → hermano se **escribe** como dato (`producto_base` + `variante_base`),
  porque la medida vive en el propio nombre de la promo (*"6 carteles 1 x 0.65 mt"*). No
  se adivina en runtime. Cierra los hallazgos 1, 2 y 3 de una.
- **Dos bugs cazados por las lentes fuera de su consigna**, ambos arreglados:
  - `1dd3040` — `Log Turno` escribía `null` en `accion` (NOT NULL) → el INSERT rebotaba en
    silencio → **cero filas de la rama normal** → sin `senales` no viajaba `pendiente` →
    el bot llegaba a cada turno sin memoria.
  - `3e9fe17` — `hayCompetencia` contaba FILAS (una por variante) en vez de PRODUCTOS, así
    que un producto con 4 variantes daba `nCandidatos=4` y **la puerta se abría siempre**.
    El guard construido el 27 llevaba desde entonces sin discriminar nada.

### El pedido de Martin (§0) sigue vigente

Nada de esto contesta *"que el LLM decida con el contexto de la conversación"*. El guard
`bajoMinimo` **sigue negándose a cotizar algo que el sistema sabe**. Lo que cambió es que
ahora existe el dato curado para hacerlo bien, y que `bot.decisiones` por fin se escribe,
así que la próxima iteración se puede **medir** en vez de simular.

### Continuación

El incidente del turno 4 (*"Ok y si solo necesito 3?"* → $10.500) es un bug **distinto**,
descubierto después: la variante elegida **no se recuerda entre turnos** (`senales` guarda
`producto_nombre` pero no la variante), así que en cuanto el cliente deja de repetir la
medida, el desempate cae en "la más barata". Se trata aparte.
