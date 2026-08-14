# Plan — Dashboard de curación del catálogo del bot (greenfield)

> Regla AIOS: los planes viven en el repo. Al aprobar, **mover este archivo** a
> `project-context/TerminalGrafica/catalog-curator/plans/dashboard-curador.md` y commitearlo antes de
> ejecutar (plan mode lo dejó en `~/.claude/plans/`). El **código de la app** va aparte, en
> `projects/TerminalGrafica/catalog-curator/` (proyecto nuevo, su propia carpeta/repo).

## Context

El bot RAG lite ya corre sobre el schema greenfield `bot` (2 tablas de catálogo: `bot.product` +
`bot.variant`, precio por FK a `public`). Falta la herramienta para **curar** ese catálogo: la versión
bot-facing de cada producto (cómo lo nombra, entiende y cotiza el LLM desde la óptica del cliente).

Hoy la curación es un HTML vanilla atado al **schema viejo** (`producto_meta`/`variante_meta`, muerto) y
file-based (export SQL → JSON → HTML → overlay SQL que Martin aplica a mano). **La app Next/React del
backlog (B-26/B-27) nunca se commiteó — no existe código que reusar.** Arrancamos la UI de cero.

Objetivo: un dashboard con sidebar y 2 secciones que **lee en vivo** de Supabase (categorías/productos/
precios de `public`, solo-lectura) y **escribe en vivo** `bot.product`/`bot.variant`, con curación
producto-por-producto amena (gamificación ligera) y prefill de lo ya cargado en `bot`. Que curar cómo
ve el catálogo el LLM no sea engorroso.

Decisiones (esta sesión): campos curables = 8 (nombre, unidad, pack, oculto, nicho, nota, sinónimos,
casos de uso); **color y "calcula el equipo" fuera de alcance**; **ingesta manual por CLI** (el
dashboard NO reingesta); ubicación = proyecto nuevo en `projects/TerminalGrafica/`; gamificación
**ligera**. Plan revisado por un pase de diseño UX/UI (Fable): se adoptan materialize-on-save, cola de
pendientes como flujo primario, guardado explícito, edición en lote, y manejo de drift de public.

## Principios de UX (guían todo lo de abajo)

1. **Cola, no árbol.** El flujo por defecto es avanzar por una cola de pendientes; el árbol de
   categorías y ⌘K son navegación de excepción. La sensación de progreso viene de avanzar por la cola,
   NO de pasos dentro de un producto (nada de wizard multi-pantalla por producto).
2. **Materializar al guardar, no al abrir.** Abrir un producto solo hace prefill en memoria. Se escribe
   `bot.*` únicamente al **Guardar**. Así "existe `bot.product` visible" = curado (métrica binaria y
   limpia), sin filas basura por navegar.
3. **Guardado explícito.** Curar es deliberado; nada de autosave. Estado dirty visible + confirmación
   solo si se navega con cambios sin guardar.
4. **Keyboard-first, 4 atajos.** Minimizar clicks y carga cognitiva; el CTA primario es uno solo.
5. **Gamificación con dato real.** Cada mensaje lleva un número concreto (qué falta, qué ve el bot).
   Cero "¡Genial!" vacíos, cero emojis.

## Stack y ubicación

- **App**: `projects/TerminalGrafica/catalog-curator/` (nombre tentativo; Martin puede renombrarlo).
  Next 16 (App Router/RSC) + React 19 + TypeScript + Tailwind v4 (`@theme` en CSS) + **shadcn/ui
  "new-york"** — mismo stack que `projects/TerminalGrafica/quote-automation-system`, para clonar look &
  feel. pnpm.
- **Estética**: portar tokens de `quote-automation-system/app/globals.css` (OKLCH, acento terracota
  `oklch(0.6126 0.1544 43.9343)`, neutros, radius 0.625rem, Geist + Geist Mono, set de sidebar,
  claro/oscuro con `next-themes`). Reusar componentes shadcn: `sidebar`, `card`, `badge`, `input`,
  `select`, `switch`, `checkbox`, `dialog`, `alert-dialog`, `command`, `collapsible`, `scroll-area`,
  `progress`, `tooltip`, `sonner`, `empty`, `skeleton`.
- **Corre local** (single-user), sin auth en v1. `bot_curator` es least-privilege: el peor caso solo
  toca `bot.product`/`bot.variant` + lee `public`.

## Capa de datos

- **Conexión Postgres directa vía `pg`** (NO Supabase JS: `bot` no está en PostgREST y usamos el rol
  `bot_curator`). Todo **server-side** (Server Actions / route handlers); la connection string nunca
  llega al browser. `.env.local`: `CURATOR_DATABASE_URL` (usuario `bot_curator`, session pooler 5432,
  misma DB que tiene `bot` + `public`).
- **Lee** (bot_curator con SELECT sobre public): `public.categories` (árbol por `parent_id`, filtrar
  `audience='publico'`), `public.products` (`category_id`, `is_active`), `public.product_variants`
  (`price`, `unit`, `color`, `is_active`); y `bot.product` + `bot.variant` (join
  `variant.variant_id` → `public.product_variants.id`) para prefill.
- **Escribe** (bot_curator: SELECT/INSERT/UPDATE/DELETE sobre `bot.product`, `bot.variant`), en **una
  Server Action transaccional** que persiste producto + todas sus variantes juntas:
  - `bot.product` upsert por `key` (slug natural estable testing↔prod): `bot_name`, `synonyms[]`,
    `use_cases[]`, `niche`, `note`, `hidden`.
  - `bot.variant` upsert por `(product_id, variant_id)`: `bot_name`, `sale_unit`, `pack_units`,
    `by_pack`, `hidden`.
- **Estado por producto (derivado, sin columna nueva):**
  - **pendiente**: no existe `bot.product` (visible) para ese producto de public.
  - **curado**: existe `bot.product` visible con `bot_name`.
  - **oculto**: `bot.product.hidden` (o del producto public marcado oculto).
  - **desactualizado (drift)**: existe `bot.product` pero hay variantes activas en `public` sin fila en
    `bot.variant` → vuelve a la cola con badge "N variantes nuevas" (diff barato gracias a
    materialize-on-save; evita desincronización silenciosa).
  - **Progreso** = `count(bot.product visibles) / count(productos public activos)`.
- **Constraints a validar en la UI** (no comerse el error de índice): `bot.product.bot_name` **único
  normalizado** (translate acentos + lower + trim) entre visibles — chequeo en vivo, debounced, error
  inline con link al homónimo; **trampa**: el índice ignora ocultos, así que al **des-ocultar** puede
  nacer la colisión → validar también en ese toggle. Cada `public.product_variants.id` cuelga de **un
  solo** `bot.product` (índice único sobre `variant_id`) → en Agrupar la única operación es *mover*.

## Mapeo campo-UI → columna

| Campo UI | Columna | Nivel |
|---|---|---|
| nombre bot | `product.bot_name` / `variant.bot_name` | producto (oblig.) / variante (nullable → hereda public) |
| unidad de cobro | `variant.sale_unit` (enum `bot.sale_unit`) | variante — opción explícita "No cobrable → deriva a mail" = null |
| pack | `variant.by_pack` + `variant.pack_units` | variante |
| oculto | `product.hidden` / `variant.hidden` | ambos |
| nicho | `product.niche` (texto libre; Tooltip explica "null si mezcla nicho/no-nicho") | producto |
| nota especial | `product.note` | producto |
| sinónimos | `product.synonyms[]` | producto |
| casos de uso | `product.use_cases[]` | producto |

`color` (de `public.product_variants.color`) se **muestra** para identificar la variante, no se edita.
`sale_unit` enum: `unidad, hoja, pagina, m2, metro, trabajo, plancha_a3, hoja_a3` + opción "No cobrable".

## Secciones (sidebar: Curar · Agrupar; progreso en footer del sidebar)

### Sección Curar (flujo principal, master-detail, gamificado)
Layout dos columnas:
- **Izquierda (~280px, `ScrollArea`)**: cola de pendientes agrupada por categoría (`Collapsible` con
  badge `3/7` por categoría), dot de estado por producto (○ pendiente / ● terracota curado / ◑
  desactualizado / ◌ oculto). Toggle **"Solo pendientes" ON por defecto** (`Switch` en el header). ⌘K
  (`Command`) para saltar a cualquier producto por nombre.
- **Derecha (editor enfocado, un solo editor, dos bloques):**
  - **Bloque producto** (arriba): `bot_name` con **autofocus + texto seleccionado**, `synonyms[]` y
    `use_cases[]` como **chips** (Enter agrega, Backspace con input vacío borra el último;
    placeholder didáctico en casos de uso: *"cómo lo pediría un cliente: 'para eventos'…"*), `niche`,
    `note`, `hidden`.
  - **Bloque variantes** (abajo, filas compactas tipo card, no `Table` apretada): por variante
    `[nombre public muted] [Input bot_name placeholder="hereda: {public}"] [Select unidad] [Switch
    pack + Input pack_units condicional] [Switch oculto]` y a la derecha, en segundo plano tipográfico
    (Geist Mono, muted): **color (Badge)** + **precio** vía `contextoPrecio` (lo que verá el bot).
    Header del bloque con **"Unidad para todas: —"** (setea `sale_unit` en todas y luego se overridea
    por fila) — clave para las ~186 variantes. Si un producto tiene 20+ variantes, sumar filtro "solo
    sin unidad".
- **Acciones**: CTA primario único **"Guardar y siguiente"** (terracota, `Cmd/Ctrl+Enter`); secundario
  **"Ocultar y siguiente"** (ghost, ojo tachado → marca `hidden`, guarda mínimo, avanza; toast con
  "Deshacer"). Navegar en la cola sin guardar: `Alt+↑/↓`. Estado dirty = badge "Sin guardar" + dot
  ámbar en la lista; `AlertDialog` solo si navega con cambios ("Guardar y salir / Descartar /
  Cancelar"). Al guardar, el dot flipea a curado a la vista (micro-recompensa).

### Sección Agrupar (estructura — solo "mover")
Para lo que NO es 1:1: juntar variantes de varios productos de public bajo un mismo producto-bot, o
separar. Lista de productos-bot con sus variantes colgando; se seleccionan variantes con `Checkbox` →
**"Mover a…"** abre `Command` dialog (buscar producto-bot destino o "Crear producto nuevo…" inline).
Antes de confirmar, **línea de consecuencia**: *"3 variantes salen de 'Tarjetas estándar' y pasan a
'Tarjetas'."* Si un producto-bot queda sin variantes: `AlertDialog` "queda vacío — ¿borrarlo?". Toast
con "Deshacer". Mover nunca duplica → el constraint "una variante → un solo producto-bot" se vuelve
intuitivo. Sin drag & drop (over-engineering para 1 usuario).

### Progreso y gamificación (ligera, transversal)
- **Persistente**: `Progress` + "23/34 productos" en el **footer del sidebar** (siempre visible).
- **Sesión**: contador "7 curados esta sesión" en el header de Curar (la racha útil; sin streak diario
  persistido).
- **Micro-celebración**: sonner al guardar con copy variado y concreto (rotar 5-6 templates): *"Lonas
  listo. Quedan 11."* / *"Ese tenía 12 variantes — buen trabajo."*
- **Hitos**: toast destacado en 25/50/75% (*"Mitad del catálogo. El bot ya ve 17 productos."*) y al
  **100%** una pantalla de cierre con resumen + paso siguiente accionable y copiable: *"Catálogo
  curado. Corré `pnpm rag:ingest --apply` para que el bot lo vea."* (un solo confetti acá, no en cada
  guardado).

### Empty / error states
Sin `CURATOR_DATABASE_URL` o conexión caída → componente `Empty` con causa + fix en bloque mono, no
spinner eterno ni stack trace. Catálogo bot vacío (primer arranque) → *"34 productos esperan
curación"* + CTA "Empezar por el primero". Error de guardado → el form **no se limpia**, toast
destructive + reintento. `Skeleton` solo en la carga inicial de la cola.

## Reuso concreto

- `whatsapp-rag-lite/lib/catalog/price-display.ts` (`contextoPrecio`) y `types.ts` (shape export v4):
  **preferir import por ruta relativa** si el tooling lo permite (el precio mostrado debe ser el que ve
  el bot; vendorizar una copia es frágil por drift). Si el cruce projects/ ↔ project-context/ complica
  el build, vendorizar con el comentario "si tocás una, actualizá la otra".
- Patrones UX del curador HTML viejo (no el código): lista+detalle, chips, estado por dot, "solo
  pendientes", resolución por **clave natural** (`key`), reparación de mojibake al mostrar.
- NO reusar: `data-model.md`, `curador-catalogo.html`, `catalogo-bot-grupos.sql`,
  `producto_meta`/`variante_meta`, exports v2/v3 (schema viejo).

## Estructura nueva (esqueleto)

```
projects/TerminalGrafica/catalog-curator/
  package.json, next.config, tsconfig, postcss (Tailwind v4), components.json
  app/globals.css              # tokens portados de quote-automation-system
  app/layout.tsx               # sidebar (Curar/Agrupar + Progress footer) + theme (Geist)
  app/curar/…                  # master-detail + editor
  app/agrupar/…                # mover variantes entre productos-bot
  lib/db.ts                    # pool `pg` (bot_curator), server-only
  lib/queries.ts               # SELECTs public + bot + cómputo de estado/drift/progreso
  lib/actions.ts               # Server Actions: upsert transaccional product+variants, mover, ocultar
  lib/validation.ts            # nombre normalizado (mismo translate/lower/trim del índice)
  lib/catalog/                 # price-display.ts + types.ts (import o vendor)
  components/ui/…              # shadcn portados
  components/…                 # ProductQueue, ProductEditor, ChipsEditor, VariantRow, MoveDialog,
                                #  ProgressFooter, StateDot, EmptyState
```

## Verificación (end-to-end)

1. `pnpm install && pnpm dev`; con `CURATOR_DATABASE_URL` seteado, la cola carga productos de public
   (audience publico, is_active) parada en el primer pendiente.
2. Curar un pendiente y "Guardar y siguiente" → `SELECT` confirma filas en `bot.product` +
   `bot.variant`; **navegar sin guardar NO deja filas** (materialize-on-save); re-abrir un curado →
   prefill correcto y dot verde.
3. Validaciones: `bot_name` homónimo visible → bloqueado en vivo antes del índice; des-ocultar que crea
   colisión → también bloqueado; en Agrupar, "mover" respeta una-variante-un-producto y avisa vacío.
4. "Unidad para todas" setea todas y se overridea por fila; "No cobrable" persiste `sale_unit=null`.
5. Drift: agregar (simular) una variante activa en public a un producto ya curado → aparece como
   "desactualizado" con "1 variante nueva".
6. Progreso: contador de sesión sube, footer refleja X/N, hito y pantalla de cierre al 100%.
7. Correr **a mano** en whatsapp-rag-lite: `pnpm rag:ingest --dry` y luego `--apply` → `bot.rag_catalog`
   refleja la curación (paso de owner, fuera del dashboard).
8. Tests unitarios (vitest, como whatsapp-rag-lite): validación de nombre normalizado, mapeo
   UI→columna, cómputo de estado (pendiente/curado/desactualizado) y progreso.

## Pasos que aplica Martin (tras aprobar y construir)

- Poner password al rol `bot_curator` (creado NOLOGIN por el schema) y armar `CURATOR_DATABASE_URL`.
- Correr el dashboard local, curar el catálogo (arrancar vacío y re-curar, como dice el greenfield).
- Al terminar una tanda: `pnpm rag:ingest --apply` en whatsapp-rag-lite para volcar a `rag_catalog`.

## Follow-ups (fuera de alcance)

- color editable / flag explícito "calcula el equipo" (columnas nuevas en `bot`).
- Botón "Reingestar" en el dashboard (creds de owner + `GEMINI_API_KEY` server-side).
- Curar `bot.business_info` desde la UI (hoy owner-only: falta grant + policy para `bot_curator`).
- `niche` como `Select` con creación si resulta ser un set chico de valores (evita "sublimacion" vs
  "sublimación") — decidir al ver los datos reales.
- Deploy con auth si deja de ser local.
