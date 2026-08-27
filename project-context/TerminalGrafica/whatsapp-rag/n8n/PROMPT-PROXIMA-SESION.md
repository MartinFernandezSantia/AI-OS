# Prompt de arranque — sesión de prueba en vivo (Fase 3 → 4)

Copiar el bloque de abajo tal cual al empezar la sesión. Requiere el MCP `n8n-tg` ya
autenticado (`/mcp` → n8n-tg → Authenticate).

---

```
Sesión de PRUEBA EN VIVO del bot cotizador de Terminal Gráfica (Fase 3 → 4).

Leé primero project-context/TerminalGrafica/whatsapp-rag/HANDOFF.md y después
project-context/TerminalGrafica/whatsapp-rag/n8n/README.md.

Novedad importante: ya tenés el MCP de n8n autorizado (n8n-tg →
https://n8n.terminalgrafica.cloud/mcp-server/http, scope execution:read entre otros).
Podés LEER las ejecuciones vos mismo. Empezá listando las tools del MCP para ver con qué
contás antes de pedirme nada.

Estado: el flow ya está construido (n8n/flows/cotizador-v1.json, 12 nodos, generado por
n8n/build-flow.mjs) y la ingesta a bot.rag_catalog ya está hecha, con escala + es_base en
la metadata. Lo que falta es probarlo en vivo.

Plan:
1. Decime si el workflow ya está importado en n8n o si lo tengo que importar yo. Si podés
   verlo por el MCP, verificá el cableado (credenciales, tableName schema-cualificado
   bot.rag_catalog, el sub-nodo de embeddings colgado de buscar_catalogo).
2. Smoke test de retrieval: que buscar_catalogo devuelva chunks reales y que la metadata
   traiga escala + geometria + es_base. Si algo no está, paramos ahí.
3. Los 4 casos de humo (están en el handoff con qué mirar cuando fallan). Yo los tipeo en
   el chat de n8n y vos leés la ejecución: la salida estructurada del agente y el veredicto
   del auditor. No me pidas que te copie el resultado si lo podés leer.
4. Si los 4 pasan, arrancamos la Fase 4 con los 46 casos de la hoja "Casos de prueba".

Reglas de esta sesión:
- No deduzcas qué pasó en una ejecución: leela. Si no la podés leer, decímelo y pedime el
  dato — no lo inventes (en el bot viejo eso ya salió mal dos veces).
- Cuando un caso falle, decime QUÉ falló (rinde / tramo / aritmética / retrieval), no solo
  que el número no dio. El auditor está hecho para eso.
- Si el arreglo es del prompt o del auditor, se toca el Excel o n8n/build-flow.mjs y se
  regenera el flow — nunca editar el JSON a mano.
```

---

## Contexto que la sesión va a necesitar (ya está en el handoff, acá por comodidad)

**Los 4 casos de humo:**

| Escribir en el chat | Total | Ejercita |
|---|---|---|
| `250 stickers 3x3` | $6.600 | camino pliego completo |
| `100 stickers en vinilo UV 5x5` | $14.000 | m2 + mínimo facturable |
| `10 stickers 3x3` | $4.000 | mínimo por trabajo (presentado como CANTIDAD) |
| `1 lona de 90x60` | $8.600 | redondeo al múltiplo más cercano |

**Comandos:**

```bash
cd project-context/TerminalGrafica/whatsapp-rag
node n8n/build-flow.mjs           # tests + re-emite flows/cotizador-v1.json
node n8n/build-flow.mjs --test    # solo los 46 casos + 11 rindes, no escribe
node n8n/test-auditor.mjs         # los nodos Code contra el JSON emitido
```

**Si hay que re-generar el flow y re-importarlo**, ojo con lo que se pierde: las
credenciales cableadas en la UI. Verificar que el import las mantenga o re-cablearlas.
