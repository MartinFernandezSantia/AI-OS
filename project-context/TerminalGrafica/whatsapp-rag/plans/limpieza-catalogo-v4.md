# Plan: limpiar y cargar el catálogo nuevo de TG al bot (v4)

## Contexto

El bot cotizador está EN VIVO atendiendo WhatsApp real con `Catalogo-TG-v3.xlsx`
(99 productos, 73 materiales, 13 colecciones, 132 casos en verde). TG cargó un catálogo
actualizado con su propio Claude y lo devolvió como `Catalogo-TG.xlsx`: **166 productos,
165 materiales**. Todo lo viejo sobrevive; lo nuevo es agregado.

`validar-catalogo.mjs` da **19 errores + 16 avisos** contra ese archivo. Al investigar
aparecieron tres cosas que el validador NO ve y que cambian el alcance:

1. **Hay una forma de cobro que el motor no sabe expresar**: "precio TOTAL del tramo".
   `Troquelado (corte con forma en papel)` tiene unidad legal y escala bien formada —
   validador en verde — pero su nota dice *"Precio TOTAL fijo para 1 a 10 piezas. NO es
   precio por pieza"*. Hoy `5 troquelados` cotizaría **$50.000 en vez de $10.000**, con la
   aritmética cerrando perfecto y cero hallazgos. Mismo caso en los 2 Talonarios de rifas
   (escala en NÚMEROS, precio total por tramo).
2. **El cliente renombró 4 materiales** (`Laminado`→`Laminado A4`, `Anillado plástico`→
   `Anillado plástico A4/Oficio`, `Anillado metálico wire-o`→`…hasta 3/4 pulgada`) y
   **sustituyó uno**: la fila 95 dejó de ser `Troquelado y corte a medida` ($50/unidad) y
   pasó a ser `Puntillado` ($50/pasada). **Verificado: actualizó Productos de forma
   consistente**, con sinónimos nuevos incluso. No hay referencias rotas.
3. **El archivo pasó por openpyxl**: no tiene `sharedStrings.xml`, todo el texto es
   `inlineStr`. `validar-catalogo.mjs` y `valorCelda` lo manejan; **`volcar-hoja.mjs` y los
   escritores `cargar-*.mjs` NO** (fallan o escriben basura silenciosa).

**Resultado buscado**: `Catalogo-TG-v4.xlsx` con validador en 0 errores, build en verde,
ingestado y con el flow de n8n sincronizado — sin tocar el motor y sin inventar ni un precio.

## Decisiones tomadas (no re-litigar)

| Tema | Decisión |
|---|---|
| Recargo `Corte a medida` ($5.000/modelo) | **Fuera del lote.** No hay mecanismo de recargos en el motor |
| `precio_total_tramo` (Troquelado + 2 Talonarios) | **Fuera del lote.** Entra lo que funciona sin cambiar el motor; el modo se analiza después |
| UV vs solvente | **Cargar los dos, separados** (el cliente marcó "no fusionar sin confirmar con Pedro") |
| Colección `Merchandising` | **Crearla** |
| Materiales renombrados | **Dejarlos como los cargó el cliente.** Al reingestar reemplazan a sus predecesores |
| Casos de prueba | **Portar `Parámetros` del v3.** Sin cobertura nueva obligatoria |

**Principio del lote**: cero cambios al motor. Todo lo que exija tocar `cotizar()` o
`modoDe` se aparta a la hoja `Pendientes` con su dato intacto, para decidirlo después.

## Alcance

**Entra** (~155 materiales, ~158 productos): los 7 materiales solvente, papeles offset
ampliados, A4 106gr, planos/plotter, terminaciones (laminados, anillados, encapsulados),
Merchandising, cartelería, papelería suelta, folletería y tacos, y los sueltos
(`Puntillado`, `Corte x millar`, `Puntas redondeadas`, `Perforado x1000`, etc.).

**Queda en `Pendientes`** (5 materiales + 5 productos):
`Corte a medida` · `Troquelado (corte con forma en papel)` · `Talonario de rifas 10x7` ·
`Talonario de rifas 15x7` · los 5 productos `Corte a medida en X`.

⚠️ **Consecuencia a asumir**: `Troquelado y corte a medida` existía en producción y su
sucesor queda afuera. **El bot pierde la capacidad de cotizar troquelado sobre impreso** y
va a derivar a consulta. Es correcto (mejor derivar que cobrar 5x de más) pero es una
regresión funcional visible — hay que avisarle a TG.

## Cómo funcionan las unidades hoy (el recordatorio que pediste)

El motor deriva un **modo de cobro** del **PREFIJO** de la columna `Unidad` del material.
`modoDe` está duplicado en 3 archivos: [parse.ts:112-132](project-context/TerminalGrafica/whatsapp-rag/visor/lib/parse.ts#L112-L132),
[build-flow.mjs:344-354](project-context/TerminalGrafica/whatsapp-rag/n8n/build-flow.mjs#L344-L354),
[validar-catalogo.mjs:99-105](project-context/TerminalGrafica/whatsapp-rag/visor/scripts/validar-catalogo.mjs#L99-L105).

| Modo | Se activa con | Cómo cobra |
|---|---|---|
| `pliego` | `startsWith("pliego")` | Calcula cuántas piezas entran en el pliego (rinde geométrico, 2 orientaciones) y cobra por pliegos, `ceil` |
| `m2` | `startsWith("m2")` / `"m²"` | `(ancho × alto ÷ 10.000) × cantidad`, con mínimo facturable. **Ignora la geometría** |
| `item` | lista blanca `/^(unidad\|hoja\|paquete\|pack\|item\|ítem\|metro lineal)\b/` | Cantidad tal cual, o dividida por `paquete` con división exacta obligatoria |
| `otro` | todo lo demás | **Bucket de error**: `cotizar()` devuelve `ok:false` y el build ABORTA |

Tres cosas que importan para este lote:

- **`item` es lista blanca, no default** — a propósito: un typo (`"pliegos A3"` en plural)
  debe fallar, no cotizarse en silencio.
- **La escala (Desde/Hasta/Precio) se busca por UNIDADES DE COBRO**, nunca por piezas
  pedidas. `Hasta` vacío = infinito; el primer tramo cubre desde `-Infinity`.
- **`Piezas por paquete` se deriva sola de la unidad**: `"paquete de 1000 tarjetas"` →
  `paquete: 1000`. Regex `/^(paquete|caja|resma|juego|blister|set)\b/` en
  [chunk.ts:438-453](project-context/TerminalGrafica/whatsapp-rag/visor/lib/chunk.ts#L438-L453).
  `"pack"` a secas queda afuera a propósito.

**Qué cambia con el catálogo nuevo**: nada del motor. Las 3 unidades que entran se resuelven
renombrándolas a una que el motor ya entiende (ver Fase 3). Las 2 que exigirían un modo nuevo
se apartan.

## Fases

### Fase 0 — Preparación

1. `cp Catalogo-TG.xlsx Catalogo-TG-v4-wip.xlsx` (el original **nunca se toca**: es la evidencia).
2. **`normalizar-inline.mjs`** (nuevo, ~40 líneas): recorre las hojas, extrae cada `<is><t>`
   a `sharedStrings.xml` y reemplaza por `t="s"`. Una pasada y todo el toolchain existente
   funciona sin modificarlo.
   - ✓ **Gate**: el validador tiene que dar **exactamente los mismos 19+16** antes y después.
     Cualquier diferencia = la normalización perdió datos.
3. **`portar-hojas.mjs`** (nuevo): copia `Parámetros` y `Casos de prueba` del v3 al wip.
   Sin `Parámetros` el build ni arranca (`paramNum()` lanza si falta `Mínimo por trabajo`
   o `Redondeo`). Es la operación inversa de `generar-copia-cliente.mjs`, que quita hojas.
   - ✓ **Gate**: `volcar-hoja.mjs` vuelca las 3 hojas sin excepción.

### Fase 1 — Estructura

4. **`extender-listas.mjs`** (nuevo, patrón de
   [extender-dv-colecciones.mjs](project-context/TerminalGrafica/whatsapp-rag/visor/scripts/extender-dv-colecciones.mjs)
   — reemplazo verificado por conteo de ocurrencias, aborta si no encuentra la cantidad exacta):
   - `_listas`: las 598 fórmulas array de `$A$2:$A$300` → `$A$2:$A$600`, y **extender la hoja
     a 600 filas de fórmulas** (si no, los materiales 301+ no aparecen en el desplegable).
   - `definedName` `Materiales_lista` / `Colecciones_lista` → `$600`.
   - DV de `Colecciones!C2:C300` → `C600`; `Productos` de 500 → 600.
   - Los topes de la tabla `topes` en `validar-catalogo.mjs:283-287` → 600.
   - ✓ **Gate**: el validador cuenta ~1.198 fórmulas en `_listas`, sin errores nuevos.

### Fase 2 — Datos (`datos-catalogo-v4.mjs` + `cargar-catalogo-v4.mjs`)

Patrón obligatorio: **datos separados del escritor**, como
[cargar-productos-nuevos.mjs](project-context/TerminalGrafica/whatsapp-rag/visor/scripts/cargar-productos-nuevos.mjs)
+ `datos-productos-nuevos.mjs` — así se revisan las decisiones leyendo una tabla, sin leer código.
Todo idempotente. `.bak-<fecha>` antes de cada `--apply`; `chequearLock()` ya viene en `lib-xlsx.mjs`.

5. **Unidades → renombrar a una que el motor ya entiende** (arreglo en el DATO, no en el motor):
   - `Puntillado`: `"pasada"` → **`"unidad"`**. Una pasada es un ítem contable ($50 × 3
     pasadas). El matiz vive en la descripción del producto, que ya dice "Se cobra por pasada".
   - `Corte x millar`: `"millar"` → **`"paquete de 1000 hojas"`**, y renombrar el material a
     **`Corte x1000`**. El cliente pide *"cortame 5.000 volantes"*, no *"5 millares"* — el
     schema obliga a declarar sin convertir, así que declara `5000`; `paqueteDe()` deriva
     1000, el auditor divide → 5 × $5.000 = $25.000 ✓. Bonus: `3.500` no es múltiplo → deriva.
     El nombre `x1000` hace que el gate nombre-vs-paquete lo verifique activamente.

6. **Apartar a `Pendientes`** (`omitir-pendientes.mjs`, patrón de
   [podar-pendientes.mjs](project-context/TerminalGrafica/whatsapp-rag/visor/scripts/podar-pendientes.mjs)):
   `Corte a medida`, `Troquelado (corte con forma en papel)`, los 2 `Talonario de rifas`, y
   los 5 productos `Corte a medida en X`.
   - **Los 5 productos hay que borrarlos sí o sí**: apuntan al material del PAPEL, no al
     recargo. Si se dejan, el bot cotiza el papel y **se come los $5.000 en silencio** —
     peor que no tenerlos.
   - Cada fila se registra en `Pendientes` con su dato original y el motivo.

7. **Presentaciones leídas como tramos → materiales separados con `Familia`.**
   El cliente cargó `Puntas redondeadas` (3 filas) y `Folletos 10x15` (12 filas) como filas
   del mismo material con `Desde 1` / `Hasta` vacío. El motor las lee como tramos de UNA
   escala y colisionan (gana la primera). Son **presentaciones distintas** — el patrón que el
   catálogo ya usa y tiene probado es materiales separados agrupados por `Familia`
   (`Tarjetas 9x5 simple faz x100/x500/x1000`), que `chunk.ts` junta en un chunk con tabla de
   precios y publica en `meta.variantes[]`.
   - `Puntas redondeadas` → `x100` / `x500` / `x1000`, unidades `"paquete de 100 puntas"` etc.
     **Agregar el sustantivo**: el gate de `build-flow.mjs:604` exige que la unidad diga de
     qué son las piezas.
   - `Folletos 10x15` → 12 materiales. **Partir la familia única del cliente en 3**
     (obra b/n · obra color · ilustración brillo), patrón de tarjetas simple/doble faz.
   - Los 4 productos apuntan a la presentación más chica de cada familia.
   - Neto: 10 filas → 15 materiales (**+5 filas**, por eso la Fase 1 va antes).

8. **Crear la colección `Merchandising`** con `describir-colecciones.mjs`, incluyendo
   **`Material base`** (`Iman impresión laminada y corte`). La colección tiene materiales de
   2 modos distintos; sin base el chunker avisa y el bot repregunta en vez de ir a la opción
   obvia.

9. **Exponer los huérfanos por `Familia`** (sin crear productos nuevos):
   - Las **9 coberturas de plano** (25/50/100% × 3 papeles): hoy ningún producto las
     referencia, pero las descripciones nuevas ya prometen "decinos cuál para cotizar".
     Darles la `Familia` del material lineal correspondiente.
   - `Microperforado (solvente)`: `Familia: Microperforado`, compartida con
     `Vinilo microperforado` (UV). Un chunk, dos procesos, y la nota del cliente sobrevive.

   - ✓ **Gate**: `CATALOGO=Catalogo-TG-v4-wip.xlsx node visor/scripts/validar-catalogo.mjs`
     → **0 ERRORES**. Los avisos de escala cerrada quedan (son correctos, ver abajo).

**No se toca**: las 16 escalas cerradas. El cliente dejó la nota explícita
*"El PDF no da tramo para mas de 20 unidades; no inventar, consultar a Pedro"*. En runtime
`cotizar()` devuelve "ningún tramo cubre N unidades" → deriva a consulta. **Ese es el
comportamiento correcto y es lo que TG pidió.** Único cambio: mejorar el mensaje del aviso en
`validar-catalogo.mjs:194-197` para que reconozca la nota (hoy aconseja "dejá Hasta vacío",
que para estos casos es un consejo equivocado).

### Fase 3 — Casos de prueba

10. Actualizar los **6 casos** rotos por renombre a los nombres nuevos (mecánico, mismos
    precios). **El caso 122** (`20 troquelados y corte a medida`) se **retira**: su material
    quedó en `Pendientes`.
11. ✓ **Gate**: `CATALOGO=Catalogo-TG-v4-wip.xlsx node n8n/build-flow.mjs` → todos los casos
    en verde + los 11 rindes históricos. Si falla, no emite nada.
12. ✓ **Gate**: `node n8n/test-auditor.mjs` (30+ escenarios de cableado) y
    `pnpm --dir visor test`.

### Fase 4 — Leer el texto, no solo los tests

13. Volcar los chunks generados y **leerlos**. El HANDOFF es explícito: *"tres errores que
    salían al texto que lee el cliente pasaron los 152 tests en verde y se vieron recién al
    leer un volcado."* Mirar en particular: folletos (¿las 4 presentaciones con su precio?),
    Merchandising (¿tiene descripción o sale con el título pelado?), planos (¿las 4
    coberturas?), microperforado (¿los dos procesos en un chunk?).
14. **Martín**: abrir el `.xlsx` en LibreOffice y verificar que los desplegables de
    Productos/Colecciones funcionan hasta la fila 600. (Claude no tiene LibreOffice.)

### Fase 5 — Promoción y despliegue

15. `cp Catalogo-TG-v4-wip.xlsx Catalogo-TG-v4.xlsx`. **El v3 no se toca: es el rollback.**
    Actualizar el default de `lib-xlsx.mjs` al v4 (defaultear a un catálogo viejo ya costó
    una sesión entera).
16. **Re-ingesta desde el visor, no por CLI** (decisión ya tomada: reemplazo total en una
    transacción). `pnpm dev` en `visor/`, subir el v4, **revisar la caja ámbar de avisos**
    antes de ingestar. Los chunks suben de 62 a ~85-90 — **verificar el conteo, no estimarlo**.
17. **Re-generar y sincronizar el flow**:
    `CATALOGO=Catalogo-TG-v4.xlsx node n8n/build-flow.mjs` (aborta sin la variable, a propósito).
    Emite los dos flows; el que está ACTIVO en producción es `cotizador-v1-chatwoot`
    (`3vNAAe0sr7sMgPUa`, 54 nodos).
    - ⚠️ **Ojo con el techo de tokens del prompt**: está en ~3.024 con techo 3.050, y la nota
      dice que la próxima vez **se recorta, no se sube**.
    - El texto **se saca del JSON emitido, nunca se re-tipea** (volcar al scratchpad con Node
      y copiar de ahí).
    - Después: **diff programático vivo-vs-emitido** (ese diff ya cazó un Responder transcrito
      resumido) y verificar **`activeVersionId` == draft** (una publicación ya quedó una
      versión atrás sin que nadie lo viera).
    - ⚠️ **El MCP de n8n necesita autorización OAuth** — Martín tiene que autorizarlo desde
      `/mcp` en una sesión interactiva antes de este paso.

## Verificación end-to-end (en vivo)

El gate no cubre lo que el modelo **declara**. Estas pruebas van contra el bot real, mirando
`cotizaciones[].cantidad` en la salida CRUDA del Agente, no solo el total.

**Regresión — los 4 caminos viejos deben estar intactos:**

| Escribir | Total | Si falla |
|---|---|---|
| `250 stickers 3x3` | $6.600 | $5.130 = buscó tramo por piezas |
| `100 stickers en vinilo UV 5x5` | $14.000 | mínimo facturable del material |
| `1000 tarjetas doble faz` | $54.000 | $54.000.000 = multiplicó en vez de dividir |
| `1 lona de 90x60` | $8.600 | $8.700 = redondeó hacia arriba |

**Caminos nuevos de este lote:**

| Escribir | Esperado | Qué ejercita |
|---|---|---|
| `1000 folletos 10x15 b/n` | $20.000 | presentación + división por paquete |
| `2000 folletos color` | $40.000 | otra presentación de la misma familia |
| `1500 folletos` | **deriva** | no-múltiplo de ninguna presentación |
| `1000 puntas redondeadas` | $7.000 | presentación separada |
| `cortame 5000 volantes` | $25.000 | millar → `paquete de 1000` |
| `3500 hojas de corte` | **deriva** | no-múltiplo |
| `3 pasadas de puntillado` | $150 | `pasada` → `unidad`, exento del mínimo |
| `5 imanes de heladera` | tramo 4-10 | Merchandising + material base |
| `1 imán troquelado UV 50x50` | m2 + mínimo 0,5 | Merchandising m2 |
| `necesito troquelado con forma` | **deriva** | apartado a Pendientes — confirmar que deriva limpio |

Correr además la **batería de LA CANTIDAD DECLARADA** completa (9/9): se tocó el chunk.

**Auditar con el lector, no a mano**: publicar `leer-bot-log (dev)` (`lThuFmf27HkM5dAR`) un
momento, `curl` al webhook desde la máquina local (el geo-block es solo-AR), despublicar.
Una tanda = 1 llamada.

**Criterio de éxito**: además del número — que **no** aparezca `⚠ auditoría:` en el mensaje,
que `cotizaciones` no venga vacío, y que el retrieval haya traído el chunk correcto.

**Rollback**: re-ingestar el v3 desde el visor + re-build + re-subir el flow. El v3 nunca se tocó.

## Escalabilidad de las unidades (tu pregunta explícita)

`modoDe` está triplicado, y la lista de unidades válidas aparece además en el mensaje de error
del validador y en la hoja `Instrucciones`. **No hace falta un refactor**: la duplicación es
deliberada (los scripts no importan TS, el nodo de n8n se emite como string) y hay un gate que
la protege (`CASOS_MODO` + "ningún material puede caer en `otro`"). Tres cosas chicas:

1. **Regex compartido**: mover el de `item` a `lib-xlsx.mjs` como `UNIDADES_ITEM` y que
   `validar-catalogo.mjs` lo importe. Lo importante: **el mensaje de error se genera DESDE el
   regex**, no se tipea. Mata la desincronización más probable.
2. **`Instrucciones` regenerada desde el código** (`instrucciones-unidades.mjs` hoy tiene
   hardcodeado el texto del v2, que dice "Hoy existen dos: pliego A3 y m2" — falso hace dos
   versiones). Con la regla que TG necesita: *"Si tu unidad no empieza con `pliego` ni `m2` ni
   es una de: unidad, hoja, paquete, pack, item, metro lineal — el bot no la va a saber cobrar.
   Si necesitás una forma de cobro nueva, escribila en la hoja `Pendientes`; no la inventes en
   Materiales."* Convierte el error en algo que TG previene solo.
3. **Dos chequeos nuevos del validador**, ambos como aviso:
   - *"material sin producto ni familia usada — es invisible para el bot"* (mirando `Familia`,
     que es lo que hoy le falta a `n8n/materiales-huerfanos.mjs` y le da 26 falsos positivos).
   - *"dos materiales con escalas idénticas"* — caza duplicados como Anotadores/Tacos.
   - Y uno que hubiera cazado los talonarios: *"el primer tramo arranca en Desde > 1"*, que
     solo tiene sentido si la escala está en algo distinto de unidades de cobro.

## Preguntas para TG (4, ninguna bloquea)

1. **`Anotadores personalizados` vs `Tacos/Emblocados 10x15 cm`** — mismo tamaño, mismo
   negro/color, **precios idénticos tramo por tramo**. Es el mismo producto cargado dos veces.
   ¿Cuál queda? Mientras convivan, el precio lo decide el retrieval. *(Daño acotado: los
   precios coinciden.)*
2. **`Encuadernación fresada`** — antes cotizaba cualquier cantidad; ahora la escala cierra en
   20 y 25 libros derivan. ¿Deliberado o se cerró sin querer al agregar el tramo 11-20?
   *(Única regresión funcional heredada del archivo del cliente.)*
3. **Cobertura de planos** — cargó los precios de 25/50/100% y la descripción promete
   cotizarlos, pero el bot no ve el archivo: **¿el cliente sabe decir qué cobertura tiene su
   plano?** Si no, el bot va a preguntar algo que nadie puede responder.
4. **Avisar de lo que quedó afuera**: troquelado con forma, talonarios de rifas y corte a
   medida no se cotizan todavía — el bot deriva. Confirmar de paso que el corte a medida es un
   recargo **por trabajo** (una vez, sin importar las piezas), para diseñar el mecanismo después.

## Archivos clave

**Nuevos**: `normalizar-inline.mjs` · `portar-hojas.mjs` · `extender-listas.mjs` ·
`omitir-pendientes.mjs` · `datos-catalogo-v4.mjs` + `cargar-catalogo-v4.mjs`

**A modificar**: `visor/scripts/validar-catalogo.mjs` (topes, mensaje del aviso, chequeos
nuevos) · `visor/scripts/lib-xlsx.mjs` (`UNIDADES_ITEM`, default al v4) ·
`visor/scripts/instrucciones-unidades.mjs` · la hoja `Casos de prueba` (6 casos)

**A reusar tal cual**: `agregar-columna.mjs` · `describir-colecciones.mjs` ·
`extender-dv-colecciones.mjs` (patrón) · `podar-pendientes.mjs` (patrón) ·
`cargar-productos-nuevos.mjs` + `datos-productos-nuevos.mjs` (patrón DATOS/ESCRITOR)

**Sin tocar**: `n8n/build-flow.mjs` · `visor/lib/parse.ts` · `visor/lib/chunk.ts` ·
`visor/lib/geometria.ts` — **el motor no se toca en este lote**.
