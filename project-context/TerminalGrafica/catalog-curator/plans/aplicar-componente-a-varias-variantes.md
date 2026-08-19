# Plan: "Aplicar componente a varias variantes" en el editor de Trabajos (catalog-curator)

## Contexto

El modelo nuevo de trabajos (variantes-de-trabajo con componentes concretos) ya está construido y funcionando en el dashboard `catalog-curator` (rama `feat/dashboard-curador`). El editor (`components/job-editor.tsx`) permite crear variantes-de-trabajo (ej. las medidas A3/100x70/35x50/50x70/60x90 del Encartonado) y agregarle a cada una sus componentes concretos (bot.variant) uno por uno, con un buscador inline por variante.

**El dolor:** hay un componente que se **repite en casi todas** las variantes. En el encartonado: A3 va con `encapsulado A3`, pero 100x70, 35x50, 50x70 y 60x90 **todas** van con el mismo `encapsulado por metro`. Hoy hay que abrir el buscador de cada variante y agregar ese mismo componente compartido una por una — puro trabajo repetido. Martin pide bajar ese esfuerzo (ley del menor esfuerzo).

**Decisión de Martin (forma elegida):** un mecanismo de **"aplicar un componente a varias variantes de una vez"** — elegís el componente una sola vez y marcás con checks a qué variantes-de-trabajo aplicarlo (o "Todas"). Así el `encapsulado por metro` se agrega a las 4 medidas en un solo gesto, dejando A3 afuera.

**Resultado buscado:** cargar un trabajo con componente compartido baja de "N buscadores, N agregados manuales" a "1 selección de componente + 1 marcado de variantes".

## Alcance

Solo UI + estado local en el cliente. **El backend NO se toca.** `saveJobVariants` (`lib/job-actions.ts:134`) ya recibe el estado completo de todas las variantes (`variants: [{ id?, botName, botVariantIds }]`) y hace el diff transaccional. Agregar un componente a varias variantes = mutar el `draft` local para que cada `DraftVariant.materialIds` afectado incluya ese `botVariantId`; el guardado normal lo persiste. No cambian `lib/jobs.ts`, `lib/queries.ts`, `lib/job-actions.ts`, ni el schema.

## Diseño

Todo en **`components/job-editor.tsx`**. Reusa piezas que ya existen: el prop `picker: PickerVariant[]` (universo de componentes, ya trae `botProductName`/`botProductKey`/`precioLista`), el mapa `infoOf` (metadata por id), y el componente `components/ui/command.tsx` (cmdk) cuyo `CommandItem` ya soporta multi-select vía `data-checked` (`command.tsx:163`). Molde de referencia: `components/move-dialog.tsx` (CommandDialog de dos secciones).

### 1. Botón de entrada — sección "Variantes del trabajo"

En el header de la sección (`job-editor.tsx:298-303`, junto al `SectionLabel`), agregar un botón **"+ Agregar componente a varias"**. Se deshabilita si `draft.variants.length === 0` (no hay a qué aplicar). Al hacer click abre el diálogo nuevo.

### 2. Componente nuevo `components/apply-component-dialog.tsx`

Un `CommandDialog` (o `Dialog` custom con `CommandInput` embebido) de **dos pasos en una sola pantalla**:

- **Paso 1 — elegir el componente compartido.** Un `CommandInput` que filtra `picker` por `variantName`/`botProductName`/`originProduct` (misma lógica que `variantResults`, `job-editor.tsx:140-154`, extraída/replicada), agrupado por `botProductName` con `CommandGroup heading`. Al seleccionar un `PickerVariant` queda "fijado" arriba (chip con su nombre + producto + precio de lista) y se pasa al paso 2. Debe poder cambiarse (botón "cambiar").
- **Paso 2 — elegir a qué variantes aplicarlo.** Lista de las `draft.variants` con un checkbox cada una (nombre de la variante, o "(sin nombre)" si `botName` vacío; mostrar un check ✓ si esa variante **ya tiene** ese componente, como pista de que aplicar es idempotente). Controles: **"Todas"** / **"Ninguna"**. **Default: todas pre-marcadas** (el caso típico es "a casi todas"; destildar A3 es un gesto). Botón **"Aplicar (N)"** con el conteo de variantes marcadas; deshabilitado si no hay componente elegido o 0 variantes marcadas.

El estado del diálogo es local a él: `const [picked, setPicked] = useState<PickerVariant | null>(null)`, `const [query, setQuery] = useState("")`, `const [selectedKeys, setSelectedKeys] = useState<Set<string>>(...)` (inicializado con todas las keys). Recibe por props: `open`, `onOpenChange`, `picker`, `variants: {key, botName, materialIds}[]` (para nombres + marca de "ya lo tiene"), `onApply(botVariantId, varKeys)`.

### 3. Helper de estado en el editor

Junto a `addMaterial` (`job-editor.tsx:111`), agregar:

```ts
function addMaterialToVariants(id: string, varKeys: string[]) {
  const keys = new Set(varKeys);
  setDraft((d) => ({
    ...d,
    variants: d.variants.map((v) =>
      keys.has(v.key) && !v.materialIds.includes(id)
        ? { ...v, materialIds: [...v.materialIds, id] }
        : v,
    ),
  }));
}
```

Mismo patrón inmutable que `addMaterial`, pero sobre un conjunto de keys e idempotente (no duplica si ya está). El diálogo llama a este helper en su `onApply` y se cierra; el `draft` queda dirty y Martin guarda con el botón "Guardar" de siempre. Toast de confirmación ("Componente agregado a N variantes").

### 4. Estado nuevo en el editor

`const [applyOpen, setApplyOpen] = useState(false)` para controlar el diálogo. Nada más.

## Archivos

| Cambio | Archivo |
|---|---|
| Botón + estado + helper `addMaterialToVariants` + montar diálogo | `components/job-editor.tsx` (editar) |
| Diálogo nuevo "aplicar componente a varias" | `components/apply-component-dialog.tsx` (nuevo) |
| Test del helper puro | `lib/__tests__/jobs.test.ts` o test nuevo del reducer si se extrae |

**No se tocan:** `lib/jobs.ts`, `lib/queries.ts`, `lib/job-actions.ts`, schema, export, prompts, ingesta.

## Tests

El helper `addMaterialToVariants` es lógica pura de estado; conviene extraerlo a una función testeable (recibe `variants` + `id` + `keys`, devuelve `variants` nuevas) o testear el reducer. Casos:
- Agrega el id solo a las keys pasadas; no toca las demás variantes.
- Idempotente: si una variante-destino ya tenía el id, no lo duplica.
- keys vacío → sin cambios.

Verificación del sub-proyecto (según AGENTS.md, este Next tiene breaking changes — no hace falta tocar nada de Next para esta feature): `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build` + `pnpm lint`.

## Verificación end-to-end (manual, en el dashboard)

Con las creds ya configuradas (`CURATOR_DATABASE_URL`), `pnpm dev`, ir a Trabajos → Encartonado:
1. Crear/tener las 5 variantes (A3, 100x70, 35x50, 50x70, 60x90) con su `encartonado <medida>` cada una.
2. Click en **"+ Agregar componente a varias"** → buscar `encapsulado por metro` → paso 2 viene con las 5 pre-marcadas → **destildar A3** → "Aplicar (4)".
3. Verificar que 100x70/35x50/50x70/60x90 ahora muestran `encapsulado por metro` en su lista de componentes (y el precio en vivo se actualizó), y que A3 quedó intacta.
4. Agregar a A3 su `encapsulado A3` con el buscador por-variante de siempre.
5. **Guardar** → recargar → confirmar que persistió (el diff de `saveJobVariants` escribió los `bot.job_variant_material` nuevos).

Esto reproduce exactamente el caso que motivó el pedido, en un solo gesto en vez de cuatro.
