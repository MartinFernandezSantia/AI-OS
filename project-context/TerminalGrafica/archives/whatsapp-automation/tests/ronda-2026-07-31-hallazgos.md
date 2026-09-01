# Ronda del 2026-07-31 — suite 8 sobre `faq-bot-v10-live` en WhatsApp real

> Corrida de Martin sobre el bot con la cadena de 5 agentes. 16 hallazgos, mezclados:
> errores de ejecución que tiran turnos, confident-wrong con plata adentro, decisiones de
> producto y una propuesta de re-arquitectura. Este archivo los separa por clase y por
> costo, porque tratarlos como una sola lista es la forma segura de no arreglar ninguno.
>
> **Decisión de alcance (Martin, 2026-07-31):** primero los bugs concretos; la
> re-arquitectura del filtro (§D1) va a su propia ronda con su propia medición.

---

## §A. Plata — cuestan dinero o lo hacen perder

**A-1. Cotizó 999.999 impresiones: $399.999.600.** ⚠️ *el más caro de la ronda*

> `necesito 999999 impresiones a3 en tonner negro, cuánto en total?` → **$399.999.600**

Un total de nueve cifras screenshoteable. v10 no heredó el `cap_volumen` de v7 y la
suite ya lo anticipaba (A10: *"si sale el total gigante, es un gap nuevo, no una
regresión"*). Confirmado: es gap, no regresión.

- **Decisión de Martin:** cap al **TOTAL**, no al turno. Arriba de **$200.000** no se
  emite total, pero **sí el unitario**, y se dice que el volumen lo cotiza el equipo. El
  cliente se lleva información útil igual.
- **Dónde va:** `Calcular Montos`, junto a las otras condiciones del total. Motivo nuevo:
  `motivoSinTotal: 'volumen'`.

**A-2. El cartel suelto desapareció detrás de la promo.**

> `cuánto sale un cartel de 1x0.65 para inmobiliaria? necesito 3`
> → *"El precio unitario para 3 carteles de 1x0,65 m se confirma por mail"* + la promo.

El unitario real ($19.500) **nunca se dijo**. La suite A5 pide exactamente lo contrario:
la promo como alternativa **y** el suelto cotizado.

- **Causa medida:** el selector emitió `terminos` que incluían `inmobiliaria`, y
  `Leer Selector` los pega en un solo string (`terminos.join(' ')`). Eso hizo dos cosas:
  (1) habilitó el guard de nicho del SQL, que sin el rubro habría filtrado la promo;
  (2) la promo matcheó más tokens que el cartel suelto, y con el corte relativo
  (`score >= 0.4 × mejor`) el suelto quedó afuera.
- **Lo que Martin anotó:** *"al no buscar por palabra y solamente por frase solamente
  trajo la promo y no la versión normal unitaria"*. Confirmado en el código.

**A-3. Papel vegetal: cotizó $1.000/hoja × 10 = $10.000.**

> `cuánto sale el papel vegetal a4 x10?` → *"$1.000 por hoja. Por las 10 unidades, el
> total es $10.000"*

El total sale bien, pero **falta el dato de negocio**: ¿para qué se usa el papel vegetal?
Si es soporte de impresión, tiene que estar en la lista de sugerencias de impresiones y
hoy no está. → **pregunta TG nueva**.

---

## §B. Errores de ejecución — el turno muere

**B-1. `Syntax error at or near "Hola"`** y **`Syntax error at line 23 near ">"`**

Los dos en `Buscar Candidatos`. Contexto: el primero salió cuando un `Hola?` quedó
colgado de un server caído y entró junto al mensaje siguiente; el segundo, en el turno de
los tres pedidos del evento.

**Lo que se descartó (verificado):**

1. **Inyección por el valor.** Los tres nodos Postgres usan `queryReplacement` con
   parámetros preparados (`$1/$2/$3`). Un `>` o un `Hola?` dentro de un parámetro no puede
   romper el SQL. Primera hipótesis, descartada.
2. **Dollar-quoting de las tools.** Dos tools usan `$$…$$` y un valor del LLM con `$$`
   cerraría el string. Pero el error que Martin trajo es de `Buscar Candidatos`, que **no**
   usa `$$`. Segunda hipótesis, descartada.
3. **Edición manual del nodo.** La posición del nodo en la instancia (`[86608, 21168]`) no
   coincide con la del repo (`[2528, 1700]`), pero eso lo reacomoda el import. Martin
   confirmó que nunca tocó ese nodo. Descartada.

**Lo que dice el dato:**

- La línea 23 del query es **`where t <> ''`**. El `<>` es el operador estándar de
  desigualdad: Postgres no puede fallar ahí. Que el error apunte a esa línea significa que
  **algo partió el `<>` en `<` y `>`**.
- El formato del mensaje no es de Postgres. Postgres emite
  `ERROR: syntax error at or near ">"` + `LINE 23:` + `Position: N`. Lo que llegó es
  `Syntax error at line 23 near ">"` — mayúscula inicial, sin `Position`, y con un número
  de línea que corresponde al **template**, no a la query enviada.

**Hipótesis viva (razonada, NO verificada):** el nodo Postgres de n8n pasa la query por un
parser SQL propio antes de mandarla, y ese parser no soporta todos los operadores válidos.

⚠️ **Lo que NO se pudo comprobar:** n8n corre en la VM, no en el entorno donde se hizo este
análisis, así que **no se leyó el código del parser**. La hipótesis explica los dos errores
y el formato del mensaje, pero es inferencia. En contra juega un argumento fuerte: la query
también usa `->>` en cuatro líneas, y si el parser rompiera ese operador **ninguna** búsqueda
andaría — y la mayoría anda. O el parser sólo actúa en cierto camino de ejecución, o la causa
es otra.

**Mitigación aplicada (defensiva, no depende de la causa):** se reescribieron los dos
operadores más exóticos por equivalentes exactos —
`t <> ''` → `length(t) > 0` y `kv.value #>> '{}'` → `to_jsonb(trim(both '"' from kv.value::text))`.
Si la hipótesis es correcta, el error desaparece. Si no, no se rompió nada: son
equivalentes. **Confirmar en la próxima ronda si el error vuelve.**

**B-2. `Model output doesn't fit required format` — Agente Relevancia.**

El output parser rechazó la salida. Con `onError: continueRegularOutput`, el turno sigue
con `elegidos: []`, que `Calcular Montos` no puede distinguir de "el agente decidió que
ninguno servía" — salvo por `salidaIlegible`, que justamente existe para esto.

- **A mirar en el log:** `motivoVacio = 'salida_ilegible'` y `crudoAgente`, que guarda los
  primeros 800 caracteres de lo que devolvió. Ahí se ve si fue un campo faltante o una
  forma entera distinta.

---

## §C. Voz y conducta — no cuestan plata pero pierden ventas

**C-1. El mail se usa como cajón de sastre.** *(tres apariciones distintas)*

El mail es para **encargar** o como último recurso. Se está usando para *informar*, que
es justo lo que el bot tiene que hacer:

| dónde | qué dijo | qué tendría que decir |
|---|---|---|
| 120 hojas color | *"Para otras medidas o papeles, escribinos a …"* | *"si buscás otra medida o papel, decime y te paso el precio"* |
| tarjetas | *"Para cantidades mayores (500, 1000), consultanos por mail"* | los precios de esos packs, o la invitación a pedirlos por acá |
| rifas | *"El total se confirma por mail"* | ok, pero ver C-2 |

**C-2. "El total se confirma por mail" es una frase fija y se nota.**

Aparece idéntica en turnos muy distintos. Martin: *"usar variantes ajustadas a la
conversación, nunca algo fijo, que el LLM decida"*. Y en varios casos la frase correcta no
es esa sino **"los pedidos se toman por mail"** — son dos cosas distintas y hoy se dicen
igual.

**C-3. El bot habla en nombres de la base.**

> `me hacen fotocopias?` → *"Sí, hacemos impresiones en papel obra 75gr. Te paso los
> valores por página"*

Contesta bien pero suena a sistema. Si el cliente dijo "fotocopias", la respuesta puede
usar su palabra. Hoy los prompts fuerzan el nombre canónico.

**C-4. No pregunta cuando le falta información.** *(transversal)*

Ante un pedido genérico el bot cotiza lo que encuentra en vez de pedir el dato que
discrimina. La suite D4/E5 lo pide explícito. Relacionado con §D1.

**C-5. Ojales: ofreció "para lonas o plástico corrugado".**

> `cuánto salen los ojales?` → *"Los ojales para lonas o plástico corrugado los tenemos,
> pero te confirmamos por mail cómo se cobra"*

La parte de "cómo se cobra por mail" es **correcta** (A7: ojales no tiene `unidad_venta`).
Lo dudoso es de dónde salió "lonas o plástico corrugado" — Martin sospecha contaminación
de los turnos anteriores (venía de hablar de lonas). **A verificar contra el catálogo:** si
el dato está cargado, está bien; si no, es invención y es grave.

**C-6. El selector confundió anillado con encuadernado.**

Razonamiento textual del selector: *"El cliente consulta por el servicio de anillado, el
cual corresponde al producto de encuadernación."* Resultado: precio del encuadernado.
Es un error de mapeo semántico, no de precio — pero termina en un número equivocado.

---

## §D. Diseño — cambios de fondo, no bugs

**D-1. El filtro deja pasar muy poco.** *(propuesta de Martin: sacar Relevancia + filtro)*

> `hola, necesito imprimir unos apuntes` → +20 variantes relacionadas en el catálogo
> (75, 80, 106 gr…), el filtro dejó pasar 75 y 106. Tampoco mencionó que hay precios por
> cantidad.

**Propuesta:** eliminar el Agente Relevancia y el filtro, y darle al compositor **todo** el
resultado del SQL, avisándole que algunos pueden no ser relevantes.

- **A favor:** el compositor ve todas las opciones y puede armar el mensaje condensado que
  hoy no puede; desaparece una llamada LLM y una clase entera de "el filtro mató la opción
  correcta" (ya pasó tres veces: 27-jul, 29-jul, y ahora).
- **En contra:** el filtro es lo que hoy acota qué productos llegan a `Calcular Montos`, o
  sea a `montosAutorizados`. Sacarlo sin reemplazo amplía la lista de montos que el guard
  acepta, y el guard es la red que sostiene todo desde v8.
- **Estado:** diferido a su propia ronda por decisión de Martin. **No tocar hasta medirlo.**

**D-2. El selector solo puede pasar UN producto a la búsqueda.**

Hoy `Leer Selector` hace `precio: { producto: terminos.join(' ') }`. Cuando hay varios
candidatos legítimos (o duda genuina), debería poder pasar varios y dejar que los nodos de
abajo filtren **con las opciones a la vista**. Es la causa estructural de A-2.

**D-3. Tres pedidos en un mensaje = handoff.**

> `tengo un evento…` / `500 volantes` / `100 tarjetas` / `un cartel A3` → mail

El selector identificó los tres productos correctamente (Folletos 10x15, 100 Tarjetas
Color/Negro, Cartel A3) y marcó `necesitaAclaracion: true` con dos preguntas. El turno
igual terminó en mail — y encima con el error SQL de B-1. La suite D2 lo cubre y es
justamente el caso donde la reatribución no tiene test automático.

---

## Estado

| # | qué | clase | estado |
|---|---|---|---|
| 1 | Cap de volumen (A-1) | plata | ✅ **hecho** — cap al total en $200.000, unitario intacto |
| 2 | `Salida Info` consulta la base | bug | ✅ **hecho** — nodo `Datos Info` + prompt corregido |
| 3 | Voz del mail (C-1, C-2, C-3) | conducta | ✅ **hecho** — tres bloques nuevos en el compositor |
| 4 | El suelto detrás de la promo (A-2) | plata | ⬜ **pendiente** — necesita D-2 |
| 5 | B-1 / B-2 (errores SQL / parser) | bug | ⬜ **bloqueado** — necesita el dato de las ejecuciones |
| 6 | C-5 (ojales) / A-3 (vegetal) | dato | ⬜ **preguntas TG 77-78** |
| 7 | C-6 (anillado→encuadernado) | bug | ⬜ pendiente |
| 8 | D-1 (sacar el filtro) | diseño | ⬜ ronda propia, por decisión de Martin |

**Lo hecho está cubierto por `tests/test-cap-e-info.js`** (22 casos, incluidos los controles
negativos: sin dato la rama info escala igual, y la base caída no mata el turno) más 16
invariantes nuevos en `validate-v10-agents.js` (sección 12).

### Lo que falta para A-2 (el cartel suelto)

No es un fix de una línea: depende de **D-2**. Hoy `Leer Selector` hace
`terminos.join(' ')`, así que la búsqueda recibe una frase y el corte relativo
(`score >= 0.4 × mejor`) deja afuera al producto que matchea menos tokens. Para que el
suelto y la promo convivan hay que poder mandar **varios productos** a la búsqueda, o
cambiar el corte. Las dos cosas tocan el mismo nodo que D-1 quiere rediseñar, así que
conviene hacerlas juntas y medirlas juntas.

**Hallazgo extra, no reportado por Martin pero encontrado leyendo el código:**
`Salida Info` no consulta nada — copia `respuestaInfo`, que el Agente Intención tenía que
haber llenado con su tool. Si el agente clasifica bien pero no llama la tool, el campo
queda vacío y el turno escala **teniendo el dato en `bot.info_negocio`**. Es exactamente
el handoff de *"¿a qué hora abren los sábados?"*. Martin propuso meter un LLM en el medio;
sale más barato y más confiable que `Salida Info` consulte la tabla directo.

---

## Preguntas nuevas para TG

- **77. ¿Para qué se usa el papel vegetal?** Si es soporte de impresión, va a la lista de
  sugerencias de impresiones (hoy no está). Si es otra cosa, saber cuál.
- **78. ¿Los ojales son sólo para lona y plástico corrugado?** El bot lo afirmó; hay que
  confirmar si es un dato real del negocio o lo inventó (§C-5).
