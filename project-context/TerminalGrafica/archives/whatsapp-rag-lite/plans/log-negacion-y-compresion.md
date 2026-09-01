# Plan — Bot WhatsApp RAG-lite (TerminalGrafica): loguear demanda no servida + comprimir respuestas

> Regla AIOS: al aprobar, MOVER este plan a
> `project-context/TerminalGrafica/whatsapp-rag-lite/plans/log-negacion-y-compresion.md` y commitear
> antes de ejecutar.

## Context

Martin pidió dos cosas sobre el bot RAG-lite (bot principal, dev descartable, sin prod):

1. **Loguear cuando el bot niega / no puede ofrecer un producto que el cliente pidió.** Hoy NO existe
   ninguna señal de esto. El diseño incluso PROHÍBE negar: ante un producto que no encuentra, el bot
   deriva a mail ("eso lo confirmo por mail"); la única negación legítima es "fotocopias". Perdemos una
   señal de curación valiosa: qué demanda le llega al bot que no puede servir. Decisión de Martin
   (alcance): registrar **todo lo no servido** — los tres casos (no encontrado, derivado a mail,
   no-trabajado).
2. **Reducir al máximo las respuestas.** Ya hay tope de 200 chars, pero no fuerza la compresión que
   Martin quiere. Su ejemplo: "Sí, hacemos. Tenemos una promoción para inmobiliarias (cartel de 1 x
   0,65 m, llevando 6) que sale $15.000 por unidad. ¿Te sirve esta opción o necesitás consultar algo
   más?" → "Sí, hacemos. Tenemos promo para inmobiliarias: cartel 1 x 0,65 m, llevando 6 a $15.000 c/u.
   ¿Te sirve?". Además (aclaración de Martin): el cierre a veces **no va**, y cuando va tiene que sonar
   a un **empleado real, no a IA** — nada de "¿Vas con esa?".

Fuente de verdad única del workflow: `scripts/build-flow.mjs` (`pnpm flow:build` regenera los 2 JSON;
no se editan a mano). Schema en `db/schema-bot.sql` (lo aplica Martin). Sin nodos nuevos → los conteos
30/62 quedan iguales.

---

## CAMBIO 1 — Loguear demanda no servida

### (a) Campo nuevo en `esquemaSalida` (build-flow.mjs, después de `precios_solicitados`, ~línea 353)
**Va en `required`** (con default `[]` por instrucción): Gemini flash-lite omite arrays opcionales
seguido → sub-reporte silencioso. Requerido + "si no hay, mandá []" fuerza la declaración explícita.
Enum colapsado a **2 motivos** (evita el split aleatorio no_encontrado/confirmar_por_mail, que en la
política real del bot son el mismo evento observable).

```js
pedidos_no_resueltos: {
  type: "array",
  description:
    "un item por CADA pedido concreto del cliente que NO pudiste ofrecer desde el catálogo " +
    "en este turno; [] si no hubo ninguno. NO cambia tu mensaje al cliente: registro interno de curación.",
  items: {
    type: "object",
    required: ["pedido", "motivo"],
    properties: {
      pedido: { type: "string", description: "lo que pidió el cliente, EN SUS PALABRAS (no el nombre de catálogo)" },
      motivo: {
        type: "string",
        enum: ["sin_match", "no_trabajado"],
        description:
          "sin_match = buscaste y no había nada del catálogo para ofrecer (lo derivaste a mail); no_trabajado = está en la lista de no-trabajado (fotocopias)",
      },
    },
  },
},
```
Y agregar `"pedidos_no_resueltos"` al array `required` de `esquemaSalida` (~línea 286).

Los 2 motivos calzan con las salidas que el diseño ya permite (derivar a mail por no-match; fotocopias):
**no se habilita ninguna negación nueva**.

### (b) Instrucción en `const sistema` (bullet nuevo al final de "## Salida estructurada", ~línea 260)
```
- pedidos_no_resueltos: por CADA pedido concreto del cliente que NO pudiste ofrecer desde el catálogo,
  agregá una entrada (pedido en las palabras del cliente + motivo); si no hubo ninguno, mandá [].
  Dos casos: buscaste y no había nada del catálogo para ofrecer (lo derivaste a mail) → sin_match;
  el cliente nombró algo de la lista de no-trabajado (fotocopias) → no_trabajado. NO registres acá un
  producto que SÍ ofreciste aunque el precio/total se cierre por mail, ni las repreguntas (falta_info):
  ahí todavía no fallaste. ESTO NO CAMBIA tu mensaje: seguí sin negar nada fuera de la lista. Es sólo
  el registro interno de lo que quedó sin servir.
```

### (c) Threading + síntesis determinista de `no_trabajado` (nodo "Insertar Precios", ~líneas 540-547)
Agregar la clave `denegados`. **NO se blanquea al corregir** (a diferencia de productos/precios) — la
negación es una decisión sobre lo que pidió el cliente, independiente de la edición de precios.
`aud = pr.auditoria` ya trae el campo (verificado: `Aplicar Corrección` y `Fallback Corrector` pasan
`lv.auditoria` intacta, líneas 1156-1161/1183-1188).

**Backstop determinista para `no_trabajado`** (hallazgo Fable #5): el caso más valioso —el agente ofrece
fotocopias por error y el Verificador lo caza— deja `pedidos_no_resueltos` VACÍO (el agente creyó que lo
sirvió). Como el Verificador SÍ lo detecta como falla, sintetizamos la entrada desde ahí y la mergeamos
(dedup por motivo). Antes de armar `_decision`:

```js
"// Backstop: si el Verificador cazó no_trabajado, el agente NO lo auto-declaró (creyó que lo servía).",
"const declar = Array.isArray(aud.pedidos_no_resueltos) ? aud.pedidos_no_resueltos.slice() : [];",
"const fallas = ((pr.verificacion || {}).fallas) || [];",
"const yaNT = declar.some((d) => d && d.motivo === 'no_trabajado');",
"if (!yaNT && Array.isArray(fallas) && fallas.some((f) => f && f.tipo === 'no_trabajado')) {",
"  const chat = String(($('Cuando llega un mensaje').first().json || {}).chatInput || '').slice(0, 120);",
"  declar.push({ pedido: chat, motivo: 'no_trabajado', origen: 'verificador' });",
"}",
```
Y en `_decision`: `"  denegados: declar,   // NO se blanquea al corregir",`

No hay sync con `lib/catalog/price-display.ts` (ese archivo sólo replica la inyección de precios).

### (d) Destino: columna nueva `denied_products jsonb` en bot.log
Columna dedicada, no foldear (products se blanquea al corregir; signals es entrega; verification es
veredicto). Señal de curación → se va a agrupar/contar → merece columna consultable.

- **schema-bot.sql** — `bot.log` está en `create table IF NOT EXISTS` (línea 199): re-correr el archivo
  sobre la base existente es **no-op → la columna nunca aparece** (hallazgo Fable #3). Dos piezas:
  1. Agregar la columna en el `create table bot.log` (antes de `execution_id`, ~línea 212), para una base limpia:
     ```sql
     denied_products  jsonb not null default '[]',   -- demanda no servida: pedidos que el bot no pudo ofrecer
     ```
  2. Y un `alter` idempotente FUERA del create (para bases ya creadas), dentro del `begin/commit`:
     ```sql
     alter table bot.log add column if not exists denied_products jsonb not null default '[]';
     ```
  Grants y RLS sin cambios: `grant insert, update on bot.log to bot_runtime` (línea 258) es a nivel
  tabla y cubre columnas nuevas.
- **INSERT del nodo "Log Decisión"** (~líneas 795-800) — appendear `denied_products` **AL FINAL**, después
  de `execution_id` (NO antes: si el JSON cae en la posición de execution_id, castea sin error y `Log
  Turno` deja de matchear por execution_id → log mudo, el bug de julio — Fable #1). Query literal final:
  ```
  insert into bot.log (session_id, customer_message, bot_message, resolution_level, state, products, prices, verification, execution_id, denied_products)
  values ($1, $2, $3, 'llm', $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::jsonb)
  ```
  y en el queryReplacement `JSON.stringify(d.denegados || [])` como **ÚLTIMO** elemento del array (después
  de `String($execution.id || '')`). Como el chat de test interno SÓLO tiene Log Decisión, el destino
  DEBE ir en este INSERT para que **ambos flows** lo capturen.
- **"Log Turno"** (UPDATE Chatwoot, ~líneas 1582-1586) NO se toca: no incluye esa columna → el valor
  insertado persiste. **"Leer Decisiones"** (SELECT de memoria) tampoco: lista columnas explícitas.

### Queries de auditoría (auditoria-rag-lite.sql, comentadas como el resto)
Dos: la señal y un CONTROL de sub-reporte (Fable #7 — una señal que sub-reporta en silencio es peor que
no tenerla; casi toda la señal cruda ya está en columnas existentes, así que la medimos).
```sql
-- Cx. DEMANDA NO SERVIDA — qué pidieron los clientes que el bot no pudo ofrecer (señal de curación).
--     Un pedido que aparece hoy y se resuelve mañana igual cuenta: es curación de sinónimos, no ruido.
-- select d->>'motivo' as motivo, lower(d->>'pedido') as pedido,
--        count(*) as veces, count(distinct session_id) as clientes, max(created_at) as ultima_vez
-- from bot.log, jsonb_array_elements(denied_products) d
-- where created_at > now() - interval '7 days'
-- group by motivo, lower(d->>'pedido') order by veces desc, ultima_vez desc;

-- Cx+1. CONTROL DE SUB-REPORTE — turnos que HUELEN a derivación a mail sin nada ofrecido pero con
--       denied_products vacío. Si esto es alto, el campo del LLM está sub-reportando (revisar prompt).
-- select count(*) as sospechosos
-- from bot.log
-- where created_at > now() - interval '7 days' and resolution_level = 'llm'
--   and products = '[]'::jsonb and denied_products = '[]'::jsonb and bot_message ilike '%mail%';
```

---

## CAMBIO 2 — Comprimir respuestas: bajar el largo OBJETIVO a ~100 chars

El eje NO es recortar la pregunta final: es **reducir el largo de las respuestas lo más posible**.
Hoy hay un tope duro de 200 chars, pero eso NO empuja a escribir corto — una respuesta de 190 chars lo
cumple. El cambio central es fijar un **objetivo de ~100 chars** (la mitad): el bot escribe la respuesta
más corta que transmita la decisión, y 200 queda solo como techo que casi nunca se toca. La coletilla es
UNA de varias tácticas de compresión, no el punto.

Ediciones de prompt en `const sistema` (+ una opcional en el Corrector). No toca placeholders `{Pn}`,
anclaje por afirmación ni listas para opciones.

### Edit 0 — bajar el largo objetivo (regla LARGO MÁXIMO, ~línea 192)
Reescribir el bullet para separar OBJETIVO de TECHO:
```
- LARGO: apuntá a ~100 CARACTERES. Escribí la respuesta más corta que igual transmita la decisión —
  como MÁXIMO ~200 (tope duro), pero eso es el techo, no la meta: si te sale en 190, sobra la mitad.
  La ÚNICA excepción es cuando estás LISTANDO OPCIONES (una por renglón): ahí la lista puede pasarse,
  pero el texto que la rodea igual va corto. Decí lo justo: sin preámbulos, sin repetir lo que el
  cliente dijo, sin explicaciones de más. Cordial y humano, pero al grano — corto no es seco.
```

### Edit 1 — bullet de compresión ("## Cómo escribir para WhatsApp", después del LARGO, ~línea 196)
Enseña CÓMO llegar a ~100: qué conservar y qué cortar. Incluye el ejemplo de Martin textual como
few-shot, rotulado "es la FORMA, no un molde de contenido" para no chocar con el "NO un molde fijo".
```
- COMPRIMÍ AGRESIVO. Antes de mandar, releé y sacá toda palabra que no ayude a decidir. Cuando respondés
  UNA sola opción (si listás varias, vale la regla de LISTAS de abajo): dejá SOLO las piezas que el
  cliente necesita, en este orden: sí lo hacen → producto/promo → medida/cantidad → precio, y si hace
  falta un cierre, UNA sola pregunta corta. Cortá preámbulos, muletillas y la mitad redundante del cierre.
  Formas naturales de WhatsApp: "promo" (no "promoción"), "c/u" (no "por unidad"). Para meter una
  especificación usá DOS PUNTOS, no paréntesis. El objetivo es ~100 chars; la versión "después" de abajo
  tiene ~110 y ya dice todo. Ejemplo (es la FORMA de escribir, NO un molde de contenido; esa promo solo
  existe si buscar_catalogo la devuelve, y el precio va como {P1}, nunca tipeado):
  antes (~155 chars): "Sí, hacemos. Tenemos una promoción para inmobiliarias (cartel de 1 x 0,65 m, llevando 6) que sale {P1} por unidad. ¿Te sirve esta opción o necesitás consultar algo más?"
  después (~110 chars): "Sí, hacemos. Tenemos promo para inmobiliarias: cartel 1 x 0,65 m, llevando 6 a {P1} c/u. ¿Te sirve?"
```

### Edit 2 — cierre humano y opcional (regla "NO CIERRES", ~líneas 220-227)
Ajuste clave según Martin: el cierre **puede no ir** cuando el mensaje ya se explica solo; y cuando va,
tiene que sonar a **empleado real, no a IA**. Reemplazar el "ofrecé seguir ayudando, pero VARIÁ la
frase" (que hoy MANDA un cierre) por:
```
- NO ASUMAS que la charla terminó, pero tampoco fuerces un cierre. Si el mensaje ya se explica solo,
  terminá ahí — no agregues una pregunta de relleno. Si sumás un cierre, que sea UNA sola pregunta
  corta y natural, como la escribiría un empleado del local: "¿te sirve?", "¿lo vemos?", "¿te paso
  algo más?". NADA de coletillas dobles ("¿te sirve esta opción o necesitás consultar algo más?" →
  "¿te sirve?") ni de cierres que suenan a bot/venta forzada ("¿vas con esa?", "¿te tiento con
  alguna?"). Variá la frase, no repitas siempre la misma. EXCEPCIÓN: si el turno es una REPREGUNTA
  (etapa falta_info), el mensaje termina en la pregunta de los ejes, sin ninguna coletilla de cierre.
```
Conservar la derivación a mail sólo si el cliente pide avanzar, y la regla de no pedir archivos.

### Edit 3 (opcional) — Corrector (~línea 459)
"Castellano rioplatense, 2 a 5 líneas" → "Castellano rioplatense, corto (1 a 3 líneas; una lista de
opciones puede exceder), sin inflar el cierre". El inciso de la lista evita que el Corrector borre
opciones de una respuesta legítima con varios renglones (y deje `{Pn}` huérfanos → "a confirmar por
mail"). Bajo riesgo.

---

## Verificación
1. `pnpm flow:build` sin errores; el reporte de nodos sigue diciendo **30** y **62** (no se agregan/quitan nodos).
2. `pnpm test` + `pnpm exec tsc --noEmit` verdes (no se toca TS; `price-display.ts` sin cambios).
3. Precondición: Martin aplica el `alter table ... add column if not exists` (el re-correr el .sql entero
   es no-op sobre la columna). Confirmar con `select denied_products from bot.log limit 1` ANTES de
   probar el chat: si la columna no existe, el INSERT de 9 params falla en cada turno → log mudo.
4. Manual en el chat de test interno (faq-bot-rag-lite.json), mirando `bot.log`:
   - Pedir algo fuera de catálogo → deriva a mail SIN negar; `denied_products=[{motivo:"sin_match"}]`.
   - "fotocopias" → `motivo:"no_trabajado"` (declarado o sintetizado desde el Verificador).
   - Forzar que el agente OFREZCA fotocopias (Verificador lo corrige) → `denied_products` trae la entrada
     `no_trabajado` con `origen:"verificador"` aunque el agente no la auto-declaró.
   - Respuesta informativa típica (una opción) → apunta a ~100 chars (no 190); compresión aplicada
     (dos puntos, "promo"/"c/u", sin preámbulos, CTA de una sola pregunta). Comparar largo antes/después.
   - Respuesta autoexplicativa → sin pregunta de cierre forzada; y ningún cierre tipo "¿vas con esa?".
   - Turno corregido por el Verificador → `products`/`prices` blanqueados pero `denied_products` PERSISTE.
   - Correr la query de CONTROL de sub-reporte: debería dar bajo.
5. Martin re-importa los 2 flows en n8n y re-cablea los 2 sub-nodos Embeddings (igual que handoffs previos).

## Nota (pre-existente, NO se arregla acá)
Los turnos de solo-negación tienen `products=[]`, y `Leer Decisiones` filtra `jsonb_array_length(products)
> 0` → esos turnos no entran a la memoria del bot. Puede re-derivar el mismo pedido a mail turno tras
turno sin recordar que ya lo hizo. Queda anotado para un follow-up (no es parte de este cambio).

## Archivos tocados
- `scripts/build-flow.mjs` — `esquemaSalida`, `const sistema`, `insertarPreciosCode` (_decision), nodo "Log Decisión", (opc.) `sistemaCorrector`.
- `db/schema-bot.sql` — columna `denied_products` en `bot.log`.
- `db/auditoria-rag-lite.sql` — query de demanda no servida.
- Regenerados: `n8n/flows/faq-bot-rag-lite.json` (30) y `faq-bot-rag-lite-chatwoot.json` (62).
