# Acta del consejo Opus — plan R7 (2026-07-25)

5 lentes Opus en paralelo sobre `plans/r7-refinador-y-resolucion.md` v1, con acceso al
workflow real, al catálogo exportado y a los nodos Code. ~640k tokens.
Lentes: red-team/plata · matching determinístico · UX-voz de mostrador · costo-ops-n8n ·
dominio imprenta.

**Veredicto del chair: construir, con el plan reescrito.** Ninguna lente rechazó el
refinador; las cinco encontraron que el plan v1 lo especificaba de una forma que rompía
cosas que hoy andan. Además aparecieron **tres bugs de plata vivos** que no eran parte del
encargo.

---

## A. Lo que el consejo encontró y NO estaba en el encargo

### A.1 Bugs de plata vivos (hoy, en el catálogo de testing)

1. **Promo inmobiliarias sub-cotiza.** La curación 24b puso `por_pack=false` para que el
   $15.000 leyera por cartel. Efecto lateral: habilitó `totalPermitidoFijo`. "¿Me hacés 3
   carteles?" → `3 × $15.000 = $45.000`; el precio real de 3 sueltos es $58.500. Faltan
   $13.500. Antes de la curación no pasaba porque `por_pack` mataba la cantidad.
2. **Los servicios de taller multiplican por hojas.** 18 variantes con `por_pagina=false` y
   `por_pack=false` (anillados, emblocados, abrochado, numeradora, armado de revistas).
   "Anillado para 120 hojas" con `cantidad=120` da `120 × $4.200 = $504.000`. Lo único que
   lo frena hoy es una línea del prompt. Los que **sí** deben multiplicar y no se tocan:
   ojales, bolsillos banner, trazado, perforaciones, puntas redondeadas, corte x millar.
3. **Talonarios Rifas 100 números**: cantidad horneada en el nombre, `por_pack=false`,
   `n_reglas_cantidad=1`. "500 rifas" cotiza 500 talonarios = 50.000 rifas. La regex de
   telemetría `(pack?)` no lo caza porque no mira `numeros|rifas|talonarios`.

### A.2 Dos cosas que dábamos por ciertas y son falsas

4. **`mostrable` no es un flag de curación.** La vista lo define como `(not tiene_reglas)`
   y **ningún nodo Code lo lee** (grep sobre los 68). La línea 138 de `preguntas-tg.md`
   ("el cartel suelto existe pero mostrable=false → deriva") está mal leída: el bot sí lo
   cotiza. Peor: `mostrable=false` en las 4 variantes de `OBRA 80 GR`, así que implementar
   "variantes visibles" con ese campo daría 0 filas justo en el producto del INC-18.
   Ocultar de verdad se hace con `oculto=true` en `variante_meta`.
5. **Ya son 2-3 llamadas LLM por turno, no 1-2.** `Guardrails Tier-2` es un nodo langchain
   con sub-modelo OpenRouter: es una llamada en cada turno. El "tope de 2 LLM/turno" que
   arrastrábamos del consejo del 24 estaba mal contado. Con refinador: 3 mínimo, 4 con
   Aclarador.

### A.3 Cosas menores con impacto visible

6. Los montos salen con centavos (`$85.000,00`). Ningún mostrador dice "con cero centavos".
7. **La rama de precio fijo imprime el monto sin unidad de venta.** `unidadOk` solo se
   calcula en `ok_rangos`. Por eso "La Lona Mate te queda en $18.000" se lee como el precio
   de la lona entera y no del m². Es la misma clase que "$15.000 por los 6".
8. **`unidad` es basura heredada**: 148 de ~180 variantes dicen "Hoja", incluidas lonas,
   carteles, anillados y porta banners. El render llega a decir "un taco, precio por hoja".
9. **Las variantes se ordenan alfabéticamente.** En impresiones eso pone "doble faz color"
   primero y "simple faz b/n" (la más pedida y la más barata) última — el primer ítem es el
   ancla de precio del cliente. En el anillado metálico el orden alfabético es orden de
   precio salteado: el que manda "2" se lleva el más caro de los cinco.

---

## B. Lo que el consejo corrigió del plan v1

### B.1 §2.2 "Get Precio devuelve todas las variantes" — **apagaba el motor** (bloqueante)

Toda la escalera de guards vive dentro de `if (rows.length === 1)` (ARP L90). Con la firma
nueva, 35 de 82 productos caen siempre en el `else` → `ambiguo`, y con `row = null` quedan
inertes `por_pagina`, `por_pack`, el gate de doble faz, el cap de volumen, los brackets y
todos los totales. Además el cap del menú rescate cuenta **filas**: "tarjetas" = 14 filas,
"papel obra" = 26 → las dos consultas más comunes se irían a email.

**Corrección:** la variante se resuelve **antes** de `evaluar()`, que sigue recibiendo 0 ó 1
fila más `variantes[]` aparte. Estados nuevos y con texto distinto: `producto_ambiguo` vs
`variante_ambigua`. Cap del rescate por **productos (≤6)**, nunca por filas.

### B.2 El guard de gemelos ancla mal y re-pregunta lo ya contestado

- `"20 hojas a4"` → discriminante crudo `{a4}` → ancla en el 106 (INC-14 sin arreglar).
  `"80 hojas"` y `"106 impresiones"` anclan como si fueran gramaje, que es exactamente lo
  que `GUARD NUMERALES` evita a propósito.
  **Corrección:** anclas **tipadas por eje** (`gramaje` solo de `\d{2,3}\s*(gr|grs|gramos)`
  o `<papel> de N`), un único extractor compartido con el guard de numerales, y
  discriminante axis-aware: `t discrimina ⟺ t ∈ ∪tokens ∧ t ∉ ∩tokens ∧ eje(t) ∈ ejes(todos)`.
- El `"2"` con que el cliente contesta el menú no contiene ningún discriminante → el guard
  vuelve a disparar el mismo menú → anti-loop → email al tercer turno.
  **Corrección:** la selección del menú anterior cuenta como ancla.
- Contradice la regla resuelta 140 (cuantización de pack): `"150 tarjetas"` no ancla
  `{100,500,1000}` → menú, cuando lo decidido es cotizar el tier.
  **Corrección:** grupos `por_pack=true` **exentos** del guard, van al motor de packs.
- **"El más grueso" / "el mejor papel" activan `PAPEL_RE`** → `papel_especial` → email. O sea:
  ofrecemos el menú 75/106 y la respuesta natural del cliente se va al mail.
  **Corrección:** si el turno anterior fue menú del bot, `papelEspecialHit` se suprime y
  "más grueso" mapea al mayor gramaje **del grupo ofrecido** (no es default: es leer la
  respuesta a la propia pregunta).

### B.3 El esqueleto no ve los pares que más plata mueven

| Par | Diferencia | Esqueletos |
|---|---|---|
| `OBRA 106 GR` vs `Impresiones a4 papel obra 106 gr` | **6,7×** ($800 la hoja vs $120-180 la página) | `obra` / `impresiones papel obra` |
| `Vegetal` vs `Papel Obra Vegetal Color/Negro` | **10×** ($1.000-2.000 vs $10.000-16.000) | distintos, y "vegetal" gana por rank 1 |
| `Folletos 10x15` obra b/n vs ilustración | **5,5×** ($12.000 vs $66.000) | distintos |

Ampliar la regla de esqueleto explota (`obra` está contenido en 8 esqueletos).
**Corrección:** esto se arregla por **curación** — empatar sinónimos para que el rank empate
y caiga en `ambiguo` → menú, que es el mecanismo ya probado con Kraft 130/300 y los Folletos.
El guard en código queda de **airbag, no de sustituto del dato**. Opcionalmente un campo
curado `familia_material` para el par láser/Riso.

### B.4 El refinador, como estaba especificado, era una regresión neta

1. **Los tokens opacos no impiden el error que queremos matar.** `«P1» c/u … total «P2»`:
   el refinador no sabe cuál es cuál, y "los dos packs te salen «P1»" pasa el gate. Es
   literalmente INC-21b y S6-5a, los dos incidentes que el §4.1 decía matar.
2. **Los números que no son plata son mutables**: cantidades, páginas, gramajes, medidas,
   rótulos de bracket, y los dígitos dentro del nombre del producto ("6 carteles", "106 gr").
3. **Renumerar el menú rompe el turno siguiente**: el especialista mapea el "2" contra el
   texto **enviado**; si el refinador reordena, el número apunta a otro producto sin ninguna
   señal.
4. **Las líneas de degradación** (`LINEA_DF`, `LINEA_CAP`, `LINEA_VOLUMEN`) son lo primero
   que borra un compresor, y son justo los casos donde el sistema decidió no dar total firme.
5. **El cap de ≤5 líneas es incompatible** con tablas (hasta 7 líneas) y menús (hasta 9):
   rechazo garantizado justo donde el borrador es más feo.
6. **Tokenizar por regex `\$[\d.,]+` lavaría plata alucinada**: el reply crudo del Aclarador
   y la rama `answer` no pasan por el chequeo `plataRe` que sí tiene la rama precio. Un monto
   inventado saldría con sello de sistema.
7. **`«»` ya está en uso** (envuelve el mensaje del cliente en el prompt del Aclarador) y es
   la clase de carácter que un modelo normaliza. Un cliente puede forjar `«P1»` vía eco.
8. **Mata los cuatro anti-loop.** Comparan igualdad normalizada contra `lastBotReplies`, que
   son los textos **enviados**. Si el refinador parafrasea, borrador ≠ enviado para siempre:
   el `noop` por repetición y las tres derivaciones anti-loop no vuelven a disparar nunca.
9. **Rompe `avisoDado`**, que se decide buscando el literal `terminalgrafica@gmail.com` en
   los salientes. Si el refinador lo saca, el bot anuncia el mail en cada turno.
10. **Con la config por defecto de n8n el turno muere** (stopWorkflow) ante un 429 y el
    cliente no recibe nada. Y sin `options.timeout` rige el default de 300 s.
11. **El drift semántico queda invisible**: `notas` describe el **borrador**, no lo enviado, y
    no hay ninguna columna con el texto final. El juez offline del confident-wrong estaría
    juzgando un artefacto que el cliente nunca vio.

**Corrección estructural: el refinador es un editor de bordes.** El borrador se parte en
**bloque literal** (líneas `N.`, tabla de rangos, líneas de degradación, la oración que
contiene un monto con su etiqueta, la dirección de mail) y **prosa refinable** (encabezado,
cierre, repregunta). Solo la prosa va al LLM. Gate de **conservación** relativo al borrador,
no denylist absoluta. Detalle completo en el plan v2 §5.

**El límite honesto que el consejo pide dejar por escrito:** después de excluir menús,
tablas, líneas de degradación y la oración del monto, lo que queda para humanizar son una o
dos oraciones. El nodo se justifica **por voz**, no por seguridad — y los menús horribles del
incidente 7 los arregla el render determinístico, no el refinador.

### B.5 El orden de construcción del plan v1 estaba al revés

Testear render (B4/B3) sobre un resolver que todavía elige mal hace que media suite falle por
razones de B2, y Martin no puede distinguir bug de redacción de bug de resolución. Además el
pulido de voz de B4 se reescribe en B1: retrabajo puro.

Y la premisa "cada nodo nuevo es configuración manual" es **falsa en este repo**: el JSON
exportado lleva `credentials` con id real en los 31 nodos que la necesitan. Si el bloque se
escribe en el nodo nuevo, el re-import lo deja andando. El cuello de botella no es el import:
es la ronda de WhatsApp. Por ahí hay que optimizar.

---

## C. Números de la lente de costo

| | 2.5-flash-lite | 3.1-flash-lite |
|---|---|---|
| 1 llamada del refinador | $0,000142 | $0,000420 |
| = % de 1 mensaje de Meta ($0,026) | **0,55%** | **1,62%** |
| Se paga solo si evita 1 mensaje cada… | 183 turnos | 62 turnos |
| Conversación completa (6 salientes) | $0,1587 → $0,1596 | $0,1635 → $0,1660 |

**El LLM es el 2% del costo del bot; el 98% es el conteo de mensajes.** El refinador no
ahorra ni suma mensajes de primer orden (no cambia la acción, solo redacta). Los mensajes los
ahorra la resolución: cada `sin_match` cuesta 1-2 salientes.

Latencia: hoy ~6,6 s p50 / ~11,5 s p95; el refinador suma ~1,2 s p50 / ~3,5 s p95 (**+18%
p50**), y es 100% visible. La decisión no se toma por costo, se toma por latencia y por
riesgo de regresión.

Volumen para dimensionar los menús extra: ~900 conv/mes ≈ 30/día, ~18 consultas de precio.
El guard de variante no anclada fuerza menú en el 43% del catálogo → **+6 a +9 menús/día**;
el de gemelos suma +2 a +4.

---

## D. Enmiendas mínimas consolidadas (las que entran sí o sí)

1. **Resolver la variante antes de `evaluar()`**; estados `producto_ambiguo` / `variante_ambigua`;
   cap del rescate por productos; `por_pack` exento del guard de gemelos.
2. **Anclas tipadas por eje** + un solo extractor compartido con el guard de numerales +
   la selección del menú anterior como ancla válida.
3. **Una sola normalización** (acentos + `(\d)\s*(gr|grs|gramos)`→`$1 gr` + puntuación→espacio
   + colapso) usada por `Get Precio` **y** `Get Opciones` — hoy la rama menú no tiene rank 2 y
   los 8 términos genéricos más comunes dan `menu_sin_match`.
4. **Flags curados `por_trabajo` y `min_unidades`** — cierran los dos bugs de plata que pueden
   imprimir un número absurdo con cara de correcto.
5. **`frasePrecio()` única**: ningún monto se imprime sin su unidad de venta y su condición en
   la misma oración; sin centavos.
6. **El refinador es editor de bordes**, con gate de conservación (multiset de dígitos, índices
   de token en orden creciente, contención monótona de `$`, `@` y lexicón de riesgo, montos
   estampados **desde los valores de la DB**), delimitador `[[P1]]` con pre-normalización NFKC,
   y conteo de líneas `^\d+\.` preservado.
7. **Topología antes que refinador**: un solo `Enviar Mensaje` y un solo `Log Turno` sobre
   `$json` (68 → 64 nodos), que además mata el bug de `runIndex` del `volver` y el envío del
   borrador sin refinar en la rama answer.
8. **`bot.decisiones` guarda `borrador` y `final`**; los anti-loop comparan contra el borrador
   persistido; `notas` mapeado en el log de la rama answer.
9. **`Llamar LLM Refinador` = clon de `Llamar LLM Aclarador`**: `continueRegularOutput` +
   `alwaysOutputData` + `timeout 6000` + sin `retryOnFail` + `models: [2.5, 3.1]` +
   `response_format: json_object`; `Aplicar Refinador` lee el borrador de
   `$('Armar Prompt Refinador')` y corta si `$runIndex > 0`.
10. **Kill-switch** `const REFINADOR = true;` en la primera línea, para prender y apagar desde
    la UI sin re-importar, y ronda A/B contra la misma conversación.

---

## E. Desacuerdos que quedan vivos

1. **Cuantización de packs.** La regla resuelta el 24 ("próximo tier hacia arriba") sobre-cotiza
   contra la cobertura por combinaciones: 150 tarjetas simple faz → $28.000 (tier 500) contra
   $24.000 (2×100); folletos ilustración 1500 → $223.000 contra $186.000, un 20%. Y la banda no
   es uniforme: en DF Encapsuladas a 501-600 el tier de 1000 **sí** gana. La lente de dominio
   propone `mejorCobertura()` sobre combinaciones de hasta 2 packs, presentando el más barato
   primero y el tier de arriba como upsell con la diferencia explícita. **Choca con una decisión
   ya tomada por Martin/TG → va a decisión, no se aplica solo.**
2. **Gemelos 75/106 como un producto con un eje más.** La lente de UX propone exponer el
   gramaje como eje (igual que la limpieza v10.8 hizo con el color) en vez de dos productos con
   las mismas 4 variantes. Es más limpio y ahorra 4 líneas de menú, pero es curación grande.
3. **Los 4 textos fijos** (`Mensaje Escalación`, `Saludo Bienvenida`, `Respuesta No-Texto`,
   `Mensaje Cap Email`) no pasan por el refinador. Contradice "TODO texto que salga al chat".
   El consejo recomienda dejarlos fijos y **escribirlo** para que no se reabra: convergerlos
   llevaría la convergencia de 3 a 7 ramas.
