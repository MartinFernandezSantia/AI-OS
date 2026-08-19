# Plan: ajustes de conducta del bot RAG-lite (saludo, ejes, handoff, verificador, topK)

> **Regla AIOS:** plan de modo plan. Al aprobarse, moverlo a
> `project-context/TerminalGrafica/whatsapp-rag-lite/plans/ajustes-saludo-ejes-handoff.md`
> y commitear en el AIOS.

## Contexto

Cinco ajustes de conducta del bot de WhatsApp de TerminalGrafica, casi todos en el prompt
del Agente (`sistema`) y el flow. Todo se genera con `scripts/build-flow.mjs`
(`pnpm flow:build`) — nunca se edita el JSON a mano. Archivo único de cambios de código:
`project-context/TerminalGrafica/whatsapp-rag-lite/scripts/build-flow.mjs` (+ un seed SQL).

Motivación (pedidos del dueño):
1. El bot se presenta SIEMPRE igual (saludo enlatado fijo) → que varíe.
2. Preguntar los ejes es largo (para impresiones pregunta uso + color + faz + cantidad de
   una) → usar defaults (b/n, simple faz) y preguntar solo lo que se aparta del default.
3. Cliente enojado / que pide un humano → cortar, no insistir con catálogo, y pasar
   contactos: mail + teléfono + local.
4. `producto_no_declarado` en el Verificador da más falsos positivos que valor → sacarlo.
5. Bajar los resultados del RAG (`topK`) de 8 a 5.

## Cambios

### 1. Saludo variado — que lo genere el LLM (nodo `Decidir` + limpieza de rama greeting)
Hoy el saludo-solo del primer mensaje se rutea a un enlatado FIJO
(`Saludo Bienvenida` = "Hola! Buenas, ¿en qué te podemos ayudar?", L1853) vía
`action: 'primer-mensaje'` en `Decidir` (L1814, bloque "PRIMER MENSAJE (F3)"). El prompt
del Agente ya tiene la etapa "1) SALUDO / INICIO" (L48-52) que saluda y se presenta solo
si es el primer contacto → basta con hacer que el saludo caiga a `process`.

- En `Decidir` (nodo Chatwoot, jsCode ~L1814): **eliminar** el bloque `PRIMER MENSAJE (F3)`
  (el `isGreetingOnly` + el `return {action:'primer-mensaje'}`). El saludo puro cae a
  `process` como cualquier mensaje → lo contesta el Agente (etapa SALUDO), naturalmente
  variado. **Nota**: hay una copia gemela de `Decidir` en el flow MAIN (no-Chatwoot).
  Buscar ambas (`grep "PRIMER MENSAJE (F3)"`) y aplicar el mismo cambio en las dos.
- Limpiar la rama muerta: quitar la regla `mkRule("rt-greeting", "primer-mensaje", ...)`
  del `switchRuteo` (L1830), el nodo `saludoBienvenida` (L1853) de la lista de nodos
  (L2068) y su conexión (L2129). (Si limpiar la rama resulta más frágil que dejarla,
  dejar el nodo huérfano es aceptable — nunca se enruta; pero preferir limpiar.)
- **Costo consciente**: el "hola" pelado ahora gasta 1 llamada LLM + latencia (antes era
  instantáneo). El prompt de SALUDO no llama tools, así que es barato. Aceptado.

### 2. Ejes binarios — preguntar por UN polo y dejar el otro implícito
**Aclaración del dueño:** NO es asumir un default para cotizar sin preguntar. La regla
"preguntá color y faz ANTES de cotizar" (porque cambian el precio) SE MANTIENE. Lo que
cambia es la FORMA de preguntar: cuando un eje es binario (color/b\&n, simple/doble faz),
preguntar por el polo "positivo" y dejar el otro IMPLÍCITO —"¿las necesitás a color?" ya
deja claro que si no, van en b/n; "¿doble faz?" implica simple si no. Así el bot no
enumera los dos polos de cada eje ni hace una pregunta separada por cada uno.

En "## Qué preguntar según el tipo de pedido" → bullet **Impresiones en papel** (L115-130):
- Reformular la frase de los ejes: en vez de "¿color o b/n? + ¿simple o doble faz?" (dos
  preguntas que listan ambos polos), una sola pregunta corta que junte los upgrades por su
  polo positivo: p.ej. "¿las necesitás a color o doble faz? (si no, van en b/n simple faz)".
  El paréntesis explicita el implícito sin convertirlo en otra pregunta.
- NO tocar la lógica de precio: color y faz se siguen resolviendo antes de cotizar; solo
  se comprime la forma de preguntarlos. Mantener "PARA QUÉ es" (define el papel) + cantidad.
- Este mismo principio (eje binario → preguntá un polo, el otro se infiere) vale también
  para **Tarjetas** (faz simple/doble, L132-137): "¿doble faz?" en vez de "¿simple o doble?".
- Revisar coherencia con "## Preguntar vs proponer" (L85-101) y "## Cómo escribir…"
  (L97-101, "preguntá SOLO los ejes, como opciones directas y cortas"): esta compresión
  refuerza esa regla, no la contradice.

### 3. Handoff por enojo / pedido de humano — cortar y pasar contactos
Hoy NO hay una regla que dispare por emoción. La info de contacto existe en `business_info`
clave `contacto` (mail + local, SIN teléfono aún) y la sirve `consultar_info_negocio`.
- **Prompt del Agente**: agregar una regla/etapa nueva (en "## Flujo" como sub-caso de
  "5) OTRO / CIERRE", o como bullet en "## Reglas siempre"): *si el cliente está
  claramente enojado/disgustado, o pide hablar con una persona/humano/encargado → NO
  insistas con el catálogo ni intentes resolver el producto; reconocé breve, y pasá los
  contactos para hablar con alguien del equipo (mail, teléfono, local). Esos datos salen
  de `consultar_info_negocio` (clave contacto), no los inventes.* Cortar = no seguir
  cotizando en ese turno.
- **Verificador**: este corte NO debe caer en `derivacion_prematura` (que penaliza empujar
  al mail sin que el cliente quiera avanzar). Agregar excepción en ese check (L424): si el
  cliente pidió humano o está molesto, dar contactos NO es derivación prematura.
- **Teléfono**: hoy NO existe en `business_info`. Agregar la fila `telefono` al seed
  `db/business-info-seed.sql` con valor `COMPLETAR: teléfono del local` — el ingest la
  saltea sola (`value not ilike 'COMPLETAR%'`) hasta que Martin la cargue. El prompt
  referencia "teléfono" pero el bot solo lo dará cuando la fila tenga valor real e ingestado.
  Actualizar el comentario de conteo de filas (L30-31) y la clave `contacto` puede
  mencionar el teléfono cuando exista (opcional; no forzar).

### 4. Sacar `producto_no_declarado` del Verificador
Da más falsos positivos que valor. Es el ÚLTIMO check de catálogo-adyacente que quedaba en
el bloque A. Quitar sus referencias (mismo patrón que la remoción del bloque B):
- `sistemaVerif`: borrar el bullet `producto_no_declarado` (L427) y sacarlo del enum del
  JSON de salida (L435).
- `esquemaVerif`: sacar `"producto_no_declarado"` del enum de `tipo` (L465).
- `sistemaCorrector`: borrar el bullet `producto_no_declarado` (L495).
- Sticky note del Verificador (L1263): sacar la mención a `producto_no_declarado`.
- Quedan 5 checks de política: `no_trabajado`, `info_no_permitida`, `derivacion_prematura`,
  `pedido_o_archivo_por_canal`, `fuera_de_rol`. Nada aguas abajo se rompe (el ruteo depende
  de `accion`, no de los tipos). Actualizar README (L106+) que lista los checks.

### 5. topK del RAG: 8 → 5
En el nodo `buscar_catalogo` (vectorStorePGVector, L918): `topK: 8` → `topK: 5`. Cambio de
una línea. Sin efecto en tipos ni tests.

## Verificación
1. `pnpm flow:build` regenera ambos flows (MAIN + chatwoot) sin errores.
2. `pnpm exec tsc --noEmit` OK; `pnpm test` verde (los tests son de ingesta/chunk; ninguno
   cubre el prompt ni el ruteo, así que siguen pasando).
3. greps de control:
   - `grep -c "primer-mensaje" scripts/build-flow.mjs` → 0 (rama greeting eliminada) o solo
     comentarios si se dejó el nodo huérfano.
   - `grep -c "producto_no_declarado" scripts/build-flow.mjs` → 0.
   - `grep "topK" scripts/build-flow.mjs` → `topK: 5`.
   - `grep "telefono" db/business-info-seed.sql` → fila COMPLETAR presente.
4. Revisión de humo del flow MAIN y chatwoot: el saludo puro rutea a `process`; no hay
   nodos colgados.
5. **Prueba en chat (tras re-importar en n8n):**
   - "hola" → saludo generado por el LLM (varía entre conversaciones), se presenta si es
     primer contacto.
   - "necesito imprimir apuntes, 50 hojas" → hace UNA pregunta corta por los ejes binarios
     ("¿a color o doble faz? si no, van en b/n simple faz") en vez de 2-3 preguntas separadas;
     recién con la respuesta cotiza.
   - "esto es un desastre, quiero hablar con alguien" → reconoce, corta, pasa mail +
     teléfono (cuando exista) + local; el Verificador no lo marca derivacion_prematura.

## Pendientes del dueño (fuera del código)
- Cargar el teléfono real en `business_info` y correr `pnpm rag:ingest:info --apply`.
- Re-importar AMBOS flows en n8n para que los cambios entren en efecto.

## Cierre
Commits separados por tópico (saludo / ejes / handoff+telefono / verificador / topK, o
agrupados razonablemente). Mover este plan a `whatsapp-rag-lite/plans/`.
