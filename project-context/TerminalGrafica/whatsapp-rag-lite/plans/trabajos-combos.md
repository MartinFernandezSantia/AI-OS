# Plan: TRABAJOS (combos de materiales) en el bot RAG de TerminalGrafica

> **Regla AIOS:** este plan es el archivo del modo plan. Al aprobarse, el PRIMER paso de implementación es copiarlo a `project-context/TerminalGrafica/whatsapp-rag-lite/plans/trabajos-combos.md` y commitearlo (los planes viven en el AIOS, no en `~/.claude/plans/`).

## Contexto

La gráfica quiere ofrecer **trabajos**: ítems que se realizan combinando 2+ variantes del catálogo (ej. "invitaciones de casamiento" = impresión de tarjeta + sobre + cinta). Hoy el catálogo del bot solo tiene productos (una unidad = un producto-bot con variantes a elegir). Un trabajo es distinto: sus componentes se usan **todos juntos**, y tiene un **precio total del combo**.

Objetivo: que el RAG encuentre trabajos por búsqueda semántica (embedding propio), que el bot los ofrezca listando los datos/precios de los materiales que los componen, y que opcionalmente muestre un **total calculado** a partir de esos materiales.

**Decisiones del dueño (ya tomadas):** (1) el trabajo tiene un **precio total CALCULADO** a partir de los precios de los materiales que lo componen (no curado a mano), y es **opcional** mostrarlo: un flag decide si el cliente ve el total o solo los precios de los materiales; (2) viven en la **misma `bot.rag_catalog`** con `metadata.tipo='trabajo'` (una sola búsqueda encuentra productos y trabajos); (3) alcance = **core** (DB + export + ingesta + chunk + prompts); la UI de curación en el dashboard queda como follow-up, los primeros trabajos se siembran por SQL.

**Supuesto a confirmar (v1):** el total = suma de `precio_lista` de cada material componente (uno de cada), y solo se calcula si TODOS los materiales tienen precio confiable (simple, sin override/escalera múltiple); si algún material no es confiable, no se muestra total. Si un trabajo llevara N de un material, se agrega una columna `quantity` a `bot.job_material` más adelante. La suma mezcla unidades de cobro distintas (por unidad + por m2 + por metro): es un precio orientativo del conjunto, no exacto.

## Idea rectora (por qué encaja sin nodos nuevos ni tocar precios)

El total **calculado** (suma de los precios de los materiales) se hornea como **una `PrecioVariante` más** dentro de `metadata.precios`, con `ref:'total'`. El cálculo pasa en TS (`chunkTrabajo`), no en la DB ni en el export. Esa única decisión hace que todo el pipeline siga funcionando intacto:

- `Buscar Precios` ya trae `metadata->'precios'` entero → arrastra el total.
- El validador anti-alucinación arma `preciosReales` con `precio_lista` + `tramos.value` de cada `pv` → **el total queda whitelisteado gratis** (no lo borra).
- `display()` (la copia inline en n8n) opera sobre una `PrecioVariante` ya horneada → inyecta el total **sin cambiar una línea**, porque la FORMA de `PrecioVariante` no cambia.

Por eso **NO se toca `price-display.ts` ni su copia en `build-flow.mjs`** (la trampa de "actualizar dos lugares" no se dispara). Los componentes se modelan reusando `bot.variant`, así el `json_build_object` del componente es idéntico al del item de producto y reusa el CTE `pricing` y `precioVariante`/`contextoPrecio` tal cual.

Contra la fusión: el chunk del trabajo **se autoidentifica** (texto arranca con `Trabajo:`, usa línea `Incluye: [c1]…[c2]…` con refs `[cN]` en vez de `Opciones: [vN]`) y el Verificador recibe una excepción acotada.

## Cambios por archivo

### 1. `whatsapp-rag-lite/db/schema-bot.sql` — DDL + RLS
Nueva subsección **"2b. TRABAJOS"** tras el bloque `bot.variant` (después de la línea 120, antes de "3. RUNTIME"). El enum `bot.sale_unit` ya trae `'trabajo'` → sin cambio de enum.

- `bot.job`: `id uuid pk`, `key text unique not null` (slug → `metadata.producto_id`), `bot_name text not null`, `synonyms text[]`, `use_cases text[]`, `niche text`, `note text`, **`show_total boolean not null default true`** (true = mostrar el total calculado; false = mostrar solo los precios de los materiales), `hidden bool`, `updated_at`. Índice único de `bot_name` normalizado (espejo de `bot_product_name_norm_uq`, `where not hidden`). **Sin columnas de precio: el total se calcula, no se guarda.**
- `bot.job_material`: `id uuid pk`, `job_id → bot.job(id) on delete cascade`, **`bot_variant_id → bot.variant(id) on delete cascade`** (el material es una variante ya curada del catálogo → reusa su cobro/precio), `unique(job_id, bot_variant_id)`, índice por `job_id`. **Sin `position`** (los materiales se ordenan por nombre en el chunk) y **sin `hidden`** (un material compone o no; si no va, se borra la fila).
- En §4 (grants/RLS, ~208-259): `grant select,insert,update,delete on bot.job, bot.job_material to bot_curator;` + `enable row level security` en ambas + policies `curator_all` (mismo patrón que product/variant). `bot_runtime` no necesita grant nuevo (solo lee `rag_catalog`). *No hay bloque de rollback destructivo que tocar (el schema usa `create table if not exists`).*

**Decisión:** el material referencia `bot.variant` (no `public.product_variants`) para reusar `sale_unit/pack_units/by_pack/bot_name` y el precio de public. Tradeoff: un material que no se venda suelto igual debe existir como `bot.variant` (bajo algún `bot.product`, aunque sea `hidden`).

### 2. `whatsapp-automation/db/curador-export-v4.sql` — sección `trabajos`
Cuarta clave `'trabajos'` en el `json_build_object` raíz, **después de la línea 136** (tras cerrar `'productos'`). Reusa el CTE `pricing` (no se toca el `with recursive`). Estructura:
- Por trabajo: `{producto_id: bj.key, nombre_bot, sinonimos, casos_de_uso, nicho, nota, oculto, mostrar_total: bj.show_total, componentes: (...)}` from `bot.job bj where not bj.hidden and exists(material exportable)`. **Sin `total` en el export: se calcula en TS desde los `precio_lista` de los componentes.**
- Por material/componente: **copia exacta del `json_build_object` del item de producto (líneas 100-124)** — `variante_id, nombre_variante_bot: coalesce(bv.bot_name, pr.variante_origen), atributos, precio_lista, rangos_cantidad, mostrable, tiene_override, …` (así `chunkTrabajo` puede sumar y evaluar confiabilidad) — from `bot.job_material jm join bot.variant bv on bv.id=jm.bot_variant_id join pricing pr on pr.variant_id=bv.variant_id where jm.job_id=bj.id and not bv.hidden order by coalesce(bv.bot_name, pr.variante_origen)`.
- **Comentar en ambos bloques** que el objeto de item/componente está duplicado (cambio de campos = tocar los dos).

### 3. `whatsapp-rag-lite/lib/catalog/types.ts`
- `export type MaterialBot = ItemBot;` (un material es un item de catálogo con su cobro/precio).
- `TrabajoBot { producto_id, nombre_bot, sinonimos, casos_de_uso, nicho, nota, oculto, mostrar_total: boolean, componentes: MaterialBot[] }`.
- `CatalogExportV4` gana `trabajos?: TrabajoBot[]` (opcional → back-compat con exports viejos).

### 4. `whatsapp-rag-lite/lib/catalog/loader.ts` — `parseExportV4` (52-68)
Tras el `.every(p => Array.isArray(p.items))` (línea 64), validar trabajos **solo si vienen**: si `data.trabajos != null` exigir array y que cada uno tenga `componentes` array; si no vienen, sigue parseando (back-compat).

### 5. `whatsapp-rag-lite/lib/catalog/rag-chunk.ts`
- `RagChunkMeta` gana `tipo?: "producto" | "trabajo"` (opcional → productos sin cambio).
- **`chunkTrabajo(t: TrabajoBot): RagChunk`**:
  - Componentes: `precioVariante(comp, \`c${i+1}\`)` (reusa la función existente) → refs `c1..cN`.
  - **Total CALCULADO** (reusa la lógica de confiabilidad de `rag-chunk.ts`: `marca`/`itemPrecioConfiable`): si `t.mostrar_total` y **todos** los componentes tienen precio confiable, `total = Σ comp.precio_lista`; horneado como item sintético `precioVariante(totalItem, "total")` con `atributos.unidad_venta:'trabajo'` (→ `'por trabajo'`), `precio_lista: total` → `PrecioVariante{ref:'total', unidad:'por trabajo', precio_lista:total, cobrable:true}`. Si `mostrar_total=false` o algún componente no es confiable → **sin `totalPv`**.
  - Texto autoidentificado: `Trabajo: {nombre}.` / `También llamado: …` / `Sirve para: …` / nota / `Incluye: [c1] {comp} ({contextoPrecio}); [c2] …` / `Precio del trabajo: {contextoPrecio(totalPv)}` (esta última línea **solo si** hay `totalPv`).
  - `meta`: `tipo:'trabajo'`, `nombre_canonico=nombre_bot`, `precios=[...componentPvs, ...(totalPv ? [totalPv] : [])]`, `precio_desde=precio_hasta=total` (o null), `precio_confiable = totalPv!=null`.
- **`chunksDeTrabajos(trabajos)`** = `trabajos.filter(t => !t.oculto && t.componentes.length >= 2).map(chunkTrabajo)`. **`chunksDeExport(productos)` queda intacto** (los tests existentes dependen de su forma).

### 6. `whatsapp-rag-lite/scripts/rag-ingest.ts`
- `cargarChunks` (47-53): `const chunks = [...chunksDeExport(data.productos), ...chunksDeTrabajos(data.trabajos ?? [])];` + reportar `trabajos: N` en el `console.error`.
- `metaObj` (92-100): agregar `tipo: c.meta.tipo` (undefined en productos → `JSON.stringify` lo descarta → metadata de productos sin cambios).
- `--prices-only` matchea por `metadata->>'producto_id'` = `job.key` → sirve para trabajos también.

### 7. `whatsapp-rag-lite/scripts/build-flow.mjs` — prompts (mínimos y quirúrgicos)
Recompilar el `.json` desde el `.mjs` tras editar (`pnpm flow:build`). **Aplicar los cambios de prompt con la disciplina del proyecto (Fable + skill `prompt-master`, curando el largo).**
- **`sistema` (27-255):** nota de tool (busca productos **y trabajos**) + bloque corto: los trabajos arrancan con `Trabajo:` y listan `Incluye: [c1]…`; algunos traen línea `Precio del trabajo:` y otros no (según el trabajo). Si la trae, cotizás el total con `variante_ref:'total'` ("el trabajo sale {Pn}"); si no, cotizás cada material con `variante_ref:'cN'`. Describir varios componentes del MISMO trabajo es normal (no es mezclar). Nunca sumar totales a mano.
- **`toolDesc` (257-262):** una frase: también devuelve trabajos (combos) con su precio total.
- **`esquemaSalida` (276-347):** **sin campo nuevo** — alcanza con `nombre_catalogo`=nombre del trabajo y `variante_ref`=`'total'`/`'cN'` (el mecanismo `{Pn}`/`byName`/`variante_ref` matchea strings arbitrarios). El Verificador se autoidentifica por el texto real del chunk.
- **`sistemaVerif` (353-383), regla `fusion_variantes` (372):** agregar EXCEPCIÓN — si la fila real empieza con `Trabajo:` y lista `Incluye: [c1]…`, describir varios de SUS componentes juntos **no** es fusión; sigue siendo fusión mezclar componentes de trabajos/productos DISTINTOS o combinar `[vN]` dentro de un producto normal.

**Nada más se toca en n8n:** `Buscar Precios`, `Insertar Precios`/`insertarPreciosCode`, `Traer Catálogo Real`, `buscar_catalogo` funcionan sin cambios (el total viaja como una `PrecioVariante` más; el match es por nombre normalizado).

## Riesgos

1. **Colisión de nombre job↔product (ALTO):** el match de precios/catálogo es por `nombre_canonico` normalizado sobre TODA `bot.rag_catalog`; los índices únicos de job y product son **separados**. Un trabajo y un producto con el mismo nombre normalizado cruzarían precios en silencio (`byName` Map, la última fila pisa). **Mitigación:** convención de nombres distintos + query de chequeo cruzado antes de ingestar. Documentar fuerte.
2. **Colisión de `key` job↔product (MEDIO):** `--prices-only` actualiza `where metadata->>'producto_id' = key`. **Mitigación:** namespaces de key distintos (convención, p.ej. prefijo en jobs).
3. **Duplicación del item json en el SQL (MEDIO):** el componente copia el `json_build_object` del item (curador-export-v4.sql:100-124). Cambios de campos = tocar dos bloques. Comentar en ambos.
4. **Anti-total (insertarPreciosCode):** borra `" en total"`; si el bot escribe "$45.000 en total" queda "$45.000" (inofensivo). El prompt debe empujar "el trabajo sale {Pn}".

## Verificación end-to-end
1. Sembrar por SQL un trabajo de prueba (crear/usar `bot.variant` para tarjeta/sobre/cinta; `insert into bot.job` con `show_total=true`; `insert into bot.job_material (job_id, bot_variant_id)` por cada material).
2. Correr `curador-export-v4.sql` en Supabase testing → guardar `db/export-actualizado-catalogo-v4.json`.
3. `pnpm rag:ingest --dry` → el chunk arranca con `Trabajo:`, tiene `Incluye: [c1]…`, `Precio del trabajo:` (= suma de los materiales), `meta.tipo:'trabajo'`, `meta.precios` con `c1..cN` + `total` (precio_lista=Σ componentes, unidad='por trabajo', cobrable=true).
4. `pnpm rag:ingest --apply`.
5. `pnpm rag:query "invitaciones de casamiento"` → **(a)** el trabajo se encuentra.
6. Chat de n8n: pedir el trabajo → **(b)** el bot escribe "el trabajo sale {P1}" y `Insertar Precios` inyecta el total (validador lo acepta porque está en `preciosReales`); **(c)** en etapa `recomendacion` el Verificador NO marca `fusion_variantes`.

## Tests (`whatsapp-rag-lite/lib/catalog/__tests__/`)
- Fixture: agregar `"trabajos":[…]` a `fixtures/export-v4.json` reusando `variante_id` ya presentes (no rompe el assert `chunks.length===5`, que cuenta solo productos).
- Nuevo `rag-chunk-trabajo.test.ts`: texto arranca `"Trabajo:"`, contiene `"Incluye: [c1]"`/`"[c2]"` y `"Precio del trabajo:"`; `meta.tipo==="trabajo"`; `meta.precios` con refs `c1..cN` + `total`; el `pv` total tiene `precio_lista === Σ precio_lista de los componentes`, `unidad==="por trabajo"`, `cobrable===true`; componentes conservan su cobro propio; caso **`mostrar_total:false`** → sin `total` en `precios` y sin línea "Precio del trabajo:"; caso **material no confiable** (override/escalera) → sin `total`; `chunksDeTrabajos` excluye ocultos y <2 componentes.
- `loader`: acepta export con `trabajos`; rechaza trabajo sin `componentes`; export sin `trabajos` sigue parseando.
- `price-display`: `precioVariante` sobre el item total sintético (`unidad_venta:'trabajo'` → `'por trabajo'`, `cobrable` con `precio_lista>0`).

## Orden de implementación sugerido
1. Guardar este plan en el AIOS y commitear.
2. TS puro primero (testeable sin DB): `types.ts` → `loader.ts` → `rag-chunk.ts` (`chunkTrabajo`/`chunksDeTrabajos`) + tests vitest → `rag-ingest.ts`. Correr `pnpm test` + `pnpm exec tsc --noEmit`.
3. SQL: `schema-bot.sql` (Martin aplica) → `curador-export-v4.sql`.
4. Prompts en `build-flow.mjs` (con Fable + prompt-master) → `pnpm flow:build`.
5. Verificación end-to-end (sección arriba) — la corre Martin (necesita GEMINI_API_KEY + DATABASE_URL + n8n).

## Archivos críticos
- `whatsapp-rag-lite/db/schema-bot.sql`
- `whatsapp-automation/db/curador-export-v4.sql`
- `whatsapp-rag-lite/lib/catalog/{types,loader,rag-chunk}.ts` (+ `price-display.ts` sin cambios, referencia)
- `whatsapp-rag-lite/scripts/{rag-ingest.ts,build-flow.mjs}`
- `whatsapp-rag-lite/lib/catalog/__tests__/`
