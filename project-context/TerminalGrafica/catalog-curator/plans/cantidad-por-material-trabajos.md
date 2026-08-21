# Cantidad por material en Trabajos

## Contexto

Hoy, el precio de una variante-de-trabajo (ej. "A3" de un trabajo "Encartonado") es la suma directa del
`precio_lista` de cada uno de sus componentes/materiales, asumiendo implícitamente que se usa **1 unidad
completa** de cada uno. Eso no siempre es cierto: por ejemplo un componente vendido "por metro" puede
usarse a razón de 0.5 (medio metro) en una variante y 1.2 en otra. Sin esta feature, el precio calculado
del trabajo queda sobrevaluado o subvaluado según el caso.

Martín pidió poder fijar, por cada material dentro de una variante-de-trabajo, cuánto de ese material se
usa (default 1, decimal libre, mínimo >0), y que eso multiplique el `precio_lista` del componente antes de
sumarlo al total. Confirmado con él: cantidad es por MATERIAL (no por variante-de-trabajo entera), sin
tope superior, con un input numérico chico al lado del precio de cada componente que recalcula en vivo.

Esto toca 3 capas: la base de datos (`bot.job_variant_material` no tiene columna de cantidad hoy — la
`unique(job_variant_id, bot_variant_id)` la modela como un set, sin forma de repetir), el dashboard de
curación (`catalog-curator`, este repo — UI + persistencia), y el cálculo de precio real que corre en la
ingesta al bot (vive vendorizado en dos lugares: `whatsapp-rag-lite`, la fuente de verdad, y una copia
idéntica en `catalog-curator/lib/catalog/` que es la que REALMENTE ejecuta el botón "Ingestar al bot").

**Importante sobre alcance de commits**: `whatsapp-rag-lite` vive en `project-context/TerminalGrafica/`
dentro del propio repo del AIOS (no es un repo git separado, no es un submódulo). `catalog-curator` es un
repo propio bajo `projects/`, ya en su rama `feat/dashboard-curador`. Por disciplina del CLAUDE.md: los
cambios en `catalog-curator` van en esa rama feature (nunca a su main); los cambios en `whatsapp-rag-lite`
van directo al AIOS en la rama de trabajo actual (`feat/dashboard-catalogo-b26`), ya que esa regla de
"nunca commitear a main" aplica solo a repos bajo `projects/`.

## Shape elegido (uniforme en los 4 lugares que hoy usan `materialIds: string[]` / `botVariantIds: string[]`)

```ts
interface DraftMaterial {
  botVariantId: string;
  quantity: number; // > 0, decimal libre, default 1
}
```

Se renombra el campo contenedor de `materialIds`/`botVariantIds` a `materials` en los 4 lugares:
`DraftVariantLike` (lib/jobs.ts), `DraftVariant` (job-editor.tsx), `ApplyTargetVariant`
(apply-component-dialog.tsx), `JobVariantInput` (job-actions.ts).

## A) DB — `bot.job_variant_material.quantity`

Archivo: `project-context/TerminalGrafica/whatsapp-rag-lite/db/schema-bot.sql`, líneas 174-180 (el
`CREATE TABLE`). Sigue el patrón exacto ya usado para `bot.log.denied_products` (línea 239): agregar la
columna al `CREATE TABLE` (bases nuevas) + un `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` idempotente
inmediatamente después (prod existente). **Este SQL no se ejecuta desde código — es un artefacto que
Martín corre a mano en prod**, como todo lo demás en esta carpeta.

```sql
create table if not exists bot.job_variant_material (
  id             uuid primary key default gen_random_uuid(),
  job_variant_id uuid not null references bot.job_variant(id) on delete cascade,
  bot_variant_id uuid not null references bot.variant(id)     on delete cascade,
  quantity       numeric not null default 1
    constraint bot_job_variant_material_quantity_check check (quantity > 0),
  unique (job_variant_id, bot_variant_id)
);
create index if not exists bot_job_variant_material_jv_idx on bot.job_variant_material (job_variant_id);
-- Idempotente para bases YA creadas (mismo patrón que bot.log.denied_products, línea 239):
alter table bot.job_variant_material add column if not exists quantity numeric not null default 1;
alter table bot.job_variant_material drop constraint if exists bot_job_variant_material_quantity_check;
alter table bot.job_variant_material add constraint bot_job_variant_material_quantity_check check (quantity > 0);
comment on column bot.job_variant_material.quantity is
  'Cuánto de este componente usa la variante-de-trabajo (ej. 0.5 = medio metro). Multiplica su precio_lista antes de sumar. Default 1.';
```

El check inline en el `CREATE TABLE` va **nombrado explícitamente** con el mismo nombre que usa el
drop+add de abajo (`bot_job_variant_material_quantity_check`) — así, en una base nueva donde el CREATE ya
lo trae, el `drop constraint if exists` + `add constraint` de abajo es un no-op limpio en vez de crear un
segundo check idéntico con nombre auto-generado por Postgres.

`ADD COLUMN ... DEFAULT 1` ya backfillea las filas existentes — no hace falta UPDATE aparte. El `check` se
agrega con drop+add por fuera (sin `IF NOT EXISTS` nativo en checks) para poder re-correr el script sin
error.

No crear carpeta de migraciones nueva — todo vive en `schema-bot.sql`, siguiendo el patrón ya establecido.

## B) catalog-curator — lectura (`lib/queries.ts` + `lib/jobs.ts`)

**`lib/queries.ts`** (`getJobs`, líneas ~110-131): agregar `jvm.quantity as quantity` al SELECT, después
de `bp.bot_name as product_bot_name`.

**`lib/jobs.ts`**:
- `JobRow`: agregar `quantity: string | null;` — **no `number`**. El driver `pg` devuelve columnas
  `numeric` como string (a diferencia de `int`/`float8`), así que tipar `number` acá sería falso y
  ocultaría el punto exacto donde hay que castear. `precioLista` en `queries.ts`/`PickerVariant` ya sigue
  este mismo criterio (castea con `Number()` al consumirlo, no en el tipo de la fila cruda).
- `JobVariantMaterial`: agregar `quantity: number;` (este sí, ya en el dominio ensamblado — no es la fila
  cruda de pg).
- `assembleJobs`, en el push de materials: `quantity: Number(r.quantity ?? 1)` — cast obligatorio acá,
  el único punto de entrada de `quantity` desde una fila de pg.
- `DraftVariantLike` → `{ key: string; materials: DraftMaterial[] }` (con `DraftMaterial` definido arriba).
- `addMaterialToVariants`: adaptar al nuevo shape, sigue siendo idempotente por `botVariantId` (agrega con
  `quantity: 1` si no existe; si ya existe, no lo toca — no pisa una quantity personalizada):
  ```ts
  export function addMaterialToVariants<V extends DraftVariantLike>(
    variants: V[], botVariantId: string, varKeys: string[],
  ): V[] {
    const keys = new Set(varKeys);
    return variants.map((v) =>
      keys.has(v.key) && !v.materials.some((m) => m.botVariantId === botVariantId)
        ? { ...v, materials: [...v.materials, { botVariantId, quantity: 1 }] }
        : v,
    );
  }
  ```

**`lib/__tests__/jobs.test.ts`**:
- El helper `row()` (que arma un `JobRow` completo con defaults, usado por TODOS los tests de
  `assembleJobs`) necesita sumar `quantity: null` a sus defaults — si no, tsc rompe apenas `JobRow` gane
  el campo nuevo obligatorio. Es trivial pero hay que hacerlo, el shape actual del helper no lo cubre solo.
- Actualizar los fixtures del describe `addMaterialToVariants` (hoy `{ key, materialIds: [...] }`) al
  nuevo shape `{ key, materials: [{ botVariantId, quantity: 1 }, ...] }`, y las aserciones `.toEqual([...])`
  sobre ids a comparar `materials.map(m => m.botVariantId)`. Agregar un test de "agrega con quantity=1 por
  default" y uno que confirme que no pisa la quantity de un material que ya estaba con quantity ≠ 1.
- Agregar un test de `assembleJobs` que pase `quantity: "0.5"` (string, como lo entrega pg realmente — no
  `0.5` number) en una fila, y afirme `materials[0].quantity === 0.5` (number, ya casteado). Sin este test
  el bug string-vs-number en `assembleJobs` queda intesteable por construcción (mismo espíritu que la
  memoria "los fixtures mienten": si el fixture ya tipa `quantity` como number, el caso real de pg nunca
  se ejercita).

## C) catalog-curator — escritura (`lib/job-actions.ts`)

**`JobVariantInput`**:
```ts
export interface JobVariantInput {
  id?: string;
  botName: string;
  materials: { botVariantId: string; quantity: number }[];
}
```

**`saveJobVariants`**: mantiene el mismo esqueleto transaccional (loop por variante, `keepIds`, delete de
variantes sobrantes al final). Dos cambios puntuales:

1. Validación server-side de `quantity > 0`, junto a las validaciones de nombre ya existentes, antes de
   abrir la transacción. **No alcanza con `m.quantity > 0`**: `Infinity` pasa esa condición sin problema
   (`Infinity > 0` es `true`), `numeric` en Postgres lo acepta, y recién explota mucho después en la
   ingesta con "cannot convert infinity to json" al armar el export — un dato podrido guardado
   silenciosamente que rompe en un punto lejano y confuso. Validar también `Number.isFinite`:
   ```ts
   const badQty = input.variants.some((v) =>
     v.materials.some((m) => !Number.isFinite(m.quantity) || m.quantity <= 0)
   );
   if (badQty) {
     return { ok: false, error: "VALIDATION", message: "La cantidad de un componente debe ser mayor a 0." };
   }
   ```
2. El bloque de sync de componentes dentro del loop (hoy dedup con `Set` + DELETE + INSERT ON CONFLICT DO
   NOTHING) pasa a:
   ```ts
   const wantedMap = new Map(v.materials.map((m) => [m.botVariantId, m.quantity]));
   const wanted = [...wantedMap.keys()];
   await c.query(
     `delete from bot.job_variant_material
       where job_variant_id = $1
         and ($2::uuid[] = '{}' or bot_variant_id <> all($2::uuid[]))`,
     [variantId, wanted]
   );
   for (const [bvId, qty] of wantedMap) {
     await c.query(
       `insert into bot.job_variant_material (job_variant_id, bot_variant_id, quantity) values ($1, $2, $3)
         on conflict (job_variant_id, bot_variant_id) do update set quantity = excluded.quantity`,
       [variantId, bvId, qty]
     );
   }
   ```
   Único cambio real: `DO NOTHING` → `DO UPDATE SET quantity = excluded.quantity`, para que editar la
   cantidad de un material ya guardado se persista al guardar de nuevo.

Resto de `saveJobVariants` (creación/rename de variantes-de-trabajo, borrado de sobrantes, manejo de
`isUniqueViolation`) queda intacto.

## D) catalog-curator — UI (`components/job-editor.tsx`)

- `DraftVariant.materialIds: string[]` → `materials: DraftMaterial[]`.
- `toDraft`: mapear `materials: v.materials.map((m) => ({ botVariantId: m.botVariantId, quantity: m.quantity }))`.
- `addMaterial`: agrega `{ botVariantId: id, quantity: 1 }` si no existe (mismo guard idempotente que hoy,
  adaptado al nuevo shape).
- `removeMaterial`: filtra por `m.botVariantId !== id`.
- Función nueva `patchMaterialQuantity(varKey, botVariantId, quantity)`: actualiza la `quantity` de un
  material puntual dentro de una variante-de-trabajo vía `patchVariant`.
- `precioVariante(v)`: multiplica antes de sumar — `suma += p * m.quantity` en vez de `suma += p`.
- `variantResults` (el filtro del picker que excluye materiales ya agregados): usar
  `v.materials.map(m => m.botVariantId)` en vez de `v.materialIds`.
- `save()`: mapear `materials: v.materials.map((m) => ({ botVariantId: m.botVariantId, quantity: m.quantity }))`
  al armar `JobVariantInput[]`.
- `ready` (criterio de "listo" del trabajo): `v.materials.length >= 1` en vez de `v.materialIds.length >= 1`.

**JSX del bloque de materiales** (el `<div className="divide-border flex flex-col divide-y">` que mapea
cada componente de una variante-de-trabajo con nombre + precio + botón ✕): insertar un input de cantidad
entre el precio unitario y el botón de quitar. Mostrar también el precio de LÍNEA ya multiplicado.

⚠️ **Ojo con el input controlado directo desde `m.quantity` (number)**: si `value` viene del draft y el
`onChange` solo propaga cuando `Number.isFinite(n) && n > 0`, el usuario NO puede escribir "0.5" — al
borrar el campo o tipear el "0" inicial, `parseFloat` da `NaN`/`0`, no se patchea el draft, y React fuerza
el input de vuelta al valor viejo en cada keystroke. El campo "rebota" y es casi imposible teclear
cualquier decimal que arranque en 0, que es EXACTAMENTE el caso de uso pedido (medio metro). Esto no lo
detecta la prueba manual de "0 / vacío / texto" porque técnicamente no rompe nada — la feature simplemente
queda inusable para el caso principal. Usar un **componente de fila con estado local string**, separado
del componente padre:

```tsx
function MaterialRow({
  m, info, onQuantityChange, onRemove,
}: {
  m: DraftMaterial;
  info: { variantName: string; productName: string; precioLista: number | null } | undefined;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  const [qtyText, setQtyText] = useState(String(m.quantity));
  // Si el draft cambia por fuera (ej. reset al cambiar de trabajo), resincronizar el texto local.
  useEffect(() => setQtyText(String(m.quantity)), [m.quantity]);

  function commit() {
    const n = parseFloat(qtyText);
    if (Number.isFinite(n) && n > 0) onQuantityChange(n);
    else setQtyText(String(m.quantity)); // input inválido → revierte al último valor válido
  }

  const lineTotal = info?.precioLista != null ? info.precioLista * m.quantity : null;
  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm">
        {info?.variantName ?? "(variante)"}
        {info?.productName ? <span className="text-text-faint"> · {info.productName}</span> : null}
      </span>
      <div className="text-text-faint flex shrink-0 items-center gap-1 text-[11px]">
        <span>×</span>
        <input
          type="number"
          step="any"
          min="0.01"
          value={qtyText}
          onChange={(e) => setQtyText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="border-border w-14 cursor-text rounded border bg-transparent px-1 py-0.5 text-right text-[11px] outline-none focus:border-primary"
        />
      </div>
      {lineTotal != null && (
        <span className="text-text-faint shrink-0 font-mono text-[11px]">{fmt(lineTotal)}</span>
      )}
      <button
        onClick={onRemove}
        className="text-text-faint hover:text-foreground shrink-0 cursor-pointer text-[13px] transition-colors"
        aria-label="Quitar componente"
      >
        ✕
      </button>
    </div>
  );
}
```

Y en el bloque que mapea `v.materials`, reemplazar el `<div key={...}>` inline por `<MaterialRow>`:

```tsx
{v.materials.map((m) => (
  <MaterialRow
    key={m.botVariantId}
    m={m}
    info={infoOf.get(m.botVariantId)}
    onQuantityChange={(n) => patchMaterialQuantity(v.key, m.botVariantId, n)}
    onRemove={() => removeMaterial(v.key, m.botVariantId)}
  />
))}
{v.materials.length === 0 && (
  <div className="text-text-faint px-3 py-2 text-[12.5px]">Sin componentes todavía</div>
)}
```

`step="any" min="0.01"` acepta decimales libres. El commit pasa por `onBlur`/Enter en vez de por
keystroke, así que el usuario puede escribir libremente ("0", "0.", "0.5") sin que el campo rebote; solo
al salir del input (o Enter) se valida y propaga — o revierte si quedó inválido. El recálculo en vivo del
total de la variante (header) sigue funcionando sin lógica adicional una vez que el commit llega al draft:
`precioVariante(v)` se recalcula en cada render leyendo `draft.variants`. `dirty` (`JSON.stringify` del
draft vs. snapshot) también sigue funcionando sin tocar nada — `quantity` ya queda incluida en la
serialización.

**`ApplyComponentDialog`** (donde se le pasan `variants` al diálogo): cambiar `materialIds: v.materialIds`
por `materials: v.materials`.

## E) catalog-curator — `components/apply-component-dialog.tsx`

- `ApplyTargetVariant.materialIds: string[]` → `materials: { botVariantId: string; quantity: number }[]`.
- `alreadyHas`: `v.materials.some((m) => m.botVariantId === picked.botVariantId)`.

Sin más cambios — este diálogo sigue agregando con `quantity: 1` por default vía `addMaterialToVariants`
(no pide cantidad en ese paso; se ajusta después por variante en el editor, como confirmó Martín).

## F) whatsapp-rag-lite (fuente de verdad) + vendor en catalog-curator — cálculo real de precio

Cambios en sync en los pares vendor/fuente (hoy idénticos salvo el header de 3 líneas "VENDOR: copia de…"):

**F.1 — `lib/catalog/types.ts`** (whatsapp-rag-lite Y `catalog-curator/lib/catalog/types.ts`): agregar
`cantidad` como **opcional** en `ItemBot` (no rompe productos normales, que nunca la traen y siguen
tratándose como cantidad implícita 1):
```ts
export interface ItemBot {
  // ...campos existentes sin cambios...
  cantidad?: number; // solo relevante para MaterialBot (componente de trabajo); undefined = 1.
}
```

**F.2 — `lib/catalog/rag-chunk.ts`** (whatsapp-rag-lite Y `catalog-curator/lib/catalog/rag-chunk.ts`),
dentro de `precioVarianteTrabajo`:
```ts
// antes:
const suma = componentes.reduce((acc, it) => acc + (Number(it.precio_lista) || 0), 0);
// después:
const suma = componentes.reduce(
  (acc, it) => acc + (Number(it.precio_lista) || 0) * (Number(it.cantidad) || 1),
  0,
);
```
`Number(it.cantidad) || 1` cubre `undefined`/`null`/`0`/`NaN` → caen a 1. No hace falta tocar
`itemPrecioConfiable`, `marca()`, ni nada en `price-display.ts`: esas funciones reciben el precio YA
multiplicado (vía el item sintético `itemVarianteTrabajo`, que recibe el `total` ya sumado). `price-display.ts`
no se toca.

**F.3 — `db/schema-bot.sql`**: ya cubierto en la sección A.

**F.4 — `catalog-curator/lib/catalog/export-v5-sql.ts`** (el que REALMENTE ejecuta la ingesta vía la
Server Action `buildCatalogChunks` en `lib/rag-actions.ts`): en el bloque `'trabajos' → 'variantes' →
'componentes'`, agregar una línea al `json_build_object`:
```sql
'n_reglas_cantidad',  pr.n_reglas_cantidad,
'cantidad',           jvm.quantity
```
`jvm` ya está en el `FROM`/`JOIN` de esa subquery — no hace falta agregar ningún join nuevo.

**⚠️ Orden de despliegue**: mientras la columna `quantity` no exista en la DB de destino, este archivo
rompe `buildCatalogChunks()` con "column jvm.quantity does not exist" apenas alguien click "Ingestar al
bot". **No deployar F.4 antes de aplicar el ALTER TABLE de la sección A.**

**F.5 — `whatsapp-automation/db/curador-export-v5.sql`** — **NO es solo documentación, es un path de
ingesta vivo**: Martín lo corre a mano en el SQL editor de Supabase para producir el JSON que consume
`scripts/rag-ingest.ts` (el flujo CLI de ingesta, alternativo al botón "Ingestar al bot"). Si este archivo
se saltea, esa ingesta por CLI produce precios de trabajos **sin cantidades, en silencio** (todo cae al
default 1, sin error visible). Mismo cambio que F.4, al mismo nivel de prioridad — no es opcional ni un
"nice to have" de sincronización.

Además, corregir el comentario del header de `export-v5-sql.ts` que dice "el objeto de componente de
trabajos es copia EXACTA del de item de producto (cambio = tocar los dos)": con el campo `'cantidad'`
agregado solo al bloque de trabajos, esa invariante deja de ser cierta. Dejarlo escrito así es una trampa
para el próximo sync manual (alguien podría "corregir" la diferencia agregando `cantidad` también a items
de producto, que no la necesitan). Actualizar el comentario para aclarar que `componentes` de trabajos
ahora lleva un campo extra (`cantidad`) que `items` de producto no tiene.

## G) Test nuevo — `whatsapp-rag-lite/lib/catalog/__tests__/rag-chunk-trabajo.test.ts`

No existe una copia vendorizada de este test en `catalog-curator` (confirmado, `lib/catalog/` no tiene
tests locales ahí) — el test nuevo vive solo en `whatsapp-rag-lite`. Agregar un `describe` nuevo sin tocar
los existentes (todos usan `matBase()` sin `cantidad`, que cae al default 1 — siguen pasando igual):

```ts
describe("chunkTrabajo: cantidad fraccionaria multiplica el precio_lista del componente", () => {
  it("0.5 de un componente de $1.200 suma $600 al total de la variante-de-trabajo", () => {
    const c = chunkTrabajo(trabajoBase({
      variantes: [vt("A3", 1, [
        matBase({ nombre_variante_bot: "Encartonado A3", precio_lista: 3500 }),
        matBase({ nombre_variante_bot: "Encapsulado por metro", precio_lista: 1200, cantidad: 0.5 }),
      ])],
    }));
    expect(c.meta.precios.find((p) => p.ref === "t1")!.precio_lista).toBe(4100); // 3500 + 600, no 4700
  });

  it("cantidad ausente sigue sumando como 1 (compat hacia atrás)", () => {
    const c = chunkTrabajo(trabajoBase({
      variantes: [vt("A3", 1, [
        matBase({ nombre_variante_bot: "Encartonado A3", precio_lista: 3500 }),
        matBase({ nombre_variante_bot: "Encapsulado A3", precio_lista: 750 }), // sin `cantidad`
      ])],
    }));
    expect(c.meta.precios.find((p) => p.ref === "t1")!.precio_lista).toBe(4250);
  });

  it("cantidad decimal libre (1.25) sobre múltiples componentes", () => {
    const c = chunkTrabajo(trabajoBase({
      variantes: [vt("Grande", 1, [
        matBase({ nombre_variante_bot: "Base", precio_lista: 1000, cantidad: 1.25 }),
        matBase({ nombre_variante_bot: "Extra", precio_lista: 400, cantidad: 3 }),
      ])],
    }));
    expect(c.meta.precios.find((p) => p.ref === "t1")!.precio_lista).toBe(2450); // 1250 + 1200
  });
});
```

## H) Orden de aplicación seguro

1. **Aplicar el SQL de la sección A a TODAS las DBs a las que `catalog-curator` pueda apuntar vía
   `CURATOR_DATABASE_URL` — dev/staging Y la Supabase de prod — antes de que el código nuevo toque
   cualquiera de ellas.** No alcanza con dev: si el código nuevo (que ya inserta 3 columnas en el INSERT
   de `saveJobVariants`) apunta a una DB sin la columna `quantity`, rompe el **guardar** directamente
   ("column quantity does not exist" en el INSERT), no solo la ingesta. El SQL es no-destructivo y
   retrocompatible en cada una: agrega la columna con `default 1`, así que el código VIEJO (INSERT de 2
   columnas, sin tocar `quantity`) sigue funcionando en el ínterin — toma `quantity=1` automáticamente. El
   `EXPORT_V5_SQL`/`curador-export-v5.sql` viejos (sin `'cantidad', jvm.quantity`) también siguen
   funcionando: una columna nueva no rompe un SELECT que no la menciona.
2. **Recién después, aplicar el código nuevo** (B, C, D, E, F.1, F.2, F.4, F.5) a cada entorno cuya DB ya
   tenga la columna. Si F.4/F.5 se deploya antes del ALTER en esa DB puntual, tanto "Ingestar al bot" como
   la ingesta CLI (`pnpm rag:ingest` sobre el JSON de `curador-export-v5.sql`) rompen con "column
   jvm.quantity does not exist".
3. No hace falta feature-flag: un solo desarrollador, sin usuarios concurrentes dependiendo de
   disponibilidad continua durante el deploy — alcanza con el orden, aplicado consistentemente a cada DB.
4. Los cambios en `whatsapp-rag-lite` (F.1, F.2, tests G) son funciones puras con fixtures sintéticos, no
   dependen de la DB real — se pueden hacer en cualquier momento sin esperar el ALTER.

## Verificación end-to-end

1. `cd project-context/TerminalGrafica/whatsapp-rag-lite && pnpm test` (vitest run) — deben pasar los
   tests existentes + los 3 nuevos de la sección G.
2. `cd projects/TerminalGrafica/catalog-curator && pnpm test` — debe pasar `jobs.test.ts` actualizado +
   el resto sin tocar.
3. En `catalog-curator`: `pnpm lint` y `pnpm exec tsc --noEmit`. Confirmar
   `grep -rn "materialIds\|botVariantIds" lib components` vacío (no debe quedar ningún residuo del shape
   viejo). Confirmar también que los pares vendor/fuente de `lib/catalog/{types.ts,rag-chunk.ts}` siguen
   idénticos salvo el header (`diff <(tail -n +7 catalog-curator/lib/catalog/rag-chunk.ts) <(tail -n +4 whatsapp-rag-lite/lib/catalog/rag-chunk.ts)`
   y análogo para `types.ts`) — chequeo mecánico rápido para no confiar solo en "hice el mismo cambio de
   memoria en los dos archivos".
4. Aplicar el SQL de la sección A a **todas** las DBs relevantes (dev/staging y prod, ver sección H) antes
   del flujo manual — no alcanza con solo la de dev.
5. Flujo manual en el browser (agent-browser contra el dev server):
   - Abrir `/trabajos`, entrar a un trabajo existente con ≥1 variante con 2+ componentes.
   - Confirmar que cada línea de componente muestra el input de cantidad (default "1") junto al precio.
   - Cambiar la cantidad de un componente a "0.5" — confirmar que el precio de esa línea Y el total de la
     variante (header) se recalculan en vivo, sin reload.
   - Probar un valor inválido (0, vacío, texto) — no debe romper ni guardar un valor no positivo.
   - Guardar, confirmar toast de éxito.
   - Recargar (F5) — confirmar que la cantidad persistió (viene de la DB).
   - Probar "Agregar componente a varias" (ApplyComponentDialog) — sigue agregando con cantidad 1 default,
     sin romper con el nuevo shape.
   - Click "Ingestar al bot" — confirmar que no tira error y el toast reporta la cantidad de chunks
     esperada.

## Archivos críticos

- `project-context/TerminalGrafica/whatsapp-rag-lite/db/schema-bot.sql` — columna `quantity`, aplicado a mano por Martín
- `projects/TerminalGrafica/catalog-curator/lib/job-actions.ts` — `JobVariantInput` + UPSERT con `ON CONFLICT DO UPDATE`
- `projects/TerminalGrafica/catalog-curator/components/job-editor.tsx` — shape del draft, `precioVariante`, input de cantidad en el JSX
- `projects/TerminalGrafica/catalog-curator/lib/jobs.ts` — `JobRow`, `JobVariantMaterial`, `assembleJobs`, `DraftVariantLike`, `addMaterialToVariants`
- `projects/TerminalGrafica/catalog-curator/lib/catalog/export-v5-sql.ts` — `'cantidad', jvm.quantity` en el SQL que ejecuta la ingesta real
- `project-context/TerminalGrafica/whatsapp-rag-lite/lib/catalog/rag-chunk.ts` — multiplicación en `precioVarianteTrabajo` (fuente de verdad, espejar en el vendor de catalog-curator)
