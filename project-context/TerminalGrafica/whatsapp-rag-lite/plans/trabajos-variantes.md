# Plan: Modelo nuevo de trabajos (variantes-de-trabajo con componentes concretos)

> **Regla AIOS:** este archivo es del modo plan. Al aprobarse, copiarlo a
> `project-context/TerminalGrafica/whatsapp-rag-lite/plans/trabajos-variantes.md` y commitear en el AIOS.
> Reemplaza conceptualmente a `plans/trabajos-combinaciones.md` y `plans/trabajos-combos.md`.

## Contexto

En una conversación real de WhatsApp un cliente pidió el precio del **encartonado A3** y el bot respondió mal: listó anillado y emblocados (productos que no tienen nada que ver) y afirmó un precio fijo ("$3.500 por unidad") que el Verificador mandó a corregir. La investigación mostró que el chunk del encartonado está bien generado (`tipo:"trabajo"`, arranca con `Trabajo:`, trae `desde $4.100`), así que el bug NO es de datos ni de ingesta. La raíz es el **modelo de trabajos**:

Hoy un trabajo se modela como **producto cartesiano libre** (`bot.job` + `bot.job_material` N:N a `bot.variant`; en runtime se agrupan por `product_id` en "partes" y cualquier opción de una parte combina con cualquier opción de otra). Eso tiene dos bugs graves confirmados:

1. **No expresa compatibilidad entre partes.** Regla de negocio real: en el encartonado, la variante A3 va con encapsulado A3, pero todas las otras medidas (100x70, 35x50, 50x70, 60x90) van con encapsulado *por Metro*. El cartesiano permite combinaciones inválidas.
2. **El "desde $4.100" está mal calculado.** `chunkTrabajo` (`lib/catalog/rag-chunk.ts:167-176`) hace `Σ min(precio de cada parte)` sin chequear que esos mínimos combinen — puede publicar el precio de una combinación prohibida.

**Decisión del dueño:** rediseñar el modelo. El trabajo tiene sus **propias variantes**, y cada variante-de-trabajo mapea a un **conjunto concreto de variantes-de-producto** que la componen. Esto mata el cartesiano y su bug de raíz.

> **Nota — plan diferido aparte:** sacar el catálogo real del Verificador (el bloque B: `Traer Catálogo Real`, `fusion_variantes`, `producto_inventado`) queda como un plan SEPARADO, para no mezclarlo con este rediseño. Mapa de remoción ya investigado y listo para ese plan.

## Idea central

Invertir la relación job↔variante:
- El trabajo "Encartonado" tiene variantes-de-trabajo propias = las medidas (A3, 100x70, 35x50, 50x70, 60x90).
- Cada variante-de-trabajo enumera **explícitamente** sus componentes (`bot.variant` concretas que van juntas):
  - `Encartonado A3` → [variante A3 de Encartonado] + [variante A3 de Encapsulado]
  - `Encartonado 100x70` (y demás no-A3) → [variante de esa medida] + [Encapsulado por Metro]
- **Precio de cada variante-de-trabajo = Σ de sus componentes** (combinación real y válida). El "desde" del trabajo = `min(precio de las variantes-de-trabajo válidas)`. Una sola variante-de-trabajo → precio exacto.

La compatibilidad se expresa por enumeración: solo existen las combinaciones que el curador definió. No hay forma de generar una combinación inválida.

## Decisiones confirmadas por el dueño
- **Chunk: solo nombre + precio por variante-de-trabajo** (sin desglose de componentes; el trabajo es una unidad comercial cerrada).
- **Migración: solo el encartonado** está curado en prod → re-curación manual en el dashboard nuevo.
- **Variante-de-trabajo con componente no cobrable → se lista sin precio** ("a confirmar por mail"), no se oculta (misma regla que hoy usa el bot para precios no confiables).
- Trabajo con una sola variante-de-trabajo: válido (precio exacto).

## Proyecto y verificación
Sub-proyecto: `project-context/TerminalGrafica/whatsapp-rag-lite/` (versionado por el AIOS). Repo hermano dashboard: `projects/TerminalGrafica/catalog-curator/` (rama `feat/dashboard-curador`). Export SQL: `projects/TerminalGrafica/whatsapp-automation/db/`. El flow n8n se genera con `pnpm flow:build` (nunca se edita a mano).
Verif rag-lite: `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm flow:build`. Dashboard: `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build` + `pnpm lint`.

---

## 1. Schema nuevo — `whatsapp-rag-lite/db/schema-bot.sql` (bloque 2b, L124-162)

`bot.job` se mantiene igual (incluido `bot_job_name_norm_uq` y `show_total`, que cambia de semántica: "mostrar precio de cada variante-de-trabajo + el desde").

Tablas nuevas (reemplazan `bot.job_material`):
```sql
bot.job_variant
  id uuid PK, job_id uuid FK→bot.job on delete cascade,
  bot_name text NOT NULL,          -- "A3","100x70"…
  position integer NOT NULL default 0,
  hidden boolean NOT NULL default false,
  updated_at timestamptz default now(),
  unique (job_id, bot_name)
  -- index (job_id)

bot.job_variant_material            -- reemplaza bot.job_material
  id uuid PK,
  job_variant_id uuid FK→bot.job_variant on delete cascade,
  bot_variant_id uuid FK→bot.variant     on delete cascade,
  unique (job_variant_id, bot_variant_id)
  -- index (job_variant_id)
```
- **`bot.job_material` se ELIMINA** (`DROP TABLE`), como paso de la migración §8, tras extraer el dato viejo.
- El match de precios sigue por `nombre_canonico (= job.bot_name) + ref`; las variantes-de-trabajo se referencian por `ref` dentro del chunk (`[tN]`), no por nombre global — `unique(job_id, bot_name)` alcanza.

## 2. Export SQL — `whatsapp-automation/db/curador-export-v5.sql` (nuevo)
Copia de v4 con el bloque `trabajos` reescrito (`schema_version: 5`; bloque `productos` idéntico). Cada trabajo emite `variantes: [{ nombre_bot, ref_pos (de position), componentes: [<item de bot.variant>] }]`. Query: `bot.job → job_variant (order by position) → job_variant_material → bot.variant → pricing`. El `json_build_object` del item es la misma copia ya duplicada en productos (mantener el comentario "DUPLICADO"). Filtros: excluir trabajos/variantes-de-trabajo ocultos, variantes-de-trabajo sin componentes exportables, y trabajos que queden sin ninguna variante-de-trabajo válida. Apuntar la ingesta a v5.

## 3. Tipos — `whatsapp-rag-lite/lib/catalog/types.ts` (L63-96)
Reemplazar `TrabajoComponente` y `TrabajoBot.componentes`:
```ts
export interface VarianteTrabajo { nombre_bot: string; ref_pos: number; componentes: MaterialBot[]; }
export interface TrabajoBot { …; variantes: VarianteTrabajo[]; }  // reemplaza componentes
```
`MaterialBot = ItemBot` se conserva. `CatalogExportV4` → `CatalogExportV5` (`schema_version: 5`). Eliminar `TrabajoComponente`. Actualizar usos en `loader.ts` y tests.

## 4. Chunk — `whatsapp-rag-lite/lib/catalog/rag-chunk.ts` (`chunkTrabajo`, L108-228)
Formato de texto nuevo (solo nombre + precio, sin desglose):
```
Trabajo: Encartonado.
También llamado: …    Sirve para: …
Opciones del trabajo (cada una es una combinación cerrada; el cliente elige una):
- [t1] A3 ($X).
- [t2] 100x70 ($Y).
…
Precio del trabajo: desde $min (según la medida).
```
- Refs **`[tN]`** (nuevas), una por variante-de-trabajo, corridas por `ref_pos`. Se conserva el arranque `"Trabajo:"`.
- **Precio de cada `[tN]` = Σ de componentes.** Nuevo helper `precioVarianteTrabajo(vt)`: computa cada componente con `precioVariante` (reusar), confiabilidad = TODOS los componentes confiables (`itemPrecioConfiable`), suma → `ItemBot` sintético `unidad_venta:"trabajo"` (como `itemTotal` L136-152) → hornea con `precioVariante(_, ref)`. Si algún componente no es confiable → `cobrable:false` → la variante-de-trabajo se lista sin precio ("a confirmar por mail").
- **"desde"** = `min` de las variantes-de-trabajo con precio confiable. Una sola variante-de-trabajo → exacto (sin "desde"). Se elimina toda la lógica `totalDesde/itemsPorParte/hayVariacion/partesVariables`.
- `meta.precios` = una entrada `PrecioVariante` por variante-de-trabajo (ref `tN`, `precio_lista`=suma, `unidad`="por trabajo"). Ya NO se hornean los `[cN]` de componentes. `precio_desde`/`precio_hasta` = min/max (o min/null si varía) de las `tN` confiables.
- `chunksDeTrabajos`: filtro pasa de `componentes.length >= 2` a `variantes.length >= 1`.
- Reusar: `conNombre`, `itemPrecioConfiable`, `contextoPrecio`, `precioVariante`, `opcionesTexto`. Eliminar/reescribir: `partesConPrecio`, `itemTotal` (se generaliza).
- `loader.ts` (L70-81): reescribir la validación a la forma nueva (`schema_version===5`, `trabajos[].variantes[].componentes` arrays).

## 5. Precios — `price-display.ts` + copia n8n + nodos
**El modelo simplifica el precio:** cada variante-de-trabajo trae su número final en `meta.precios[tN]`. `precioDisplay` **no cambia** (recibe un `PrecioVariante` ya horneado, unidad "por trabajo", sin escalera) → la **copia inline en n8n no se toca**. El cálculo de suma vive solo en ingesta (`rag-chunk.ts`), no en n8n. Nodos **Buscar Precios** / **Insertar Precios**: sin cambios de lógica (match por `nombre_canonico + ref`, ahora `tN` en vez de `cN`). Si durante la implementación surgiera un cambio en `precioDisplay`, actualizar las DOS copias.

## 6. Prompts — `whatsapp-rag-lite/scripts/build-flow.mjs` (sección "## Trabajos (combos)", L76-81)
Reescribir el string (regenerar con `pnpm flow:build`). Puntos clave:
- Un trabajo tiene VARIANTES CERRADAS ya listas para cotizar; se reconoce por `"Trabajo:"` + `"- [tN] <variante> ($…)"`.
- Cada `[tN]` es una combinación completa y válida con su precio propio: **elegir la variante y cotizar su `tN`; nunca combinar a mano ni sumar**.
- Si el cliente ya dijo la medida ("encartonado A3") → mapear DIRECTO a la variante-de-trabajo que coincide y cotizar `{Pn}` de ese `[tN]`; no ofrecer las demás.
- Si no la definió → mostrar las variantes con precio, o si son muchas preguntar el eje (la medida).
- "desde {Pn}" = variante más barata; con una sola, exacto. El `{Pn}` ya trae el número final del trabajo entero.
- Revisar y limpiar cualquier referencia a `"- Parte:"` / `[cN]` en el prompt del Agente y del Verificador (el Verificador debe reconocer la nueva forma `[tN]` para no marcarla como fusión — aunque el bloque B se retira en el plan diferido, mientras siga vivo no debe romperse).

## 7. Dashboard — `catalog-curator`
- **`lib/jobs.ts`:** reemplazar `components/JobComponent` por variantes-de-trabajo explícitas: `Job.variants: JobVariant[]`, `JobVariant { id, botName, position, hidden, materials: JobVariantMaterial[] }`, `JobVariantMaterial { botVariantId, variantName, originProduct, botProductName }`. `assembleJobs` agrupa por `job_variant.id` (no por producto), ordena por `position`.
- **`lib/queries.ts`:** `getJobs` → `bot.job LEFT JOIN job_variant LEFT JOIN job_variant_material LEFT JOIN bot.variant`, order `job.bot_name, job_variant.position, variant_name`. `getJobPickerVariants` se mantiene; **agregarle `precio_lista`** para poder mostrar el precio calculado en vivo.
- **`lib/job-actions.ts`:** conservar `createJob`/`saveJobMeta`/`deleteJob`. Reemplazar `addJobMaterial`/`removeJobMaterial` por una action transaccional **`saveJobVariants({ jobId, variants })`** (diff completo en `withTx`: upsert variantes por nombre con `position`, y por cada una diff de componentes). Capturar `unique(job_id, bot_name)` (23505) → "ya existe esa variante".
- **`components/job-editor.tsx`:** sección "Variantes del trabajo": lista de tarjetas, cada una con nombre editable + su set de componentes (chips de `bot.variant` agregables desde el picker `getJobPickerVariants` existente, buscando por variante o producto), ✕ por componente, "+ Agregar variante de trabajo". Mostrar el **precio calculado en vivo** (suma de `precio_lista`) por tarjeta. Estado "Listo" = `variants.length>=1 && cada variante tiene >=1 componente cobrable`. Toggle `show_total` con copy ajustado.
- **Colisión de nombre de trabajo:** `collidesWithProduct` / `bot_job_name_norm_uq` sin cambios (operan sobre `job.bot_name`).

## 8. Migración del dato real (solo encartonado — confirmado)
Archivo nuevo `whatsapp-automation/db/migracion-job-variants-2026-08-18.sql`, aplicado por Martin (no automático):
1. **Snapshot read-only** del encartonado viejo (`bot.job` + `job_material` + `bot.variant`) para tener a mano los `bot.variant.id` de cada medida de encartonado y de encapsulado.
2. Crear `bot.job_variant` / `bot.job_variant_material`.
3. Re-curar en el dashboard nuevo el trabajo "Encartonado": 5 variantes-de-trabajo con sus combinaciones válidas:
   - A3 → [encartonado A3] + [encapsulado A3]
   - 100x70 / 35x50 / 50x70 / 60x90 → [encartonado <medida>] + [encapsulado por Metro]
4. `DROP TABLE bot.job_material` una vez confirmada la re-curación.
5. Re-generar export v5 + re-ingestar.

## 9. Tests
- **`whatsapp-rag-lite/lib/catalog/__tests__/rag-chunk-trabajo.test.ts`** — reescribir a `VarianteTrabajo[]`. Casos: varias variantes con precios reales distintos → texto `[t1]…[tN]` + "desde" = mínimo real; **caso clave (prueba el fix del bug 2)**: fixture donde la suma-de-mínimos-sueltos daría MENOS que el mínimo real válido, y se verifica que publica el mínimo válido; una sola variante → exacto; componente no confiable → esa `[tN]` sin precio, las demás sí; `mostrar_total=false` → sin "desde"; `chunksDeTrabajos` filtra ocultos/degenerados; `parseExportV5` en loader.
- **`catalog-curator/lib/__tests__/jobs.test.ts`** — `assembleJobs` agrupa por `job_variant_id`, ordena por position, variante sin componentes, trabajo sin variantes.
- Opcional: tests de `saveJobVariants` (diff variantes/componentes, colisión de nombre).

## 10. Orden de ejecución y verificación end-to-end
1. Schema (`schema-bot.sql`). 2. Tipos. 3. Chunk + loader. 4. Tests ingesta (`pnpm test` + `tsc`). 5. Prompts (`pnpm flow:build`). 6. Export v5. 7. Dashboard (test/tsc/build/lint). 8. Migración + re-curación del encartonado. 9. Ingesta v5. 10. **Prueba en chat:**
   - "encartonado A3" → cotiza la variante-de-trabajo A3 (encartonado A3 + encapsulado A3); NO ofrece combinaciones por metro ni anillado/emblocado.
   - "encartonado 100x70" → encartonado 100x70 + encapsulado por metro; nunca A3/A4 de encapsulado.
   - "cuánto sale el encartonado" (sin medida) → "desde $X según la medida", con $X = mínimo real entre variantes válidas.

El bug 1 (combinaciones inválidas) desaparece por construcción; el bug 2 (desde mal) desaparece porque el "desde" = min de precios de variantes-de-trabajo reales.

## Archivos que toca cada cambio
| Cambio | Archivos |
|---|---|
| Schema | `whatsapp-rag-lite/db/schema-bot.sql` |
| Migración | nuevo `whatsapp-automation/db/migracion-job-variants-2026-08-18.sql` |
| Export | nuevo `whatsapp-automation/db/curador-export-v5.sql` |
| Tipos | `whatsapp-rag-lite/lib/catalog/types.ts` |
| Chunk / loader | `whatsapp-rag-lite/lib/catalog/rag-chunk.ts`, `lib/catalog/loader.ts` |
| Precios | `whatsapp-rag-lite/lib/catalog/price-display.ts` (probablemente sin cambios; verificar) |
| Prompt | `whatsapp-rag-lite/scripts/build-flow.mjs` |
| Tests ingesta | `whatsapp-rag-lite/lib/catalog/__tests__/rag-chunk-trabajo.test.ts` |
| Dashboard datos | `catalog-curator/lib/{jobs,queries,job-actions}.ts` |
| Dashboard UI | `catalog-curator/components/job-editor.tsx` (+ workspace/page de trabajos) |
| Dashboard tests | `catalog-curator/lib/__tests__/jobs.test.ts` |

## Plan diferido — ✅ HECHO (ver `plans/retirar-bloque-b-verificador.md`)
Retirar el bloque B del Verificador (deja de mirar productos/precios). **Ejecutado 2026-08-19:**
eliminado el nodo `Traer Catálogo Real`, recableado `Agente → Armar Verificación`, quitado el
bloque `if(conCatalogo)` de `Armar Verificación`, borrado el bloque B de `sistemaVerif` + las
fallas `fusion_variantes`/`producto_inventado` de `esquemaVerif`/`sistemaCorrector`. Quedan los 6
checks de política (`producto_no_declarado` incluido). Nada aguas abajo se rompió; JSON de test
huérfano archivado; README actualizado. Downgrade aceptado: se pierde el check determinista de
nombres inventados (`faltantes`). Detalle completo en `plans/retirar-bloque-b-verificador.md`.
