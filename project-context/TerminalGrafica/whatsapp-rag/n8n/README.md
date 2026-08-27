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
| `../plans/system-prompt-v1.md` | **La plantilla** — esto SÍ se edita cuando se quiere cambiar el prompt. |

```bash
node n8n/build-flow.mjs           # tests + emite flows/cotizador-v1.json
node n8n/build-flow.mjs --test    # solo los tests (46 casos del Excel), no escribe
node n8n/test-auditor.mjs         # test de los nodos Code, contra el JSON ya emitido
node n8n/armar-prompt.mjs         # solo el prompt: regenera prompt-final.txt y mide
```

Estado: prompt **~2.029 tokens** (objetivo 2.000, techo duro 3.000 — aborta si se pasa).
Flow: **12 nodos**. Auditor: **46/46 casos del Excel** + los 11 rindes históricos.

## Lo primero de la próxima sesión

1. **RE-INGESTAR** desde el visor (`cd visor && pnpm dev`, subir el .xlsx, ingestar).
   `bot.rag_catalog` todavía tiene los chunks viejos: sin `escala` ni `es_base` en la
   metadata, y sin las líneas de colección/material/hermanos. **El auditor y la etapa
   COTIZAR del prompt dependen de esto.**
2. Importar `flows/cotizador-v1.json` en n8n, cablear credenciales (ver la Nota del propio
   flow), smoke test de retrieval.
3. Los 4 casos de humo (abajo).

## El flow construido (12 nodos)

```
Chat Trigger
   └─ Agente (AI Agent, systemMessage = prompt-final.txt)
        ├─ Modelo: Google Gemini nativo → models/gemini-3.1-flash-lite
        ├─ Memoria: Simple Memory (window 10, sessionId del Chat Trigger)
        ├─ Tool buscar_catalogo: PGVector → bot.rag_catalog (topK 3)
        │    └─ Embeddings Google Gemini: models/gemini-embedding-001
        └─ Salida · Agente (schema del desglose de cotización)
   └─ Materiales Declarados (Code: abre las cotizaciones en 1 item por material)
   └─ Traer Escalas (Postgres: metadata del material declarado)
   └─ Auditar Cotización (Code: re-cálculo determinista + sanity)
   └─ Responder (mensaje + veredicto visible en el chat de prueba)
```

Credenciales que pide al importar (2, no 3): **Google Gemini(PaLM) API** — la MISMA para
el chat y los embeddings — y **BOT_DB** (PGVector + Traer Escalas; pooler 5432, user
`bot_runtime.<ref>`, SSL Ignore). El propio flow lleva una Nota con esto.

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

## Salida estructurada del agente (contrato con el auditor)

Un item por cotización del turno; `[]` si el turno no cotiza (saludo, repregunta).

```
material_catalogo   string   EXACTO como vino de la tool
modo                enum     pliego | m2
ancho_cm, alto_cm   number   la medida de UNA pieza
cantidad            number   piezas pedidas
rinde               number   piezas por unidad de cobro (solo modo pliego)
unidades_cobradas   number   pliegos, o m2 facturados
precio_tramo        number   el precio unitario del tramo que aplicó
aplico_minimo       bool     mínimo por trabajo o facturable
aplico_redondeo     bool
total                number   el número que le dijo al cliente
```

## El auditor (nodo Code) — construido

Re-calcula con la metadata del chunk (`escala`, `geometria`, `modo`) y compara contra lo
declarado. **En v1 NO corrige: muestra** — el veredicto va pegado al mensaje del chat
(`⚠ auditoría: rinde declarado 40, calculado 104`). Estamos midiendo, queremos ver los fallos.

Qué chequea, en orden: material que existe en el catálogo · modo (lo manda el catálogo, no
el modelo) · rinde · unidades cobradas · precio del tramo · total. Cada uno reporta por
separado a propósito: en Fase 4, *qué* falló (rinde ≠ tramo ≠ aritmética) es lo que decide
si se sube de tier de modelo o se ajusta el chunk.

Sanity floor, corre SIEMPRE aunque el desglose venga vacío o roto: total > 0 · total ≥
mínimo por trabajo · múltiplo del redondeo · tope de magnitud ($600.000, derivado del caso
más caro del catálogo ×8, así no envejece a mano). Más un chequeo suelto: **precio en el
texto sin desglose estructurado** — el caso que más queremos ver, porque es un número que
llegó al cliente sin poder auditarse.

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

## Casos de humo (antes de la Fase 4 con los 46)

| Pedido | Total | Qué ejercita |
|---|---|---|
| 250 stickers 3x3 | $6.600 | camino pliego completo |
| 100 stickers en vinilo UV 5x5 | $14.000 | m2 + mínimo facturable |
| 10 stickers 3x3 | $4.000 | mínimo por trabajo (y que se presente como CANTIDAD) |
| 1 lona de 90x60 | $8.600 | redondeo |

Los 46 casos completos están en la hoja `Casos de prueba` del Excel.

## Trampas conocidas

- **El bot solo ve el `text` del embedding.** Nada de deícticos sin referente escrito al
  lado ("la colección", "este material"). Ya mordió una vez.
- **La PARTE 1 del Excel le habla a quien edita la planilla**, no al bot: menciona hojas
  y columnas. `armar-prompt.mjs` re-apunta esas referencias y **falla el build** si el
  cliente reescribe esas líneas (mejor romper que mandar un prompt que hable de hojas).
- **Mismo modelo de embeddings** en ingesta y query, o los vectores no comparan.
- **Sin debounce en v1**: cada mensaje dispara una ejecución. Es a propósito (chat de
  prueba); vuelve en Fase 5.
