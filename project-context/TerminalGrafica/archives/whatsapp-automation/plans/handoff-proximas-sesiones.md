# Handoff — Bot WhatsApp Terminal Gráfica (`faq-bot-v9`)

> **Qué es este archivo:** el estado vivo y el próximo paso. Todo lo que ya está cerrado vive en
> los planes de `plans/` y en el log histórico de la memoria `chatwoot-whatsapp-impl-status`; acá
> sólo queda lo que todavía decide algo. Si una sesión termina y esto no cambió, el archivo miente.
> **Última actualización: 2026-07-28, noche** (v9.2 CONSTRUIDO y APLICADO en `faq-bot-v9.json`,
> 76 nodos. **El menú con precios YA ANDA en WhatsApp real** — Martin lo verificó. Lo próximo es
> que él siga probando y que la sesión que viene **evalúe esos tests con `bot.decisiones` poblado**).

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

**La sesión del 28 cerró el incidente que arrastraba tres rondas.** El bot pasó de contestar
*"¿Cuántos necesitás?"* a alguien que acababa de decir 3, a esto (WhatsApp real, verificado por
Martin el 28 a la noche):

```
Para la impresion exterior montada sobre plastico corrugado tenemos estas opciones:
1 x 0.65 mt: $19.500,00      1 x 1 mt: $30.000,00
2 x 1 mt: $48.000,00         a3: $10.500,00
Promocion inmobiliarias 1 x 0.65 mt (llevando 6): $15.000,00
Son precios de lista. Decime cual te sirve.
```

Las cuatro medidas con su precio, la promo con su condición pegada, el hedge al pie, y el
compositor redactándolo natural (sin recitar el paréntesis del nombre curado).

| pieza | estado |
|---|---|
| `n8n/flows/faq-bot-v9.json` | ✅ **76 nodos, re-importado y andando** |
| `db/enum-accion-2026-07-28.sql` | ✅ aplicado (PASO 1) — sin esto `bot.decisiones` no escribía |
| `db/curacion-2026-07-28b.sql` | ✅ aplicado — el vínculo promo→hermano |
| **Seguir probando en WhatsApp** | ⚠️ **el próximo paso, lo hace Martin** |
| **Evaluar los tests con la tabla poblada** | ⚠️ **la sesión que viene.** Ver §2 |
| Error workflow (`tg-bot-error`) | ⚠️ Martin lo dejó para después, a propósito |

### Lo que entró el 28 — siete commits

| # | qué | por qué importa |
|---|---|---|
| `1dd3040` | `Log Turno` escribía `null` en `accion` | el INSERT rebotaba **en silencio** → cero filas de la rama normal → sin memoria entre turnos. **Todo el trabajo del 27 leía de una fila que nunca se escribió** |
| `3e9fe17` | `hayCompetencia` contaba filas, no productos | un producto con 4 variantes daba `nCandidatos=4`: el guard del 27 llevaba desde entonces **encendido de punta a punta** |
| `e3f405b` | curación: el hermano de la promo | `producto_base`/`variante_base` como DATO, no heurística |
| `6969e9b` | `packDe()` adivinaba el pack del nombre | `'35X50 CM'` → pack de 35: la **cantidad elegía la medida**. 7 productos afectados, hasta 2,69× |
| `592e111` | el compositor ve los hechos | antes recibía sólo prosa y componía a ciegas |
| `ee95c53` + `e7c372d` | `bajo_minimo` dice los dos precios | y el fix del **ciclo lógico** que yo mismo introduje (ver §2b) |
| `612511f` + `1d04a52` | el enum de `accion` | el código escribía 10 valores que la base no acepta |
| `981dfc8` | **el menú dice precios + se va "la más barata"** | el cierre del incidente |

### El cambio de diseño que cierra el incidente (v9.2)

**Decisión de Martin, 2026-07-28:** *"No hay uno por defecto, muestra todas las variantes."*

Eso deroga el desempate `la más barata`, que era la causa raíz: sin ancla, las 4 variantes del
cartel empataban y ganaba la A3 ($10.500) contra el 1x0,65 real ($19.500) — **1,86× abajo**. Su
justificación en el código (*"si erramos, erramos por abajo"*) era falsa: **errar por abajo ES
sub-cotizar**, el daño exacto que el proyecto viene persiguiendo desde el 27.

Las dos piezas van juntas y no se pueden separar:
- sacar el desempate **sin** el menú con precios ⇒ menús mudos (peor que antes: antes salía UN
  número, aunque fuera el equivocado);
- el menú con precios **sin** sacar el desempate ⇒ el menú casi nunca aparece.

**Lo que NO muestra monto, a propósito:** escalera de cantidad → `"según cantidad"` (el precio
depende de cuánto lleve; un número suelto sería mentira) · override → nada (el motor de precios
manda) · precio 0 → nada (`$0,00` es una promesa de gratis).

**Y sigue resolviendo a UNA cuando corresponde:** *"cartel de 2x1"* cotiza ese y no muestra menú.
El menú es para el empate, no para todo. Excepción explícita: si alguna hermana cotiza por
cantidad se conserva la reducción, o el menú perdería la tabla de rangos.

**El compositor ve los hechos** (bloque 11): además del texto ya redactado, ahora recibe qué
producto es, qué definió el cliente y qué quedó pendiente — más la regla *"si el cliente ya lo
definió, NO se lo vuelvas a preguntar, aunque el borrador lo pregunte"*. El límite no se movió:
la plata sigue tokenizada y el LLM sigue sin tipear un monto (test `CX6` lo blinda).

**Build reproducible:** `node tests/build-v9.js` regenera v9 desde v8; `--check` verifica sincronía.
El JSON no se edita a mano.

**Verde hoy:** harness **354/354**, validador **0 errores**, `--check` al día.

**Rollback:** re-importar `faq-bot-v8.json`. ⚠️ **Ojo:** el enum de la base ya está ensanchado, lo
cual es compatible hacia atrás; pero v8 escribe `pregunto_opciones` / `cotizador_answer`, que
**siguen sin existir** en el enum. Un rollback a v8 vuelve a romper el log en silencio.

---

## 2. Para la sesión que viene — evaluar los tests de Martin

Martin sigue probando en WhatsApp real. **Lo primero de la próxima sesión es mirar lo que quedó
registrado**, no proponer nada nuevo. Las consultas están en §5b.

### 2a. Qué mirar, en orden

1. **¿El log escribe?** Hasta el 28 la rama normal escribía **cero filas**. Si `bot.decisiones`
   tiene filas de hoy con `accion` distinto de `handoff`, la costura quedó cerrada.
2. **¿El compositor está reescribiendo o degradando?** `notas` trae el veredicto:
   `(compositor:ok)` = reescribió · `(compositor:ilegible)` = el LLM no contestó y salió el
   borrador crudo · `(compositor:off)` = kill switch o nada que componer.
3. **¿Aparece `cruce_montos`?** Es la observación nueva del bloque 12f. **Martin decidió NO
   bloquear** (*"no quiero seguir limitando funcionalidades"*), así que la única defensa es
   medirlo. Si sale > 0, hay que mostrarle el caso concreto antes de proponer nada.
4. **¿El firewall registra?** Nunca lo hizo — su INSERT fallaba doblemente mudo (`exception when
   others then null` del lado SQL, enum del lado de la columna). Con el ALTER aplicado debería
   empezar. Si sigue en cero, hay otra causa.

### 2b. Dos errores míos del 28, para no repetirlos

**El ciclo lógico.** Cableé `Aplicar Filtro → Get Precio → Armar Respuesta Precio` y puse el
cálculo del pedido (`hermanoPide`) **en ARP**, que corre después. Le pedí a un nodo un dato que
todavía no existía: `Get Precio` mandaba dos uuid vacíos, 0 filas, y el texto degradaba **siempre**.
Martin lo vio en producción antes que yo en los tests. **Lección: cuando un nodo nuevo consume algo,
verificar que el productor esté río arriba en el grafo, no sólo que exista.**

**Los fixtures que mienten, otra vez.** Los tests `CP6e-i` mockean `$('Get Precio').all()`
inyectando la fila del hermano, así que verificaban el texto **suponiendo que el dato llegó**.
Pasaban en verde con el ciclo puesto. Los tests `T13c-f` ahora ejercitan `Aplicar Filtro` de
verdad. **Regla que ya está en la memoria [[tests-fixtures-mienten]] y volvió a morder: un fixture
no miente sólo por su forma, también por lo que no ejercita.**

**Y un bug del generador que costó una hora:** `sub()` usaba `String.replace`, donde `$&`, `$'` y
`` $` `` del texto de reemplazo son **patrones de sustitución**. El helper nuevo contiene
`'$' + new Intl.NumberFormat`, o sea `$'` — y eso reinyectaba todo el código posterior al ancla:
el nodo pasaba de 8.147 a 17.333 caracteres con el bucle duplicado. Ahora es `split/join`, y el
guard de ancla ambigua tiene un modo `DBG_ANCLA=1` que imprime las dos ocurrencias con contexto.

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

**c. ~~Que la capa determinística emita hechos estructurados~~** ✅ **hecho el 28** (bloque 11,
commit `592e111`). El compositor recibe `hechos` por lista blanca. Lo que **queda**: el pipeline
sigue siendo prosa→prosa para el *contenido* — los hechos son contexto, no reemplazan al borrador.

**d. El cruce de montos, sin cerrar por decisión de Martin.** Con 2+ montos en un mensaje el
compositor puede reordenar y dejar cada uno pegado a la condición cambiada — un contraste lo
**reprodujo ejecutando los nodos reales**: la promo saliendo más cara que el suelto, con verdicto
`ok` y `obs` vacío. Martin decidió **medir antes que limitar**. Hoy se registra como
`cruce_montos:N`. Si la medición da > 0, la decisión vuelve a su mesa. ⚠️ Ojo: el chequeo compara
**secuencias de valores deduplicadas**, así que si dos montos son iguales el cruce es invisible
incluso para la observación.

**e. La reatribución NO está cubierta y no la cubre nadie.** Si el compositor conserva el ORDEN de
los tokens pero le cambia el producto al que cada uno pertenece (*"el de 300 sale [[P1]]"* cuando
`[[P1]]` es el precio del 130), ninguna regla lo ve: el gate cuenta bolsas globales y **nunca ata
un número a la entidad que lo porta**. El test `X4d` fija el hueco a propósito, para que se note si
algún día se cierra. No lo introdujo v9.2 — la regla vieja también lo dejaba pasar.

**f. El paréntesis del nombre curado.** El LLM 1 copia el nombre exacto del catálogo (y hace bien:
su salida la usa el código para buscar). Pero `Promoción para inmobiliarias (cartel de 1 × 0,65 m,
llevando 6)` es ruido de mostrador. En el aviso de cambio de producto ya se saca por código; en el
menú no. Fix chico e independiente. **Nota: en la ronda del 28 el compositor lo limpió solo** — vale
medir si hace falta el fix determinístico.

**g. Sin cerrar de antes:** la cuantización de packs · el guard de variante no anclada · las 6
variantes de E0 que no resolvieron (b).

**h. Deuda del enum:** `firewall_tier2_' || p_reason` es de **cardinalidad abierta** — cualquier
razón nueva del lado del código vuelve a rebotar contra el enum. Un enum es la estructura
equivocada para eso. Queda anotado, no resuelto.

**i. El `silence` de strike-max manda el aviso de rate** — *bug de ruteo, hallado 2026-08-02 en el
walkthrough con Martin (leído por él en el SQL + confirmado en el nodo Switch).* `bot.firewall_check`
devuelve `action='silence'` en **dos** casos con `reason` distinto: `rate` (1er cruce de volumen,
quiere mandar el aviso "frená") y `strike-max` (3ra injection, quiere silencio mudo 24 h). Pero el
`Switch Firewall` rutea **solo por `json.action`** (is-equal `silence`, una sola ruta), así que las
dos caen en `Aviso Rate Firewall`: **el atacante de strike-max recibe "frená, mucho volumen"** —
copy equivocado y le confirma que hay un bot, justo lo que el diseño evita. **Severidad baja/acotada:**
sólo se filtra ese único mensaje; desde el siguiente cae en "ya silenciado" → `drop` mudo. **No
aplicado (freeze de entrega).** Fix mínimo cuando Martin decida: en `db/firewall-tier1.sql` línea 197,
que strike-max devuelva `'drop'` en vez de `'silence'` → cae en `Descartar` (silencio real); el
`silenciado_hasta` de 24 h ya queda seteado igual, y el rate sigue con su `'silence'` → aviso.

**j. Firewall disperso en 4 lugares → unificar** — *idea de diseño 2026-08-03, con Martin. NO
decidida, NO aplicada (freeze de entrega).* Hoy la lógica de abuso/seguridad está repartida:
Tier-1 SQL (etapa 2, pre-merge, ve **solo el mensaje suelto**), injection en `Decidir` (etapa 4,
ve la **ráfaga**), Tier-2 LLM (etapa 5, ve la ráfaga vía `Decidir.userMessage`), y `Strike Tier-2`
aparte. Martin quiere consolidarla en **una sección bien definida** (no un solo nodo). Trade-off
clave verificado leyendo el flow: `blocklist`+`rate` conviene que corran **temprano** (escudo
barato antes del debounce 3 s y del `Get Historial`); `injection`+contenido quieren correr
**post-merge** (ven la ráfaga). Dos formas sobre la mesa: **(A)** todo unificado post-merge — más
simple de mantener, pero el conocido-malo hace más trabajo antes de morir; **(B)** dos gates
rotulados: *Abuso* (blocklist+rate, pre-merge) + *Contenido* (injection+Tier-2, post-merge).
Requiere pasada adversarial antes de aplicar. Contexto: el objetivo de fondo es que Martin pueda
mantener el firewall solo — la dispersión actual es parte de por qué no era ownable.

**k. `bot.info_negocio` NO EXISTÍA — la rama info estaba inerte en prod** — *hallado 2026-08-03 con
Martin, durante el walkthrough.* La tabla que consultan el nodo `Datos Info` y la tool
`consultar_info_negocio` **nunca se creó** (sin migración en el repo, sin objeto en la base). Con la
tabla ausente, las dos queries devuelven vacío → la red determinística de `Salida Info` no hace nada
→ la rama info cae 100% en `respuestaInfo` del agente (el bug que `8585b95` quería tapar), y como la
tool también da vacío, el agente tampoco puede traer el dato: **todo "¿a qué hora abren?" se iba a
mail.** `test-cap-e-info.js` pasaba igual porque **mockea las filas** — [[tests-fixtures-mienten]] otra
vez: "la tabla no existe" queda afuera del test por construcción. **Fix preparado:** `db/info-negocio.sql`
(create table + grant a `bot_readonly` + seed); Martin completa los valores reales de TG y aplica.
Pendiente: agregar la tabla a `data-model.md` (hoy no la documenta).

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

### 5b. Las consultas para evaluar la ronda *(arrancar la próxima sesión por acá)*

**Claude no ve las ejecuciones.** Si necesita algo de una corrida, **se lo pide a Martin** — no lo
deduce. En la sesión del 28 se afirmaron dos veces cosas de ejecuciones no vistas (que el LLM había
fallado, y que el menú nunca se mandaba) y las dos veces el dato de Martin lo desmintió.

```sql
-- 1. ¿El log escribe? Hasta el 28 la rama normal daba CERO filas.
select accion, count(*) from bot.decisiones
 where created_at > now() - interval '1 day' group by 1 order by 2 desc;

-- 2. ¿El compositor reescribe o degrada?
select case when notas like '%compositor:ok%'       then 'reescrito'
            when notas like '%compositor:ilegible%' then 'el LLM no contestó'
            when notas like '%compositor:off%'      then 'saltado'
            else 'sin dato' end as que_paso, count(*)
from bot.decisiones where created_at > now() - interval '1 day' group by 1;

-- 3. EL CRUCE DE MONTOS — la decisión de Martin del 28 depende de este número.
select count(*) from bot.decisiones where notas like '%cruce_montos%';

-- 4. ¿El firewall registra? Nunca lo hizo (INSERT doblemente mudo).
select accion, count(*) from bot.decisiones
 where accion::text like 'firewall%' group by 1;

-- 5. El detalle de una conversación puntual, para diagnosticar un mensaje raro.
select mensaje_cliente, accion, estado, borrador, final, notas
from bot.decisiones where conversation_id = <id> order by created_at desc limit 5;
```

### 5a. Lo demás

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
