# Handoff — Bot WhatsApp Terminal Gráfica (`faq-bot-v8`)

> **Qué es este archivo:** el estado vivo y el próximo paso. Todo lo que ya está cerrado vive en
> los planes de `plans/` y en el log histórico de la memoria `chatwoot-whatsapp-impl-status`; acá
> sólo queda lo que todavía decide algo. Si una sesión termina y esto no cambió, el archivo miente.
> **Última actualización: 2026-07-27, noche** (v8.3 CONSTRUIDO en `faq-bot-v9.json`, 71 nodos.
> Lo próximo es correr la **suite 7** en WhatsApp real y decidir qué optimizar con lo medido).

**Reglas de trabajo que no cambian:**
rol A (informador acotado, no configurador) · mundo cerrado (lo no listado no existe para el bot)
· **Claude prepara migraciones, Martin las aplica** — Claude no toca la base · nunca `public.*`
(es el mostrador de TG; el bot vive en el overlay `bot.*`) · **el LLM nunca tipea un monto** ·
resolución **por clave natural**, jamás por uuid, con `raise notice` + skip · el bot corre en la
VM de dev con el número de test, **no es prod de TG** · commits en rama, nunca a `main` de
`projects/` · toda decisión de diseño pasa por una **pasada adversarial antes** de aplicarla
(ver §6) · tras tocar un nodo Code: `node tests/code-harness.js`, siempre.

**Cómo se le contesta a Martin:** corto. Una conclusión y el próximo paso, sin recap de la
pregunta. **Si lo que tiene que revisar no entra en ~15 líneas, no va en el chat: va como slide
deck** (artifact HTML, precedente en `decks/r7-atomizacion-y-split.html`) con 2-3 bullets de qué
mirar. El plan largo se commitea igual en `plans/`; el deck es cómo se presenta, no dónde vive.

---

## 1. Estado ahora — lo único que hay que leer para arrancar

**v8.3 está construido en `faq-bot-v9.json` (71 nodos). Lo próximo es correrlo.** El plan
([`v8-3-busqueda-por-palabra.md`](./v8-3-busqueda-por-palabra.md)) pasó su pasada adversarial de 2
lentes ([`v8-3-pasada-adversarial.md`](./v8-3-pasada-adversarial.md)) y el lote entero está aplicado,
con los 3 prerrequisitos que estaban escritos en el repo y nunca se habían aplicado.

| pieza | estado |
|---|---|
| `n8n/flows/faq-bot-v9.json` | ⚠️ **re-importar: 71 nodos.** Búsqueda por palabra + filtro + los fixes 0a/0b/0c |
| [`tests/suite-7-v9-busqueda.md`](../tests/suite-7-v9-busqueda.md) | ⚠️ **el próximo paso.** WhatsApp real; §0 primero (valida el fix del log) |
| Migración SQL | ✅ **ninguna.** v9 no toca la base |
| Curación de nombres (`db/curacion-2026-07-27.sql`) | ✅ aplicada por Martin |
| Error workflow (`tg-bot-error`) | ⚠️ Martin lo dejó para después, a propósito |
| La conversación de prueba vieja | 🔴 muda por un handoff previo (`assignee_id`). Ya no puede volver a pasar: la ruta se eliminó |

### Lo que trae v9

**El pipeline nuevo** — `Switch[precio] → Extraer Palabras → Buscar Candidatos → ¿Filtrar? →
Llamar LLM Filtro → Aplicar Filtro → Get Precio`. El LLM deja de elegir un nombre exacto y pasa a
tirar palabras; Postgres busca ponderando por rareza (IDF: `kraft` pesa 3,5× más que `papel`); un
2º LLM filtra con la conversación delante. `Get Precio` **no se tocó**: sigue resolviendo por clave
natural, sólo que ahora el nombre que recibe existe por construcción.

**Tres prerrequisitos que estaban escritos y nunca aplicados:**
- **0a — el log.** `Log Turno` colgaba de `Enviar Mensaje` (HTTP a Chatwoot), así que su `$json` era
  la respuesta del API: `borrador`/`final`/`senales` se escribían **null siempre**. No era sólo
  telemetría — `borradoresPrevios` sale de ahí y **los dos anti-loops nunca contaron nada**.
- **0b — NFC** en los slots del LLM. v8.3 no heredaba el bug: lo **agravaba**.
- **0c — timeout 20 s** en los nodos LLM (era el default de 300 s).

**Guards de negocio que bajaron de prompt a SQL** (una regla comercial no se le delega a un modelo):
`oculto`, nicho (medicina / promo inmobiliarias) y `solo_descuentos`.

**`hayCompetencia` se mide antes de la elección**, sobre el candidato-set pre-filtro. Era el hallazgo
más caro de la pasada: con el producto elegido de una lista, `Get Precio` resuelve exacto y la puerta
quedaba apagada justo cuando más hace falta — la causa raíz del 27 movida un nodo adelante.

**Y la decisión de Martin que cambió el diseño** (`decisions/log.md`, 2026-07-27): **el bot nunca
repregunta para desambiguar, muestra todas las opciones de una.** La puerta abierta y la repregunta
cuestan el mismo mensaje saliente, así que el plan se equivocaba al justificar la puerta con
"informa gratis"; corregido el empate, gana listar, porque ahorra los turnos. Cae la política 1 del
plan (no se invierte: se elimina) y el cupo pasa de 4 a 8.

**Build reproducible:** `node tests/build-v9.js` regenera v9 desde v8; `--check` verifica sincronía.
El JSON no se edita a mano.

**Verde hoy:** harness **221/221** en v9 (19 tests nuevos para los 3 nodos Code) y **202/202** en v8
— los 4 goldens de conducta cambiada son version-aware, así el rollback sigue verde. Gemelo en sync,
validador 0 errores.

**Rollback:** re-importar `faq-bot-v8.json`. No hay nada que revertir en la base.

---

## 2. La ronda del 27 — el titular

**El mensaje 1 fue el único de la tanda A que salió limpio** ($8.800, "(100 hojas)", "por hoja").
De ahí en adelante: **6 incidentes de plata, 7 de resolución, 7 de voz**, y **cuatro cotizaciones
con número equivocado dicho con confianza** (1,42× · 1,25× · 1,76× · hasta 100× en las rifas).

**Los cuatro salen del mismo defecto:** la compuerta del guard de ancla se deriva del **rowcount
del SQL**, que es *posterior* a la elección del LLM. Cuanto más confiado el LLM, más limpio el
resultado, más callado el guard. Detalle completo en `v8-2-ronda-completa.md` §1.

**Aplicado (5 commits, harness 186/186, validador 0 errores):** la unidad de la tabla de rangos y
la escalera-que-es-total · la unidad en el precio único sin total · la unidad propia de los extras
· la 2ª pasada que ya no nombra lo que el guard de nicho bloqueó · los candidatos del Aclarador
filtrados por nicho · fuera "no lo tenemos en catálogo" · el menú colapsa la opción única · el
aviso de canal cruzado contra `bot.decisiones` · **fuera la ruta handoff a un humano** ·
`Log Silencio` con el origen del noop.

**El contraste tumbó las dos propuestas de arquitectura** (el guard de hermanos y la recuperación
por familia). Y la opción C que sobrevivía la tumbó Martin, con razón: si el LLM se equivoca, el
cliente no recibe nada. **La dirección elegida es la suya** — el LLM tira palabras clave, Postgres
busca, un segundo LLM filtra con la conversación delante. Cada paso degrada hacia "de más", nunca
hacia "nada". Plan medido en [`v8-3-busqueda-por-palabra.md`](./v8-3-busqueda-por-palabra.md).

**Después de la ronda se hicieron dos cosas más el mismo día:** la **curación de nombres**
(`db/curacion-2026-07-27.md`, aplicada) que hace encontrables los 6 papeles láser, y el **gate del
compositor aflojado** — tres lentes midieron que el 31% de las frases naturales rebotaba y que el
85% de los rechazos en precios salía de `hedge`. Ninguna regla se sacó; cuatro pasaron a medir
contenido en vez de forma (commit `42c7359`).

**La lección del harness, que ahora tiene nombre:** la firma es `armar(precioObj, rows, dec)`, o
sea **el resultado del SQL es un input escrito por el autor del test**. Todo caso pregunta "dada
una resolución correcta, ¿la aritmética aguanta?". La clase entera *"la resolución fue mala"* queda
afuera por construcción — y el caso S6 llegaba a assertear el bug de 1,76× como conducta correcta.

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

**d. v8 pasó por su primera pasada adversarial el 07-27** (2 lentes, sobre la decisión de
arquitectura). Lo que **sigue sin contrastar**: el compositor, la salida del menú, y la **opción C**
misma cuando la medición diga que vale la pena construirla.

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
| 07-27 | **Ronda completa (16 mensajes) → 20 incidentes en 3 lentes.** Una causa raíz para los 4 confident-wrong: la compuerta del guard sale del rowcount del SQL. Lotes 1 y 2 aplicados; fuera la ruta handoff; `Log Silencio`. El contraste tumbó A y B, sobrevive la opción C (sin construir, se mide primero) | `v8-2-ronda-completa.md` |
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
