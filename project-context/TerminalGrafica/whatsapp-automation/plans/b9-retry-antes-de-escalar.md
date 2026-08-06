# B-9 · Retry/fallback antes de escalar a mail — spec de diseño (2026-08-06)

> Estructural. Reemplaza el salto directo a mail de la rama False de
> `¿Hay Algo Que Decir?` por reintentos apuntados a la causa real. Diseñado con
> Martin. Se construye por partes (ver Build order). Ningún cambio toca la
> invariante madre: **ningún LLM tipea precios; el path que sea produce
> candidatos que pasan por Calcular Montos.**

## Problema

`Calcular Montos → ¿Hay Algo Que Decir?` → rama False (`main#1`) → `Label
Escalación` → mail. Hoy escala en el **primer** intento fallido. Cada escalación
evitable es una venta que casi se pierde.

La rama False salta con `hayAlgoQueDecir=false` y un `motivoVacio` que ya
distingue la causa (Calcular Montos lo setea). Tres causas raíz (Martin):
1. **Selector** mandó a buscar un producto inexistente/errado (posible, no visto).
2. **Buscar Candidatos** no devolvió nada **o tuvo error de query** (sí ha pasado).
3. **Relevancia** rechazó todos los candidatos (raro; si pasó, fue el Agente).
   (Armar Candidatos NO rechaza: solo filtra filas sin `producto_id`.)

## Diseño: Switch sobre `motivoVacio` en la rama False

```
¿Hay Algo Que Decir? [False] → Switch(motivoVacio)
  ├─ busqueda_vacia ......... retry SELECTOR con feedback  (1 intento + contador)
  ├─ busqueda_error ......... LOG bot.errores + BUSCAR FALLBACK (query simple)
  ├─ agente_no_eligio  ┐
  │  idx_invalidos     ├───── retry RELEVANCIA + bajar UMBRAL (1 intento + contador)
  │  salida_ilegible   │      (candidatos ya en mano, no re-buscar)
  │  confianza_baja    ┘
  └─ (default / retry vacío)  Label Escalación   (como hoy)
```

Contador de intentos en el sobre, mismo patrón que los loops existentes
(`¿Re-auditar?` / `¿Reintentar?`): 1 reintento por causa, después escala.

### Rama `busqueda_vacia` → retry Selector (opción A, decidida)
Causas 1 y 2a dan el mismo `motivoVacio` y no se distinguen desde el dato. Se
re-entra al **Agente Selector con feedback** ("tu búsqueda de «X» no trajo nada,
reinterpretá o ensanchá"), porque puede *reinterpretar* (causa 1) Y *ensanchar*
(causa 2a) en un solo intento. Es el patrón que ya usa `Prompt Reintento`.
Re-corre la resolución: Selector → Extraer Palabras → Buscar Candidatos →
Armar → Relevancia → Calcular Montos → ¿Hay Algo Que Decir? de nuevo.

### Rama `busqueda_error` → log + fallback determinístico (opción i, decidida)
Reintentar la MISMA query que ya falló casi nunca ayuda (bug de query o base
caída, no transitorio). En cambio:

1. **LOG obligatorio** en `bot.errores` (workflow_nombre, nodo_fallido='Buscar
   Candidatos', mensaje, execution_id, execution_url, modo). Un fallo en un nodo
   SQL crítico —y `Buscar Candidatos` ya rompió antes— tiene que quedar
   registrado, no perderse.
2. **Buscar Candidatos (fallback)** — un 2º nodo Postgres con query SIMPLE que
   **esquiva la lógica IDF** (que es la que probablemente tiene el bug). Sin LLM,
   determinística. Produce filas → re-entran a Armar Candidatos → Relevancia →
   Calcular Montos (pipeline normal). Si ESTE también falla (base caída) → mail.

**Detalle crítico de la query fallback (Martin, 2026-08-06):** NO pasar el string
con todas las palabras juntas a un solo `ilike`. `ilike '%a b c%'` solo matchea
esa frase literal y en orden — los `%` son las puntas, no rellenan huecos. Hay
que **partir en palabras y matchear cada una**:
- Tokenizar el término de búsqueda (las `palabras` que arma Extraer Palabras).
- Por cada token: `translate(lower(nombre_canonico), acentos) ilike '%'||token||'%'`
  OR contra sinónimos (mismo accent-folding que `explorar_catalogo`).
- Combinar con **OR** (cualquier token matchea = candidato): red más ancha, que
  es lo que se quiere en el último recurso. Rankear por **cantidad de tokens que
  matchean** (proxy de relevancia sin IDF), `order by matches desc`, `limit N`.
- Devolver las MISMAS columnas que `Buscar Candidatos` (producto_id, variante,
  precio_lista, rangos_cantidad, atributos, etc.) para que Armar/Calcular no
  noten la diferencia.

### Rama `agente_no_eligio / idx_invalidos / salida_ilegible / confianza_baja`
Los candidatos EXISTÍAN (Buscar trajo filas) pero Relevancia/el corte los
descartó. No re-buscar. Re-entrar al **Agente Relevancia** con un nudge
(su prompt ya dice "elegí siempre que puedas") y **bajar el UMBRAL** de confianza
de Calcular Montos (0.4 → más bajo) para el 2º intento. 1 intento + contador.

## Invariante (no romper)
Cualquier rama alternativa produce **candidatos** (filas del catálogo), nunca una
respuesta redactada con precios. Los montos los sigue calculando Calcular Montos
determinísticamente. El fallback de `busqueda_error` es determinístico (query),
no un LLM — refuerza la invariante en vez de tensarla.

## Build order (por partes, Martin re-importa)
1. **`Buscar Candidatos (fallback)`** (nodo Postgres nuevo, query per-word) —
   aislado, testeable solo. + nodo log `bot.errores`.
2. **Switch `motivoVacio`** en la rama False + rama `busqueda_error` (log +
   fallback + re-entrada a Armar Candidatos).
3. **Rama `busqueda_vacia`** → retry Selector con feedback + contador.
4. **Rama `confianza_baja` & cía** → retry Relevancia + UMBRAL + contador.
5. Guarda de contador (evitar loops) + rama default → Label Escalación.

## Abierto / a decidir en build
- Valor del UMBRAL relajado del 2º intento (0.4 → ¿0.25?).
- `limit N` de la query fallback.
- Umbral de token corto/stopword en la tokenización de la fallback.
- Si el contador vive en un campo del sobre o en una tabla (los loops actuales
  usan el sobre — replicar).
