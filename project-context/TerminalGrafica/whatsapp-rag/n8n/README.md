# n8n — el workflow del bot cotizador (Fase 3)

Punto de arranque de la sesión de BUILD. El plan está en
[`../plans/workflow-n8n-v1.md`](../plans/workflow-n8n-v1.md); acá va lo operativo.

## Qué hay hoy

| Archivo | Qué es |
|---|---|
| `build-flow.mjs` | **El builder.** Emite `flows/cotizador-v1.json` con el prompt, el schema de salida y el auditor (parámetros del Excel horneados). Aborta si el auditor no reproduce el Excel. |
| `test-auditor.mjs` | Test de los nodos Code contra el JSON emitido: formas de dato raras, turnos sin cotizaciones, material inventado, veredicto en el mensaje. |
| `armar-prompt.mjs` | Arma el system prompt: plantilla + 3 inyecciones del Excel. Con gate de tokens. Lo importa el builder. |
| `prompt-final.txt` | La salida del anterior: el prompt tal cual lo ve el modelo. Generado, no editar. |
| `flows/cotizador-v1.json` | **Generado.** Lo que se importa en n8n. No editar a mano: se pisa en la próxima generación. |
| `volcar-casos.mjs` | Vuelca la hoja `Casos de prueba` a `casos.json`, para correr la Fase 4 contra el bot en vivo. |
| `listar-casos.mjs` | Los casos en una línea cada uno, para tenerlos a la vista. |
| `materiales-huerfanos.mjs` | Materiales con precio y sin productos: los que NO generan chunk y el bot no puede cotizar. |
| `../plans/system-prompt-v1.md` | **La plantilla** — esto SÍ se edita cuando se quiere cambiar el prompt. |

```bash
node n8n/build-flow.mjs           # tests + emite flows/cotizador-v1.json
node n8n/build-flow.mjs --test    # solo los tests (46 casos del Excel), no escribe
node n8n/test-auditor.mjs         # test de los nodos Code, contra el JSON ya emitido
node n8n/armar-prompt.mjs         # solo el prompt: regenera prompt-final.txt y mide
```

Estado: prompt **~1.889 tokens** (objetivo 2.000, techo duro 3.000 — aborta si se pasa).
Flow: **12 nodos**. Cotizador: **46/46 casos del Excel** + los 11 rindes históricos.

## El cambio grande: el LLM no escribe precios

La Fase 4 con el modelo calculando midió **27/46**. Los fallos no compartían causa
(aritmética suelta, tramo mal elegido, unidades m2 truncadas, rinde mal), y el mismo pedido
llegó a dar $6.600 y $7.000 en dos ejecuciones con todos los pasos intermedios correctos.

Ahora el modelo declara QUÉ cotizar y escribe `{P1}`, `{P2}`… en el mensaje; el nodo Code
calcula el total desde el catálogo y el Responder lo inyecta. Ver "El cotizador" abajo.

## El flow construido (13 nodos)

```
Chat Trigger
   └─ Agente (AI Agent, systemMessage = prompt-final.txt)
        │   onError: continueRegularOutput ← el turno NO puede morir sin respuesta
        ├─ Modelo: Google Gemini nativo → models/gemini-3.1-flash-lite
        ├─ Memoria: Simple Memory (window 10, sessionId del Chat Trigger)
        ├─ Tool buscar_catalogo: PGVector → bot.rag_catalog (topK 3)
        │    └─ Embeddings Google Gemini: models/gemini-embedding-001
        └─ Salida · Agente (schema del desglose, autoFix ON)
             └─ Modelo · Corrector: el reintento que exige autoFix
   └─ Materiales Declarados (Code: abre las cotizaciones en 1 item por material)
   └─ Traer Escalas (Postgres: metadata del material declarado)
   └─ Auditar Cotización (Code: re-cálculo determinista + sanity)
   └─ Responder (mensaje + veredicto + fallback si el parser falló)
```

Credenciales que pide al importar (2, no 4): **Google Gemini(PaLM) API** — la MISMA para
el chat, los embeddings y el corrector — y **BOT_DB** (PGVector + Traer Escalas; pooler
5432, user `bot_runtime.<ref>`, SSL Ignore). El propio flow lleva una Nota con esto.

**El turno nunca muere en silencio.** Medido: 4 de 21 turnos (~19%) terminaban en error con
"Invalid JSON in model output" —el modelo contesta en prosa, sobre todo cuando NO cotiza— y
el cliente no recibía NADA. Dos defensas, que atacan mitades distintas:
- `autoFix` en el parser: reintenta con el LLM y **recupera el turno**.
- `onError` + fallback en el Responder: si aun así falla, **sale un mensaje** de falla
  técnica (distinto del de "no puedo cotizar esto", que manda a TG trabajo real).
El fallo queda registrado igual, como hallazgo y en `via` de la salida — sin ese rastro el
arreglo vuelve el problema invisible: la ejecución sale verde y nadie sabe cuántas veces pasa.

**Cambio contra el plan**: el chat va por **Gemini nativo**, no OpenRouter. El bot lite ya
había migrado (`lmChatGoogleGemini`) después de escrito el plan; nativo comparte credencial
con los embeddings — una menos que cablear, y es el camino ya probado en este n8n. Volver a
OpenRouter es cambiar `GEMINI_MODEL` y el `type` del nodo Modelo en el builder.

**Dos nodos Code que no estaban en el plan**, ambos por el mismo footgun de n8n (un nodo que
emite 0 items no ejecuta a los que siguen, y el turno muere sin respuesta):
- **Materiales Declarados**: el Agente emite 1 item con N cotizaciones, pero Traer Escalas
  necesita una query por material. Deduplica, y ante un turno sin cotizaciones emite igual
  un item marcado para que la rama no se corte.
- **Traer Escalas** lleva `alwaysOutputData` por lo mismo: sin filas (material inventado)
  el auditor tiene que ejecutar igual — justamente para reportar que no está en el catálogo.

## Salida estructurada del agente (el contrato)

El modelo declara SOLO lo que puede saber sin calcular. Un item por cotización del turno,
en el MISMO orden que los marcadores del mensaje; `[]` si el turno no cotiza.

```
respuesta           string   el mensaje, con {P1}, {P2}… donde van los precios
cotizaciones[]:
  material_catalogo string   EXACTO como vino de la tool
  ancho_cm, alto_cm number   la medida de UNA pieza
  cantidad          number   piezas pedidas
```

Todo lo demás —modo, rinde, unidades cobradas, tramo, mínimo, redondeo, total— lo deriva el
nodo Code del catálogo. El modo en particular **lo manda el catálogo**: el modelo ya ni lo
declara, porque la unidad del material es la que decide cómo se cobra.

## El cotizador (nodo Code) — construido

Calcula el total con la metadata del chunk (`escala`, `geometria`, `modo`) y lo devuelve
para que el Responder lo inyecte en `{P1}`, `{P2}`… El modo **lo manda el catálogo**, no el
modelo.

**Regla dura del Responder: un marcador sin precio NUNCA sale al chat.** Si una cotización
no se pudo calcular (la pieza no entra en el pliego, material fuera del catálogo, total
fuera de rango), el mensaje entero se reemplaza por una derivación a consulta. Derivar de
más es preferible a mandar `{P1}` crudo o un precio inventado — en la Fase 4 con el LLM
calculando, el bot llegó a cotizar $5.000 por algo que no entra en el pliego.

Lo mismo si el modelo **tipea un precio a mano** ignorando el marcador: ese número no pasó
por el cálculo, así que se deriva. Es la única forma de que el contrato no tenga fuga.

Qué reporta como hallazgo (ya no "el bot calculó mal", sino "el modelo se salió del
contrato"): material que no existe en el catálogo · no cotizable · precios escritos a mano ·
marcadores que no cuadran con las cotizaciones declaradas.

**La cuarta copia de la fórmula de encaje, resuelta.** El builder la tiene como un ÚNICO
string (`FUENTE_RINDE`): lo evalúa para correr los tests y lo emite tal cual dentro del nodo
Code. No hay dos textos que sincronizar. Igual con el re-cálculo completo (`FUENTE_COTIZAR`).

**El gate del build**: antes de emitir nada, el builder corre los 11 rindes históricos y los
**46 casos de la hoja `Casos de prueba`** contra ese mismo código. Si el auditor no reproduce
la planilla del cliente, **el build falla y no escribe el JSON**. Donde el Excel declara el
rinde esperado, también se verifica: un total correcto con el rinde equivocado sería una
coincidencia que enmascara un bug.

### Un bug que encontró ese gate

El primer auditor buscaba el tramo con `n >= desde`, y los materiales m2 tienen un solo
tramo `Desde 1` (tarifa plana). Media lona = 0,54 m2 → no matcheaba ningún tramo → "no
cotizable". 9 de los 46 casos en rojo. Fix fiel al Excel: el **primer** tramo cubre todo lo
que quede por debajo de su `desde` (no existe un tramo más barato que el primero, y las
escalas por volumen solo viven en modo pliego, donde las unidades son enteras).

## Fase 4 — los 46 casos, medidos en vivo

Corridos por el MCP de n8n (`execute_workflow` + `get_workflow_execution`, un `sessionId`
por caso). `node n8n/volcar-casos.mjs` vuelca la hoja a `casos.json` para tenerlos a mano.

| | LLM calculando | Nodo calculando |
|---|---|---|
| Aciertos | **27/46** (59%) | **44/46** (96%) |

Las cinco clases de fallo aritmético desaparecieron: aritmética suelta, tramo mal elegido,
unidades m2 truncadas al mínimo facturable, rinde mal, y el caso grave (cotizar algo que no
entra en el pliego). También se arreglaron los dos casos donde el modelo elegía mal el
material — probablemente por el prompt más corto.

Lo que quedó de los 2 restantes:

- **Caso 43 — no era medible.** Pedía `Papel autoadhesivo solo impresión`, un material con
  precio cargado pero SIN productos: no genera chunk, el bot no puede verlo. Cotizó el
  troquelado, que es lo razonable con lo que tenía. Sobre los casos acertables el resultado
  es 44/45. El visor ahora lo AVISA (ver abajo).
- **Caso 44 — el comportamiento es correcto, el mensaje no.** Ya no cotiza: deriva a
  consulta. Pero el texto arrastra la cola de debug (`⚠ auditoría:` + `(marcadores sin
  precio: {P1})`), que es deliberada para medir y hay que sacar antes de producción.

Detalle menor (caso 45): el mínimo se presenta sin decir "precio mínimo" ni que el pedido es
chico — bien — pero tampoco dice la cantidad ("te llevás hasta 104"), que el prompt pide. El
dato está en `piezas_por_unidad` de la auditoría, sin usar.

### 4 materiales del catálogo no tienen chunk

`node n8n/materiales-huerfanos.mjs` los lista. Tienen precio en la hoja Materiales pero
ningún producto que los use, y como el chunk es colección+material, **no existen para el
bot**: `Papel autoadhesivo solo impresión`, `OPP brillo`, `OPP plata/holográfico/cristal o
mate`, `Vinilo y lona UV con blanco o barniz`. Los tres últimos son las variantes "sin
troquelar" de materiales que sí están.

Es una decisión del cliente: o se les carga un producto, o salen de la lista de precios.
Mientras tanto el bot cotiza el material troquelado más parecido, que puede ser más caro.
El visor lo avisa al ingestar (`avisos()` en `visor/lib/chunk.ts`).

## Trampas conocidas

- **El bot solo ve el `text` del embedding.** Nada de deícticos sin referente escrito al
  lado ("la colección", "este material"). Ya mordió una vez.
- **La PARTE 1 del Excel le habla a quien edita la planilla**, no al bot: menciona hojas
  y columnas. `armar-prompt.mjs` re-apunta esas referencias y **falla el build** si el
  cliente reescribe esas líneas (mejor romper que mandar un prompt que hable de hojas).
- **Mismo modelo de embeddings** en ingesta y query, o los vectores no comparan.
- **Sin debounce en v1**: cada mensaje dispara una ejecución. Es a propósito (chat de
  prueba); vuelve en Fase 5.
