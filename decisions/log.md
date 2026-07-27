# Decisions Log

Append-only record of meaningful decisions and why they were made. `/level-up` Phase 2 (Method interview) writes scoped automation specs here. You can also append manually whenever you decide something worth remembering.

**Format per entry:**

```
## YYYY-MM-DD — Short title

**Decision:** what was decided.

**Why:** the reasoning, constraints, and what would change your mind.

**Alternatives considered:** what else was on the table.

**Owner:** who's accountable.
```

Keep it terse. Future-you will thank present-you for capturing the *why*, not just the *what*.

## 2026-07-27 — Bot TG: el bot nunca repregunta para desambiguar; muestra todas las opciones de una

**Decision:** En la resolución de producto, cuando hay varios candidatos el bot **lista todo lo que sobrevive al filtro en un solo mensaje**, con el piso de precio incluido y una puerta abierta al final ("hay más opciones de X, decime cuál te interesa"). **No repregunta un eje.** Esto elimina la política 1 del plan de v8.3 (">4 candidatos → preguntar el eje que los separa"), no la invierte. La repregunta de desambiguación queda sólo donde el SQL devuelve cero filas y no hay nada que listar. El `LIMIT` de la búsqueda deja de ser un corte de payload del LLM y pasa a ser **el límite de lo que el cliente ve en un mensaje**.

**Why:** Decisión de Martin (2026-07-27), sobre la corrección que trajo la pasada adversarial: la puerta abierta y la repregunta cuestan **exactamente lo mismo** (las dos son un mensaje saliente, ~USD 0,026 desde el 1-oct-2026), así que el plan se equivocaba al justificar la puerta con "informa lo mismo gratis". Corregido el empate, gana mostrar todo: **el mensaje de WhatsApp va a ser el costo dominante del bot** (~USD 12/mes de LLM contra USD 4-8/mes sólo de repreguntas extra estimadas), y un mensaje que lista N opciones ahorra los 1-3 turnos que la repregunta gasta en llegar al mismo lugar. Además evita el loop de repreguntas por ejes distintos que el anti-loop por texto no detecta. Cambiaría de idea si una ronda real midiera que los mensajes largos con muchas opciones no se leen y el cliente vuelve a preguntar igual — ahí el ahorro sería falso.

**Alternatives considered:** Repreguntar el eje discriminante con >4 candidatos (el default del plan; cae por costo de mensaje y por el loop); cota de N repreguntas por conversación (deja de hacer falta si no se repregunta nunca); subir el cupo del menú pero conservando la repregunta como fallback (dos mecanismos para el mismo trabajo).

**Owner:** Martin.

## 2026-07-27 — Bot TG: no existe más la ruta handoff a un humano; la escalación va al mail

**Decision:** Se eliminan del workflow los 4 nodos de la ruta handoff (`Asignar a Humano`, `Armar Nota Agente`, `Llamar LLM Nota`, `Nota Privada Agente`). Las tres entradas de la ruta —la salida `handoff` del switch, el fallback de acción no reconocida y la salida de error del LLM— van ahora a `Label Escalación → Mensaje Escalación → Log Escalación`. El mensaje al cliente pasa a ser honesto: mail, teléfono, local y horario, sin "en breve te van a estar respondiendo". El contrato del LLM (`action: handoff` + el árbol de `motivo`) **no se toca**.

**Why:** TG no quiere empleados mirando Chatwoot, así que la nota de traspaso se escribía —gastando una 2ª llamada LLM— para un lector que no existe, y el aviso al cliente era mentira. Y había un efecto que nadie había medido: `Asignar a Humano` ponía `assignee_id: 1`, y como `Filtro Ingreso` exige `!meta.assignee`, **el bot quedaba mudo para siempre en esa conversación**. Le pasó a la conversación de prueba de la ronda del 27. Se conserva `Log Escalación` porque `motivo` vive sólo ahí, y `Label Escalación` porque no silencia nada y es el índice visual de escalaciones. Cambiaría de idea si TG algún día pone a alguien en Chatwoot.

**Alternatives considered:** Dejar la asignación y desasignar a mano cada vez (el bot sigue muriendo por conversación); tocar el contrato del LLM para que no exista `handoff` (se pierde la telemetría de `motivo` y el freno anti-confabulación de la regla 4).

**Owner:** Martin.

## 2026-07-27 — Bot TG: el bot nunca dice que algo "no lo tenemos en catálogo"

**Decision:** Fuera los dos strings del Aclarador que decían *"Eso no lo tenemos en catálogo"*. En su lugar, invitación a consultar por mail sin negar ni afirmar que el producto exista.

**Why:** Delata el mecanismo interno y suena a "no existe" cuando lo que pasó es que el bot no lo encontró. El System Prompt **ya lo prohibía** ("nunca digas 'el catálogo', 'la lista de precios', 'el sistema'") y el código lo escribía igual: el prompt no puede gobernar un string hardcodeado. Y el compositor no podía repararlo porque tiene prohibido afirmar que algo existe o no existe, así que la frase quedaba blindada.

**Alternatives considered:** Reescribirlo en el prompt (no aplica: no es texto del LLM); dejar que el compositor la parafrasee (el gate la protege, no la puede sacar).

**Owner:** Martin.

## 2026-07-27 — Bot TG: el mensaje de precio cierra con un aviso de canal, una vez por conversación

**Decisión:** se elimina la leyenda `(precio de lista; el precio final del trabajo te lo confirma
el equipo)`, que iba **inline y entre paréntesis pegada a cada monto**. En su lugar el mensaje de
precio cierra con una oración aparte: *"Los pedidos se hacen por mail a terminalgrafica@gmail.com
o en el local; este canal es solo informativo."* Va **una sola vez por conversación** y **solo si
el mensaje lleva plata**. Supersede el "caveat corto" decidido el 26 (`El total te lo confirmamos
en el local o por mail.`), que nunca llegó a una ronda real.

**Por qué:** Martin la rechazó por ilegible en WhatsApp — repetida por ítem en los multi-ítem el
mensaje quedaba impresentable. Y decía lo que no importa (que el precio puede moverse) en vez de
lo que sí (dónde se encarga). No hizo falta estado nuevo: `avisoDado` ya detectaba el mail del
negocio en los mensajes salientes de Chatwoot, y como el aviso lleva la dirección, se apaga solo
a partir del segundo. De paso alinea dos mecanismos que hablaban de lo mismo sin conocerse (ese
`avisoDado` y el `avisoNote` que ya le pedía al LLM no repetir la dirección). El compositor no lo
puede borrar por dos redes independientes: `solo informativo` está en la lista de hedges, y el
mail viaja tokenizado como `[[MAIL]]`, así que borrar la oración también rompe la regla de tokens.

**Consecuencia aceptada, no discutida:** del segundo mensaje en adelante el precio sale **sin
ninguna leyenda**. Es lo pedido y tiene sentido (al cliente ya se le dijo). El disparador para
revisarlo está definido: si en una ronda alguien toma un número del cuarto mensaje como
presupuesto cerrado, hace falta una versión corta que reaparezca cada N turnos.

**Alternativas consideradas:** el caveat corto del 26 (sigue siendo una leyenda de precio, no una
instrucción de cómo encargar); repetir el aviso en cada mensaje con plata (ruido, y el ruido se
paga a USD 0,026 el mensaje desde el 1-oct).

**Owner:** Martin.

## 2026-07-26 — Bot TG: el catálogo se queda en el prompt y el LLM sigue eligiendo el nombre

**Decisión:** tras un consejo Opus de 6 lentes sobre "cómo dejar de depender de que el LLM elija
el nombre del producto de un catálogo pegado en el prompt", **ninguna de las seis direcciones
candidatas entra**. La arquitectura no cambia. Lo que entra en su lugar son tres cosas baratas:
**señal** (conjunto cerrado de nombres + columna `senales` en `bot.decisiones` para detectar el
confident-wrong offline), **curación de voz** (los sinónimos que faltaban, los hijacks medidos), y
la **puerta abierta** (declarar el supuesto pegado al monto).

**Por qué:** las seis se midieron y ninguna gana.
- *IDs opacos* destruyen la única señal de detección: un `P047` equivocado no deja rastro humano.
- *Enum en el JSON schema*: OpenRouter **ignora en silencio** los parámetros no soportados; 84
  valores está al filo del umbral de `400` reportado (~100); y el array `models: [2.5, 3.1]`
  existe justamente para que el 16-oct el primario caiga solo al sucesor — la garantía se
  evaporaría sin aviso, en una fecha que ya está en el calendario.
- *Sacar el catálogo del prompt* no ahorra: está dentro del prefijo cacheable, sacarlo da
  **−USD 0,33/mes**, y se lleva puesto el mundo cerrado. No existe umbral de similitud que separe
  "lo tenemos" de "se parece a algo que tenemos": medido, 0,63 afuera contra 0,53 adentro. El
  resolver difuso puede proponer, nunca confirmar.
- *Contrato de 9 slots con matcher estructural*: con todos los slots llenos **y correctos**, sólo
  **42 de 82** productos quedan unívocos; los seis servicios de taller tienen el vector idéntico.
  Nombre y atributos son **complementarios, no rivales**: a 17 productos los identifica sólo el
  nombre (servicios cuya identidad es un sustantivo), a 22 sólo los atributos, y la unión cubre
  80 de 81.

Cambiaría de idea si el sucesor de flash-lite soporta `enum` de forma verificable (no en
silencio), o si la señal recién construida mide una tasa de confident-wrong por nombre que
justifique pagar el costo de detección perdida.

**Alternativas consideradas:** las seis, con sus números, en
`project-context/TerminalGrafica/whatsapp-automation/plans/consejo-opus-resolucion-producto.md`.

**Owner:** Martin.

## 2026-07-26 — Bot TG: las impresiones se cobran por HOJA, no por página (cierra la pregunta 31)

**Decisión:** en las líneas de impresión Riso (obra 75 y a4 obra 106) la unidad de venta es la
**hoja**. En simple faz se cobra la hoja; en doble faz no se cobra por página, porque el precio
ya está ajustado a la hoja impresa de los dos lados. El motor pasa a calcular
`hojas = simple ? páginas : ceil(páginas/2)` por copia, el bracket se elige por hojas, y **se
levanta el gate que negaba el total del doble faz**.

**Por qué:** se comprueba en la lista de precios: en obra 75, simple faz b/n $100 y doble faz
b/n $150. Si el precio fuera por página, el doble faz debería ser la mitad del simple; que sea
1,5 veces confirma que la unidad es la hoja. Medido con la tabla real del 106 doble faz b/n, un
documento de 200 páginas cotizaba $35.600 por página y cotiza $17.600 por hoja: el gate existía
justo para no cobrar el doble. Cambiaría de idea si TG dice que cargan el precio por carilla.

**Alternativas consideradas:** dejar el gate y seguir sin dar total en doble faz (era el statu
quo desde el build del cotizador, y le negaba una cotización a un caso muy común: el apunte).

**Owner:** Martin.

## 2026-07-26 — Bot TG: el catálogo se atomiza en atributos y familias (entrega 0)

**Decisión:** antes de tocar el matcher se agrega al overlay `bot.producto_meta` /
`bot.variante_meta` un `familias text[]` y un `atributos jsonb` (tecnología, papel, gramaje,
tiers de pack, mínimo, unidad de venta a nivel producto; faz, color, tamaño como array, acabado
y diámetro a nivel variante). El primer LLM pasa a emitir exactamente esas claves. La
pertenencia a varias familias es la regla, no la excepción.

**Por qué:** cinco guards del bot comparan gramaje, faz, tamaño y rubro, y hoy sacan esos
valores parseando el nombre del producto con regex en cada mensaje. Es el criterio que la propia
skill de curación ya fija: si un nodo determinístico necesita comparar o calcular con un valor,
ese valor deja de ser texto. La atomización no crea información, la mueve de un regex opaco a
una tabla revisable. Además hace exacta la regla de gemelos (misma familia, todos los atributos
menos uno) y encuentra el par que más plata mueve, que la heurística de nombres no veía: `OBRA
106 GR` a $800 la hoja contra `Impresiones a4 papel obra 106 gr` a $120 la página, 6,7 veces.

**Alternativas consideradas:** seguir con la heurística de "esqueleto" sobre los nombres
(quedaba ciega al par de 6,7×); pedirle a TG que cargue campos estructurados en su sistema
(es su sistema operativo, no lo tocamos).

**Owner:** Martin. Claude prepara el SQL, Martin lo aplica.

## 2026-07-26 — Bot TG: el segundo LLM aporta recall, nunca elige el producto

**Decisión:** el LLM se parte en dos. El primero entiende al cliente sin ver el catálogo y emite
intención más slots de atributo. El segundo solo corre **si el matcher determinístico no
encontró candidatos**, y devuelve un **conjunto** de productos que podrían encajar, nunca uno
elegido y nunca un monto. La decisión entre candidatos es del código.

**Por qué:** un modelo eligiendo entre gemelos es el confident-wrong que costó los incidentes de
la ronda 4 (presumió el 106 sin preguntar, eligió un diámetro de anillado por su cuenta). Un
pick equivocado y confiado cuesta una reimpresión, no dos centavos. Pero el matcher tiene el
problema inverso: buena precisión y mala recuperación ("bookcel", "espiralado", "papel vegetal
a3" caen en la nada y ahí se pierde el cliente). El LLM es bueno asociando y malo decidiendo con
plata, así que se lo usa para lo primero. Ese segundo LLM ya existe (el Aclarador): se lo
promueve al camino principal y se le saca la acción de resolver a un producto único.

**Alternativas consideradas:** que el segundo LLM elija el producto (propuesta original de
Martin, corregida acá); dejar todo determinístico (deja sin respuesta a los pedidos que el
catálogo nombra distinto que el cliente).

**Owner:** Martin.

---

## 2026-07-24 — Bot TG: lote de resoluciones de catálogo/resolución (no-defaults, pack por tier, atributos vía curación)

**Decision:** Martin resolvió un lote de preguntas que fijan comportamiento del bot:
(1) **No hay "defaults de oficio":** el bot NUNCA asume un eje que falta (gramaje, faz);
**muestra todas las opciones o pregunta**. Esto REVIERTE la recomendación del consejo de
cargar defaults con sello de TG (INC-04/14 se arreglan mostrando/preguntando, no
defaulteando). (2) **Cuantización de pack = próximo tier hacia arriba** (150 con tiers
100/500/1000 → el de 500; si supera el mayor tier, deriva al equipo). (3) **Atributos
parseables vía curación, no esquema nuevo:** la estandarización (ancho_max, tiers de
pack) se decide con un framework agregado a la skill `tg-curar-catalogo` (test: ¿un nodo
de código compara/calcula con el valor? sí → dato estructurado en jsonb `atributos`; no →
display), disolviendo el "landmine de atributos vaporware" como proyecto separado.
(4) **Mono-variante = regla general:** con una única variante, el nombre que vale es el
del producto; ante datos contradictorios de la variante gana el producto (ej. "Anillado
Plástico a3" con variante mal cargada "A4" → es A3). (5) **Anillado:** se muestran
plástico ($2.400) vs metálico ($3.200) como opciones, diámetros solo a pedido, y se
**sacan** los sinónimos de urgencia (no se promete tiempo). (6) Verificado que "Adicional
106"/bookcel NO existen en el catálogo (eran contexto viejo).

**Why:** Respuestas directas de Martin (2026-07-24) sobre lo que hace y no hace el
mostrador, que aterrizan como comportamiento del bot y curación, no como reglas de
prompt. El no-defaults es coherente con su pedido previo ("si varios matchean, mostrar
opciones, no forzar una"). La estandarización vía curación evita tocar `public.products`
(que no controlamos) y mantiene el overlay como única capa editable. Cambiaría el pack
por-tier si TG dice que algún producto se cobra por N packs sueltos en vez de por tier.
Detalle en `preguntas-tg.md` (tabla de resueltas) y `plans/consejo-arquitectura-resolucion.md`
(bloque de override 2026-07-24). Formato de medicina (pregunta 34) queda abierto.

**Alternatives considered:** Defaults de oficio con sello de TG (recomendación del
consejo, rechazada por Martin). Modelar atributos como columnas nuevas en un esquema
aparte (rechazado: se hace en el overlay vía curación). Pack por múltiplos de 100
(rechazado: es por tier disponible).

**Owner:** Martin.

## 2026-07-24 — Bot TG: refinador LLM final en TODO mensaje + política de voz (dominio cerrado, frustración, mail)

**Decision:** Todo mensaje saliente pasa por un **refinador LLM ligero final** que lo humaniza y lo **varía** según la situación (no solo el de precio, y sin repetir siempre lo mismo). La etiqueta de situación (`normal` / `info_no_disponible` / `fuera_de_alcance` / `frustrado` / `enojo_extremo`) la emite el LLM1 junto con la frase y los slots → NO agrega una 3ª llamada, se mantiene el tope de 2 LLM/turno. **Dominio cerrado:** el bot solo informa sobre TG y sus servicios. Ante frustración/enojo: se disculpa e informa que solo puede dar info de TG; en caso extremo **puede revelar que es un bot**; la escalación a un humano real es **siempre por mail** (misma dirección `terminalgrafica@gmail.com`), incluidos reclamos y clientes enojados. El refinador sigue **ciego a la plata** (montos como tokens opacos + re-estampado + regex-gate), **sin historial como instrucción** (el mensaje del cliente le llega solo como etiqueta de tono), con **allowed-claims cerrado** (no inventa plazos/descuentos/productos) y **fallback a la plantilla determinística** si el gate rechaza — por eso la plantilla debe ser un piso de voz aceptable.

**Why:** Martin (2026-07-24): la frase de derivación depende del contexto (no es lo mismo un cliente enojado que alguien que pidió info que no tenemos) y no quiere que el bot repita siempre lo mismo; quiere que suene humano y variado. La restricción de que solo informa sobre TG evita que se lo lleve a temas fuera de alcance. Poner la clasificación de situación dentro del LLM1 respeta el tope de 2 LLM/turno que el consejo fijó por confiabilidad multiplicativa. Cambiaría el alcance si el refinador universal degrada la fiabilidad medida (gate rechazando seguido o latencia que rompe la ilusión): ahí se restringe a las rutas donde más aporta. Ver `plans/consejo-arquitectura-resolucion.md` (PASO 1 y PASO 8) y [[tg-bot-no-chatwoot-humano]].

**Alternatives considered:** Refinador solo en la ruta de precio (rechazado: Martin lo quiere en TODO saliente). Plantillas fijas variadas por reglas sin LLM (menos humano, no modula por enojo). Un 3er LLM dedicado a clasificar el tono (rechazado: rompería el tope de 2 y sube P(error); se folda en el LLM1).

**Owner:** Martin.

## 2026-07-24 — Bot TG: sin humano en Chatwoot — escalación 100% a mail y detección automática del confident-wrong

**Decision:** TG quiere automatizar al máximo y NO sumar Chatwoot a su carga de trabajo. El diseño no debe contar con interacción humana ni con correcciones al bot vía Chatwoot. Toda escalación/handoff va a **mail**. El *confident-wrong* (casos donde el motor cree que acertó, p. ej. INC-15 bookcel→a3 tonner, INC-21 total mal por packs) se detecta **100% automático**, revisado por Martin desde los logs: (a) flags de baja confianza en la resolución (margen fino entre candidatos, default de oficio aplicado, match débil rank-2/3); (b) clasificador barato de rechazo del cliente en el turno siguiente ("no, quería bookcel"); (c) auditoría offline de una muestra de TODAS las cotizaciones con LLM-juez batch (pedido vs producto+precio). El soft-handoff por asignación humano/bot en Chatwoot queda como **vestigio a retirar**.

**Why:** Feedback directo de Martin (2026-07-24) sobre lo que quiere TG: máxima automatización, cero pendiente de Chatwoot. El consejo de arquitectura había apoyado por unanimidad "loguear la corrección humana en Chatwoot" como la única señal confiable del confident-wrong; esta restricción lo descarta de raíz. La detección automática es menos precisa que un humano atento, pero no agrega carga operativa a TG, que es el requisito no negociable. Cambiaría el enfoque si la auditoría offline resulta ciega a demasiados mis-quotes: ahí se sube el % de muestreo o se afina el clasificador de rechazo. Ver plan `plans/consejo-arquitectura-resolucion.md`.

**Alternatives considered:** Human-in-the-loop en Chatwoot como señal/handoff (rechazado por Martin — carga operativa que TG no quiere). Muestreo 100% manual por Martin (se conserva como parte de la auditoría offline, pero asistido por LLM-juez para que escale). Handoff a un agente humano que tome la conversación en WhatsApp (descartado: nadie va a estar mirando).

**Owner:** Martin.

## 2026-07-24 — Bot TG: nodo "Aclarador" (2ª llamada LLM) para resolución y ambigüedad, jailbreak-safe

**Decision:** Reemplazar la repregunta fija de r6 (para los fallos de resolución) por un nodo **Aclarador**: una 2ª llamada LLM que se dispara solo cuando el sistema no resolvió de forma unívoca (`sin_match`, `ambiguo`, `faz_incoherente`, `producto_nicho`, `producto_incoherente`). Recibe el catálogo cerrado cotizable + los candidatos + el **mensaje actual del cliente como dato (NO la historia)**, y devuelve una acción de salida cerrada: `resolver` (mapea al producto real → 2º Get Precio determinístico → precio, el LLM nunca tipea el monto), `preguntar` (pregunta corta nombrando solo el eje que distingue), `opciones` (menú de los que matchean, para comparar) o `nada` (email). Con anti-loop y degradación fail-safe. Si varios productos matchean, **se presentan las opciones o se pide el dato — nunca se fuerza una sola y se descarta el resto** (para eso la curación 1c empata los gemelos kraft/folletos, haciéndolos visibles al Aclarador). Además: la excepción del repeatNote (B.7) se revierte — el silencio ante una pregunta ya respondida es deseado (ahorra un mensaje de WhatsApp pago), no un bug.

**Why:** Martin rechazó la repregunta de r6 ("¿me lo decís de nuevo?") como mala UX que puede no cambiar nada; prefiere un fallback que, aunque cueste una llamada, asegure una respuesta correcta. La restricción clave que puso: el Aclarador necesita contexto de qué resolver, pero NO debe exponerse a jailbreaks leyendo el historial. Por eso recibe solo el mensaje actual (ya pasó el firewall) envuelto como dato, y su salida es un enum + nombres de una lista cerrada → una inyección no puede tipear plata, revelar el prompt ni inventar un producto. Costo acotado: corre solo en el camino de fallo, raro tras el anclaje r6d. Cambiaría la decisión del `resolver` si el LLM chico mapea mal nombres muy mutados (marcador: `aclarador: resolver` seguido de `fallback` en la 2ª pasada); ahí se recorta a solo `preguntar`/`opciones`.

**Alternatives considered:** Fuzzy-match determinístico en SQL en vez de LLM (gratis pero menos preciso con nombres mutados; Martin eligió LLM por correctitud). Pasarle al Aclarador los slots ya extraídos sin texto crudo (más cerrado aún, pero recupera peor los nombres muy mutados — se dejó como opción de veto). Mantener la repregunta fija (mala UX, rechazada).

**Owner:** Martin.

## 2026-07-23 — Bot TG: los fallos de resolución repreguntan por WhatsApp (nunca email) y el menú se humaniza

**Decision:** Dos derivadas de la ronda 2 de suite-5 (notas de Martin). (1) Cuando el sistema no puede resolver la clave producto/variante que emitió el LLM (`sin_match`/`ambiguo`) o un guard bloquea el número (nicho medicina, faz incoherente), el bot REPREGUNTA por WhatsApp y la ruta queda en el especialista — la derivación a email se reserva para precios que el sistema legítimamente no puede dar (override, multi-regla, precio $0, dorso, papel especial). (2) El menú de opciones se humaniza determinísticamente: elección por nombre con el número como atajo ("vale mandar solo el número"), orden natural de números, packs de la misma familia pivotados (variantes una vez + packs en el header), y una sola opción = frase natural sin menú. La idea alternativa de una 2ª llamada LLM post-menú queda descartada por ahora.

**Why:** En la ronda 2, cada `sin_match` moría en "escribinos al email" — exactamente el funnel que la decisión 2026-07-22 eliminó, reapareciendo por la puerta de atrás. Repreguntar cuesta un mensaje pero mantiene viva la cotización, y el anti-loop (2 repreguntas iguales → email) acota el costo. El menú de 12 líneas en orden 100/1000/500 y los menús de 1 opción se sentían de robot (nota de Martin: las interacciones deben sentirse humanas y cada mensaje de WhatsApp cuesta plata desde oct-2026 — menos mensajes, más densos). Todo lo del menú se resolvió sin tokens nuevos; cambiaría la decisión del pivot si el LLM chico no logra mapear "<pack> <familia>" de vuelta (marcador: `sin_match` creciendo tras menús `menu_pack`).

**Alternatives considered:** 2ª instancia LLM que post-procese menús (costo/latencia/riesgo de hallucination en paso monetario; reevaluar en ronda 3 si los menús siguen torpes). Dejar `sin_match` → email (mata la conversación). Word-subset matching en Get Precio para rescatar claves inventadas (riesgo de match equivocado con plata; la repregunta es más segura).

**Owner:** Martin.

## 2026-07-22 — Bot TG: WhatsApp informa TODO (precios y totales); el email queda solo para encargar

**Decision:** Cambio de producto en el bot de TG. El funnel v10.x "precio/cotización → email" se reemplaza: el cliente se informa todo (precios, opciones, totales estimados por cantidad) por WhatsApp; el email queda solo para concretar el pedido (mandar el archivo). Se implementa como faq-bot-v7 "cotizador" (plan validado en `project-context/TerminalGrafica/whatsapp-automation/plans/faq-bot-v7-cotizador.md`): recolección de datos mínimos en UN mensaje + total determinístico precio × cantidad con brackets. El LLM sigue sin tipear montos; n8n multiplica.

**Why:** Martin corrió el replay real de R1 (libro en PDF) contra v10.8 y la derivación a email sin cotizar — el comportamiento diseñado — esquiva dos veces la pregunta de precio del cliente. El valor del canal es informar; el ancla al email era fricción sin retorno. Resuelve además el P0 "email-only funnel realignment" del prod-readiness. Cambiaría la decisión: si los totales estimados generan conflicto en mostrador (screenshot del total vs precio final), se recorta el alcance de los totales, no el funnel.

**Alternatives considered:** Mantener el funnel y solo ampliar la oferta por página (v10.5) — rechazado por Martin tras el replay. AI-Agent con tools donde el LLM copia el número calculado — rompe "el LLM nunca tipea montos".

**Owner:** Martin.

## 2026-07-07 — Bot de WhatsApp VENDIDO a TG: USD 400 desarrollo + USD 30/mes (o 300/año)

**Decision:** TG confirmó el proyecto de automatización de WhatsApp (cierre ~fin de junio 2026). Acuerdo: **USD 400** de desarrollo (única vez) + mantenimiento **USD 30/mes o USD 300/año** (moneda registrada como USD; corregir acá si fuera ARS). El proyecto pasa de demo-sin-confirmar a cliente confirmado → el prod target **Hostinger KVM 4 a nombre de TG** queda habilitado (aún sin contratar). Go-live gates = lista P0 de `project-context/TerminalGrafica/whatsapp-automation/prod-readiness-review.md`.

**Why:** Primer cliente del producto a productizar; precio piloto a cambio de testimonio + caso de éxito (muy por debajo de la propuesta original de ARS 1.200.000 + abono 100/160k — se priorizó cerrar). Pendientes derivados que protegen la relación: (1) **avisar por escrito a TG que desde el 1-oct-2026 Meta cobra los mensajes de servicio** (~USD 0.026/msg, pass-through en su cuenta Meta — a volumen actual puede superar el propio abono); (2) confirmar que VPS + Meta + API de IA se facturan directo a TG (USD 30/mes no absorbe infra); (3) contratar el KVM 4 y ejecutar los P0 antes del go-live.

**Alternatives considered:** Sostener el precio de la propuesta original (no cerró a ese nivel; el valor del caso de éxito justifica el descuento fundador).

**Owner:** Martin.

## 2026-06-29 — El bot pasa a recolectar+confirmar el pedido antes de escalar (lead calificado); variantes (sin precio) en el prompt

**Decision:** El FAQ-bot deja de escalar en crudo ante intención de pedido ("necesito X"). Nuevo comportamiento: cuando detecta intención de pedido, entra en **modo armado de pedido** → junta los datos (producto + cantidad + características/variantes) preguntando lo que falte → resume y **pide confirmación** → recién ahí escala, dejando un **lead calificado** para que el asesor cierre y cotice. Sigue sin dar precios ni cerrar el pedido. Para habilitar preguntas precisas, el catálogo del prompt ahora incluye las **variantes (nombres/opciones) por producto, SIN precios** (Get Catálogo upgradeado). Implementado como cambio de prompt en `faq-bot-v5.json` (no requiere nodos nuevos: el multi-turno sale del historial y el handoff note ya resume la conversación). Esto **revierte** la decisión previa "el bot solo informa, no recopila datos de pedido".

**Why:** Escalar en crudo cada "necesito X" tira leads vagos al humano y da mala UX. "El bot califica y prepara" (conclusión del red-team) le da al asesor un pedido ya armado y al cliente sensación de avance. Incluir variantes sin precio es barato (nombres cortos, cacheable) y **no** reintroduce el riesgo de precio fantasma (ese riesgo es de los PRECIOS, que siguen fuera del prompt y on-demand). El multi-turno y la nota de traspaso ya existían, así que el cambio es solo de prompt. Cambiaría de idea si el loop (`bot.decisiones`) muestra que el bot se enrosca juntando datos, da precios sin querer, o que los asesores prefieren el lead crudo. La precisión fina (validar configs contra variantes reales y mostrar precios de las `mostrable`) llega con el Increment B.

**Alternatives considered:** Mantener escalar-en-crudo (rechazado: leads pobres, UX); calificación-antes-de-handoff vía nodos/estado explícito (rechazado: innecesario, el historial del LLM ya da el estado); meter también los precios en el prompt para cotizar en el bot (rechazado: precio fantasma — los precios van on-demand en B).

**Owner:** Martin.

---

## 2026-06-29 — Bot WhatsApp accede al catálogo por function calling (NO RAG vectorial), con safeguards del red-team

**Decision:** Para que el FAQ-bot de Terminal Gráfica informe productos/precios con precisión, el bot consulta la BD viva del sistema de presupuestos (Supabase Postgres, la fuente de verdad) vía **function/tool calling desde n8n** — **no** RAG vectorial. Razón estructural: catálogo y precios son datos estructurados + cómputo, no recuperación semántica; vectorizar duplicaría la fuente de verdad y daría imprecisión probabilística sobre números (confirmado por deep-research, 113 agentes, y debate adversarial Opus 2 rondas). Diseño:
- **Vista de solo-lectura `bot_catalogo`** con taxonomía (categorías + nombres canónicos + sinónimos[] + casos_de_uso[]) que va SIEMPRE en el prompt (cacheada); las 186 variantes con precios se traen on-demand por SQL.
- **Resolución nombre→ítem en 2 niveles:** N1 = SQL con OR de sinónimos (determinístico, ~80%); N2 = LLM resuelve contra la taxonomía si N1 falla.
- **Precios = misma fila/motor que el mostrador, nunca una copia ni una reimplementación.** Sin reglas de precio → muestra el número. Con reglas → para cotizar de verdad el bot debe **llamar al motor de precios existente** (función/endpoint compartido), nunca recalcular las reglas en n8n (eso reintroduce deriva = precio fantasma). Nunca calcula con inputs incompletos: los pide o escala.

**5 ajustes que salieron del red-team (críticos):**
1. **Número solo para precio sin reglas;** lo que depende de cantidad/medida/terminación va en rango + gatillo de captura, nunca número pelado. Plantilla fija, el LLM no tipea el precio.
2. **Auto-silencio:** SKU con `updated_at` > 30 días → el bot deja de mostrar ese precio y escala (nadie audita los 186 a mano). *(Ajuste 2026-06-29 al mapear el schema: `product_variants` no tiene `updated_at`; queda diferido. El bot lee el mismo precio vivo que el mostrador y las promos vencen por `valid_to` en las reglas, así que el riesgo es bajo. Si se quiere, agregar `updated_at`+trigger en una migración.)*
3. **Se elimina el "no trabajamos eso" terminal** → handoff suave siempre que no resuelva con datos. Esto vuelve OBSERVABLE el falso negativo (la venta que moría en silencio queda como conversación viva).
4. **Feedback loop sin etiquetado voluntario:** señales automáticas del log + digest semanal con 5 conversaciones perdidas al azar para que Martin marque "era venta / no" (ground truth forzado, 2 min).
5. **Infra defensiva:** timeout + fallback a humano si la BD cae/lentea; kill switch global + modo solo-handoff de fábrica.

Enfoque: **base primero, sumar con datos.** v1 = precios sin reglas + handoff suave + log `bot_decisiones` desde día 1. El cálculo de precios con reglas y la decisión sobre pgvector se prenden por fases según lo que muestre el loop.

**Why:** El bot es el cliente piloto de un producto a vender a otras imprentas: un precio fantasma (captura + cobro distinto en mostrador) o un falso "no lo hacemos" matan la reputación de la imprenta y con eso el producto. Los safeguards priorizan no romper reputación sobre features. Single source of truth (datos Y lógica) es lo que evita la deriva, que es la raíz de casi todos los modos de falla. Cambiaría de idea sobre pgvector si, con frases reales del log, un eval en promptfoo muestra que la resolución por sinónimos+LLM falla por encima de un umbral; cambiaría sobre el cálculo de precios si las reglas resultan demasiado acopladas al código del sistema como para exponerlas como función.

**Alternatives considered:** RAG vectorial / pgvector (rechazado a esta escala: duplica fuente de verdad, imprecisión sobre precios, sin evidencia de ventaja en el deep-research); import por xls del catálogo (rechazado: foto que driftea); reimplementar las reglas de precio en un nodo n8n (rechazado: segunda versión de la lógica = precio fantasma garantizado); salida terminal "no trabajamos eso" (rechazado: falso negativo invisible); etiquetado manual del agente en Chatwoot como ground truth (rechazado: muere en la semana 2).

**Owner:** Martin.

---

## 2026-06-23 — `/level-up`: Research/plan completeness enforcer (skill)

**Decision:** Ship a skill that forces every software/architecture/infra research or planning task to cover the real-world dimensions Claude tends to skip — pricing/cost, security, UX, scalability, ops/maintenance, compliance — and to *justify* any dimension marked N/A instead of silently dropping it. Scoped via the 3Ms Method pass:

- **Constraint:** quality of Martin's core deliverable (the architecture/infra decisions he sells). Incomplete output costs rework (re-reading + re-prompting) and risk (shipping a client decision missing security/pricing/scale).
- **EAD:** Automate (not eliminable — research is core; not delegable — it's his expertise). 60/30/10: fixed rubric ≈60% deterministic, applying it ≈30% AI, N/A judgment ≈10% Martin.
- **Process:** Trigger = Martin asks Claude to research/plan infra/architecture. Sources = topic + codebase + web/docs + standing constraints (free/self-hostable + Claude-connectable tooling rule, ARS pricing, small-local-business scale). Transformation = raw research → structured against the rubric. Decision point = which dimensions apply; N/A must be justified out loud. Destination = structured research/plan doc, often feeding a decision-log entry.
- **Autonomy: L2 (Drafted).** AI drafts with rubric enforced; Martin reviews. No L3/L4 — he's the reviewer by design.
- **KPI:** Bucket = less cost + more value per customer. Metric = *first-pass dimension coverage* (% of research/plan outputs that hit every applicable dimension before a re-prompt). Today ≈ low; target ≈ 100%, missing-dimension re-prompts → ~0.

**Why:** Highest-frequency drudgery Martin named this week, and it degrades the exact work he's productizing. Fixing the methodology once lifts every future research/plan pass. The skill makes gaps *visible* rather than doing the thinking for him.

**Alternatives considered:** Per-client context structure (#4 — strategic but clients haven't landed; build thin later); file-placement + runtime-context convention (#2 — mostly an Eliminate via CLAUDE.md + gitignored local env file; cheapest win, lowest ceiling). Both deferred.

**Owner:** Martin.

---

## 2026-06-22 — Usar IA reactiva para responder WhatsApp es compliant; el riesgo de baneo es comportamiento, no IA

**Decision:** El producto de automatización de WhatsApp para gráficas (bot reactivo con LLM sobre la Cloud API oficial) se lanza como **atención reactiva dentro de la ventana de 24 hs, sin mensajería proactiva al inicio**. Confirmado vía deep-research (reporte en `project-context/TerminalGrafica/whatsapp-automation/research/`). Hallazgos clave que fijan el diseño:
- **Permitido:** el veto de Meta (ene-2026) a "AI Providers" apunta a quien distribuye asistentes de propósito general; un bot acotado al negocio (FAQs, cotizaciones, estado de pedido) es funcionalidad "incidental/accesoria" → permitido. Mantenerlo acotado al negocio, nunca posicionado como asistente general.
- **Riesgo real = comportamiento, no IA.** Meta no puede detectar que la respuesta la escribió una IA (cifrado E2E). El baneo se dispara por bloqueos/reportes/spam/picos de volumen, vía el quality tier (Verde/Amarillo/Rojo, feedback de últimos 7 días).
- **Ventana de 24 hs:** se calcula sobre el **último** mensaje entrante del cliente y se resetea con cada nuevo entrante (no con las respuestas del negocio). Dentro: texto libre (IA OK). Fuera: solo plantillas pre-aprobadas — regla dura de la API (error `131047` si mandás texto libre fuera de ventana), estructural, no interpretación de intención.
- **Opt-out NO necesario para reactivo.** El opt-in está implícito (el cliente escribió primero) y no hay lista de la cual desuscribir. Solo se vuelve obligatorio si se agrega mensajería proactiva (plantillas marketing/broadcasts). Corrige una sobre-aplicación previa de la regla.
- **Derivación a humano = obligatoria** según política de Meta si se usa automatización dentro de la ventana.
- **Plantillas pre-producción recomendadas (todas Utility):** cotización lista, pedido listo para retirar, arte/diseño para aprobar (mínimo viable); luego cambio de estado, recordatorio de pago neutral, retomar conversación caída. Evitar plantillas Marketing al lanzar (se pagan siempre + mayor riesgo de baneo).

**Why:** El flujo de una gráfica (cotizar → aprobar arte → producir → retirar) cruza las 24 hs casi siempre, así que las plantillas Utility de ciclo de pedido son el único punto donde se necesita reabrir conversación — y son el punto de integración con el sistema de cotización/recepción de archivos. Lanzar reactivo + sin proactivo minimiza el riesgo de baneo mientras se valida el producto.

**Alternatives considered:** Sumar mensajería proactiva/marketing desde el día uno (mayor riesgo de baneo, requiere opt-in/opt-out, plantillas pagas — diferido a canal maduro).

**Open / re-verify:** SIM prepago personal vs número dedicado y si la verificación de negocio cambia el riesgo de baneo (el research no encontró evidencia de primera fuente). El veto a "AI Providers" se juzga "a sola discreción" de Meta y los términos cambiaron 6-mar-2026 — re-verificar antes de escalar.

**Owner:** Martin.

---

## 2026-06-19 — Server de producción del stack WhatsApp: Hostinger KVM 2 (reemplaza Hetzner CPX31)

**Decision:** El servidor de producción para el stack de automatización de WhatsApp (Chatwoot Community + n8n, ver [2026-06-17]) pasa a ser un **Hostinger KVM 2**, reemplazando el Hetzner CPX31 que se había decidido antes. La implementación actual corre en una **VM local que replica los recursos de un KVM 2** para probar antes de mover a prod. Estado al día de hoy: Chatwoot seteado con usuario, expuesto en un subdominio de un dominio personal de Martin vía Cloudflare, con Zero Trust activo en todo menos en el path de webhooks (abiertos para que Meta/WhatsApp llegue). Pendiente: conectar WhatsApp vía Cloud API oficial con una **SIM prepaga desechable** (el número de prueba de Meta aparecía bloqueado) y construir los flujos de n8n.

**Why:** [pendiente de completar por Martin — motivo del cambio Hetzner → Hostinger]. La VM local idéntica en recursos permite validar el setup sin pagar el VPS hasta que esté listo para prod.

**Alternatives considered:** Hetzner CPX31 (decisión previa en [2026-06-17], 4 vCPU/8GB ~USD 10).

**Owner:** Martin

## 2026-06-18 — Kiosk de recepción: dispositivo por-usuario, URL `tg-recepcion.vercel.app`, no indexable

**Decision:** El kiosk de cliente (`recepcion-cliente`) se trata como **superficie por-usuario** (cada cliente lo abre desde su propio teléfono), no como un equipo compartido en el mostrador. Tres consecuencias, ya implementadas (branch `feat/kiosk-per-user-cleanup`):
- **URL de prod:** `tg-recepcion.vercel.app` — mismo patrón `tg-*` que el sistema de presupuestos (`tg-presupuestos.vercel.app`). El dominio propio de la marca no está disponible.
- **No indexable:** `robots: { index: false, follow: false, nocache: true }` en `app/layout.tsx`. Es interno, no una página pública.
- **Limpieza de UI por-usuario:** se quitó el botón "Sacar foto" (no hay originales físicos en el teléfono del cliente) y "Atender a otra persona" → "Volver al inicio" (no hay cola de gente en un device compartido).

**Why:** El modelo broker ya hace que cada sesión sea individual y efímera; el device es el teléfono del cliente, no un kiosko fijo. Las frases y el botón de cámara venían del supuesto "mostrador compartido" y confundían. La URL en Vercel evita depender del dominio de marca (no disponible) y mantiene consistencia con presupuestos. Noindex porque no hay razón para que Google la vea y sí razones de privacidad para que no.

**Alternatives considered:** `tg-recepcion-archivos` (más largo, sin ganancia); robots.txt `Disallow: /` (la meta robots por página alcanza para una app de kiosk). Dejar la UI como estaba (mantiene supuestos de device compartido que ya no aplican).

**Owner:** Martin.

## 2026-06-18 — Recepción de archivos: modelo broker (sin anon) consolidado en el sistema de presupuestos, EN PROD

**Decision:** El flujo de recepción de archivos de Terminal Gráfica (cliente sube archivos en mostrador) se unifica dentro de `quote-automation-system` con un **modelo broker server-side**, y quedó **en producción funcionando** (2026-06-18). Tres piezas:
- **Mostrador** = módulo interno `/mostrador` del sistema de presupuestos, reusando su auth (empleados/admin) y design system.
- **Kiosk** = app separada `recepcion-cliente`, ahora repo propio en GitHub **`MartinFernandezSantia/reception-kiosk`** (privado).
- **Broker** = route handlers `app/api/reception/**` con **service-role key** + token opaco por sesión (sha256, scoped, TTL 12h). El kiosk NO tiene identidad Supabase.
- **Anonymous sign-ins APAGADOS permanentemente.** Un proyecto Supabase compartido. Upstash Redis provisionado para rate-limit.

**Why:** Habilitar anon en el proyecto compartido exponía data del host (el trigger `handle_new_user` da `role='employee'` a cualquier usuario nuevo incluido anon; policies `clients_*` sin guard de is_anonymous → un anon podía leer PII de clientes y tocar presupuestos). El broker elimina la clase de problema entera: como nunca se crea identidad anónima, el blast radius desaparece de raíz y el host NO necesita hardening de RLS. La autorización vive en código auditado (los handlers), no en RLS sobre un anon. Un solo proyecto Supabase = menos costo y operación (decisión previa del dueño). Detalle técnico completo en `quote-automation-system/docs/decisions/ADR-002` y `docs/architecture/reception-upload-broker.md`.

**Alternatives considered:** (1) Habilitar anon + hardenear el host (modificar `handle_new_user` + ~13 policies): más riesgoso sobre el sistema vivo, mismo end-state. (2) Segundo proyecto Supabase para el kiosk: rechazado (un solo proyecto). (3) Storage world-writable sin identidad: cualquiera sube/lee/borra. Residual aceptado: el canal Broadcast `tg-recepcion` es público (filtra nombres/filenames a cualquier holder de la publishable key); hardening = canal privado + Realtime Authorization, v2. La app standalone `recepcion-archivos` quedó superseded y archivada en `projects/TerminalGrafica/_archive/`.

**Owner:** Martin.

## 2026-06-17 — Oferta de automatización de WhatsApp para gráficas: stack self-hosted + modelo instalación/abono, no competir por precio

**Decision:** Para vender automatización de WhatsApp (recibir pedidos + responder consultas) a gráficas en Argentina, el producto es un stack **self-hosted: WhatsApp Cloud API oficial + Chatwoot (Community, MIT) + n8n**, con un modelo de IA **open-weights de gama media (Llama 3.3 70B / Qwen vía OpenRouter o Groq)** para responder, todo orquestado por n8n e integrado al sistema de presupuestos/recepción de archivos del cliente. Conexión a WhatsApp **siempre por la Cloud API oficial** (nunca Baileys/whatsapp-web.js: riesgo de ban en un canal crítico). Infra: **VPS Hetzner CPX31** (4 vCPU/8GB, ~USD 10) + storage en **Cloudflare R2** (ya decidido, ver [2026-06-16]). Comercialización: **instalación una vez + abono mensual obligatorio** ("operación y mejora continua"), en ARS, posicionado como desarrollo custom L2. NO vender instalación suelta sin abono, y NO competir por precio contra SaaS genéricos tipo Aoki/Cliengo.

**Números (TC ref USD 1 ≈ ARS 1.450, jun-2026):** Cost-to-serve ~USD 18-30/mes por cliente (VPS ~15 + R2 ~1-3 + IA ~2-4; mensajes de WhatsApp ~0 asumiendo ventana de 24h). Instalación ARS 1.800.000 estándar / ARS 1.200.000 precio fundador (a cambio de testimonio + caso). Abono: Base ARS 100.000/mes, Plus ARS 160.000/mes. IA real a volumen de gráfica (300-600 conv/mes): ~USD 2-4/mes con modelo gama media; supuesto ~10k tokens in + 0.5k out por conversación resuelta (6 turnos, system ~2k reenviado).

**Why:** Self-hosted es un **activo replicable** (build once, sell many) con costo marginal bajo por cliente nuevo, a diferencia de revender margen de un SaaS. El abono recurrente ES el modelo de negocio (MRR) y el mantenimiento no es opcional de verdad (los tokens de Meta vencen, la API cambia; sin mantenimiento se rompe solo en semanas). El diferencial frente a Aoki/Cliengo no es precio sino **integración a la operación del cliente + datos en su poder**; competir por precio contra un SaaS a escala es perder. Cloud API oficial elimina el riesgo de ban. Modelo open-weights de gama media: Claude/GPT frontier son sobredimensionados para FAQs, y un 8B alucina precios/políticas; respeta además la regla de herramientas (open-source/self-hosteable, conectable). Hetzner CPX31 da 4 vCPU reales (Chatwoot come CPU) por menos que el renew de Hostinger; la latencia EU (~200ms) no afecta al bot (habla con Meta, no con el cliente final) y es tolerable en el panel interno.

**Alternatives considered:** Chatwoot plan Startups (USD 19/agente/mes — la API también está gratis en la Community, el plan solo te ahorra mantenimiento); Baileys/whatsapp-web.js (gratis pero ban = canal caído, descartado para producción); SaaS pago Aoki/Cliengo (más barato de entrada pero genérico, sin integración, revendés margen ajeno); VPS Contabo (más barato pero CPU inconsistente, malo para producción), Vultr/Hostinger São Paulo (mejor latencia AR, más caro), Oracle Cloud free (gratis pero cuotas/complejidad, no para cliente que paga); modelos Gemini Flash (más barato aún pero cerrado), Llama 8B (muy chico, riesgo de alucinar), Claude Haiku (bueno pero ~6x el costo del open-weights para esto).

**Owner:** Martin.

## 2026-06-16 — TG recepción-archivos: cuando se toquen los límites del free de Supabase, mover SOLO el storage a Cloudflare R2 (no pasar a Supabase Pro)

**Decision:** El plan de escalado preventivo para la app de recepción de archivos es: mantener Supabase free para Postgres (metadata + estados) y Realtime (tablero en vivo), y migrar **solo los bytes de los archivos a Cloudflare R2** vía URLs prefirmadas (browser → R2, subida y descarga directas). NO migrar a Supabase Pro ($25/mes fijos) solo por tocar límites. Disparador de migración: cuando el egress mensual de Supabase pase ~3-4 GB (no esperar al tope de 5 GB). Antes que nada, implementar política de borrado de archivos post-entrega para mantener el storage casi indefinidamente bajo 1 GB.

**Why:** El cuello de botella real del free de Supabase es el **egress (5 GB/mes; descargas, no subidas)**, no el almacenamiento. Para un workload con tanta descarga como subida, eso se agota rápido. R2 **no cobra egress nunca** y su free tier (10 GB storage, 1M Class A, 10M Class B) cubre de sobra una sola imprenta; pasado el free son centavos, no $25 fijos. R2 es S3-compatible (igual que Supabase Storage por debajo), así que el cambio de cliente es chico y Postgres+Realtime siguen gratis. AWS S3 se descarta porque cobra egress (~$0.09/GB), justo el costo a evitar.

**Alternatives considered:** Supabase Pro $25/mes (caro solo por bandwidth para un cliente chico); AWS S3 (cobra egress, peor encaje); Backblaze B2 (10 GB free, egress gratis vía Cloudflare Bandwidth Alliance — buena 2da opción, más plomería); self-host MinIO on-premise/VPS (cero egress, control total, pero carga operativa/backups — plan C).

**Owner:** Martin.

## 2026-06-15 — Terminal Gráfica `.tg` logo-reveal sting: final frame + 3s bounce video

**Decision:** Locked a 16:9 logo-reveal for Terminal Gráfica's `.tg` mark. Final still = `project-context/TerminalGrafica/assets/tg-logo-reveal-final-frame.png` (deep dark bg, two white halo rings, central glow; Nano Banana Pro at 2k). Final video = `…/assets/tg-logo-reveal-3s.mp4` (wan2_7, 1080p, 3s, silent): empty dark → logo pops in and bounces a couple of times → settles on the still. The still was generated single-shot with the logo passed as a reference; the bounce-into-existence motion came from making that still the END frame (a generated dark plate as the start frame). Added repo-level tooling — `sharp` + `@resvg/resvg-js` and `scripts/` helpers — to rasterize/composite the SVG logo.

**Why:** Martin wanted a quick, punchy brand sting. Letting the video model use the resting frame as the *last* frame (not the first) is what produces a real "appears from nothing" reveal; a single start image only animates an already-present logo. Used non-premium models with a real credit estimate per the Higgsfield preflight gate; Nano Banana Pro (premium) was an explicit, justified call for 2k source fidelity. Note: the AI re-render rendered the leading dot as a colon `:` — accepted by Martin, but the standing lesson is to composite the real vector when glyph fidelity must be exact.

**Alternatives considered:** Compositing the exact logo over a generated plate (guaranteed glyphs, but Martin chose single-gen); single start-image animation (no real reveal, bounce barely perceptible); 4s duration for crisper multi-bounce (offered; Martin kept 3s).

**Owner:** Martin.

## 2026-06-15 — On WSL, Node + pnpm come from pnpm's own installer, not corepack/nvm

**Decision:** On this WSL2 box the pnpm-prescribed `corepack enable` path is dead — the only `corepack` on PATH is the Windows one (`/mnt/c/Program Files/nodejs/corepack`), which fails under WSL with a CRLF `/bin/sh^M: bad interpreter` error. So pnpm is installed as a **standalone binary** (`~/.local/share/pnpm`, bundles its own Node) and the native Linux Node is installed via **`pnpm runtime set node lts -g`** (currently v24.16.0). Updated `SETUP.md` to document this WSL reality instead of the generic corepack/nvm instructions.

**Why:** `pnpm install` was failing at exit 127 — `@higgsfield/cli`'s postinstall runs `node install.js`, but no native Linux `node` existed (pnpm's bundled Node isn't exposed as a `node` command for child scripts, and the only PATH `node` was the un-invokable Windows one). Installing a Linux Node fixed it. Using `pnpm runtime` keeps Node in pnpm's own dir (already on PATH), needs no extra tool, and is reversible — it's a runtime prerequisite, not a repo dependency, so it respects the repo-level tooling rule.

**Alternatives considered:** `nvm`/`fnm` (another tool to install and manage); `apt install nodejs` (system-wide, often stale version); fixing corepack's CRLF (fighting a Windows-binary-on-WSL problem for no benefit).

**Owner:** Martin.

## 2026-06-29 — Monitoreo del sistema WhatsApp en dos capas; el digest semanal de seguridad es el primer job de Hermes

**Decision:** El monitoreo del stack self-hosted (Chatwoot + n8n + Postgres + Redis) se parte en dos capas. **Capa 1 (detección):** herramientas determinísticas open-source — Uptime Kuma + Netdata + dead-man's-switch de backups + un ping externo — que notifican a un único canal de Telegram, sin LLM en el camino. **Capa 2 (inteligencia):** un agente Hermes que (a) genera un digest semanal de seguridad sobre el stack pinneado y (b) más adelante hace triage de las alertas de la Capa 1. El **digest semanal de seguridad es el primer job real de Hermes** (antes que el copiloto de engagement social). Guía completa en `project-context/TerminalGrafica/whatsapp-automation/mantenimiento-y-monitoreo.md`.

**Why:** El LLM no puede ser el detector de caídas: si vive en el mismo VPS, cae con él, y agrega latencia/costo/alucinación a una alerta crítica. La detección tiene que ser tonta y externa; el agente aporta donde hace falta juicio (filtrar CVEs que afectan vs ruido, traducir alertas). El digest semanal ataca el riesgo real detectado en la investigación 2026-06-29: no es la frecuencia de updates (solo ~3 forzados/año entre Chatwoot, WhatsApp API y Gemini), es **no enterarse a tiempo** de un CVE que Chatwoot parchea en silencio. Es mejor primer job para Hermes que el engagement social: cero riesgo (solo lee y avisa), valor claro, y justifica standuparlo (el gut-check de [[hermes-role]] pedía un primer need unattended real). Cambiaría de idea si apareciera un servicio gestionado que cubra detección + digest por un costo trivial sin romper la regla de tooling (open-source/self-host + conecta a Claude).

**Alternatives considered:** Un solo agente Hermes que haga todo incluido detección de downtime (rechazado: LLM en camino crítico); monitoreo 100% manual (rechazado: el agujero es justamente no enterarse a tiempo); SaaS de monitoreo cerrado (rompe la regla de tooling).

**Owner:** Martin.

## 2026-06-15 — agent-browser is the one browser tool; dropped the Chrome DevTools + Lighthouse MCP servers

**Decision:** Removed both MCP servers (`chrome-devtools`, `lighthouse`) from `.mcp.json` and the dead `mcp__chrome-devtools__*` permission. Browser automation, screenshots, scraping, QA, and audits all go through the vendored `agent-browser` skill instead. Added `SETUP.md` documenting fresh-machine install (core vs optional).

**Why:** The `agent-browser` skill already covers everything the two MCPs did and explicitly says to prefer it over other browser tools. It manages its own Chromium, so keeping the MCPs added a redundant system-Chrome dependency for no gain. One browser path is simpler to set up and reason about.

**Alternatives considered:** Keep all three and note the overlap (redundant config + extra Chrome dep); keep Lighthouse only for perf/SEO scoring (still a second tool to maintain — revisit if agent-browser can't produce the audit numbers we need).

**Owner:** Martin.

## 2026-06-14 — Generated AI assets live in `project-context/<Project>/assets/`, finals committed, drafts ignored

**Decision:** Higgsfield/Nano Banana/Flux output goes under each project's `project-context/<Project>/assets/` folder. Final picks are committed; throwaway iterations go in `assets/drafts/`, which is gitignored (`project-context/**/assets/drafts/`).

**Why:** Keeps generated media beside the project it serves and synced/backed up like other companion files, while keeping the "commit everything in project-context" rule from bloating the AIOS repo with large/redundant video files. Iterating is cheap and noisy; only the chosen output is worth versioning.

**Alternatives considered:** Commit everything (repo bloat from video binaries); gitignore all assets (loses the backup/sync benefit, at risk from `git clean`).

**Owner:** Martin.

## 2026-06-13 — Companion files for external projects live in `project-context/`

**Decision:** External project repos go under `projects/` (gitignored in AIOS, since they have their own remotes). Files related to those projects that I want the AIOS to read but don't want in the project's own repo live in a sibling `project-context/` folder, mirroring project names.

**Why:** `project-context/` is committed and synced by AIOS, so companion files get versioned and backed up like the knowledge artifacts they are. Nesting them inside `projects/` would leave them double-ignored (not in the project repo, not in AIOS), local-only, and at risk from `git clean`. Sibling folder also keeps the project repos pristine with one ignore rule (`projects/`) instead of per-project gitignore edits. Would change my mind if companion files turn out to be mostly sensitive/local-only data, in which case a gitignored `project-context/private/` covers the exceptions.

**Alternatives considered:** Folder inside each project added to that project's `.gitignore`.

**Owner:** Martin.
