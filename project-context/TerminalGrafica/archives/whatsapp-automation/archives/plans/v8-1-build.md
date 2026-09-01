# faq-bot-v8.1 — los bloqueantes del consejo + la señal del confident-wrong

> **CONSTRUIDO 2026-07-26. Nada aplicado.** `faq-bot-v7.json` sigue siendo el rollback.
> Es una edición **sobre v8**, no una versión nueva: v8 nunca se aplicó, así que no hay
> nada desplegado a lo que volver.
> Insumo: [`consejo-opus-resolucion-producto.md`](./consejo-opus-resolucion-producto.md).
> Verificación: harness **150/150**, gemelo en sync, validador de import **0 errores**.

Se aplica junto con [`db/curacion-e0-2026-07-26.sql`](../db/curacion-e0-2026-07-26.sql) (que
ahora también crea la columna de señales) y [`db/curacion-voz-2026-07-26.sql`](../db/curacion-voz-2026-07-26.sql).

---

## 1. Los cinco bloqueantes

### 1.1 El compositor había matado los cuatro anti-loops

`Decidir` arma `lastBotReplies` desde los mensajes **salientes de Chatwoot**, que desde v8 son
el texto **compuesto**. Los guards comparan contra el **borrador**. El compositor parafrasea, así
que las dos cadenas ya nunca coinciden y ninguno de los cuatro disparaba:

| guard | qué dejaba de pasar |
|---|---|
| `Parsear Respuesta` | el `noop` ante una respuesta repetida |
| `Armar Respuesta Precio` | la derivación a mail tras 2 repreguntas iguales |
| `Armar Menu Opciones` | ídem para el menú |
| `Aplicar Aclarador` | ídem para la aclaración |

Consecuencia: **el bot podía repreguntar lo mismo indefinidamente y no derivar nunca**, pagando
cada vuelta. El consejo contó tres; son cuatro.

`Get Ruta Cotizador` pasa a `limit 3` devolviendo la columna `borrador` (que E0 ya agregaba), y
`Armar Mensajes LLM` expone `borradoresPrevios` para los cuatro guards. **`lastBotReplies` queda
como está para el `repeatNote` del LLM**: eso es lo que el cliente realmente vio, y para
"no te repitas" es lo correcto.

> El harness daba 125/125 con el bug vivo porque el caso V8-17 mockeaba `lastBotReplies` con el
> borrador exacto: codificaba la premisa anterior al compositor. Los 5 casos nuevos (L1-L5) fijan
> las dos premisas — el anti-loop dispara con texto compuesto distinto, y **no** dispara cuando
> los borradores no se repiten de verdad.

### 1.2 El gate del compositor no protegía el nombre ni el hedge

Las 5 reglas de v8 cuidaban la plata. Renombrar a otro producto **real** las pasaba todas:

```
borrador "La opción 35X50 CM de Cartón sale $2.000,00."      ← Cartón vale $2.000
cliente  "El montado sobre cartón de 35X50 CM te sale $2.000,00."   ← ese vale $4.000
```

Tokens intactos, sin `$` propio, mismos dígitos, léxico de riesgo sin aumentar, largo similar.
Y borrar *"el total te lo confirma el equipo"* también pasaba, porque la regla 4 permite
**explícitamente** que el léxico aparezca **menos** veces. `v8-build.md` §9 decía que el gate
compara valores y no layout: **el hedge es un valor** y lo trataba como layout.

Dos reglas nuevas:

- **2b, conservación de nombre.** `Armar Prompt Compositor` arma la lista de tokens
  **distintivos** (presentes en ≤3 nombres del catálogo) que el borrador **no** menciona. Si
  alguno aparece en la salida, el compositor nombró otro producto → rechazo. Se descartan los
  que comparten prefijo de 5 con un token del borrador, para no rechazar por singular/plural
  ("carpeta" contra "Carpetas con Vaina"). **Sin catálogo la lista queda vacía y el gate es un
  no-op**: fail-safe, nunca un rechazo masivo.
- **4b, conservación de hedge.** `precio de lista`, `confirma el equipo`, `cotiza el equipo`,
  `total estimado`, `equipo te lo confirma`. Presencia, no conteo: el compositor puede
  consolidar dos caveats idénticos de un multi-ítem, pero no puede borrarlos.

### 1.3 Los envíos al cliente cobraban triple

`Enviar Mensaje`, `Mensaje Firewall Refusal`, `Aviso Rate Firewall` y `Mensaje Refusal Tier-2`
tenían `retryOnFail` con 3 intentos y **ningún `onError`**. Chatwoot está detrás de un túnel de
Cloudflare: un 504 después de que Chatwoot ya aceptó el mensaje mandaba **3 mensajes pagos
duplicados** y el cliente veía lo mismo tres veces. Es el único lugar del workflow donde
reintentar es peor que fallar. Se les sacó el retry y se les puso `continueRegularOutput`.

Los otros 7 mensajes enlatados y las labels ganaron `onError` para que un blip de Chatwoot no
deje la ejecución en rojo — un *retry execution* desde la UI **reenvía**.

### 1.4 `wf.settings` estaba vacío

`executionOrder: "v1"` fijado. Sin eso n8n aplica el orden legacy al importar y el workflow se
comporta distinto que en las pruebas. **El error workflow lo tenés que enganchar vos desde la
UI** (el id depende de la instancia): Workflow Settings → Error Workflow → `tg-bot-error`.

El validador de import no miraba `settings` en ningún momento. Ahora sí.

### 1.5 El catálogo caído entraba al prompt

Si `Get Catálogo` fallaba y `staticData` estaba vacío, el literal `(catalogo no disponible)`
llegaba al system prompt y el LLM contestaba **sin mundo cerrado** — podía confirmar productos
que TG no hace. Ahora `Armar Mensajes LLM` **aborta el turno**. Nada se envió todavía, así que no
hay mensaje pago perdido y un retry desde la UI es seguro. Muere ruidoso, que es lo que se quiere.

---

## 2. La señal del confident-wrong

El incidente 14 (el LLM elige un gemelo que el cliente nunca ancló) **no lo caza la regla de
gemelos de v8**: esa vive dentro del camino `ambiguo`. Si el LLM elige con confianza, el motor
devuelve una fila limpia y nada aguas abajo se entera. Verificado en el código, no en el plan.

Las seis lentes del consejo llegaron a lo mismo por caminos distintos:

> **La señal no es qué tan bueno es el match. Es cuánto del match lo puso el cliente.**

### 2.1 Lo que se logueaba destruía la evidencia

`Armar Respuesta Precio` guardaba `nombreProd(main, null) || p.producto`, o sea **el canónico de
la base cuando las filas resolvieron**. En el camino de éxito, el string crudo que tipeó el LLM
se perdía: no había forma de distinguir un hijack de sinónimo (`"papel kraft"`) de una elección
deliberada (`"Papel Kraft 130 Gr"`). La clase de fallo que más plata mueve era **indetectable
desde el log, por construcción**.

Una columna `senales jsonb` en `bot.decisiones` (un solo `alter`) con:

| clave | qué es |
|---|---|
| `producto_pedido` / `variante_pedida` | el string **crudo** del LLM |
| `match_rank` | 1 exacto, 2 contiene, 3 resuelto por variante |
| `descartados` | **los candidatos que el filtro de rank borró** |
| `filas` | cuántas trajo el SQL antes de filtrar |
| `anclados` / `sin_anclar` | qué ejes de la fila nombró el cliente y cuáles no |
| `puerta` | el eje sobre el que se declaró el supuesto |

`descartados` es la señal central: *"la resolución fue única SÓLO porque un rank mejor eliminó
competidores"*. Eso ya se computaba en `evaluar()` y se tiraba a la basura.

### 2.2 La puerta abierta

Cuando la resolución sale bien pero la fila tiene ejes que el cliente **nunca nombró**, y había
con qué confundirse (competidores descartados o más de una fila), el bot **declara el supuesto en
la misma frase del monto**:

> "…te salen $15.000. **Si lo necesitás en color es otro precio, avisame.**"

El orden es por plata, no alfabético: **color primero** (mueve 4×, $100 contra $400 la página),
después faz, gramaje, papel, material, acabado, tamaño. **Una sola puerta por mensaje**: dos
supuestos declarados se leen como un formulario.

Sin competencia no hay puerta. Declarar un supuesto donde no había con qué confundirse es ruido,
y el ruido se paga a USD 0,026 el mensaje.

**La puerta termina siempre en "avisame"**, que está en la lista de hedges del gate: el
compositor puede reescribir la oración pero no puede borrarla. Si la parafrasea a "decime", el
gate rechaza y sale el borrador — que también trae la puerta. Fail-safe en la dirección correcta.

### 2.3 Validación de conjunto cerrado

- `Parsear Respuesta` compara el nombre que emitió el LLM contra el catálogo real y marca
  `producto_inventado` en los flags. El set sale del **mismo cache** que arma el prompt, así que
  nunca puede estar más viejo que el catálogo. **Fail-open**: sin catálogo el chequeo no corre
  (un cache frío rechazando nombres válidos sería peor que el problema).
- `Aplicar Aclarador` era **el único punto del workflow donde un nombre tipeado por un LLM
  llegaba al cliente sin pasar por la base**. Ahora filtra contra el catálogo; si no sobrevive
  ninguna opción, deriva en vez de inventar.

No cambia el ruteo — `sin_match` ya iba al Aclarador. Lo que cambia es que ahora se **distingue**
"el LLM inventó un nombre" de "el nombre existe pero no matcheó", que son fallas opuestas con
arreglos opuestos (prompt contra curación).

---

## 3. Matching y housekeeping

- **Frontera de palabra en el rank-2.** Era substring crudo: `producto='lona'` matcheaba
  **ta·lona·rios**. Ahora ancla a **inicio** de palabra, sin anclar el final, para conservar la
  tolerancia a plural (`impresion` tiene que seguir matcheando `Impresiones`). Los dos lados se
  tokenizan a alfanumérico + espacio, así que de paso desaparece la necesidad de escapar `%`/`_`.
- **Endpoint pineado** (`provider: { order: ['google-ai-studio'] }`) en los 4 nodos LLM. Hay 5
  endpoints para `gemini-2.5-flash-lite`; sin pinear, el cache de prefijo —donde vive el catálogo,
  ~5k tokens a 0,1× de precio— se diluye entre todos.
- **NFC** sobre el mensaje del cliente. Ni el SQL ni el JS normalizaban Unicode: un teclado
  iOS/macOS que emita acentos descompuestos hacía fallar todo match con acento, **en silencio y
  sólo para algunos clientes**.

---

## 4. La curación de voz

[`db/curacion-voz-2026-07-26.sql`](../db/curacion-voz-2026-07-26.sql), 5 bloques por clave natural.

**Agrega** los términos de mostrador al default (`Impresiones papel obra 75 gr`), que tenía la
lista de sinónimos **vacía** siendo el producto que el cliente nombra de diez maneras:
`fotocopias`, `fotocopia`, `copias`, `hojas impresas`, `impresiones comunes`, `apuntes`,
`apunte`, `carillas`, `carilla`. *"Me hacen fotocopias?"* caía en la posición **71 de 82**.

**Quita** cuatro hijacks medidos, donde el rank-1 de un producto borra el empate que habría
mandado la consulta al Aclarador:

| sinónimo | secuestraba hacia | contra | ratio |
|---|---|---|---|
| `apuntes de medicina` | producto de nicho, $45/pág | cualquier consulta con "apuntes" | — |
| `hojas a3` | a3 tonner, $500/pág | obra 75, $100/pág | 5× |
| `papel ilustracion` | la **hoja** Ilustración Mate 250 ($900) | Folletos ilustración ($66.000 x500) | **73×** |
| `papel ilustracion brillo` | la hoja Ilustración Brillo 150 ($800) | ídem | **82×** |

**Lo que no entró, a propósito:** las formas verbales (`anillar`, `plastificar`, `refilar`)
necesitan las claves naturales de Taller y Encuadernación verificadas contra la base viva — el
export es del 23-jul y quedó atrás de dos curaciones. Y los verbos genéricos de impresión
(`imprimir`) quedaron afuera porque los sinónimos sólo trabajan en rank-1, que exige igualdad
exacta del slot completo: un verbo suelto como `producto` es señal de extracción rota, y hacerlo
resolver al producto **más barato** del catálogo sub-cotiza en silencio. Sin el sinónimo cae en
`sin_match` y lo atiende el Aclarador, que pregunta.

---

## 5. Lo que NO se construyó, y por qué

Ninguna de las seis direcciones candidatas entró como cambio de arquitectura. **El catálogo se
queda en el prompt y el LLM sigue eligiendo el nombre.** El razonamiento completo está en el acta;
el resumen:

- **IDs opacos**: destruyen la única señal de detección. Un `P047` equivocado no deja rastro.
- **Enum en el esquema**: OpenRouter **ignora en silencio** los parámetros no soportados por
  defecto; 84 valores está al filo del umbral de `400` reportado (~100); y el array
  `models: [2.5, 3.1]` existe justamente para que el 16-oct el primario caiga al sucesor sin
  avisar — la garantía se evaporaría sola, en una fecha que ya está en el calendario.
- **Sacar el catálogo del prompt**: no ahorra (está dentro del prefijo cacheable, sacarlo da
  **−USD 0,33/mes**), y se lleva puesto el mundo cerrado. No existe umbral de similitud que
  separe "lo tenemos" de "se parece a algo que tenemos" (medido: 0,63 afuera contra 0,53 adentro).
- **El contrato de 9 slots**: con todos los slots llenos y correctos, sólo **42 de 82 productos**
  quedan unívocos. Los seis servicios de taller tienen el vector **idéntico**. La información no
  está en los atributos: está en el sustantivo.

**Sigue pendiente el default obra 75 como conducta de cotización** (que el bot cotice directo en
vez de listar el menú cuando el cliente no especifica). Esta entrega construyó la mitad que es
un guard de plata —la puerta abierta, que declara el supuesto pegado al monto— pero **no** la
que ahorra un mensaje. Es prompt y merece su propia ronda de medición.

---

## 6. Runbook

Se aplica **todo junto**. Orden:

1. **`db/curacion-e0-2026-07-26.sql`** — atributos + `borrador`/`final` + `senales`.
   NOTICES esperados: 83 productos, 139 variantes. No aplicarlo en medio de una conversación
   real: el `drop view` de `bot.variantes` toma un lock exclusivo unos milisegundos.
2. **`db/curacion-voz-2026-07-26.sql`** — 5 bloques. Leer los NOTICES: cada uno dice `OK: <producto>
   -> N sinonimos` o `SKIPPED`. **Un SKIPPED significa que TG renombró algo**, y hay que mirarlo.
3. **Importar `n8n/flows/faq-bot-v8.json`** (68 nodos, las credenciales viajan con su id real).
4. **Workflow Settings → Error Workflow → `tg-bot-error`.** Es el único paso manual, y sin él
   una ejecución que muere no avisa a nadie.
5. **`GET /webhook/refrescar-catalogo`** (URL de producción: en ejecución manual `staticData` no
   persiste).
6. **Ronda.** Además de los 10 mensajes de `v8-build.md` §5:

| # | Mensaje | Qué tiene que pasar |
|---|---|---|
| 11 | "una lona de 3x2" | **no** puede aparecer `Talonarios Rifas` entre las opciones |
| 12 | "me hacen fotocopias?" | resuelve (caía en la posición 71 de 82) |
| 13 | "cuánto sale imprimir 100 hojas" | sale el precio **y** la puerta: *"si lo necesitás en color…"* |
| 14 | "quiero 100 hojas en blanco y negro" | **no** aparece la puerta de color (ya lo ancló) |
| 15 | repetir 3 veces un pedido imposible | a la tercera **deriva a mail** (era el anti-loop muerto) |
| 16 | "papel ilustración para 500 folletos" | **no** puede cotizar la hoja suelta de $900 |

7. **La consulta que dice si algo salió mal**, después de la ronda:

```sql
-- las cotizaciones donde el bot puso un número sin que el cliente anclara nada
select mensaje_cliente,
       senales->>'producto_pedido'  as pidio,
       producto_resuelto,
       senales->'descartados'       as se_descarto,
       senales->'sin_anclar'        as ejes_no_dichos,
       senales->>'puerta'           as puerta,
       final
  from bot.decisiones
 where accion = 'informo_precio'
   and jsonb_array_length(coalesce(senales->'anclados', '[]')) = 0
   and jsonb_array_length(coalesce(senales->'descartados', '[]')) > 0
 order by created_at desc;
```

Esa es la población de confident-wrong, determinística, sin juez LLM y sin que TG mire nada.

```sql
-- salud del compositor: 'ok' es la población a auditar, los demás son el canario
select split_part(split_part(notas, '(compositor:', 2), ')', 1) as veredicto, count(*)
  from bot.decisiones where notas like '%(compositor:%' group by 1 order by 2 desc;
```

Si los rechazos superan ~30%, apagá el kill switch (`const COMPOSITOR = false;` en
`Armar Prompt Compositor`, se edita en la UI sin re-importar) y traeme los veredictos: cada uno
dice exactamente qué regla se violó. `nombre_ajeno:<token>` además dice qué palabra lo disparó.

**Rollback:** re-importar `faq-bot-v7.json`. El SQL no necesita rollback — v7 ignora las columnas
nuevas. Rollback parcial más barato: el kill switch del compositor, que deja el motor nuevo y la
voz vieja.

---

## 7. Verificación

| gate | resultado |
|---|---|
| `node tests/code-harness.js` | **150/150**, 0 FAIL (125 de v8 + 5 anti-loop + 7 gate + 13 señal/conjunto cerrado) |
| `node tests/regen-arp2-twin.js` | gemelo `Armar Respuesta Precio 2` en sync |
| `node tests/validate-v8-import.js` | **0 errores**, 19 invariantes nuevos |

Los invariantes nuevos que el validador verifica uno por uno: `executionOrder v1`, los envíos sin
retry y con `onError`, que **ningún** nodo Code vuelva a comparar el anti-loop contra
`lastBotReplies`, que los cuatro guards usen `borradoresPrevios`, las dos reglas nuevas del gate,
que el rank-2 no vuelva a ser substring crudo, las cuatro piezas de la señal, la validación de
conjunto cerrado en los dos puntos, el endpoint pineado y el NFC.

---

## 8. Fixes post-aplicación — 2026-07-27

Martin aplicó el SQL, importó v8 y mandó los primeros mensajes reales. **Cada mensaje encontró un
bug.** Los cinco están arreglados y commiteados; el workflow que Martin tiene importado es
anterior a los cinco, así que **hay que re-importar antes de seguir la ronda**.

| # | Lo que pasó | Causa | Commit |
|---|---|---|---|
| 1 | El SQL de E0 murió en la **primera** variante | `variante_meta.display_variante` era `not null` sin default. El primer fix (pasar el nombre vivo) lo **rechacé yo mismo**: `coalesce(display_variante, v.name)` hace que un valor no nulo gane para siempre, y eso desincroniza 176 variantes del mostrador — es exactamente la falla de "el overlay miente" que el consejo había marcado. Fix correcto: `drop not null` | `2ffe24a` |
| 2 | **El gate rechazaba todo mensaje en español** (`nombre_ajeno:en`) | `prohibidos` se armaba con los tokens que aparecen ≤3 veces en el catálogo. "en", "con", "para", "plata", "lado" cumplen. El harness no lo vio porque su catálogo mock tenía 8 nombres de juguete: **la frecuencia sólo tiene sentido sobre el catálogo real** | `00b8a05` |
| 3 | Paráfrasis legítimas seguían cayendo | El diccionario COMUNES cubría funcionales pero no vocabulario del rubro. Decisión de Martin: sacar también los términos de oficio. 91 → 82 → **61 tokens**. Verificado en las dos direcciones: los ataques siguen cayendo, las paráfrasis pasan | `542314c` |
| 4 | Un turno entero perdido por **JSON con basura después del objeto** | El modelo cerró bien y agregó `\n"}`. `JSON.parse` sobre el string entero explota y el turno se va a handoff / degradado / ilegible, teniendo el objeto perfectamente formado adelante. Los **tres** nodos que parsean tenían el mismo bug. Fix: extractor del primer objeto balanceado, consciente de strings y escapes | `34d06ef` |
| 5 | El borrador decía `$88 c/u` y el compositor lo redactaba como **"por página"** | Mentira de unidad de 2× que ninguna otra regla ve: mismos dígitos, mismos tokens, mismo hedge. Causa raíz: ARP tenía `unidad_venta` y no lo decía — un `c/u` colgado hace que lo más cercano gramaticalmente sean las *páginas*. Fix doble: el borrador dice la unidad (`por hoja`) **y** el gate gana una regla 4c de conservación de unidad | `78b379d` |

**Y un cambio de voz pedido por Martin** (`b096767`, decisión logueada): fuera la leyenda inline
`(precio de lista; …)`, entra el aviso de canal *"Los pedidos se hacen por mail a
terminalgrafica@gmail.com o en el local; este canal es solo informativo."*, **una vez por
conversación** y sólo si el mensaje lleva plata. Sin estado nuevo: lo apaga el `avisoDado` que ya
existía. Protegido por dos redes del gate (hedge + `[[MAIL]]`).

**Verificación al cierre del 27:** harness **170/170** (los 150 de arriba + L/G/S/E/D/J/U:
anti-loop post-compositor, gate de nombre y hedge, señal y conjunto cerrado, diccionario, JSON
tolerante, unidad y aviso de canal) · gemelo en sync · validador 0 errores.

**Lo que estos cinco enseñan, para la próxima:** cuatro de los cinco eran invisibles para el
harness porque sus mocks codificaban una premisa más limpia que la realidad (catálogo de juguete,
JSON siempre válido, `c/u` como unidad universal). El harness prueba que el código hace lo que
dice; **no** prueba que la premisa sea cierta. Eso lo prueba la ronda.
