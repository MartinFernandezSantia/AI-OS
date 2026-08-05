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

**AGRAVANTE — el corte relativo dropea productos débiles (Martin, 2026-08-04):** la
IDF corre sobre TODOS los tokens en una sola bolsa (un score por producto = suma de
IDF de los tokens que matchea). El corte de `Buscar Candidatos` es
`score >= 0.4 * max(score)` con `max` **global a toda la consulta**. En un pedido
multi-producto, el producto con tokens raros fija un `max` alto y **guillotina** al
producto que llegó con pocos/flojos tokens: no queda "más abajo", queda **afuera del
candidato set**. El cliente pidió 3 y desaparece 1.
**Consecuencia para el fix:** esto **invalida la opción 1** (escalar caps): meter más
tokens del producto débil no sube su score absoluto frente al máximo del fuerte, así
que el corte global igual lo mata. Solo lo resuelve la **opción 2 (búsqueda
por-producto / fan-out)**, donde cada producto tiene su propio ranking y su propio
corte. → empuja B-2 hacia la opción 2.

**Ambigüedad intra-producto → repregunta (Martin, 2026-08-04):** hoy Relevancia hace
lo contrario a repreguntar — su prompt dice "si hay varios que son la misma cosa en
distinta medida/color, elegilos a TODOS, el cliente compara" (mostrar-todo). La
propuesta de repreguntar cuando hay varias variantes válidas del mismo producto
(× cantidad de productos ambiguos) es la misma bifurcación **mostrar-todo vs
preguntar** de B-1/B-3, así que **depende de B-3**. Corolario: si se decide preguntar
ante ambigüedad, el rationale "cupo = tamaño de mensaje" se disuelve y el cupo queda
puro recall.

**Nota (baja prioridad — sin bugs observados): la cantidad la extrae el LLM.** La
`seleccion.cantidad` que usa `Calcular Montos` (para elegir tramo y multiplicar el
total) la extrae el **Agente Selector** del mensaje, no un parseo determinístico. El
guard de plata (`montosAutorizados`) **no** cubre una cantidad mal leída: el total se
autoriza calculado con esa misma cantidad, así que un total con cantidad equivocada
pasa igual (el precio unitario, que sale del SQL, siempre es correcto). Martin no
recuerda que esto haya dado bugs en la práctica; queda anotado como punto ciego
conocido, no como fix pendiente.

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

---

## B-4 · Regla: ¿mostrar varias opciones del mismo producto o repreguntar?

**Decisión de política (transversal, parte de B-3).** Estado: `abierto — a decidir,
NO ahora` (Martin, 2026-08-04).

**Qué hay que decidir:** dado un mismo producto con varias variantes válidas para lo
que pidió el cliente (distinto tamaño/color/faz/gramaje), ¿el bot **muestra todas**
para que compare, o **repregunta** para desambiguar? Hoy siempre muestra todas (el
prompt de Relevancia lo ordena; ver B-2). Falta la regla que decida caso por caso:
cuántas variantes justifican mostrar vs preguntar, qué ejes valen la repregunta,
cómo se combina con multi-producto (una repregunta por producto ambiguo vs una sola
estructurada).

**Por qué importa:** es el punto donde se cruzan legibilidad del mensaje, costo de
turnos de WhatsApp, y experiencia (una lista larga de variantes puede ser peor que
una pregunta corta, o al revés). Es el mismo eje mostrar-todo vs preguntar de B-1/B-3
pero a nivel **intra-producto**.

**Relacionado:** B-1 (repregunta del Selector), B-2 (cupo/variantes), B-3 (estructura
de diálogo — esta regla vive adentro de esa estructura).

---

## B-5 · Lista vacía a Relevancia: error de búsqueda vs no-match genuino

**Sección 7 · Buscar Candidatos → Armar Candidatos.** Estado: `abierto`.

**Observación (Martin):** identificar por qué le llegó lista vacía a Relevancia;
posible rama de fallback con acceso al catálogo si `Buscar Candidatos` falló.

**Evidencia:** `Calcular Montos` ya distingue causas de vacío en `motivoVacio`
(`busqueda_vacia`, `agente_no_eligio`, `idx_invalidos`, `confianza_baja`,
`sin_precio_publicable`, `salida_ilegible`) y las loguea. **Hueco:** no distingue
`Buscar Candidatos` **errado** (SQL falló → `onError:continue` emite item de error →
`Armar Candidatos` lo filtra) de un **no-match genuino**. Ambos colapsan en
`busqueda_vacia`. Un error de infra (reintentable) se ve igual que "no existe" (→ mail).

**Opciones:** (a) detectar el item de error de `Buscar Candidatos` y marcar
`motivoVacio='busqueda_error'` aparte; (b) rama de fallback (reintento o búsqueda
alternativa) solo para el caso error, no para el no-match.

---

## B-6 · Prompt de Relevancia: "elegí todos" enumera solo medida/color

**Sección 7 · Agente Relevancia.** Estado: `abierto — refinamiento de prompt`.

**Observación (Martin):** la regla "si hay varios que son la misma cosa en distinta
medida o color, elegilos a todos" enumera solo **medida/color** y puede sesgar al
agente a colapsar/filtrar ejes no nombrados (**faz, gramaje, acabado**).

**Dirección:** hacer la regla **agnóstica del eje** — si el cliente no especificó un
eje, mostrar todas las variantes de ese eje (no solo medida/color). Emparentado con
el incidente ya documentado (simple faz $400 vs doble faz $750: se descartó la barata
por leer mal un eje).

---

## B-7 · "La cantidad no se usa para elegir" vs packs modelados como producto

**Sección 7 · Agente Relevancia + Extraer Palabras.** Estado: `abierto — REQUIERE
verificar catálogo (dato que Claude no ve)`.

**Observación (Martin):** la regla "la cantidad no se usa para elegir, elegí por
producto y eje" puede chocar con rifas/tarjetas.

**Evidencia (parcial, desde comentarios):** `Extraer Palabras` trata `"100 Tarjetas"`
y `"1000 Tarjetas"` como **nombres canónicos distintos** (productos separados) y saca
los **números puros** de la búsqueda. Si es así: "1000 tarjetas" pierde el `1000` →
matchea igual a las dos, y el prompt le prohíbe a Relevancia usar la cantidad para
elegir → **no puede distinguirlas**. En cambio las rifas usan `pack_tiers` (tramos de
UN producto), que sí resuelve bien `Calcular Montos` por cantidad.

**Pregunta a resolver con Martin/TG (dato de catálogo):** ¿los packs se modelan como
**productos separados** ("100 Tarjetas" / "1000 Tarjetas") o como **tiers de un
producto**? Si hay productos separados por cantidad, la regla tiene un hueco real y
hay que: o unificar el modelado del catálogo, o dejar que la cantidad participe de la
selección cuando está en el nombre del producto.

---

## B-8 · `dudaNicho` es conductualmente inerte (solo telemetría)

**Sección 7 · Agente Relevancia.** Estado: `abierto — decisión`.

**Verificado (2026-08-04):** `dudaNicho` la produce Relevancia, la propaga `Calcular
Montos` y se escribe en `bot.decisiones` (Log Turno). **No la consume el Compositor.**
O sea: si el cliente pide algo de nicho (ej. medicina) y los candidatos son genéricos,
el bot **contesta igual con precios genéricos**; el flag solo queda en el log para
revisión offline.

**Decisión abierta:** ¿`dudaNicho` debería cambiar la conducta — un caveat ("esto es
genérico; para medicina confirmá por mail") o una escalación — o queda solo como
telemetría? Caso hermano de `necesitaAclaracion` (B-1) pero más leve (al menos se loguea).

---

## B-9 · Camino False (¿Hay Algo Que Decir? → mail): retry antes de escalar

**Sección 7→8 · ¿Hay Algo Que Decir?** Estado: `abierto — a arreglar` (Martin, 2026-08-04).

**Decisión de Martin:** el camino False (no hubo ni hechos ni caveats → hoy escala
directo a mail) hay que arreglarlo para que **al menos haya un retry con mayores
chances de éxito** antes de derivar a un humano. Escalar en el primer intento fallido
quema resoluciones que un segundo intento más permisivo podría cerrar.

**Casos que debería cubrir el retry** (los `motivoVacio` del camino False):
- `busqueda_vacia` (no-match): reintentar la búsqueda más amplia.
- `agente_no_eligio`: re-preguntarle a Relevancia con la lista, o aflojar su sesgo.
- `idx_invalidos` / `salida_ilegible`: reintentar el agente (falla de formato/LLM).
- `confianza_baja`: raro, pero el retry aplicaría igual.

**Levers posibles para "mayores chances"** (a definir): aflojar el corte relativo
(0.4 → más bajo), subir el cap de tokens / cupo, relajar el guard de nicho, quitar
stopwords, o re-promptear el Selector/Relevancia con más contexto. La idea es que el
2º intento sea deliberadamente más permisivo que el 1º.

**Relacionado:** B-5 (distinguir error de búsqueda vs no-match — el retry sobre un
error SQL es reintento de infra, distinto del retry sobre un no-match). Mecanismo
análogo a los loops de reintento/re-auditoría del Verificador (sección 9): ya existe
el patrón "reintentar N veces antes de rendirse" en el flow.

---

## B-10 · "Se confirma por mail" se dispara de más en cotizaciones simples

**Sección 8 · Agente Compositor.** Estado: `abierto`.

**Qué se observó (Martin, 2026-08-05):** la regla del systemMessage "si vino TOTAL
YA CALCULADO lo decís; si no vino, precio unitario + se confirma por mail" hace que
CASI TODO mensaje termine mencionando el mail, aun cuando el cliente solo pregunta el
precio de UN producto y no hace falta. Ensucia la respuesta y suena a máquina.

**Evidencia:** `agente-compositor.json` systemMessage, bloque "COTIZAS TOTALES, PERO
NO LOS CALCULAS" + bloque "EL MAIL NO ES EL CAJON DE SASTRE" (que ya intenta frenar
esto pero sigue saliendo). El mail solo debería aparecer cuando (a) falta un dato
para cerrar el número, o (b) el cliente quiere ENCARGAR. Consultar un precio unitario
no es ninguna de las dos.

**A decidir:** afinar el prompt para que el mail sea la excepción, no el default de
todo turno sin total.

---

## B-11 · "El mail no es cajón de sastre" es una regla no determinística en el prompt

**Sección 8 · Agente Compositor.** Estado: `abierto`.

**Qué se observó (Martin, 2026-08-05):** el bloque "EL MAIL NO ES EL CAJON DE SASTRE"
le pide al agente JUZGAR ("mandar a alguien al mail para algo que vos podías averiguar
es perder la venta") en vez de darle una regla clara. Eso deja lugar a interpretación
y el agente puede resolverlo distinto turno a turno.

**Relación con B-10:** son la misma tensión. B-10 es el síntoma (mail de más), B-11 es
la causa en el prompt (regla ambigua). Al reescribir, buscar reglas accionables y no
criterios de juicio ("si el cliente pidió otra medida/pack, ofrecé averiguarlo acá"
en vez de "no uses el mail de cajón de sastre").

---

## B-12 · `usoTodosLosHechos` es campo muerto — quitar

**Sección 8 · Agente Compositor.** Estado: `decidido: QUITAR` (Martin, 2026-08-05).

**Qué se observó (Martin, 2026-08-05):** el parser del Compositor recolecta
`usoTodosLosHechos` (bool) y `motivo`, pero **ningún nodo los lee** (verificado por
grep en todos los nodos) y tampoco entran en `senales` (Leer Verificador arma
`senales` a mano sin incluirlos). Se recolecta y se tira.

**Decisión de Martin:** se **quita** del parser. Para que sirviera habría que loguear
además TODOS los hechos de esa ejecución (el bool solo dice "los usé todos" o "no";
sin la lista de hechos no sabés cuál se saltó), y eso es peso muerto en el log. El
costo de hacerlo útil supera el valor. Se borra `usoTodosLosHechos` del inputSchema
del parser del Compositor (`agente-compositor.json`).

---

## B-13 · Un crash del Compositor no queda marcado como tal en el log

**Sección 8 · Leer Compositor → Leer Verificador.** Estado: `abierto`.

**Qué se observó (Martin, 2026-08-05):** si el Agente Compositor falla en sí
(`onError:continueRegularOutput` → devuelve vacío), Leer Compositor calcula
`huboCompositor = false`, pero ese campo **no llega a `senales`** (Leer Verificador no
lo mapea). Se computa y se descarta. Resultado: un crash del compositor no queda
registrado COMO crash en `bot.decisiones`; se ve como una falla río abajo (el
Verificador audita un mensaje vacío y rechaza) y se pierde la causa raíz.

**Contraste:** la recuperación SÍ se loguea bien (`senales.rescatadoPorReintento`,
`notas: RESCATADO-POR-REINTENTO` + `feedback1=...`). Lo que falta es marcar el fallo
del propio agente.

**A decidir:** propagar `huboCompositor` a `senales` (y quizá un contador de crashes)
para que las auditorías del sistema puedan identificar fallos del compositor. Es
justo el tipo de dato que Martin quiere tener limpio para diagnosticar.

---

## B-14 · Bloque "SEGUNDA AUDITORIA" del systemMessage del Verificador — redundante

**Sección 9 · Agente Verificador.** Estado: `abierto`.

**Qué se observó (Martin, 2026-08-05):** el systemMessage tiene un bloque
condicional "SI EL PEDIDO TRAE UN BLOQUE SEGUNDA AUDITORIA: ...". Pero
`Prompt Re-auditoría` YA inyecta en runtime, en la 2da vuelta, las mismas
instrucciones + el monto concreto que el auditor inventó + las opciones 1/2.

**Evaluación:** no es inútil del todo (es la mitad estática del contrato), pero
está duplicado: inerte en la 1ra auditoría (no hay bloque que dispare el
condicional), redundante en la 2da (dice lo mismo que el runtime, con menos
detalle). Fuente de verdad partida en dos.

**A decidir:** consolidar a una sola fuente. Probablemente dejar solo el bloque
de `Prompt Re-auditoría` (más específico, trae el número) y sacar el condicional
del systemMessage — o al revés, pero no ambos.

---

## B-15 · El Verificador debería puntuar la importancia de sus correcciones/fallas

**Sección 9 · Agente Verificador + Leer Verificador.** Estado: `abierto`.

**Qué se observó (Martin, 2026-08-05):** hoy toda corrección que pasa el guard de
plata se aplica, sin importar si es cosmética o de fondo. Una corrección trivial
puede además disparar el costo del loop de re-auditoría. Falta una noción de
SEVERIDAD.

**Idea de Martin:** que el auditor genere un valor de importancia para cada
cambio/falla, de modo que:
  - correcciones de poca importancia se descarten (sale el original);
  - la tolerancia después del 2do intento sea mayor (comparar el resultado del
    2do contra el 1ro y quedarse con el mejor, en vez de rechazar de nuevo).

**Nota:** el parser del Verificador YA tiene un campo `confianza` (number) que
hoy no consume nadie — punto de partida natural para esto. Encaja con B-12/B-1
(campos que se recolectan y no se usan).

**A decidir:** definir la escala, el umbral de descarte, y la política de
"quedate con el mejor de los dos intentos".

---

## B-16 · "Nunca borres una oferta por cantidad" es demasiado específico

**Sección 9 · Agente Verificador (systemMessage).** Estado: `abierto` (hermano de B-6).

**Qué se observó (Martin, 2026-08-05):** la regla está anclada al eje
cantidad/pack ("llevando N o más"). El prompt intenta generalizar ("lo mismo con
cualquier alternativa más barata o pack más grande"), pero sigue nombrando el eje
y podría no cubrir otras familias con su propia alternativa relevante (ej.
módulos de medicina).

**A decidir:** reformular axis-agnóstico: "no borres una alternativa relevante
que figure en los hechos autorizados" sin nombrar cantidad/pack. Mismo patrón que
B-6 (hacer la regla de Relevancia agnóstica al eje). Conviene resolver los dos
con el mismo criterio.

---

## B-17 · La causa de rechazo "no contesta" bloquea las repreguntas

**Sección 9 · Agente Verificador (causa d).** Estado: `abierto` — BLOQUEADO por B-1/B-3.

**Qué se observó (Martin, 2026-08-05):** el Verificador rechaza si el mensaje "no
contesta la pregunta que el cliente hizo" (causa d). Una repregunta, por
definición, NO contesta todavía la pregunta del cliente → la causa (d) la
tumbaría.

**Consecuencia:** cuando se implementen las repreguntas (B-1, dependientes de la
estructura de diálogo B-3), la causa (d) necesita una excepción explícita para
repreguntas legítimas — si no, el auditor mata toda repregunta antes de que
salga.

**Relación:** parte del paquete B-1 / B-3 / B-4 (diálogo y repreguntas). No se
toca hasta diseñar esa estructura, pero queda anotado como requisito del
Verificador dentro de ese trabajo.

---

## B-18 · Un rebote de Log Turno / Log Escalación no debe morir en silencio

**Sección 10 · Log Turno + Log Escalación.** Estado: `abierto` — estructural.

**Qué se observó (Martin, 2026-08-05):** el patrón "columna con tipo/constraint que
rebota + `onError:continueRegularOutput` = pérdida silenciosa del log" ya pasó TRES
veces: `accion` null (2026-07-28), `producto_resuelto` uuid vs texto (2026-08-05, ver
`db/decisiones-producto-resuelto-text.sql`), y el envío fallido que se logueaba como
entregado (2026-07-29, ya tapado por Chequear Envio). El fix de cada columna NO cierra
la clase de bug: el próximo cambio de schema puede volver a romper el INSERT y nadie
se entera hasta mirar WhatsApp.

**El agujero:** cuando Log Turno rebota, la ejecución sigue como si hubiera logueado.
El bot puede estar sin registrar turnos enteros y las auditorías desde `bot.decisiones`
lo dan por completo. Justo la clase de dato en el que Martin se apoya para evaluar el
bot (confident-wrong, rescates, escalaciones).

**Opciones a decidir:**
1. Que un rebote de Log Turno/Escalación deje rastro fuera de la propia tabla (una
   rama de error → Chatwoot label `log-fallido`, o un insert a `bot.errores`).
2. Smoke-test contra el SCHEMA REAL de `bot.decisiones` (no un fixture): insertar una
   fila de prueba con la forma que produce Leer Verificador y verificar que entra,
   antes de confiar en el log. Ataca la raíz (los fixtures mienten, ver
   [[tests-fixtures-mienten]]): el harness mockea el resultado del INSERT, así que un
   type mismatch con la tabla real queda afuera por construcción.
3. Las dos: la #2 lo caza en dev, la #1 lo caza en prod.

**Relación:** misma familia que el trabajo de "el log no puede mentir" (Chequear
Envio). Es la pieza que falta de ese principio: hoy protege el `final`, no el INSERT.

---

## B-19 · El mensaje de escalación está hardcodeado (no sale de bot.info_negocio)

**Sección 10 · Mensaje Escalación.** Estado: `abierto`.

**Qué se observó (Martin, 2026-08-05):** `Mensaje Escalación` manda un texto fijo con
el horario y la dirección LITERALES dentro del nodo ("...pasar por el local, Rodríguez
Peña 3865, de lunes a viernes de 8 a 20 y sábados de 9 a 13"). Con la rama info
rediseñada el 2026-08-03 —que lee todo de `bot.info_negocio`— esto quedó inconsistente:
si TG cambia el horario, se actualiza en la tabla pero este mensaje sigue con el viejo.
Y para el productizado a N imprentas, cada clon tendría que editar el JSON del nodo.

**A decidir:** componer este mensaje desde `bot.info_negocio` (direccion + horarios +
contacto) en vez de hardcodearlo. Coherente con la decisión de raíz de la rama info
(la info del negocio vive en la tabla, no en el flow).
