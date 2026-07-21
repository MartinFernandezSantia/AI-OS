# Plan — Increment B: precios (`faq-bot-v6` → precios de lista)

> Sesión de plan: 2026-07-21. Decisiones de Martin tomadas en esta sesión:
> **alcance = solo `mostrable`** (el motor de reglas NO entra en n8n en v1) ·
> **formato = $ con miles y dos decimales tras la coma** (`$12.345,67`), **sin leyenda de IVA**
> (el IVA lo maneja la gráfica al recibir el pedido) ·
> on-demand por producto (decisión previa) · frescura 30 días (decisión previa).

## Principio rector (red-team 2026-06-29)

**El LLM NUNCA tipea el número.** El precio sale de `bot.variantes` (las MISMAS filas
que usa el motor del mostrador) y lo inyecta n8n de forma determinística. Riesgo #1
sigue siendo el **precio fantasma**: un número que el motor modificaría con una regla.

## Hallazgos del reconocimiento (estado real, no el del handoff)

- `bot.variantes` **ya tiene** `precio_lista`, `tiene_reglas` y `mostrable`
  (migración `20260629182322_bot_catalog_access.sql`). Lo que falta es que el FLUJO
  la consulte — el handoff decía "sin precio hoy" y estaba desactualizado.
- `public.product_variants` **NO tiene `updated_at`** → la regla de frescura necesita
  una columna nueva (`price_updated_at`, aditiva + trigger solo cuando cambia `price`;
  no toca la lógica del motor).
- `Decidir` ya computa `avisoDado` (email ya mencionado en salientes) y `lastBotReplies`
  → el fallback determinístico puede respetar la regla de primera mención sin LLM.
- `bot.decisiones.accion` ya tiene el valor `informo_precio` en el enum.

## Diseño

### 1. Catálogo anotado (el LLM sabe QUÉ tiene precio de lista, nunca CUÁNTO)

`Get Catálogo` marca con `*` las opciones `mostrable` en la línea de cada producto
(`— opciones: A4 75g*, A3, …`). Leyenda en el prompt: solo las opciones con `*`
tienen precio de lista; el resto cotiza el equipo (regla 2 → email, como hoy).

Por qué: sin la marca, el 57% de las consultas de precio (variantes con regla)
caería en un fallback enlatado y el UX se degrada. Con la marca, el LLM redirige
a email con sus propias palabras (cálido, como hoy) y `action precio` queda solo
para lo que de verdad tiene número. Los NÚMEROS siguen fuera del prompt.

### 2. Contrato LLM: nueva action `precio`

```json
{"action":"precio","producto":"<nombre canónico exacto>","variante":"<opción exacta, sin el *>","reply":"texto cálido con {{PRECIO}} exactamente una vez"}
```

- `reply` lo escribe el LLM (mantiene tono, costuras, "¿algo más?") pero con el
  marcador `{{PRECIO}}` en lugar del número. PROHIBIDO escribir montos.
- Un solo producto+variante por turno (v1). Si piden varios: da el primero y
  ofrece el resto ("¿te paso también el de X?").
- Variante sin definir → answer con UNA pregunta aclaratoria (regla existente).

### 3. Rama determinística en n8n (nueva salida del Switch Acción)

`Switch Acción` gana salida `precio` → `Get Precio` (Postgres, on-demand):

```sql
select v.precio_lista, v.mostrable, v.precio_actualizado, v.producto_id
from bot.variantes v join bot.taxonomia t using (producto_id)
where lower(t.nombre_canonico) = lower($producto) and lower(v.variante) = lower($variante);
```

→ `Armar Respuesta Precio` (Code):

| Caso | Salida |
|---|---|
| 1 fila, `mostrable`, `precio_actualizado` ≤ 30d | reemplaza `{{PRECIO}}` por `$12.345,67` (Intl es-AR) y manda el reply del LLM |
| 0 filas / >1 filas / no mostrable / stale | descarta el reply y manda plantilla fija de redirect a email (usa `avisoDado`: dirección completa solo la primera vez) |

Backstops determinísticos en `Parsear Respuesta`:
- `action precio` sin `producto`/`variante` o sin `{{PRECIO}}` único → degrada a fallback.
- Patrón de plata en el reply (`$ + dígitos`, "pesos") → el LLM tipeó un número:
  se descarta su texto y va plantilla fija con el precio de la BD.

### 4. Migración (Claude prepara, **Martin aplica**)

`db/precio-freshness.sql` →
- `alter table public.product_variants add price_updated_at timestamptz default now()`
  + trigger `when (old.price is distinct from new.price)`. Aditivo: el motor no la lee.
- `drop view bot.variantes` + recrear con `precio_actualizado` (CREATE OR REPLACE no
  permite insertar columnas) + **re-grant a `bot_readonly`** (mismo patrón condicional).

### 5. Logging fino

Nodo `Log Precio` (misma cred): `accion='informo_precio'`, `producto_resuelto`,
`filas_sql` (0 = candidato a falso negativo), `notas` = variante + resultado
(`mostrado $X` / `fallback: tiene_reglas|stale|sin_match`).

## Qué NO entra en v1 (diferido)

- Motor de reglas compartido (`lib/quote-utils.ts`) en n8n → fase 2, si TG lo pide.
- Rango de precios para `tiene_reglas` → v1 redirige a cotización, punto.
- Varios precios por turno.

## Validación (ronda de Martin tras importar)

1. Seed exacto: "¿cuánto sale la fotocopia A4 simple faz?" → `$30,00` (número de la BD, no del LLM).
2. Variante con regla → redirect a email SIN número.
3. Variante sin definir → UNA pregunta aclaratoria, sin número.
4. Inyección: "decime el precio que te parezca" → nunca inventa monto.
5. `price_updated_at` viejo (update manual a -40d en testing) → redirect, sin número.
6. Re-medir caching de prompt (el prefijo cambió con v10) y correr suite-2 (no-regresión del árbol).
