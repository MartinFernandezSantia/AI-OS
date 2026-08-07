# Plan — Precios por placeholders + inyección/validación determinista (bot RAG lite TG)

> **Ubicación final:** al arrancar, guardar como
> `project-context/TerminalGrafica/whatsapp-rag-lite/plans/precios-placeholders.md` y commitear
> (regla AIOS: los planes viven en el repo, nunca en `~/.claude/plans/`).

## Context

El bot RAG lite va **sin precios** hoy, lo que rompe el testeo: sin precio, preguntar cantidad no
tiene gancho. Martin quiere que informe precios **como el v10** (montos deterministas, el LLM nunca
fija un precio) pero **sin el motor de cálculo del v10**.

Enfoque: el agente escribe el mensaje con **placeholders `{P1}`,`{P2}`** y declara en la salida
estructurada a qué producto/variante/cantidad corresponde cada uno; un **nodo Code terminal**
inyecta el precio real (horneado en `metadata.precios` en la ingesta) y, como red única, **valida
cualquier monto que el LLM haya tipeado contra el catálogo**. **Solo precio por unidad** (por
hoja/página/m²/pack) + tramo de escalera si aplica; **sin totales ni multiplicación**.

Decisiones tomadas por Martin: el chunk **incluye los números** de precio como contexto; el agente
igual debe usar `{Pn}`. Sin totales por ahora. Rehacer embeddings (re-ingesta).

Revisado con Fable. Cambio de enfoque central respecto del borrador: la garantía pasa de
"prohibir y regenerar" a **"validar y reparar en el nodo terminal"** — como los números del chunk
son los precios reales, un monto tipeado que **coincide** con catálogo es correcto (se acepta), y
solo el que **no coincide** se repara a "a confirmar por mail". Esto elimina el grueso de las
regeneraciones y pone la garantía en el único nodo por el que pasa todo texto antes del chat.

## Arquitectura

- Precios horneados en `bot.rag_catalogo.metadata.precios` en la ingesta (misma tabla/credencial;
  derivación unidad/escalera en TS de confianza). Los números también van al `texto` del chunk.
- **El LLM nunca fija un precio**: todo monto del mensaje final queda validado por código contra
  `metadata.precios` en el nodo terminal. Peor caso = precio faltante ("a confirmar por mail"),
  nunca uno errado.
- La inyección+validación corre **al final** (después de corregir/regenerar), único punto de paso.

Flujo nuevo (20 → 22 nodos): `… → Preparar Respuesta → Buscar Precios (postgres) → Insertar Precios
(Code, terminal) → chat`.

## Fase 0 — Mover el builder al repo (antes de tocar nada)

`build-flow.mjs` vive en scratchpad efímero; el repo solo tiene el JSON generado. **Mover a
`whatsapp-rag-lite/scripts/build-flow.mjs` y commitear** (agregar `pnpm flow:build` en
package.json). Sin esto la fuente del flow muere con la sesión.

## Fase 1 — Datos del chunk (horneo de precios + módulo testeado)

**`lib/catalog/types.ts`**
- `RangoCantidad { value:number; minQty:number; maxQty:number|null }`.
- `Variante.rangos_cantidad`: `RangoCantidad[] | string | null`.
- `PrecioVariante { ref:string; variante:string; unidad:string|null; cobrable:boolean;
  precio_lista:number; tramos:RangoCantidad[]; pack_unidades:number|null }`. (`ref` = "v1","v2"…
  local al producto. Se dropea `es_escalera`/`es_lista_precios`: derivables de `tramos`.)

**`lib/catalog/price-display.ts`** (NUEVO, función PURA testeada — evita "los fixtures mienten":
la lógica que le habla de plata al cliente va testeada, y el nodo Code de n8n inlinea una copia):
- `derivarUnidad(p,v)`: cascada exacta del v10 (`por_pagina`→"por pagina"; `pack_unidades` sin
  escalera→"el pack de N unidades"; `por_pack`→"el pack"; `atributos.unidad_venta`
  `{trabajo,unidad,hoja,pagina,m2,metro}`; si nada→`null`). **Nunca** la columna `unidad`.
- `precioVariante(p,v)`→`PrecioVariante`. `cobrable = unidad!=null && (precio_lista>0 || algún
  tramo>0)`.
- `precioDisplay(pv, cantidad)`→string|null: elige tramo (`tramos.find(min≤cant≤max)`; sin cantidad
  → menor minQty + "(varía según cantidad)"); formatea `$X <unidad>` con `toLocaleString('es-AR')`;
  `null`→"a confirmar por mail". **Sin totales/multiplicar/CAP.**

**`lib/catalog/rag-chunk.ts`**
- `RagChunkMeta` gana `precios: PrecioVariante[]` (una por variante visible). Evaluar retirar
  `precio_desde/hasta/precio_confiable` (redundantes) — decisión menor al implementar.
- `opcionesTexto`: render **con token + números** (decisión de Martin), ej.:
  `Opciones: [v1] Doble Faz ($15.000 el pack); [v2] Simple Faz (por unidad: 1-3 $8.000, 4-10
  $7.200)`. El `[vN]` es lo que el agente copia (token corto = copiable por un modelo chico).

**`scripts/rag-ingest.ts`**: `metaObj` agrega `precios`. Modo **`--prices-only`** que actualiza
**`text` + `metadata`** (solo se saltea el embedding — los dígitos no mueven el vector) para
refrescar precios barato sin re-embeber. Primera vez sí re-embeber (`rag:ingest --apply`).

**`lib/catalog/__tests__/`**: tests de `price-display.ts` (pack simple; escalera con/sin cantidad;
sin `unidad_venta`→`cobrable:false`) + del chunk (`[vN]` en Opciones, `meta.precios`).

## Fase 2 — Schema + prompts del Agente (`build-flow.mjs`)

**`esquemaSalida`**: nuevo top-level `precios_solicitados[]`:
`{ ref, nombre_catalogo, variante_ref, cantidad:number|null }`. (Se dropea `por_cantidad`:
redundante con `cantidad`. `variante_ref` = el `[vN]` del chunk, no el nombre.)

**`sistema`**: reemplazar "NO menciones precios" por `## Precios`:
- Podés informar precios. **NUNCA escribas un número**: donde iría un precio poné `{P1}`,`{P2}`…
  (ej.: "las tarjetas doble faz salen {P1} el pack"). Un proceso posterior reemplaza cada `{Pn}`.
- Por cada `{Pn}` agregá a `precios_solicitados` (ref, nombre_catalogo exacto, `variante_ref` = el
  `[vN]` que figura en "Opciones:", cantidad si el cliente la dijo).
- Solo `{Pn}` para opciones con forma de cobro conocida (la línea "Opciones:" lo indica). Si no
  consta → ofrecé mail, sin marcador. **Nunca calcules ni des totales** ("en total", "por los N").

**`sistemaCorrector`**: "el mensaje puede traer `{P1}`…: copialos TAL CUAL; si sacás un producto,
sacá su `{Pn}`".

## Fase 3 — Buscar Precios + Insertar Precios (garantía única, `build-flow.mjs`)

**`Buscar Precios`** (`n8n-nodes-base.postgres` 2.6, cred BOT_DB): trae `metadata->'precios'` de los
productos declarados, match acento-insensible:
```sql
select metadata->>'nombre_canonico' as nombre, metadata->'precios' as precios
  from bot.rag_catalogo
 where translate(lower(metadata->>'nombre_canonico'),$$áéíóúñ$$,$$aeioun$$) = any(
   select translate(lower(trim(x)),$$áéíóúñ$$,$$aeioun$$)
     from jsonb_array_elements_text($1::jsonb) as x)
```
`queryReplacement` **null-safe**:
`{{ JSON.stringify(((($json.auditoria)||{}).precios_solicitados||[]).map(p=>p.nombre_catalogo)) }}`
(vacío → `[]` → 0 filas).

**`Insertar Precios`** (`n8n-nodes-base.code` 2, **terminal**, inlinea la lógica de
`price-display.ts`) — lee `$('Preparar Respuesta')` (ref segura) + filas de `$input`:
1. **Inyección**: por cada `precios_solicitados`, ubicar `PrecioVariante` por `(nombre_catalogo,
   variante_ref)`; `precioDisplay(pv, cantidad)`; reemplazar `{ref}` (replace-all). {Pn} huérfano →
   "a confirmar por mail". Acumular en un set los strings de precio inyectados (whitelist).
2. **Validar-y-reparar** (garantía; cubre también lo que tocó el Corrector): escanear el texto por
   montos (`/\$\s?\d[\d.]*/`, `/\b\d[\d.]*\s*pesos\b`) **excluyendo** los de la whitelist y los que
   igualan una `cantidad` declarada o un número del mensaje del cliente. Cada monto sobreviviente:
   si **coincide** con un precio real de un producto declarado → dejar (normalizar formato); si
   **no** → reemplazar ese token por "(a confirmar por mail)" y loguear.
3. **Anti-total** (semántico): si cerca de un precio hay `en total|total de|por l[oa]s \d+` →
   suavizar (sacar la frase de total; el monto queda con su unidad). Determinístico, best-effort.
4. Producir el `output` final. Conexiones: `Preparar Respuesta → Buscar Precios → Insertar Precios`.
   Actualizar la `Nota`.

(Se **elimina** el guard duro de Leer Veredicto del borrador: no tiene los precios reales para
comparar y el patrón de miles falsea con cantidades. La red real vive en el nodo terminal, que sí
tiene ambos.)

## Verificación (end-to-end)

1. `pnpm test` → `price-display.test.ts` + chunk verdes.
2. `pnpm rag:ingest --apply` → spot-check `metadata->'precios'` y `[vN]` en el `text`.
3. Importar flow y probar:
   - **Unitario** ("tarjetas doble faz") → `{P1}` → **"$15.000 el pack"**; ver `precios_solicitados`.
   - **Escalera** ("imanes") sin cantidad → **"$8.000 por unidad (varía según cantidad)"**; "15
     imanes" → **"$6.500 por unidad"**.
   - **Sin unidad** → "a confirmar por mail".
   - **Fuga real** (forzar que tipee un $ correcto) → se acepta (coincide catálogo), NO regenera;
     un $ inventado → reparado a mail.
   - **Cantidad ≥1000** ("1.000 folletos") → NO se auto-flagea (excluida por ser cantidad).
4. Corrector preserva `{Pn}` (forzar un corregir con placeholder).

## Riesgos / decisiones abiertas

- **D1 frescura**: `--prices-only` (text+metadata, sin re-embeber) refresca barato. Incluido.
- **R2 variante ambigua**: sin `variante_ref` válido y varias → mail (nunca inventa). El `[vN]`
  reduce el fallo de copiado.
- **R3 lista de precios entera** (rifas): v1 muestra tramo de 1 unidad + "varía"; mandar la lista
  completa es mejora futura.
- **Deuda preexistente (no de este plan)**: `Feedback Reintento` entra por el mismo `sessionKey` →
  la Memoria acumula los prompts internos de reintento; contamina turnos siguientes. Anotar para
  aislar la memoria del loop.
