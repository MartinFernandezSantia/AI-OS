# Plan: Sección "Negocio" en el catalog-curator (editar info + ingesta al guardar)

## Contexto

El bot responde preguntas operativas (horario, dirección, medios de pago, envíos, plazos, contacto) desde una segunda tool RAG (`consultar_info_negocio`) que lee `bot.rag_business_info`. Esa info se cura hoy **a mano**: editar filas key/value en `bot.business_info` por SQL y correr `pnpm rag:ingest:info --apply` por CLI (como owner). No hay UI, y el dashboard ni siquiera puede tocar esas tablas (`bot.business_info` es owner-only).

Martin quiere una **sección nueva en el dashboard** para editar la info del negocio, y que **al guardar** no solo se actualice la tabla sino que **se reingeste** esa info al RAG en el mismo gesto. Es el follow-up que ya estaba anotado (y el gemelo de la sección catálogo + botón de ingesta que ya existe).

**Decisiones tomadas:** (1) editor de **campos fijos** para las claves conocidas (las 9 sembradas + `factura`) con label amigable + un **"Agregar otro dato"** para claves nuevas; (2) **un solo botón "Guardar"** que hace el upsert a `bot.business_info` Y la reingesta a `bot.rag_business_info` (embeddings Gemini) de una.

**Resultado buscado:** entrar a "Negocio", editar el horario/pago/lo que sea, apretar Guardar, y el bot ya responde con el dato nuevo — sin CLI ni SQL.

## Idea central

Es el patrón que ya existe para el catálogo (`lib/rag-actions.ts` + `lib/embeddings.ts`), calcado para la info:
- **Fuente** `bot.business_info` (key PK / value / updated_at). Claves en español libre (no enum). Filas conocidas: `horario_semana`, `horario_sabado`, `direccion`, `pago`, `envio`, `plazo`, `urgente`, `contacto`, `contacto_redes`, `factura` (opcional).
- **Guardar** = upsert por fila `on conflict (key) do update set value, updated_at=now()` (y borrar las claves que el usuario quitó).
- **Ingesta** = embeber **solo el `value`** de cada fila con `value not ilike 'COMPLETAR%'` (mismo `embedAll` que el catálogo), metadata `{ clave: key }`, y reescribir `bot.rag_business_info` con **delete+insert** en transacción (no truncate: `bot_curator` no es owner). Embeddings ANTES de tocar la DB (si Gemini falla, no queda el RAG borrado).
- Ambas cosas (upsert + ingesta) en la misma Server Action, corriendo como `bot_curator` vía `CURATOR_DATABASE_URL`.

## Permisos (SQL que aplica Martin)

`bot_curator` hoy no tiene NADA sobre estas dos tablas. Archivo nuevo `whatsapp-automation/db/grants-business-info-curator-2026-08-19.sql` (mismo estilo que `grants-rag-curator`), reflejado en `schema-bot.sql` (bloque 4):

```sql
-- Editar la info del negocio desde el dashboard: bot_curator RW sobre la fuente.
grant select, insert, update, delete on bot.business_info to bot_curator;
drop policy if exists curator_all on bot.business_info;
create policy curator_all on bot.business_info for all to bot_curator using (true) with check (true);

-- Reingestar la info al RAG (delete+insert, no truncate → no owner). Combina por OR con runtime_select.
grant select, insert, delete on bot.rag_business_info to bot_curator;
drop policy if exists curator_rag on bot.rag_business_info;
create policy curator_rag on bot.rag_business_info for all to bot_curator using (true) with check (true);
```

`bot_runtime` sigue leyendo `rag_business_info` por su `runtime_select` (RLS combina por OR). No se toca nada más.

## Archivos

### Dashboard `catalog-curator` (rama `feat/dashboard-curador`)

| Cambio | Archivo |
|---|---|
| Query: leer `bot.business_info` (todas las filas, ordenadas) | `lib/queries.ts` (agregar `getBusinessInfo`) |
| Tipos + defaults: `BusinessInfoRow`, catálogo de claves conocidas con label ("horario_semana" → "Horario (lun a vie)") y placeholder/orden | `lib/business-info.ts` (nuevo, PURO) |
| Server Action `saveBusinessInfo(rows)`: valida → upsert `on conflict (key)` + borra las quitadas → arma filas ingestables (`value` no vacío, no `COMPLETAR%`) → `embedAll(values)` → delete+insert en `bot.rag_business_info` (`metadata {clave}`) → todo en `withTx`. Devuelve `{ ok, keys, chunks }` | `lib/business-info-actions.ts` (nuevo) |
| Workspace cliente: campos fijos (las claves conocidas, cada una textarea con label) + filas extra editables (clave+valor) + "Agregar otro dato" + botón Guardar con estado de carga/toast | `components/negocio-workspace.tsx` (nuevo) |
| Página server: carga `getBusinessInfo`, try/catch → DbError, monta el workspace | `app/negocio/page.tsx` (nuevo) |
| Sidebar: 4º ítem de nav "Negocio" (ícono `Store`/`Info`) | `components/app-sidebar.tsx` (editar el array `NAV`) |
| Tests: lógica pura de `lib/business-info.ts` (merge de conocidas + extra, filtro de ingestables, dedup de claves) + `metaInfo`/armado de filas | `lib/__tests__/business-info.test.ts` (nuevo) |

Reuso directo: `lib/embeddings.ts` (`embedAll`), `lib/db.ts` (`q`/`withTx`), `lib/catalog/rag-insert.ts` (`vecLiteral`), `ActionResult` de `lib/actions.ts`, `ChipsEditor`/`Textarea` de UI si aplica.

### whatsapp-automation/db

| Cambio | Archivo |
|---|---|
| Grants + policies de `bot_curator` sobre `business_info` (RW) y `rag_business_info` (W) | `db/grants-business-info-curator-2026-08-19.sql` (nuevo) |

### whatsapp-rag-lite

| Cambio | Archivo |
|---|---|
| Reflejar los grants/policies en el schema (fuente de verdad) + actualizar el comentario "owner-only (follow-up)" que dejó de aplicar | `db/schema-bot.sql` (editar bloque 4) |

## Detalle de la Server Action `saveBusinessInfo`

```
"use server" (bot_curator vía CURATOR_DATABASE_URL)
input: rows: { key: string; value: string }[]   // todas las filas editadas en la UI
1. normalizar: trim keys, quitar filas con key vacía, dedup por key (error si choca)
2. await withTx(c => {
     // upsert de las presentes
     for (r of rows) c.query("insert into bot.business_info (key,value,updated_at) values ($1,$2,now())
                              on conflict (key) do update set value=excluded.value, updated_at=now()", [r.key, r.value])
     // borrar las claves que ya no están
     c.query("delete from bot.business_info where key <> all($1::text[])", [rows.map(r=>r.key)])
     // reingesta: filas ingestables = value no vacío y no ilike 'COMPLETAR%'
     const ing = rows.filter(r => r.value.trim() && !/^COMPLETAR/i.test(r.value.trim()))
     const vecs = await embedAll(ing.map(r => r.value))     // ← fuera del tx si se quiere; ver nota
     c.query("delete from bot.rag_business_info")
     for (i) c.query("insert into bot.rag_business_info (text, metadata, embedding) values ($1,$2::jsonb,$3::vector)",
                     [ing[i].value, JSON.stringify({ clave: ing[i].key }), vecLiteral(vecs[i])])
   })
3. revalidatePath("/negocio"); return { ok:true, data: { keys: rows.length, chunks: ing.length } }
```

- **Nota sobre el orden embeddings/tx:** para no tener la transacción abierta durante la llamada a Gemini (lenta), calcular `embedAll` ANTES del `withTx` (leyendo las filas del input, que ya son la fuente), y dentro del tx hacer upsert + delete/insert. Igual que `ingestCatalog`: embeddings primero, DB después. Si Gemini falla → no se tocó nada.
- Falta de `GEMINI_API_KEY` → error claro y temprano, sin escribir la tabla (o guardar la tabla y avisar que faltó ingestar — **decisión: fallar antes de tocar nada**, para que "Guardar" sea atómico: o guarda-e-ingesta, o no hace nada).

## UX de la sección

- Nav "Negocio" en el sidebar (4º, después de Trabajos).
- Header "Info del negocio" + bajada corta ("Lo que el bot responde sobre horario, pagos, envíos… Al guardar se actualiza el bot.").
- **Campos conocidos** (de `lib/business-info.ts`): label amigable + `Textarea` por clave, en orden semántico. Si la fila no existe aún en la DB, aparece vacía (crearla = escribir su value).
- **Datos extra**: las claves de la DB que no están en el catálogo conocido se listan como filas editables (clave + valor + quitar). Botón **"Agregar otro dato"** suma una fila nueva (clave + valor).
- Botón **Guardar** (sticky abajo, como el editor de trabajos): dirty-aware, con spinner ("Guardando y actualizando el bot…") y toast final ("Info guardada · N datos, N ingestados"). Confirm no hace falta (no es destructivo como el reemplazo del catálogo entero; es su propia info).

## Tests / verificación

- `lib/business-info.ts` (puro): merge de claves conocidas + extra sin duplicar, filtro de ingestables (`COMPLETAR%`/vacío fuera), orden estable, dedup de claves colisionadas.
- Armado de la fila de ingesta: `metadata = { clave }`, texto = value; `vecLiteral` (ya testeado).
- Verificación del sub-proyecto: `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build` + `pnpm lint`.
- **End-to-end (manual, lo corre Martin)** con `CURATOR_DATABASE_URL` + `GEMINI_API_KEY` y el grant aplicado:
  1. Entrar a "Negocio", editar `horario_semana`, Guardar → toast de éxito.
  2. En whatsapp-rag-lite: `pnpm rag:query "a qué hora abren"` (o similar) → devuelve la frase nueva.
  3. `select metadata->>'clave', text from bot.rag_business_info order by 1;` → refleja lo editado.

## Orden de ejecución

1. Grant SQL + reflejo en `schema-bot.sql` (Martin lo aplica en Supabase).
2. `lib/business-info.ts` (tipos + catálogo de claves) + su test.
3. `lib/queries.ts` (`getBusinessInfo`).
4. `lib/business-info-actions.ts` (`saveBusinessInfo`).
5. `components/negocio-workspace.tsx` + `app/negocio/page.tsx` + nav en el sidebar.
6. Verificar (test/tsc/build/lint).
7. Martin: aplicar el grant, correr, editar y verificar con `rag:query`.
```
