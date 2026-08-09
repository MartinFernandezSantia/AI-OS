-- =============================================================================
-- CAPA BOT: MODELO PRODUCTO-BOT (rewrite RAG) — DDL
-- =============================================================================
-- Unifica producto_meta + variante_meta + grupo + grupo_item en UNA abstracción:
-- el PRODUCTO-BOT, que es la unidad del chunk RAG. Un producto-bot apunta a N
-- variantes de public (N=1 individual, N>1 grupo). Reemplaza la dualidad que hoy
-- genera solapamiento (un producto renombrado y un grupo eran mecanismos distintos
-- para lo mismo).
--
-- INVARIANTE: el bot NUNCA escribe en `public`. Estas tablas viven en `bot` y sólo
-- REFERENCIAN (FK on delete cascade) a public.product_variants. El PRECIO y las
-- pricing_rules salen SIEMPRE de public vía la vista bot.variantes (nunca se duplican
-- montos). La capa de precios (bot.variantes + flags de cobro en producto_meta/
-- variante_meta) NO se toca: sigue viva y alimenta el contexto de cobro por item.
--
-- Se puebla con db/migracion-producto-bot.sql (una vez) y luego con el SQL de overlay
-- que genera el dashboard, resuelto por CLAVE NATURAL. Lo revisa y aplica Martin.
--
-- Uso: correr este DDL UNA vez en el SQL editor del Supabase (testing y prod).
-- Después: migracion-producto-bot.sql → curador-export-v4.sql → RAG ingest.
-- =============================================================================

create schema if not exists bot;

-- ---------------------------------------------------------------------------
-- Familia: eje de agrupación del slot-filling + la nota de rubro que SÍ aporta
-- al embedding. La lista de ejes (qué preguntar) vive en el system prompt, a
-- discreción del bot — acá sólo va el nombre y la nota que se hornea al chunk.
-- ---------------------------------------------------------------------------
create table if not exists bot.familia (
  clave   text primary key,   -- impresiones_papel, ploteado, tarjetas, carteleria, libreria, otro
  nombre  text not null,
  nota    text                -- se hornea al embedding (ej. libreria: "se venden sueltos, no es un trabajo")
);

-- Seed de las familias base. La `nota` se completa sólo donde aporta señal real.
insert into bot.familia (clave, nombre, nota) values
  ('impresiones_papel', 'Impresiones en papel', null),
  ('ploteado',          'Ploteado / gran formato', null),
  ('tarjetas',          'Tarjetas', null),
  ('carteleria',        'Cartelería', null),
  ('folletos',          'Folletos', null),
  ('libreria',          'Librería',
     'Artículos que se venden sueltos, listos: no son un trabajo de impresión a medida.'),
  ('otro',              'Otros', null)
on conflict (clave) do update set nombre = excluded.nombre, nota = excluded.nota;

-- ---------------------------------------------------------------------------
-- Producto-bot: la unidad del chunk RAG. Funde producto_meta + grupo.
-- ---------------------------------------------------------------------------
create table if not exists bot.producto (
  id           uuid primary key default gen_random_uuid(),
  -- clave natural estable (slug). Es la que viaja en metadata.producto_id del chunk
  -- (NO el uuid: testing y prod no comparten ids). El overlay upsertea por esta clave.
  clave        text unique not null,
  nombre_bot   text not null,                          -- lo que ve/nombra el bot
  familia      text references bot.familia(clave),
  sinonimos    text[]  not null default '{}',          -- "También llamado:" (embedding)
  casos_de_uso text[]  not null default '{}',          -- "Sirve para:" (embedding)
  nicho        text,                                   -- filtro blando; null si el grupo mezcla nicho y no-nicho
  nota         text,                                   -- info puntual al embedding (si aplica sólo a este producto)
  peso         real    not null default 1.0,           -- boost SUAVE de ranking (dial de revisión; lo consume el re-ranking, follow-up)
  oculto       boolean not null default false,
  updated_at   timestamptz not null default now()
);

-- Unicidad de nombre_bot NORMALIZADO (translate+lower+trim, ignorando ocultos):
-- el flujo de precios matchea por nombre del chunk; dos homónimos cruzarían montos
-- en el Map byName del nodo "Insertar Precios". Esta red obliga a que la migración/
-- overlay no genere colisiones.
create unique index if not exists bot_producto_nombre_norm_uq
  on bot.producto (translate(lower(trim(nombre_bot)), 'áéíóúñ', 'aeioun'))
  where not oculto;

-- ---------------------------------------------------------------------------
-- Items: las N variantes de public que cuelgan del producto-bot.
-- Precio SIEMPRE desde public (vía bot.variantes por variante_id). El display de
-- la variante cae en cascada: nombre_variante_bot → display del overlay → nombre vivo.
-- ---------------------------------------------------------------------------
create table if not exists bot.producto_item (
  id                  uuid primary key default gen_random_uuid(),
  producto_id         uuid not null references bot.producto(id) on delete cascade,
  variante_id         uuid not null references public.product_variants(id) on delete cascade,
  nombre_variante_bot text,
  oculto              boolean not null default false,
  unique (producto_id, variante_id)
);

-- Una variante en UN SOLO producto-bot: si estuviera en dos, el chunk la cotizaría
-- dos veces con refs [vN] distintos. La migración además lo asegura con un assert.
create unique index if not exists bot_producto_item_variante_uq
  on bot.producto_item (variante_id);

create index if not exists bot_producto_item_producto_idx on bot.producto_item(producto_id);

-- `orden` (que traían bot.grupo/bot.grupo_item) se descartó a propósito: el LLM no es
-- determinístico, no se puede forzar el orden de presentación sin gastar contexto.
-- El control de relevancia va por bot.producto.peso (ajusta el RANKING del retrieval),
-- no por un orden de presentación.

-- Después de aplicar cambios: regenerar el export v4 y re-ingestar los embeddings.
