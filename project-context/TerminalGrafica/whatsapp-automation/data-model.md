# Modelo de datos — acceso del bot al catálogo + loop de mejora

> Base del acceso al catálogo por function calling (roadmap §1, decisión 2026-06-29).
> La fuente de verdad es la BD del **sistema de presupuestos** (`quote-automation-system`,
> Supabase Postgres). El bot NUNCA escribe en el catálogo: lee vistas de solo-lectura y
> solo escribe en sus propias tablas (`bot_producto_meta`, `bot_decisiones`).

## Lo que necesito de Martin para cerrar las vistas

Las vistas de abajo usan **nombres de tabla/columna placeholder** (marcados con `‹...›`)
porque el schema real vive en el otro repo. Para finalizarlas necesito el mapeo de:
- Tabla de **productos** (nombre canónico + categoría) → nombre real + columnas.
- Tabla de **variantes** (material/medida/etc. por producto) → nombre real + columnas.
- Dónde vive el **precio** de cada variante y su **timestamp de última actualización**.
- Cómo se marca que una variante **tiene reglas de precio** (columna bool, tabla de reglas, o se infiere).

Con eso reemplazo los `‹...›` y queda ejecutable.

---

## 1. Objetos propios del bot (ejecutables ya, no dependen del schema fuente)

### `bot_producto_meta` — capa semántica curada por el loop
Lo único que se mantiene a mano / se autocura con el digest. Un row por producto canónico.
Los productos nuevos aparecen solos en la taxonomía (LEFT JOIN); arrancan sin sinónimos
hasta que el loop los va llenando.

```sql
create table bot_producto_meta (
  producto_id    bigint primary key,          -- referencia al producto en la BD de presupuestos
  sinonimos      text[] not null default '{}', -- ej: {'remeras estampadas','estampado de remeras'}
  casos_de_uso   text[] not null default '{}', -- en lenguaje del cliente: {'para repartir en la calle'}
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
```

### `bot_decisiones` — log del loop de mejora (Capa 3)
Se inserta un row por interacción relevante. Las columnas `*_post` se completan después
(cuando el cliente responde / el humano atiende / Martin marca el muestreo).

```sql
create type bot_nivel_resolucion as enum ('n1_sql','n2_llm','ninguno');
create type bot_accion          as enum ('informo_precio','informo_capacidad','repregunto','handoff','fallback_error');
create type bot_veredicto       as enum ('era_venta','no_era','escalacion_correcta'); -- muestreo forzado

create table bot_decisiones (
  id                       bigserial primary key,
  created_at               timestamptz not null default now(),
  conversation_id          bigint,                 -- id de conversación en Chatwoot
  mensaje_cliente          text not null,          -- crudo, tal cual lo mandó
  producto_resuelto        bigint,                 -- producto_id si resolvió, null si no
  candidatos               jsonb,                  -- top-3 [{producto_id, nombre, score}]
  nivel_resolucion         bot_nivel_resolucion not null,
  accion                   bot_accion not null,
  filas_sql                int,                    -- 0 = candidato a falso negativo
  hubo_handoff             boolean not null default false,
  -- se completan más tarde (señales automáticas, sin etiquetado manual):
  cliente_respondio_post   boolean,                -- ¿el cliente siguió tras el handoff?
  cliente_volvio_48h       boolean,                -- proxy de venta muerta: false + sin handoff = candidata
  tiempo_primera_resp_hum  interval,
  -- muestreo forzado del digest semanal (lo único manual, 5/semana):
  veredicto_humano         bot_veredicto,
  notas                    text
);

create index on bot_decisiones (created_at);
create index on bot_decisiones (accion) where veredicto_humano is null;
```

---

## 2. Vistas de solo-lectura sobre el catálogo (placeholders a mapear)

### `bot_taxonomia` — va SIEMPRE en el prompt (chica, cacheable)
Un row por producto canónico. Esto es lo que el LLM ve para resolver "qué producto es".

```sql
create view bot_taxonomia as
select
  p.‹id›            as producto_id,
  p.‹nombre›        as nombre_canonico,
  p.‹categoria›     as categoria,
  coalesce(m.sinonimos, '{}')    as sinonimos,
  coalesce(m.casos_de_uso, '{}') as casos_de_uso
from ‹productos› p
left join bot_producto_meta m on m.producto_id = p.‹id›
where p.‹activo› = true;
```

### `bot_variantes` — lookup on-demand de precios (NO va al prompt)
Se consulta solo cuando ya se identificó el producto. La columna `mostrable` encapsula la
**regla dura de precios**: el bot muestra número solo si NO tiene reglas y el precio está fresco.

```sql
create view bot_variantes as
select
  v.‹producto_id›   as producto_id,
  v.‹descripcion›   as variante,
  v.‹material›      as material,
  v.‹medida›        as medida,
  v.‹precio›        as precio_lista,
  v.‹tiene_reglas›  as tiene_reglas,           -- true → cotizar = llamar al motor, NO recalcular acá
  v.‹precio_updated_at› as precio_updated_at,
  -- mostrable = sin reglas Y precio fresco (<30 días). Auto-silencio de precios viejos:
  (v.‹tiene_reglas› = false
    and v.‹precio_updated_at› > now() - interval '30 days') as mostrable
from ‹variantes› v;
```

**Regla de precios en el flujo (recordatorio, ver roadmap §1):**
- `mostrable = true` → el bot emite el número con plantilla fija (no lo tipea el LLM).
- `tiene_reglas = true` → el bot **NO** muestra número solo. v1: rango + gatillo de captura / handoff.
  Fase 2: llamar al **motor de precios del sistema de presupuestos** (función/endpoint compartido)
  con los inputs completos; si faltan inputs, los pide o escala. **Nunca** reimplementar reglas en n8n.
- `mostrable = false` por precio viejo → escala (auto-silencio).

---

## 3. Seguridad / acceso

- El bot (n8n) se conecta con un **rol de BD dedicado y de solo-lectura** sobre `bot_taxonomia`
  y `bot_variantes`, con `INSERT/UPDATE` solo en `bot_decisiones` (y lectura de `bot_producto_meta`).
  Nunca acceso de escritura al catálogo.
- Conexión vía el **pooler de Supabase (Supavisor)**, no conexión directa.
- **Timeout** corto en la query + fallback a handoff si la BD no responde (nunca error crudo al cliente).
- La taxonomía se **cachea en n8n** (static data, refresh ~1h) → la mayoría de los mensajes no
  pegan a la BD para resolver; solo se consulta `bot_variantes` para el precio del ítem elegido.

---

## 4. Orden de construcción (base primero)

1. **Crear los objetos propios del bot** (`bot_producto_meta`, `bot_decisiones`) — no bloquean en nada.
2. **Mapear el schema fuente** y finalizar `bot_taxonomia` + `bot_variantes`.
3. **Nodo de resolución en n8n** (N1 SQL sinónimos → N2 LLM taxonomía) + inyección al prompt.
4. **Logging a `bot_decisiones`** desde la primera versión (instrumentar día 1).
5. Recién después: cálculo de precios con reglas (motor compartido) y eval pgvector — por fases, con datos del loop.
