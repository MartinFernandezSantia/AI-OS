# Plan: Trabajos con COMBINACIONES (agrupar materiales por producto-bot)

> **Regla AIOS:** archivo del modo plan. Al aprobarse, copiarlo a
> `project-context/TerminalGrafica/whatsapp-rag-lite/plans/trabajos-combinaciones.md` y commitear en el AIOS.
> El código vive en dos repos: `project-context/TerminalGrafica/whatsapp-rag-lite/` (versionado por el AIOS)
> y `projects/TerminalGrafica/catalog-curator/` (repo propio, rama `feat/dashboard-curador`).

## Contexto

Hoy un **trabajo** (combo) es una lista PLANA de materiales (variantes específicas) que se usan TODOS
juntos, uno de cada (`chunkTrabajo` → `Incluye: [c1]…[c2]…` + total = suma). Martin necesita trabajos
con **varias combinaciones**: p. ej. "encartonado con impresión" = producto **Impresión encapada**
(variantes por % de cobertura) + producto **Encartonado** (variantes por tamaño). El cliente elige UNA
opción de cada parte → combinaciones = producto cartesiano.

**Decisiones del dueño:**
1. **Modelo = agrupar por producto-bot, SIN tocar el schema.** Cada `bot.job_material` ya apunta a una
   `bot.variant` que pertenece a un `bot.product`. Se agrupan los materiales por su producto-bot:
   variantes del MISMO producto = alternativas (elegís una), productos distintos = se combinan (una de
   cada). Un trabajo válido combina ≥2 productos distintos. **No cambia `bot.job`/`bot.job_material`.**
2. **Total (cuando `show_total` está on y todos los materiales son confiables):** el bot dice
   **"desde $X dependiendo de Y"**, donde `X` = combinación más barata (Σ del material más barato de cada
   parte). El LLM redacta el "dependiendo de Y" en prosa a partir de las partes que varían. Si el trabajo
   tiene una sola combinación (1 variante por parte), muestra el número exacto (sin "desde").

## Idea rectora

El "combinar" no necesita tabla nueva: **el producto-bot ES el componente**. Se reagrupan los materiales
existentes por `bot.variant.product_id`. El total "desde" se hornea como UNA `PrecioVariante` (ref
`total`, unidad "por trabajo") igual que hoy → **no se toca `price-display.ts` ni su copia en n8n**, y el
validador de precios lo whitelistea gratis. El chunk se autoidentifica (sigue arrancando con `Trabajo:`)
y lista las partes con refs `[cN]` para que el Verificador no lo marque como fusión.

## Cambios — whatsapp-rag-lite (`lib/catalog/` + export + prompts)

### 1. `lib/catalog/types.ts`
- Nuevo `TrabajoComponente { producto_id: string; nombre_bot: string; items: MaterialBot[] }`.
- `TrabajoBot.componentes` pasa de `MaterialBot[]` a **`TrabajoComponente[]`** (partes agrupadas por
  producto-bot). `MaterialBot = ItemBot` sin cambio.

### 2. `whatsapp-automation/db/curador-export-v4.sql` — bloque `trabajos`
`componentes` deja de ser un `json_agg` plano de items y pasa a un `json_agg` de PARTES agrupadas por
producto-bot: por cada `bot.product` presente entre los materiales del trabajo, `{producto_id: bp.key,
nombre_bot: bp.bot_name, items: json_agg(<item json> ...)}` — `from bot.job_material jm join bot.variant
bv join bot.product bp on bp.id=bv.product_id join pricing pr … where jm.job_id=bj.id and not bv.hidden
group by bp.id,bp.key,bp.bot_name order by bp.bot_name`. El `<item json>` sigue siendo la copia EXACTA del
item de producto (mantener el comentario "duplicado, tocar los dos bloques").

### 3. `lib/catalog/rag-chunk.ts` — `chunkTrabajo` (reescritura del cuerpo)
- **Refs `[cN]` corridos** a lo largo de todas las partes (c1, c2, … únicos en el trabajo); `meta.precios`
  los lleva todos (reusa `precioVariante`). Texto agrupado por parte:
  ```
  Trabajo: {nombre}.  (+ También llamado / Sirve para / nota)
  Se arma combinando una opción de cada parte:
  - {Parte A}: [c1] opción ($..); [c2] opción ($..).
  - {Parte B}: [c3] opción ($..); [c4] opción ($..).
  Precio del trabajo: desde {ctx} (varía según {partes con >1 opción}).
  ```
- **Total "desde"** (solo si `mostrar_total` y TODOS los materiales confiables — misma regla
  `itemPrecioConfiable` de hoy): `totalDesde = Σ_parte min(precio_lista de sus items)`; se hornea como
  `precioVariante(itemTotal(producto_id, totalDesde), "total")`. `hayVariacion = alguna parte tiene >1
  item` → línea "desde … (varía según …)"; si no hay variación, línea con el total exacto (sin "desde").
- `meta`: `precio_desde = totalDesde`, `precio_hasta = hayVariacion ? null : totalDesde`,
  `precio_confiable = totalPv != null`, `precios = [...todas las opciones, ...(totalPv?[totalPv]:[])]`,
  `tipo: "trabajo"`.
- `chunksDeTrabajos`: filtro pasa a `!oculto && componentes.length >= 2` (≥2 PARTES/productos). Un
  "trabajo" de 2 variantes del mismo producto colapsa a 1 parte → excluido (correcto: no es combo).

### 4. `lib/catalog/loader.ts`
Actualizar la validación de `trabajos`: cada trabajo tiene `componentes` array y cada componente tiene
`items` array (nueva forma agrupada). Sin back-compat con la forma plana vieja (controlamos el export).

### 5. `lib/catalog/__tests__/rag-chunk-trabajo.test.ts` (reescribir fixtures a la forma agrupada)
Cubrir: refs `[cN]` únicos y agrupados por parte; total "desde" = Σ del más barato por parte;
`hayVariacion` → frase "desde …"; una sola combinación → total exacto; `mostrar_total:false` y material no
confiable → sin total; `<2 partes` excluido por `chunksDeTrabajos`; validación del loader (forma agrupada).

### 6. `scripts/build-flow.mjs` — prompts (Fable + skill `prompt-master`, curar largo)
- Sección **Trabajos**: un trabajo se arma eligiendo UNA opción de cada parte (`- Parte: [c1]…; [c2]…`).
  Cotizar la combinación elegida por sus refs `cN`; si el cliente no eligió, ofrecer las opciones de cada
  parte. Total: **"sale desde {P_total} dependiendo de {las partes que varían}"** (nunca sumar a mano;
  usar el ref `total`).
- Verificador (`fusion_variantes`): describir una opción de cada parte del MISMO trabajo es válido; sigue
  siendo fusión combinar >1 opción dentro de una parte como si fueran juntas, o mezclar partes/opciones de
  trabajos DISTINTOS. Recompilar (`pnpm flow:build`).

## Cambios — catalog-curator (`projects/TerminalGrafica/catalog-curator/`)

### 7. `lib/jobs.ts` + `lib/queries.ts` (`getJobs`)
- `getJobs` suma join `bot.product bp on bp.id = bv.product_id` → selecciona `bp.key as product_key`,
  `bp.bot_name as product_bot_name` por material.
- `assembleJobs` agrupa los materiales por `product_key` → `Job.components: JobComponent[]` donde
  `JobComponent { productKey, productName, variants: JobMaterial[] }`. Se mantiene `materials` plano si
  hace falta para el diff, pero la UI consume `components`.
- `getJobPickerVariants` ya trae `botProductName`; sumar `botProductKey` (`bp.key`) para agrupar estable.

### 8. `components/job-editor.tsx` (display agrupado; acciones SIN cambio)
- Mostrar los materiales **agrupados por parte (producto)**: por cada componente, el nombre del producto
  + sus variantes elegidas (quitar variante suelta o la parte entera). El picker sigue agregando variantes
  (`addJobMaterial`/`removeJobMaterial` quedan igual, son variant-level); se reagrupan solas.
- Estado "Listo" = **≥2 partes** (productos distintos), no ≥2 materiales. Subtítulo: "N partes · M opciones".
  El toggle `show_total` queda; nota aclara que con varias combinaciones el bot muestra "desde".

### 9. `components/job-list.tsx` + `lib/__tests__/jobs.test.ts`
- `ready(job)` = `!hidden && componentes(distintos productos) >= 2`. Badge = cantidad de partes.
- Test `assembleJobs`: agrupa materiales de un mismo producto en una parte; cuenta partes; ordena.

## No cambia
- **Schema** (`db/schema-bot.sql`): `bot.job`/`bot.job_material` intactos (la gran ventaja del modelo).
- **Actions** `addJobMaterial`/`removeJobMaterial`/`createJob`/`saveJobMeta`/`deleteJob`: siguen variant-level.
- `price-display.ts` (+ copia inline en n8n): el total viaja como una `PrecioVariante` más (ref `total`).
- Nodos n8n `Buscar/Insertar Precios`, `Traer Catálogo Real`, `consultar_catalogo`: sin cambios.

## Riesgos
1. **Dos variantes del MISMO producto que van JUNTAS (no alternativas):** el modelo las trata como
   alternativas (una parte). No encaja con los combos de la gráfica; si algún día hace falta, es el
   escape a "componentes con nombre propio" (tabla nueva). Documentar.
2. **Total "desde" engañoso si un material es no confiable:** por eso el total se hornea solo si TODOS los
   materiales son confiables; si no, el bot muestra los precios por opción y no arma "desde".
3. **Refs `[cN]` corridos:** deben ser únicos en el trabajo (el match de precios es por nombre + ref);
   el chunk usa un contador global sobre todas las partes.
4. **Duplicación del item json en el SQL** (export): el item de componente sigue clonando el de producto —
   comentario en ambos bloques.

## Verificación
- **whatsapp-rag-lite:** `pnpm test` (rag-chunk-trabajo reescrito verde) + `pnpm exec tsc --noEmit` +
  `pnpm flow:build` (recompila ambos flows). `pnpm rag:ingest --dry` sobre un export con un trabajo de 2
  partes (impresión × encartonado): el chunk arranca con `Trabajo:`, agrupa "- Parte: [c1]…[c2]…", trae
  `Precio del trabajo: desde …`, `meta.precios` con todas las opciones + `total`.
- **catalog-curator:** `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build` + `pnpm lint`. `pnpm dev`:
  crear un trabajo, agregar 2 variantes de Impresión + 2 de Encartonado → el editor las muestra en 2
  partes; estado "Listo"; guardar.
- **Cierre (Martin, con creds + n8n):** re-exportar → `pnpm rag:ingest --apply` → `pnpm rag:query
  "encartonado con impresión"` aparece; en el chat el bot ofrece las opciones por parte y cotiza
  "desde {P} dependiendo de …"; el Verificador no marca fusión al describir una opción de cada parte.

## Archivos
**whatsapp-rag-lite:** `lib/catalog/{types,loader,rag-chunk}.ts`, `lib/catalog/__tests__/rag-chunk-trabajo.test.ts`,
`scripts/build-flow.mjs`; **sibling** `whatsapp-automation/db/curador-export-v4.sql`.
**catalog-curator:** `lib/jobs.ts`, `lib/queries.ts` (getJobs/getJobPickerVariants), `components/{job-editor,job-list}.tsx`,
`lib/__tests__/jobs.test.ts`.
**Sin tocar:** `db/schema-bot.sql`, `lib/job-actions.ts`, `lib/catalog/price-display.ts` (+ copia n8n), nodos de precios.
