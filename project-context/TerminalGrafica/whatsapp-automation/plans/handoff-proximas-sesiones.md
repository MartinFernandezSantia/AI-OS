# Handoff — Bot WhatsApp Terminal Gráfica (`faq-bot-v8`)

> **Qué es este archivo:** el estado vivo y el próximo paso. Todo lo que ya está cerrado vive en
> los planes de `plans/` y en el log histórico de la memoria `chatwoot-whatsapp-impl-status`; acá
> sólo queda lo que todavía decide algo. Si una sesión termina y esto no cambió, el archivo miente.
> **Última actualización: 2026-07-27** (aplicación de E0+v8.1 y los 5 fixes que salieron de los
> primeros mensajes reales).

**Reglas de trabajo que no cambian:**
rol A (informador acotado, no configurador) · mundo cerrado (lo no listado no existe para el bot)
· **Claude prepara migraciones, Martin las aplica** — Claude no toca la base · nunca `public.*`
(es el mostrador de TG; el bot vive en el overlay `bot.*`) · **el LLM nunca tipea un monto** ·
resolución **por clave natural**, jamás por uuid, con `raise notice` + skip · el bot corre en la
VM de dev con el número de test, **no es prod de TG** · commits en rama, nunca a `main` de
`projects/` · toda decisión de diseño pasa por una **pasada adversarial antes** de aplicarla
(ver §6) · tras tocar un nodo Code: `node tests/code-harness.js`, siempre.

---

## 1. Estado ahora — lo único que hay que leer para arrancar

**El paquete E0 + v8.1 está APLICADO.** El bot corre sobre el motor nuevo. Pero la ronda quedó a
medias: los primeros mensajes reales encontraron 5 bugs, ya arreglados, y **el workflow que Martin
tiene importado es anterior a esos arreglos.**

| pieza | estado |
|---|---|
| `db/curacion-e0-2026-07-26.sql` | ✅ **aplicado** (con el fix del `not null`). Devolvió **133** variantes de 139 esperadas |
| `db/curacion-voz-2026-07-26.sql` | ⚠️ **sin confirmar** — Martin dijo "apliqué el SQL", en singular. Verificar antes de la ronda: si no está, el mensaje 12 ("me hacen fotocopias?") falla por diseño |
| `n8n/flows/faq-bot-v8.json` | ⚠️ importado, pero **5 commits atrás**. Hay que re-importar |
| Error workflow (`tg-bot-error`) | ⚠️ sin confirmar. Es el único paso manual del runbook y sin él una ejecución que muere no avisa a nadie |
| `GET /webhook/refrescar-catalogo` | ⚠️ sin confirmar |
| La ronda de 16 mensajes | 🔄 empezada; ver §2 |

### Los 4 pasos antes de seguir

1. **Re-importar `n8n/flows/faq-bot-v8.json`** (68 nodos; las credenciales viajan con su id real,
   no hay configuración manual). Trae: JSON tolerante a basura, el diccionario del gate corregido,
   la unidad en la frase del monto, la regla 4c del gate y el aviso de canal.
2. Si no está: **`db/curacion-voz-2026-07-26.sql`**. Leer los NOTICES — cada uno dice
   `OK: <producto> -> N sinonimos` o `SKIPPED`. **Un SKIPPED significa que TG renombró algo.**
3. **Workflow Settings → Error Workflow → `tg-bot-error`.**
4. **`GET /webhook/refrescar-catalogo`** en la URL de **producción** (en ejecución manual el
   `staticData` no persiste y el purgado no queda).

### La ronda: 16 mensajes en 3 tandas

Los mensajes están en [`v8-build.md`](./v8-build.md) §5 (1-10) y
[`v8-1-build.md`](./v8-1-build.md) §6 (11-16). Correrlos en este orden y traer el texto **tal cual
llegó a WhatsApp**, no un resumen:

- **Tanda A — plata** (si fallan, cuestan dinero): 1 doble faz obra 75 · 2 anillado 120 hojas ·
  3 anillar 3 apuntes · 4 cartel suelto vs promo · 5 promo con 3 carteles · 6 "500 rifas" ·
  16 papel ilustración para 500 folletos.
  > Ojo con el 1: el esperado es **$8.800** (100 hojas × $88 de bracket). El $17.600 que decía el
  > runbook era el número **viejo** — 200 × $88, la cuenta por página que este paquete elimina.
- **Tanda B — resolución**: 7 papel vegetal a3 · 8 papel kraft a4 (tiene que **preguntar** el
  gramaje) · 11 lona 3x2 (no puede aparecer `Talonarios Rifas`) · 12 "me hacen fotocopias?" ·
  15 repetir 3 veces un pedido imposible (a la tercera **deriva a mail**: era el anti-loop muerto).
- **Tanda C — voz**: 9 "cuánto sale anillar" (3 opciones en prosa, **sin** números) · 10 que suene
  a persona · 13 la puerta de color aparece · 14 la puerta **no** aparece si ya ancló el color.

### Las 2 consultas de después

Están completas en [`v8-1-build.md`](./v8-1-build.md) §6.7. En una línea:

- **Confident-wrong**, determinística y sin juez LLM: las cotizaciones con número donde el cliente
  no ancló nada y **había con qué confundirse** (`senales->'descartados'` no vacío).
- **Salud del compositor**: distribución de veredictos. Si los rechazos pasan ~30%, apagá el kill
  switch (`const COMPOSITOR = false;` en la primera línea de `Armar Prompt Compositor`, se edita en
  la UI sin re-importar) y traé los veredictos: cada uno dice qué regla se violó, y
  `nombre_ajeno:<token>` dice además qué palabra lo disparó.

**Rollback:** re-importar `faq-bot-v7.json`. El SQL no necesita rollback (v7 ignora las columnas
nuevas). Rollback parcial más barato: el kill switch del compositor — motor nuevo, voz vieja.

---

## 2. Lo que ya encontró la ronda parcial (2026-07-27)

Cinco bugs, uno por mensaje, todos arreglados y commiteados. **Tabla completa con causa raíz en
[`v8-1-build.md`](./v8-1-build.md) §8.** El resumen que importa para la próxima:

| # | síntoma | commit |
|---|---|---|
| 1 | E0 murió en la primera variante (`display_variante` not null) | `2ffe24a` |
| 2 | El gate rechazaba **todo** mensaje en español ("en" era token prohibido) | `00b8a05` |
| 3 | Paráfrasis legítimas seguían cayendo → 91 → 61 tokens | `542314c` |
| 4 | JSON con basura después del objeto tiraba el turno entero (3 nodos) | `34d06ef` |
| 5 | `$88 c/u` redactado como "por página" = mentira de unidad de 2× | `78b379d` |
| — | Voz: fuera la leyenda inline, entra el aviso de canal 1×/conversación | `b096767` |

**La lección, que vale más que los cinco fixes:** cuatro eran invisibles para el harness porque
sus mocks codificaban una premisa más limpia que la realidad — catálogo de juguete de 8 nombres,
JSON siempre válido, `c/u` como unidad universal. El harness prueba que el código hace lo que
dice. **No** prueba que la premisa sea cierta. Eso lo prueba la ronda, y por eso la ronda no se
saltea.

Verificación al cierre: **harness 170/170** · gemelo `Armar Respuesta Precio 2` en sync ·
`tests/validate-v8-import.js` 0 errores.

---

## 3. Backlog vivo — construido a medias o decidido y sin construir

**a. El default obra 75 como conducta de cotización.** Hay dos mitades y sólo entró una.
- ✅ La que **cuesta** un guard: la **puerta abierta** — cuando la fila tiene ejes que el cliente
  nunca nombró y había con qué confundirse, el bot declara el supuesto **en la misma frase del
  monto** ("…te salen $15.000. Si lo necesitás en color es otro precio, avisame."). Orden por
  plata, no alfabético: color primero (mueve 4×, $100 contra $400 la página), después faz,
  gramaje, papel, material, acabado, tamaño. **Una sola puerta por mensaje.** Sin competencia no
  hay puerta.
- ❌ La que **ahorra** un mensaje: que el bot cotice directo en obra 75 / simple faz / b/n en vez
  de listar el menú cuando el cliente no especifica. Es prompt, y merece su propia ronda de
  medición. **Falsación ya definida:** de las cotizaciones con default b/n, si más del ~15%
  contesta "en color" en el turno siguiente, el color deja de ser default y pasa a pregunta.
- Los datos ya están: `default_familia: true` en `Impresiones` y `default_variante: true` en
  `OBRA 75 GR S/F` (`bot.producto_meta` / `bot.variante_meta`, curación E0). **No los lee ningún
  nodo todavía** — `grep default` sobre el workflow da cero.
- Invariante que no se negocia: **no hay default de color, nunca.** El gramaje mueve 20%, el
  color mueve 4×. Errar el color cuesta cuatro veces más que errar el gramaje.

**b. Las 6 variantes de E0 que no resolvieron.** El segundo select devolvió 133 de 139.
`db/diag-e0-variantes.sql` (read-only) reproduce el WHERE sobre las 139 claves naturales para
identificarlas. **No bloquea**: una fila sin atributos se comporta exactamente como v7. Pero cada
una es un guard que no corre.

**c. Que la capa determinística emita hechos estructurados** en vez de un borrador tokenizado. Hoy
el compositor está atado a cómo redacta el código: el pipeline es prosa→prosa. Es el próximo
escalón de la voz, y el que haría innecesarias varias reglas del gate.

**d. v8 nunca pasó por una pasada adversarial.** La disciplina del proyecto pide contrastar toda
decisión de diseño antes de aplicarla, y en las sesiones de v8/v8.1 Claude tenía instrucción de no
lanzar agentes. Los candidatos obvios: el compositor y la salida del menú numerado.

**e. Sin cerrar de antes:** la cuantización de packs · el guard de variante no anclada.

---

## 4. Preguntas a TG que bloquean algo

Fuente única: [`../preguntas-tg.md`](../preguntas-tg.md) (incluye la tabla de "ya resuelto, no
re-preguntar"). Las que hoy frenan una decisión:

- **63 — ¿el doble faz se cobra por hoja?** *La más cara de todas.* Toda la unidad de venta se
  apoya en una inferencia: obra 75 simple faz b/n $100 contra doble faz b/n $150. Si el precio
  fuera por página, el doble faz debería costar la mitad; que sea 1,5× dice que la unidad es la
  hoja. Es sólido, pero es una inferencia, y **si está mal el bot sub-cotiza 2× en cada trabajo a
  doble faz**.
- **52** unidad de venta del resto (Ojales sin decidir) · **4** láser vs Riso · **55** promo entre
  7 y 11 carteles · **59** OPP · **60** mínimo de m² · **61** mínimo de metro lineal · **62** ancho
  máximo por material · **34** formato medicina · **37** Sobre Inglés $0.

**Avisos comerciales pendientes con TG** (no técnicos, pero vencen): el cobro de Meta por
service message desde el **1-oct-2026** (~USD 0,026 — la propuesta decía USD 0) · el handoff
asíncrono como **cambio de alcance** respecto de lo vendido · el SLA de reclamos.

---

## 5. Operación — lo que se olvida y cuesta una sesión

- **Purgar el cache del catálogo:** `GET /webhook/refrescar-catalogo`, isla de 3 nodos sin
  conexión al flujo principal, dentro del propio workflow. **Sólo la URL de producción persiste**
  (`staticData` no se guarda en ejecuciones manuales) — el botón Execute del editor no sirve.
  Reemplaza al viejo truco del toggle. En prod: cerrar el path por firewall o header secreto.
- **Las credenciales viajan en el JSON exportado** con su id real: un nodo nuevo no es trabajo
  manual de Martin. El cuello de botella es la ronda de WhatsApp, no el import.
- **El gemelo:** `Armar Respuesta Precio 2` es idéntico al original salvo dos cosas. Si tocás
  `Armar Respuesta Precio`, regenerá con `node tests/regen-arp2-twin.js --write` (o el harness lo
  caza).
- **`mostrable` NO es un flag de curación:** es `not tiene_reglas` y no lo lee ningún nodo.
  Ocultar de verdad es `oculto=true` en `variante_meta`. Y ojo: `mostrable=false` en las 4
  variantes de `OBRA 80 GR`, así que nunca implementar "variantes visibles" con ese campo.
- **Son 2-3 llamadas LLM por turno**, no 1-2 (`Guardrails Tier-2` es una llamada; el Aclarador y
  el compositor pueden sumar).
- **Marcadores en `bot.decisiones.notas`** para leer una ronda: `aclarador:
  resolver/preguntar/opciones/nada`, `(repregunta)`, `(variante rescatada: mono)`, `menu_pack`,
  `menu_unico`, `(compositor:<veredicto>)`, `(precio>90d)`.
- **`bot.decisiones.senales`** (jsonb, nuevo en E0) es la señal de confident-wrong: qué pidió el
  cliente, qué se descartó, qué ejes no dijo, si hubo puerta.
- **Catálogo de referencia:** `db/export-actualizado-catalogo.json` (2026-07-23 21:25, 88
  productos). **Está atrás de tres curaciones** (b, 1c, voz). Sirve para diagnosticar
  resoluciones, no para verificar displays.

---

## 6. Cómo se contrastan las decisiones

> **Fable está fuera desde 2026-07-27** — la cuenta llegó al 100% del límite. Lo reemplaza el
> consejo Opus, que ya usábamos para las decisiones de dirección. **La disciplina no cambia; el
> ejecutor sí.** Cuando el límite se libere, el patrón de Fable de abajo vuelve a ser la
> herramienta barata para el contraste por decisión.

**Lo que no se negocia, corra quien corra:** una decisión de diseño se contrasta **antes** de
aplicarla, y al contraste se le pide que **refute**, no que valide. Claude diagnostica y arma la
propuesta **con** sus alternativas y el descarte razonado; el contraste busca bordes, falsos
positivos y casos que la propuesta fabrica; **Claude aplica** lo que sobrevive, con caso de
harness + golden de suite + commit por tema.

**Dos tamaños, según lo que esté en juego:**

| | cuándo | forma | costo |
|---|---|---|---|
| **Pasada adversarial** | una decisión concreta dentro de una ronda de fixes | 2-3 agentes Opus en paralelo, **una lente distinta cada uno** (plata, resolución determinística, voz de mostrador), cada uno con la consigna de refutar. Diversidad de lente, no redundancia: tres refutadores idénticos encuentran lo mismo | ~50-100k tokens |
| **Consejo** | el problema no es un bug sino una **dirección** | 5-6 lentes, brief escrito, acta en `plans/consejo-*.md` | ~600k tokens |

**El consejo se paga solo por lo que encuentra fuera del encargo.** Los tres de julio trajeron,
cada uno, bugs vivos que nadie estaba buscando: el 07-26 sobre la dependencia del nombre encontró
que v8 había matado **los cuatro anti-loops** (el bot podía repreguntar indefinidamente sin
derivar nunca a mail, pagando cada vuelta) y que el gate no protegía ni el nombre ni el hedge —
12 de 19 ataques pasaban con veredicto `ok`. Ninguna de las dos cosas estaba en el brief.

**Lo que el contraste enmendó cuando existía** (evidencia, para no aflojar la disciplina cuando
apure el tiempo): el rank 3 devolviendo todas las variantes en vez de `sin_match`, el gap
"dirección de correo" en la cascada de primera mención **antes** de que apareciera en un test, el
rechazo de cantidad-first sin marcador (trampa de UX: preguntar e ignorar), el sobre-disparo del
ancla libro, el lookup de brackets como espejo exacto del motor.

**El costo de saltearlo también está medido:** los cinco bugs del 27 (§2) salieron a la luz en
WhatsApp real, no en el harness. Un contraste no los habría encontrado todos —cuatro eran
premisas falsas de los mocks— pero el del gate (91 tokens prohibidos que incluían "en" y "con")
es exactamente la clase de cosa que un refutador con lente de voz pregunta en la primera vuelta.

---

## 7. Cola después de la ronda (con sus gates)

**Token-reduction** — *gate: verificar caching primero (Martin, 10 min).* Magnitud total ~$9-11/mes
→ sólo levers de riesgo cero. (1) **Prompt caching**: el prefijo system+catálogo (~11k) ya es
elegible; verificar empírico con 2 requests idénticos y mirar cached tokens en el Activity de
OpenRouter. (2) **Tier-2 guard-on-trigger**: medir 2 semanas, ~15%. (3) **Comprimir el prompt
~30%**, gate promptfoo, contrato JSON **verbatim**. Rechazado: retrieval por categoría con
clasificador LLM (rompe el mundo cerrado → falsos handoffs).

**Handoff → asíncrono honesto** — *gates: formalizar el cambio de alcance por escrito con TG + SLA
de reclamos.* TG no quiere empleados mirando Chatwoot. El contrato del LLM **no se toca** (action
handoff + árbol preserva la telemetría de `motivo` y el freno anti-confabulación); cae `Asignar a
Humano`, quedan `Label` + `Nota Privada`, se agrega **notificación por email a TG** (re-agregar
Brevo, confirmar deliverability), y el `Mensaje Escalación` se reescribe honesto (sin "en breve te
responden": mail + tel 0223 476-0019 + local + horario). Reclamos: heurística JS sobre `motivo` →
email URGENTE.

**Archivos (audio / imagen)** — hoy hay un solo "no puedo procesar archivos". flash-lite tiene
audio nativo → transcribir sin servicio extra; imagen (foto de lo que quieren imprimir) →
describir. Rutas nuevas por tipo, plan propio.

**Auto-sync del catálogo** — planeado, no construido:
[`catalogo-sync-workflow.md`](./catalogo-sync-workflow.md) (watchdog semanal stateless, 9 checks
determinísticos, LLM sólo redactor, **Telegram a Martin siempre**, Martin aplica). Prerrequisito:
bot de Telegram (BotFather + chat_id + cred n8n). Build = sesión propia.

**Limpieza sistemática del catálogo** — descubrir faltantes minando `bot.decisiones` (red reactiva
permanente) + los ítems de taller a definir con TG. La curación se hace por skill
`/tg-curar-catalogo`; el curador visual (`tools/curador-catalogo.html`) quedó de fallback.

**promptfoo** — *gate final, Martin decide cuándo.* Se corre al declarar el build cerrado. Golden
cases: confabulación (regex `tapa|cartulina|metálico|\d+ ?gr`), JSON siempre parseable, el árbol
de ruteo, la costura 4/5.

**Sucesión de modelo — fecha dura: `gemini-2.5-flash-lite` muere el 16-oct-2026.** Ya está el
array `models: [...]` de fallback en el workflow, pero **un modelo distinto corre sin calibrar**:
el sucesor sólo entra si pasa promptfoo. Primario elegido: `gemini-3.1-flash-lite`. Lever
adicional: BYOK (key propia de Google AI Studio en OpenRouter, ~5% fee, límites propios).

**Deploy a prod** — KVM 4 de TG, **sin contratar aún**. Ver la memoria `project-registry`: nunca
asumir infra.

---

## 8. Histórico comprimido

Cada línea apunta al plan que tiene el detalle. No re-leer estos planes salvo que se toque
justamente eso.

| fecha | qué pasó | dónde está |
|---|---|---|
| 07-27 | Aplicación de E0+v8.1 y 5 fixes de los primeros mensajes reales; el cierre pasa a aviso de canal | `v8-1-build.md` §8 |
| 07-26 | **Consejo Opus de 6 lentes** sobre la dependencia del nombre en el prompt: ninguna de las 6 direcciones entra. Encontró además los 2 anti-loops que v8 había matado y que el gate no protegía nombre ni hedge (12 de 19 ataques pasaban con `ok`) | `consejo-opus-resolucion-producto.md`, `v8-1-build.md` |
| 07-26 | Ronda 4 (16 incidentes) → **consejo Opus de 5 lentes** → **atomización E0**: familias + atributos + los 3 bugs de plata (promo bajo el mínimo, taller por trabajo, talonarios). Hallazgo: **el doble faz se cobra por hoja** (cierra la pregunta 31) | `r7-consejo-opus.md`, `e0-atomizacion-catalogo.md`, `v8-build.md` |
| 07-24 | **Consejo de arquitectura de 6 lentes** → rediseño de la resolución. Decisiones: sin humano en Chatwoot (escalación 100% a mail, confident-wrong detectado automático), refinador LLM final, **Aclarador** (2ª llamada LLM jailbreak-safe), atributos vía curación | `consejo-arquitectura-resolucion.md`, `suite5-ronda2-fixes.md` §RC-0 |
| 07-23 | Split C2 (Prompt Cotizador + router determinístico + menú) · curador visual · pasada 1 de curación · ronda 2 de suite-5 + paquete r6 | `faq-bot-v7-cotizador.md` §Ronda 5, `suite5-ronda2-fixes.md` |
| 07-22 | **Decisión de producto:** WhatsApp informa TODO, el email queda sólo para encargar · catálogo limpio v10.8 (dedupe IMPRESIONES por el eje `color`, podas anti-hijack) · **v7 cotizador** (totales determinísticos) | `catalogo-limpio-producto-meta.md`, `faq-bot-v7-cotizador.md` |
| 07-21 | Increment B (precios): el LLM nunca tipea montos, escalera determinística, tabla de rangos · v10.1→v10.7 en rondas en vivo con Fable | `increment-b-precios.md` |
| ~07-20 | Núcleo: prompt v9, firewall Tier-1/Tier-2, error workflow, backstop anti-repetición | `v6-build-plan.md` |

**Núcleo del bot, para ubicarse:** `Webhook HMAC → Firewall Tier-1 → Filtro → Debounce → Decidir →
Switch → (cache catálogo) → Armar Mensajes → Guardrails Tier-2 → LLM → Parsear →
answer / handoff / noop / precio / opciones → (Aclarador si hace falta) → compositor → envío → log`.
