# Motor de presupuestación por medida libre (modo pliego)

> **Ubicación final:** este plan debe moverse a
> `project-context/TerminalGrafica/whatsapp-rag/plans/motor-medidas-libres.md`
> y commitearse ANTES de empezar a implementar (regla del AIOS: los planes viven en el repo).

## Contexto

El cliente (TG) quiere un **motor de presupuestación**, no un menú de medidas predefinidas: si piden stickers 2x2 o 5x8 —cualquier medida— el bot debe calcular cuántas unidades de cobro hacen falta (encaje en el pliego, con separación de troquel) y el precio. Esto revierte, con motivo, la decisión del plan madre (`plans/rediseno-excel-motor-cotizacion.md:46`: "el bot no calcula geometría"). El modo m2 ya es motor (A×H÷10.000); el cambio real es modo pliego.

Hoy la geometría del pliego (área útil 28×44 con sep 0,3 troquelado; 31×46 sin sep solo impresión) existe **solo como prosa** en la hoja Instrucciones, y `Piezas por unidad de cobro` se carga a mano. Verificado: la fórmula reproduce los 14 rindes cargados (incluye los dos donde gana la orientación rotada: 6x3 y 14x10) y el ejemplo 12x8→10.

**Decisiones tomadas por Martin:**
1. Los 31 productos quedan como **medidas de referencia** (anclas RAG + sugerencias).
2. **El visor calcula el rinde** desde geometría estructurada en Materiales; la columna `Piezas por unidad de cobro` queda solo para unidades no geométricas futuras (bobina, plancha).

Fuera de alcance: ingesta contra la base real, Fase 3 (n8n/system prompt) — aunque Instrucciones PARTE 1 se reescribe porque es la base del futuro system prompt.

## Decisiones de diseño

- **D1 — Geometría en Materiales**, 3 columnas nuevas: `Área útil ancho (cm)` | `Área útil alto (cm)` | `Separación (cm)`. Es dato por MATERIAL (troquelado 28/44/0,3 ≠ solo impresión 31/46/0 con la misma unidad `pliego A3`). Materiales m2: vacías (chunk disperso, no contaminan).
- **D2 — Solo en la PRIMERA fila** de cada material (como `unidadDe` con `.find()`). Separación ausente ⇒ 0.
- **D3 — Mapa explícito** en el script (no heurística por nombre): 28/44/0,3 → los 3 materiales `*troquelado*` + papel troq/medio corte; 31/46/0 → papel solo impresión, OPP brillo, OPP plata/holo/cristal/mate.
- **D4 — Precedencia del rinde:** columna cargada (dato del taller) > calculado desde geometría > nada. Ambos y difieren → aviso de drift (gana el dato cargado). Modo pliego sin ninguno → aviso "el bot no va a poder cotizar" (convierte la trampa del "chunk que parece completo" en error visible).
- **D5 — La fórmula general NO se repite por chunk**: vive en Instrucciones (→ system prompt). El chunk lleva los DATOS que la fórmula consume (área útil, separación, unidad, escala) + frase habilitante.
- **D6 — "Medidas disponibles:" → "Medidas de referencia:"** + línea "Se cotiza CUALQUIER medida…".
- **D7 — Se elimina el alias** `COL_RINDE_VIEJA` ("Piezas por pliego") — deuda declarada, el Excel ya migró.
- **D8 — Validar antes de destruir:** el script que vacía el rinde compara calculado vs cargado y se niega a aplicar si difieren (la validación vive dentro del script destructivo).

## Fase A — Código del visor (retrocompatible; no toca el Excel)

Orden deliberado: el código nuevo funciona con el Excel actual (columna cargada → se usa; sin geometría → no se emite la línea), así los tests quedan verdes antes de migrar.

1. **`visor/lib/geometria.ts` (nuevo)** — `interface Geometria {utilAncho, utilAlto, separacion}` y función pura `rinde(anchoPieza, altoPieza, g)`: máx entre las dos orientaciones de `floor((util+sep)/(pieza+sep))` por eje; 0 si no entra.
2. **`visor/lib/parse.ts`** — `geometriaDe(materiales, material): Geometria | null` (primera fila con ambas áreas; `num()` ya tolera coma decimal; sin áreas → null).
3. **`visor/lib/chunk.ts`** —
   - Quitar `COL_RINDE_VIEJA` y el alias en `rindeDe`; sacarla de `CONOCIDAS`.
   - `rindeEfectivo(p, geo)`: columna → geometría calculada → null. Usarlo en `itemProducto` y `chunksProducto`.
   - Chunk pliego: línea "Se cotiza CUALQUIER medida en cm; las de abajo son referencias." + "Área útil del <unidad>: 28x44 cm · separación entre piezas: 0,3 cm." (con sep 0: "sin separación entre piezas"; la unidad sale del dato, nunca literal en código). Encabezado "Medidas de referencia:".
   - Chunk m2: línea "Se cotiza cualquier medida (m2 = ancho x alto en cm ÷ 10.000)."
   - `meta` pliego: agregar `geometria: {util_ancho, util_alto, separacion}`.
   - Nueva `avisos(datos): string[]`: (a) material pliego sin geometría ni rindes cargados; (b) drift columna vs cálculo; (c) referencia con rinde calculado 0.
4. **`visor/app/page.tsx`** — caja de avisos arriba de la grilla cuando `avisos()` no está vacío. `actions.ts` NO se toca (mismas funciones puras server-side).
5. **Tests** —
   - Nuevo `lib/__tests__/geometria.test.ts`: los 7 rindes conocidos (104/56/40/24/18/8/6), 12x8→10, sep 0 (4x4→77), no-entra→0, borde exacto.
   - `parse.test.ts`: `geometriaDe`. `chunk.test.ts`: fixtures con nombre nuevo de columna + geometría; asserts de línea de geometría (presente pliego / ausente m2), precedencia, avisos.
   - Portar los casos valiosos de `visor/trampa-tmp.test.ts` y `unidad-tmp.test.ts` a `lib/__tests__/`; borrar `ver-tmp.test.ts`; `e2e-tmp.test.ts` se actualiza al final (sigue de red contra el xlsx real).
6. **Checkpoint:** `pnpm test` + `pnpm build` verdes con el Excel actual.

## Fase B — Excel (4 scripts quirúrgicos nuevos, molde `visor/scripts/renombrar-rinde.mjs`)

Precondiciones de todos: **abortar si existe `.~lock.Catalogo-TG-v2.xlsx#`** (existe ahora — pedirle a Martin cerrar LibreOffice), dry-run por defecto + `--apply`, byte-identidad de entradas ZIP no tocadas, reusar estilos, reconstruir huecos de `<row>`, commit git antes de cada `--apply`.

1. **`geometria-materiales.mjs`** — headers H/I/J en Materiales + valores del mapa D3 en la primera fila de cada material pliego. Ojo: la columna `Nota` (G) está vacía → las celdas G pueden no existir en el XML; calcular bien los `r` y extender `<dimension>`.
2. **`vaciar-rinde-pliego.mjs`** — calcula rinde geométrico, imprime tabla producto|cargado|calculado; si alguno difiere ABORTA. Con `--apply` vacía la columna en los 14 productos pliego (header y columna quedan, para bobina/plancha futuras).
3. **`instrucciones-motor.mjs`** — reescritura por secciones:
   - Encabezado: medidas del catálogo = referencia; se cotiza cualquier medida.
   - PARTE 1 modo pliego: paso 1 doble (1a medida de catálogo → rinde ya calculado; 1b medida libre → fórmula con la geometría del material, dos orientaciones, floor) + mover acá el ejemplo 12x8 + caso borde rinde 0 → derivar a consulta. Pasos 2-4 igual.
   - PARTE 1 modo m2: explicitar "cualquier medida".
   - PARTE 2 ejemplo completo paso 2: cargar geometría del material (una vez, primera fila).
   - QUÉ COLUMNAS SON OBLIGATORIAS: pliego → el MATERIAL lleva geometría, el producto deja rinde vacío (lo calcula el visor); rinde a mano solo para unidades no geométricas.
   - DE DÓNDE SALE EL RINDE: reescribir (geometría declarada una vez; visor calcula referencias; bot calcula medidas libres; fórmula documentada acá).
   - ERRORES QUE ROMPEN EN SILENCIO: reemplazar el ítem del rinde faltante por: material pliego sin geometría (visor avisa) / drift rinde-cargado vs geometría (gana el cargado, visor avisa) / pieza que no entra → rinde 0 → consulta, nunca inventar.
4. **`casos-motor.mjs`** — 7 filas nuevas en Casos de prueba (rinde esperado documentado en su columna; precios verificados a mano):

| Pedido | Cant | Material | Rinde | Precio |
|---|---|---|---|---|
| Stickers 2x2 cm (medida libre) | 500 | Papel autoadh. troq/medio corte | 228 | 6.600 |
| Etiquetas 5x8 cm (medida libre) | 100 | ídem | 25 | 8.800 |
| Etiquetas 20x6 cm (gana la rotada) | 80 | ídem | 8 | 22.000 |
| Etiquetas 4x4 solo impresión (sep 0) | 300 | Papel autoadh. solo impresión | 77 | 7.200 |
| Stickers 30x45 cm (no entra) | 20 | Papel autoadh. troq/medio corte | 0 | derivar a consulta |
| Stickers 3x3 cm (activa mínimo $4.000) | 10 | ídem | 104 | 4.000 |
| Lona 90x60 cm (activa redondeo $100) | 1 | Lona | — | 8.600 |

## Orden de ejecución

1. Mover este plan a `project-context/TerminalGrafica/whatsapp-rag/plans/motor-medidas-libres.md` + commit.
2. Fase A completa → `pnpm test` / `pnpm build` verdes.
3. Confirmar LibreOffice cerrado (sin lock file) + commit.
4. B1 dry-run → `--apply` → visor: 4 chunks pliego con geometría, cero avisos de drift (validación viva).
5. B2 dry-run (tabla 14/14 iguales) → `--apply` → visor: mismos rindes, ahora calculados.
6. B3 dry-run → `--apply`. 7. B4 dry-run → `--apply`.
8. Actualizar `e2e-tmp.test.ts` (asserts de geometría + rindes calculados == históricos), borrar los tmp portados, correr todo.
9. Actualizar `HANDOFF.md` (decisión revertida, geometría como dato, casos nuevos) + commits por tema.

## Verificación

- `pnpm test` y `pnpm build` (siempre pnpm; `node -e` denegado → scripts .mjs).
- Visor con el .xlsx migrado: siguen siendo **7 chunks**; los 4 pliego con línea de geometría y rindes idénticos a los históricos; los 3 m2 con línea habilitante. Tokens: hoy ~1.772 → estimado ~2.000-2.100.
- Reabrir en LibreOffice (Martin): hojas intactas, desplegables andando, casos nuevos visibles.
- Dogfood: recalcular a mano 2 casos nuevos usando SOLO la PARTE 1 reescrita.
- Ingesta a base real: fuera de alcance (declarado en el handoff).

## Archivos críticos

- `visor/lib/chunk.ts`, `visor/lib/parse.ts`, `visor/lib/geometria.ts` (nuevo), `visor/app/page.tsx`
- `visor/scripts/{geometria-materiales,vaciar-rinde-pliego,instrucciones-motor,casos-motor}.mjs` (nuevos; molde: `renombrar-rinde.mjs`)
- `visor/lib/__tests__/{geometria,parse,chunk}.test.ts`, `visor/e2e-tmp.test.ts`
- `Catalogo-TG-v2.xlsx`, `HANDOFF.md`
