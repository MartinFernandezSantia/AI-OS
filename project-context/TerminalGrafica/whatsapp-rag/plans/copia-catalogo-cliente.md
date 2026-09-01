# Copia del catálogo para que TG cargue productos con su propio Claude

## Contexto

El bot de WhatsApp de Terminal Gráfica cotiza leyendo `Catalogo-TG-v3.xlsx` como fuente única.
TG quiere cargar productos nuevos él mismo, usando **Claude en modo Cowork** (le pasa el archivo
al chat y le pide los cambios; Claude edita con openpyxl y se lo devuelve).

Hoy eso es riesgoso: el catálogo de producción mezcla el motor de cotización del bot con las
instrucciones de carga, expone los casos de prueba, y varias reglas críticas rompen **en
silencio** (un material tipeado con una tilde distinta deja al producto sin precio; una unidad
que no empieza con `pliego`/`m2` se calcula con la fórmula equivocada sin aviso).

**Resultado buscado:** un archivo aparte, reducido, con instrucciones escritas para que un Claude
sin contexto pueda cargar bien; y un camino de vuelta que valide la **calidad del dato** antes de
que llegue al bot.

**Decisión de alcance (Martin):** el catálogo es de TG. Si suben un precio o retiran un producto,
es su negocio — no se audita cada cambio. Solo se reportan *problemas de calidad*: inconsistencias,
datos faltantes, duplicados, referencias rotas.

**Prioridad (Martin):** entregar el catálogo a TG **primero**. El modo rollo (abajo) queda
para después de la entrega.

### Pendiente conocido: troquelados por m² (modo rollo)

TG trajo imanes troquelados que se cobran por m² pero necesitan 3 mm de separación entre
piezas. **El motor no aplica separación en modo m²** (`build-flow.mjs:267-272` hace
`(ancho × alto) ÷ 10.000 × cantidad` y nada más), así que hoy ese caso no se puede cotizar bien.
Ya hay un material en producción con el mismo problema: `Vinilo UV troquelado` (fila 25,
$28.000/m²) — le falta la separación, y agregársela sube sus precios 12-20%, por lo que hay
que preguntarle a TG si ese precio ya contemplaba el desperdicio.

**Consecuencia para la entrega:** como TG va a cargar antes de que exista el modo rollo, las
Instrucciones deben decirle explícitamente que **no cargue troquelados por m² todavía** — si
cargara el ancho útil ahora, el motor lo ignoraría y cotizaría de menos, en silencio.

### Ya hecho en esta sesión (el v3 lo tiene aplicado)
- Data Validation de `Productos` extendida de fila 72 → 500.
- `_listas` (hoja oculta que alimenta los dropdowns) pasó de lista estática desincronizada a
  **598 fórmulas matriciales CSE** que leen valores únicos de `Materiales`/`Colecciones`, más
  `fullCalcOnLoad="1"`. Verificado abriendo en LibreOffice: los 73 materiales y 13 colecciones aparecen.

### Verificado empíricamente para este plan (openpyxl 3.1.5, lab aislado)
- Array formulas `t="array"`, Data Validation, defined names y el estado `hidden` de la hoja
  **sobreviven** a `load_workbook()` + `save()`.
- **`data_only=True` es destructivo**: abrir así y guardar **borra las 598 fórmulas**
  (verificado: `t="array"` pasa de 7 a 0). El archivo sigue abriendo, los dropdowns quedan
  muertos, nadie se entera.
- Leyendo `_listas`, Claude ve objetos `ArrayFormula` (default) o `None` (`data_only=True`) —
  **nunca los valores**. Debe leer los materiales de la hoja `Materiales`.

---

## Fase 0 — Higiene previa

1. Backup fresco del v3 (`.bak-YYYYMMDD-HHMMSS`).
2. **Arreglar `Colecciones!C`**: la Data Validation de "Material base" quedó en `sqref="C2:C35"`
   — mismo bug que arreglamos en `Productos`, en otra hoja. Extender a `C2:C300` antes de generar
   la copia, o se hereda.
3. **Cambiar el default de `XLSX` en `visor/scripts/lib-xlsx.mjs`** de `Catalogo-TG-v2.xlsx` a v3.
   Hoy, un script corrido sin `CATALOGO=` escribe en el v2 y parece que no hizo nada.
4. Baseline verde de referencia: `CATALOGO=Catalogo-TG-v3.xlsx node n8n/build-flow.mjs` y
   `node n8n/materiales-huerfanos.mjs`. Sin esto, un rojo posterior es ambiguo.

## Fase 1 — Refactor mínimo

5. En `lib-xlsx.mjs`, extraer `empaquetar(entradas): Buffer` de `guardar()`, dejando
   `guardar(entradas) = fs.writeFileSync(XLSX, empaquetar(entradas))`. Los scripts existentes
   escriben in-place; este necesita **leer uno y escribir otro**. Evita la tercera copia del
   empaquetador ZIP (ya hay dos: `lib-xlsx.mjs` y `podar-pendientes.mjs`).

## Fase 2 — El contenido de las Instrucciones

6. Escribir `visor/scripts/instrucciones-cliente.md` — **fuente versionada en git**, no literal
   embebido en el script. Es prosa que va a iterar y necesita diffs legibles.
   Micro-sintaxis mapeada a los 4 estilos que la hoja ya usa: `#` título, `##` sección,
   `>` gris itálica, sin marcador = normal, línea en blanco = fila vacía.
   **Los `s=` se leen del sheet1 actual, no se hardcodean** (patrón `estilosUsados`/`sDe` de
   `reescribir-instrucciones.mjs`). La indentación con espacios se preserva tal cual.

   **Contenido: solo la PARTE 2.** El motor de cotización (PARTE 1) no va — se inyecta al system
   prompt del bot vía `armar-prompt.mjs` y el cliente no debe verlo ni poder tocarlo.

   Cambios respecto del texto actual:
   - **Muere el "PASO 3 — Registrar los dos en `_listas`"** (hoy filas 78-82). Ahora es dañino:
     si escribe ahí, rompe las fórmulas. Se reemplaza por una línea **prohibitiva** en "LAS HOJAS
     Y PARA QUÉ SIRVEN" — no basta con omitirlo, el cliente ya aprendió el flujo viejo.
   - **4 pasos → 3**: colección → material → producto.
   - **LÍMITES DE CRECIMIENTO** con los topes reales (Productos 500, Materiales/Colecciones 300)
     y "si te acercás, avisanos" en vez de "extendé los rangos vos".
   - **`UNA UNIDAD DE COBRO NUEVA`**: hoy manda a escribir la regla "acá abajo, en la PARTE 1",
     que no existe en la copia. Reescribir a: "no lo cargues, avisanos — hay que escribir la
     fórmula de nuestro lado".
   - **Troquelados por m² — no cargar todavía.** Sección corta y explícita: si un material se
     cobra por m² y va troquelado (necesita separación entre piezas), avisar en vez de cargarlo.
     El motor todavía no sabe calcular la separación en m² y cotizaría de menos sin avisar.
     **No mencionar las columnas de geometría para m²**: mientras el modo rollo no exista,
     cargarlas no hace nada y da falsa sensación de que el caso está cubierto.
   - **`DESPUÉS DE EDITAR`**: hoy dice "cargalo en el visor de chunks". El cliente no tiene visor.
     Reescribir a "mandanoslo, lo revisamos e integramos".
   - Sacar de "LAS HOJAS" las líneas de `Parámetros` y `Casos de prueba` (ya no existen).
   - **Sección nueva "QUÉ NO TOCAR"**: no renombrar hojas, no reordenar ni renombrar columnas,
     no tocar los encabezados de la fila 1. Es lo que hace posible el reemplazo de Fase 5.
   - **Sección nueva dirigida al Claude que opera el archivo** (el hallazgo del lab):
     - Cargar **siempre** con `load_workbook(path)`. **Nunca `data_only=True`** — borra las
       fórmulas de `_listas` de forma permanente y silenciosa.
     - Los materiales válidos se leen de la hoja `Materiales`, **no** de `_listas`.
     - `_listas` es generada: no leerla, no escribirla, no "arreglarla".
   - Se quedan casi tal cual (son oro para el Claude del cliente): `CUIDADO CON LOS NOMBRES
     PARECIDOS` y `ERRORES QUE ROMPEN EN SILENCIO`.

7. **Revisión humana del `.md` completo** antes de escribir código que lo renderice.

## Fase 3 — Generar la copia

8. `visor/scripts/generar-copia-cliente.mjs` (dry-run por defecto, `--apply` para escribir,
   como todos los de esa carpeta). Destino:
   **`Catalogo-TG-cliente.xlsx`** — deliberadamente no empieza con `Catalogo-TG-v`, para que
   ningún glob ni default lo agarre por accidente.

   - **Guardas**: lock del origen *y* del destino; **abortar si el destino ya existe** salvo
     `--force` (puede tener carga del cliente adentro); verificar que las 7 hojas esperadas están.
   - **Borrar `Parámetros` y `Casos de prueba`**: resolver nombre → `r:id` → `sheetN.xml`
     dinámicamente (patrón `rutaDe()` de `volcar-hoja.mjs`), nunca hardcodear. Tocar
     `xl/workbook.xml`, `xl/_rels/workbook.xml.rels` y `[Content_Types].xml`; filtrar las entradas
     del ZIP. **No renumerar `sheetId` ni `rId`** (los huecos son válidos).
     Los `definedName` apuntan solo a `_listas`, que se queda: **no hay que tocarlos**.
   - **`sharedStrings.xml` se copia intacto**: los `<v>` son índices posicionales y las cadenas
     usadas llegan hasta el id 650. Podarlas rompe todo el texto del archivo.
   - **Vista inicial**: `activeTab="0"` y en sheet1 `tabSelected="true"`, `topLeftCell="A1"`.
     Hoy la vista quedó scrolleada en A82.
   - **Hornear los valores de `_listas`** (flag `--cachear-listas`, default on): calcular en Node
     los únicos de `Materiales`/`Colecciones` (mismo `Set` que `inspeccionar()` en
     `cargar-productos-nuevos.mjs`) e inyectarlos como `<v>` con `t="str"`. Sin esto, un Excel que
     no recalcule muestra dropdowns vacíos; con esto la degradación es graciosa.
   - Marcar la copia en `docProps/core.xml` (`dc:title`).

9. Verificaciones automáticas sobre el archivo generado:
   - `abrir()` no tira; 14 entradas con los nombres esperados.
   - **`Colecciones`, `Materiales` y `Productos` byte-idénticos** (contenido inflado) al origen.
   - 598 `<f t="array">` vivas en `_listas`, apuntando a `Materiales!$A$2:$A$300` /
     `Colecciones!$A$2:$A$300`.
   - `fullCalcOnLoad="1"` presente; `definedNames` intactos.
   - Cierre cruzado: 5 `<sheet>`, cada `r:id` en `.rels`, cada Target existe como entrada, cada
     uno con su `<Override>`. **Cero Overrides huérfanos** de sheet5/6 — es lo que hace que Excel
     pida "reparaciones".
   - `volcar-hoja.mjs` sobre `Instrucciones` (leerla entera con ojos humanos) y sobre las 3 hojas
     de datos en origen vs copia (salida idéntica).

10. **Prueba manual insustituible**: abrir la copia en LibreOffice, agregar una colección de
    mentira y ver que aparece en el dropdown de `Productos` — prueba el auto-update end-to-end.
    Descartar esa copia de prueba y regenerar limpio.

11. **Prueba del ida y vuelta real**: pasar la copia por un `load_workbook()` + `save()` con
    openpyxl en el lab del scratchpad y re-correr las verificaciones del punto 9. Es el viaje que
    va a hacer el archivo en Cowork.

12. Commit de la copia + los scripts + el `.md`.

## Fase 4 — Entrega

13. Mandarle la copia a TG con un mensaje corto: abrila en Excel (o pasásela a Claude), no borres
    ni renombres hojas ni columnas, devolvémela cuando termines.

## Fase 5 — La vuelta (se construye mientras el cliente carga)

14. `visor/scripts/validar-catalogo.mjs` — los predicados semánticos, portados de
    `visor/lib/parse.ts` a `.mjs` (los scripts no importan TS; `rinde()` en `lib-xlsx.mjs` ya
    sentó ese precedente). Reglas:
    - Material referenciado por un producto que no existe en `Materiales` → **error** (es el
      error #1 de "rompen en silencio").
    - Colección referenciada que no existe en `Colecciones` → error.
    - `modoDe(unidad)` que da `"otro"` → **error**: no hay fórmula para cotizarlo.
    - Material modo `pliego` sin geometría (`geometriaDe()`) → error.
    - Producto modo pliego cuyo rinde calculado da **0** (la pieza no entra) → error.
    - Tramos de escala con huecos o superposiciones (`escalaDe()`) → error.
    - Precio 0 o vacío en un tramo → error.
    - Material modo m2 sin `Mínimo facturable` → warning.
    - Claves duplicadas (dos productos con el mismo nombre en la misma colección) → error.
    - Filas cercanas al tope de crecimiento → warning.
    - Reusar `n8n/materiales-huerfanos.mjs`, que ya cruza materiales contra su uso.

15. `visor/scripts/integrar-copia-cliente.mjs` — **reemplazo, no diff**. Dado el alcance decidido,
    las tres hojas de datos del cliente **reemplazan** a las del v3. No hay snapshot ni política de
    conflictos. Aborta si: falta una hoja, cambió un nombre de hoja, o los headers de la fila 1 no
    coinciden en nombre y orden (`agregar()` arma celdas por posición, y un header renombrado
    deja `m["Precio por unidad"]` en `undefined` → precio 0, en silencio).
    Columnas **nuevas** no abortan (el schema es dinámico por diseño) pero se reportan destacadas.

16. Probarlo con un caso sintético (agregar/modificar/borrar filas a mano en una copia) antes de
    que llegue lo real.

17. La skill de validación, envolviendo `validar-catalogo.mjs` + el dry-run del integrador.
    Corre en dos momentos: el cliente antes de devolver el archivo, y Martin como gate final.

## Fase 5-bis — Modo rollo: separación en m² (después de la entrega)

Se implementa mientras TG carga. **El imán entra como material NUEVO; `Vinilo UV troquelado`
(fila 25) NO se toca** — migrarlo cambia 5 de 6 precios ya validados (+12% a +20%) y ningún
ancho de rollo los preserva. Mezclarlo con esto pone el gate en rojo y deja de distinguir
"el motor está mal" de "el precio cambió".

**El cálculo** — reusa `Área útil ancho (cm)` como ancho útil del rollo; el alto queda vacío
(el rollo es continuo, el largo es lo que se calcula):
```
piezas por fila  = floor((útilAncho + sep) ÷ (W + sep))
filas            = ceil(cantidad ÷ piezas por fila)
largo consumido  = filas × (H + sep)
m²               = (útilAncho × largo) ÷ 10.000     → después mínimo facturable y redondeo
```
**Activación por dato, sin columnas nuevas:** m² con `Área útil ancho` cargada → rollo;
vacía → superficie plana como hoy. Los 8 m² actuales tienen la columna vacía: no cambia nada.

**Función nueva `encajeRollo`, NO extender `rinde()`** — y solo en `FUENTE_RINDE`
(`build-flow.mjs:188-196`), no en las 3 copias: el visor y los scripts no cotizan.
Motivo del corte: `rinde()` **maximiza piezas**, `encajeRollo` **minimiza largo**, y no dan
lo mismo. Imán 8×5, 200u, rollo 100: la orientación de 12 por fila consume 90,1 cm y la de
18 por fila consume 99,6 cm — **gana la que rinde menos por fila**. Implementar la rotación
con `Math.max` de piezas da $44.800 en vez de $40.500.

Pasos, cada uno dejando el gate verde:
1. **Relajar la geometría** — `geometriaDe` hoy exige ancho **y** alto (`parse.ts:94-96`,
   `build-flow.mjs:329`); con el alto vacío devuelve `null`. Pasa a exigir solo el ancho;
   `utilAlto` a `number | null` y los `!(utilAlto > 0)` explícitos. Sin efecto funcional.
2. **Guard `geoParaRinde` por modo** en `chunk.ts` (call sites :531, :654, :690) + guard
   secundario en `rindeEfectivo` (:125-132). Hoy no hace falta (la geometría sale `null`),
   pero en cuanto se relaje el paso 1, `itemProducto` (:316-318) emitiría *"entran N por m2"* —
   una línea sin sentido que invita al modelo a convertir. Va **antes** del dato, a propósito.
3. **`encajeRollo` + rama m2 bifurcada** en `FUENTE_COTIZAR`. Pieza que no entra ni girada →
   `ok: false`, deriva a consulta (mismo criterio que el rinde 0 de pliego).
   **No asignar el encaje a `r`**: `r` se emite como `piezas_por_unidad` (:869, :2439) y debe
   seguir siendo número|null. Devolver `encaje_rollo` como campo aparte.
   Tests unitarios de `encajeRollo` **antes** de tocar el Excel.
4. **Cargar el material y los casos** (valores provisorios hasta que TG confirme ancho de rollo
   y precio). 8 casos nuevos → el gate pasa de 132 a 140. Los que más valen:
   200u (rotación por largo), 50u (rotación inversa, prueba que el desempate no está fijo),
   1 pieza de 120×110 (no entra ni girada → consulta), 150×20 (entra solo rotada).
5. **Chunk + avisos.** El chunk **no muestra la fórmula**: son cuatro pasos con `floor`/`ceil`
   y no hay versión "para entender" que no sea también "para aplicar mal". Dice que se cobra
   el largo de rollo consumido y que el sistema resuelve el encaje.
   Tres avisos nuevos en el visor: m² troquelado sin ancho útil (marca la fila 25), pieza que
   no entra en el rollo, y m² con `Área útil alto` cargado.
6. `test-auditor.mjs` — verifica que `piezas_por_unidad` siga siendo `null` en m².
7. **Actualizar la hoja `Instrucciones` del v3** (la PARTE 1 alimenta el system prompt): sumar
   el sub-modo rollo. Y en la copia del cliente, reemplazar el "no cargues troquelados por m²"
   por la explicación real.

**En vivo, no solo el gate** (el auditor recalcula desde el catálogo pero no valida la premisa):
`200 imanes de 8x5` (que declare cantidad 200, no los m²), `quiero imanes de 8x5` (que pregunte
la cantidad), `imanes de heladera` sin medida (que pregunte, no que agarre la de referencia),
`una lona de 3x1` → $48.000 (regresión del m² plano) y `100 stickers en vinilo UV de 5x5` →
$14.000 (canario de que la fila 25 no se migró sin querer).

**Riesgo a vigilar:** el ancho útil en un m² cambia el precio de forma dramática para piezas
grandes (una lona de 30×120 en rollo de 100 pasa de $22.500 a $54.100). Los avisos se acotan a
materiales cuyo nombre dice "troquelado", y las Instrucciones deben decir que un material que se
imprime de corrido (lonas, vinilos de cartel) **no lleva** ancho útil.

## Fase 6 — Integrar (cuando TG devuelve)

18. `abrir()` sobre el archivo devuelto. Si el parser manual no lo aguanta (Cowork/Excel pueden
    re-empaquetar distinto), plan B: abrir y re-guardar en LibreOffice para normalizar. **Paso
    previsto, no sorpresa.**
19. `validar-catalogo.mjs` → resolver los errores con TG antes de seguir.
20. Integrar sobre una **copia** del v3, nunca sobre el v3.
21. **`CATALOGO=<copia> node n8n/build-flow.mjs`** — el test de regresión más fuerte que existe:
    132 casos + 11 rindes, no emite si falla uno.
22. Cargar en el visor y mirar los chunks nuevos. *"Mirá los chunks generados, no solo los tests"*
    — tres errores que llegaban al texto que lee el cliente pasaron 152 tests en verde.
23. Promover a v3 con backup, commit, y re-ingestar desde el visor.

---

## Verificación end-to-end

El camino completo queda probado cuando:
1. `generar-copia-cliente.mjs --apply` produce un archivo que abre en LibreOffice **y** en Excel
   sin pedir reparaciones.
2. Agregar una colección en la copia hace aparecer el valor en el dropdown de `Productos`.
3. La copia sobrevive un `load_workbook()`/`save()` de openpyxl con las 598 fórmulas intactas.
4. `validar-catalogo.mjs` detecta, sobre un archivo saboteado a propósito, cada una de sus reglas
   (verificar **en rojo** antes de confiar — un sabotaje que deja el substring intacto no prueba nada).
5. `build-flow.mjs` sigue verde (132/132) sobre el catálogo integrado.

## Riesgos principales

| Riesgo | Mitigación |
|---|---|
| **El Claude del cliente usa `data_only=True` y borra las 598 fórmulas** — silencioso | Aviso explícito y prominente en Instrucciones dirigido al Claude; verificación al recibir |
| Regenerar la copia pisa trabajo del cliente | Abortar si el destino existe salvo `--force` |
| Reordena o renombra columnas | Sección "QUÉ NO TOCAR" + el integrador aborta con mensaje claro |
| El Excel del cliente no recalcula → dropdowns vacíos | Valores horneados como caché (degradación graciosa) |
| Carga una unidad de cobro nueva sin fórmula | Instrucciones le dicen que avise; `modoDe()==="otro"` es error duro |
| El v3 avanza mientras el cliente tiene la copia | Mantener la ventana corta; el reemplazo la hace visible |
