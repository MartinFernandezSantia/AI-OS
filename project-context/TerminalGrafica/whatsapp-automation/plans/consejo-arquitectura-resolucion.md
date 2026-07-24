# Consejo de arquitectura — resolución, validación y voz del bot TG

Fecha: 2026-07-24. Consejo de 6 lentes (UX/voz, prompting-LLM, matching-determinístico,
costo-ops, dominio-imprenta, red-team), 2 rondas de debate + síntesis del chair.
13 agentes, ~590k tokens. Insumo: los 10 incidentes de la ronda 3 de suite-5
(4, 5, 7, 11, 12, 13, 14, 15, 20, 21) y la arquitectura que yo había propuesto
(vocero primero + rework de resolución).

**Este doc es la recomendación del consejo, PENDIENTE de las decisiones de Martin
(sección al final). No está aprobado para construir.**

> **RESTRICCIÓN DURA (Martin, 2026-07-24):** TG quiere automatizar al máximo y NO
> sumar Chatwoot a su carga de trabajo. No hay que contar con interacción humana ni
> con correcciones al bot vía Chatwoot. Toda escalación va a **mail**. Esto descarta
> el human-in-the-loop de Chatwoot como señal de mejora y como destino de handoff;
> el confident-wrong se detecta 100% automático (flags de baja confianza + rechazo
> del cliente + auditoría offline) y lo revisa Martin desde los logs, no TG.

---

## El giro grande: NO "vocero primero"

Yo había recomendado construir el vocero primero. **Las 6 lentes, tras la ronda 2,
cambiaron de opinión y convergieron en lo contrario:** arreglar el motor de plata
determinístico + instrumentar PRIMERO, y recién después la capa de redacción humana.

Razón (red-team, la compró todo el consejo): un redactor fluido encima del bug de
plata del inc21 narra el número equivocado con prosa linda y lo ESCONDE de la
revisión semanal. Desplegar el nodo de mayor riesgo antes de tener la red
determinística rompe el propio loop de mejora.

## Los dos landmines que nadie (yo incluido) había puesto sobre la mesa

1. **Atributos estructurados = vaporware.** 5 de 6 lentes asumieron un "gate de
   validación determinístico barato" (ancho_max, faz, gramajes válidos, tiers_pack)
   para cerrar inc12 (lona 3 m > 1,52 m) e inc21 (packs). Pero el overlay `bot.*`
   HOY solo tiene display_name / sinonimos / casos_de_uso / flags. Esos atributos
   físicos probablemente viven como TEXTO LIBRE dentro del nombre en `public.products`
   (que mantiene el mostrador, no Martin). Sin modelar esa capa de atributos, el gate
   de factibilidad y la cuantización de pack NO se cierran por más nodos que apilemos.
   Es un proyecto de datos + firma de TG que nadie scopeó.

2. **El confident-wrong es invisible.** El flag `resolution_failure` solo dispara en
   estados que el sistema SABE que fallaron (sin_match/ambiguo). Pero inc15 (match
   falso-confiado: el motor devolvió "1 ganador limpio") e inc21 (precio plausible
   pero MAL) NO se autoclasifican como falla. La revisión semanal verá todos los
   sin_match ruidosos y NINGÚN mis-quote silencioso. Como TG no monitorea Chatwoot
   (restricción de arriba), la detección es 100% automática, revisada por Martin desde
   los logs: (a) **flags de baja confianza** en la resolución (margen fino entre
   candidatos, default de oficio aplicado, match débil rank-2/3); (b) **clasificador de
   rechazo del cliente** en el turno siguiente ("no, quería bookcel") como señal barata
   que vive en el bot; (c) **auditoría offline** de una muestra de TODAS las
   cotizaciones (LLM-juez batch pedido-vs-resultado), no solo las fallas autodeclaradas.
   Esto reescribe el pedido del inc11 sin poner a nadie de TG a mirar Chatwoot.

Otros dos riesgos operativos nuevos:
- **Ventana de 24 h de WhatsApp:** fuera de sesión solo se mandan plantillas
  pre-aprobadas, no texto libre. Toda la capa de voz humana asume estar dentro de
  ventana. Medir % fuera de ventana + tener plantillas humanas aprobadas de respaldo.
- **Multi-ítem goteando:** en WhatsApp real "150 tarjetas"… "y 200 a3" llega en
  mensajes separados. Sin debounce, el bot cotiza el ítem 1 (saliente PAGO) antes de
  ver el ítem 2. La segmentación intra-mensaje (P3) no sirve si los ítems gotean.

---

## Arquitectura recomendada (pipeline determinístico con LLM en los bordes)

- **PASO 0 — Debounce de entrantes (~6-10 s, Code):** coalesce mensajes fragmentados
  en UNA corrida. Baja invocaciones LLM, arregla splits multi-ítem en el origen
  (inc5/20), responde una sola vez (un saliente pago).
- **PASO 1 — LLM1 extractor/router:** emite `{intencion, items[]:{frase_cliente,
  slots:{cantidad,faz,color,tamano,material,gramaje}}}`, cada slot marcado
  `explicito|ausente`. NUNCA un nombre de catálogo, NUNCA plata. Segmenta ítems; NO
  resuelve productos. (Raíz de inc15 e inc20: hoy lo obligamos a emitir un nombre.)
  También emite `situacion` (normal / info_no_disponible / fuera_de_alcance /
  frustrado / enojo_extremo) para que el refinador final module el tono SIN re-leer el
  historial — así la voz situacional no cuesta una 3ª llamada (se mantiene el tope de 2).
- **PASO 2 — Tokenizador determinístico (Code):** separa cantidad/unidades del texto
  de producto ("150 tarjetas" → cantidad=150, producto="tarjetas"). Mata inc20.
- **PASO 3 — Matcher/rank (Code):** por ítem devuelve un SET de candidatos con score +
  slots-matcheados + slots-discriminantes-faltantes + PISO DE CONFIANZA. Nunca un pick
  único forzado. Rank-2/3 bajo umbral = ambiguo (mata el falso-positivo confiado inc15).
- **PASO 4 — Resolver (Code, determinístico):** resta slots ya conocidos (carryover,
  inc7); aplica defaults de oficio del overlay sellados por TG y marca
  `default_aplicado`; 1 rank-1 dominante → pasa; varios viables o ganador débil →
  estado de desambiguación.
- **PASO 5 — Desambiguador (escalera ordenada por costo-Meta):**
  (a) pregunta TARGETED del único eje que falta, o mostrar 2-3 opciones con precio
  inline — la SELECCIÓN (qué eje, qué candidatos) es determinística;
  (b) selector-LLM de contrato CERRADO (candidatos + slots acumulados + mensaje actual
  como DATO, salida = índice/enum, SIN historial, SIN ver plata) solo si quedan varios
  viables y el eje NO es una elección legítima del cliente;
  (c) menú determinístico cuando el eje ES la elección del cliente (packs 100/500/1000).
  El Aclarador del inc11 se FUSIONA acá con input estructurado y salida enum cerrada.
- **PASO 6 — Gate de factibilidad determinístico (Code, UPSTREAM del render):**
  ancho_max/faz/gramaje/tier pedido-vs-atributo. Violación (3 m > 1,52 m) → hard-fail a
  derivar/preguntar, NUNCA cotiza. La física nunca es juicio de LLM. **Depende del
  landmine 1 (atributos estructurados).**
- **PASO 7 — Motor de plata (Code):** matemática pack/bracket correcta y testeada;
  subtotal por ítem; precio emitido como TOKEN OPACO. El LLM nunca lo ve como número
  editable. (Arregla inc21.)
- **PASO 8 — REFINADOR final (LLM ciego a la plata), en TODO mensaje saliente:** input =
  borrador determinístico + `situacion` (de PASO 1) + montos como tokens opacos. SIN
  historial (el mensaje del cliente llega solo como etiqueta de tono, no como
  instrucción). Humaniza y **varía** cada saliente según la situación (no repite siempre
  lo mismo), agrupa multi-ítem, verbaliza el default y la derivación a mail en lenguaje
  de mostrador. Salida a UNA burbuja facturable. NO valida, NO elige producto, NO
  calcula. **Allowed-claims cerrado:** solo reformula lo que el pipeline calculó + las
  líneas fijas de alcance y mail; no inventa plazos, descuentos ni productos.
  **Política de voz:** dominio cerrado (el bot solo informa sobre TG y sus servicios);
  ante `frustrado`/`enojo_extremo` se disculpa, aclara que solo puede informar de TG y
  deriva a mail; en `enojo_extremo` puede revelar que es un bot; el humano real SIEMPRE
  por mail (misma dirección, cubre reclamos y enojo). Si el gate (PASO 9) rechaza →
  plantilla determinística, que por eso debe ser un piso aceptable de voz.
- **PASO 9 — Re-estampado + guard (Code, post-LLM):** re-inyecta los números exactos;
  regex-gate verifica tokens de precio intactos; si no calzan → descarta el texto y
  manda la plantilla determinística. Denylist anti-voz-de-máquina ("el catálogo", "la
  variante", "lo confirma el equipo", SKUs) + whitelist que bloquea internos ('1"',
  inc13). Cada rechazo se loguea como canario de alucinación de plata. **Convierte
  "el LLM nunca tipea plata" de eslogan en propiedad verificable.**
- **PASO 10 — Instrumentación:** log estructurado por turno (distribución de ranks, si
  disparó selector/menú, motivo-de-falla enum, `default_aplicado`, re-estampe
  rechazado, salientes facturables) + **señales automáticas del confident-wrong**
  (flags de baja confianza + clasificador de rechazo del cliente en el turno
  siguiente), para auditoría offline de Martin — NO corrección humana en Chatwoot.
  Plantilla determinística = golden del harness; el
  wordsmith es capa cosmética verificada por re-estampado (no perder 94/94).

**Invariantes transversales:** (1) la plata siempre llega calculada como dato y ningún
LLM emite el número final sin re-estampado+gate; (2) ningún LLM con texto del atacante
recibe historial como instrucción, solo salida cerrada; (3) Martin aplica todo cambio
de DB; (4) todo corre sobre n8n self-hosted mono-VM sin queue mode → minimizar nodos
nuevos frente al riesgo operativo.

## Partir el "vocero" en dos (consenso duro)

- **VALIDADOR determinístico de factibilidad** (paso 6), ANTES del render. Ningún LLM
  valida "3 > 1,52" ni hace aritmética: flash-lite lo falla de forma fiable.
- **WORDSMITH ciego a la plata** (paso 8), DESPUÉS. Solo redacta.
Fusionarlos (propuesta de la lente de costo, "un LLM de juicio, no dos") fue rechazado
por 5 lentes: reconcentra elegir-producto + emitir-el-mensaje-con-plata en un nodo, y
para desambiguar necesitaría historial = vector de jailbreak + modo de falla del inc11.

---

## Secuencia de construcción (reemplaza "vocero primero")

1. **INSTRUMENTAR** (costo ~cero, ningún LLM): flag `resolution_outcome` + contador de
   salientes facturables + flags de baja confianza + clasificador de rechazo del
   cliente + debounce de entrantes. Baseline sin el cual no se justifica ningún LLM
   nuevo, y única forma AUTOMÁTICA de cazar el confident-wrong (inc15/21) sin Chatwoot.
2. **FIXES DETERMINÍSTICOS PUROS** (cero-token): matemática pack/bracket con tests
   (inc21), piso de confianza en rank-2/3 (inc15), slot-carryover antes de armar menú
   (inc7), whitelist de campos internos (inc13), denylist anti-voz-de-máquina.
3. **AUDITORÍA DE ATRIBUTOS con TG** + modelado en el overlay de lo que falte
   (ancho_max, faz, gramajes válidos, tiers_pack, ejes de anillado, defaults de oficio,
   léxico de papeles). Prerrequisito del gate de factibilidad. Es data-entry de TG +
   política de negocio, no un Code node.
4. **REDISEÑAR EL CONTRATO DE LLM1** (frase+slots, no nombre) + tokenizador + matcher
   que devuelve el SET con piso de confianza. Harness con dimensión dedicada a la
   fiabilidad del flag `explicito|ausente` y a la segmentación multi-ítem rioplatense.
5. **GATE DE FACTIBILIDAD** determinístico upstream (una vez que existen los atributos).
6. **WORDSMITH CIEGO + re-estampado + regex-gate**, en toda ruta. Gate de reversión:
   si NO baja el re-ask MEDIDO, es costo puro y se revierte.
7. **SELECTOR-LLM de contrato cerrado** (desempate) GUARDADO PARA EL FINAL, solo si el
   narrowing determinístico + pregunta targeted no alcanzan. El paso más riesgoso.
8. **RE-CORRER TODO el harness sobre gemini-3.1-flash-lite** ANTES de octubre
   (2.5-flash-lite muere el 16-oct; Meta cobra desde el 1-oct, misma quincena).

---

## Desacuerdos que quedaron vivos (con recomendación del chair)

1. **Desambiguación residual (menú vs pregunta targeted vs selector-LLM vs lenguaje
   natural).** Recomendación: escalera del paso 5. "Determinístico" aplica al QUÉ (eje,
   candidatos); el LLM solo redacta el CÓMO. **Nunca un LLM eligiendo el gemelo de
   oficio: un pick confiado y equivocado cuesta una REIMPRESIÓN, no 2,6 centavos.**
2. **Fold (un LLM) vs dos LLM separados.** Recomendación: NO fusionar. Selector y
   wordsmith tienen contratos de entrada incompatibles.
3. **Una burbuja vs 2-3 burbujas.** Meta factura por BURBUJA. Recomendación: colapsar a
   una burbuja; el tono humano se logra con formato dentro (bullets por ítem), no
   multiplicando burbujas. Medir con la métrica de "suena humano" + salientes.
4. **Costo-por-mensaje:** NO "gastar LLM con liberalidad". Minimizar SALIENTES
   ESPERADOS = P(mal) × (costo del mal + corrección). Cada hop LLM sube P(mal);
   3-4 LLM al 97% = ~88-91% de turno bueno = MÁS re-asks pagos. De ahí el tope de
   2 LLM/turno (3 en desempate) y el selector-LLM como último recurso.

---

## Decisiones para Martin

1. Aprobar el rediseño del contrato de LLM1 (frase cruda + slots, no nombre de
   catálogo). Es el cambio arquitectónico más grande; toca todo aguas abajo.
2. Firmar y aplicar la tabla de defaults de oficio en el overlay (apuntes→75gr, etc.).
   Necesita el sello de TG; un default equivocado y confiado mis-cotiza en silencio.
3. Decidir si se scopea AHORA la auditoría+modelado de atributos estructurados
   (proyecto de datos con TG) o se difiere. Sin ese sustrato, inc12 e inc21 NO cierran.
4. Definir hasta dónde forzar la ilusión humana (política con TG + riesgo de confianza).
5. Aprobar el tope de 2 LLM/turno (3 en desempate) y la copy exacta del handoff humano.
6. Aprobar el gate de reversión del wordsmith (revertir si no baja el re-ask medido).
7. Validar la detección AUTOMÁTICA del confident-wrong (flags de baja confianza +
   rechazo del cliente + auditoría offline de una muestra) — sin humano en Chatwoot.
   Confirmar que la escalación es 100% a mail y con qué frase/dirección.
8. Programar la migración a gemini-3.1-flash-lite y re-correr el harness antes del 1-oct.

## Preguntas nuevas para TG (a foldear en preguntas-tg.md)

1. **Auditoría de catálogo:** ¿cuáles de estos existen HOY como campo estructurado
   consultable vs enterrados en el nombre libre → ancho_max, faz_disponibles, gramajes
   válidos, tiers_pack, ejes de anillado? (Define si el gate del inc12 es construible.)
2. **Cantidades intermedias de pack:** 150 tarjetas → ¿2 packs de 100? ¿próximo tier?
   ¿a medida? (inc21 salió mal por asumir esto.)
3. **Defaults de oficio por familia:** ¿apuntes/texto = 75gr obra s/f b/n y
   tapa/premium = 106gr? ¿Qué otros defaults por tipo de trabajo aplican?
4. **Anillado:** ¿ejes reales (plástico vs metálico/wire-o, diámetro, papel interior,
   tapas) y default cuando no se especifica? (Cierra inc7/inc13.)
5. **Léxico de papeles especiales:** ¿cómo mapea cada nombre de stock (obra 80,
   bookcel, ahuesado, ilustración) al producto real? (inc15.)
6. **Ventana de 24 h:** ¿% aprox de cotizaciones que se resuelven cuando el cliente
   retoma fuera de sesión? (Define cuántas plantillas humanas aprobadas preparar.)
7. **Escalación a mail:** ¿confirmás que TODO lo que el bot no cierra va a mail, sin
   humano tomando la conversación en WhatsApp? ¿Qué dirección y con qué frase exacta?
   (TG ya definió: automatizar al máximo, no monitorear Chatwoot.)
