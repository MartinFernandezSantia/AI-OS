# Revisión nodo-por-nodo v10-live — foco PSQL (2026-08-05)

> Revisión pedida por Martin antes de modificar el workflow. Método: cada nodo PSQL
> validado input → query → output contra el schema autoritativo. **Claude no ve la base
> ni las ejecuciones** — los ítems marcados "CONFIRMAR EN BASE" necesitan que Martin corra
> el select indicado. Los Code complejos van por Fable (pasada aparte, en curso).

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

### 🟡 H5 — asimetría de normalización ü/ç entre JS y SQL (latente, bajo riesgo)
`Extraer Palabras` folda `ü→u` (y á é í ó ú ñ); el `translate()` de `Buscar Candidatos` sobre el
lado catálogo sólo cubre `áéíóúñ`. Un nombre de catálogo con `ü`/`ç` se partiría en el
`regexp_replace [^a-z0-9]+` y no matchearía el token ya foldeado del cliente. Con el catálogo
actual (imprenta, sin esos glifos) no muerde, pero es la clase exacta de bug que el propio nodo
documenta. Fix trivial: agregar `ü→u` (y `ç→c`) al `translate` del SQL.

### 🟡 H6 — `final` se escribe igual en un envío fallido (menor)
`Chequear Envio` marca el fallo vía `accion` y `senales.envioFallido`, pero NO limpia `final`: en
una fila de envío fallido (si H1 se arregla y la fila entra) `final` sigue con el texto que no se
entregó. El comentario del nodo dice "final NO se escribe como respuesta enviada" pero el código no
lo anula. Una consulta ingenua `select final` mostraría texto no entregado. La delivered-ness sólo
vive en `accion`/`senales`. Decidir si se anula `final` o se deja (documentado).

## Contratos validados OK (sin hallazgo)
- Extraer Palabras → Buscar Candidatos: `palabras/ventana/cupo` = $1/$2/$3. ✓
- Buscar Candidatos: las 16 columnas de `v.*` + 5 de taxonomia existen en la vista E0. ✓
- Firewall Tier-1 / Strike Tier-2: aridad y tipos de las funciones cuadran (text,text,bigint[,text]). ✓
- Log Escalación: `accion='handoff'`, `nivel_resolucion='ninguno'` — ambos válidos. ✓

## Pendiente
- Pasada Fable sobre Code complejos: `decidir`, `calcular-montos`, `armar-candidatos`,
  `extraer-palabras` (input → procesamiento → output, foco en la frontera con los PSQL).
- Correr `node tests/code-harness.js` como red tras cualquier cambio.
