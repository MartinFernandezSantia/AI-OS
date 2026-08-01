# v8.2 — La ronda completa: 20 incidentes, 3 lentes, una causa raíz

> Ronda real de WhatsApp del **2026-07-27** sobre `faq-bot-v8` (post los 5 fixes del 27).
> Diagnóstico por tres lentes en paralelo (plata / resolución determinística / voz de mostrador).
> Estado del contraste: pasada adversarial de 2 lentes sobre la **única** decisión de dirección
> (§5). Fable está fuera; el contraste corre por consejo Opus.

---

## 0. El titular

**El mensaje 1 fue el único de la tanda A que salió limpio** ($8.800, "(100 hojas)", "por hoja" —
el paquete E0+v8.1 hizo exactamente lo que prometía). De ahí en adelante, **cuatro cotizaciones
con número equivocado dicho con confianza**, y todas por el mismo defecto estructural.

| | cantidad | cuánto duele |
|---|---|---|
| **Plata** | 6 | 4 confident-wrong: 1,42× · 1,25× · 1,76× · hasta 100× |
| **Resolución** | 7 | 2 silencios sin telemetría, 1 producto inventado por el formato del menú |
| **Voz** | 7 | el aviso de canal salió 4 veces, y el bot prometió mail donde ya tenía el precio |

---

## 1. La causa raíz única de los 4 confident-wrong

Los guards de `Armar Respuesta Precio` son todos **detectores de contradicción**: el cliente dijo
X y la fila dice no-X (gramaje `:209`, dorso `:187`, faz inversa `:216`, papel especial `:200`,
nicho `:222`). **No existe ningún detector de ausencia.**

El único código consciente de la ausencia es el guard de ancla (`:497-527`), y su compuerta es:

```js
const hayCompetencia = (main.descartados && main.descartados.length > 0) || main.filas > 1;
```

O sea el **rowcount del SQL** — que es *posterior* a la elección del LLM. Cuando el LLM
sobre-especifica y emite el nombre canónico exacto, el SQL devuelve 1 fila, `descartados` queda
vacío, `hayCompetencia=false` y **la puerta se apaga exactamente cuando el LLM inventó con
confianza.** Cuanto más seguro está el LLM, más callado está el guard.

El corolario perverso, medido: **el bot es más seguro cuando el LLM es más vago.** Si en el kraft
hubiera emitido el sinónimo `"papel kraft"`, el de 300 gr entraba por rank 2, el filtro lo tiraba
a `descartados` y la puerta disparaba. Emitió `Papel Kraft 130 Gr` y nadie dijo nada.

Dos agravantes del mismo guard: la ventana es de **un solo turno** (`:511` usa
`decidir.userMessage`, mientras los otros guards usan los últimos 3 mensajes), y `EJES_CLIENTE`
(`:61`) **no incluye `medida`** (el diámetro del anillo), ni `plazo`, ni `pack_unidades`.

Y hay un dato curado, verificado, que llega hasta ARP y **ningún nodo lee**:
`default_familia:true` en IMPRESIONES (obra 75) y `default_variante:true` en OBRA 75 GR S/F b/n
(`db/curacion-e0-2026-07-26.sql:255` y `:268`). Grep sobre los 17 nodos Code: **0 hits**. Y
`get-cat-logo.json:3` no proyecta `atributos`, así que el LLM tampoco los ve. Es exactamente el
dato que resolvía *"el papel no sé, normal"*.

---

## 2. Plata — 6 incidentes

| id | mensaje | salió | correcto | veredicto |
|---|---|---|---|---|
| **A1** | "un anillado para 120 hojas" | $3.400 (metálico, 1") | $2.400 | **confident-wrong 1,42×** |
| **A2** | "papel kraft a4?" | $800 (130 gr) | preguntar 130/300 ($800/$1.000) | **confident-wrong 1,25×** |
| **A3** | "100 hojas" → "b/n, el papel no sé, normal" | $17.600 (obra 106, **doble faz**) | $10.000 (obra 75 s/f) | **confident-wrong 1,76×** |
| **A4** | "papel ilustración para 500 folletos" | $66.000 (brillo 150) | el número es correcto | anclaje al techo (piso $12.000) |
| **A5** | "300 rifas" | tabla "…$6.000,00 **c/u**" | es el **total** del tramo | **confident-wrong hasta 100×** |
| **A6** | "un cartel de 1x0.65" | nombró la promo de inmobiliarias | no debía existir para él | fuga de precio condicionado |

**A1-A3** son la causa raíz de §1: el LLM eligió ejes que el cliente nunca nombró (A1: material
*y* medida de anillo; A2: gramaje; A3: gramaje *y* faz). Lo que **sí** funcionó en A1: el
`noMultiplica` de `unidad_venta='trabajo'` mató el total. La regla del sustantivo de v8 aguantó.

**A4 no es confident-wrong** — dentro de folletos, "ilustración" determina unívocamente brillo 150
(no hay folleto ilustración mate). El defecto es de anclaje: el bot dio el techo de la familia sin
decir que folletos arranca en $12.000 (obra 75 b/n x500). Es cobertura de menú, no guard.

**A5 es el hallazgo nuevo, y el peor por magnitud.** Verificado contra el export: `Talonarios
Rifas 100 numeros`, `unidad` cruda = `"Hoja"`, curado `unidad_venta='pack'`, `pack_unidades=100`.
La escalera **sube** con la cantidad ($6.000 → $8.000 → $10.000 → $14.000 → $29.000 → $32.000):
un precio unitario nunca sube por volumen, así que **`value` es el total del tramo**, no un
unitario. La rama `ok_rangos` (`:383`) hardcodea `' c/u'` — es la única rama que no recibió el fix
de unidad de `78b379d` — y el encabezado (`:378`) usa `row.unidad` (la columna cruda del
mostrador, `"Hoja"`). **Tres unidades distintas en un mismo mensaje y ninguna correcta.** Si el
cliente lee "100 a 101: $6.000 c/u" literalmente, 100 rifas = $600.000.
Los rangos rotos ("100 a 101" en vez de "100 a 249") son un espejo fiel del dato: `maxQty =
minQty + 1` en la base. Eso es display, no plata — pero `:169` acepta escaleras **con huecos**
(102..249 sin cubrir) sin validar cobertura, y las publica como si fueran una tabla completa.

**A6 tiene dos mitades.** El guard de nicho funciona en la pasada 1 (`:222-225`) y en el rescate
de menú (`:450`), pero (a) los candidatos que se le pasan al Aclarador **no** están filtrados
(`:560-568` itera `main.rows` crudo) y `armar-prompt-aclarador.js:16` le entrega el catálogo
cotizable completo; y (b) la rama `SEGUNDA_PASADA` (`armar-respuesta-precio-2.js:390-396`)
**precede** al bloque `REPREGUNTA`, se traga los fallbacks de nicho y bajo-mínimo, y **nombra el
producto**. El guard evita el número y filtra la existencia y los términos de la promo, que es
justo lo que no debía pasar. Para la mitad (b) del mensaje 5: `get-opciones.json:3` no selecciona
`atributos`, así que el menú **no puede** saber el `min_unidades` — grep de `min_unidades` fuera
de ARP: 0 hits. Y `armar-menu-opciones.js:21` quedó atrás: su lista `NICHOS` tiene sólo medicina y
filtra por **regex sobre el nombre**, no por el atributo curado.

---

## 3. Resolución — 7 incidentes

**R1 · "necesito anillar 3 apuntes" → silencio.** El noop lo emitió **el LLM**, por el `repeatNote`
(`armar-mensajes-llm.js:44-47`), que dice *"…y el cliente no sumó una pregunta ni un dato nuevo"*.
"3 apuntes" **es** un dato nuevo: el modelo se saltó la segunda mitad de una regla conjuntiva.
No es B.7 funcionando como fue diseñado. Lo que falta es la red: **no hay ningún guard
determinístico que bloquee `noop` cuando el mensaje del cliente trae un número, una cantidad o un
signo de pregunta.**

**R2 · "Hola?" → silencio sin motivo.** Mismo agujero visto de otro lado. Hay **tres orígenes
indistinguibles** de noop (el LLM lo emite `parsear-respuesta.js:70`; `answer` con reply vacío
degrada a noop `:83-85`; el anti-loop `:119`) y **ninguno se loguea**. El bot tiene **cuatro
finales mudos** — `Descartar (debounce/dup)`, `Silencio Repetición`, `Silencio Tier-2`,
`Descartar Firewall (drop)` — y ninguno escribe una fila: `Log Turno` cuelga sólo de
`Enviar Mensaje`. Todo lo que el bot decide **no** contestar es invisible.
*Riesgo latente encontrado de paso:* `decidir.js:9-16` (`num()`) acepta unix-segundos, string e
ISO y **no normaliza la unidad**; si el webhook y el historial vinieran en escalas distintas, todo
mensaje quedaría `ya-respondido` para siempre.

**R3 · el producto inventado por concatenación.** Tres saltos, todos verificados:
1. `armar-menu-opciones.js:81-84` emite `familia:` + viñetas de variante. Visualmente es **una**
   etiqueta; nada distingue familia de variante.
2. El `Prompt Cotizador` regla 2 exige mapear *"a la línea EXACTA del último mensaje del
   historial"* — pero el historial que ve el LLM lo arma `decidir.js:113-121` desde **Chatwoot**,
   o sea el texto **ya reescrito por el compositor**, al que `armar-prompt-compositor.js:101-102`
   le ordena deshacer las listas. **El contrato "verbatim" está roto por construcción desde v8.**
3. `get-precio.json` rank 2 pregunta si *el nombre real contiene lo que tipeó el LLM*; con un
   string fusionado y largo siempre da falso, y **no existe la dirección contraria**.
El flag `producto_inventado` (`parsear-respuesta.js:139-150`) es **sólo telemetría**: el turno
igual va a buscar a la base un nombre que ya se sabe inexistente.
Dato para el arreglo: `armar-menu-opciones.js:89` **ya persiste los nombres canónicos del menú**
en `bot.decisiones.notas` (`'menu: A / B / C'`). El material para un resolvedor determinístico de
eco de menú ya está guardado; falta la query.

**R4a · menú para producto de variante única.** El colapso existe… en el otro renderer. `Armar
Respuesta Precio` (`:465-468`) tiene el colapso por grupo (fix r6-review H6b); `Armar Menu
Opciones` sólo colapsa cuando **`productos.length === 1`** (`:56-65`), así que con 3 productos
imprime cabecera + viñeta aunque el grupo tenga una sola variante y aunque la viñeta repita el
nombre de la familia. **Los dos renderers de menú divergieron.**

**R4b · `Anillado Plastico a3` con la variante llamada `A4`.** Dato del catálogo → **SQL de
Martin**. Clave natural: producto `public.products.name = 'Anillado Plastico a3'` + categoría
`Taller` (la misma que ya resolvió sin SKIPPED en `curacion-e0:2464`); variante única,
`lower(trim(name)) = 'a4'`, precio 3200. Overlay por `bot.variante_meta.display_variante`, nunca
`public.*`. **Verificar contra la base viva antes de generar el SQL**: el export es del 23-jul y
está 4 curaciones atrás.

**R5 · "Las hacemos en A4 y en Oficio" es confabulación.** Post curación de voz, `fotocopias` es
sinónimo de `IMPRESIONES`, cuyo eje es **faz × color** — no tiene eje de tamaño. El modelo
generalizó de la docena de productos vecinos que sí tienen A4/Oficio. Descartado el compositor: el
gate de dígitos (`aplicar-compositor.js:75`) habría rechazado el `4` intruso, así que **venía en
el borrador del LLM1**. Y hay un agujero estructural detrás: **la rama `answer` es la única sin
ninguna validación de mundo cerrado** — la de `parsear-respuesta` sólo corre para `precio`, la del
Aclarador sólo en la rama de precio, y el gate de nombre del compositor sólo mira tokens con
`frec <= 3`, así que `a4`/`oficio`/`a3` **quedan exentos por construcción**.

**R6 · los anti-loops están vivos y no pueden disparar.** Los 4 existen y están cableados, pero:
los 4 comparan por **igualdad exacta normalizada**, y 2 de los 4 comparan **texto escrito por un
LLM** (temp 0.3 / 0.2, con el mensaje del cliente en el input) — tres formulaciones distintas del
mismo pedido imposible dan tres textos distintos y el contador nunca llega a 2. El #3, que sí
compara una tabla fija, está **tapado por el Aclarador**: los estados que la producen son los
mismos de `TRIGGERS_ACLARADOR`, así que lo que se loguea como `borrador` es el texto del Aclarador
y nunca la repregunta fija. Y la ventana de 3 se contamina: `Get Ruta Cotizador` no filtra por
acción y `Log Escalación` no mapea `borrador`.
*Riesgo de prod:* `Log Turno` usa la credencial **`Bot Readonly DB`** con `onError: continue`. Si
ese rol fuese realmente read-only, el INSERT falla en silencio, `borradoresPrevios` queda vacío y
**los 4 anti-loops mueren de golpe**. En testing la credencial es owner; `db/c2-router-grant.sql`
sigue pendiente para prod.

---

## 4. Voz — 7 incidentes

**V1 · el aviso de canal, 4 veces.** `avisoDado` (`decidir.js:109`) es una señal **derivada por
turno**: un `includes('terminalgrafica@gmail.com')` sobre lo que devuelva `Get Historial`, que
llama a Chatwoot **sin ningún parámetro de paginación**. El "una vez por conversación" es tan
durable como la ventana que Chatwoot decida devolver. Dos apagados concretos: la ventana se llena
(mensajes de actividad y notas privadas cuentan) o la conversación es nueva tras un handoff.
**Esto contradice lo que afirma `v8-1-build.md`** ("sin estado nuevo: lo apaga el `avisoDado` que
ya existía"): sí hacía falta estado. Hay una tabla durable ya cableada por conversación
(`Get Ruta Cotizador`) donde el aviso no se guarda ni se lee.
*Bug de orden, aparte:* el CIERRE se pega en `:531` y los ítems de `mas` se concatenan **después**
(`:536-553`) — en un multi-ítem el aviso queda **en el medio del mensaje**.
*Y:* `armar-mensajes-llm.js:69` no inyecta el `avisoNote` al prompt del especialista; la ruta
cotizador nunca sabe si ya se avisó.

**V2 · "el equipo te enviará el presupuesto por mail".** Esa frase **no existe en el repo**: es
prosa del LLM. Pero el sistema se la enseña — hay 12 lugares entre prompts y plantillas que dicen
"lo cotiza el equipo" / "el presupuesto final lo confirma el equipo", y **tres de ellas están en
la lista `HEDGES` del gate**, o sea el compositor tiene **prohibido borrarlas**. La regla que lo
prohíbe existe y es tajante (`system-prompt.json` §Email y cierre) pero es **sólo prompt**: ningún
guard determinístico borra una promesa de mail de un `reply`.

**V3 · "Eso no lo tenemos en catálogo".** Dos strings, los dos en `aplicar-aclarador.js` (`:67`
rama `opciones` sin sobrevivientes, `:73` rama `nada`). El `System Prompt` **ya prohíbe** la
palabra ("nunca digas 'el catálogo', 'la lista de precios', 'el sistema'") — el prompt lo prohíbe
y el código lo escribe igual. Y el compositor no puede sacarla: tiene prohibido *"afirmar que algo
existe o no existe"* (`armar-prompt-compositor.js:111`), así que la blinda.

**V4 · la ruta handoff.** Tiene **tres entradas**, no una: la salida `handoff` del switch, el
**fallbackOutput** para cualquier `action` no reconocida, y la **salida de error** de
`Llamar LLM Respuesta` (una caída de OpenRouter escala). Y `Parsear Respuesta` usa `handoff` como
default duro en 4 lugares. La cadena: `Asignar a Humano` (POST `assignee_id: 1`) → `Label` →
`Mensaje Escalación` → `Armar Nota` → **2ª llamada LLM** → `Nota Privada` → `Log Escalación`.
El árbol funcionó bien: "impresora epson" cayó por regla 4 (producto no listado). Lo que sobra es
el destino. **`motivo` vive sólo en la columna `notas` de la fila de `Log Escalación`.**
*Efecto colateral que hay que atender ya:* `Filtro Ingreso` exige `!meta.assignee`, así que
**después de un handoff el bot queda mudo para siempre en esa conversación.**

**V5 · falta "por m²".** El dato **está** (`curacion-e0:1271`, `unidad_venta:'m2'`) y ARP lo
calcula (`cadaUno`, `:270`). El fix `78b379d` metió `cadaUno` en 4 sitios, **todos con total**
(`:348`, `:364`, `:370`, `:548`). El camino que disparó acá es **precio único sin total**
(`:351-356`) y ahí no está, ni en la plantilla forzada ni cuando se honra el template del LLM.
Agravante: la regla 4c del gate **impide el rescate** — si el compositor escribiera "por m²",
`uIntrusa='m2'` y lo rechaza. El guard fija el error en vez de dejarlo corregir.

**V6 · el menú en vez de prosa: nunca se construyó.** No hay renderer de prosa. Lo único que
volvería prosa el menú es una **sugerencia** del prompt del compositor (`:101-102`), y el gate
explícitamente **no la exige** (`aplicar-compositor.js:5-6`: *"el gate compara VALORES, no
layout"*). Si el compositor se rechaza por cualquier otra regla, sale el borrador con viñetas.

**V7 · el compositor — acá te contradigo.** El gate hace **diez** cosas, no una:

| # | regla | veredicto |
|---|---|---|
| 2 | todos los tokens `[[P1]]…[[MAIL]]`, una vez y **en el mismo orden** (anti-swap de precios) | `tokens` |
| 3 | ningún `$` ni `@` propio | `plata_o_mail` |
| 4 | **conservación de nombre** — no puede aparecer un token distintivo de otro producto real | `nombre_ajeno` |
| 5 | mismo multiset de dígitos fuera de tokens | `digitos` |
| 7 | conservación de hedge | `hedge` |
| 8 | conservación de unidad (regla 4c) | `unidad` |
| 10 | **estampado** de los montos desde el mapa de la DB | `token_residual` |

(más `off`, `ilegible`, `lexico_riesgo`, `largo`.) La única que se parece a "tokens prohibidos" es
la **#4** — la que te rompió dos veces. Tu instinto apunta a la regla correcta.
**Pero el nodo no se puede quitar sin cirugía:** es el único que hace el estampado y el único que
setea `final`, que es lo que lee `Enviar Mensaje`. Borrarlo manda `[[P1]]` literal al cliente.
Si lo que querés es "sin compositor", **el kill switch hace exactamente eso** (`const COMPOSITOR =
false` en la primera línea de `Armar Prompt Compositor`, se edita en la UI sin re-importar), y
además conserva la telemetría del veredicto — que es el instrumento para decidir.
Cuando rechaza **no se pierde nada**: sale el borrador determinístico. El costo del rechazo es voz
robótica, no correctitud.

---

## 5. La única decisión de dirección: A vs B

El incidente 8 de la auditoría propone cambiar la recuperación. Es la respuesta a A1-A4, y es lo
único acá que no es un parche.

**Propuesta A — guard de producto no anclado (determinístico, sin LLM nuevo).** `Get Precio`
devuelve además los **hermanos** (mismo grupo, difieren en un eje, precio distinto);
`hayCompetencia` se recalcula contra ese conjunto en vez del rowcount; si el cliente no ancló el
eje que los separa **y** los precios difieren más de un umbral, el bot **no dice un número**:
pregunta ese eje (el más caro primero) o cotiza el `default_variante` declarando el supuesto.

**Propuesta B — recuperación por familia + selección por LLM (lo que pediste).** `Get Precio`
resuelve la **familia**; un segundo LLM selecciona el subconjunto plausible con el historial; se
cotizan todas determinísticamente; el compositor arma el abanico con precios.

### El contraste: las dos se caen

Dos refutadores Opus, lente **plata/riesgo** y lente **costo por mensaje + voz**, cada uno con la
consigna de refutar. **Convergieron: ninguna de las dos se construye.**

**Contra A (el guard de hermanos):**
- La regla de agrupación que A reutiliza detecta **21 de 301 pares intra-familia (7%)**, y falla
  en **3 de los 4 incidentes**: anillado metálico ⟷ plástico no matchea (`comunes=2`), folletos
  brillo150 ⟷ obra75 tampoco. Peor: **el par testigo del propio plan E0** —el de 6,7× entre
  `Impresión a4 obra 106` y `OBRA 106 GR`— dejó de detectarse cuando la curación les puso `tamano`
  distinto. La curación rompió el caso que justificaba la regla y nadie lo notó.
- **50 de 83 productos** tienen menos de 3 ejes poblados: no pueden formar par nunca. Quedan
  afuera todos los Tacos, Anillados, Tarjetas, Plastificados, Carpetas, Sobres.
- El umbral de % no tiene contra qué medirse en **18 variantes con `precio_lista = 0`** ni en las
  **24 cuyo precio es una curva**.
- `default_familia` / `default_variante` existen en **1 producto y 1 variante de toda la base**:
  la rama "difieren poco → cotizá el default" no tiene dato fuera de IMPRESIONES.
- Y por costo: el guard dispararía en **92,4% de las filas visibles** (media 2,25 ejes sin anclar).
  Una pregunta = **+US$13/mes**; preguntar hasta anclar todo = **+US$31/mes**, o sea **+12% a +29%
  de la factura Meta**. En la consulta insignia ("cuánto sale imprimir 100 hojas", cero ejes
  anclados y los cuatro con hermano) o hace una pregunta y **deja tres supuestos vivos** —el bug
  sigue— o cobra **5 mensajes** para cotizar un trabajo de $100.
- Y dispara sobre el mensaje **más especificado de toda la ronda** (el 1, que ancló gramaje, papel
  y faz): queda `color` sin anclar, y el caso feliz recibe una pregunta antes del número.

**Contra B (recuperación por familia):**
- El costo en USD es ruido (**+US$0,08 a 0,23/mes**, 0,2%). Quien la refute por ahí pierde.
- Se cae por **voz**: la familia que atiende "imprimir 100 hojas" son **43 filas / 1.659 chars /
  63 líneas**. Y el gate de dígitos del compositor **rechaza** cualquier reescritura en prosa de
  un abanico (las etiquetas llevan dígitos: `150 gr`, `A3`, `1"1/2`), así que sale el borrador
  crudo con viñetas — exactamente el mensaje que marcaste "muy mal".
- **105 de 178 variantes (59%) tienen `mostrable = false`**: su número no es el precio final. La
  condición no entra cuatro veces en un WhatsApp, y el gate garantiza el hedge **una vez**, no por
  línea. El cliente se queda con el más barato y saca captura.
- Nicho y mínimos pasan de **guard determinístico** a línea de prompt del selector.
- Y duplica un nodo que ya existe: **el Aclarador ES el segundo LLM que elige de una lista
  cerrada**. Su cabecera dice por qué NO recibe la historia de la conversación —jailbreak-safety,
  decidido en el consejo del 24— y B se la devolvería.

### Lo que sobrevive: la opción C, y una medición antes

**Opción C (de la lente de plata):** la señal más barata ya está en la mano y nadie la usa —
**el string crudo del LLM contra el string crudo del cliente**. v8.1 ya loguea `producto_pedido`
sin normalizar. Regla: *si el nombre que emitió el LLM contiene un token que es valor de un eje
con plata (`130`, `metálico`, `1"`, `doble faz`, `brillo`, `150`) y ese token no aparece en la
ventana del cliente → no sale el número, sale la pregunta de ese eje.*

Por qué pasa las dos lentes donde A y B no: **no necesita familias** (funciona en los 50 productos
sin atributos), y **no dispara por ausencia sino por especificidad agregada** — el mensaje 1, que
ancló todo, no la activa; los cuatro confident-wrong sí, porque los cuatro agregaron un token que
el cliente nunca dijo.

**Pero primero se mide, no se construye.** El repo ya tiene escrito el umbral para esta clase de
decisión (`handoff` §3a: *"si más del ~15% contesta 'en color' en el turno siguiente…"*) y la
columna `senales` ya emite la señal. La ronda que acabás de correr **ya está en la base**: se
cuenta antes de tocar código. Las dos consultas están en §6.

**Sigue sin contraste:** la opción C misma. Cuando la medición diga que vale la pena, va una
pasada adversarial propia antes de construirla.

---

## 6. Qué se aplicó — y qué queda para vos

### Aplicado (código, con harness y commit por tema)

| commit | qué entró |
|---|---|
| `3203b91` | **Lote 1, plata.** La unidad de la tabla de rangos sale del atributo curado y no de `row.unidad`; una escalera **creciente** es el total del tramo y ya no dice "c/u"; los tramos `[n, n+1]` se rotulan como puntos; el precio único **sin total** dice la unidad (la lona, "por m²"); los extras del campo `mas` usan **su** unidad y no la del ítem principal; la 2ª pasada no nombra lo que el guard de nicho bloqueó y usa la repregunta correcta; los candidatos del Aclarador respetan el guard de nicho |
| `eb2db16` | Fuera **"no lo tenemos en catálogo"** (los 2 strings del Aclarador) · el menú **colapsa la opción única** (H6b portado desde ARP) |
| `b4f2d67` | El **aviso de canal** se cruza contra `bot.decisiones` (durable por conversación) en vez de depender de la ventana sin paginar de Chatwoot · y va al **final** del multi-ítem |
| `aec42f5` | **Fuera la ruta handoff a un humano.** Caen 4 nodos (68 → 64); las 3 entradas van a `Label Escalación`; `Mensaje Escalación → Log Escalación` conserva `motivo`; el texto pasa a mail + tel + local + horario |
| `6e9100d` | **`Log Silencio`** (64 → 65): el noop deja fila y dice su origen (`llm` / `reply-vacio` / `anti-loop`), y el descarte por debounce deja su `reason` |

**Verificación:** `node tests/code-harness.js` **186/186** (14 casos nuevos: W0-W8) · gemelo
`Armar Respuesta Precio 2` en sync · `node tests/validate-v8-import.js` **0 errores**, con dos
invariantes nuevos (que los 4 nodos de handoff **no vuelvan**, y que `Log Silencio` no cuente como
segundo log del turno).

### Lo que NO se hizo, a propósito

- **La validación de cobertura de la escalera** (los huecos entre 102 y 249). Una escala discreta
  es legítimamente no contigua, así que rechazarla dejaría al cliente sin nada; y un hueco hoy ya
  degrada a la tabla, que es la dirección segura. **No es un bug de plata.** Queda como pregunta
  a TG: *¿la escala de rifas es el precio total de esa cantidad o el precio por talonario?*
- **El guard que bloquea el noop cuando el cliente suma un dato** (el de "necesito anillar 3
  apuntes"). Es la red que falta, pero rozarlo mal desanda tu decisión del 24 — el silencio ante
  una pregunta ya respondida es deseado y ahorra un mensaje pago. Necesita su propia pasada.
- **Nada de la opción C.** Se mide primero (abajo).

### Para vos — dos consultas de sólo lectura, antes de tocar nada más

```sql
-- 1. ¿El LLM agrega especificidad que el cliente nunca dio? (la población de la opción C)
select mensaje_cliente,
       senales->>'producto_pedido' as pidio_el_llm,
       producto_resuelto,
       senales->'sin_anclar'       as ejes_no_dichos,
       senales->'descartados'      as se_descarto,
       senales->>'puerta'          as puerta,
       final
  from bot.decisiones
 where accion = 'informo_precio'
   and jsonb_array_length(coalesce(senales->'anclados', '[]')) = 0
 order by created_at desc limit 50;

-- 2. Salud del compositor: si los rechazos pasan ~30%, el kill switch y me traés los veredictos
select split_part(split_part(notas, '(compositor:', 2), ')', 1) as veredicto, count(*)
  from bot.decisiones where notas like '%(compositor:%' group by 1 order by 2 desc;
```

### Y un SQL de curación que preparo cuando me confirmes la fila

La variante de `Anillado Plastico a3` se llama **`A4`** en la base. Clave natural: producto
`public.products.name = 'Anillado Plastico a3'` + categoría `Taller` (la misma que resolvió sin
`SKIPPED` en `curacion-e0:2464`), variante única `lower(trim(name)) = 'a4'`, precio 3200. El
overlay va por `bot.variante_meta.display_variante`, nunca `public.*`. **No lo genero a ciegas:**
el export de referencia es del 23-jul y está cuatro curaciones atrás.

### Antes de la próxima ronda

1. **Desasignar la conversación de prueba** (o abrir una nueva). El handoff de la impresora epson
   puso `assignee_id: 1` y `Filtro Ingreso` exige `!meta.assignee`: **ese hilo ya no contesta.**
2. Re-importar `faq-bot-v8.json` (**65 nodos**) y volver a enganchar el error workflow.
3. `GET /webhook/refrescar-catalogo` en la URL de producción.

---

## 7. Lo que la ronda enseñó sobre el harness

El patrón del 27 se repitió, y ahora tiene nombre. **La firma del harness es
`armar(precioObj, rows, dec)`: el resultado del SQL es un input escrito por el autor del test.**
Todo caso es *"dada una resolución correcta, ¿la aritmética y el render aguantan?"*. La clase
entera **"la resolución fue mala"** queda estructuralmente afuera.

Los mocks concretos que firmaban los bugs en verde:

| caso | premisa falsa |
|---|---|
| **S6** (`:950`) | assertea que **sin competencia SQL no hay puerta** — certifica A3 como conducta correcta |
| **V8-5** (`:673`) | mismo texto que A1, pero el mock ya entrega la fila correcta ya resuelta |
| **V8-12** (`:722`) | entrega **los dos** gemelos de kraft; producción entrega el que el LLM nombró |
| **A3** (`:82`) | 4 premisas a la vez: toda escalera arranca en `minQty:1`, `unidad:'a3'` elegido para que el encabezado **no** diga unidad, sin `atributos` (⇒ `c/u` coincide por casualidad), y `unidad_venta:'pack'` **no aparece nunca en todo el harness** |
| **M2** (`:368`) | assertea la viñeta de un producto de variante única dentro de un menú de 2 |
| **L1-L5** (`:842`) | `borradoresPrevios` se inyecta a mano ya con dos strings idénticos: nunca se prueba que dos turnos reales produzcan el mismo string |
| **U1** (`:1077`) | sólo ejerce el camino **con** total; las filas de precio único "no tienen unidad curada" — desde E0 la tienen |

Y la cobertura: de 15 nodos Code el harness ejecuta 10. **`Decidir` no está en el mapa** — o sea
debounce, idempotencia, cap, `avisoDado` y `lastBotReplies` son cero-cobertura. Ningún Switch,
Filter ni SQL se ejecuta nunca.

---

## 8. Tres cosas que contradicen el handoff

1. **El mensaje 13 pedía algo que no se construyó.** El handoff esperaba precio + puerta para
   "cuánto sale imprimir 100 hojas", pero `v8-1-build.md` §5 dice explícito que la mitad que
   cotiza directo con defaults **no entró**. Que el bot preguntara era lo correcto; el bug está en
   la respuesta siguiente.
2. **El aviso de canal sí necesitaba estado nuevo.** `v8-1-build.md` afirma "sin estado nuevo: lo
   apaga el `avisoDado` que ya existía". `avisoDado` no es estado: es un `includes()` sobre una
   ventana de Chatwoot sin paginar.
3. **Los anti-loops no están restaurados en el sentido útil.** El handoff los cuenta como hallazgo
   del consejo del 26 y como verde del harness. Están cableados, pero 3 de los 4 no pueden
   disparar (§3 R6).
