# Modelo de datos — acceso del bot al catálogo + loop de mejora

> Base del acceso al catálogo por function calling (roadmap §1, decisión 2026-06-29).
> Fuente de verdad: BD del **sistema de presupuestos** (`projects/TerminalGrafica/quote-automation-system`,
> Supabase Postgres). Schema real mapeado el 2026-06-29 desde `supabase/prod-public-schema.sql`.
> El bot NUNCA escribe en el catálogo: lee vistas de solo-lectura y solo escribe en sus
> propias tablas (`bot_producto_meta`, `bot_decisiones`).

## Schema fuente (real, ya mapeado)

| Tabla | Columnas relevantes |
|---|---|
| `categories` | `id` uuid, `name`, **`audience`** ('publico'\|'gremio'), `parent_id` (jerarquía) |
| `products` | `id` uuid, `category_id`, `name`, `is_active` |
| `product_variants` | `id` uuid, `product_id`, `name`, `color`, `price` numeric **NOT NULL**, `unit`, `is_active` (sin `updated_at`) |
| `pricing_rules` | `id`, `name`, `rule_type`, `effect` jsonb, `valid_from`, `valid_to`, `is_active`, `confirmation` (requiere checkbox humano) |
| `pricing_rule_targets` | liga una regla a `product_variant_id` \| `product_id` \| `category_id` |

**IDs son `uuid`**, no bigint. Cada producto (≈20-40 = la taxonomía) tiene N variantes (≈186 = los precios).

## Hallazgos del schema que cambian el diseño

1. **Filtro `audience = 'publico'` es obligatorio.** El bot habla con clientes finales → nunca debe
   exponer categorías/precios `'gremio'` (mayorista). Va en todas las vistas. (Riesgo de reputación + comercial.)
2. **"Fijo" = sin reglas.** Toda variante tiene precio; lo que decide si el bot puede mostrar el número
   es si hay una `pricing_rule` **activa y vigente** que la afecte (a la variante, su producto, o su categoría/categoría-padre).
3. **Reglas con `confirmation = true`** necesitan un check manual del empleado → el bot **nunca** las aplica solo → escala / rango.
4. **`valid_from`/`valid_to`** ya vencen promos en la fuente → el bot, al leer en vivo, no arrastra promos viejas.
5. **No hay `updated_at` en `product_variants`** → el auto-silencio de precios a 30 días (safeguard #2 de la
   decisión) queda **opcional/diferido**: el bot muestra el mismo precio que usa el mostrador, así que la
   "frescura" es la de la propia fuente. Si se quiere el auto-silencio, hay que **agregar `updated_at` + trigger**
   en `product_variants` (migración chica en el quote-system). Recomendación v1: no bloquear por esto.

---

## 1. Objetos propios del bot (ejecutables ya)

### `bot_producto_meta` — capa semántica curada por el loop
Lo único que se mantiene a mano / se autocura con el digest. Un row por producto.
Productos nuevos aparecen solos en la taxonomía (LEFT JOIN); arrancan sin sinónimos hasta que el loop los llena.

```sql
create table bot_producto_meta (
  producto_id    uuid primary key references public.products(id) on delete cascade,
  sinonimos      text[] not null default '{}',  -- {'remeras estampadas','estampado de remeras'}
  casos_de_uso   text[] not null default '{}',  -- en lenguaje del cliente: {'para repartir en la calle'}
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
```

### `bot_decisiones` — log del loop de mejora (Capa 3)
Un row por interacción relevante. Las columnas tardías se completan después (cliente responde / humano atiende / muestreo).

```sql
create type bot_nivel_resolucion as enum ('n1_sql','n2_llm','ninguno');
create type bot_accion          as enum ('informo_precio','informo_capacidad','repregunto','handoff','fallback_error');
create type bot_veredicto       as enum ('era_venta','no_era','escalacion_correcta');

create table bot_decisiones (
  id                       bigserial primary key,
  created_at               timestamptz not null default now(),
  conversation_id          bigint,                 -- id de conversación en Chatwoot
  mensaje_cliente          text not null,          -- crudo, tal cual lo mandó
  producto_resuelto        uuid,                   -- products.id si resolvió, null si no (sin FK: log histórico)
  candidatos               jsonb,                  -- top-3 [{producto_id, nombre, score}]
  nivel_resolucion         bot_nivel_resolucion not null,
  accion                   bot_accion not null,
  filas_sql                int,                    -- 0 = candidato a falso negativo
  hubo_handoff             boolean not null default false,
  -- señales automáticas (se completan más tarde, sin etiquetado manual):
  cliente_respondio_post   boolean,
  cliente_volvio_48h       boolean,                -- proxy venta muerta: false + sin handoff = candidata
  tiempo_primera_resp_hum  interval,
  -- muestreo forzado del digest semanal (lo único manual, 5/semana):
  veredicto_humano         bot_veredicto,
  notas                    text
);

create index on bot_decisiones (created_at);
create index on bot_decisiones (accion) where veredicto_humano is null;
```

---

## 2. Vistas de solo-lectura sobre el catálogo (finalizadas con schema real)

### `bot_taxonomia` — va SIEMPRE en el prompt (chica, cacheable)
Un row por producto canónico público. Es lo que el LLM ve para resolver "qué producto es".

```sql
create view bot_taxonomia as
select
  p.id                            as producto_id,
  p.name                          as nombre_canonico,
  c.name                          as categoria,
  cpar.name                       as categoria_padre,
  coalesce(m.sinonimos, '{}')     as sinonimos,
  coalesce(m.casos_de_uso, '{}')  as casos_de_uso
from public.products p
join public.categories c          on c.id = p.category_id
left join public.categories cpar  on cpar.id = c.parent_id
left join public.bot_producto_meta m on m.producto_id = p.id
where p.is_active = true
  and c.audience = 'publico';     -- el bot NUNCA expone catálogo gremio
```

### `bot_variantes` — lookup on-demand de precios (NO va al prompt)
Se consulta solo cuando ya se identificó el producto. `tiene_reglas` encapsula la **regla dura de precios**.

```sql
create view bot_variantes as
select b.*, (not b.tiene_reglas) as mostrable
from (
  select
    v.id          as variante_id,
    v.product_id  as producto_id,
    v.name        as variante,
    v.color       as color,
    v.unit        as unidad,
    v.price       as precio_lista,
    exists (
      select 1
      from public.pricing_rule_targets t
      join public.pricing_rules r on r.id = t.pricing_rule_id
      where r.is_active = true
        and (r.valid_from is null or r.valid_from <= current_date)
        and (r.valid_to   is null or r.valid_to   >= current_date)
        and (
              t.product_variant_id = v.id
           or t.product_id         = v.product_id
           or t.category_id        = p.category_id
           or t.category_id        = c.parent_id
        )
    ) as tiene_reglas
  from public.product_variants v
  join public.products  p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  where v.is_active = true
    and p.is_active = true
    and c.audience  = 'publico'
) b;
```

**Regla de precios en el flujo (recordatorio, roadmap §1):**
- `mostrable = true` (sin reglas) → el bot emite el número con plantilla fija (no lo tipea el LLM).
- `tiene_reglas = true` → el bot **NO** muestra número solo. v1: rango + gatillo de captura / handoff.
  Fase 2: llamar al **motor de precios del quote-system** (función/endpoint compartido) con inputs completos;
  si faltan, los pide o escala. **Nunca** reimplementar `effect`/`rule_type` en n8n.
- Reglas con `confirmation = true` → siempre handoff (necesitan decisión humana).

---

## 3. Seguridad / acceso

- El bot (n8n) usa un **rol de BD dedicado de solo-lectura** sobre `bot_taxonomia` y `bot_variantes`,
  con `INSERT/UPDATE` solo en `bot_decisiones` y lectura de `bot_producto_meta`. Nunca escritura al catálogo.
- Conexión vía **pooler Supabase (Supavisor)**, no directa. **Timeout** corto + fallback a handoff si la BD no responde.
- Taxonomía **cacheada en n8n** (static data, refresh ~1h): la mayoría de los mensajes no pegan a la BD;
  solo se consulta `bot_variantes` para el precio del ítem elegido.
- **Doble red sobre `audience`:** además del filtro en las vistas, el rol del bot no debería poder leer `'gremio'`.

---

## 4. Orden de construcción (base primero)

1. **Crear objetos propios del bot** (`bot_producto_meta`, `bot_decisiones`) — no bloquean en nada.
2. **Crear las vistas** `bot_taxonomia` + `bot_variantes` (SQL de arriba, listo).
3. **Seed inicial de `bot_producto_meta`:** un row por producto activo público (sinónimos/casos_de_uso vacíos,
   se llenan con el loop). Opcional: primera tanda de sinónimos a mano para los productos más consultados.
4. **Nodo de resolución en n8n** (N1 SQL sinónimos → N2 LLM taxonomía) + inyección al prompt.
5. **Logging a `bot_decisiones`** desde la primera versión (instrumentar día 1).
6. Fases posteriores (con datos del loop): cálculo de precios con reglas (motor compartido — falta ubicar
   la lógica de pricing en el código del quote-system) y eval pgvector.

### Pendiente para fase 2 (cálculo de precios)
Ubicar en el código del quote-system la función que aplica `pricing_rules.effect` (probablemente TypeScript
del lado del server) y exponerla como endpoint/función que el bot pueda llamar. NO está en la BD.
