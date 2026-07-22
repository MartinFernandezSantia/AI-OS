# Workflow `tg-catalogo-sync` — watchdog + curación del catálogo del bot

> Plan v1 (2026-07-22, contraste Fable ronda 5). **Diseñado, NO construido.**
> Pedido de Martin: un workflow aparte que mantenga el catálogo del bot actualizado
> contra el real de `public`, evaluando si necesita un LLM para el trabajo de
> limpieza de la sesión del catálogo limpio.

## La idea en una línea

No es un mover de datos: es un **watchdog semanal + redactor de curación**. Las
vistas ya leen `public` en vivo (precios, productos nuevos y bajas fluyen solos);
lo que driftea es la CAPA CURADA del overlay. El workflow detecta ese drift con
queries determinísticas, redacta propuestas (ahí entra el LLM, acotado), y **Martin
siempre revisa y aplica** — el workflow jamás escribe la curación.

## Qué se mantiene solo vs qué driftea

| Se mantiene solo (vistas vivas) | Driftea (capa curada) |
|---|---|
| Precios y tablas por cantidad | Producto nuevo sin sinónimos/casos (aparece pelado: honesto pero pobre) |
| Producto/variante nuevos aparecen en el catálogo | `variante_meta` huérfana o dupe resucitado (delete-recreate del motor → CASCADE silencioso) |
| Bajas desaparecen | Display curado que quedó VIEJO tras un rename del motor (el bot puede mentir sustancia, ej. 106→90 gr) |
| Renames de producto (el auto-sinónimo trackea el nombre vivo) | Hazards nuevos: un producto o sinónimo futuro que fabrique un hijack |
| | Datos sucios nuevos (variantes con nombre duplicado = próxima zona sucia clase columna-color) |
| | Inconsistencias de precio ($0 mostrable, lista ≠ primer bracket, airbag >90d) |

## Arquitectura (decisiones cerradas con Fable R5)

- **Workflow n8n separado** `tg-catalogo-sync`: Schedule Trigger semanal (lunes
  temprano) + ejecutable a mano antes de cada sesión.
- **STATELESS**: no diffea contra corridas anteriores; reporta las anomalías
  VIGENTES (hechos idempotentes: si Martin no actuó, el reporte repite las mismas
  líneas, y eso es correcto). Descartados: tabla snapshot + diff (estado sin
  ganancia) y event-driven vía webhooks de Supabase (ruido por-fila para un
  catálogo que cambia poco y batcheado).
- **Única referencia temporal necesaria: `nombre_origen`** en `producto_meta` Y
  `variante_meta` (seteado al curar). Es lo que distingue "overlay intencional" de
  "quedó viejo tras un rename del motor" — el único caso que stateless puro no ve.
  → Columna agregada a `db/catalogo-limpio-overlay.sql` (aún sin aplicar: cero
  ciclos extra de migración).
- **Permisos**: 1-2 vistas nuevas `bot.sync_reporte_*` con grant a `bot_readonly`.
  Cero grants directos sobre `public`; la cred del workflow no puede escribir la
  curación ni comprometida.
- **Salida: email a Martin vía Brevo, SIEMPRE** (Fable rechazó el silencio-en-vacío):
  - `[TG sync] OK — sin anomalías` (cuerpo de una línea), o
  - `[TG sync] N anomalías` (el reporte).
  Si un lunes NO llega mail, ESO es la alerta (cubre workflow apagado, Brevo en
  spam y VM muerta — casos donde el error workflow también está muerto porque vive
  en la misma caja). Gate conocido: deliverability de Brevo (SPF pendiente).

## L1 — Detección determinística (sin LLM): 9 checks

Los asserts de la migración del catálogo limpio, en modo REPORTE, más lo aprendido:

1. **Sin curar**: productos visibles sin fila meta, o sin sinónimos ni display.
2. **Reconciliación `variante_meta`**: display == nombre vivo (fila redundante →
   borrar), huérfanas, count esperado vs real (la resurrección del dupe se ve acá).
3. **Renames post-curación**: nombre vivo ≠ `nombre_origen` en cualquiera de las
   dos metas → el display curado puede estar mintiendo; revisar.
4. **Scan de hazards** sobre el espacio efectivo completo: colisiones exactas +
   substring + **word-subset normalizado** (ver filtro abajo). La lista legacy que
   hoy es NOTICE de migración pasa a sección fija del reporte.
5. **Rubros mono-producto hoja** cuyo header no resuelve a su producto.
6. **Variantes con nombre visible duplicado** dentro de un producto (la firma de la
   próxima zona sucia).
7. **Rangos malformados** en variantes con regla de cantidad (>6 brackets, value≤0,
   minQty<1): hoy se descubre cuando un cliente pisa `fallback: rangos_invalidos`;
   el watchdog lo ve antes.
8. **Rubros nuevos** post-curación (jerga nueva entrando al catálogo sin revisión).
9. **Conteos de `bot.decisiones`, últimos 7 días** (en v1, NO en L4 — Fable):
   counts por acción y por estado de la rama precio (`fallback: ambiguo` subiendo =
   dupe resucitado o zona sucia nueva; `sin_match` subiendo = gap de sinónimos).
   Los NÚMEROS van en v1; la interpretación semántica es L4.

## L2 — LLM: SÍ, pero solo como REDACTOR (la respuesta a la consulta de Martin)

**Veredicto: el workflow SÍ lleva LLM, acotado a redactar propuestas de sinónimos y
casos de uso para productos nuevos sin curar. Nunca decide, nunca aplica.**

La lección de la sesión: los hijacks que podamos hoy los generó un LLM (el seed
Haiku) SIN filtro ni revisión. La conclusión no es "no LLM" — es **"LLM propone,
el filtro determinístico y Martin disponen"**:

1. **Redactor** (flash-lite o su sucesor, misma cred OpenRouter): dado nombre +
   rubro + ejemplos del estilo del seed + **la lista de términos vetados / espacio
   efectivo actual** (para auto-evitar antes del filtro), propone 3-6 sinónimos +
   2-4 casos de uso rioplatenses. Regla del prompt: nombra-producto → sinónimo;
   intención → caso de uso.
2. **Filtro determinístico anti-hazard** sobre la salida (la enforcement real):
   - equality y substring vs espacio efectivo (como los asserts);
   - **test de word-subset con normalización singular/plural** (tokenizar, strip
     de 's' final, flag si el conjunto de palabras ⊆ nombres de ≥2 productos) —
     caza 'impresion papel obra', 'sobres', 'tacos': la anatomía de R4 formalizada.
     El multi-contains contiguo solo NO alcanza (probado empíricamente en R4);
   - opcional no bloqueante: near-dup vs sinónimos de OTROS productos (word-overlap
     o pg_trgm) para la clase 'adhesivo brillo/brillante';
   - len ≥ 4, normalización translate/lower de siempre.
3. **Salida = DRAFT SQL COMENTADO** (upserts listos, con lo rechazado por el filtro
   listado aparte y por qué) dentro del reporte. Martin revisa, ajusta, aplica.

**Descartado con razones:**
- *Auto-aplicar con los asserts como gate*: los asserts cazan colisiones, NO
  semántica errada (mapear 'fotocopia' al producto equivocado pasa todos los
  asserts; solo Martin/TG lo saben).
- *Sin LLM (curar a mano)*: viable porque el catálogo cambia poco, pero regala el
  único trabajo genuinamente lingüístico, y filtrado + revisado ya demostró andar.

## L4 — Futuro (NO en v1, frontera fijada)

Minería semántica de `bot.decisiones`: clustering de `sin_match`/ambiguo/handoffs
regla 4 → candidatos de sinónimos faltantes y servicios que TG hace pero no están
(el "detector de servicios faltantes" del handoff). Ahí es donde un LLM ganaría el
pan de verdad. **Frontera v1/L4: los números en v1, la interpretación en L4.**

## Prerrequisitos y orden

1. Aplicar primero la migración del catálogo limpio (`catalogo-limpio-overlay.sql`,
   que ya incluye `nombre_origen`) + suites. El watchdog vigila ESE estado.
2. Confirmar deliverability de Brevo (SPF) — gate del canal de salida.
3. Recién entonces: sesión de build de `tg-catalogo-sync` (vistas sync_reporte +
   workflow n8n + prompt del redactor + filtro en Code node + harness de los Code
   nodes nuevos).

## Costos

~$0: semanal, queries chicas sobre vistas, LLM solo si hay productos nuevos
(pocos tokens, catálogo casi estático). El valor está en el watchdog, no en el
volumen.
