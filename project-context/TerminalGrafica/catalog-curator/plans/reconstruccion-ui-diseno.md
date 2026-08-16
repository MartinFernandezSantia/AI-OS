# Plan: Reconstruir la UI de catalog-curator con el diseño de Claude Design (+ sección Trabajos)

> **Regla AIOS:** este es el archivo del modo plan. Al aprobarse, el PRIMER paso de implementación es
> copiarlo a `project-context/TerminalGrafica/catalog-curator-plan-ui.md` (o `project-context/TerminalGrafica/whatsapp-rag-lite/plans/`)
> y commitearlo en el AIOS. El código de la app vive en `projects/TerminalGrafica/catalog-curator/` (repo propio, rama `feat/dashboard-curador`), NO en el AIOS.

## Contexto

`catalog-curator` (dashboard de curación del catálogo del bot de TG) ya existe y funciona con 2 secciones (Curar, Agrupar), pero con una UI "clonada" de quote-automation-system. Martin diseñó en Claude Design una UI propia y pulida ("Catalog Curator.dc.html", proyecto `0b3c050c…`) que rediseña las 2 secciones **y suma una tercera: Trabajos** (combos `bot.job`/`bot.job_material`, cuyo schema Martin acaba de aplicar). Objetivo: reconstruir la capa de UI de la app con ese diseño, conservando intacta la capa de datos que ya anda, y construir de cero la vertical Trabajos (sin capa de datos hoy en la app).

**Frontera (del mapeo de la app):**
- **PRESERVAR** — todo `lib/` (db, queries, actions, catalog-state, bot-groups, validation, draft, price-preview, labels, catalog/*, utils) + los 4 test suites. Es el modelo de datos, el pool `bot_curator` (`CURATOR_DATABASE_URL`, server-only), las Server Actions y la lógica pura.
- **REEMPLAZAR** — `app/{layout,page,curar/page,agrupar/page}.tsx`, `app/globals.css`, y los `components/*.tsx` de dominio. Se conservan las **props-contrato**: `CategoryGroup[]` (Curar), `BotGroup[]` (Agrupar), el par draft (`initialDraft`/`draftToSaveInput`/`draftsEqual`) y las actions (`saveProduct`/`hideProduct`/`moveVariants`/`updateBotProductMeta`/`deleteBotProduct` con `ActionResult`).
- **NUEVO** — vertical Trabajos: tipos + query + actions + UI + tests.

## Enfoque

Port **fiel** del diseño, expresado idiomáticamente en el stack actual (Next 16 RSC · React 19 · Tailwind v4 · shadcn "new-york" · next-themes · `pg`). NO se usa el `support.js`/dc-runtime de Claude Design (es su runtime de preview): se traduce el template `<x-dc>` a componentes React. Los tokens de color del diseño (oklch, tema claro+oscuro) se cablean como CSS variables en `globals.css`; los primitivos ya instalados se reusan para lo interactivo (`command`=cmdk para ⌘K, `sonner` para toasts, `dialog`/`switch`/`select`/`checkbox`).

## Decisiones aplicadas (respuestas de Martin)
- **Trabajos · total:** el editor lleva un toggle **"Mostrar precio total al cliente"** → escribe `bot.job.show_total`. (El total se CALCULA en la ingesta de whatsapp-rag-lite; acá solo se cura la visibilidad.)
- **"No se vende solo":** se **omite** del editor de variantes (no hay columna en `bot.variant`; no se toca el schema recién aplicado). Queda anotado como posible follow-up (columna + export + chunk).

## Cambios por área (código en `projects/TerminalGrafica/catalog-curator/`)

### 1. Tema y estilos — `app/globals.css` + fuentes
- Definir el set de tokens del diseño como CSS vars en `:root` (claro) y `.dark` (oscuro), mapeando a las vars shadcn existentes (`--background/--foreground/--primary/--border/…`) y sumando las propias del diseño: `--sunken`, `--hover`, `--border-strong`, `--text-muted`, `--text-faint`, `--accent` (terracota `oklch(0.6126 0.1544 43.9343)` claro / `0.6926…` oscuro), `--accent-soft`, `--on-accent`, `--amber(/soft/border)`, `--red(/soft)`. Regla Tailwind v4: cada color definido en AMBOS temas, ninguno solo bajo `.dark`.
- Fuentes por `next/font` (NO el CDN de Google que trae el .dc): `Geist` + **`Geist_Mono`** (agregar Geist Mono si falta) en `app/layout.tsx`, expuestas como `--font-geist`/`--font-geist-mono`.

### 2. Layout + sidebar — `app/layout.tsx`, `components/app-sidebar.tsx`
- Sidebar del diseño: título "Curador · Catálogo del bot · Terminal Gráfica" + **3 items** (Curar / Agrupar / **Trabajos**) con sus SVGs, item activo resaltado. Footer con el progreso de `getProgress()` (se mantiene la llamada RSC del layout). `aside` estático fiel al diseño (puede conservar `useIsMobile`). `ThemeProvider` + `Toaster` se mantienen.

### 3. Curar — `app/curar/page.tsx` (sin cambios de datos) + componentes
Reescribir la UI conservando el contrato `groups: CategoryGroup[]`:
- **Header**: título + "N curados esta sesión · racha de M" (gamificación ligera, cliente, sin emojis, tono sobrio/cálido) + toggle "Solo pendientes" + botón Buscar (⌘K).
- **Filtro por categoría** (chip removible) cuando viene del palette.
- **Cola** (`product-queue`): categorías colapsables con barra de progreso `done/total`, filas con dot de estado (pendiente/curado/oculto/desactualizado — usa `ProductState`/`StateDot`), badge de `variantCount`, punto ámbar "dirty", y el bloque **"N cubiertos en otro grupo"** (redundantes, tachados con `→ destino`) desde `groupedElsewhereCount`/`groupedInto`.
- **Editor master-detail** (`product-editor` + `variant-row` + `chips-editor`): nombre editable, badge de estado, `sourceLabel`; banner ámbar **"El catálogo real sumó variantes"** (`newVariantsCount`/`newVariants`, "Agregar todas"); chips Sinónimos / Casos de uso / Nicho; Nota especial; lista de Variantes con select de unidad (`SALE_UNITS`/`SALE_UNIT_LABEL`) + "Unidad para todas…" + checkbox Pack (**sin** "No se vende solo**"); barra sticky **Guardar y siguiente (⌘↵)** + Ocultar y siguiente. Estados vacío / redundante ("ya no hace falta curarlo → Ir a destino / Ver en Agrupar").
- El estado draft/dirty y las validaciones siguen usando `initialDraft`/`draftToSaveInput`/`draftsEqual`/`normalizeName`; guardar sigue llamando `saveProduct` y ramificando `ActionResult` (`DUP_NAME`→toast).

### 4. Agrupar — `app/agrupar/page.tsx` (sin cambios de datos) + componentes
Reescribir conservando `groups: BotGroup[]`:
- Categorías colapsables → grid de tarjetas-grupo (drag target: `onDragOver/Leave/Drop`), cada variante draggable con handle + checkbox + `source`. Botón "Curar" por grupo (abre `GroupMetaSheet` → `updateBotProductMeta`).
- **Barra de selección flotante**: "N seleccionadas" + "Mover a…" (`targetOptions` = productos-bot) / "+ Crear producto nuevo…" → `moveVariants({kind:"existing"|"new"})` con `slugKey`, undo por toast (sonner).

### 5. Trabajos — NUEVO (data layer + UI)
**Datos** (nuevos archivos en `lib/`, siguiendo los patrones de `bot-groups.ts`/`actions.ts`):
- `lib/jobs.ts`: tipos `JobRow`, `JobMaterialRow`, `JobMaterial` (botVariantId, variantName, productName), `Job` (id, key, botName, synonyms[], useCases[], niche, note, **showTotal**, hidden, materials[]) + `assembleJobs(rows)`; tipo `PickerVariant` (botVariantId, variantName, productName) para el picker. **Test unitario propio** (`lib/__tests__/jobs.test.ts`).
- `lib/queries.ts` (extender): `getJobs()` — `bot.job` left join `bot.job_material`→`bot.variant`→`public.product_variants`/`public.products` (nombres de display) → `assembleJobs`; `getJobPickerVariants()` — lista plana de `bot.variant` con nombre de variante + producto de origen (para el buscador "agregar componente"); `getVisibleJobNames(excludeJobId?)` para la validación de nombre.
- `lib/job-actions.ts` (`"use server"`, transaccional, `revalidatePath("/trabajos")` + layout): `createJob({botName})`, `saveJobMeta({id, botName, synonyms, useCases, niche, note, showTotal, hidden})`, `addJobMaterial({jobId, botVariantId})`, `removeJobMaterial({jobId, botVariantId})`, `deleteJob(jobId)`. Nombre vía `slugKey`/`normalizeName`; captura 23505 → `DUP_NAME`. **Validación anti-colisión job↔product**: el nombre normalizado del trabajo se compara contra productos (`getVisibleBotNames`) Y otros trabajos (`getVisibleJobNames`) — el schema advierte que un job y un product homónimos cruzarían precios en el match por nombre del bot.

**UI** (nuevos componentes + página):
- `app/trabajos/page.tsx` — RSC, `force-dynamic`, `getJobs()` + `getJobPickerVariants()` → `<TrabajosWorkspace>`; error → `<DbError>`.
- `components/trabajos-workspace.tsx` (orquesta), `components/job-list.tsx` (lista lateral + "Nuevo trabajo" inline + badge de `componentCount`), `components/job-editor.tsx` (nombre editable, badge estado, chips Sinónimos/Casos de uso/Nicho, Nota, **toggle "Mostrar precio total al cliente"** → `showTotal`, lista de componentes con `variantName`/`productName` + quitar, y **picker** de búsqueda producto/variante para agregar → `addJobMaterial`), reusando `chips-editor`.

### 6. Transversal — command palette + gamificación + toasts
- **⌘K** (`components/command-palette.tsx` sobre `command`/cmdk): buscar productos entre categorías → saltar al editor + setear filtro de categoría. Atajo global.
- **Gamificación**: contador de sesión + racha, cliente (useState en el workspace de Curar), tono sobrio/cálido **sin emojis** (memoria del proyecto). `DoneDialog`/estado "Catálogo al día" al vaciar la cola.
- **Toasts**: seguir con `sonner` (guardado, DUP_NAME, undo de mover).

## Riesgos
1. **Colisión nombre job↔product (ALTO):** el bot matchea precios por `nombre_canonico` normalizado sobre TODA `bot.rag_catalog`; los índices únicos de `job` y `product` son separados. Mitigación: validación cruzada en `job-actions` (chequear contra productos y trabajos) + toast claro.
2. **Rewrite grande de UI (MEDIO):** se toca casi todo `components/` + `app/`. Mitigación: NO tocar `lib/` → los 4 test suites siguen verdes; `tsc`/`build` como red. Mantener los contratos de props exactos.
3. **Tailwind v4 + oklch en 2 temas (MEDIO):** un color definido solo en `.dark` rompe el tema claro. Mitigación: definir cada token en `:root` y `.dark`; `body` con background explícito.
4. **`show_total` sin re-ingesta:** curar el flag no cambia el chunk hasta re-exportar+`rag:ingest` en whatsapp-rag-lite (proceso manual, ya construido). Documentar.

## Verificación
- `pnpm test` (4 suites existentes intactas + `jobs.test.ts` nuevo), `pnpm exec tsc --noEmit` / `pnpm build`, `pnpm lint`.
- `pnpm dev`:
  - **Curar/Agrupar**: look = diseño (claro y oscuro); guardar/ocultar/mover funcionan igual que antes (data layer intacta).
  - **Trabajos**: crear un trabajo, agregar ≥2 materiales por el picker, cargar sinónimos/casos/nicho/nota, alternar "Mostrar total", guardar; badge de componentes; quitar material; borrar trabajo. Confirmar filas en `bot.job`/`bot.job_material` (rol `bot_curator`).
  - Colisión: crear un trabajo con el nombre de un producto existente → validación lo frena.
- Cierre RAG (opcional, lado whatsapp-rag-lite ya construido): re-exportar + `pnpm rag:ingest --apply` → el chunk del trabajo aparece con su total.

## Archivos
**Nuevos (catalog-curator):** `lib/jobs.ts`, `lib/job-actions.ts`, `lib/__tests__/jobs.test.ts`, `app/trabajos/page.tsx`, `components/{trabajos-workspace,job-list,job-editor,command-palette}.tsx`.
**Modificados:** `app/{layout,page}.tsx`, `app/curar/page.tsx`, `app/agrupar/page.tsx`, `app/globals.css`, `lib/queries.ts` (add getJobs/getJobPickerVariants/getVisibleJobNames), `components/app-sidebar.tsx` + todos los `components/*.tsx` de dominio (curar/agrupar/editor/queue/variant-row/chips/state-dot/done-dialog/move-dialog/group-meta-sheet), `layout` de fuentes (Geist Mono).
**Sin tocar (preservar):** `lib/{db,actions,catalog-state,bot-groups,validation,draft,price-preview,labels,utils}.ts`, `lib/catalog/*`, los 4 test suites existentes, `components/ui/*` (primitivos shadcn, se reusan).
