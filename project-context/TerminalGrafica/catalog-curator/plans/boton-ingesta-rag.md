# Plan: Botón de ingesta al RAG en el catalog-curator

## Contexto

Hoy, para que el bot "vea" el catálogo curado, hay que salir del dashboard y correr un pipeline manual de dos pasos en otro proyecto (`whatsapp-rag-lite`):
1. Pegar el SQL `curador-export-v5.sql` en el SQL editor de Supabase, ejecutar, y **guardar el resultado a mano** como `export-actualizado-catalogo-v5.json` en disco.
2. `pnpm rag:ingest --apply`, que lee ese JSON, embebe cada chunk con Gemini y **trunca + reinserta** `bot.rag_catalog` conectándose como owner (`DATABASE_URL`).

Es fricción pura y propensa a olvidos (el JSON v5 hoy ni siquiera existe en disco). Martin quiere **un botón en la app** que haga todo: armar los chunks desde la DB, embeber, y escribir `bot.rag_catalog`. Decisión tomada: **todo en la app** (no disparar el CLI ni depender del JSON manual). Martin agrega `GEMINI_API_KEY` a las env del dashboard.

**Resultado buscado:** curar en el dashboard → apretar "Ingestar al bot" → el catálogo queda embebido y buscable por el bot, sin tocar la terminal ni Supabase.

## Idea central

La Server Action reusa el pipeline existente sin reimplementarlo:
- **Export = el mismo SELECT.** `curador-export-v5.sql` es un único SELECT que devuelve el JSON completo (`{ exportado, schema_version: 5, productos, trabajos }`) con toda la resolución de precios (CTEs `cat_chain`/`rules`/`pricing`). La action lo corre con `pg` como `bot_curator` y se queda con `productos`/`trabajos`. Cero divergencia de precios, nada que reimplementar en TS.
- **Chunking = vendorizar `rag-chunk.ts`.** El dashboard NO tiene la lógica de chunk (falta `rag-chunk.ts`, `types.ts` está en v4). Se vendoriza `rag-chunk.ts` y se actualiza `types.ts` a v5. `price-display.ts` ya está vendorizado e idéntico.
- **Embeddings = portar el `fetch` a Gemini.** REST `batchEmbedContents`, modelo `gemini-embedding-001`, `taskType: RETRIEVAL_DOCUMENT`, batch 100, header `x-goog-api-key: GEMINI_API_KEY`. Sin SDK (igual que el script).
- **Escritura sin TRUNCATE.** El script trunca (requiere owner). La action usa `delete from bot.rag_catalog` + insert por fila dentro de una transacción (`withTx`) → cubierto por un grant `delete`, sin necesitar privilegio de owner. `bot_curator` corre todo.

## Permisos (SQL que aplica Martin)

`bot_curator` **ya** puede correr el export (tiene SELECT sobre `public.{products,product_variants,categories,pricing_rules,pricing_rule_targets}` y sobre `bot.{product,variant,job,job_variant,job_variant_material}`). Lo único que falta es poder escribir `bot.rag_catalog`. Archivo nuevo `whatsapp-automation/db/grants-rag-curator-2026-08-19.sql`, aplicado por Martin en Supabase (mismo estilo que la migración de job-variants). Refleja lo mismo en `schema-bot.sql` (bloque 4) como fuente de verdad:

```sql
-- bot_curator ingesta el catálogo al RAG desde el dashboard: delete+insert (no truncate, no es owner).
grant select, insert, delete on bot.rag_catalog to bot_curator;
drop policy if exists curator_rag on bot.rag_catalog;
create policy curator_rag on bot.rag_catalog for all to bot_curator using (true) with check (true);
```

- **No** se da TRUNCATE (la action hace `delete from`). **No** se toca `bot_runtime` (su `runtime_select` sigue leyendo). **No** se toca `bot.rag_business_info` — la ingesta de info del negocio (`--info`) sigue por CLI (fuera de alcance; requiere leer `bot.business_info` que hoy es owner-only). RLS de `rag_catalog` combina la policy nueva `curator_rag` con la `runtime_select` por OR: cada rol ve lo suyo.

## Alcance

Solo el **catálogo** (`bot.rag_catalog`). La info del negocio (`bot.rag_business_info` vía `--info`) queda fuera: leería `bot.business_info` (owner-only) y no se cura desde el dashboard todavía. Se puede sumar después con el mismo patrón.

## Archivos

### Dashboard `catalog-curator` (rama `feat/dashboard-curador`)

| Cambio | Archivo |
|---|---|
| Vendor: portar `rag-chunk.ts` de rag-lite (chunksDeExport, chunksDeTrabajos, chunkRAG, chunkTrabajo + helpers) | `lib/catalog/rag-chunk.ts` (nuevo) |
| Actualizar el vendor de tipos v4→v5 (MaterialBot, VarianteTrabajo, TrabajoBot, CatalogExportV5) | `lib/catalog/types.ts` (editar) |
| Vendor: el SQL de export como string (o archivo `.sql` leído por la action) | `lib/catalog/export-v5.sql.ts` (nuevo) o `lib/catalog/curador-export-v5.sql` |
| Cliente de embeddings Gemini (fetch, batch 100, RETRIEVAL_DOCUMENT) | `lib/embeddings.ts` (nuevo) |
| Server Action `ingestCatalog()`: corre export SELECT → parsea → `[...chunksDeExport, ...chunksDeTrabajos]` → embebe → `delete`+`insert` en `bot.rag_catalog` en `withTx`. Devuelve `{ ok, chunks, error? }` | `lib/rag-actions.ts` (nuevo) |
| Botón "Ingestar al bot" + estado (cargando, resultado, conteo) + confirm | `components/ingest-button.tsx` (nuevo) |
| Montar el botón en un lugar visible (footer del sidebar de progreso o la página de Trabajos/Curar) | `components/*` o `app/layout` (editar el que corresponda) |
| Tests: el chunking vendorizado ya viene con la lógica probada; sumar un smoke test de que `rag-chunk` produce el shape esperado y que `ingestCatalog` arma el insert bien (con pg mockeado o test de la función pura de armado) | `lib/__tests__/rag-chunk.test.ts` (portar de rag-lite) |

### whatsapp-automation/db

| Cambio | Archivo |
|---|---|
| Grant + policy de `bot_curator` sobre `bot.rag_catalog` | `db/grants-rag-curator-2026-08-19.sql` (nuevo) |

### whatsapp-rag-lite

| Cambio | Archivo |
|---|---|
| Reflejar el grant/policy nuevo en el schema (fuente de verdad) | `db/schema-bot.sql` (editar bloque 4) |

**Nota de vendor** (ya es política del repo, ver memoria [[tg-catalogo-dashboard]]): `lib/catalog/` del dashboard es copia de `whatsapp-rag-lite/lib/catalog/`. Al portar `rag-chunk.ts` y actualizar `types.ts`, dejar la cabecera `VENDOR: copia de …` y la nota "si tocás una, actualizá la otra". Idealmente mantener `rag-chunk.ts` idéntico byte a byte al de rag-lite para que no diverjan.

## Detalle de la Server Action `ingestCatalog()`

```
"use server" (server-only, corre como bot_curator vía CURATOR_DATABASE_URL)
1. const { rows } = await q(EXPORT_V5_SQL)         // el SELECT devuelve 1 fila con la columna json
2. const data = rows[0].<col> as CatalogExportV5   // ya es objeto (pg parsea json)
3. if (data.schema_version !== 5) throw
4. const chunks = [...chunksDeExport(data.productos), ...chunksDeTrabajos(data.trabajos ?? [])]
5. if (chunks.length === 0) return { ok:false, error:"catálogo vacío" }
6. const vecs = await embedAll(chunks.map(c => c.texto))   // Gemini, valida dims iguales
7. await withTx(async c => {
     await c.query("delete from bot.rag_catalog")
     for (i) await c.query(
       "insert into bot.rag_catalog (text, metadata, embedding) values ($1,$2::jsonb,$3::vector)",
       [chunks[i].texto, JSON.stringify(metaObj(chunks[i])), vecLiteral(vecs[i])])
   })
8. revalidatePath("/"); return { ok:true, chunks: chunks.length }
```

- `metaObj` y `vecLiteral` se portan tal cual del script (`{ producto_id, nombre_canonico, nicho, precio_desde, precio_hasta, precio_confiable, precios, tipo }`; vector = `[n,n,…]`).
- Falta de `GEMINI_API_KEY` → error claro y temprano ("Falta GEMINI_API_KEY en las env del dashboard"), sin tocar la DB.
- La transacción garantiza que si falla el insert, no queda el RAG a medio borrar (rollback).

## UX del botón

- Botón **"Ingestar al bot"** con ícono (ej. `Upload`/`Sparkles`), colocado en el footer del sidebar (donde ya vive el progreso X/N) para que sea global a las 3 secciones.
- Al click: confirm ligero ("Esto reemplaza todo el catálogo que ve el bot. ¿Seguir?") porque es un delete+insert total.
- Estado de carga (spinner + "Embebiendo N chunks…"), y al terminar toast de éxito con el conteo ("Bot actualizado · N chunks") o el error. Deshabilitado mientras corre.
- No hace falta polling ni background: la action es await directo; el catálogo es chico (decenas/cientos de chunks, 1-3 lotes de embeddings) → segundos.

## Tests / verificación

- `lib/catalog/rag-chunk.ts` viene con su suite de rag-lite; portarla como `lib/__tests__/rag-chunk*.test.ts` para que el vendor no se rompa silenciosamente.
- Test de armado del insert: dado unos chunks + vecs fake, `ingestCatalog` arma los `values` correctos (extraer la parte pura si conviene, o testear `metaObj`/`vecLiteral`).
- Verificación del sub-proyecto: `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build` + `pnpm lint`.
- **End-to-end (manual, lo corre Martin)** con `CURATOR_DATABASE_URL` + `GEMINI_API_KEY` en `.env.local` y el grant SQL aplicado:
  1. Curar/tener catálogo (con el encartonado y sus variantes-de-trabajo).
  2. Click "Ingestar al bot" → éxito con conteo de chunks.
  3. En whatsapp-rag-lite: `pnpm rag:query "encartonado a3"` → devuelve el chunk `Trabajo:` con la variante A3, confirmando que la ingesta desde la app produce lo mismo que el CLI.
  4. (Opcional) `select count(*), max(length(text)) from bot.rag_catalog;` para ver que se pobló.

## Orden de ejecución

1. Grant SQL (`grants-rag-curator-2026-08-19.sql`) + reflejo en `schema-bot.sql`. (Martin lo aplica en Supabase.)
2. Vendor: `types.ts` v5 + `rag-chunk.ts` + su test + el SQL export como string.
3. `lib/embeddings.ts` (cliente Gemini).
4. `lib/rag-actions.ts` (`ingestCatalog`).
5. `components/ingest-button.tsx` + montarlo.
6. Verificar (test/tsc/build/lint).
7. Martin: agregar `GEMINI_API_KEY`, aplicar el grant, correr el botón, verificar con `rag:query`.
```
