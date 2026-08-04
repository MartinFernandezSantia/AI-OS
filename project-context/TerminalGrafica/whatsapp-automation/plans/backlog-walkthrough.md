# Backlog del walkthrough de propiedad (2026-08)

> Cambios/ideas que surgen mientras Martin y Claude recorren el workflow nodo por
> nodo. **NO se aplican en el momento** (decisión de Martin): se registran acá y se
> aplican al terminar el recorrido, decidiendo prioridad con el mapa completo en la
> mano. Cada item: qué se observó, la evidencia en el código, y las opciones.

Estado: `abierto` / `decidido` / `aplicado` / `descartado`.

---

## B-1 · La aclaración del Selector se descarta (rama de aclaración inexistente)

**Sección 7 · Agente Selector.** Estado: `decidido: SÍ hacer repreguntas, pero
bloqueado por B-3` (Martin, 2026-08-04).

**Decisión de Martin:** las repreguntas **se van a hacer**. Pero no se diseñan de
forma aislada acá: requieren definir **en qué momento de la conversación se hacen y
cómo** — o sea una **estructura de diálogo** que guíe la conversación (ver B-3). La
rama de aclaración del Selector es un caso particular de ese problema más grande, así
que se pospone hasta tener esa estructura decidida. Descartada la opción 2 (borrar
los campos muertos): no se borran porque se van a usar.

**Observación (Martin):** si el Selector necesita aclaración, ¿no deberíamos derivar
a una rama que valide qué quiere preguntar y arme el mensaje? ¿O al menos saltearnos
el camino actual (Buscar/Relevancia/Montos) hasta el compositor/verificador?

**Evidencia (verificado en el código):**
- El Selector emite `necesitaAclaracion: true` + `pregunta` cuando no entiende (su
  prompt dice "preferir preguntar antes que adivinar").
- `Leer Selector` los copia a `seleccion.necesitaAclaracion` / `seleccion.pregunta`.
- **Ningún nodo posterior los lee.** `Extraer Palabras`, `Buscar Candidatos`,
  `Armar Candidatos`, `Calcular Montos` no consultan esos campos. Son **campos
  muertos**: la pregunta que el Selector quería hacer nunca llega al cliente.
- Qué pasa hoy con un pedido inentendible: `terminos` vacío → `Extraer Palabras`
  igual tokeniza el mensaje crudo del cliente → `Buscar Candidatos` corre igual. Si
  no encuentra nada → `hayAlgoQueDecir=false` → **escala a mail**. O sea: una duda
  que una repregunta corta resolvería, se convierte en una derivación a humano.

**Tensión con una decisión previa:** el 2026-07-27 Martin decidió que el bot **NUNCA
repregunta para desambiguar** — muestra todas las opciones de una (el mensaje de
WhatsApp es el costo dominante). Eso resuelve el caso **ambigüedad** (cliente dice
"tarjetas", hay 3 tipos → mostrar las 3). Pero NO cubre el caso **inentendible**
(el Selector no puede mapear nada), que hoy va a mail.

**Opciones a decidir:**
1. Rama de aclaración acotada: si `necesitaAclaracion` y no hay candidatos, mandar
   UNA repregunta corta (la `pregunta` del Selector) en vez de escalar a mail.
   Cortocircuita antes de Relevancia (ahorra esa llamada LLM).
2. Dejarlo como está (todo lo no resuelto → mail) y **borrar los campos muertos**
   `necesitaAclaracion`/`pregunta` para que el código no mienta sobre lo que hace.
3. Híbrido: distinguir ambigüedad (mostrar todo, como hoy) de inentendible (repreguntar).

**Nota de eficiencia (sub-punto de Martin):** aun sin rama nueva, cuando el Selector
ya sabe que no puede resolver, hoy igual corren `Buscar Candidatos` + `Agente
Relevancia` (una llamada LLM) para terminar escalando. Se puede cortar antes.

---

## B-2 · Pedido multi-producto: términos aplanados en una sola búsqueda

**Sección 7 · Selector → Extraer Palabras → Buscar Candidatos.** Estado: `abierto`.

**Observación (Martin):** si el cliente pidió varios productos, ¿qué va en
`productos[]`? ¿`terminos[]` se sigue usando? Si sí, ¿por qué no expandir el máximo
de palabras identificadoras × cantidad de productos?

**Evidencia (verificado en el código):**
- `Leer Selector`: arma `precio.producto = terminos.join(' ')` y `opciones.productos
  = productos[]`.
- `Extraer Palabras`: tokeniza `producto + variante + productos.join(' ')` TODO
  JUNTO en una sola bolsa `palabras`, con **cap de 12 tokens**.
- `Buscar Candidatos`: recibe esa única bolsa `$1`, hace UN ranking IDF y devuelve
  UNA lista de productos (cupo 8).
- O sea: `terminos` y `productos` **se usan los dos, pero fusionados** en una sola
  búsqueda. No hay búsqueda por-producto.

**El problema que ve Martin es real:** un pedido de 3 productos se mete en 12 tokens
(~4 por producto) y compite por 8 lugares en un solo ranking. Los productos **se
diluyen entre sí**; los caps fijos (6 términos, 12 tokens, cupo 8) no escalan con la
cantidad de productos. Emparentado con la limitación ya documentada en `Calcular
Montos`: hay un solo `seleccion.cantidad`, así que múltiples cantidades también se
pierden (caso "100 y 1000 rifas en el mismo mensaje").

**Opciones a decidir:**
1. Barato: escalar los caps (términos / 12 tokens / cupo 8) por `productos.length`.
   Mantiene una sola búsqueda; alivia la dilución sin rediseño.
   **→ dirección preferida de Martin (2026-08-04) para el cap de tokens: ligarlo a
   la cantidad de productos que detectó el Selector, no dejarlo fijo en 12.**
2. Correcto: búsqueda **por-producto** (fan-out): un search por cada item de
   `productos[]`, y unir resultados. Resuelve dilución y la cantidad-por-producto,
   pero es un cambio de arquitectura (loop/multiplicidad en la rama precio).
3. Medir primero: ¿cuántos pedidos reales son multi-producto? Si son raros, quizás
   la opción 1 alcanza.

**Precisión sobre el cupo de 8 (verificado 2026-08-04, punto de Martin):** el
`limit 8` de `Buscar Candidatos` es a nivel **producto**; después el join a
`bot.variantes` devuelve una fila **por variante**, así que `Armar Candidatos` le
pasa a Relevancia N candidatos (N ≥ 8, puede ser 20+). Relevancia elige un
subconjunto. O sea: **el 8 NO es lo que ve el cliente** — el largo del mensaje lo
decide Relevancia, no el cupo. El comentario del código ata el 8 a "mensaje legible"
pero eso mide en la etapa equivocada. **Rol real del cupo = recall** (cuántos
productos puede considerar Relevancia), no tamaño de mensaje.

**Ambigüedad intra-producto → repregunta (Martin, 2026-08-04):** hoy Relevancia hace
lo contrario a repreguntar — su prompt dice "si hay varios que son la misma cosa en
distinta medida/color, elegilos a TODOS, el cliente compara" (mostrar-todo). La
propuesta de repreguntar cuando hay varias variantes válidas del mismo producto
(× cantidad de productos ambiguos) es la misma bifurcación **mostrar-todo vs
preguntar** de B-1/B-3, así que **depende de B-3**. Corolario: si se decide preguntar
ante ambigüedad, el rationale "cupo = tamaño de mensaje" se disuelve y el cupo queda
puro recall.

---

## B-3 · Estructura de diálogo para guiar la conversación (parent de B-1)

**Transversal (no es un nodo).** Estado: `abierto — necesidad identificada`.

**Origen (Martin, 2026-08-04):** para poder repreguntar (B-1) hace falta antes
decidir **cuándo** el bot pregunta y **cómo** — el bot hoy es reactivo turno-a-turno
y no tiene un modelo de "en qué punto de la conversación estamos". Sin esa estructura,
agregar repreguntas sueltas genera diálogos incoherentes.

**Qué habría que definir (a futuro):** estados/momentos de una conversación (p. ej.
descubrir → aclarar → cotizar → cerrar), qué gatilla una repregunta vs mostrar
opciones vs escalar, cuántas repreguntas se toleran antes de derivar, y cómo se
recuerda lo ya preguntado. Es diseño de conversación, no un fix de nodo.

**Depende de esto:** B-1 (rama de aclaración del Selector).
