# Plan — Bot WhatsApp RAG hipersimplificado (TerminalGrafica)

> **Estado:** IMPLEMENTADO 2026-08-07 (Fases 0-3). Falta que Martin aplique el SQL,
> corra la ingesta con su `OPENROUTER_API_KEY` e importe el flow a n8n. Ver "Verificación".

## Context

El bot de WhatsApp v10 de TerminalGrafica (imprenta) resuelve productos con una cadena
léxica pesada: LLM Selector con tool `explorar_catalogo` → tokenizador → SQL con scoring
IDF → LLM Relevancia → precios deterministas, todo envuelto en firewall de 2 tiers,
guardrails, debounce, verificador y loops de reintento (~78 nodos, 6 agentes LLM).

Martin quiere una **versión alternativa hipersimplificada** para experimentar, reemplazando la
búsqueda léxica por un **RAG con embeddings** (pgvector + modelo de embeddings de Google, que es
el proveedor LLM que ya usan). Objetivo: que Martin le dispare preguntas **internamente vía un
nodo de Chat de n8n** (sin webhook de Chatwoot, sin WhatsApp) y el bot le diga qué producto(s)
recomienda. Sin firewall, sin error handling grande, sin nodos Code complejos ni SQL forzado.

Diseño discutido y criticado con Fable. Correcciones clave que incorpora sobre la idea inicial:
chunk RAG dedicado (no reusar `lineaLLM`, que trae ruido de marcas de precio y depende del
estado de curación), **mantener HMAC + check de assignee** (no son "firewall", protegen un
endpoint público y evitan pisar a un humano), **guard de nicho como filtro DURO en la RPC**
(no dejárselo a la similitud del embedding), **sin índice HNSW** (catálogo ~88 productos → seq
scan instantáneo), y **reingesta = truncate+insert completo** (full re-embed cuesta ~$0,002).

## Decisiones tomadas por Martin

- **Alcance:** solo construir el bot lite (Fases 0-3). Sin la fase de evaluación A/B offline
  contra el IDF actual — se evalúa a ojo probándolo.
- **Interfaz:** prueba interna vía **nodo de Chat de n8n** (Chat Trigger). Sin webhook de
  Chatwoot, sin HMAC, sin salida a WhatsApp. Cero riesgo de tocar el inbox real.
- **Embeddings:** vía **OpenRouter** (una sola cuenta, la que ya tienen). Ver "Nota OpenRouter".
- **Dimensiones:** **1536** (Matryoshka, valor recomendado por encima de 1000). Storable y hasta
  indexable en pgvector si algún día hiciera falta.
- **Precios:** **sin montos en v0**. Recomienda producto(s) y ofrece cotizar. La tabla igual
  guarda el rango para poder activarlo después con un cambio de una línea en el prompt.

## Organización de los chunks (aclaración)

**Un chunk = un producto entero**, unidad semántica completa y autocontenida (nombre + sinónimos
+ casos de uso + rubro + variantes). NO se parte por longitud, así que no hay palabra cortada ni
necesidad de "traer los 2 chunks vecinos" (esa técnica es para documentos largos partidos por
tamaño; acá los vecinos serían productos sin relación y ensuciarían la recomendación). El contexto
jerárquico legítimo (rubro, variantes) ya viaja dentro del propio chunk/fila. *Opción futura, no
en v0:* que el Compositor reciba también los productos "hermanos" del mismo rubro del top-1 para
responder "¿tenés algo parecido?".

## Arquitectura

```
INGESTA (offline, script Node):
  export JSON del catálogo → chunkRAG() por producto → embeddings (RETRIEVAL_DOCUMENT)
  → truncar a 1536 dims + L2-normalizar → bot.producto_embeddings (truncate+insert)

CONSULTA (CLI de prueba, y nodo Chat de n8n):
  pregunta → embedding (RETRIEVAL_QUERY) → bot.match_productos(vector, k, flags nicho)
  → top-8 candidatos → LLM Compositor → respuesta en el chat
```

## Fase 0 — DDL en Supabase (Martin aplica a mano)

**Archivo nuevo:** `project-context/TerminalGrafica/whatsapp-automation/db/rag-embeddings.sql`

Sigue el patrón de la casa (`db/firewall-tier1.sql`): idempotente, `DO $$` condicional para
grants a `bot_readonly`, comentarios explicando cada decisión. Se aplica en el SQL Editor.
Contenido: `create extension vector` + tabla `bot.producto_embeddings` + RPC `bot.match_productos`
+ grants. DDL de referencia:

```sql
create extension if not exists vector with schema extensions;

create table if not exists bot.producto_embeddings (
  producto_id      uuid primary key references public.products(id) on delete cascade,
  nombre_canonico  text not null,
  chunk_text       text not null,          -- lo que se embebió; el Compositor ve esto
  content_hash     text not null,          -- sha256(chunk|modelo|dims) — observabilidad, no skip
  rubro            text,                   -- display del rubro padre
  familias         text[] not null default '{}',
  nicho            text,                   -- 'medicina' | 'inmobiliarias' | null (de atributos)
  precio_desde     numeric,                -- solo variantes limpias; null si no hay (no se usa en v0)
  precio_hasta     numeric,
  precio_confiable boolean not null default false,
  embedding        extensions.vector(1536) not null,  -- truncado Matryoshka, L2-normalizado
  modelo           text not null default 'gemini-embedding-001',
  embedded_at      timestamptz not null default now()
);
-- SIN índice HNSW/IVF a propósito: ~90 filas → seq scan exacto. Agregar recién si supera ~10k.

create or replace function bot.match_productos(
  query_embedding       extensions.vector(1536),
  match_count           int     default 8,
  mencion_medicina      boolean default false,
  mencion_inmobiliarias boolean default false
) returns table (
  producto_id uuid, nombre_canonico text, chunk_text text, rubro text, nicho text,
  precio_desde numeric, precio_hasta numeric, precio_confiable boolean, similitud double precision
) language sql stable
security definer                              -- patrón de la casa: bot_readonly solo EXECUTE
set search_path = bot, public, extensions
as $$
  select e.producto_id, e.nombre_canonico, e.chunk_text, e.rubro, e.nicho,
         e.precio_desde, e.precio_hasta, e.precio_confiable,
         1 - (e.embedding <=> query_embedding) as similitud
  from bot.producto_embeddings e
  where e.nicho is null                                        -- guard de nicho: réplica exacta
     or (e.nicho = 'medicina'      and mencion_medicina)       -- de la semántica del SQL de v10
     or (e.nicho = 'inmobiliarias' and mencion_inmobiliarias)  -- (metadata dura, nunca similitud)
  order by e.embedding <=> query_embedding
  limit greatest(1, least(match_count, 12));
$$;

revoke all on function bot.match_productos(extensions.vector,int,boolean,boolean) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname='bot_readonly') then
    grant usage on schema bot to bot_readonly;
    grant execute on function bot.match_productos(extensions.vector,int,boolean,boolean) to bot_readonly;
  end if;
end $$;
```

Notas: `security definer` + `search_path` fijo evita darle a `bot_readonly` SELECT sobre la
tabla (mismo patrón que `bot.firewall_check`). Sin umbral de similitud en la RPC: se devuelven
siempre 8 y el Compositor descarta (un umbral mal calibrado es la causa clásica de "no encontré
nada").

## Fase 1 — Chunking + ingesta (repo del dashboard)

Repo: `projects/TerminalGrafica/whatsapp-automation/`. **No** poner los scripts bajo `app/`
(su `AGENTS.md` avisa de breaking changes de Next; los scripts corren con `tsx`, no tocan Next).

**Archivos nuevos:**
- `lib/catalog/rag-chunk.ts` — `chunkRAG(producto, rubrosById)` → `{texto, title, hash, metadata}`.
  Función pura, deriva todo del export (no de `ProdState`). Toma la *forma* de `lineaLLM`
  (`lib/catalog/effective.ts:52`) pero **sin las marcas `*`/`**`** de `marca()`, y **enriquecida**
  con rubro padre y atributos como texto (`material`, `tecnologia`). Formato del chunk:
  ```
  Cartelería en PVC c/Papel obra — rubro: Cartelería.
  También llamado: cartel de PVC, cartel rígido.
  Sirve para: carteles de obra, señalización exterior.
  Material: PVC. Tecnología: impresión directa.
  Opciones: 40x30, 60x40, 100x70, 140x100.
  ```
  Filtros: producto `oculto=false`, variantes no ocultas fuera del texto. `precio_desde/hasta/
  confiable` calculados solo de variantes limpias (reusa la semántica de `marca()`), guardados
  como metadata pero **no usados en v0**.
- `lib/catalog/__tests__/rag-chunk.test.ts` — junto a los tests existentes: producto con nicho,
  producto oculto excluido, variantes ocultas fuera del texto, precio no confiable → null.
- `scripts/rag-ingest.ts` — CLI: lee `db/export-actualizado-catalogo.json` (reusa
  `lib/catalog/loader.ts` + `types.ts`) → `chunkRAG()` → embeddings vía OpenRouter (batch, ver
  Nota) → truncar a 1536 + L2-normalizar. Salida: **`--sql` (default)** genera
  `rag-embeddings-data.sql` (`truncate bot.producto_embeddings; insert ...`) que Martin aplica
  con psql/SQL Editor (encaja con su workflow de SQL a mano); **`--apply`** hace upsert directo
  vía `pg`. El SQL con vectores **no se commitea** (~1 MB de ruido). Env: cred de OpenRouter,
  `DATABASE_URL` (solo `--apply`).

## Fase 2 — CLI de consulta (el "dispararle preguntas" sin Chatwoot)

**Archivo nuevo:** `scripts/rag-query.ts`
`npx tsx scripts/rag-query.ts "sirve para plotear un plano a1?"` → embebe (RETRIEVAL_QUERY) →
`bot.match_productos` → imprime el ranking con similitudes. Flags `--medicina` / `--inmobiliarias`
para probar el guard de nicho. Es la herramienta principal para que Martin evalúe el retrieval
a ojo antes de tocar el workflow.

## Fase 3 — Workflow n8n lite (nodo Chat interno, ~5-6 nodos)

**Archivo nuevo:** `project-context/TerminalGrafica/whatsapp-automation/n8n/flows/faq-bot-rag-lite.json`

Sin webhook, sin HMAC, sin Chatwoot. Se prueba desde la ventana de chat integrada de n8n
(el Chat Trigger expone un chat "Test"/hosted). Cadena lineal:

| # | Nodo | Notas |
|---|------|-------|
| 1 | **Chat Trigger** (`@n8n/n8n-nodes-langchain.chatTrigger`, "When chat message received") | reemplaza webhook + filtro; el texto llega en `$json.chatInput` |
| 2 | Code `Preparar` (~8 líneas: toma `chatInput` + flags nicho por regex sobre el mensaje) | nuevo |
| 3 | HTTP `Embed Query` → OpenRouter `/embeddings` (RETRIEVAL_QUERY, truncar a 1536 en Code o dejar 3072 y truncar acá) | nuevo |
| 4 | Postgres `Match Productos` → `select * from bot.match_productos($1::vector,8,$2,$3)`, cred "Bot Readonly DB" | nuevo |
| 5 | Code `Armar Contexto` (~10 líneas: numera candidatos con `chunk_text`) | nuevo |
| 6 | **Basic LLM Chain** Compositor (lmChatOpenRouter `gemini-3.1-flash-lite`; prompt: recomendá 1-3 productos de la lista, español rioplatense, **SIN montos**, si nada aplica decilo y ofrecé derivar a cotización) | modelo copiado de v10; su salida vuelve al chat automáticamente |

Nada de debounce, firewall, verificador ni log a `bot.decisiones`. Un sticky note en el flow
documenta las limitaciones.

### Actualización 2026-08-07 (v2) — Agente + tool + memoria (arquitectura RAG real)

Reemplaza el pipeline lineal de arriba. La idea de un RAG es que **el agente acceda al catálogo
vía una tool**, no con un pre-fetch fijo. Ahora son **dos workflows**:

**`faq-bot-rag-lite.json` (principal, 6 nodos):** `Chat Trigger → Agente`. El Agente
(`@n8n/n8n-nodes-langchain.agent` v1.9) tiene conectados: **Modelo** (lmChatOpenRouter
`gemini-3.1-flash-lite`), **Memoria** (`memoryBufferWindow`, 10 turnos por `sessionId`, `ai_memory`)
y la **tool `buscar_catalogo`** (`toolWorkflow`, `ai_tool`). El `text` del turno = `{{ $json.chatInput }}`
(memoria limpia). El system prompt es el **flujo por etapas**: (1) saludo → NO llama la tool;
(2) pedido claro → llama `buscar_catalogo` y recomienda de lo que vuelva; (3) falta info → UNA
pregunta corta (sin repetir lo del historial); (4) seguimiento → arma la consulta a la tool
combinando historial + mensaje nuevo; (5) otro/cierre → breve o deriva. Sin montos.

**`tool-buscar-catalogo.json` (sub-workflow, 7 nodos):** `Execute Workflow Trigger(consulta) →
Preparar (flags nicho) → Embed Query (OpenRouter) → Vector (trunc 1536 + L2) → Match Productos
(bot.match_productos) → Formatear Candidatos (texto en `response`)`. Es el RAG semántico
encapsulado como tool.

Ventaja sobre el pipeline lineal: el agente decide **cuándo** buscar (no busca en un saludo) y
**qué** buscar, formulando la consulta con el contexto de la memoria (resuelve el caso "¿y en A3?").

**Wiring manual (una vez, en la UI de n8n):** importar PRIMERO `tool-buscar-catalogo`, después el
principal, y en el nodo `buscar_catalogo` seleccionar el workflow de la tool (el `workflowId` viaja
vacío porque el id lo asigna n8n al importar).

> Nota: n8n necesita la truncación a 1536 dims antes del nodo Postgres. Lo más simple es que el
> Code `Preparar`/`Armar Contexto` recorte el array del embedding a los primeros 1536 y lo
> re-normalice L2 (misma lógica que el script de ingesta), así el `$1::vector` matchea la columna.

## Nota OpenRouter (embeddings)

El endpoint `/embeddings` de OpenRouter es OpenAI-shaped, así que hay incertidumbre sobre el
passthrough de `taskType` y `outputDimensionality`. Mitigaciones que van en el código:
- **Dimensiones garantizadas del lado del cliente:** aunque OpenRouter devuelva 3072 dims,
  truncamos Matryoshka a las primeras 1536 y re-normalizamos L2 nosotros. La tabla queda
  `vector(1536)` siempre.
- **taskType:** si no pasa, documento y query se embeben sin diferenciación de tarea (leve pérdida
  de calidad, no bloqueante). Se verifica en la primera corrida de `rag-ingest.ts` inspeccionando
  la respuesta; si OpenRouter no lo soporta y molesta, la alternativa es una API key directa de
  Google AI Studio (mismo código, otro endpoint/credencial).
- Modelo: `google/gemini-embedding-001` en OpenRouter.

## Convivencia con v10

Cero conflicto: el lite no usa webhook ni toca Chatwoot/WhatsApp. Corre aislado en su propio
workflow con un Chat Trigger interno. El v10 productivo sigue intacto. Prueba 100% offline.

## Archivos a crear / tocar

Crear:
- `project-context/TerminalGrafica/whatsapp-automation/db/rag-embeddings.sql` (DDL)
- `projects/TerminalGrafica/whatsapp-automation/lib/catalog/rag-chunk.ts` (+ su test)
- `projects/TerminalGrafica/whatsapp-automation/scripts/rag-ingest.ts`
- `projects/TerminalGrafica/whatsapp-automation/scripts/rag-query.ts`
- `project-context/TerminalGrafica/whatsapp-automation/n8n/flows/faq-bot-rag-lite.json`

Reutilizar (no modificar):
- `lib/catalog/loader.ts`, `types.ts`, `effective.ts` (forma de `lineaLLM`/`marca`)
- `db/export-actualizado-catalogo.json` (fuente de la ingesta)
- `n8n/flows/faq-bot-v10-live.json` (solo referencia: config del modelo lmChatOpenRouter y cred "Bot Readonly DB")
- `db/firewall-tier1.sql` (patrón de DDL/grants)

## Verificación (end-to-end)

1. **DDL:** aplicar `rag-embeddings.sql` en el SQL Editor → confirmar tabla + RPC creadas, extensión
   `vector` habilitada, grant a `bot_readonly` ejecutado (mirar el `raise notice`).
2. **Chunk + ingesta:** `pnpm vitest lib/catalog/__tests__/rag-chunk.test.ts` verde. Correr
   `rag-ingest.ts --sql`, inspeccionar 2-3 chunks a mano (¿el texto tiene sentido? ¿nicho bien?),
   aplicar el SQL → `select count(*) from bot.producto_embeddings` ≈ nº de productos públicos no ocultos.
3. **Retrieval:** `rag-query.ts` con un set de queries: jerga exacta ("autocad a0", "opp 20x30"),
   caso de uso ("algo para la vidriera"), y una de nicho con/sin flag ("cartel para inmobiliaria"
   vs "cartel para mi local") → confirmar que el producto correcto aparece en el top-3 y que el
   guard de nicho filtra bien.
4. **Workflow:** abrir el chat de prueba del Chat Trigger en n8n y escribir las mismas queries del
   punto 3 → verificar que responde con una recomendación coherente y **sin montos**. Cero riesgo:
   no toca WhatsApp ni Chatwoot.

## Decisiones que quedaron abiertas (defaults tomados, cambiables)

- **DDL en `db/*.sql`** a mano (default; consistente con el resto del bot) vs migración versionada.
- **Precios:** activar "desde ~$X" (solo `precio_confiable=true`) es un cambio de una línea en el
  prompt del Compositor cuando Martin quiera.
- **Contexto de "hermanos" del rubro** para el Compositor: fuera de v0, sumable después si querés
  respuestas tipo "¿tenés algo parecido?".
