# Casos conversacionales — herramienta interna, NO van al Excel

Estos casos no son del cliente: son nuestra checklist para probar el COMPORTAMIENTO del bot
(repregunta, no-inventar, derivación) en vez de la aritmética, que ya cubren los 93+37 casos
de la hoja `Casos de prueba`. Se corren a mano contra el chat de prueba de n8n
(`https://n8n.terminalgrafica.cloud`) y se auditan leyendo la ejecución con el MCP
(`get_workflow_execution` / `search_workflow_executions`) — nunca deduciendo qué pasó.

Contrato de referencia (ver `plans/system-prompt-v1.md` completo): el modelo declara QUÉ
cotizar en `cotizaciones[]` (material exacto de `buscar_catalogo`, ancho/alto de una pieza,
cantidad) y escribe `{P1}`, `{P2}`… en `respuesta`; el nodo Code calcula. Un solo material
BASE por colección si el cliente no pide una opción especial. Máximo 2 preguntas en una
repregunta, sin "¿algo más?" pegado. Todo lo que no es cotizar/preguntar va por mail
(`terminalgrafica@gmail.com`). Única negación permitida: fotocopias.

**Cómo correr un caso**: escribir el mensaje en el chat de n8n, abrir la ejecución en el MCP,
mirar (a) la salida del nodo Agente (`cotizaciones`, `respuesta` cruda con los `{Pn}`), (b) el
nodo Auditar Cotización (`auditoria.hallazgos`, `auditoria.cotizaciones[].estado`), y (c) el
mensaje final del nodo Responder. Un caso está en VERDE solo si las tres capas coinciden con
lo esperado — no alcanza con que el texto final "suene bien".

---

## 1. Repregunta correcta

El cliente nombra un tipo de trabajo sin dar medida y/o cantidad. El bot necesita
producto + medida + cantidad para cotizar (el material no es obligatorio: sin pedido
especial va la base).

| # | Mensaje | Qué debe hacer | Qué es fallo | Por qué importa |
|---|---|---|---|---|
| 1.1 | `necesito stickers` | Preguntar SOLO medida y cantidad (2 preguntas máx), sin listar materiales/opciones. Termina en la pregunta. | Lista alternativas de "Stickers con forma" sin que se las pidan; agrega "¿algo más?"; pregunta el material también (3 datos en vez de 2). | Es el caso más común del chat real — el cliente escribe corto. |
| 1.2 | `quiero unas tarjetas` | Pregunta cantidad (100/500/1000 — cantidad cerrada) y, si hace falta, cuál variante; sin ofrecer un menú completo de las 14. | Enumera las 14 variantes de tarjetas antes de que el cliente pida algo especial. | Colección con más variantes del catálogo: la tentación de "mostrar todo" es máxima acá. |
| 1.3 | `cuánto sale una lona` | Pregunta medida (ancho×alto) y cantidad; NO asume una medida de las de referencia sin preguntar. | Cotiza directo con una medida inventada (30x1m no está confirmada); dispara `{P1}` sin haber preguntado. | Lona es m², cualquier medida es válida — no hay "la" medida por default. |
| 1.4 | `250 stickers` (sin medida) | Pregunta SOLO la medida (ya tiene cantidad). Una sola pregunta, no dos. | Repregunta también la cantidad que ya dio; agrega saludo/cierre extra. | Prueba que el bot no repite lo que ya sabe. |
| 1.5 | `necesito imprimir unas hojas para repartir` | Pregunta qué tipo (A6 volantes vs A4 impresión) + medida/cantidad si falta — máx 2 preguntas totales, no una cadena de 3+. | Se traba pidiendo 3 datos en 3 mensajes distintos en vez de agrupar en máx 2 preguntas por turno. | "Volantes" vs "Impresión digital" son colecciones distintas con el mismo pedido ambiguo. |

Mirar en la ejecución: que NO haya sub-run de `buscar_catalogo` con resultado usado para
cotizar (o que si lo hay, `cotizaciones` venga `[]`); que `respuesta` no tenga ningún `{Pn}`;
que el mensaje termine en `?`.

---

## 2. Sugerencia debida (un solo precio, material BASE)

Cuando el cliente no especifica material, cotiza el BASE de la colección y un solo precio.
Nunca abre abanico — es justo lo que el cliente TG rechazó del bot anterior.

| # | Mensaje | Qué debe hacer | Qué es fallo | Por qué importa |
|---|---|---|---|---|
| 2.1 | `100 stickers de 5x5` | Cotiza SOLO `Papel autoadhesivo troquelado o medio corte` (la base de "Stickers con forma"), un `{P1}`. | Menciona también OPP brillo/holográfico "por si te interesa"; dos marcadores. | Caso de manual: el pedido original que armó todo este rediseño. |
| 2.2 | `100 tarjetas de 9x5` | Cotiza SOLO `Tarjetas 9x5 simple faz x100` (base de "Tarjetas personales"). | Pregunta "¿simple o doble faz, con o sin plastificar?" cuando el cliente no pidió una opción — la base ya resuelve. | 14 variantes en la colección: la ambigüedad tienta a preguntar de más. |
| 2.3 | `un cartel para la vidriera de 1x1` | Cotiza SOLO `Vinilo y lona UV` (base de "Carteles y vidrieras"), no el rígido ni el microperforado. | Ofrece "también podés en rígido, que es más durable" sin que lo pidan. | La descripción del producto MENCIONA alternativas ("también hay microperforado…") — tentación de repetirlas. |
| 2.4 | `necesito una carpeta institucional para el estudio` | Cotiza SOLO `Carpetas institucionales sin laminar` (no hay columna "Material base" en Colecciones para Papelería comercial — usa el único material del producto pedido, no ofrece la laminada). | Cotiza las dos versiones (con y sin laminar) a la vez. | Colección sin `Material base` explícito: probar que igual converge a UN material. |
| 2.5 | `100 stickers en OPP` (pide material explícito, sin decir "troquelado" ni "sin cortar") | Cotiza el OPP brillo TROQUELADO (la variante que vende la colección "Stickers con forma" por default cuando piden forma), no la plancha sin cortar. | Cotiza "OPP brillo" (sin troquelar) porque matcheó el nombre más corto. | El nombre corto matchea DOS materiales (troquelado y sin cortar); ambigüedad real del catálogo. |

Mirar en la ejecución: `cotizaciones` tiene exactamente 1 entrada; `auditoria.hallazgos` vacío;
el material en `cotizaciones[0].material_catalogo` es el BASE esperado (columna `Material
base` de Colecciones, o el único material de ese producto).

---

## 3. Varios productos en un mensaje

Cada uno es un trabajo aparte: mínimo y redondeo por separado, marcadores en el mismo orden.

| # | Mensaje | Qué debe hacer | Qué es fallo | Por qué importa |
|---|---|---|---|---|
| 3.1 | `necesito 250 stickers 3x3 y una lona de 2x1` | `cotizaciones` con 2 entradas (stickers primero, lona segunda); mensaje con `{P1}` y `{P2}` en ese orden; $6.600 + $32.000 por separado. | Suma los dos en un solo `{P1}`; invierte el orden mensaje↔declaración. | Caso explícito del pedido de Martín — familia entera sin cobertura hoy. |
| 3.2 | `100 tarjetas y 50 volantes` | 2 cotizaciones, cada una con SU mínimo/redondeo (tarjetas no tiene mínimo propio si son paquete cerrado; volantes tampoco, paquete de 500 — ver que 50 volantes NO es múltiplo de 500 → esa cotización debe derivar sin tumbar la de tarjetas). | Si una de las dos no cotiza, el mensaje ENTERO deriva (correcto) — el fallo sería que muestre un precio parcial con el otro roto, o que derive las dos cuando solo una falla. | Mezcla un caso que cotiza con uno que debe derivar: prueba el comportamiento de "todo o nada" del Responder. |
| 3.3 | `2 lonas de 1x1 y 1 banner roll-up` | 2 cotizaciones, colecciones distintas ("Banners y lonas" + "Gran formato y cartelería"). | Fusiona en un solo pedido con una sola búsqueda. | Dos colecciones distintas en el mismo turno — prueba que hace 2 búsquedas, no 1. |
| 3.4 | `necesito targetas doble faz, tambien una carpeta institucional laminada y unos volantes` (3 productos, con error de tipeo) | 3 cotizaciones en orden, cada búsqueda por su cuenta pese al typo "targetas". | Ignora uno de los tres pedidos; el typo hace que no encuentre tarjetas. | Volumen (3, no 2) + tolerancia a errores de tipeo reales de WhatsApp. |

Mirar en la ejecución: cantidad de sub-runs de `buscar_catalogo` = cantidad de productos
distintos pedidos; `cotizaciones.length` = cantidad de marcadores `{Pn}` en `respuesta`;
orden de `cotizaciones` calza con el orden de aparición de los marcadores en el texto.

---

## 4. No inventar

Nunca "no lo hacemos" (salvo fotocopias). Nunca un dato de catálogo que la tool no devolvió
en ESE turno.

| # | Mensaje | Qué debe hacer | Qué es fallo | Por qué importa |
|---|---|---|---|---|
| 4.1 | `hacen tazas personalizadas?` | No está en el catálogo — decir que lo confirma por mail, SIN afirmar "no lo hacemos". | "No, no trabajamos tazas" / "no hacemos ese tipo de productos". | La única negación permitida es fotocopias; todo lo demás es "no tengo ese dato, lo confirmo". |
| 4.2 | `necesito 1000 stickers de 2x2 metros` (medida imposible: 2 metros de sticker) | No cotiza esa medida (rinde 0 o similar); deriva a consulta sin inventar un precio. | Calcula igual un total con una medida absurda. | Medida fuera de rango real, no solo fuera del pliego — probar el sentido común del modelo. |
| 4.3 | `hacen fotocopias?` | Única negación permitida: puede decir que no se trabaja fotocopias. | Igual, pero AGREGA que tampoco hacen impresión — confunde fotocopia con impresión digital (que sí existe). | Ver que la excepción no se generaliza a "servicios de reproducción" en general. |
| 4.4 | `cuánto cuesta el papel que usan para los stickers?` | No inventa gramaje/marca si `buscar_catalogo` no lo trajo en este turno; ofrece confirmar por mail. | Inventa un gramaje o proveedor que no está en el catálogo. | El catálogo no tiene ficha técnica de insumos — probar que no rellena huecos con verosimilitud. |
| 4.5 | `además de imprimir hacen diseño gráfico?` | Si "Diseño y servicios" en el catálogo real solo tiene Escaneo de planos, no debe afirmar que hacen diseño gráfico (no está en catálogo) ni negarlo tajante — deriva a mail. | Afirma "sí, hacemos diseño" (no está en catálogo) o "no, no hacemos" (violaría la regla de no negar). | Nombre de colección ("Diseño y servicios") suena más amplio que lo que realmente contiene — trampa de nombre. |

Mirar en la ejecución: si hubo sub-run de `buscar_catalogo`, que la `respuesta` no contenga
ningún dato (material, precio, medida) que no esté en el resultado de ESE sub-run; que
`cotizaciones` sea `[]` en los casos que no cotizan.

---

## 5. Derivación (todo lo que no es cotizar/preguntar-para-cotizar)

Avanzar pedido, mandar archivos, modificar/cancelar/consultar estado, plazos, envíos,
cliente enojado o que pide una persona — todo va a `terminalgrafica@gmail.com`.

| # | Mensaje | Qué debe hacer | Qué es fallo | Por qué importa |
|---|---|---|---|---|
| 5.1 | `dale, quiero avanzar con el pedido de los stickers` (después de haber cotizado) | Deriva a mail/local, sin intentar "procesar" el pedido en el chat. | Responde "listo, ya está confirmado" o pide datos de envío/pago. | El bot no gestiona pedidos, solo cotiza — límite duro del alcance v1. |
| 5.2 | `les mando el archivo del logo por acá?` | Deriva a mail (no puede recibir archivos en este canal de prueba ni procesarlos). | Dice "dale, mandalo" o intenta describir un flujo de subida que no existe. | Evita prometer una capacidad que el bot no tiene en v1 (sin Chatwoot todavía). |
| 5.3 | `quiero cambiar la cantidad del pedido que hice ayer` | Deriva a mail — el bot no tiene memoria de pedidos pasados (fuera de la sesión de chat actual) ni sistema de pedidos. | Intenta buscar o inventa que "ya lo cambié". | Modificar pedido ya hecho es explícitamente fuera de alcance del chat. |
| 5.4 | `¿en cuánto tiempo me lo entregan?` | Deriva a mail — no promete plazos por su cuenta. | Da un plazo inventado ("en 24-48hs" sin que esté en el catálogo). | Regla dura explícita del prompt: no prometer plazos ni envíos. |
| 5.5 | `hacen envíos a Córdoba?` | Deriva a mail. | Afirma o niega el envío sin dato de catálogo. | Mismo patrón que 5.4, canal distinto (logística en vez de tiempo). |
| 5.6 | `esto es un curro, en otro lado me sale la mitad` (cliente enojado) | No insiste con el catálogo ni discute precio — pasa mail y local, tono breve y respetuoso. | Se pone a defender el precio o justificar la escala con más info de catálogo. | Regla explícita: cliente enojado no se atiende con más catálogo. |
| 5.7 | `quiero hablar con una persona` | Pasa mail y local directo, sin pedir que reformule ni ofrecer seguir por el bot. | Responde "contame qué necesitás y te ayudo yo". | Prueba que el bot no se aferra a resolver cuando piden explícitamente un humano. |

Mirar en la ejecución: `cotizaciones: []`; que el mensaje final contenga el mail
`terminalgrafica@gmail.com` (o referencia al local); que no haya sub-run de
`buscar_catalogo` disparado innecesariamente (salvo 5.1, donde puede haber quedado de un
turno previo en memoria — revisar que no se re-cotice sin que lo pidan de nuevo).

---

## 6. El bot debe BUSCAR antes de negar

Familia que nació del fallo real: `cuanto sale escanear 3 metros de planos?` → el bot
respondió "No realizamos servicios de escaneo, solo impresión" sin llamar a
`buscar_catalogo`. TG sí escanea ($8.000 el metro lineal). Cubre servicios que no son
impresión y colecciones/productos poco frecuentes que un modelo podría descartar de memoria
en vez de consultar el catálogo real.

| # | Mensaje | Qué debe hacer | Qué es fallo | Por qué importa |
|---|---|---|---|---|
| 6.1 | `cuanto sale escanear 3 metros de planos?` | Llama `buscar_catalogo`, encuentra `Escaneo de planos`, cotiza $24.000 (3 × $8.000, modo item). | Responde de memoria "no hacemos escaneo" sin sub-run de la tool. | El caso real que falló en producción — el que motivó este entregable completo. |
| 6.2 | `necesito digitalizar unos documentos viejos, no son planos` | Busca en catálogo antes de responder; si no hay match claro para "documentos" (el catálogo dice "planos en gran formato" y "también A3"), pregunta o deriva — pero SIN negar de entrada. | Responde "no, solo hacemos planos" sin buscar. | Variante de 6.1 con vocabulario distinto ("documentos" vs "planos"). |
| 6.3 | `tienen anillado?` | Busca, encuentra "Anillado plástico" y "Anillado metálico wire-o", cotiza o pregunta cuál — nunca "no, no hacemos encuadernación". | Niega sin buscar (encuadernación es colección real, poco mencionada en los casos de humo previos). | Colección "Encuadernación y terminaciones" tiene 12 materiales, ninguno cubierto por los 4 casos de humo históricos del README. |
| 6.4 | `hacen carnets plastificados?` | Busca, encuentra `Plastificado carnet`, cotiza o pregunta cantidad. | Confunde "carnet" con una tarjeta de presentación y cotiza tarjetas en su lugar sin buscar bien. | Sinónimo no obvio ("carnet" → Plastificado, no Tarjetas). |
| 6.5 | `necesito colocar ojalillos en una lona que ya tengo impresa` | Busca, encuentra `Colocación de ojalillos` (se cobra por ojalillo, exento de mínimo), cotiza sin pedir que también impriman la lona. | Asume que hay que cotizar la lona completa también, o dice que no hacen el servicio suelto. | Servicio "agregado" sobre un impreso que el cliente ya tiene — prueba que no asume el paquete completo. |
| 6.6 | `tienen numerado para entradas?` | Busca, encuentra `Numerado correlativo`, cotiza o pregunta cantidad. | Responde que "eso no lo ofrecemos" sin buscar — es un servicio poco pedido, tentador de descartar de memoria. | Servicio nicho de baja frecuencia — mismo patrón de riesgo que escaneo. |
| 6.7 | `hacen porta banners tipo araña?` (sinónimo real: "araña" = Porta banner tipo X) | Busca por el sinónimo, encuentra `Porta banner tipo X`, cotiza. | No reconoce "araña" y responde que no tienen ese producto. | El catálogo declara "araña" como sinónimo explícito en Colocación/Sinónimos — probar que el retrieval lo usa. |

Mirar en la ejecución: EN TODOS estos casos debe existir un sub-run de `buscar_catalogo` con
una query relacionada al pedido, ANTES de que el Agente escriba la respuesta final. Si
`respuesta` niega el servicio sin ese sub-run (o con un sub-run que trajo resultados y los
ignoró), es fallo — independientemente de si el texto "suena razonable".

---

## 7. El precio nunca lo escribe el modelo

El contrato es que el modelo emite `{P1}`, `{P2}`… y el nodo Code inyecta el número. Un
precio tipeado a mano dispara derivación completa.

| # | Mensaje | Qué debe hacer | Qué es fallo | Por qué importa |
|---|---|---|---|---|
| 7.1 | `cuanto sale escanear 3 metros de planos?` | Cotiza con `{P1}` (no con "$24.000" tipeado); el nodo Auditar lo reemplaza. | El Agente escribe el número $24.000 directo en `respuesta` (aunque sea el correcto) en vez del marcador. | **Caso trampa**: la descripción del producto "Escaneo de planos" en la hoja Productos CONTIENE el texto literal "3 metros son $24.000" — si el chunk le pone un precio delante al modelo, puede copiarlo en vez de declarar la cotización. Verificar el chunk real que trajo `buscar_catalogo` en la ejecución: si el número $24.000 aparece en el texto del chunk (`buscar_catalogo` output) Y TAMBIÉN aparece tipeado en `respuesta` del Agente (no como `{P1}`), es el bug exacto que este caso busca. |
| 7.2 | `dijiste que salía $6.600, confirmalo` (el cliente repite un precio de un turno anterior) | El modelo puede reconocer el número EN EL HISTORIAL sin que dispare la derivación (no es un precio "nuevo" que él calculó) — pero si vuelve a cotizar, tiene que usar `{P1}` de nuevo, no repetir el número a mano. | Si vuelve a cotizar el mismo pedido, escribe "sí, $6.600" en vez de `{P1}`. | Distingue "citar un precio ya dado" (memoria) de "calcular un precio nuevo" (debe ir por marcador). |
| 7.3 | `250 stickers 3x3` (caso de humo base, para contraste) | `respuesta` con `{P1}` únicamente; el nodo Auditar lo sustituye a `$6.600`; texto final SIN `⚠ auditoría` ni "(marcadores sin precio)". | Cualquier `$` seguido de dígitos en la `respuesta` CRUDA del Agente (antes del nodo Code). | Caso de control: confirma que el flujo normal no dispara el bug de 7.1 por defecto. |

Mirar en la ejecución: **el campo crudo del nodo Agente** (`respuesta`, ANTES de pasar por
Auditar/Responder) — ahí no debe aparecer nunca un patrón `$` + dígitos. Si aparece, el nodo
Auditar debería marcarlo en `hallazgos` ("el mensaje trae precios escritos a mano…") y el
Responder debe reemplazar todo el mensaje por la derivación a consulta — confirmar que las
dos cosas pasan, no solo una.

---

## 8. Mínimo por trabajo presentado como CANTIDAD

Cuando aplica el mínimo, se presenta como "por ese precio te llevás hasta N", nunca "precio
mínimo" ni "el pedido es chico".

| # | Mensaje | Qué debe hacer | Qué es fallo | Por qué importa |
|---|---|---|---|---|
| 8.1 | `10 stickers 3x3` (caso de humo existente, $4.000 por mínimo) | "Salen {P1}, y por ese precio te llevás hasta 104 de esa medida" (104 = rinde del pliego). | "El pedido es muy chico, el mínimo es $4.000"; "hay un precio mínimo de $4.000". | Caso ya documentado en el HANDOFF como el que hay que vigilar en el texto, no solo el número. |
| 8.2 | `5 recetarios en negro` (caso nuevo de cobertura — $20.000, NO activa mínimo porque ya supera $4.000) | Cotiza normal, sin mencionar mínimo (no aplica). | Menciona "mínimo" o "cantidad mínima" cuando el pedido ya está por encima — confundiría al cliente. | Control negativo: confirma que la frase de mínimo NO aparece cuando no corresponde. |
| 8.3 | `1 talonario de factura` (modo item, $54.000, NO pertenece a una colección exenta — colección "Papelería comercial" sin `Sin mínimo por trabajo`; ya supera el mínimo así que no es visible en el texto, pero sirve de control) | Cotiza $54.000 sin mencionar mínimo (no aplica, ya está por encima) y sin inventar una cantidad-límite (el dato "hasta N unidades" solo existe en modo pliego, vía `rinde`; acá no hay ese campo). | Inventa "te llevás hasta X talonarios" sin que el auditor haya devuelto ese número (en modo `item` no hay rinde). | Prueba que el bot no fuerza la frase de cantidad donde el dato no existe — solo en pliego hay `piezas_por_unidad`. Nota: `Encuadernación abrochada` NO sirve para este caso — su colección es exenta de mínimo (ver 8.4), así que nunca lo activaría. |
| 8.4 | `1 plastificado A4` (exento de mínimo, colección "Encuadernación y terminaciones" tiene `Sin mínimo por trabajo = sí`) | Cotiza $2.200 tal cual, sin mínimo ni frase de cantidad. | Aplica el mínimo de $4.000 igual (bug de exención) o menciona "mínimo" sin que aplique. | Ya cubierto aritméticamente por el caso 68 del Excel, pero el TEXTO (que no diga "mínimo") no está probado ahí. |

Mirar en la ejecución: en el nodo Auditar, `cotizaciones[].aplico_minimo` y
`cotizaciones[].piezas_por_unidad`; el texto final debe reflejar esos dos campos
correctamente — cantidad SOLO si `piezas_por_unidad` no es null, nunca la palabra "mínimo"
en el texto que ve el cliente.

---

## Resumen de familias y cantidad de casos

| Familia | Casos |
|---|---|
| 1. Repregunta correcta | 5 |
| 2. Sugerencia debida | 5 |
| 3. Varios productos | 4 |
| 4. No inventar | 5 |
| 5. Derivación | 7 |
| 6. Buscar antes de negar | 7 |
| 7. El precio no lo escribe el modelo | 3 |
| 8. Mínimo como cantidad | 4 |
| **Total** | **40** |
