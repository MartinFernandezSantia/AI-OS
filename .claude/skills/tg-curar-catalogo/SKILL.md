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
- Vos preparás el SQL; **Martin lo aplica** y hace TOGGLE del workflow (cache).
  Deny list vigente: nada de psql/supabase CLI/.env.

## Principios de curación (en orden de prioridad)

1. **No inventar datos.** El display solo puede reordenar, completar gramaticalmente o
   clarificar información que YA está en la fila (nombre vivo, variante, color, unidad,
   categoría). Si un nombre AFIRMA algo que nadie confirmó, o falta un dato para
   nombrar bien, NO lo horneés en el display: display neutro + pregunta al negocio.
   Caso canónico: módulos de medicina — la única variante dice "Impresion a4 s/f color"
   pero nadie confirmó que sea el único formato (pregunta 34 de `preguntas-tg.md`).
2. **No perder calificadores que desambiguan.** El incidente I2 (75 gr ↔ 106 gr) nació
   de nombres casi idénticos. Nunca "limpiar" un nombre hasta que colisione con otro.
   Gramaje, tamaño, material y acabado se quedan si distinguen productos hermanos.
3. **Gramática de cara al cliente.** El criterio: el display tiene que leer bien dentro
   de la frase «Tenemos {display} a ${precio}». Nada de copy/paste del nombre interno.
   Ejemplo: `Promocion Inmobiliarias 6 carteles 1 x 0.65 mt` → `Promoción para
   inmobiliarias: 6 carteles de 1 × 0,65 m`. Acentos correctos, preposiciones,
   unidades bien escritas. Español rioplatense neutro, sin diminutivos.
4. **Preguntas al negocio en vez de suposiciones.** Toda duda real (¿qué formato?, ¿el
   precio es por pack?, ¿estos dos productos son lo mismo?) va a `preguntas-tg.md`
   (única fuente; numeración continua; sección 2 catálogo o 6 cotizador según pegue).
   Mientras tanto el display queda neutro o el producto se oculta si es basura.

## Proceso

1. **Cargar y mapear.** Leé el export completo. Armá el estado por rubro: nombre vivo,
   display actual, variantes, flags, precio/mostrable (para saber qué marca lleva).
2. **Proponer por rubro, en tandas.** Para cada producto: display propuesto, displays
   de variantes, sinónimos a agregar/sacar, flags (`por_pagina`/`por_pack`), candidatos
   a ocultar (duplicados tipo "Sobre Ingles" ×2, filas basura), y las dudas → preguntas.
   Presentale a Martin una tabla por rubro: actual → propuesto → motivo (una línea).
   Marcá aparte lo que NO proponés cambiar y por qué no. **Nada queda aprobado sin OK
   explícito de Martin por tanda**; acepta ediciones puntuales sobre tu propuesta.
3. **Verificar colisiones ANTES de generar el SQL.** Escribí un script throwaway
   (scratchpad) que replique la resolución de Get Precio sobre el catálogo CON tus
   cambios aplicados:
   - normalización: `lower(trim(x))` + `áéíóúñ→aeioun`;
   - rank 1: match exacto de nombre efectivo o sinónimo;
   - rank 2: contains (≥4 chars) y subset de palabras.
   Cada display/sinónimo nuevo se prueba como si fuera un mensaje del cliente: si
   resuelve a OTRO producto, o dos productos quedan a distancia de un token, es
   colisión → ajustar antes de mostrar la tanda final.
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
