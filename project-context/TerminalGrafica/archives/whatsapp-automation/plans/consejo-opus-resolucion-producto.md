# Acta del consejo Opus — la resolución de producto (2026-07-26)

6 lentes Opus en paralelo sobre la pregunta *"el LLM sigue eligiendo el nombre del producto de
un catálogo pegado en el prompt — ¿qué caminos hay?"*, con acceso al workflow real, al catálogo
exportado, a la migración E0 y a los nodos Code. ~1M tokens.

Lentes: matching determinístico · salida estructurada (con web) · red-team/plata ·
costo-ops-n8n · dominio imprenta y voz · datos y curación.

**Veredicto del chair: la pregunta estaba mal escalada, y el consejo encontró cosas más
urgentes que la respuesta.** Ninguna de las seis direcciones candidatas sobrevive como cambio
de arquitectura. Las dos que sobreviven (E y F) son baratas, no dependen de ningún proveedor,
y **F hay que construirla primero porque hoy el log destruye la evidencia** que haría falta
para saber si algo mejoró. Además aparecieron **cinco bloqueantes de go-live**, dos de ellos
introducidos por v8 y no detectados por el harness.

---

## A. Lo que el consejo encontró y NO estaba en el encargo

### A.1 Dos regresiones de v8, verificadas en el código

**1. El compositor mató los tres anti-loops. Bloqueante.**

`Decidir` L108 arma `lastBotReplies` desde `botOut`, o sea los mensajes **salientes de
Chatwoot** — que desde v8 son el texto **compuesto**. Los tres guards comparan contra el
**borrador determinístico**:

| guard | línea | compara |
|---|---|---|
| anti-loop de `answer` | `Parsear Respuesta` L92-95 | `normRep(reply)` vs `lastBotReplies` |
| anti-loop de repregunta | `Armar Respuesta Precio` L445 | `normRep0(reply)` vs `lastBotReplies` |
| anti-loop del Aclarador | `Aplicar Aclarador` L17-19 | ídem |

El compositor parafrasea, así que las dos cadenas ya nunca son iguales. **Ninguno de los tres
dispara.** Consecuencia: el bot puede repreguntar lo mismo indefinidamente y **nunca derivar a
mail**, pagando cada vuelta (~USD 0,026 desde oct-2026).

El harness pasa 125/125 porque el caso V8-17 mockea `lastBotReplies` con el borrador exacto:
**hardcodea la premisa pre-compositor.** El test no está mal escrito; está escrito contra el
mundo anterior.

Arreglo: `Get Ruta Cotizador` con `limit 3` devolviendo la columna `borrador` (que E0 ya
agrega) y que los tres guards comparen contra eso. 0 nodos nuevos.

**2. El gate del compositor no protege el nombre del producto ni el hedge.**

Las 5 reglas de `Aplicar Compositor` L36-51 son: tokens, `$`/`@`, multiset de dígitos, léxico
de riesgo **monótono decreciente**, y largo. Verificado por inspección: **no hay ninguna regla
de nombre y ninguna de hedge.** El red-team pasó 12 de 19 ataques con veredicto `ok`:

```
PASA  borrador "La opción 35X50 CM de Cartón sale $2.000,00."
      cliente  "El montado sobre cartón de 35X50 CM te sale $2.000,00."   (vale $4.000)

PASA  borrador "...de Lona front brillo sale $16.000,00."
      cliente  "La lona uv brillo te sale $16.000,00."                     (la UV vale $22.000)

PASA  se borra "El total del doble faz te lo confirma el equipo."
PASA  "total estimado $90.000,00"  →  "precio final $90.000,00"
```

Renombrar a otro producto real pasa las 5 reglas: los tokens quedan intactos, no hay `$`
propio, los dígitos no cambian, el léxico de riesgo no aumenta y el largo es similar. Borrar
el caveat también pasa, porque la regla 4 permite explícitamente que el léxico aparezca
**menos** veces, y `estimado` / `lista` / `confirma` no están en la regex.

`plans/v8-build.md` §9 dice *"el gate compara valores, no layout"*. **El hedge es un valor**, y
el gate lo trata como layout. Es un error de mi redacción del gate, no del diseño: las tres
líneas `LINEA_DF`, `LINEA_CAP` y `LINEA_VOLUMEN` son exactamente los casos donde el sistema
decidió **no** dar un total firme, y son lo primero que borra un compresor.

Arreglo: dos reglas más en `Aplicar Compositor` — conservación de nombre (los tokens que
vinieron de `row.nombre_canonico` / `row.variante` tienen que sobrevivir) y conservación de
hedge (lista fija, el conteo no puede bajar). Rechazar = mandar el borrador = conducta de hoy.

### A.2 Tres cosas rotas de antes

**3. Los cuatro nodos de envío al cliente cobran triple ante un blip.** `Enviar Mensaje`,
`Mensaje Firewall Refusal`, `Mensaje Refusal Tier-2` y `Aviso Rate Firewall` tienen
`retryOnFail: true, maxTries: 3` y **ningún `onError`**. Chatwoot está detrás de un túnel de
Cloudflare: un 504 después de que Chatwoot ya aceptó el mensaje manda **3 mensajes pagos
duplicados** y el cliente ve la misma respuesta tres veces. Es el único lugar del workflow
donde reintentar es peor que fallar.

**4. `wf.settings` está vacío.** `grep errorWorkflow` da 0 en v7 y en v8, aunque
`n8n/flows/tg-bot-error.json` existe: el error workflow nunca se enganchó. Y sin
`executionOrder: "v1"` explícito, n8n aplica el orden legacy al importar.
`tests/validate-v8-import.js` **no mira `settings` en ningún momento** — es un agujero de la
validación, no del workflow.

**5. El SPOF del catálogo entra al prompt.** Si `Get Catálogo` falla y `staticData` está vacío,
`Guardar Cache Catálogo` L12 emite el literal `'(catalogo no disponible)'` y ese string va
derecho al system prompt. La regla 7 del mundo cerrado se evapora en silencio y el bot contesta
sin catálogo. Nadie aguas abajo lo frena y el harness no lo testea.

### A.3 Una decisión firmada que no se construyó

**El default obra 75 / simple faz / b/n con puerta abierta** (Martin, 2026-07-26,
`plans/e0-atomizacion-catalogo.md` §6 bis) **no está en v8**. `grep "obra 75"` da 2
ocurrencias, las dos dentro de un comentario sobre la aritmética del doble faz. Tampoco figura
en la lista de exclusiones deliberadas de `v8-build.md` §3: fue una omisión, no una decisión.

Importa porque es **lo único de todo este análisis que saca un mensaje pago** en vez de
agregarlo. "Necesito imprimir 150 hojas" hoy cuesta 2 mensajes salientes (menú + precio); con
el default cuesta 1. A 30 consultas/día son ~USD 23/mes, contra un abono de USD 30/mes.

Y al lado hay un defecto de voz: cuando el producto es `por_pagina`, `Armar Menu Opciones`
pregunta *"cuántas páginas tiene tu documento"* **sin mirar la cantidad que el cliente ya
dijo**. Un mostrador no hace eso.

### A.4 Bugs de matching vivos

**6. El rank-2 de `Get Precio` (L17-19) hace substring sin frontera de palabra.**
`producto = "lona"` matchea `ta·lona·rios` — hoy *"una lona de 3x2"* trae `Talonarios Rifas`
entre los candidatos. Fan-out real: `papel` → 13 productos, `obra` → 10, `sobre` → 5,
`lona` → 5. Y al revés: **`fotocopias`, `80gr` y `a4` traen cero**.

**7. `"me hacen fotocopias?"` cae en la posición 71 de 82.** La palabra no existe en ninguna
superficie del catálogo. Es un agujero de curación, no de algoritmo.

**8. Nueve hijacks de rank-1 vivos**, donde un sinónimo exclusivo de A es además substring del
nombre de B, y el rank-1 de A borra el empate que habría dado `ambiguo`:

| sinónimo | resuelve a | tapa a | ratio |
|---|---|---|---|
| `papel ilustracion` | Ilustración Mate 250 ($900 la hoja) | Folletos ilustración ($66.000 x500) | **73×** |
| `papel ilustracion brillo` | Ilustración Brillo 150 | ídem | **82×** |
| `carton` | Cartón ($2.000) | Montado sobre cartón ($4.000) | 2× |
| `lona brillo` | Lona front brillo ($16.000/m²) | Vinilo/Lona UV ($22.000) | 1,4× |
| `100 tarjetas` | 100 Tarjetas Color/Negro ($12.000) | 100 Tarjetas Kraft ($16.000) | 1,3× |
| `apuntes de medicina` | medicina (nicho, $45/pág) | cualquier consulta con "apuntes" | — |

Kraft y Folletos ya se arreglaron en la curación 24. **El punto no son los 9: es que cada uno
se encontró a mano y la lista se regenera con cada alta del mostrador.**

**9. `atributos.unidad_venta` nunca llega a la frase.** `unidadOk` sólo existe en la rama
`ok_rangos` (ARP L334). La rama de precio fijo imprime *"sale $18.000,00"* sin unidad,
teniendo `unidad_venta: 'm2'` en la fila. Una lona de 2×1 son 2 m² = $32.000 y el cliente lee
$16.000. El consejo r7 ya lo había marcado; v8 ahora **tiene el dato** y sigue sin usarlo.

**10. `fallback: producto_incoherente` es un trigger muerto del Aclarador.** ARP L17 lo lista
en `TRIGGERS_ACLARADOR`, pero `REPREGUNTA` (L362-367) no tiene entrada, cae al `else` de L434
que deja `accionLog === 'informo_precio'`, y L479 exige lo contrario → `needsAclarador` siempre
false. El guard de numerales, que caza la clase de plata I2, deriva a mail en vez de resolver.

---

## B. La pregunta original: qué sobrevive de A-F

### B.0 El hallazgo estructural que ordena todo

Cruce sobre los 82 productos vivos: ¿tiene un token propio que ningún otro producto tiene, y
tiene un vector de atributos E0 único?

|  | atributos únicos | atributos colisionan |
|---|---|---|
| **token propio en el nombre** | 41 | **17** |
| **sin token propio** | **22** | 1 |

- **17 productos que sólo el NOMBRE identifica**: Ojales, Numeradora, Perforaciones, Puntas
  Redondeadas, Corte x Millar, Bolsillos banner, Encuadernado, Refilado, Abrochado, Armado de
  Revistas, Cartón, Montado sobre cartón, medicina, UV Holográfico, Sobre Inglés, 100 y 1000
  Tarjetas. Son **servicios**: su identidad es un sustantivo, no una combinación de atributos.
- **22 que sólo los ATRIBUTOS identifican**: los 6 tacos, los 3 plastificados, los 2 anillados
  plásticos, Lona Mate, Vinilo Mate, Kraft 130, OBRA 106 GR, Impresiones obra 75.

**Su unión cubre 80 de 81. Nombre y atributos son complementarios, no rivales.** Cualquier
arquitectura que elija uno solo pierde ~25% del catálogo por diseño. Esto valida la forma de
v8 (nombre para producto, atributos para variante) y explica por qué D no puede funcionar.

### B.1 La asimetría de plata que re-escala la pregunta

| qué se elige mal | costo del error |
|---|---|
| el **producto** (incidente 14) | **1,0× a 1,25×** — Kraft 130 vs 300 es $800 vs $1.000 |
| la **variante** dentro del producto correcto | **4× a 6×** — obra 75 va de $100 a $600 |

v8 ya atacó la variante (§2.4, §2.5). **El consejo fue convocado para el modo de falla más
barato.** La excepción es el incidente 19, que no es un precio mal sino un **lead perdido**, y
es el más barato de arreglar de todos.

Contra-dato de la lente de dominio, que hay que tener a la vista: para un documento genérico
("unos apuntes", 180 páginas) el spread entre los 5 candidatos plausibles es **17,8×** —
$8.100 con el producto de medicina contra $144.000 con la láser 106. Cuando el cliente **no
ancla nada**, elegir mal el producto sí es catastrófico. La asimetría vale para pedidos
anclados, no para los genéricos.

### B.2 Direcciones descartadas

**A — IDs opacos. Descartada, unánime.** Destruye la única señal que queda: con `P047` no hay
similitud, no hay margen, no hay empate. Un error de un carácter cae en un producto arbitrario
de otro rubro sin ninguna traza. Y no ahorra tokens, porque el nombre legible tiene que quedar
igual para el mundo cerrado: el ID es **además**, no en vez de. Convierte un fallo ruidoso
(nombre inventado → `sin_match` → mail, recuperable) en uno perfectamente mudo.

**D — el LLM describe el pedido, el matcher resuelve. Muerta, por datos, medida dos veces
independientemente.**

| contrato | productos unívocos |
|---|---|
| 9 slots de `e0 §6` tal cual | **42/82 (51%)** |
| + `familia` | 53/82 (64%) |
| + `tamano` + `medida` | 59-69/82 |
| **las 21 claves de E0** (incluidas las que el cliente nunca dice) | 76-78/82 |

Los seis servicios de taller tienen el vector **exactamente idéntico**: `familia=taller` y nada
más. **13 a 17 productos no tienen ni un slot emitible.** Una regla que prohíbe nombrar el
producto (regla 3 del contrato) hace **literalmente imposible pedir un anillado**. Y el par de
6,7× (riso vs láser 106) lo separa `tecnologia`, que no tiene slot y no puede tenerlo: a nadie
se le pregunta por la máquina.

Esto no se arregla atomizando más. **La información no está en los atributos: está en el
sustantivo.** Si el sustantivo vuelve al contrato, D colapsa en E.

*Disidencia parcial del red-team:* D es la única que ataca la causa y arregla o vuelve ruidosos
11 de 15 casos de su batería adversarial (falla justo en sus dos colisiones conocidas). Pero
condiciona su recomendación a curar antes los 6 residuales, y coincide en el número de
colisión. Queda registrada como el camino de largo plazo si alguna vez se cura la capa de
servicios, no como el de esta ronda.

**C — sacar el catálogo del prompt. Descartada la parte de sacarlo; adoptado el retrieval como
agregado.** Tres razones independientes:

1. **No ahorra.** El catálogo está en la línea 145 de 148 del system prompt, o sea **adentro
   del prefijo cacheable**, a 0,1× de precio. Sacarlo para meter K candidatos sin cachear da
   **−USD 0,33/mes**: pierde plata. La factura de LLM entera son USD 3,67/mes hoy (9,81 desde
   octubre) contra **USD 105/mes de Meta**.
2. **El catálogo sostiene seis funciones, no una.** Además de nombrar: la frontera del mundo
   ("¿hacen sellos?"), la whitelist de ejes por producto (preguntar por un eje es afirmar que
   existe), el mapa `*`/`**` que decide si se puede prometer un número o hay que derivar, la
   selección de candidatos, y el contraste "ajeno vs dudoso". Cinco se caen con él.
3. **No hay umbral que lo reemplace.** Medido sobre 12 pedidos que TG no hace y 6 que sí:
   `"impresion 3d"` → 0,63 (UV Holográfico) contra `"anillado"` → 0,53. **El máximo de afuera
   supera al mínimo de adentro.** No existe corte que distinga "lo tenemos" de "se parece a
   algo que tenemos".

De ahí sale una regla que no se negocia: **el difuso jamás confirma un producto — sólo propone
candidatos a un paso que pregunta.**

**B — enum en el esquema de salida. Degradada de "garantía estructural" a "optimización".** Es
la que mejor suena y la peor aguanta el contacto con la plataforma:

- La doc de OpenRouter, verbatim: *"providers that don't support all the LLM parameters
  specified in your request **can still receive the request, but will ignore unknown
  parameters**"*. **El silencio es el comportamiento por defecto**, y hoy el workflow no manda
  `provider`.
- El umbral empírico del `400 INVALID_ARGUMENT` de Gemini está reportado **alrededor de los
  100 valores de enum**. Son 84 productos: al filo, en un catálogo que TG amplía sin avisar.
- `variante` depende de `producto`. El enum de pares son **177 valores** (muerto), y el `anyOf`
  de 84 ramas tiene **degradación silenciosa documentada** exactamente en OpenRouter→Gemini
  (pydantic-ai #3617, dic-2025).
- El array `models: [2.5, 3.1]` existe justamente para que el 16-oct el primario tire 404 y
  caiga al sucesor **en silencio**. Si el endpoint de fallback no honra el esquema, la garantía
  se evapora en una fecha que ya está en el calendario.
- Y el riesgo de fondo: **el enum garantiza que el string exista, no que sea el correcto. Al
  garantizar que exista, borra la única señal que hoy delata el error.** El incidente 19
  (ruidoso) se convierte en incidente 14 (silencioso). La métrica de `sin_match` va a caer a
  casi cero y **eso va a parecer una victoria**.

Si alguna vez entra: sólo sobre el slot `producto`, con `require_parameters: true`, con un
miembro explícito `"ninguno_de_estos"`, y **después** de la validación de conjunto cerrado, no
en vez de ella.

### B.3 Lo que sobrevive

**E — validación de conjunto cerrado + reparación. Unánime, 6 de 6.** El set de nombres válidos
ya está en memoria: sale del mismo `_catalogo` cacheado que arma el prompt. Normalizar y
comparar. Si el nombre que emitió el LLM no está en el set, no va a mail: va al Aclarador, que
ya existe en v8, ya es jailbreak-safe y ya tiene salida de lista cerrada.

**~25 líneas, 0 tokens, 0 llamadas LLM, 0 nodos nuevos, 0 dependencia de proveedor.** Es la
única garantía dura de todo el consejo: no depende de Google, ni de OpenRouter, ni del modelo,
ni de octubre. Mata el incidente 19 por construcción.

Dos condiciones: (a) la reparación difusa se loguea con su distancia y **si no es única, se
pregunta**; (b) rama "cache más viejo que N días → fail open", porque el `staticData` sólo
persiste en la URL de producción y un cache viejo rechazaría nombres que ya son válidos.

**F — la señal del confident-wrong. Unánime, 6 de 6, y las seis lentes convergieron en el mismo
mecanismo desde ángulos distintos.**

> **La señal no es "qué tan bueno es el match". Es "cuánto del match lo puso el cliente y
> cuánto lo puse yo".**

Las seis formulaciones, que son la misma:

| lente | cómo lo dijo |
|---|---|
| dominio | `ancla`: qué ejes nombró el cliente, en las claves que E0 ya atomiza |
| datos | correr el difuso sobre la frase del cliente en paralelo al nombre que eligió el LLM; empate del difuso + ganador único del LLM = ancló algo que el cliente no dijo |
| matching | cobertura de tokens: si los que decidieron el match son todos genéricos y ninguno es *hapax*, el pedido no está anclado |
| costo | el eje que separa al top-2 no aparece en el mensaje crudo → predicado determinístico, cuesta un `Set.has()` |
| red-team | *"la resolución fue única SÓLO porque un rank mejor eliminó competidores"* — hoy se computa (ARP L114-117) y se tira |
| structured | todo atributo que distingue a este producto de otro del mismo eje y que el cliente nunca mencionó es una elección no anclada del LLM |

**Por qué la regla de gemelos de v8 no cubre esto, verificado en código.** ARP L396 la
condiciona a `estado === 'fallback: ambiguo'`, dentro del `else` que arranca en L356. Y aunque
se moviera al camino `ok`, `ejeDiscriminante(main.rows)` exige 2 productos en `main.rows`: **si
el LLM nombró un producto exacto, el gemelo nunca se trajo de la base.** Devolvería `null`
igual. La regla de gemelos es una defensa contra la **ambigüedad**, no contra la **confianza**,
y no es reparable en su lugar actual.

Agravante estructural: **48 de 83 productos son mono-variante (58%)**, y para ellos `ambiguo`
es inalcanzable — `Get Precio` L51 garantiza la fila aunque el slot `variante` sea basura.
Toda la defensa nueva de v8 cuelga de un estado que más de la mitad del catálogo no puede
alcanzar.

**Y el agujero que bloquea todo lo demás:** ARP L502 loguea `nombreProd(main, null) ||
p.producto`, o sea **el canónico de la base cuando las filas resolvieron. En el camino de
éxito, el string crudo que tipeó el LLM se destruye.** No se puede saber offline si el modelo
escribió `"papel kraft"` (hijack) o `"Papel Kraft 130 Gr"` (elección deliberada). `var_rank` no
se loguea nunca. **La clase de fallo que el consejo vino a resolver es indetectable desde el
log, por construcción.**

---

## C. Qué construir, en orden

**F va primero.** No por elegancia: porque todo lo demás **sube la tasa de fallo ruidoso** (más
`sin_match`, más repreguntas, más rechazos del compositor) y el silencio sigue sin medirse. Sin
F, el efecto visible del endurecimiento es "el bot empeoró", y se revierte lo correcto.

| # | qué | por qué | costo |
|---|---|---|---|
| **0** | **Los 5 bloqueantes de §A.1 y §A.2** | dos son regresiones de v8; el resto cobra mensajes duplicados y deja el bot sin red | 0 nodos nuevos |
| **1** | **F1-F3: la señal.** `p.producto` verbatim + `match_rank` + `var_rank` en el log; un CTE en `Get Precio` que devuelva los candidatos que el filtro de rank acaba de borrar; el conteo de ejes de la fila que el cliente **no** ancló | sin esto nada es medible ni falsable | 1 `alter table`, 1 CTE, ~15 líneas |
| **2** | **F4: diff del compositor, no veredicto.** `(compositor:ok)` es inútil — `ok` es justo la población a auditar. Guardar los tokens de nombre y las frases de hedge presentes en `borrador` y ausentes en `final` | caza mecánicamente los renombrados y los borrados de caveat | ~10 líneas |
| **3** | **E: validación de conjunto cerrado** | mata el incidente 19 por construcción; cierra el agujero de `Aplicar Aclarador` L28-32, único punto donde un nombre tipeado por un LLM llega al cliente sin pasar por la base | ~25 líneas, kill switch propio |
| **4** | **El guard de ancla** (la respuesta real al incidente 14) | dispara cuando la fila resuelta tiene ejes que el cliente nunca nombró → caveat explícito o repregunta del eje | ~30 líneas en ARP + gemelo |
| **5** | **Curación dirigida por los números**: frontera de palabra en el rank-2; `fotocopias`; podar `apuntes de medicina` y los otros hijacks; formas verbales (`anillar`, `plastificar`, `refilar`) que hoy no existen en ninguna superficie; sinónimos de mostrador en obra 75, que es el default y tiene la lista **vacía** | 16 de 22 verbos de mostrador no matchean nada | SQL de overlay |
| **6** | **El default obra 75 firmado**, con la puerta abierta **pegada al monto** y nombrando el color primero (el color mueve 4×, el gramaje 20%) | único cambio que **saca** un mensaje pago | prompt + ARP |
| **7** | **Housekeeping de ops**: `provider: { order: ['google-ai-studio'] }` para no diluir el cache entre 5 endpoints; `.normalize('NFC')` sobre el mensaje del cliente; `trim()` del lado catálogo en el SQL | ~USD 2/mes y dos bugs latentes | 3 líneas |

**Lo que NO se construye:** ninguna de las seis direcciones como cambio de arquitectura. El
catálogo se queda en el prompt. El LLM sigue eligiendo el nombre. Lo que cambia es que ahora
se valida contra un conjunto cerrado y se registra **quién puso el ancla**.

---

## D. Riesgos que el consejo deja anotados

1. **Todo esto sube el ruido.** Cada repregunta cuesta ~USD 0,0287 (mensaje + turno LLM), o sea
   **23× lo que cuesta mandar el catálogo entero una vez**. Del otro lado, un error en folletos
   son ARS 234.000. Preguntar es el lado barato — preguntar *siempre* no. El contador diario de
   mensajes salientes con alerta (ya P0 en `prod-readiness-review.md`) deja de ser opcional.
2. **El default de §C.6 es una máquina de confident-wrong si la puerta abierta va al final.** En
   WhatsApp la gente lee el número y deja de leer. La condición tiene que viajar **pegada al
   monto**. Y la falsación está definida: de las cotizaciones con default b/n, si más del ~15%
   contesta "en color" en el turno siguiente, el color deja de ser default y pasa a pregunta.
3. **`ancla` depende de que un modelo chico distinga "lo que el cliente dijo" de "lo que yo
   elegí".** Si ecoa, la señal siempre dice "sí, ancló" y el guard nunca dispara — peor que no
   tenerlo, porque da ilusión de cobertura. Test previo: 20 mensajes donde el cliente
   deliberadamente no nombra el gramaje; si `ancla.gramaje_gr` vuelve no-null más de 2 o 3
   veces, se construye determinístico contra el texto crudo, no en el LLM.
4. **La sincronización con el mostrador es peor de lo que creíamos, y al revés de lo que
   creíamos.** El overlay se une por **UUID** (`catalogo-limpio-overlay.sql:58-65`), no por
   clave natural. Un **renombre** deja los atributos vivos y **mintiendo**; un **borrar y
   recrear** los hace desaparecer por cascade. La tasa de renombre **nunca se midió**: una query
   comparando `nombre_origen` con el nombre vivo, corrida a mano 4 semanas, decide si el
   watchdog es necesario o sobre-ingeniería.
5. **`unidad_venta` tiene cobertura 100% y confianza mucho menor.** 76 filas decididas por
   Martin + 24 "confirmadas por omisión" + **exactamente 3 confirmadas por TG**. Es la clave que
   mueve más plata (`multiplica`) y la pregunta 52 sigue abierta sobre eso.
6. **`servicio` e `impreso_en` son parches de modelado sobre datos posiblemente sucios.** Se
   inventaron para separar pares que el catálogo no separa (Cartón vs Montado; los dos PVC al
   mismo precio). Si TG contesta la 64/65 diciendo que el precio estaba mal, esas claves no eran
   propiedades del negocio: eran síntomas.
7. **`Sobre Inglés` duplicado**: E0 le da el **mismo vector de atributos** a los dos. Inofensivo
   hoy porque uno está oculto, pero si TG contesta la pregunta 37 y se lo desoculta, vuelve un
   gemelo que **ni el nombre ni los atributos separan**.

---

## E. Correcciones de hecho al brief del consejo

| lo que decía | lo verificado |
|---|---|
| catálogo ~11k caracteres | **17,1k a 18,5k chars ≈ 4.750-5.015 tokens**, medido por tres lentes por separado |
| 88 productos | **82 vivos** (el export del 23-jul quedó atrás de dos curaciones); E0 escribe 83, uno oculto |
| el overlay se ata por clave natural y un renombre lo desconecta | se ata por **UUID**; un renombre deja los atributos **stale**, que es peor |
| el catálogo está para nombrar | sostiene **seis** funciones; el 68% de sus bytes (sinónimos + casos de uso) es un índice invertido escrito a mano |
| `Get Precio` rank 2 = LIKE con ≥4 chars | correcto, pero **sólo contra `nombre_canonico`**: los ~350 sinónimos entran únicamente por igualdad exacta, o sea casi no trabajan en el SQL |
| el compositor necesita vocabulario del catálogo | el compositor **nunca vio el catálogo** — recibe sólo el borrador tokenizado. Tampoco ve el mensaje del cliente, así que la regla *"nombrá los productos como los nombra el cliente"* es inaplicable en la rama precio |
| existe una columna de flags en `bot.decisiones` | no existe: `p.flags` se concatena dentro del texto de `notas`, y en todo el sistema tiene **un solo valor posible** |

---

## F. Estado

**Nada construido.** Este documento es el acta del consejo, no un plan aprobado. El paquete
E0 + v8 sigue sin aplicar; el consejo recomienda **aplicarlo igual** (la lente de datos lo
auditó: 222 literales verificados, 0 ilegibles, 83/83 y 139/139 claves resueltas, propiedad de
degradación verificada en código y harness) **con los bloqueantes de §A.1 arreglados primero**,
porque los dos son regresiones que v8 introduce y que el harness no ve.
