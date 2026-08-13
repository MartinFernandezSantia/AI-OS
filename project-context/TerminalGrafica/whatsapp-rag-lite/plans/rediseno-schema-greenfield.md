# Plan — Rediseño greenfield del schema del bot RAG (catálogo + log)

> Aprobado 2026-08-13. Para ejecutar en una próxima sesión. Varios pasos requieren `DATABASE_URL` /
> `GEMINI_API_KEY` y la instancia n8n (los aplica Martin).

## Context

Sesión de diseño en la que se decidió rehacer el schema del catálogo y del log del bot RAG lite de
Terminal Gráfica. **No hay producción todavía** — todo es dev y descartable —, así que el schema se
escribe **greenfield** (crear desde cero, como si el bot no existiera) en vez de migrar la BD actual.
Objetivo: llegar a prod en el mejor estado posible para no tener que tocar la BD después.

El catálogo del bot hoy es una pila de capas acumuladas (`producto_meta`/`variante_meta`/`rubro_meta`
overlay v2/v3 → `producto`/`producto_item`/`familia` v4 → `grupo`/`grupo_item` → vistas). Y el log
está partido en dos (`decisiones` operativo + `rag_decisiones` memoria). Se colapsa todo a un modelo
mínimo. En paralelo, otra sesión construye un **dashboard de curación standalone** (app aparte) que
escribe estas tablas; comparte SOLO la base de datos con quote-automation-system, no se integra ahora.

## Decisiones (Martin, 2026-08-13)

1. **Todo el bot vive en el schema `bot`.** Incluidas las tablas de catálogo del bot (producto/variante
   con sinónimos, unidades, etc.). `public` ya tiene sus `products`/`product_variants` (el maestro del
   quote-automation) y NO se tocan ni se duplican ahí. Las tablas del bot son overlay/curación con FK a
   public, pero viven en `bot`.
2. **Seeding = arrancar VACÍO y re-curar.** Las tablas nuevas nacen vacías; la curación se rehace desde
   el dashboard leyendo `public.products` como fuente de qué productos existen. NO se seedea de la
   curación actual.
3. **Inglés = solo tablas y columnas.** Identificadores en inglés, pero los TOKENS de valor quedan como
   están: `sale_unit` mantiene valores en español (`unidad`/`hoja`/`pagina`/`plancha_a3`/…) y el jsonb
   `metadata` de `rag_catalog` mantiene sus claves (`producto_id`, `nombre_canonico`, `precios`).
   → NO se tocan: `COBRO` map, ~400 líneas de fixtures, el prompt del agente, ni las queries `metadata->>`.
4. **Dashboard = app standalone.** quote-automation-system es referencia de **estilo** (Next 16 App
   Router + Server Actions + zod), NO integración inmediata. Comparte solo la BD. Escribe `bot.*` con un
   rol de escritura dedicado (ver "Interfaz de escritura").

Decisiones de diseño ya consensuadas antes:
- Catálogo → **2 tablas**: `bot.product` (nivel producto) + `bot.variant` (nivel variante, con el cobro).
- `bot.variant`: SIN `material`, SIN `by_page` (por-página pasa a `sale_unit='pagina'`); se conservan
  `by_pack` + `pack_units`. Precio NO se guarda: sale de `public.product_variants` + `pricing_rules`
  por `variant_id`.
- Log unificado: `decisiones` + `rag_decisiones` → una sola tabla `bot.log`. Se quitan `had_handoff`,
  `notes`; `resolution_level` se implementa de verdad. Se guardan **las dos puntas del turno**
  (`customer_message` recibido + `bot_message` enviado) para auditoría; la memoria (read-back) igual
  sólo lee `products` (producto **+ nombre de variante** + cantidad; `nombre_variante` ya está en el
  schema de salida del agente, commit 2623764).

## RLS — conclusión (RLS SÍ, como defensa en profundidad)

La base está **compartida** con quote-automation, que tiene usuarios con keys de Supabase (empleados,
rol `authenticated`). Aunque `bot` no esté expuesto por PostgREST, no alcanza: una key de empleado, o
cualquier acceso directo a la BD desde el otro sistema, NO debe encontrar un pase libre sobre `bot`.
Por eso RLS va **prendido en todas las tablas de `bot`**, como capa extra sobre el aislamiento de schema
+ los grants mínimos (cinturón + tiradores).

Cómo, sin romper nada:
- `enable row level security` en todas las tablas de `bot` (NO `force`: el owner —migraciones, export,
  ingest— sigue pasando).
- Policies que permiten SOLO los roles dedicados; cualquier otro principal (anon, authenticated,
  empleados) no matchea ninguna policy → **denegado por defecto** (además de no tener grant):
  - `bot.product` / `bot.variant`: `for all to bot_curator`. El SELECT del export lo hace el owner (bypass).
  - `bot.rag_catalog` / `rag_business_info`: `for select to bot_runtime`.
  - `bot.log`: `for insert to bot_runtime` + `for select to bot_runtime` (el read-back lee). Esto
    **resuelve** el viejo aviso del firewall v10 ("no prendas RLS en decisiones"): rompía porque era
    deny-all SIN policy; con una policy para `bot_runtime`, el INSERT del nodo Log funciona igual.
  - firewall (`blocklist`/`sender_state`/`injection_patterns`): ya tienen RLS deny-all y las tocan las
    funciones `firewall_*` (SECURITY DEFINER, corren como owner → bypass). Se mantiene.
- Grants mínimos igual (RLS es la 2ª capa, no la única): revocar de PUBLIC/authenticated; grantear solo
  a los roles dedicados.

Roles:
- `bot_runtime` (n8n / el bot; renombra al viejo `bot_readonly`, que mentía: este rol también ESCRIBE
  el log): SELECT en `rag_catalog`/`rag_business_info`, INSERT+SELECT en `log`. Conexión Postgres
  directa (pooler Supavisor).
- `bot_curator` (el dashboard, NUEVO): ALL en `bot.product`/`bot.variant`, SELECT en
  `public.products`/`product_variants`/`categories` (para listar la fuente). Conexión server-side.
- Ingest/export corren con conexión **owner** (bypass RLS), como hoy.

## Schema objetivo (DBML) — todo en el schema `bot`

```dbml
Enum bot.sale_unit {  // VALORES en español (el COBRO map no se toca)
  unidad; hoja; pagina; m2; metro; trabajo; plancha_a3; hoja_a3
}

// ── CATÁLOGO DEL BOT (curación; la escribe el dashboard vía bot_curator) ──
Table bot.product {
  id uuid [pk, default: `gen_random_uuid()`]
  key text [unique, not null]        // slug natural → metadata.producto_id
  bot_name text [not null]
  synonyms "text[]" [not null, default: `'{}'`]
  use_cases "text[]" [not null, default: `'{}'`]
  niche text
  note text
  hidden boolean [not null, default: false]
  updated_at timestamptz [not null, default: `now()`]
}
Table bot.variant {
  id uuid [pk, default: `gen_random_uuid()`]
  product_id uuid [not null]         // → bot.product.id
  variant_id uuid [not null]         // → public.product_variants.id (precio/color/unit)
  bot_name text
  sale_unit bot.sale_unit
  pack_units integer
  by_pack boolean [not null, default: false]
  hidden boolean [not null, default: false]
  updated_at timestamptz [not null, default: `now()`]
  indexes { (product_id, variant_id) [unique] }
}
Ref: bot.variant.product_id > bot.product.id [delete: cascade]
Ref: bot.variant.variant_id > public.product_variants.id [delete: cascade]   // FK cross-schema

// ── RUNTIME DEL BOT ──
Table bot.rag_catalog       { id uuid [pk]; text text; metadata jsonb; embedding "extensions.vector" }
Table bot.rag_business_info { id uuid [pk]; text text; metadata jsonb; embedding "extensions.vector" }
Table bot.business_info     { key text [pk]; value text; updated_at timestamptz }   // fuente del info ingest
Enum bot.resolution_level   { firewall; canned; llm; escalated }
Table bot.log {              // unifica decisiones + rag_decisiones (una fila por turno)
  id bigint [pk]
  created_at timestamptz [not null, default: `now()`]
  session_id text [not null]        // read-back de memoria filtra por acá
  customer_message text             // lo que RECIBIÓ el bot (auditoría)
  bot_message text                  // lo que ENVIÓ el bot (auditoría; el read-back NO lo usa)
  action "bot.accion" [note: 'enum del firewall/router (existente)']
  resolution_level bot.resolution_level
  state text [note: 'ok | corrected | regenerated | rejected']
  products jsonb [not null, default: `'[]'`]   // memoria: nombre producto + nombre_variante + cantidad
  prices jsonb [note: 'solo auditoría']
  verification jsonb [note: 'solo auditoría']
  signals jsonb
  execution_id text
}
Table bot.errors { id bigint [pk]; created_at timestamptz; workflow_name text; failed_node text; message text; stack text; execution_id text; execution_url text; mode text }
// firewall: bot.blocklist / bot.sender_state / bot.injection_patterns + funciones firewall_check/strike
//   quedan como están (encapsuladas en las funciones). Rename a inglés = DIFERIDO (toca el cuerpo de
//   las funciones, no este código).
```

Mueren (no se crean): `producto_meta`, `variante_meta`, `producto_item`, `familia`, `rubro_meta`,
`grupo`, `grupo_item`, vistas `variantes`/`taxonomia`/`grupo_variantes`, y `rag_decisiones` (se funde
en `log`).

## Interfaz de escritura (dashboard standalone; quote-automation = referencia de estilo)

El dashboard es una **app aparte** (no se integra ahora). Copia el ESTILO del admin de quote-automation
pero escribe `bot.product`/`bot.variant` con el rol dedicado `bot_curator`, server-side:
- **Stack de referencia** (a imitar, no a integrar): Next 16 App Router + Server Actions `'use server'` +
  zod (validación doble: cliente + `safeParse` en el server) + Zustand para estado de UI. Ver en
  `quote-automation-system`: `lib/services/products/{commands,schemas,queries}.ts`,
  `components/admin/products/product-editor.tsx`, `lib/store/products-store.ts`.
- **Escritura a `bot`**: como `bot` NO está expuesto por PostgREST, el server action escribe con una
  **conexión Postgres directa** (rol `bot_curator`) — NO el cliente Supabase/PostgREST del admin. (Si
  en el futuro se integra a quote-automation, ahí se decide si se expone `bot` o se sigue con conexión
  directa; hoy: directa.)
- **Autorización**: la del propio dashboard (su login de admin), reforzada por los grants de
  `bot_curator` + RLS (las policies solo dejan a `bot_curator` escribir el catálogo).
- **Flujo**: lista `public.products`/`product_variants` (agrupados por categoría) y crea/edita la fila
  espejo en `bot.product`/`bot.variant`. Si ya hay fila del bot, precargar los campos. Arranca vacío.

Nota de alcance: el dashboard lo construye la otra sesión. Este plan define el **schema + el contrato**
que el dashboard escribe; no incluye los archivos del dashboard.

## Cambios de código (bot RAG) — recortados por "inglés solo tablas/columnas"

1. **DDL nuevo** (`whatsapp-rag-lite/db/*.sql`): crear en `bot` las tablas nuevas en inglés
   (`product`, `variant`, `rag_catalog`, `rag_business_info`, `business_info`, `log`, `errors`) + enums
   `sale_unit`/`resolution_level`; grants mínimos (`bot_runtime` lectura+log; `bot_curator` write en
   product/variant + read en public); **`enable row level security` + policies por rol** en todas (ver
   sección RLS). Crear el rol `bot_curator`.
2. **Generador de export** (`whatsapp-automation/db/curador-export-v4.sql` → nuevo `curador-export.sql`):
   reescribir `from/join` para leer `bot.product` + `bot.variant` + `public.product_variants` +
   `pricing_rules`. Baja `sale_unit`/`pack_units`/`by_pack` a nivel item desde `bot.variant`. Sigue
   emitiendo las claves de metadata en español (`producto_id`, `nombre_canonico`, `atributos.unidad_venta`).
3. **`scripts/rag-ingest.ts`**: `TABLE = "bot.rag_catalog"`, `INFO_SOURCE = "bot.business_info"`. `metaObj`
   sin cambios de claves (siguen en español).
4. **`scripts/build-flow.mjs`**: nodo Log Turno → `table: "log"` con los campos unificados (incl.
   `customer_message` + `bot_message`); **Leer Decisiones** apunta a `bot.log` (filtra
   `session_id`+`state='ok'`+products); dropear el nodo/tabla `rag_decisiones`; PGVector table names →
   `bot.rag_catalog`/`bot.rag_business_info`; llamadas a `firewall_check`/`firewall_strike` sin cambio.
   Regenerar con `pnpm flow:build`.
5. **`lib/catalog/price-display.ts`**: borrar la rama `if (item.por_pagina)` de `derivarUnidad` (por-página
   pasa a `sale_unit='pagina'` vía COBRO, que YA tiene `pagina`). COBRO y tokens SIN cambio. Sacar
   `UNIDAD_VENTA_OVERRIDE` si la curación ya deja `plancha_a3` bien.
6. **`lib/catalog/types.ts` + `rag-chunk.ts` + `loader.ts` + `effective.ts`**: quitar `material` y
   `por_pagina` de los tipos/lectura; ajustar a la nueva forma del export (sin flags a nivel producto).
7. **Tests + fixtures** (`lib/catalog/__tests__/**`): actualizar `export-v4.json`/`export.json` y los
   tests para la variante sin `material`/`by_page`; el resto de tokens sin cambio.
8. **Firewall `auto:strikes`**: hoy al 3er strike **silencia 24h**, no blocklista; `blocklist.source=
   'auto:strikes'` está sin cablear → decidir cablear el auto-blocklist o quitar el valor (fuera del core).

## Flujo de datos (post-cambios)

Curar en el dashboard (`bot.product`/`bot.variant`) → correr el generador de export (SELECT, owner) →
`export-catalogo.json` → `pnpm rag:ingest --apply` (llena `bot.rag_catalog`) + `pnpm rag:ingest:info
--apply` (llena `bot.rag_business_info` desde `bot.business_info`) → el bot consulta los vectores.

## Verificación

- `pnpm test` verde tras ajustar fixtures (price-display sigue sin totales; unidad por `sale_unit`).
- `pnpm flow:build` emite ambos flows (chat + Chatwoot) sin referencias a tablas viejas
  (`grep -c "producto_meta\|rag_decisiones\|\.decisiones\b" n8n/flows/*.json` = 0 donde corresponda).
- `pnpm rag:ingest --dry` produce chunks correctos leyendo el export nuevo; un producto por-página
  muestra "por pagina" vía `sale_unit='pagina'`; el imán muestra "por plancha A3".
- RLS: `bot_curator` puede insertar/editar `bot.product`/`bot.variant` y leer `public.products`;
  `bot_runtime` puede insertar/leer `bot.log` y leer los `rag_*`, pero NO escribir el catálogo; y un
  rol `authenticated`/empleado **es denegado** en todas las tablas de `bot` (probar con `set role`).
- Memoria: en un multi-turno, el read-back de `bot.log` antepone "producto + variante x cantidad"; el
  `log` guarda las dos puntas (`customer_message` + `bot_message`).
- Claude NO ve las ejecuciones de n8n → las pruebas en vivo las confirma Martin.

## Archivos principales a tocar (lado bot; el dashboard es otra sesión)

- `whatsapp-rag-lite/db/*.sql` (schema nuevo en `bot`, roles/grants, RLS + policies).
- `whatsapp-automation/db/curador-export-v4.sql` (reescritura del generador de export).
- `whatsapp-rag-lite/scripts/{rag-ingest.ts, build-flow.mjs, rag-query.ts}`.
- `whatsapp-rag-lite/lib/catalog/{price-display.ts, types.ts, rag-chunk.ts, loader.ts, effective.ts}` + tests.
