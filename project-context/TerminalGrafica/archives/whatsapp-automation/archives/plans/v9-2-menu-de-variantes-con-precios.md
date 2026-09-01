# v9.2 — El menú de variantes dice precios, y "la más barata" se va

> **Estado:** ✅ **CONSTRUIDO Y APLICADO** — commit `981dfc8` (bloque 14 de `build-v9.js`),
> verificado por Martin en WhatsApp real el 2026-07-28 a la noche. Harness 354/354.
> **Fecha:** 2026-07-28.
> **Origen:** incidente real del 28 (cartel de inmobiliarias, turno 4).
> **Contrastes que pasó:** 3 pasadas adversariales Opus (plata, resolución, menú).
> Las dos primeras **refutaron** los fixes anteriores; la tercera refutó la primera
> versión de éste y dejó el residuo que se construyó.
>
> **Lo que salió en producción:**
> ```
> Para la impresion exterior montada sobre plastico corrugado tenemos estas opciones:
> 1 x 0.65 mt: $19.500,00   ·   1 x 1 mt: $30.000,00
> 2 x 1 mt: $48.000,00      ·   a3: $10.500,00
> Promocion inmobiliarias 1 x 0.65 mt (llevando 6): $15.000,00
> Son precios de lista. Decime cual te sirve.
> ```
>
> **Diferencias con lo planificado, todas por hallazgos de la construcción:**
> - el separador es ` → ` y no `: ` — el `:` colisionaba con el header de grupo (test `A51`);
> - `Get Opciones` necesitó `v.atributos` para la unidad de venta (no estaba en el plan);
> - el menú de **rescate** de ARP también hubo que tocarlo (§5a lo vuelve frecuente);
> - la excepción de escalera se resolvió **dentro de `elegirVariante`**, como sugirió la
>   lente de resolución, y no en una capa aparte;
> - **§6 era falso**: MD4/EV4 NO se pusieron rojos (el menú también contiene `$10.500`).
>   Los que sí cambiaron fueron `M1`, `V8-17` y `PK4`. El oráculo por presencia de un
>   monto no distingue "cotizó la A3" de "listó la A3 entre otras tres".

---

## 0. La decisión de negocio que lo habilita

Martin, 2026-07-28, textual:

> *"No hay uno por defecto, muestra todas las variantes."*

Y sobre las variantes que figuran en $0:

> *"Ocultalas, no hay necesidad de que el bot las vea"* → **corregido en la misma sesión**
> cuando la auditoría mostró que 18 de 21 sí tienen precio (ver §4). La decisión final es
> mostrarlas en el menú como **"según cantidad"**, sin monto.

Esto **deroga** la conducta que el código venía teniendo, y hay que decirlo con todas las
letras porque hay tests que la afirman como correcta (§6).

---

## 1. El incidente

```
T1  cliente: cuánto sale un cartel de 1x0.65
    bot:     $19.500          ← correcto, variante "1 x 0.65 mt"
T2  cliente: Necesito 3 para mi inmobiliaria
    bot:     promo desde 6 unidades
T3  cliente: Cual es la promo?
    bot:     $15.000 c/u      ← correcto, producto PROMO
T4  cliente: Ok y si solo necesito 3?
    bot:     $10.500 c/u      ← ERROR. Es la variante "a3" (hoja A3).
                                Corresponde $19.500. Sub-cotización de 1,86×.
```

---

## 2. La causa raíz

`elegirVariante()` (build-v9.js, bloque `VAR_NUEVO`) puntúa las variantes **sólo sobre el
mensaje actual**. En T4 el mensaje es *"Ok y si solo necesito 3?"*: no hay medida, ningún
eje matchea, las 4 variantes empatan en `a_favor = 0`. Entonces baja por el desempate:

1. más ejes a favor → empate
2. `default_variante` curado → **no existe** (1 de 185 variantes lo tiene)
3. **la más barata** → gana la hoja A3, $10.500

El punto 3 es la causa. Su justificación en el propio código:

> *"El precio como ultimo criterio es la direccion segura: si erramos, erramos por abajo y
> la puerta abierta ofrece el resto."*

**Esa justificación es falsa.** Errar por abajo es sub-cotizar, que es exactamente el daño
que el proyecto viene persiguiendo desde el 27 (los cuatro confident-wrong de 1,42× ·
1,25× · 1,76× · 100×). "La dirección segura" es la dirección del daño.

---

## 3. El falso dilema que hay que romper

El código justifica "la más barata" con esto:

> *"Devolver TODAS cuando el cliente no dijo nada seria 'ambiguo' y mandaria a email: justo
> lo que este rediseño vino a evitar."*

**Empíricamente falso**, verificado ejecutando el nodo real contra el catálogo real:
devolver las 4 filas produce el **menú de rescate que ya vive dentro de `Armar Respuesta
Precio`** (ventana `main.rows.length >= 2 && <= 20`), no un email.

```
T4, con las 4 filas devueltas:
  "Tenemos estas opciones de Impresión exterior…
   - 1 x 0.65 mt / - 1 x 1 mt / - 2 x 1 mt / - a3"
```

El comentario describe un sistema que **dejó de existir** cuando se agregó ese rescate. El
ruteo ya está: no hay que tocar `Armar Menu Opciones` ni mover nodos.

**Pero el menú es mudo en precio.** Las filas llegan con `precio_lista` cargado y el
renderer lo tira (arma `'- ' + v0` y nada más). Ése es el trabajo real de este plan.

Con precios, el menú **es** la respuesta, no una pregunta:

```
1 x 0.65 mt → $19.500      1 x 1 mt → $30.000
2 x 1 mt    → $48.000      a3       → $10.500
```

Un mensaje, no dos. Eso **invierte el argumento de costo** (WhatsApp cobra por mensaje
desde oct-2026, ~USD 0,026) a favor de mostrar todas, y vuelve irrelevante el anti-loop de
3 turnos que hoy termina mandando a email por la ventana de atrás.

---

## 4. Las variantes en $0: el dato que corrigió la decisión

Auditoría sobre el export real (185 variantes, 88 productos):

| | cuántas | qué son |
|---|---|---|
| `precio_lista = 0` | **21** | — |
| …con precio real en `rangos_cantidad` | **18** | el 0 es un **sentinela** de "se cotiza por escalera de cantidad". **El bot hoy las cotiza bien** (`ok_rangos` / `ok_bracket`). |
| …sin precio de ningún tipo | **3** | Papel Vegetal a3/Oficio, Papel Vegetal a4, Sobre Inglés — **los tres ya están en productos ocultos**, fuera del alcance del bot. |

`precio_lista = null` o ausente: **0 casos**. Los 185 valores son numéricos.

**Ocultar las 21 habría borrado 12 productos vivos del catálogo cotizable** — imanes, las 2
carpetas de presentación, los 6 tacos/emblocados, rifas, encuadernado, refilado: todas sus
variantes están en ese estado, así que se quedaban sin nada que mostrar.

**Decisión final (Martin):** en el menú, esas líneas dicen **"según cantidad"**, sin monto.
Es consistente con la regla de oro — "según cantidad" no es un monto, así que no hay número
que se pueda despegar de su condición. Si el cliente elige esa línea, ahí sale la tabla de
rangos que el sistema ya sabe armar.

Las 3 sin precio no se tocan: ya están fuera por `producto.oculto`.

---

## 5. Lo que se construye

### 5a. Se va "la más barata" — el desempate final

`elegirVariante()` deja de reducir a uno cuando quedan varios finalistas y no hay criterio.
Devuelve los finalistas y el ruteo existente los convierte en menú.

### 5b. Renderer de menú CON precios *(el trabajo real)*

Determinístico, en el Code node. **El LLM no tipea el monto** — se respeta la regla de oro.
Por línea:

- monto formateado + **unidad de venta** (`c/u`, `por pack`, `por hoja`, `m²`)
- si la variante es de escalera (`precio_lista = 0` + `rangos_cantidad`) → **"según cantidad"**
- si es de las 3 sin precio → no llega (producto oculto)

### 5c. Dónde NO se aplica — las dos excepciones

La regla *"mostrá todas"* vale para **ejes cualitativos** (medida, faz, color, papel). No vale:

1. **Escaleras de cantidad y packs reales.** *"necesito 500 rifas"* hoy devuelve la tabla
   completa de rangos; con la regla a secas devolvería un menú y **perdería la escalera**.
   Ahí la reducción a uno se preserva.
2. **Anclaje total.** *"1000 tarjetas doble faz encapsuladas"* — el cliente nombró todos los
   ejes — igual caería en menú por un empate residual. Sería **repreguntar lo ya dicho**,
   que el propio código marca como *"regla sagrada"*.

### 5d. Bug aparte, mismo paquete: packs adivinados del nombre

`packDe()` deduce el tamaño del pack leyendo **el primer número del nombre de la variante**
cuando no hay `pack_unidades` curado. En familias por medida eso es desastre:

```
PVC:  "100X 70 CM" → pack de 100     "35X50 CM" → pack de 35     "A3" → pack de 3
```

**12 productos disparan `hayPack` y sólo 5 son packs de verdad.** Los otros 7 (PVC, cartón,
montado sobre cartón, kraft, vegetal…) sufren un bug de la misma clase que el incidente:

| conversación | sale hoy | corresponde |
|---|---|---|
| "cartel pvc de 60x90" → "necesito 3" | A3, $13.000 | $35.000 |
| memoria 60x90 → "necesito 100" | 100x70, $4.200.000 | $3.500.000 |

**Fix:** exigir `pack_unidades` curado en TODAS las variantes; borrar el fallback por regex.
Un renglón. Los 5 packs reales (folletos, perforaciones, puntas) ya lo tienen curado.

---

## 6. Los tests que blindan el bug

`tests/code-harness.js`:

```js
// MD4
console.log('MD4 sin medida sigue ganando la más barata:',
  /\$10\.500,00/.test(r[0].json.reply) ? 'OK' : 'FAIL …');
// EV4 — "sin default gana la más barata"
```

**El harness afirma como correcto el importe exacto del incidente.** 210/210 en verde, MD4
incluido. No es que el fixture tenga la forma equivocada (el problema de
[[tests-fixtures-mienten]]): es que **el oráculo codifica la conducta que el negocio acaba
de derogar**.

MD4 y EV4 se reescriben **en el mismo commit** que el fix. Si no, el próximo build los ve
verdes y reintroduce el default. Que se pongan rojos es la señal de que el fix funciona.

---

## 7. Alcance

| # | qué | tamaño |
|---|---|---|
| 1 | Sacar "la más barata" del desempate | 1 línea |
| 2 | Renderer de menú con precios + unidad + "según cantidad" | **el trabajo real** |
| 3 | Preservar reducción en escaleras/packs y anclaje total | condición del 2 |
| 4 | `packDe()` exige `pack_unidades` curado | 1 línea |
| 5 | Reescribir MD4 y EV4 | mismo commit |

---

## 8. Lo que este plan NO resuelve

**El turno 4 sigue repreguntando algo que el cliente ya contestó en el turno 1.** El menú le
vuelve a ofrecer las 4 medidas cuando ya había dicho "1x0.65".

Eso es aceptable **como piso**, no como destino: *un menú redundante es recuperable; una
sub-cotización de 1,86× que el cliente acepta, no.* Molesta, no miente.

La solución de fondo (recordar la medida entre turnos) **fue refutada dos veces** en esta
sesión — ver `v9-1-hechos-en-vez-de-negativa.md` §9. Cualquier reintento tiene que explicar
primero por qué esta vez sí, sabiendo que:

- el turno anterior del incidente cotizó **otro producto** (la promo), así que "mismo
  producto" da NO y el fix queda inerte;
- la ventana del router es `limit 3` y las filas de silencio (`noop`) la consumen;
- forzar la variante vieja crea **estado pegajoso**: *"y el a3?"* quedaría pisado.

Queda anotado, no construido. Igual que el §0 de v9.1, que también sigue vigente: el guard
`bajoMinimo` se sigue negando a cotizar algo que el sistema sabe.

---

## 9. Falsación

Medible sobre `bot.decisiones`, que desde el commit `1dd3040` **por fin se escribe**:

- Si tras el cambio **más del ~20%** de los menús de variantes no recibe respuesta del
  cliente en el turno siguiente, el menú con precios está siendo peor que un número — y hay
  que revisar el formato, no volver al default.
- Si aparecen menús donde el cliente **ya había anclado** todos los ejes, el guard de
  anclaje total (§5c.2) está flojo.
- Contar cuántas veces sale **"según cantidad"** en un menú: si es la mayoría de las líneas,
  el formato no sirve para esa familia y hay que mostrar la tabla directamente.
