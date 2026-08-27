# n8n — el workflow del bot cotizador (Fase 3)

Punto de arranque de la sesión de BUILD. El plan está en
[`../plans/workflow-n8n-v1.md`](../plans/workflow-n8n-v1.md); acá va lo operativo.

## Qué hay hoy

| Archivo | Qué es |
|---|---|
| `armar-prompt.mjs` | Arma el system prompt: plantilla + 3 inyecciones del Excel. Con gate de tokens. **Ya anda.** |
| `prompt-final.txt` | La salida del anterior: el prompt tal cual lo va a ver el modelo. Generado, no editar. |
| `../plans/system-prompt-v1.md` | **La plantilla** — esto SÍ se edita cuando se quiere cambiar el prompt. |

```bash
node n8n/armar-prompt.mjs     # regenera prompt-final.txt y mide
```

Estado: **~2.029 tokens** (objetivo 2.000, techo duro 3.000 — el script aborta si se pasa).

## Lo primero de la próxima sesión

1. **RE-INGESTAR** desde el visor (`cd visor && pnpm dev`, subir el .xlsx, ingestar).
   `bot.rag_catalog` todavía tiene los chunks viejos: sin `escala` ni `es_base` en la
   metadata, y sin las líneas de colección/material/hermanos. **El auditor y la etapa
   COTIZAR del prompt dependen de esto.**
2. **`build-flow.mjs`** — importa `armarPrompt` de acá y emite `flows/cotizador-v1.json`.
3. Importar en n8n, cablear credenciales, smoke test de retrieval.
4. Los 4 casos de humo (abajo).

## El flow a construir (~10 nodos)

```
Chat Trigger
   └─ Agente (AI Agent, systemMessage = prompt-final.txt)
        ├─ Modelo: OpenRouter → gemini-3.1-flash-lite
        ├─ Memoria: Simple Memory (window ~10, sessionId del Chat Trigger)
        ├─ Tool buscar_catalogo: PGVector → bot.rag_catalog (topK 3)
        │    └─ Embeddings Google Gemini: models/gemini-embedding-001
        └─ Salida estructurada (desglose de cotización)
   └─ Traer Escalas (Postgres: metadata del material declarado)
   └─ Auditar Cotización (Code: re-cálculo determinista + sanity)
   └─ Responder (mensaje + veredicto visible en el chat de prueba)
```

Credenciales que pide al importar: **OpenRouter** (chat), **Google AI Studio**
(embeddings — el MISMO modelo que la ingesta o los vectores no comparan), **BOT_DB**
(PGVector + Traer Escalas; pooler 5432, user `bot_runtime.<ref>`, SSL Ignore).

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

## El auditor (nodo Code)

Re-calcula con la metadata del chunk (`escala`, `geometria`, `unidad`) y compara contra
lo declarado. **En v1 NO corrige: muestra** (`⚠ auditoría: rinde declarado 40, calculado 24`).
Estamos midiendo, queremos ver los fallos.

Sanity floor, aunque el desglose venga vacío o roto: total > 0 · total ≥ mínimo por
trabajo · múltiplo del redondeo · tope de magnitud (el caso más caro del catálogo hoy es
$64.000; usar algo como $500.000).

**Ojo — cuarta copia de la fórmula de encaje.** Ya vive en `visor/lib/geometria.ts` y
`visor/scripts/lib-xlsx.mjs`. El nodo Code va a ser la tercera implementación (cuarta
copia). Emitirla desde el builder a partir de un único string, y fijar los 7 rindes
históricos como test.

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
