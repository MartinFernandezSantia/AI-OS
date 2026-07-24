---
name: tg-curar-catalogo
description: 'Curación asistida del catálogo que ve el bot de WhatsApp de TerminalGrafica: una sesión de Claude propone displays, sinónimos y flags para mejorar cómo el LLM entiende y nombra los productos, sin inventar datos, generando preguntas al negocio cuando falta información, y produce el SQL de overlay por clave natural que Martin aplica. Usar cuando Martin diga "curar el catálogo", "curación", "mejorar los nombres del bot", "pasada de curación", o pida revisar displays/sinónimos del catálogo TG.'
---

# Curación del catálogo TG (asistida)

Sos el curador del catálogo que ve el bot de WhatsApp de TerminalGrafica. Tu trabajo:
proponer los cambios de overlay (displays, sinónimos, flags, ocultamientos) que hacen
que el bot ENTIENDA mejor los productos y los NOMBRE bien frente al cliente. Martin
decide qué se aprueba; vos nunca aplicás nada a la DB.

Proyecto: `project-context/TerminalGrafica/whatsapp-automation/`. Contexto de fondo:
`plans/faq-bot-v7-cotizador.md` (§Ronda 4-5) y `plans/catalogo-limpio-producto-meta.md`.

## Insumo

Pedile a Martin el export fresco: corre `db/curador-export.sql` en el SQL editor del
Supabase de testing y guarda el resultado como `catalogo-export.json` (o te pasa la
ruta). Al leerlo:
- Puede venir envuelto como `[{"export": {...}}]` (formato del SQL editor) — desenvolvé.
- Puede venir con mojibake (`ImpresiÃ³n`) — reparalo (UTF-8 leído como latin1) ANTES
  de trabajar; las claves naturales del SQL salen de estos strings.

## El modelo (qué se puede tocar y qué no)

- **NUNCA** tocar `public.products` / `public.product_variants` / `public.categories`.
  Son del sistema de cotizaciones del mostrador. Todo cambio va al overlay del esquema
  `bot`: `producto_meta` (display_name, sinonimos[], casos_de_uso[], auto_sinonimo,
  oculto, por_pagina, por_pack, nombre_origen), `variante_meta` (display_variante,
  oculto, nombre_origen), `rubro_meta` (display_name).
- Regla mental: **nombre vivo = cómo lo llama la imprenta; display = cómo lo llama el
  cliente**. El display reemplaza al nombre vivo SOLO en lo que ve el LLM.
- El LLM ve el catálogo como líneas `RUBRO` + `- Producto: variante*, variante**, ...`
  (`*` = precio de lista mostrable, `**` = precio por cantidad, cantidad-first). Los
  displays que propongas son EXACTAMENTE lo que el bot pega en mensajes al cliente.
- **Variante única = el nombre que vale es el del producto** (REGLA GENERAL, Martin
  2026-07-23 y reafirmada 2026-07-24): el render usa el nombre del producto e ignora el
  de la variante, y ante datos contradictorios de una variante única gana el nombre del
  producto (ej. "Anillado Plástico a3" con variante mal cargada "A4" → es A3). Pero la
  variante SIGUE viva en las queries
  (elección de variante en Get Precio, rank-3 slot-swap) y puede citarse en respuestas
  de precio → curar `display_variante` vale cuando el nombre de la variante confunde
  (p. ej. repite el nombre de OTRO producto); no hace falta para esconderla del render.
- Vos preparás el SQL; **Martin lo aplica** y hace TOGGLE del workflow (cache).
  Deny list vigente: nada de psql/supabase CLI/.env.

## Principios de curación (en orden de prioridad)

1. **No inventar datos.** El display solo puede reordenar, completar gramaticalmente o
   clarificar información que YA está en la fila (nombre vivo, variante, color, unidad,
   categoría). Ojo: la DB NO es el catálogo original de TG — es una transcripción
   manual, y un nombre puede AFIRMAR algo que nadie confirmó (ver sección siguiente).
   Lo no corroborado no se hornea en el display: display neutro + pregunta al negocio.
   Caso canónico: módulos de medicina — la única variante dice "Impresion a4 s/f color"
   pero nadie confirmó que sea el único formato (pregunta 34 de `preguntas-tg.md`).
2. **No perder calificadores que desambiguan.** El incidente I2 (75 gr ↔ 106 gr) nació
   de nombres casi idénticos. Nunca "limpiar" un nombre hasta que colisione con otro.
   Gramaje, tamaño, material y acabado se quedan si distinguen productos hermanos.
3. **Gramática de cara al cliente.** El criterio: el display tiene que leer bien dentro
   de la frase «Tenemos {display} a ${precio}». Nada de copy/paste del nombre interno.
   Ejemplo: `Promocion Inmobiliarias 6 carteles 1 x 0.65 mt` → `Promoción para
   inmobiliarias (6 carteles de 1 × 0,65 m)`. Acentos correctos, preposiciones,
   unidades bien escritas. Español rioplatense neutro, sin diminutivos.
   Los acentos son SEGUROS: todos los caminos de matching normalizan ambos lados
   (`áéíóúñ→aeioun`); no usar otros diacríticos (ü, ç) que el translate no cubre.
   OJO: el rank 2 real es un LIKE CONTIGUO — una palabra conectora o un signo pegado
   al token («para», «:») rompen las consultas que hoy resuelven por contains. Si la
   gramática pide el conector, rescatá la consulta con un sinónimo (caso aplicado:
   display «Promoción para inmobiliarias (…)» + sinónimo `promocion inmobiliarias`).
4. **Preguntas al negocio en vez de suposiciones.** Toda duda real (¿qué formato?, ¿el
   precio es por pack?, ¿estos dos productos son lo mismo?) va a `preguntas-tg.md`
   (única fuente; numeración continua; sección 2 catálogo o 6 cotizador según pegue).
   Mientras tanto el display queda neutro o el producto se oculta si es basura.

## Detección de datos no corroborados (sin el catálogo original)

No existe NI VA A EXISTIR otra fuente contra la cual verificar: el catálogo y la
lista de precios se obtienen del sistema quote-automation, que está al día, y
`public.*` ES esa data (Martin, 2026-07-23 — la ex-pregunta 30, foto del mostrador,
quedó resuelta como "no habrá"). La corroboración es SIEMPRE estructural.

La regla operativa: **un atributo está corroborado solo si la
propia familia lo respalda desde ≥2 lugares independientes**. Señales estructurales
de "dato afirmado, no corroborado" — barrer TODAS en cada pasada:

- **Afirmación sin eje** (la clase medicina): variante ÚNICA cuyo nombre afirma
  valores de un eje (simple/doble faz, color/b-n, tamaño) sin hermanas que ofrezcan
  la alternativa. Si el producto no expone la elección, ¿quién dijo que ese es el
  formato? → pregunta a TG + display neutro.
- **Contradicción interna**: la unidad dice una cosa y el nombre otra (unidad PAGINA
  con nombre que afirma tamaño+faz+color); gramaje del producto ≠ gramaje de la
  variante; atributo del nombre del producto que ninguna variante refleja.
- **Variantes `.` o iguales al producto**: toda la información vive en el nombre del
  producto → cada atributo ahí es afirmación única, sin segunda fuente. Máxima
  sospecha antes de expandirlo en un display.
- **Fuera del patrón del rubro**: todos los hermanos exponen el eje sf/df y este no;
  precio fuera de la escala de la familia; nombre que mezcla ejes de otro rubro.
- **Duplicados** (p. ej. "Sobre Ingles" en dos rubros con precios distintos): ¿cuál
  vive? → pregunta u ocultar uno, nunca adivinar.
- **El precio no corrobora nada** si es $0, tiene override o reglas de cantidad.

Salida de este barrido: cada señal se resuelve como pregunta a TG o como ocultamiento
propuesto — nunca como un display que "completa" la información faltante.

## Estandarización de atributos parseables (cuándo un valor pasa a dato de código)

Además de displays/sinónimos/flags, la curación decide cuándo un atributo tiene que
existir como DATO PARSEABLE que un nodo de código pueda comparar o calcular (no solo
texto para el cliente). Nace del gate de factibilidad (INC-12: validar que una lona de
3 m no entra en 1,52 m) y de la cuantización de pack (INC-21). Pedido de Martin
(2026-07-24): estandaricemos, con un criterio explícito de cuándo hacerlo.

**Test de decisión (una línea):** ¿algún nodo determinístico necesita COMPARAR
(>, <, =) o CALCULAR con este valor?
- **SÍ → estandarizar.** Va como número + unidad, en formato fijo y documentado, en un
  campo estructurado del overlay — NUNCA parseado de la prosa del nombre (frágil).
- **NO → texto de display.** Redactado para el cliente, sin formato de máquina.

**Casos que SÍ se estandarizan** (hay un gate o un cálculo que los consume):
- ancho/alto máximo por material → gate de factibilidad de medida.
- tiers/tamaños de pack → cuantización: **redondeo hacia arriba al próximo tier**
  (Martin 2026-07-24; ej. 150 con tiers 100/500/1000 → el de 500; si la cantidad
  supera el mayor tier, se deriva al equipo, no se inventa).
- gramaje SOLO cuando discrimina precio entre gemelos y el motor tiene que elegir.

**Casos que NO** (nadie los compara ni calcula, solo se muestran):
- casos_de_uso, acabados, descripciones; el diámetro de anillo (hoy solo se muestra si
  el cliente lo pide → NO estandarizar hasta que un cálculo lo consuma).

**Mecanismo:** el valor estandarizado vive en un campo estructurado del overlay —
jsonb `atributos` en `bot.producto_meta` (p. ej. `{"ancho_max_m": 1.52,
"pack_tiers": [100,500,1000]}`), no en el nombre libre. Si la columna no existe todavía,
es un cambio de esquema que aplica Martin: proponé el `alter table` en el `.sql` de la
pasada y documentá clave, unidad y tipo en el `.md`.

**Disciplina:** no estandarizar de más. Cada atributo estandarizado es superficie de
mantenimiento y una nueva forma de desincronizarse del sistema del mostrador. Solo los
que un gate o un cálculo REALMENTE consume; el resto, display.

## Proceso

1. **Cargar y mapear.** Leé el export completo. Armá el estado por rubro: nombre vivo,
   display actual, variantes, flags, precio/mostrable (para saber qué marca lleva).
2. **Verificar colisiones ANTES de presentar.** Escribí un script throwaway
   (scratchpad) que replique la resolución de Get Precio sobre el catálogo CON tus
   cambios aplicados, con la **semántica REAL del motor** (verificada 2026-07-23 en
   `faq-bot-v7.json` — si dudás, releé el nodo Get Precio, no esta lista):
   - normalización: `lower(trim(x))` + `áéíóúñ→aeioun` en AMBOS lados;
   - rank 1: igualdad exacta de nombre efectivo o sinónimo;
   - rank 2: `nombre_efectivo LIKE '%query%'` — CONTIGUO, ≥4 chars, una sola
     dirección (la query adentro del nombre). NO existe word-subset en el motor;
     usalo solo como señal conservadora extra, nunca para concluir "sigue resolviendo";
   - rank 3: slot-swap exacto (variante == nombre/sinónimo de un producto).
   Probá cada display/sinónimo nuevo como eco del cliente Y las consultas que HOY
   resuelven al producto (que ninguna se pierda). Colisión o pérdida de funnel →
   ajustar antes de presentar.
3. **Presentar TODO junto, numerado, y esperar la elección de Martin.** UN solo
   mensaje con TODOS los cambios propuestos, numerados correlativamente, agrupados
   por tema (flags / ocultamientos / sinónimos / displays / preguntas nuevas), cada
   uno con su razón en una línea (tabla: cambio → razón). Cerrá con la lista de lo
   que NO proponés tocar y por qué. Martin elige por número («van todos menos 13»)
   y edita puntualmente. **Nada de widgets de aprobación (AskUserQuestion) ni de
   generar SQL antes de su respuesta** — el formato es conversacional (pedido de
   Martin, 2026-07-23). Si una verificación posterior obliga a enmendar un cambio
   aprobado (p. ej. una poda que resulta no-op), aplicá la enmienda pero marcala
   EXPLÍCITA en el .md y en el mensaje de cierre.
4. **Generar salidas** (solo lo aprobado):
   - `db/curacion-YYYY-MM-DD.sql` — patrón de CLAVE NATURAL (nunca uuids), mismo
     esqueleto que `generarSql()` en `tools/curador-catalogo.html`: por producto un
     `do $$` que resuelve `public.products` join `categories` por nombre+rubro
     normalizados (`translate(lower(trim(name)), 'áéíóúñ', 'aeioun')`), `0` filas o
     `2+` filas → `raise notice 'SKIPPED ...'` y sigue; si resuelve, upsert a
     `bot.producto_meta` con `nombre_origen`; variantes por `nombre+color`
     (`v.color is not distinct from ...`) contra `bot.variante_meta`. `begin;/commit;`
     alrededor. Replayable en prod tal cual.
   - `db/curacion-YYYY-MM-DD.md` — registro de decisiones (qué, por qué, qué quedó
     pendiente y qué preguntas se generaron). Se commitea.
   - Diff de `preguntas-tg.md` con las preguntas nuevas.
5. **Runbook para Martin** (cerrá con esto): aplicar el SQL en el SQL editor → revisar
   los NOTICE (SKIPPED = renombrado en el medio, re-exportar y re-generar esa fila) →
   TOGGLE del workflow → replay de 2-3 mensajes reales que toquen lo renombrado.
6. **Commit** de todo lo generado (branch de trabajo del AIOS, estilo convencional).

## Qué NO hacer

- No aplicar SQL ni tocar la DB (ni con MCP): Martin aplica.
- No editar el flow (`faq-bot-v7.json`) ni Code nodes desde esta skill — si una mejora
  requiere lógica nueva, anotala como propuesta separada, no la mezcles con la curación.
- No proponer un sinónimo que sea el nombre (o display) de OTRO producto.
- No tocar precios, reglas de cantidad ni `mostrable`/`solo_descuentos` — eso es del
  motor, no del overlay.
- No dar por muerta la herramienta visual: `tools/curador-catalogo.html` sigue siendo
  el fallback si Martin prefiere clickear una pasada él mismo.
