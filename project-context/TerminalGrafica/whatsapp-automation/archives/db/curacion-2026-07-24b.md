# Curación 2026-07-24b — registro

Pasada acotada a 3 cambios ya decididos por Martin (respuestas del 2026-07-24 al lote de
preguntas). Insumo: `db/export-actualizado-catalogo.json` (commiteado, sin re-export).
SQL: `db/curacion-2026-07-24b.sql`. Martin aplica; el asistente no toca la DB.

## Cambios

| # | Producto (rubro) | Cambio | Razón |
|---|---|---|---|
| 1a | Papel Vegetal a4 x 10 unid (Libreria) | `oculto=true` | Está en $0 sin reglas; TG: "si están así, ocultalos" (pregunta 8). |
| 1b | Papel Vegetal a3/ Oficio x 10 unid (Libreria) | `oculto=true` | Ídem 1a. |
| 2 | Promoción Inmobiliarias (Cartelería plástico corrugado) | `por_pack=false` + display "Promoción para inmobiliarias (cartel de 1 × 0,65 m, llevando 6)" | El $15.000 es POR CARTEL, no por el pack de 6 (pregunta 35). |
| 3a | Anillado Plastico a4/oficio 24 hs (Taller, visible) | sinónimos → `espiralar/espiralado`; casos neutrales | "El anillado es anillado y ya, nada de prometer tiempo" (pregunta 38). |
| 3b-d | Anillado 48/72/96 hs (Taller, ocultos) | ídem 3a (se conservan `oculto=true`) | Insurance: aunque `oculto` los excluya del matching, así ninguna consulta con plazo resuelve. |

## Verificación (scratchpad `verify-curacion.js`, semántica real de Get Precio)

- "papel vegetal a4 / a3 / velina / papel calco" → **RESUELVE a "Vegetal"** ($1000/$2000).
  Antes quedaba **ambiguo** entre el "Vegetal" vivo y los x10 $0 → ocultarlos DESAMBIGUA
  (efecto lateral bueno, no buscado).
- "anillado" → AMBIGUO(3) → menú (metálico / plástico a3 / plástico a4-oficio).
- "espiralar" / "espiralado" → siguen resolviendo (se conservan).
- "anillado urgente / express / 2 dias / semana / sin apuro" → **sin_match** (deseado),
  incluso en el worst-case de que `oculto` no excluyera del matching.

## Pendiente / a revisar

- **Display de la promo — CONFIRMADO (Martin 2026-07-24):** la promo exige llevar 6 para
  que cada cartel quede a $15.000 → "(llevando 6)" es correcto, no se toca. Notas para el
  **cotizador** (no curación): (a) el "cartel suelto" 1×0,65 a $19.500 SÍ está cargado,
  como producto "Impresión exterior / montado sobre plástico corrugado" (mismo rubro),
  pero con variantes `mostrable=false` → el bot NO lo cotiza, deriva; (b) el precio de
  promo tiene **mínimo 6**: para <6 no aplica → regla de cantidad-condicional para cuando
  se toque el motor de pack. Interin honesto: la promo muestra "$15.000 por cartel
  (llevando 6)" y cualquier pedido de cartel suelto deriva.
- **Colapso del anillado plástico a3 vs a4/oficio:** "anillado" muestra 3 opciones porque
  hay dos plásticos (a3 y a4/oficio). Colapsarlos a "plástico vs metálico" (pregunta 45)
  es lógica de menú, NO curación → queda como diseño aparte.
- **Vinilo brillo (mostrar opciones):** también es comportamiento de menú, no esta pasada.

## Runbook (Martin)

1. Aplicar `db/curacion-2026-07-24b.sql` en el SQL editor del Supabase de testing.
2. Revisar los NOTICE: cualquier `SKIPPED` = el producto se renombró en el sistema del
   mostrador → re-exportar y regenerar esa fila.
3. `GET /webhook/refrescar-catalogo` (purga el cache del workflow).
4. Replay de 3 mensajes reales: "papel vegetal a4" (→ Vegetal $1000), "anillado urgente"
   (→ ya no fuerza el de 24 hs), "cuánto sale la promo de inmobiliarias" (→ $15.000 por
   cartel, no por 6).
