# Revisión nodo-por-nodo v10-live — foco PSQL (2026-08-05)

## ✅ APLICADO 2026-08-05 (rama docs/vps-setup-guide, editando n8n/v10/nodes/*)
Cambios agrupados y aplicados uno por uno (Martin re-importa cada nodo y re-exporta el monolito):
- **Rate limit** `c_cap 10→15` en `db/firewall-tier1.sql` (aplica Martin).
- **G1 · injection `\y`** (DE-A2): `nuevo rol`/`ignor..rol` ya no matchean "rollo"/"control". Nodos: `Decidir`. SQL: `db/injection-boundary-2026-08-05.sql` (update filas cargadas) + seed corregido.
- **G2 · guards de datos**: parseo jsonb-como-string (AC-2) en `Armar Candidatos`; guard `elegidos:[null]` en `Calcular Montos`.
- **G3 · escalera sin cantidad** (CM-1/AC-1): precio de 1 unidad (menor minQty = techo) + `faltaCantidad` → compositor informa Y pregunta. Nodos: `Calcular Montos`, `Armar Candidatos`. No toca CM-2 (diferido) ni lista de precios.
- **G4 · H2**: mapeo `topicalAlignment→offtopic` en `Router Fail Tier-2` (el log Tier-2 topical rebotaba mudo). Base intacta.
- **G5 · B-12**: quitado `usoTodosLosHechos` del schema de `Agente Compositor` (campo muerto).
- **AC-3/B-5 opción (a)**: `busquedaError` en `Armar Candidatos` → `motivoVacio='busqueda_error'` en `Calcular Montos` (distingue caída de SQL de no-match; se loguea en `Log Escalación.notas`).
- **H1 (listo, aplica Martin)**: `db/enum-envio-fallido-2026-08-05.sql`.

**Nodos únicos a re-importar:** `Decidir`, `Armar Candidatos`, `Calcular Montos`, `Router Fail Tier-2`, `Agente Compositor`.
**SQL a correr:** `injection-boundary-2026-08-05.sql`, `enum-envio-fallido-2026-08-05.sql`, `firewall-tier1.sql` (c_cap=15).
**Diferido/abierto:** CM-2 (cantidad fuera de escalera, preguntas-tg #79), B-20 Fase 2 (sesión propia), B-21 (Selector unit-aware), CM-5 (regex decimal, acoplado a B-21), B-26 (dashboard curación).

---

> Revisión pedida por Martin antes de modificar el workflow. Método: cada nodo PSQL
> validado input → query → output contra el schema autoritativo. **Claude no ve la base
> ni las ejecuciones** — los ítems marcados "CONFIRMAR EN BASE" necesitan que Martin corra
> el select indicado. Los Code complejos van por Fable (pasada aparte, en curso).

## Reconciliación con el backlog del walkthrough (`plans/backlog-walkthrough.md`)
El walkthrough previo (B-1..B-19) recorrió las **Secciones 7-10** (Buscar/Selector/Relevancia/
Extraer/Compositor/Verificador/log). Esta revisión cubrió además las **Secciones 1-6** que aquél no
había tocado (Webhook/Firewall/Debounce/Decidir/Guardrails). Reparto:
- **Ya en el backlog** (no re-abrir, referir al B-item): **AC-3 = B-5** (error SQL vs no-match; fix
  ya decidido en B-9, retry antes de escalar) · **EP-1 = B-2** (cap de 12 tokens; dirección de Martin
  2026-08-04 ya anotada) · **CM-3 ≈ B-13** (crash sin marcar en el log) · **H1/H2 = instancias
  concretas de B-18** (rebote de Log mudo, estructural) · **H3 ≈ B-19** (escalación desde info_negocio).
- **Nuevos** (Secciones 1-6, el walkthrough no había llegado): **DE-A1** (cap muerto ms/seg), **DE-A2**
  (falsos positivos de injection), **DE-M1** (historial truncado), **H4** (§2i firewall), **H5** (ü/ç),
  **AC-2** (jsonb string), **CM-4/CM-5**. Más el *qué* concreto de H1/H2 (los valores de enum que faltan).

## CONFIRMADO EN BASE (Martin, 2026-08-05)
- ✅ **Schema E0 vivo:** `bot.variantes` tiene las 18 columnas de E0 (atributos, familias, por_pack,
  por_pagina, precio_actualizado, rangos_cantidad, mostrable, tiene_override, n_reglas_cantidad,
  solo_descuentos, tiene_reglas, variante_origen, etc.). Todas las que Buscar Candidatos usa existen.
  Buscar Candidatos validado contra la base real.
- ✅ **H3 RESUELTO:** `bot.info_negocio` existe con **12 filas** (= el seed). La rama info NO está
  inerte. (Menor: verificar con TG si la fila `factura` ya tiene valor real, no bloquea.)
- ⏳ **H1/H2 pendiente:** el `unnest(enum_range(bot.accion))` volvió como `count` en vez de la lista;
  re-correr `select unnest(enum_range(null::bot.accion))::text as valor order by 1;` para ver los nombres.

## Schema autoritativo usado
- Enum `bot.accion` = **5 originales** (`informo_precio`, `informo_capacidad`, `repregunto`,
  `handoff`, `fallback_error`) — `supabase/migrations/20260629182322_bot_catalog_access.sql:29`
  — **más** los agregados por `db/enum-accion-2026-07-28.sql`: `noop` + 10 `firewall_*`
  (`firewall_drop_blocklist/silenciado/rate`, `firewall_silence_rate`, `firewall_refusal`,
  `firewall_strike_max`, `firewall_tier2_strike_max/jailbreak/offtopic/abuso`).
- Enum `bot.nivel_resolucion` = `n1_sql`, `n2_llm`, `ninguno`, `firewall`.
- Vistas `bot.variantes` / `bot.taxonomia` = **definición E0** (`db/curacion-e0-2026-07-26.sql:97-223`),
  la última que las recrea. Expone en variantes: `variante_id, producto_id, variante,
  variante_origen, color, unidad, precio_lista, precio_actualizado, por_pagina, por_pack,
  familias, atributos, tiene_reglas, solo_descuentos, tiene_override, n_reglas_cantidad,
  rangos_cantidad, mostrable`. En taxonomia: `producto_id, nombre_canonico, categoria,
  categoria_padre, sinonimos, casos_de_uso, familias, atributos`.

## Los 6 nodos PSQL (v10-live tiene 6 postgres, NO 8 — el grep contaba de más)

| nodo | operación | contrato | veredicto |
|---|---|---|---|
| Buscar Candidatos | executeQuery, 3 params | `[palabras,ventana,cupo]` de Extraer Palabras → $1/$2/$3 | ✅ columnas y params cuadran con E0 |
| Datos Info | executeQuery, 0 params | `select clave,valor from bot.info_negocio` | ⚠️ CONFIRMAR: ¿tabla creada? |
| Firewall Tier-1 | `firewall_check($1,$2,$3)` | `[sid,content,conv.id]` → (text,text,bigint) | ✅ contrato / ⚠️ bug §2i ruteo |
| Strike Tier-2 | `firewall_strike($1,$2,$3,$4)` | `[senderKey,userMessage,convId,reason]` | ✅ contrato / 🔴 bug enum abajo |
| Log Turno | insert (map de columnas) | 12 columnas a bot.decisiones | 🔴 bug enum abajo |
| Log Escalación | insert (map de columnas) | accion='handoff', nivel='ninguno' | ✅ valores válidos |

## Hallazgos

### 🔴 H1 — `envio_fallido` no existe en el enum `bot.accion` → Log Turno pierde la fila justo cuando falla la entrega
`Chequear Envio` (v10-live:1791 / `nodes/chequear-envio.json`) hace
`accion: entregado ? env.accion : 'envio_fallido'`. `Log Turno` mapea ese valor a la columna
`bot.decisiones.accion` (enum NOT NULL). **`envio_fallido` NO está en el enum** (ni en la
migración original ni en `enum-accion-2026-07-28.sql`). Con `onError:continueRegularOutput`,
el INSERT rebota **en silencio**: en el turno donde Chatwoot no entregó (el caso exacto que
este nodo se construyó para registrar, incidente 2026-07-29) **no se escribe ninguna fila**.
La telemetría de fallo de envío se pierde precisamente cuando importa.
- Los tests dan verde falso: `validate-v10-agents.js:725` y `test-v10-relevancia.js:910` sólo
  chequean que el STRING `envio_fallido` aparezca / que el JS lo produzca — **no** que el enum
  lo acepte. [[tests-fixtures-mienten]] otra vez.
- **Fix (Martin aplica):** `alter type bot.accion add value if not exists 'envio_fallido';`
  (más `nivel_resolucion`? no hace falta: Log Turno escribe `n2_llm`, que es válido).
- **CONFIRMAR EN BASE:** `select unnest(enum_range(null::bot.accion))::text order by 1;`

### 🔴 H2 — `firewall_tier2_topicalAlignment` no existe en el enum → refusal topical de Tier-2 no loguea
`Router Fail Tier-2` (`nodes/router-fail-tier-2.json`) emite `reason = violated[0].name`, que
para el guard topical es **`topicalAlignment`** (confirmado en `guardrails-tier-2.json`).
`firewall_strike` (`db/firewall-tier2-strike.sql:75`) escribe vía `fw_log` el accion
`'firewall_tier2_' || p_reason` = `firewall_tier2_topicalAlignment`. El enum sólo tiene
`firewall_tier2_offtopic`. `fw_log` (`firewall-tier1.sql:86-88`) envuelve el INSERT en
`exception when others then null` → el error de enum se traga → **sin fila**. Sólo afecta al
refusal topical por DEBAJO de strike-max (en strike-max escribe `firewall_tier2_strike_max`,
que sí está). `jailbreak` sí cuadra (`firewall_tier2_jailbreak` está en el enum).
- Es la instancia concreta de la deuda §h del handoff (enum de cardinalidad abierta).
- **Fix (elegir uno):** o `alter type ... add value 'firewall_tier2_topicalAlignment'`, o mapear
  en Router Fail Tier-2 `topicalAlignment → offtopic` antes de pasar el reason. La 2ª opción cierra
  la cardinalidad abierta y reusa el valor que el autor del enum ya había previsto.
- Nota: `firewall_tier2_abuso` está en el enum pero ningún guard emite `abuso` (valor muerto, inocuo).

### ⚠️ H3 — Datos Info depende de `bot.info_negocio`, que puede no estar creada
Handoff §3k: la tabla nunca se creó en la base (fix preparado en `db/info-negocio.sql`, seed real
del 2026-08-03 salvo la fila `factura`='COMPLETAR'). Si no se aplicó, `select clave,valor` devuelve
vacío → rama info inerte → todo "¿a qué hora abren?" se va a mail. La query en sí cuadra con la
tabla (columnas `clave`,`valor`). **CONFIRMAR EN BASE:** `select count(*) from bot.info_negocio;`
(y aplicar `info-negocio.sql` si da error/0).

### ⚠️ H4 — bug §2i de ruteo (ya backlogueado, sigue presente en v10-live)
`firewall_check` devuelve `action='silence'` en DOS casos: `rate` (línea 162) y `strike-max`
(línea 197). `Switch Firewall` rutea sólo por `action` → ambos caen en `Aviso Rate Firewall`: el
atacante de strike-max recibe "frená, mucho volumen". Confirmado presente. Fix mínimo ya escrito
en handoff §2i (que strike-max devuelva `'drop'`). No aplicado por freeze de entrega.

### ~~H5 — asimetría ü/ç~~ — DESCARTADO (Martin 2026-08-05)
Descartado: nunca va a haber un producto con `ü`/`ç` en el catálogo de la imprenta. No se acciona.

### ~~H6 — `final` en envío fallido~~ — IGNORADO (Martin 2026-08-05)
Ignorado por decisión de Martin. No se acciona.

## Contratos validados OK (sin hallazgo)
- Extraer Palabras → Buscar Candidatos: `palabras/ventana/cupo` = $1/$2/$3. ✓
- Buscar Candidatos: las 16 columnas de `v.*` + 5 de taxonomia existen en la vista E0. ✓
- Firewall Tier-1 / Strike Tier-2: aridad y tipos de las funciones cuadran (text,text,bigint[,text]). ✓
- Log Escalación: `accion='handoff'`, `nivel_resolucion='ninguno'` — ambos válidos. ✓

## Pasada Fable — Code complejos (4 nodos, cada uno ejecutado con casos reales)

Cada agente Fable ejecutó el jsCode aislado con harness en scratchpad. Reproducibles en
`/tmp/.../scratchpad/` (run-decidir.js, harness-montos.js, run-armar.js, etc.).

### Decidir (`nodes/decidir.json`)
- **A1 🔴 el cap de 25 respuestas/24h es CÓDIGO MUERTO (ms vs segundos).** `nowMs=Date.now()` en
  ms; Chatwoot manda `created_at` en **segundos** (confirmado en `tests/chatwoot-mock.js:60-62`).
  `nowMs - num(created_at) < 86400000` nunca es true → `botOut24` siempre vacío → las ramas `cap`
  y `cap-ya-avisado` **no se alcanzan jamás**. El bot no tiene tope real de respuestas. Igual en
  v10-live y v9 → está en prod. Agravante: `Get Historial` no pagina (última página ~20 msgs), así
  que ni arreglando unidades el conteo llegaría a 25. Ningún test lo cubre.
- **A2 🔴 falsos positivos de injection con vocabulario de imprenta.** `"nuevo rollo de vinilo"` →
  `/nuevo rol/i` (sin `\b`, "rollo"⊃"rol"); `"...ME DAN 100 TARJETAS"` → `/\bDAN\b/`;
  `"me ignoraron el control de calidad"` → `/ignor[aá].*rol/i` (cont**rol**). El cliente recibe el
  mensaje anti-injection en vez de su cotización. (FN triviales pasan, pero de eso se ocupan T1/T2.)
- **M1 ⚠️** `avisoDado` / cap / `lastBotReplies` se calculan sobre la última página truncada del
  historial → en conversación larga el bot repite el mail (familia del bug "mail dos veces" 07-29).
- B1-B4 🟡: consumidores nuevos en ramas cortas leerían `userMessage` undefined en silencio;
  fragilidades de `created_at` ISO / empates de segundo / ventana de 6 recortada antes de filtrar.
  Crash por `body.conversation.id` inalcanzable hoy (lo tapa `Filtro Ingreso`).

### Calcular Montos (`nodes/calcular-montos.json`)  — los bugs de PLATA
- **🔴 ALTA sub-cotización: el "desde" nunca se escribe.** Escalera continua ($480/$300/$150) sin
  cantidad → `monto=Math.min(values)` y `texto` sale **"$150 por hoja"** plano. El campo `desde`
  viaja aparte y ni el `promptAgente` ni el `texto` lo nombran; el compositor copia `texto` verbatim.
  El tramo más barato (51-250 u) presentado como EL precio → para 5 unidades lo real es $480:
  **sub-cotiza 3,2×**. (Mismo origen que el $0 de Armar Candidatos, visto río abajo.)
- **🔴 ALTA cantidad fuera de escalera: cotiza el tramo 1 y lo totaliza.** cantidad=25 con tramos
  1-3/4-10/11-20 → ningún `find` matchea → `monto` queda en `precio_lista` (tramo 1) y como `>0` el
  fallback de escalón inferior no corre → con `multiplica` sale "TOTAL $200.000 por 25 unidades"
  cuando a ≥11 pagan menos (~$162.500): **sobre-cotiza 1,23×** con formato autoritativo.
- **⚠️ MEDIA crash con `elegidos:[null]`** → `TypeError` mata el turno **sin log** (familia B-13).
- **⚠️ MEDIA `cantidad` sin normalizar:** `"1.000"` (es-AR) → `Number(...)`=1 → cotiza tramo 1.
- **⚠️ MEDIA una sola `seleccion.cantidad` multiplica TODOS los hechos** ("100 tarjetas y 500
  volantes" → un total con la cantidad equivocada).
- **⚠️ CM-5 (subida de sev, Martin 2026-08-05): totales DECIMALES rompen el guard de `Leer
  Verificador`.** `/\$\s?[\d.]+/` corta en la coma → falsa ALERTA de monto inventado, tumba el mensaje
  correcto. NO hace falta un precio con centavos: un precio entero × una cantidad continua da total
  decimal ($150 × 1,45 m = $217,50). **Acoplado a B-21 / unidades continuas:** el día que la cotización
  por metro/m² funcione, este regex hay que arreglarlo en la misma tanda o rechaza totales válidos.
- 🟡 caveats contradictorios; lista-de-precios con `multiplica=true` dispara cap falso; lona m² sigue
  yendo a mail (UV no cubre).
- Contrato con consumidores OK salvo el crash. `rangos_cantidad` llega como **array** (Array.isArray
  anda) — pero ver el punto siguiente.

### Armar Candidatos (`nodes/armar-candidatos.json`) — frontera con el PSQL
- **🔴 ALTA `precio_lista=0` con escalera se presenta como `precio: $0` y sin línea de rangos** → el
  Agente Relevancia ve "$0" y puede descartar/desrankear el candidato correcto (las rifas). `fmt(0)`
  = `'$0'` porque solo filtra `n==null`. Si Relevancia lo descarta, Calcular Montos nunca lo ve.
- **⚠️ MEDIA jsonb como string degrada TODO en silencio.** El código asume jsonb ya parseado
  (`(r.atributos||{}).unidad_venta`, `Array.isArray(r.rangos_cantidad)`). Si el nodo Postgres lo
  devuelve como string (depende de versión/config), `atributos`→`unidad_venta` undefined→ todo a
  caveat "se confirma por mail", y `rangos_cantidad`→null → en un `por_pagina` **reintroduce el
  confident-wrong 1,7×** por forma del dato, no por lógica. No hay guard `typeof==='string'?JSON.parse`.
  (Hoy Calcular Montos lo ve como array, pero nada lo garantiza si cambia la config.)
- **⚠️ MEDIA error SQL indistinguible de búsqueda vacía** — el item de error de `Buscar Candidatos`
  (`onError:continueRegularOutput`) lo come el `filter(r&&r.producto_id)` → `motivoVacio='busqueda_vacia'`
  miente si la base falló. Clase B-18.
- 🟡 `"tambien hay packs de "` colgante (length check antes del filter); `es_default`/`orden`/
  `ejes_variantes` (el fix del 07-27) se descartan del candidato — el default sobrevive solo como
  posición 1; dos variantes de nombre vacío salen ambas como "única".

### Extraer Palabras (`nodes/extraer-palabras.json`)
- **Veredicto ü/ç (H5): asimetría REAL en mecanismo, LATENTE en el catálogo.** Grepeó nombres +
  sinónimos: **cero ü/ç hoy** (la única ü es "ambigüedad" en un comentario). Se activa si una
  curación futura agrega p.ej. "tarjetas bilingües". Mismo riesgo con acento **descompuesto (NFD)**
  en un nombre de catálogo. Fix barato: `üç→uc` al translate del lado buscable en buscar-candidatos.
- **⚠️ MEDIA el cap de 12 tokens SÍ pierde tokens del cliente en la rama `opciones`** (4 nombres
  largos del LLM llenan los 12 → `kraft`/`anilladas` del cliente quedan afuera — justo la info nueva).
- 🟡 el comentario "los gramajes se conservan" es falso a medias (`"80 gr"`→ se pierde todo;
  `"80gr"` no matchea `"75 gr"` separado del catálogo); whitelist `a[0-5]` excluye `a6`.
- Corrió `tests/validate-sql-busqueda.js` con `WF=faq-bot-v10-live.json` → **0 errores**.

## Temas transversales (donde conviene atacar)
1. **Plata / escalera de cantidad** (lo más caro): Calcular Montos ALTA×2 + el `$0` de Armar
   Candidatos son el mismo cluster — el piso/`$0` de una escalera se presenta como precio plano.
   Es exactamente el confident-wrong que el proyecto persigue. **Prioridad 1.**
2. **Logs silenciosos / telemetría perdida:** H1 (envio_fallido), H2 (tier2 topical), Armar #error-SQL,
   Decidir A1 (cap muerto). Todos por `onError`/`exception when others`/unidades. **Prioridad 2.**
3. **Fragilidad jsonb-as-string:** Armar #2 — un guard de parseo cierra un modo de falla 1,7×.
4. **Falsos positivos de injection** (Decidir A2) — cortan cotizaciones reales de imprenta.
5. **Historial truncado** (Decidir M1 + A1) — `Get Historial` sin paginar contamina cap y avisoDado.

## Cola de fixes sugerida (Martin decide y aplica; contraste adversarial antes de cada uno)
1. `alter type bot.accion add value 'envio_fallido'` + resolver H2 (mapear `topicalAlignment→offtopic`
   en Router Fail Tier-2, cierra la cardinalidad abierta). — barato, alto valor de telemetría.
2. Escalera sin cantidad → **decisión Martin 2026-08-05** (ver decisions/log.md): dar el precio
   **por 1 unidad** (tramo 1, techo por unidad → imposible sub-cotizar), avisar "según cantidad", y
   **preguntar la cantidad**. La respuesta informa + pregunta. Aplica a Calcular Montos (el `texto`) y
   a Armar Candidatos (en vez de `$0`, el precio de 1 unidad). — cierra el cluster de plata.
   Principio general nuevo: una respuesta puede ser informativa Y llevar la pregunta que falta al final.
3. Cantidad fuera de escalera (CM-2) → **DIFERIDO**: se deja como está hasta que TG decida
   (pregunta 79 en preguntas-tg.md, ejemplo Imanes). Opciones: caer al último tramo aplicable, o
   confirmar por mail para cantidades sobre el tope.
4. Guard `elegidos:[null]` + guard `typeof jsonb==='string'?JSON.parse` en Armar Candidatos.
   **APROBADO Martin 2026-08-05** (riesgo casi cero; seguro contra la mudanza al KVM 4).
5. Injection A2 → `\b` en los patrones y whitelist de vocab de imprenta (rollo, control, dan).
   **APROBADO Martin 2026-08-05** (red atrás: Tier-1/Tier-2 hacen su propia detección).
   ⚠️ **REVISAR ALCANCE antes de tocar (hallazgo 2026-08-05):** los patrones ya NO viven solo en
   `Decidir` — se movieron a la tabla SQL `bot.injection_patterns` (`db/firewall-tier1.sql:44-67`). Ahí
   `\yDAN\y` ya está bounded, PERO `nuevo rol` (línea 59) e `ignor[aá].*(...|rol)` (57) siguen SIN `\y`
   → los falsos positivos ("rollo", "control") disparan desde la capa SQL también. En Postgres el
   word-boundary es `\y` (no `\b`). Y puede haber un regex duplicado y viejo en `Decidir` (Code) — hay
   que ver si sigue activo o quedó muerto tras mover los patrones. Es el "firewall disperso" del handoff
   §j: el fix toca `bot.injection_patterns` (SQL) y quizá `Decidir`. Confirmar las dos capas antes de aplicar.
6. Cap real de respuestas (DE-A1) — **DECIDIDO 2 fases** (ver decisions/log.md + B-20). **Fase 1**:
   arreglar unidades ms→seg + conteo (paginar), ventana móvil 24h, 2 contadores (mensajes + tokens).
   **Fase 2** (sesión aparte): rama LLM cada 10 respuestas → si el bot spammea/falla, disculpa al mail
   + Label/Nota Chatwoot + notificación al quote-automation-system.
7. CONFIRMAR EN BASE: enum `accion`, `bot.info_negocio`, y aplicar §2i.

## Red tras cualquier cambio
`node tests/code-harness.js` — pero OJO: `validate-v10-agents.js` busca `faq-bot-v9-test.json` (no
existe) y no corre; `test-cap-e-info.js` mockea filas. Los tests dan verde falso en varios de estos
hallazgos ([[tests-fixtures-mienten]]): confirmar cada fix con un caso que ejercite el camino real.
