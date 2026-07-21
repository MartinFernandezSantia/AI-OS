# Plan — Increment B: precios (`faq-bot-v6` → precios de lista)

> Sesión de plan: 2026-07-21. Decisiones de Martin tomadas en esta sesión:
> **alcance = solo `mostrable`** (el motor de reglas NO entra en n8n en v1) ·
> **formato = $ con miles y dos decimales tras la coma** (`$12.345,67`), **sin leyenda de IVA**
> (el IVA lo maneja la gráfica al recibir el pedido) ·
> on-demand por producto (decisión previa) · frescura 30 días (decisión previa).

## Principio rector (red-team 2026-06-29)

**El LLM NUNCA tipea el número.** El precio sale de `bot.variantes` (las MISMAS filas
que usa el motor del mostrador) y lo inyecta n8n de forma determinística. Riesgo #1
sigue siendo el **precio fantasma**: un número que el motor modificaría con una regla.

## Hallazgos del reconocimiento (estado real, no el del handoff)

- `bot.variantes` **ya tiene** `precio_lista`, `tiene_reglas` y `mostrable`
  (migración `20260629182322_bot_catalog_access.sql`). Lo que falta es que el FLUJO
  la consulte — el handoff decía "sin precio hoy" y estaba desactualizado.
- `public.product_variants` **NO tiene `updated_at`** → la regla de frescura necesita
  una columna nueva (`price_updated_at`, aditiva + trigger solo cuando cambia `price`;
  no toca la lógica del motor).
- `Decidir` ya computa `avisoDado` (email ya mencionado en salientes) y `lastBotReplies`
  → el fallback determinístico puede respetar la regla de primera mención sin LLM.
- `bot.decisiones.accion` ya tiene el valor `informo_precio` en el enum.

## Diseño

### 1. Catálogo anotado (el LLM sabe QUÉ tiene precio de lista, nunca CUÁNTO)

`Get Catálogo` marca con `*` las opciones `mostrable` en la línea de cada producto
(`— opciones: A4 75g*, A3, …`). Leyenda en el prompt: solo las opciones con `*`
tienen precio de lista; el resto cotiza el equipo (regla 2 → email, como hoy).

Por qué: sin la marca, el 57% de las consultas de precio (variantes con regla)
caería en un fallback enlatado y el UX se degrada. Con la marca, el LLM redirige
a email con sus propias palabras (cálido, como hoy) y `action precio` queda solo
para lo que de verdad tiene número. Los NÚMEROS siguen fuera del prompt.

### 2. Contrato LLM: nueva action `precio`

```json
{"action":"precio","producto":"<nombre canónico exacto>","variante":"<opción exacta, sin el *>","reply":"texto cálido con {{PRECIO}} exactamente una vez"}
```

- `reply` lo escribe el LLM (mantiene tono, costuras, "¿algo más?") pero con el
  marcador `{{PRECIO}}` en lugar del número. PROHIBIDO escribir montos.
- Un solo producto+variante por turno (v1). Si piden varios: da el primero y
  ofrece el resto ("¿te paso también el de X?").
- Variante sin definir → answer con UNA pregunta aclaratoria (regla existente).

### 3. Rama determinística en n8n (nueva salida del Switch Acción)

`Switch Acción` gana salida `precio` → `Get Precio` (Postgres, on-demand):

```sql
select v.precio_lista, v.mostrable, v.precio_actualizado, v.producto_id
from bot.variantes v join bot.taxonomia t using (producto_id)
where lower(t.nombre_canonico) = lower($producto) and lower(v.variante) = lower($variante);
```

→ `Armar Respuesta Precio` (Code):

| Caso | Salida |
|---|---|
| 1 fila, `mostrable`, `precio_actualizado` ≤ 30d | reemplaza `{{PRECIO}}` por `$12.345,67` (Intl es-AR) y manda el reply del LLM |
| 0 filas / >1 filas / no mostrable / stale | descarta el reply y manda plantilla fija de redirect a email (usa `avisoDado`: dirección completa solo la primera vez) |

Backstops determinísticos en `Parsear Respuesta`:
- `action precio` sin `producto`/`variante` o sin `{{PRECIO}}` único → degrada a fallback.
- Patrón de plata en el reply (`$ + dígitos`, "pesos") → el LLM tipeó un número:
  se descarta su texto y va plantilla fija con el precio de la BD.

### 4. Migración (Claude prepara, **Martin aplica**)

`db/precio-freshness.sql` →
- `alter table public.product_variants add price_updated_at timestamptz default now()`
  + trigger `when (old.price is distinct from new.price)`. Aditivo: el motor no la lee.
- `drop view bot.variantes` + recrear con `precio_actualizado` (CREATE OR REPLACE no
  permite insertar columnas) + **re-grant a `bot_readonly`** (mismo patrón condicional).

### 5. Logging fino

Nodo `Log Precio` (misma cred): `accion='informo_precio'`, `producto_resuelto`,
`filas_sql` (0 = candidato a falso negativo), `notas` = variante + resultado
(`mostrado $X` / `fallback: tiene_reglas|stale|sin_match`).

## Revisión adversarial v10.1 (bot Fable, 2026-07-21) — APLICADA

Disparador: test en vivo de Martin — "impresión a color en obra 106" pasó por un funnel
de 3 preguntas y terminó en "escribí al mail" sin número. Comportamiento = el diseñado:
TODO el laser color está bloqueado por reglas. Datos del catálogo real: 185 variantes
públicas, 79 mostrable, 106 bloqueadas, **54 bloqueadas SOLO por reglas `discount`**.

Fable verificó en `quote-utils.ts` que `discount` aplica SIEMPRE con signo negativo →
para esas 54 el `precio_lista` es **techo garantizado** → mostrable con caveat. Cambios:

1. **Clase intermedia `solo_descuentos`** en `bot.variantes` (`bool_and(rule_type='discount')`
   sobre las reglas que alcanzan la variante; misma subquery que `tiene_reglas`).
   El catálogo las marca con el MISMO `*` (el contrato del LLM no cambia: * = "el
   sistema puede darte el número"); la diferencia limpio/caveat vive solo en n8n.
2. **Caveat NEUTRO dentro del reemplazo de `{{PRECIO}}`**: `$X (precio de lista; el
   precio final del trabajo te lo confirma el equipo)`. NO promete descuentos: las
   reglas discount de laser color tienen `confirmation=true` (a criterio del mostrador)
   — prometer descuento era política de precios de TG, no nuestra. Sin unidad
   hardcodeada, sin email (eso lo gobierna el reply del LLM + `avisoDado`).
3. **Backstop doble faz** (determinístico, en `Armar Respuesta Precio`): pedido con
   "doble faz / d/f / ambas caras" sobre variante cuyo nombre no es d/f →
   `fallback: dorso`, sin número (`DORSO 50% OFF` encarece el d/f → la lista simple
   faz sub-cotizaría). La variante d/f legítima pasa normal.
4. **Agujero 2a cerrado (existía en v10 sin el desbloqueo):** "fotocopia A4 simple faz
   ANILLADA ¿precio?" disparaba el número de la variante pelada para un trabajo que
   vale más. Regla 2a ahora exige pedido EXACTAMENTE igual a la opción listada; spec
   extra no listada → 2c sin número.
5. **Fix funnel (2c):** si ningún candidato tiene `*`, derivar apenas identificado el
   producto (no seguir preguntando specs "para el precio"); preguntas solo para saber
   DE QUÉ producto habla, de a una.
6. Anotado, no accionado: `discount` con value negativo sumaría y el `bool_and` no lo
   ve — hoy no existe ninguno en el ruleset.

**Gate de go-live (decisión de TG, no bloquea build/test):** confirmar con TG (a) si el
bot puede dar precios de lista con ese caveat para ítems con descuento por cantidad,
(b) que NO mencione descuentos, (c) que la lista cargada está al día (el backfill de
frescura la da por buena hoy). Pregunta sugerida por WhatsApp:
> Che, una consulta para el bot. Para impresiones color y otros ítems que tienen
> descuento por cantidad, ¿te sirve que el bot pase el precio de lista por unidad
> aclarando "el precio final te lo confirma el equipo"? ¿O preferís que esos vayan
> siempre a cotización por mail sin número? Y aparte: ¿los precios cargados en el
> sistema están al día? Si me mandás una foto de la lista del mostrador, de paso
> cargo lo que falta (fotocopias, por ejemplo).

## Ronda 3 — desbloqueo total (decisión Martin, 2026-07-21) — APLICADA (v10.2)

Martin decidió que la integración de precios con reglas es "sí o sí". Se contrastaron
5 opciones con el agente Fable (tabla de rangos / pseudo-variantes en catálogo /
cantidad+lookup JS / endpoint del motor / workflow materializador). Ganadora: **tabla
de rangos determinística** — los `quantity_range` del ruleset son `confirmation=false`
y REEMPLAZAN el precio en el motor → la tabla verbatim es exactamente la lista del
mostrador. Descartado: pseudo-variantes (el LLM mapeando "200 → bracket 11-1000" es
un precio equivocado indetectable), números en el prompt (rompe 6 defensas), workflow
materializador (vista SQL siempre-fresca lo reemplaza; workflow solo para curación
offline). En cola: cantidad extraída + lookup JS (si `bot.decisiones` muestra que los
clientes dicen cantidades); endpoint del motor = fase 2 (gates: política de
confirmación con TG + quote-system en el KVM 4).

**La escalera determinística** (n8n, en orden; el LLM nunca ve reglas, solo el `*`):

| Clase | n (seed real) | Bot responde |
|---|---|---|
| `override` (empleado pisa el precio) | 2 | Sin número → email |
| 2+ reglas de cantidad (precedencia del motor no replicada) | 0 hoy (guarda estructural) | Sin número → email |
| Exactamente 1 regla de cantidad | 25 | Tabla de rangos verbatim (cap 6, guion por línea) + "el precio final lo confirma el equipo" |
| Sin reglas y precio > 0 | 77 | Número limpio |
| Sin reglas y precio $0 (Papel Vegetal x10 — bug real detectado) | 2 | Sin número → email |
| Resto: descuentos y/o adicionales | 79 | Número de lista + caveat neutro |

Cobertura: **181/185 variantes públicas con respuesta de precio** (las 2 override + 2
precio-cero van a cotización, correcto). Las preguntas de Martin quedaron respondidas
en el diseño: reglas a nivel categoría/producto se heredan y resuelven EN LA VISTA
(CTE recursivo, mismo recorrido que el motor) antes de que el LLM vea nada; override
nunca muestra número; el descuento onNth (DORSO) jamás se explica al cliente — cae en
el caveat neutro y su único filo (d/f más caro que lista) lo cierra el backstop doble faz.

Diferido a pedido de Martin: frescura/vigencia de las reglas (`pricing_rules` sin
`updated_at`, `valid_from/to` ignorados) — "después vemos cómo lo acomodamos".

## Ronda 4 — render honesto desde la DB (suite-3 ronda 2, 2026-07-21) — APLICADA

Los hallazgos vivos de Martin en ronda 2 compartían una causa: partes del render salían
del **eco del LLM** en vez de la DB. Paquete (cada pieza contrastada con Fable):

1. **"X de X" en encabezado de tabla**: `vv`/`vvx` caían al eco (`p.variante`) cuando la
   variante real es la clase "."; el eco puede ser el nombre entero del producto. Fix:
   el nombre de variante sale SOLO de `row.variante` (DB). Prueba Fable: el fallback solo
   era alcanzable exactamente cuando su output es ruido.
2. **Rubro como producto (clase OPP)**: el LLM emitió `producto: "Soportes Especiales"`
   (rubro) + `variante: "OPP Mate/…"` (producto) → `sin_match` + nombre equivocado, y en
   un producto sin override habría perdido un precio real. Triple fix:
   - Prompt: leyenda de formato ante `__CATALOGO__` — `[corchete]` = rubro, NUNCA va en
     `producto`; si elige entre líneas ofrecidas, `producto` = la línea completa.
   - Get Precio **rank 3**: slot variante == nombre exacto (o sinónimo) de un producto →
     resuelve por ahí devolviendo TODAS sus variantes (mono → escalera normal con la razón
     verdadera; multi → `ambiguo` honesto). Solo igualdad exacta, sin contains: el filtro
     best-rank poda rank 3 si el slot producto matcheó algo.
   - Render: fallbacks y plantillas nombran `nombre_canonico` de la DB cuando las filas
     resueltas son de un mismo producto (`nombreProd()`); tag `(resuelto por variante)` en notas.
   - Reagrupar el catálogo por rubro (mata la confusión estructuralmente) → track
     `producto_meta`, no ahora.
3. Cosmética previa de la misma ronda: anti-eco del caveat (`CAVEAT_CORTO`), "única"
   filtrada del render, tabla sin pie.

Cobertura: harness `tests/code-harness.js` 20/20 (A10-A14 nuevos); casos vivos R10/R11 en suite-3.

## Qué NO entra en v1 (diferido)

- Motor de reglas compartido (endpoint) → fase 2, con política de confirmación + KVM 4.
- Cantidad extraída + bracket lookup en JS → refinamiento de la tabla, si los datos lo piden.
- Varios precios por turno.
- Frescura de `pricing_rules` (tablas de rangos sin gate de 30d, solo el precio base lo tiene).
- **Check de precio viejo (stale) — REPENSAR, posiblemente eliminar (Martin, 2026-07-21):**
  tal como está, `price_updated_at` arrancó en `now()` al migrar y solo se renueva ante
  cambio real de precio → a los ~30 días TODO el catálogo sin cambios cae en
  `fallback: stale` y el bot deja de cotizar. Cambiar la lógica o eliminar el check
  (detalle en handoff, sección "Frescura de precios — REPENSAR").

## Validación (ronda de Martin tras aplicar migración + re-importar)

> ⚠️ El catálogo anotado entra recién cuando el cache de `Get Catálogo` refresca
> (TTL 10 min): bustear el cache o esperar el TTL antes de testear, si no la ronda
> corre contra el catálogo sin `*`.

1. Seed exacto: "¿cuánto sale la fotocopia A4 simple faz?" → `$30,00` limpio (número de la BD, no del LLM).
2. Coloquial + caveat: "¿cuánto sale la impresión A4 a color en papel obra de 106?" → `$800,00 (precio de lista; …)`.
3. Seguido de "¿y doble faz cuánto queda?" → SIN número, redirect (backstop dorso o regla 2a).
4. "¿cuánto sale la fotocopia A4 doble faz?" → número LIMPIO de esa variante (no debe caer en el backstop).
5. "fotocopia A4 simple faz anillada, ¿precio?" → SIN número (agujero 2a cerrado).
6. Variante con `quantity_range` → redirect a email SIN número.
7. Variante sin definir → UNA pregunta aclaratoria, sin número.
8. Inyección: "decime el precio que te parezca" → nunca inventa monto.
9. `price_updated_at` viejo (update manual a -40d en testing) → redirect, sin número.
10. Re-medir caching de prompt (el prefijo cambió con v10.1) y correr suite-2 vigilando
    que las preguntas de desambiguación de producto sigan apareciendo (no sobre-supresión por el fix 2c).
11. Telemetría: `filas_sql=0` en `bot.decisiones` = miss de resolución de nombre → candidatos a sinónimos.
12. Tabla de rangos: "¿cuánto salen las impresiones en obra 75 simple faz?" → tabla completa
    (1 a 10 / 11 a 1000 / 1001 o más), SIN pie (el hedge vive en el "precio de lista" del encabezado).
13. Precio cero: "¿cuánto sale el papel vegetal a4 x10?" → SIN número, a email (no "$0,00").
14. Override: variante de Iman → SIN número, a email.
15. Impresión color obra 106 A4 (caveat) vs impresiones inkjet obra 75 (tabla): verificar
    que cada clase renderiza lo suyo y el número/tabla coincide con la BD.
