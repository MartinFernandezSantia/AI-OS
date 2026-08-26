# Visor de chunks — UI interna para inspeccionar los embeddings del catálogo

Estado: **plan aprobado 2026-08-26**, en implementación.
Sub-proyecto: `project-context/TerminalGrafica/whatsapp-rag/visor/`.

## Contexto

El bot de WhatsApp de Terminal Gráfica se está rediseñando: el Excel pasa a ser la fuente
única y el bot pasa a **calcular** precios en vez de recitar precios cerrados
(ver `rediseno-excel-motor-cotizacion.md`).

`Catalogo-TG-v2.xlsx` ya está armado y verificado (39/39 casos reproducen los precios del
cliente). El paso siguiente del plan es la **Fase 2 — parser + ingesta CLI**. Pero antes de
escribir nada a la base conviene ver, con los ojos, **qué texto exacto va a leer el bot**.
Un chunk mal armado no falla ruidosamente: el bot contesta cualquier cosa y nadie se entera.

Esta UI es esa inspección. Interna, para Martín y Claude. Sube el .xlsx, lo parsea en
memoria y muestra los bloques de texto de cada embedding. **No escribe a ninguna base.**

El valor secundario, y no menor: `lib/parse.ts` y `lib/chunk.ts` son los **mismos
módulos** que después importa el CLI de ingesta. Lo que se valide acá visualmente es
literalmente lo que se va a ingestar.

### Por qué no se reusa el código del bot lite

`whatsapp-rag-lite/lib/catalog/rag-chunk.ts` modela producto-bot → variantes → refs `[vN]`
→ `metadata.precios` → "precio confiable". Ese modelo existe porque **el LLM no calculaba**:
elegía una opción precargada y un nodo determinista inyectaba el monto en `{Pn}`.

Acá el bot calcula. No hay variantes que referenciar ni montos que inyectar: hay **escalas
de precio** que el bot lee y aplica. El modelo de datos es otro y el chunk es otro.

Lo único que se hereda, como convención: chunk = unidad semántica autocontenida, y el
armado del texto es una **función pura** testeable, separada de la I/O.

---

## Decisiones (tomadas con Martín)

| Tema | Decisión |
|---|---|
| Unidad del chunk | **Colección + material.** 7 chunks. Ver más abajo. |
| Ubicación | App nueva: `project-context/TerminalGrafica/whatsapp-rag/visor/` |
| Parseo | **En el browser.** El archivo no sale de la máquina, no hay backend. |
| Extras | **Solo conteo de tokens.** Sin verificador de casos ni chequeos de integridad — happy path. |

### Por qué colección + material

Prototipadas las tres sobre el xlsx real:

| Estrategia | Chunks | Tokens | Chunk más largo | Problema |
|---|---|---|---|---|
| Por colección | 4 | ~1.474 | 2.610 chars | "Stickers con forma" arrastra **3 escalas** en un bloque; el bot tiene que elegir cuál aplica |
| **Colección+material** | **7** | **~1.772** | **1.510 chars** | — |
| Por producto | 31 | ~2.026 | 356 chars | repite la escala completa en los 13 chunks que comparten material; no ve alternativas |

Colección+material es la **unidad cotizable cerrada**: una sola escala por chunk, cero
ambigüedad de qué precio aplicar, y el bot sigue viendo las medidas hermanas (puede sugerir
5x5 si piden 4x4). Los 7 chunks quedan:

```
Stickers con forma — Papel autoadhesivo troquelado o medio corte   (7 medidas)
Stickers con forma — OPP brillo troquelado                          (4)
Stickers con forma — OPP plata, holográfico, cristal o mate troq.   (3)
Stickers para exterior                                              (4)
Carteles y vidrieras — Vinilo y lona UV                             (4)
Carteles y vidrieras — Vinilo UV montado en corrugado               (4)
Banners y lonas                                                     (5)
```

Cuando la colección usa un solo material, el título es la colección sola (sin sufijo).

Las tres estrategias se generan igual y se comparan con un tab: la decisión es sobre cuál
abre por defecto, no sobre cuál existe. **El propósito de la herramienta es poder cambiar de
opinión mirando el resultado, no discutiéndolo.**

---

## Stack

Next 16 + React 19 + Tailwind 4 + shadcn (new-york), replicando el setup de
`projects/TerminalGrafica/catalog-curator/` (referencia de estilo, no de lógica). Vitest para
los tests de la lógica pura. pnpm.

Sin base de datos, sin `pg`, sin auth, sin middleware.

**Sin librería de xlsx.** Las 13 entradas del .xlsx están en deflate (verificado), y el
browser trae `DecompressionStream('deflate-raw')` nativo. El parser son ~80 líneas.

---

## Archivos

```
visor/
  package.json · tsconfig.json · next.config.ts · postcss.config.mjs
  app/
    layout.tsx          — shell mínimo, sin sidebar
    page.tsx            — 'use client', toda la UI en una pantalla
    globals.css         — tokens portados de catalog-curator
  lib/
    xlsx.ts             — ZIP + OOXML → { [hoja]: string[][] }
    parse.ts            — filas → objetos con headers dinámicos (PURA)
    chunk.ts            — objetos → chunks, las 3 estrategias (PURA)
    tokens.ts           — estimador de tokens (PURO)
    __tests__/
      parse.test.ts · chunk.test.ts
  components/
    dropzone.tsx · chunk-card.tsx · stats-bar.tsx
```

### `lib/xlsx.ts` — leer el .xlsx en el browser

Único módulo con dependencia del entorno. `ArrayBuffer` → hojas.

1. Localizar el EOCD (`0x06054b50`) desde el final; leer nº de entradas y offset del
   directorio central.
2. Recorrer el directorio: nombre, método, tamaño comprimido, offset del local header.
3. Por entrada: saltear el local header (respetando `nameLen`+`extraLen`, **que difieren de
   los del directorio central**) y descomprimir con
   `new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw')))`.
4. Parsear `sharedStrings.xml` (`<si>` → concatenar sus `<t>`), `workbook.xml` +
   `_rels/workbook.xml.rels` para mapear nombre de hoja → archivo, y cada `worksheet` a una
   matriz — resolviendo `t="s"` contra sharedStrings y decodificando entidades XML.
5. Rellenar los huecos: las celdas vacías **no aparecen** en el XML, hay que reconstruir la
   posición desde `r="B7"`.
6. Descartar hojas ocultas (`_listas`).

### `lib/parse.ts` — headers dinámicos

El corazón del requisito "el cliente agrega una columna y entra sola":

```ts
export function objetos(rows: string[][]): Record<string, string>[] {
  const H = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(c => String(c).trim()))
    .map(r => {
      const o: Record<string, string> = {};
      H.forEach((h, i) => {
        const v = String(r[i] ?? '').trim();
        if (h && v) o[h] = v;   // ← columna vacía NO entra: chunk disperso
      });
      return o;
    });
}
```

La clave es `if (h && v)`: una columna sin dato no genera propiedad, y por lo tanto no puede
aparecer en el chunk. Es lo que garantiza que el bloque de vinilos no mencione "piezas por
pliego". No hay shape fijo en ningún lado.

### `lib/chunk.ts` — el armado del texto (lo que se está inspeccionando)

Función pura, sin I/O. Tres estrategias con la misma firma:

```ts
export type Estrategia = 'coleccion-material' | 'coleccion' | 'producto';
export interface Chunk { titulo: string; texto: string; meta: Record<string, unknown>; }
export function chunks(datos: Datos, e: Estrategia): Chunk[]
```

Formato de un chunk (verificado, sale del prototipo):

```
Stickers con forma — Papel autoadhesivo troquelado o medio corte
Stickers y etiquetas cortados con forma, para uso en interior. […]

Medidas disponibles:
- Stickers 3x3 cm · 3x3 cm · entran 104 por pliego A3.
  Los más chicos. Papel autoadhesivo brillo. […]
- Etiquetas 9x5 cm · 9x5 cm · entran 24 por pliego A3.
  Tamaño tarjeta. Papel autoadhesivo brillo, full color.

Precio por pliego A3 — Papel autoadhesivo troquelado o medio corte:
1: $2.500 · 2 a 10: $2.200 · 11 a 50: $2.000 · 51 a 100: $1.900 · 101 o más: $1.710.
```

Reglas del armado:

- Un tramo `Desde=Hasta` → `"1: $2.500"`; sin `Hasta` → `"101 o más: $1.710"`; escala de un
  solo tramo (tarifa plana) → solo el monto, sin rango.
- Modo m²: la línea de precio agrega `". Mínimo facturable 0,5 m2"` si el material lo trae.
- Modo pliego (`Unidad = pliego`) emite "entran N por pliego A3"; modo m² no lo menciona.
  **El modo se deriva de `Unidad` del material** — no hay columna `Modo` (se sacó a propósito
  para no tener dos fuentes de verdad).
- Toda columna extra que el cliente agregue a Productos se emite como `"Etiqueta: valor"` al
  final del ítem. Así una columna nueva aparece en el chunk sin tocar código.

`meta` acompaña con `{ coleccion, material, unidad, productos: N }` — no se usa todavía,
pero es lo que la Fase 2 va a escribir en la columna `metadata`, y conviene verlo ahora.

### `lib/tokens.ts`

`Math.ceil(texto.length / 4)`. Estimación, no tokenizador real: alcanza para comparar
estrategias entre sí. La UI lo dice como "~N tokens" para que nadie lo lea como exacto.

### `app/page.tsx` — una sola pantalla

Estado en `useState`, sin router ni persistencia. Tres zonas:

1. **Dropzone** (arrastrar o elegir). Al soltar: parsear, guardar en estado. Errores en un
   card rojo con el mensaje crudo — es una herramienta interna, el stack trace sirve.
2. **Barra de stats** — hojas detectadas, nº de chunks, chars y ~tokens totales, y el chunk
   más largo. Junto a ella, los tabs de estrategia. Cambiar de tab re-arma desde los mismos
   datos: es instantáneo y no re-parsea.
3. **Lista de chunks** — un card por chunk: título, badges de chars/tokens/nº de productos,
   y el texto en `<pre>` monoespaciado **tal cual se va a embeber**. Botón de copiar.

Sin sidebar, sin navegación, sin dark mode. Una pantalla que hace una cosa.

---

## Tests

Vitest sobre lo puro (`parse.ts`, `chunk.ts`), con un fixture chico armado a mano:

- `objetos()` descarta columnas vacías → una fila sin "Piezas por pliego" no genera la clave.
- `objetos()` toma columnas nuevas no previstas (el caso "el cliente agregó Gramaje").
- `escalaDe()` ordena tramos por `Desde` aunque la hoja los traiga desordenados.
- Chunk pliego menciona "por pliego A3"; chunk m² menciona "Mínimo facturable" y **no**
  menciona pliego.
- `coleccion-material` parte "Stickers con forma" en 3 chunks; cada uno lleva **una sola**
  línea de precio.
- Colección con un solo material → título sin sufijo `— material`.

`lib/xlsx.ts` no se testea en unit (necesita browser); se valida con el archivo real.

---

## Verificación

```bash
cd project-context/TerminalGrafica/whatsapp-rag/visor
pnpm install && pnpm test && pnpm dev
```

En el browser, con `Catalogo-TG-v2.xlsx`:

1. Arrastrarlo. Debe mostrar **6 hojas** (no 7: `_listas` se descarta).
2. Tab por defecto en `Colección + material` → **7 chunks**, ~7.087 chars, ~1.772 tokens.
   El más largo, "Stickers con forma — Papel autoadhesivo…", 1.510 chars.
3. Verificar que cada chunk lleva **una sola** línea "Precio por…". Es la razón de ser de
   esta estrategia; si alguno lleva dos, el agrupamiento está mal.
4. Chunk "Banners y lonas": debe decir "Precio por m2 — Lona: $16.000. Mínimo facturable
   0,5 m2" y **no** mencionar pliegos.
5. Cambiar a `Colección` → 4 chunks, y "Stickers con forma" muestra 3 líneas de precio
   (la ambigüedad que motivó descartarla, visible).
6. Cambiar a `Producto` → 31 chunks.
7. Esquema dinámico: agregar a mano una columna "Gramaje" en Productos, recargar, y
   confirmar que aparece en los ítems que la tienen y **en ninguno más**.

---

## Fuera de alcance

- Escribir a `bot.rag_catalog` o a cualquier base — es lo que esta UI explícitamente no hace.
- Generar embeddings o llamar a la API de Gemini.
- Editar el Excel desde la UI. Se edita en Excel; acá solo se mira.
- Verificador de los 39 casos y chequeos de integridad — evaluados y descartados para esta
  pasada. Si la ingesta empieza a romper, el verificador es lo primero que vuelve (la lógica
  ya está escrita y da 39/39).
- Auth, deploy, responsive. Corre local.
