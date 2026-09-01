# Modelo de datos — acceso del bot al catálogo + loop de mejora

> Base del acceso al catálogo por function calling (roadmap §1, decisión 2026-06-29).
> Fuente de verdad: BD del **sistema de presupuestos** (`projects/TerminalGrafica/quote-automation-system`,
> Supabase Postgres, project_ref `oeaenxgakkfbgithlctj`).
>
> **Implementación = la migración** `supabase/migrations/20260629182322_bot_catalog_access.sql`
> (branch `feat/bot-catalog-access`). Este doc explica el diseño; el SQL canónico vive en la migración.
> El bot NUNCA escribe en el catálogo: lee vistas de solo-lectura y solo escribe en `bot.decisiones`.

## Esquema fuente (real, mapeado 2026-06-29 desde `prod-public-schema.sql`)

| Tabla | Columnas relevantes |
|---|---|
| `categories` | `id` uuid, `name`, **`audience`** ('publico'\|'gremio'), `parent_id` (jerarquía) |
| `products` | `id` uuid, `category_id`, `name`, `is_active` |
| `product_variants` | `id` uuid, `product_id`, `name`, `color`, `price` numeric **NOT NULL**, `unit`, `is_active` (sin `updated_at`) |
| `pricing_rules` | `id`, `name`, `rule_type`, `effect` jsonb, `valid_from`, `valid_to`, `is_active`, `confirmation` |
| `pricing_rule_targets` | liga una regla a `product_variant_id` \| `product_id` \| `category_id` |

IDs son `uuid`. ~20-40 productos (la taxonomía) × N variantes (≈186 = los precios).

## Decisiones de diseño (y por qué)

1. **Esquema aislado `bot`, no tablas en `public`.** Supabase solo expone `public` vía PostgREST;
   poniendo todo en `bot` las tablas no son accesibles por anon/authenticated y no hay que pelear con RLS.
   Solo el rol `bot_readonly` las ve. Reversible: `drop schema bot cascade`.
2. **Filtro `audience = 'publico'` obligatorio** en ambas vistas → el bot nunca expone catálogo/precios gremio.
3. **"Fijo" = sin reglas.** Toda variante tiene `price`; lo que decide si el bot muestra el número es
   `tiene_reglas`. **Las reglas se heredan por toda la cadena de categorías** (categoría hoja → ancestros
   hasta la raíz) + producto + variante — igual que `collectCategoryRules()` del motor
   (`lib/services/admin/queries.ts`). Por eso `bot.variantes` usa un CTE recursivo, no un solo nivel de padre.
4. **Match conservador:** `tiene_reglas` se gatilla con `pricing_rules.is_active = true` (sin filtrar fechas).
   Si hay cualquier regla activa, el bot escala y deja que el motor (fuente de verdad) calcule. La dirección
   segura es escalar de más, nunca mostrar un número que el motor modificaría (= precio fantasma).
5. **Reglas con `confirmation = true`** quedan cubiertas: son reglas → `tiene_reglas = true` → escala.
6. **Auto-silencio por antigüedad: diferido.** `product_variants` no tiene `updated_at`. El bot lee el
   precio vivo (mismo que el mostrador), así que la frescura es la de la fuente. Si se quisiera, agregar
   `updated_at`+trigger en una migración aparte.
7. **`bot.producto_meta` es opcional para que la taxonomía funcione** (LEFT JOIN + coalesce): un producto
   sin row aparece igual, con sinónimos vacíos. El seed solo crea las filas para poder cargarles sinónimos.

## Objetos creados (resumen; SQL completo en la migración)

| Objeto | Tipo | Para qué |
|---|---|---|
| `bot.producto_meta` | tabla | sinónimos[] + casos_de_uso[] por producto — capa semántica que cura el loop |
| `bot.decisiones` | tabla | log de cada decisión del bot — loop de mejora (Capa 3) |
| `bot.taxonomia` | vista | productos públicos + categoría + sinónimos → va SIEMPRE en el prompt (cacheada) |
| `bot.variantes` | vista | precios on-demand; columnas `tiene_reglas` / `mostrable` (NO va al prompt) |

**Regla de precios en el flujo (roadmap §1):**
- `mostrable = true` (sin reglas) → el bot emite el número con plantilla fija (no lo tipea el LLM).
- `tiene_reglas = true` → NO muestra número solo. v1: rango + captura / handoff. Fase 2: llamar al
  **motor de precios del quote-system** (función compartida) con inputs completos; nunca recalcular en n8n.

## Seguridad / acceso (ver `supabase/bot-readonly-role.sql`)

- Rol dedicado **`bot_readonly`** (least-privilege): `SELECT` en las 2 vistas + `bot.producto_meta`,
  `SELECT/INSERT/UPDATE` solo en `bot.decisiones`. Sin acceso al catálogo ni a precios (las vistas corren
  con privilegios del owner → el rol solo ve lo que la vista expone: público + filtrado).
- n8n conecta vía **pooler Supavisor** (usuario `bot_readonly.oeaenxgakkfbgithlctj`), con **timeout** corto
  + fallback a handoff si la BD no responde.
- Taxonomía **cacheada en n8n** (refresh ~1h): la mayoría de los mensajes no pegan a la BD; solo se consulta
  `bot.variantes` para el precio del ítem elegido.

## Pasos de aplicación (lo que corre Martin)

1. `supabase db push` → aplica la migración (crea el esquema `bot`, tablas y vistas).
2. En el SQL Editor, correr `supabase/bot-readonly-role.sql` (poniendo una password fuerte) → crea el rol.
3. En el SQL Editor, correr `supabase/bot-seed-meta.sql` → crea las filas de metadata (opcional).
4. Verificar: `select * from bot.taxonomia limit 5;` y
   `select variante, precio_lista, tiene_reglas, mostrable from bot.variantes limit 10;`.
5. Después: nodo de resolución en n8n (N1 SQL sinónimos → N2 LLM taxonomía) + logging a `bot.decisiones`.

### Pendiente fase 2 (cálculo de precios)
Exponer la lógica que aplica `pricing_rules.effect` (en el código del quote-system, `lib/quote-utils.ts` —
no está en la BD) como función/endpoint que el bot pueda llamar con inputs completos.
