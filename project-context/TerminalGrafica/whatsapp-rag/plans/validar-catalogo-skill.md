# Skill `tg-validar-catalogo` — validación del catálogo antes de la carga al bot

## Context

TG carga su catálogo en `Catalogo-TG-cliente.xlsx` usando su propio Claude. Los errores de ese
archivo **rompen en silencio**: un material tipeado con una tilde distinta deja al producto sin
precio, una unidad que no arranca con el prefijo correcto se cotiza con la fórmula equivocada, y
Excel no marca nada. Hoy el ciclo es: TG carga → manda el archivo → Martin corre
`validar-catalogo.mjs` → devuelve los errores → TG corrige → repetir.

El objetivo es cortar ese ida y vuelta: que TG pueda verificar la consistencia **antes** de mandar
el archivo, con su propio Claude, sin instalar nada ni correr scripts.

**Decisiones tomadas (Martin, 2026-09-07):**
- La skill corre en **el Claude de TG**, sobre su copia del Excel.
- Es **autocontenida**: no depende de `visor/`, ni de Node, ni del repo. TG no los tiene.
- **Solo diagnóstico.** No escribe en el Excel. TG corrige a mano.

### El riesgo aceptado, y cómo se mitiga

Las 22 reglas viven hoy en `visor/scripts/validar-catalogo.mjs`. Una copia en lenguaje natural en
la máquina del cliente **va a divergir** cuando cambie el motor — es el mismo problema que ya tiene
la fórmula de encaje, duplicada a propósito en 3 lugares. Se acepta porque una skill que le pide a
TG correr Node es una skill que TG no usa.

Mitigación, en dos partes:
1. La skill deriva del script como fuente. Los mensajes del script **ya están escritos en lenguaje
   del cliente**, así que se portan casi literales: lo que se traduce es la lógica de detección, no
   el texto.
2. Se agrega un **puntero de sincronización** en el encabezado de `validar-catalogo.mjs` (una línea
   de comentario) y en el SKILL.md, cada uno nombrando al otro. Igual que el precedente ya sentado
   por `rinde()`.

---

## Qué construir

Un solo archivo nuevo:

```
.claude/skills/tg-validar-catalogo/SKILL.md
```

Sin `references/`, sin `scripts/`. El patrón de las skills de Martin no usa scripts ejecutables, y
acá además serían inservibles (la skill corre en otra máquina).

### Frontmatter

Estilo B (línea única larga), el de `zonaprop-listing` — es el único precedente "empaquetable",
escrito sin nombrar a Martin ni usar paths de su máquina.

```yaml
---
name: tg-validar-catalogo
description: Revisa el catálogo de Terminal Gráfica (Catalogo-TG-cliente.xlsx) antes de mandarlo
  para integrar al bot. Usar cuando el usuario diga "revisá el catálogo", "está bien cargado",
  "chequeá la planilla", "validá el Excel", "¿puedo mandarlo?", o cuando termine de cargar
  productos, materiales o precios. Detecta los errores que rompen en silencio: materiales mal
  escritos, unidades sin fórmula, tramos con huecos o superpuestos, piezas que no entran en el
  pliego, geometría faltante. Solo diagnostica — las correcciones las hace el usuario en la planilla.
metadata:
  version: 1.0.0
---
```

### Estructura del cuerpo

Arquetipo (A) — skill de gate / reglas de casa, como `higgsfield-preflight`.

1. **Apertura sin encabezado** — 2 frases: qué es la planilla, cuál es el límite de autoridad
   (*"Vos revisás y explicás. Las correcciones las hacen ellos en la planilla — nunca edites el
   archivo."*).

2. **`## Cómo abrir el archivo`** — las 3 reglas que ya están en `instrucciones-cliente.md:142-155`,
   portadas literales. `data_only=True` borra las 598 fórmulas de `_listas` de forma permanente y el
   daño no se ve. Es lo primero porque es lo único que la skill misma puede romper.

3. **`## Qué NO se revisa`** — el límite, portado de `validar-catalogo.mjs:8-9`: no se auditan
   decisiones comerciales. Si suben un precio o retiran un producto, es su negocio. Acá solo
   inconsistencias, faltantes y duplicados.

4. **`## Las revisiones`** — el núcleo. Las 22 reglas agrupadas por hoja, cada una con:
   qué mirar · **la consecuencia** ("el producto queda SIN PRECIO") · cómo se corrige.
   Los mensajes se portan de `validar-catalogo.mjs`, que ya los tiene redactados para el cliente.
   - `### Antes que nada` — hojas requeridas presentes; `_listas` con fórmulas vivas (regla 2, la
     más cara: si se perdieron, hay que regenerar la copia, no se arregla cargando).
   - `### Materiales` — reglas 4-14: sin unidad; unidad/modo en `otro` (con la lista completa de
     valores válidos y el caso `metro cuadrado` ≠ `m2`); `Modo de cálculo` contra el prefijo; tramo
     sin precio; `Hasta` vacío fuera del último; superposición; hueco; último tramo cerrado (con la
     excepción de la Nota deliberada); pliego sin geometría; m2 sin mínimo facturable; m2 con
     geometría cargada.
   - `### Colecciones` — reglas 15-17: duplicada; sin descripción; material base inexistente.
   - `### Productos` — reglas 18-21: duplicado; sin colección o colección inexistente; sin material
     o material inexistente; pieza que no entra (rinde 0).
   - `### Crecimiento` — regla 22: hoja pasando el 80% del tope.

5. **`## La fórmula del rinde`** — necesaria para la regla 21 y no derivable de nada. Portada
   literal de la hoja `Instrucciones` / `build-flow.mjs:191-199`:
   `floor((útil + sep) ÷ (pieza + sep))` en cada eje, probando **las dos orientaciones** y tomando la
   que rinde más. Con el ejemplo trabajado (12×8 en 28×44 sep 0,3 → acostada 2×5=10, parada 3×3=9,
   gana 10) y el caso rinde 0 → derivar a consulta, nunca inventar.

6. **`## Cómo se decide el modo`** — la tabla de `modoDe`, que es de donde salen los errores más
   caros. La columna `Modo de cálculo` manda; el prefijo de la Unidad es el fallback. Con los casos
   defensivos que ya están en el gate: `metro lineal`→item pero `metro cuadrado`→otro;
   `talonario de 100`→item pero `talonarios`→otro (el plural NO matchea, y debe romper visible).

7. **`## El informe`** — bloque literal del formato de salida, calcado del script para que Martin
   reciba algo que ya conoce:
   ```
   catálogo: <archivo>
   N colecciones · N materiales (N tramos) · N productos

   ✗ ERRORES — hay que corregirlos antes de mandar (N)
      <Hoja> fila <N>: <qué pasa, qué consecuencia tiene, cómo se corrige>

   ⚠ avisos — conviene mirarlos (N)
      <Hoja> fila <N>: <...>
   ```
   Regla de cierre explícita: **con un solo error, no se manda el archivo.** Los avisos no bloquean.

8. **`## Qué NO hacer`** — sección de cierre negativa, taxativa:
   no editar el Excel; no abrir con `data_only=True`; no tocar ni leer `_listas`; no inventar un
   material parecido cuando uno no existe (va a la hoja Pendientes); no opinar sobre precios;
   no decir "está todo bien" sin haber recorrido las 4 hojas enteras.

### Voz

Castellano rioplatense, voseo, tono de runbook. Sin emojis. Cada regla con su consecuencia, no con
un "esto es importante" — la voz de la casa del proyecto es la frase-consecuencia: *"rompe EN
SILENCIO"*, *"sale plausible y nadie lo nota"*.

Diferencia con las otras skills de Martin: **el lector es TG, no Martin.** No se nombra a Martin, no
hay paths de su máquina, y se habla de "ustedes" / "nosotros lo integramos" — el registro que ya usa
`instrucciones-cliente.md`.

---

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| `.claude/skills/tg-validar-catalogo/SKILL.md` | **Nuevo.** Todo lo de arriba |
| `visor/scripts/validar-catalogo.mjs` | 1 línea de comentario en el encabezado: si cambian estas reglas, actualizar la skill |
| `visor/scripts/instrucciones-cliente.md` | Sección corta al final: que existe la skill y que conviene correrla antes de mandar el archivo. Se renderiza a la hoja con `render-instrucciones-cliente.mjs` |

Fuentes de las que se porta (solo lectura):
- `visor/scripts/validar-catalogo.mjs` — las 22 reglas y sus mensajes
- `visor/scripts/instrucciones-cliente.md` — el registro y las reglas de apertura del archivo
- `n8n/build-flow.mjs:191-199` — la fórmula de encaje
- `n8n/build-flow.mjs:631-669` — la tabla de casos de `modoDe`

---

## Verificación

La skill se prueba contra archivos reales, no en abstracto.

1. **Falso positivo cero (el más importante).** Correr la skill sobre `Catalogo-TG-v4.xlsx`, que hoy
   da `0 errores, 14 avisos` en el script. La skill tiene que llegar a lo mismo: 0 errores y los 14
   avisos de "último tramo termina en N". Si inventa errores, TG deja de confiar en ella al primer uso.

2. **Detecta lo que tiene que detectar.** Sobre una copia en el scratchpad, romper a propósito y
   confirmar que cada uno sale con hoja + fila + consecuencia:
   - un material tipeado con tilde distinta en Productos → error de material inexistente
   - `metro cuadrado` como unidad → error de modo `otro`
   - un hueco entre tramos (1-10 y 15-20) → error de hueco
   - una pieza más grande que el área útil → error de rinde 0
   - una colección duplicada → error de duplicado

3. **El contraste con el script.** Correr `CATALOGO=... node visor/scripts/validar-catalogo.mjs`
   sobre los mismos archivos rotos y diffear contra el informe de la skill. Deben coincidir en qué
   detectan y en el nivel (error vs aviso). Donde no coincidan, gana el script.

4. **Prueba en frío.** Sesión nueva de Claude, sin este repo en contexto, solo la skill + el .xlsx.
   Es el escenario real de TG. Si necesita algo del repo para funcionar, no está autocontenida.

5. **Legibilidad.** Que el informe se entienda sin saber qué es un "modo" ni un "chunk". La prueba:
   ¿un error dice qué celda tocar y qué escribir ahí?

---

## Lo que este plan NO resuelve

- **La divergencia a futuro.** El puntero de sincronización avisa, no obliga. Si el motor cambia y
  nadie actualiza la skill, TG valida contra reglas viejas.
- **La contradicción `Modo de cálculo` = proporcional + `Precio total por tramo` = sí** (filas
  322-332 del v4, las rifas). Hoy **ningún validador la marca** — el script compara el modo contra la
  Unidad, no contra la columna N. Los 166 casos pasan, así que probablemente sea intencional, pero
  conviene confirmarlo con vos antes de decidir si la skill lo reporta.
- **El modo rollo** (separación en m²) sigue pendiente en el motor; la skill solo avisa que la
  geometría en m2 hoy se ignora.
