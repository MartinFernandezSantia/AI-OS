# R7 — Refinador final + resolución determinística — **v2 (post-consejo Opus)**

> Insumo: ronda 4 de suite-5 + suite-6 corridas por Martin en WhatsApp real (2026-07-25),
> con capturas y notas — 16 incidentes. Revisado por un consejo de 5 lentes Opus:
> acta en [`r7-consejo-opus.md`](./r7-consejo-opus.md).
> **Estado: PROPUESTA. Nada construido, nada aplicado.**
> Regla que no cambia: Claude prepara, **Martin aplica**; harness verde tras cada nodo Code.
>
> v1 → v2: el consejo encontró 3 bugs de plata vivos que no eran parte del encargo, y que la
> §2.2 de v1 (Get Precio devolviendo todas las variantes) apagaba los 7 guards del motor.
> El orden de entrega se dio vuelta. El refinador pasa de "redactor" a "editor de bordes".

---

## 0. Lo que Martin fijó (requisito, no se discute)

- **Nodo LLM final antes de todo texto que salga al chat**, que comprima y humanice.
- **Mono-variante ⇒ solo el nombre del producto.** Imperativo.
- **Fuera la leyenda** `(precio de lista; el precio final del trabajo te lo confirma el equipo)`.
  Reemplazo confirmado: `El total te lo confirmamos en el local o por mail.` — dirección
  completa solo en la primera mención de la conversación.
- **Variante por defecto en el catálogo curado**, con puerta abierta: se muestra el default y
  se ofrece el resto ("¿buscabas algún gramaje en especial?"). Nunca un default silencioso.
  Reemplaza la regla "NO hay defaults de oficio" del 2026-07-24.
- **Los Get se hacen con el término del producto principal**; el filtrado de variantes es del
  sistema, no del LLM.

**Dos límites que el consejo pide dejar por escrito** (no bloquean, acotan expectativas):

1. Después de excluir menús, tablas, líneas de degradación y la oración que lleva el monto, lo
   que el refinador puede reescribir son una o dos oraciones. El nodo se justifica **por voz**;
   los menús feos del incidente 7 los arregla el render determinístico (§3), no el refinador.
   Si el refinador pudiera renumerar el menú, el "la 2" del turno siguiente apuntaría a otro
   producto sin ninguna señal.
2. Cuatro textos siguen fijos y no pasan por el refinador: `Mensaje Escalación`,
   `Saludo Bienvenida`, `Respuesta No-Texto`, `Mensaje Cap Email`. Convergerlos llevaría la
   convergencia de 3 ramas a 7 por textos de baja frecuencia que conviene tener deterministas.

---

## 1. Bugs de plata vivos — entran al paquete aunque no estaban en el encargo

| # | Qué pasa hoy | Plata | Arreglo |
|---|---|---|---|
| V1 | Promo inmobiliarias: `por_pack=false` (curación 24b) habilitó el total. "3 carteles" → `3 × $15.000 = $45.000`; el real de 3 sueltos es $58.500 | −$13.500 | `min_unidades=6` curado + el motor no da total bajo el mínimo |
| V2 | 18 variantes de Taller multiplican por hojas. "Anillado para 120 hojas" → `120 × $4.200 = $504.000` | absurdo público | flag curado `por_trabajo` |
| V3 | `Talonarios Rifas 100 numeros`: "500 rifas" cotiza 500 talonarios = 50.000 rifas | absurdo público | `por_pack=true` + `numeros\|rifas\|talonarios` a la regex de telemetría |

Los tres viven en el catálogo de **testing**, no hay clientes reales expuestos. Los tres son
gate de go-live.

**Corrección de documentación (no es código):** `mostrable` en la vista es `(not tiene_reglas)`
y ningún nodo lo lee. La línea 138 de `preguntas-tg.md` ("el cartel suelto existe pero
mostrable=false → deriva") está mal leída: el bot sí lo cotiza. Ocultar de verdad es
`oculto=true` en `variante_meta`. Y ojo: `mostrable=false` en las 4 variantes de `OBRA 80 GR`,
así que **nunca** implementar "variantes visibles" con ese campo.

---

## 2. Mapa incidente → causa raíz → arreglo

| # | Incidente | Causa raíz verificada | Arreglo | Entrega |
|---|---|---|---|---|
| 7 | menú feo, mono-variante con medida rara, re-pregunta faz/color ya dados | `Armar Menu Opciones` L85 imprime la variante aunque el grupo tenga una sola; no filtra por lo ya anclado | §3.1, §3.2 | E2 |
| 7b | no ofreció el 75 | el LLM eligió el 106 sin ancla del cliente | guard de gemelos §2.4 | E1 |
| 11 | menú para producto de variante única | ídem 7 | §3.1 | E2 |
| 13 | eligió `1" 1/4` del metálico solo | nada impide que el LLM invente la variante | guard de variante no anclada §2.5 | E1 |
| 14 | presumió el 106 | gemelos 75/106 con variantes idénticas | §2.4 | E1 |
| 15 | no ofrece la láser 80 | decisión de negocio | pregunta TG | E1/E2 |
| 16 | todos los fallbacks dicen lo mismo | un solo texto para 7 estados (ARP L337-340) | §4.3 | E2 |
| 17 | visión de túnel tras derivar | ventana `papelEspecialHit` de 3 mensajes | §2.6 | E1 |
| 18 | no encontró `OBRA 80 GR` | el cliente escribe `80gr`, el catálogo `OBRA 80 GR`; rank-2 es substring | §2.3 | E1 |
| 19 | no encontró `150 Tarjetas Color/Negro` | el LLM compone un nombre inexistente | §2.1 | E1 |
| 21a | 150 tarjetas → pack de 100 | la cuantización nunca se implementó | §4.4 (**decisión pendiente**) | E2 |
| 21b | "Dos packs de 100 te quedan en $12.000" + caveat duplicado | el texto lo escribe el LLM vía `p.template` | §4.1 | E2 |
| S6-1 | pregunta gramaje al Vegetal y después lista tamaños | eje inventado + menú que ignora lo anclado | §2.2, §3.2 | E1/E2 |
| S6-2 | "Papel Vegetal / A3" → "no lo tenemos en catálogo" | `OFICIO / a3` ≠ `a3` (igualdad exacta) → 0 filas | §2.2 | E1 |
| S6-4 | espiralado → precio del a3 directo | gemelos anillado plástico | §2.4 | E1 |
| S6-5a | promo "de 6 carteles … $15.000" | el texto lo escribió el LLM | §4.1 | E2 |
| S6-5b | ofrece "te paso el detalle por mail" y ante "Ok" se calla | acción inventada + noop por repetición | §4.5 | E2 |
| S6-6 | bookcel → deriva hablando del 106 | gemelos + ventana de papel | §2.4, §2.6 | E1 |
| S6-7 | menú repetido por cada pack | el pivot exige variantes idénticas; Kraft (2) rompe la familia (4) | §3.3 | E2 |

---

## 3. Entrega 1 — resolución (`Get Precio` + `Armar Respuesta Precio`)

*1 import · 0 nodos nuevos · 0 SQL de migración (el matcher vive dentro del nodo).*

### 2.1 Contrato del LLM: término principal, no SKU compuesto

`producto` = el término del producto como lo diría el cliente o como lo lista el catálogo
(`tarjetas`, `impresiones papel obra 75 gr`, `lona mate`, `anillado plástico`). Prohibido
componer cantidad + producto (`150 Tarjetas Color/Negro`) o producto + opción
(`Impresiones a4 s/f b/n`). La cantidad va siempre en `cantidad`.

### 2.2 Resolver el producto en SQL, la variante en JS — **en ese orden**

`Get Precio` resuelve el **producto** (rank 1/2/3 como hoy) y devuelve **todas** las variantes
visibles de cada producto matcheado, más `n_variantes`.

`Armar Respuesta Precio` gana un paso previo, `resolverVariante(variantes, pedido, ventana)`:

1. igualdad normalizada;
2. **subconjunto de tokens como multiset** (`a3` ⊂ `OFICIO / a3` ✅; y `"1 1"` ya no matchea
   `1"` como pasa hoy con `every/includes`);
3. contenido;
4. mono-variante → automática;
5. varias → `variante_ambigua`; ninguna → `variante_ausente`.

Diccionario fijo de sinónimos de variante (el campo `sinonimos` es solo de producto):
`blanco y negro↔b/n`, `pulgada↔"`, `metro↔mt`, `media/cuarto/octavo↔1/2, 1/4, 1/8`.

**`evaluar()` sigue recibiendo 0 ó 1 fila.** Estados nuevos, con texto distinto:
`producto_ambiguo` (varios productos) y `variante_ambigua` (un producto, varias variantes).
Hoy los dos colapsan en `ambiguo`. Cuando hay varias variantes, la repregunta es del **eje que
falta** ("¿simple o doble faz?"), no el menú completo.

**Cap del menú rescate por productos (≤6) y variantes por producto (≤4), nunca por filas** —
con la firma nueva "tarjetas" son 14 filas y "papel obra" 26; contar filas los mandaría a email.

### 2.3 Una sola normalización, a ambos lados y en los dos nodos

`lower → acentos → (\d)\s*(gr|grs|gramos) ⇒ '$1 gr' → [^\w\s+] ⇒ ' ' → colapsar espacios`,
en una función SQL `bot.resolver_producto(prod, vari)` usada por `Get Precio` **y**
`Get Opciones`. Hoy la rama menú no tiene rank 2 y los 8 términos genéricos más comunes
(`tarjetas`, `papel obra`, `impresiones`, `anillado plastico`, `folletos`, `tacos`,
`plastificado`, `sobre`) dan `menu_sin_match`.

La puntuación desbloquea 6 casos reales que el gramaje no toca (`anillado plastico a4 oficio`,
`folios a4 oficio`, `opp mate holografico`, `carteleria en pvc c/ papel obra 130 gr`,
`a5 ilust mate 250 gr`, `tarjetas color negro`). Verificado: la normalización de gramajes no
crea ninguna colisión nueva entre los 82 nombres. Nada de `de N` genérico (secuestra
cantidades); para "obra de 80" vale la regla anclada al léxico de papel que ya existe en
`extraerGramajes`.

### 2.4 Guard de gemelos

*Esqueleto* = nombre normalizado sin dígitos ni tokens de tamaño/unidad. 8 grupos / 18
productos en el catálogo vivo, **cero falsos positivos** (verificado con `scratchpad/t1-gemelos.js`).

Dispara cuando hay gemelos y el cliente **no** ancló ningún token discriminante:

```
t discrimina en G ⟺ t ∈ ∪tokens(G) ∧ t ∉ ∩tokens(G) ∧ ∀m∈G: eje(t) ∈ ejes(m)
eje ∈ { gramaje (\d{2,3} seguido de gr) | tamaño (a3-a6, oficio) | numero | léxico }
```

El eje es obligatorio: sin él, `"20 hojas a4"` ancla en el 106 (INC-14 sin arreglar) y
`"80 hojas"` ancla como gramaje. Un **único extractor de anclas**, compartido con
`GUARD NUMERALES`.

Exenciones:
- **`por_pack=true` exento** — el esqueleto es la clave de la escalera de tiers, no un bloqueo
  (regla resuelta 140).
- **La selección del menú anterior cuenta como ancla** — si no, el `"2"` con que el cliente
  contesta reabre el mismo menú → anti-loop → email al tercer turno.

**Lo que el esqueleto NO ve** (`OBRA 106 GR` vs `Impresiones a4 papel obra 106 gr`, 6,7×;
`Vegetal` vs `Papel Obra Vegetal`, 10×; los 3 `Folletos 10x15`, 5,5×) se arregla por
**curación** empatando sinónimos → rank empatado → `ambiguo` → menú, que es el mecanismo ya
probado con Kraft 130/300. El guard en código es airbag, no sustituto del dato.

### 2.5 Guard de variante no anclada

Producto con >1 variante visible y ninguna anclada por el cliente → repregunta del eje o menú.
Nunca el precio de una variante elegida por el LLM (INC-13).

Costo medido: fuerza menú en el 43% del catálogo → **+6 a +9 menús/día** sobre ~18 consultas
de precio diarias. Es el precio de no volver a cotizar el `1" 1/4` porque sí.

### 2.6 Ventana de papel especial

`papelEspecialHit` se suprime si el turno anterior fue un menú del bot, y `"el más grueso"` /
`"el mejor papel"` mapean al mayor gramaje **del grupo ofrecido**. Hoy la respuesta natural al
menú 75/106 se va a email (INC-17 mudado de lugar).

### Housekeeping que viaja gratis en E1 (sin conducta nueva)

- `timeout` en los 3 nodos LLM (hoy ninguno lo tiene → default 300 s).
- `models: ['google/gemini-2.5-flash-lite','google/gemini-3.1-flash-lite']` en el body de
  OpenRouter: convierte el 404 del 16-oct en fallback silencioso y cubre 429/5xx mejor que el
  retry de n8n.
- Id del modelo en **un solo campo** (`System Prompt.modelo`), referenciado desde los 5 puntos
  donde hoy está hardcodeado.
- `onError: continueRegularOutput` en `Log Precio` y `Log Respuesta` (hoy sin onError: un blip
  de la DB deja la ejecución en rojo y un "retry execution" **reenvía el mensaje**).
- Caveat viejo fuera (es un string).

### Ronda 1 — criterio binario, la voz NO se juzga

Incidentes 7b, 13, 14, 17, 18, 19, S6-2, S6-4, S6-6 + suite-6 casos 1-5 + regresión suite-5
casos 13, 19, 20, 21, 22, 28. Se pregunta una sola cosa: **¿resolvió el producto correcto?**

---

## 4. Entrega 2 — menús + voz + plata

*1 import · 0 nodos nuevos · 1 curación SQL (flags `por_trabajo` / `min_unidades` / `por_pack`).*

### 3.1 Mono-variante ⇒ nombre del producto
En `Armar Menu Opciones` (3 ramas), en el menú rescate de `Armar Respuesta Precio`, en
`Aplicar Aclarador` y en el render (`nombreVar` mira `n_variantes`).

**`n_variantes` cuenta las TOTALES, no las visibles.** Si una curación oculta una hermana, el
render diría "El vegetal sale $1.000" y el cliente que quería a3 se lleva un número que no es
suyo.

**El atributo escondido se recupera en el nombre del producto, no reponiendo la variante**
(`Lona Front Brillo` → "Lona front brillo (hasta 1,52 m de ancho)"). Lint mecánico en la skill
de curación: todo producto mono-variante cuya variante tenga un token de medida ausente del
nombre del producto se lista como pendiente.

### 3.2 No re-listar lo ya dado
Si el cliente ancló `simple faz`, el menú lista solo las variantes que la contienen; si queda
una, no hay menú.

### 3.3 Pivot de packs por esqueleto
Agrupa la familia aunque el set de variantes difiera; Kraft es su propia línea (S6-7: 14 líneas
→ 6).

### 3.4 Orden canónico, nunca alfabético
Simple antes de doble, b/n antes de color, chico antes de grande; cuando el eje es una medida,
**ordenar por precio** (en el anillado metálico el orden alfabético es orden de precio salteado
y el que manda "2" se lleva el más caro de los cinco).

### 4.1 Plantilla siempre forzada
El `reply`/`template` del LLM en `action precio` se descarta. Mata la promo mal descripta,
el caveat duplicado, "dos packs … $12.000" y "el anillado metálico de 120 páginas".

### 4.2 `frasePrecio()` única
`frasePrecio(monto, unidad, condicion, estimado)` reemplaza las 5 armadas sueltas. **Ningún
monto se imprime sin su unidad de venta** (`por hoja`, `el metro cuadrado`, `el pack de 500`,
`cada cartel`) ni sin la condición en la misma oración. Sin centavos salvo que los tenga de
verdad. `unidad` solo se imprime si está en allowlist curada (`página`, `m2`, `metro lineal`,
`metro`): 148 de 180 variantes dicen "Hoja" por herencia y hoy sale "un taco, precio por hoja".

Caveat: `El total te lo confirmamos en el local o por mail.` — dirección solo la primera vez.
Primera persona plural siempre ("te lo confirmamos", no "te lo confirma el equipo").

### 4.3 Mensaje por tipo de fallback
`papel_especial` · `precio_cero`/`override`/`qr_multiple` · `dorso`/`df_gate` · `cap_volumen` ·
`sql_error` · `nada` del Aclarador (**sin** "no lo tenemos en catálogo").

### 4.4 Packs — ⚠️ decisión pendiente (§6.1)
Flags `por_trabajo` y `min_unidades` (bugs V1/V2/V3) entran sí o sí. La regla de cuantización
depende de la decisión de Martin. Y el §4.4 necesita un slot nuevo `packs`: hoy `por_pack=true`
mata `cantidad`, así que la aritmética de "2 packs de 100" es inalcanzable con los slots
actuales.

### 4.5 Afirmación nunca es silencio
`noop` pasa a ser decisión de intención: clasificador determinístico de 3 bits (¿hay pregunta?,
¿hay dato nuevo?, ¿el último mensaje del bot terminó en pregunta u ofrecimiento?) antes de
comparar textos. Cualquiera en 1 ⇒ `noop` prohibido. El backstop de 2 repeticiones sigue detrás.

### Ronda 2
suite-6 completa + suite-5 casos 21, 22, 23, 26 + incidentes 7, 11, 16, 21a, 21b, S6-1,
S6-5a, S6-5b, S6-7. Con la resolución congelada en E1, **todo fallo nuevo es de render**.

---

## 5. Entrega 3 — topología (sin cambio de conducta)

*1 import · **−4 nodos** (68 → 64) · 1 SQL de una línea · smoke de 6 mensajes, sin ronda completa.*

Los tres nodos de envío son POST idénticos a Chatwoot con la misma credencial; los tres Log
escriben en la misma tabla.

```
Switch Acción[0] ──┐
Pre-Envío Precio ──┼→ Enviar Mensaje → Log Turno
Armar Menu Opciones┘
```

- `Enviar Precio` → `Enviar Mensaje`; borrar `Enviar Respuesta` y `Enviar Menu`.
- `Log Precio` → `Log Turno` sobre `$json.*`; borrar `Log Respuesta` y `Log Menu`.
- Cada rama emite el mismo sobre `{reply, accountId, conversationId, userMessage, accion,
  notas, productoResuelto, filasSql}`.
- `alter table bot.decisiones add column if not exists borrador text;` + `Get Ruta Cotizador`
  devuelve los últimos 3 borradores + los anti-loop comparan contra **el borrador**, no contra
  `lastBotReplies`.

**Por qué antes del refinador:** `Enviar Respuesta` lee hoy `$('Parsear Respuesta').reply`, que
ejecuta siempre — así que con el refinador enchufado **mandaría el borrador sin refinar, sin
error y sin aviso**. Y el `volver` hace correr `Parsear Respuesta` dos veces (`runIndex` 0 y 1):
`$('Nodo').first()` puede leer el run 0, que tiene `reply: ''` → **mensaje vacío a Chatwoot** y
`accion` envenenada para el router C2. El sobre `$json` elimina la clase entera.

Smoke: 1 answer, 1 precio, 1 menú, 1 `volver` (suite-5 caso 25), 1 handoff, 1 repetición +
`select accion, notas, borrador from bot.decisiones order by created_at desc limit 10`.

---

## 6. Entrega 4 — el refinador

*1 import · +3 nodos (64 → 67) · 0 credenciales a mano (el bloque va escrito en el JSON).*

```
Armar Prompt Refinador → Llamar LLM Refinador → Aplicar Refinador → Enviar Mensaje
```

### El borrador se parte en dos
**Bloque literal** (viaja verbatim, nunca ve el LLM): líneas `N.` del menú, tabla de rangos
completa, `LINEA_DF`/`LINEA_CAP`/`LINEA_VOLUMEN`, la oración que contiene un monto con su
etiqueta, la dirección de mail.
**Prosa refinable**: encabezado, cierre, repregunta.

### Entradas determinísticas
`situacion` (derivada del pipeline, no cuesta llamada extra), `hechos.productos =
rows.map(nombre_canonico)` — **de la DB, nunca parseando el borrador**, si no la verificación
es circular —, `primer_mensaje`, `puede_cerrar`, `aperturas_recientes`, `mail_ya_dado`.
El eco del LLM (`p.producto`, texto influido por el cliente) **no llega al refinador**.

### Tokens
`[[P1]]`, ASCII, sin clase de comilla, sin markdown activo en WhatsApp (`«»` ya se usa para
envolver el mensaje del cliente en el prompt del Aclarador, y el cliente puede forjarlo).
Pre-normalización NFKC + borrado de zero-width antes de gatear. Los montos se estampan **desde
los valores de la DB**, nunca por regex sobre el texto: tokenizar con `\$[\d.,]+` lavaría plata
alucinada del Aclarador o de la rama answer, que no pasan por el chequeo `plataRe`.

### Gate de conservación (relativo al borrador, no denylist absoluta)
1. multiset de corridas de dígitos idéntico (cubre cantidades, gramajes, medidas, rótulos de
   bracket y los dígitos del nombre del producto: "6 carteles", "106 gr");
2. índices de token exactos, uno cada uno, **en orden creciente** (anti-swap gratis), misma
   partición por línea;
3. contención monótona: ningún `$`, ningún `@` y ningún término del lexicón de riesgo
   (`total`, `en total`, `todo junto`, `c/u`, `cada uno`, `stock`, `hoy`, `mañana`, `hs`,
   `plazo`, `entrega`, `reservo`, `garantizo`, `envío`, `descuento`, `IVA`) con conteo mayor
   que en el borrador;
4. conteo de líneas `^\d+\.` preservado;
5. el mail va tokenizado (`[[MAIL]]`) y debe volver intacto — si no, se rompe `avisoDado` y el
   bot anuncia el mail en cada turno;
6. rechazo ⇒ **borrador**, siempre, y se loguea como canario.

### Nodo HTTP: clon de `Llamar LLM Aclarador`, no de `Llamar LLM Respuesta`
`onError: continueRegularOutput` + `alwaysOutputData: true` + `timeout: 6000` + **sin
`retryOnFail`** (un 429 con retry agrega 6 s de silencio para terminar mandando el borrador
igual) + `models: [2.5, 3.1]` + `response_format: json_object`.
`Aplicar Refinador` lee el borrador de `$('Armar Prompt Refinador')` — obligatorio: con
`continueRegularOutput` el ítem en error es `{error}`, no el de entrada — y corta si
`$runIndex > 0`.

### Instrucción de voz (lista cerrada)
Puede: cortar repeticiones · una sola pregunta, al final · saludar solo si `primer_mensaje` ·
no repetir la apertura de sus últimas 2 respuestas · "¿algo más?" solo con `puede_cerrar` ·
acuse corto y factual ("dale", "listo") · voseo, texto plano, sin emoji ni markdown.
No puede nunca: tocar un token, cantidad, medida o unidad · escribir un `$` propio · **agregar
una pregunta que el borrador no tenía** (preguntar es afirmar que la opción existe) · nombrar
algo fuera de `hechos` · prometer plazo, stock o envío · decir "no lo tenemos" · ofrecer una
acción propia ("te paso el detalle por mail") · separar un total de su condición · fusionar
ítems.

### Kill-switch y observabilidad
`const REFINADOR = true;` en la primera línea de `Armar Prompt Refinador` — Martin lo apaga
editando una línea en la UI, sin re-importar.
`bot.decisiones` guarda `borrador` y `final`: sin eso el juez offline del confident-wrong
estaría juzgando un artefacto que el cliente nunca vio, y el drift semántico (relabelar
unitario como total, borrar una línea de degradación) es estructuralmente indetectable.
Circuit breaker: si la tasa de rechazo de las últimas N ejecuciones supera ~30%, bypass duro.
Golden set de ~10 pares (borrador, salida aceptable/rechazable) en `code-harness.js`, que
testea el prompt y el gate **sin llamar al LLM** — es lo que convierte la migración del 16-oct
en "cambiar un campo y correr el harness" en vez de otra ronda.

### Ronda 3 — A/B contra sí misma
Replay mínimo de suite-5 (4, 5, 7, 11, 13, 14, 20, 21, 22, 25, 26) + suite-6, corrido **dos
veces sobre la misma conversación**: una con `REFINADOR=false`, otra con `true`. Toda
diferencia es 100% atribuible al refinador. Cierre:
`select notas from bot.decisiones where notas like '%refinador:%'`. Si el rechazo supera ~5%,
bajar temperature (arrancar en 0,4).

### Costo, para que quede escrito
El refinador es el **0,55%** del costo del mensaje que decora (1,62% con 3.1-flash-lite). El
LLM es el 2% del costo del bot; el 98% es el conteo de mensajes. **No ahorra ni suma mensajes
de primer orden.** Lo que se paga es latencia: +1,2 s p50 sobre ~6,6 s (**+18%**), 100% visible.

---

## 7. Decisiones para Martin

1. **Cuantización de packs — choca con la regla resuelta 140.** "Próximo tier hacia arriba"
   sobre-cotiza: 150 tarjetas simple faz → $28.000 (tier 500) contra $24.000 (2×100);
   folletos ilustración 1500 → $223.000 contra $186.000 (**20%**). Y la banda no es uniforme:
   en DF Encapsuladas a 501-600 el tier de 1000 **sí** gana. Opciones: (a) mantener la regla
   tal como está; (b) `mejorCobertura()` sobre combinaciones de hasta 2 packs, el más barato
   primero y el tier de arriba como upsell con la diferencia explícita; (c) preguntárselo a TG
   antes de tocar nada.
2. **Confirmar el orden de entrega** E1 → E2 → E3 → E4 (el consejo dio vuelta el de v1).
3. **Gemelos 75/106 como un solo producto con el gramaje de eje** (igual que la limpieza v10.8
   hizo con el color): más limpio y ahorra 4 líneas de menú, pero es curación grande. ¿Entra en
   R7 o queda para después?

## 8. Preguntas a TG

Numeración corregida: **se borra la 50** (ya respondida en la línea 138) y **la 49 se fusiona
con la 4**, que sigue abierta. Nuevas:

- **48. Papel por defecto.** "Quiero imprimir unos apuntes" sin más datos: ¿en qué papel sale,
  75 o 106? ¿Simple faz?
- **51. Color.** Si no dice si es color o b/n, ¿preguntan siempre o asumen b/n?
- **52. Servicios de taller** (la que más plata desbloquea). Encuadernado, refilado, abrochado,
  emblocado, numerado, anillado: el precio cargado ¿es por trabajo terminado o por hoja? Lo
  pregunto porque en el sistema todos tienen "Hoja" como unidad.
- **53. Anillado.** ¿Cómo eligen el anillo en el mostrador? ¿Por cantidad de hojas? Pasame la
  referencia (hasta cuántas hojas entra cada medida). Y el precio, ¿es uno por trabajo?
- **54. Packs de tarjetas.** Para 150: ¿2 packs de 100 o el de 500? ¿Cobran extra por hacer dos
  packs? Arriba de 1000, ¿siguen sumando o lo cotizan aparte?
- **55. Promo inmobiliarias.** Llevando 7 u 8, ¿los que pasan de 6 van a $15.000 o vuelven a
  $19.500? ¿La promo es solo para inmobiliarias?
- **56. Talonarios.** "Rifas 100 números": ¿el precio es por talonario o por rifa?
- **57. Tacos.** Cuando alguien pide "un taco", ¿qué preguntan primero, el tamaño o el color?
- **58. Carteles corrugado.** El de 1×0,65 a $19.500, ¿se vende suelto o solo dentro de la
  promo? Las medidas 1×1 / 2×1 / a3, ¿son fijas o cortan a medida?

**Defaults que la lente de dominio considera defendibles sin TG** (a loguear con la reversión
del §0): default de **línea** (documento → Riso, no láser: las 8 variantes Riso son las únicas
con escalera de cantidad), de **faz** (simple) y de **tamaño** (A4). **No hay default de
color**: equivocarlo sub-cotiza 4×. Y **b/n implica Riso siempre** — el rubro láser se llama
"Impresiones láser color" y no tiene ningún precio b/n; mandar un b/n al láser cobra $750 la
hoja contra $100.
