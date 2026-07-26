# faq-bot-v8 — el motor lee los atributos y el bot habla como una persona

> **CONSTRUIDO 2026-07-26. Nada aplicado.** `faq-bot-v7.json` queda INTACTO como rollback.
> Va junto con [`db/curacion-e0-2026-07-26.sql`](../db/curacion-e0-2026-07-26.sql): el SQL
> pone los datos, v8 los usa. **Se aplican los dos de una** — ninguno solo tiene sentido.
> Verificación: harness **125/125**, gemelo ARP2 en sync, validación de import **0 errores**.
>
> Dos mitades. La primera (§2) es el **motor**: lee los atributos atomizados y arregla la
> plata. La segunda (§7-§9) es la **voz**: se va el menú numerado y un nodo LLM redacta el
> mensaje que ve el cliente, sin poder tocar un solo número.

---

## 1. Qué es v8 en una línea

v7 parseaba el nombre del producto con regex en cada mensaje para adivinar gramaje, faz y
unidad. v8 los **lee de una columna**. Eso desbloquea las tres cuentas de plata que estaban
mal y una clase entera de fallos de resolución.

**La propiedad que hace que esto sea seguro:** una fila **sin** atributos se comporta
**exactamente** como v7. Los 94 casos del harness anterior corren con mocks sin atributos y
pasan sin tocarlos. Si la migración E0 no se aplicara, v8 sería v7 con housekeeping.

---

## 2. Los cambios, uno por uno

### 2.1 El doble faz se cobra por HOJA — *el más caro*

Cierra la pregunta TG 31 (decisión de Martin 2026-07-26). En obra 75: simple faz b/n $100 y
doble faz b/n $150. La hoja impresa de los dos lados sale **1,5×** la de un lado, no 2×; si el
precio fuera por página, el doble faz tendría que ser la *mitad* del simple.

```js
hojasPorCopia = (cobraPorHoja && faz === 'doble') ? Math.ceil(paginas / 2) : paginas
```

- `cobraPorHoja` sale de `atributos.unidad_venta === 'hoja'`. **Medicina y a3 tonner se venden
  por PÁGINA y ahí no se divide nada** — sin el atributo esto era imposible de distinguir.
- El bracket se elige por **hojas**, no por páginas.
- **Se levanta el `dfGate`**: el doble faz pasa a dar total. Queda vivo solo para filas sin
  atributos, que es exactamente el caso en que la unidad sigue siendo desconocida.
- El render dice las dos cosas: *"por 200 páginas a doble faz (100 hojas)…"*.

**Impacto medido con la tabla real:** 200 páginas a doble faz pasan de **$35.600 a $17.600**.
Harness V8-1 a V8-4.

> **Desvío del plan, a propósito:** el plan decía que el bracket por hojas *reemplaza* el
> `max()` de dos lookups. Lo **conservé**. El `max()` no existe por la unidad, existe por la
> pregunta TG 32 (si el mostrador carga N×P como un ítem o por copia), que sigue abierta. Con
> `copias = 1` es un no-op; con copias ≥ 2 es el techo conservador. Se saca cuando conteste TG.

### 2.2 V2 — los servicios de taller se venden por TRABAJO

*"Anillado para 120 hojas"* daba `120 × $4.200 = $504.000`. Lo frenaba una línea del prompt.

Regla de sustantivo, determinística: en un producto con `unidad_venta: 'trabajo'`, el número
del cliente multiplica **solo si cuenta trabajos** ("3 apuntes anillados"), nunca material
("120 hojas"). Sin prueba de que cuenta trabajos, **no multiplica** — dirección segura.

Esto es lo que hizo innecesario el parche de `por_pack` que la curación E0 iba a usar: con la
regla en el motor, *"3 anillados"* sigue dando $7.200 y *"anillado para 120 hojas"* da el
precio del ítem. **Queda un solo cambio de flag en toda la migración** (talonarios).
Harness V8-5 a V8-7.

### 2.3 V1 — la promo inmobiliarias

Dos cosas distintas, las dos rotas:

1. **Guard de nicho.** La promo es solo para inmobiliarias (Martin) y hoy aparece ante
   cualquier consulta de carteles, cobrando $15.000 donde el suelto vale $19.500. El guard que
   ya existía para medicina ahora se maneja por `atributos.nicho`, y la promo entra con
   `nicho: 'inmobiliarias'`. La regex por nombre queda de fallback para filas sin atributos.
2. **Mínimo de unidades.** `min_unidades: 6`: abajo de 6 el precio promocional no aplica.
   "3 carteles" daba $45.000 cuando 3 sueltos son $58.500. Ahora es un estado propio
   (`fallback: bajo_minimo`) que dice el mínimo y pregunta la cantidad, sin inventar el precio
   del suelto (que ARP no tiene a mano).

Harness V8-9 a V8-11.

### 2.4 La variante se resuelve por atributo (incidente S6-2)

*"Papel vegetal a3"* daba **"no lo tenemos"**: la variante viva se llama `OFICIO / a3` y el
match era igualdad exacta. Con la atomización su `tamano` es `["oficio","a3"]`.

En `Get Precio` la elección de variante pasa de un `OR` suelto a una **escalera** (`var_rank`)
y se devuelven solo las filas del mejor rank **por producto**:

| rank | qué es |
|---|---|
| 1 | nombre exacto de la variante (lo de siempre) |
| 2 | mono-variante siempre matchea (r6) |
| **3** | **nuevo: por atributo atomizado** — `tamano`, `faz`, `color`, `acabado`, `cobertura`, `material`, `papel`; escalares y arrays |
| 4 | rank-3 del producto: todas sus variantes |

El filtro por rank mínimo hace que el nivel 3 sea **estrictamente aditivo**: solo entra cuando
1 y 2 no matchearon nada en ese producto, que es justo el caso que hoy da 0 filas → `sin_match`.
Nunca convierte un match limpio en ambiguo.

**Efecto lateral bueno:** el vocabulario de ejes empieza a resolver sin cambiar el contrato del
LLM. "simple faz", "mate", "25% de cobertura", "en lona" caen por atributo. Era el motivo
principal para meter los slots `material` y `cobertura` en el contrato; se consigue sin tocarlo.

### 2.5 La regla de gemelos, sobre atributos

Cuando el ambiguo es entre **dos** productos que comparten casi todo, en vez del menú el bot
pregunta **el eje que los distingue**.

La corrida contra el catálogo real encontró que la regla del spec §5 se queda corta: con la
corrección que el propio spec pedía (solo claves en ambos, ≥2 comunes, el null nunca cuenta)
**los tres falsos positivos que marcaba siguen apareciendo** — cambian de motivo, no de
resultado. 103 pares. Las tres correcciones que faltaban:

| corrección | efecto |
|---|---|
| `unidad_venta` **fuera** del set discriminante — es mecánica de precio, casi constante dentro de una familia, y a un cliente no se le pregunta | 103 → 61 |
| `nicho` y `servicio` = **separadores duros** (medicina jamás es gemelo de a3 tonner; la promo jamás del cartón) | mata los 3 falsos positivos |
| mínimo **3** claves comunes, no 2 — con 2 el "difieren en una" es trivial | 61 → **20**, todos reales |

Los ejes que se preguntan tienen texto curado (`gramaje`, `tamaño`, `color`, `faz`, `acabado`,
`papel`, `material`, `impreso_en`). `tecnologia` y `pack_unidades` **no** se preguntan: a nadie
se le pregunta por la máquina. Si el eje no tiene pregunta, cae al menú de siempre.
Harness V8-12 a V8-17.

### 2.6 Housekeeping (sin conducta nueva)

- **`models: ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite']`** en los 3 nodos LLM.
  El 2.5 **muere el 16-oct-2026**: con esto el 404 pasa a ser un fallback silencioso en vez de
  una ronda entera caída, y de paso cubre 429/5xx mejor que el `retryOnFail` de n8n (que agrega
  silencio, no resiliencia).
- **Timeouts**: 20 s / 15 s / 8 s. Hoy ninguno lo tenía → default 300 s: una llamada colgada
  dejaba al cliente mudo cinco minutos.
- **`onError: continueRegularOutput`** en `Log Precio`, `Log Respuesta`, `Log Escalación`. Sin
  eso un blip de la DB deja la ejecución en rojo, y un *retry execution* **reenvía el mensaje**.

---

---

## 7. Topología unificada — prerequisito duro del compositor

Antes había **tres ramas de envío y tres de log**, una por acción. Ahora las tres convergen en
un sobre único y una sola cadena de salida.

```
Switch Acción[0] (answer) ──┐
Armar Respuesta Precio ─────┼→ Normalizar Envío → Armar Prompt Compositor → ¿Componer?
Armar Menu Opciones ────────┘                                                  │        │
                                            Llamar LLM Compositor ←────────────┘        │
                                                      ↓                                 │
                                            Aplicar Compositor ←──────────────────────┘
                                                      ↓
                                            Enviar Mensaje → Log Turno
```

**El motivo no es prolijidad.** `Enviar Respuesta` leía `$('Parsear Respuesta').reply`, y ese
nodo se ejecuta **siempre**. Con un compositor enchufado habría mandado el borrador **sin
componer, sin error y sin aviso**. Con el sobre viajando en `$json` eso es estructuralmente
imposible.

Cuentas: **−4 nodos** (`Enviar Menu`, `Enviar Respuesta`, `Log Menu`, `Log Respuesta`) y
**+4** (`Armar Prompt Compositor`, `¿Componer?`, `Llamar LLM Compositor`, `Aplicar Compositor`).
Quedan 68, los mismos que v7. `Pre-Envío Precio`, `Enviar Precio` y `Log Precio` se renombraron
a `Normalizar Envío`, `Enviar Mensaje` y `Log Turno` conservando id y credencial.

`Log Turno` gana dos columnas, **`borrador` y `final`**. Sin las dos, el juez offline del
confident-wrong estaría auditando un texto que el cliente nunca vio.

---

## 8. Se va el menú numerado

El menú numerado creaba una **dependencia de estado entre turnos**: el "2" de este mensaje solo
significa algo si el bot puede releer el menú anterior y mapearlo igual. De ahí salen el
anti-loop, la prohibición de que el refinador renumere, y buena parte de los incidentes de
resolución. Y además se lee como copiado por un bot, que es de lo que se trata todo esto.

Se sacó de los **tres** lugares que lo producían (`Armar Menu Opciones`, el menú de rescate de
`Armar Respuesta Precio`, y la action `opciones` de `Aplicar Aclarador`): ahora son viñetas.
La regla 2 del `Prompt Cotizador` se reescribió: el cliente **contesta con palabras** ("el de
300", "la mate", "simple faz") y el LLM las mapea. Ya no se le pide un número nunca.

Esto es viable **porque §2.4 ya existe**: el match por atributo entiende "300", "mate" o
"oficio" sin que nadie tenga que copiar un nombre de catálogo.

---

## 9. El compositor

Un nodo LLM que redacta el mensaje que ve el cliente a partir del borrador determinístico.
*"1. Papel Kraft 130 Gr / 2. Papel Kraft 300 Gr"* pasa a *"el kraft lo tenemos en 130 y en 300
gramos, ¿cuál te sirve?"*.

**Cómo se garantiza que no invente plata.** Antes de llamarlo, `Armar Prompt Compositor`
**tokeniza**: cada monto se reemplaza por `[[P1]]`, `[[P2]]`… y el mail por `[[MAIL]]`, y el
mapa token → valor queda guardado. El LLM escribe prosa alrededor de tokens opacos y **nunca ve
ni escribe un dígito de plata**. Después, `Aplicar Compositor` re-estampa los montos **desde el
mapa**, que viene de la base.

**El gate compara valores, no layout** — y por eso no tiene ninguna regla de "conteo de líneas
numeradas": justamente queremos que deshaga el menú.

> **CORRECCIÓN (consejo Opus, 2026-07-26).** Esta afirmación era falsa en dos puntos concretos,
> y el red-team pasó 12 de 19 ataques con veredicto `ok`. El gate protegía la plata pero **no el
> nombre del producto** (renombrar `Cartón` a `montado sobre cartón` pasaba las cinco reglas) **ni
> el hedge** (la regla 4 permite explícitamente que el léxico aparezca *menos* veces, así que
> borrar *"el total te lo confirma el equipo"* pasaba). **El hedge es un valor**, no layout: marca
> los casos donde el sistema decidió no dar un total firme. Arreglado en
> [`v8-1-build.md`](./v8-1-build.md) §1.2 con las reglas 2b y 4b.

| # | Regla | Qué evita |
|---|---|---|
| 1 | todos los tokens, una vez cada uno, **en el mismo orden** | que le dé al 130 el precio del 300 |
| 2 | ningún `$` ni `@` propio | plata o mail inventados |
| 3 | mismo multiset de dígitos fuera de los tokens | cantidades, gramajes y plazos inventados |
| 4 | el léxico de riesgo no puede aparecer **más** veces que en el borrador | promesas de plazo, stock, envío, descuento |
| 5 | largo acotado | ensayos |
| 6 | ningún token sin estampar sobrevive | un `[[P1]]` crudo al cliente |

**Cualquier rechazo manda el borrador** — exactamente lo que el bot habría mandado sin
compositor — y deja el veredicto en `notas` como canario.

**Tres cosas que no compone, a propósito:**

- **Kill switch.** `const COMPOSITOR = true;` en la primera línea de `Armar Prompt Compositor`.
  Lo apagás editando una línea en la UI de n8n, sin re-importar.
- **La rama `answer` con un `$` adentro.** Esa plata la escribió el LLM1 y **no** pasa por el
  backstop `plataRe`, que solo cubre la rama precio. Tokenizarla sería lavarla: le daría el
  formato de un monto verificado a un número posiblemente alucinado. Preferimos el borrador feo.
- **Los cuatro textos fijos** (escalación, bienvenida, no-texto, cap email) siguen siendo nodos
  aparte y no pasan por acá.

**La tabla de precios por cantidad se conserva** (decisión de Martin, 2026-07-26: un mensaje con
la tabla cuesta menos que preguntar "¿cuántas?" y contestar después). El compositor tiene
instrucción explícita de dejarla como tabla.

**Costo:** una llamada LLM más por mensaje saliente, ~+1,2 s de latencia. Contra los ~6,6 s
actuales es +18%, y es 100% visible para el cliente.

---

## 3. Lo que deliberadamente NO entró

- **El contrato del LLM de 9 slots con matcher estructural.** Cambia `Parsear Respuesta`, los
  parámetros de `Get Precio` y todo el matcher. El beneficio concreto que buscábamos (que "lona"
  y "25% cobertura" resuelvan por dato y no por suerte de substring) ya lo da §2.4 usando el slot
  `variante` que ya existe. La regla anti-SKU-compuesto del plan r7 §2.1 **ya estaba** en el
  prompt desde una ronda anterior. Lo que queda sin resolver es que el LLM sigue eligiendo el
  nombre del producto de un catálogo pegado en el prompt — causa raíz de los incidentes 14 y 19.
  La atomización lo mitiga (los gemelos repreguntan en vez de adivinar) pero no lo elimina.
- **Que la capa determinística emita hechos estructurados** en vez de un borrador de texto. El
  compositor hoy recibe el borrador tokenizado, no un JSON de hechos. Funciona y es mucho menos
  invasivo, pero significa que el compositor sigue atado a cómo redacta el código. El paso a
  hechos es el siguiente escalón natural.
- **La cuantización de packs** (mostrar el tier de abajo y el de arriba): decidida, no
  construida. Necesita un slot `packs` que hoy no existe.
- **El guard de variante no anclada** (plan r7 §2.5). Fuerza menú en el 43% del catálogo
  (+6 a +9 menús/día). Conviene medirlo con la resolución nueva ya andando antes de sumarlo.
- **El modelo en un solo campo** (`System Prompt.modelo` referenciado desde los 5 puntos): el
  fallback de §2.6 resuelve el problema real sin tocar expresiones.

---

## 4. Verificación

| gate | resultado |
|---|---|
| `node tests/code-harness.js` | **125/125**, 0 FAIL (94 de v7 + 15 del motor + 16 del compositor) |
| `node tests/regen-arp2-twin.js` | gemelo `Armar Respuesta Precio 2` en sync |
| `node tests/validate-v8-import.js` | **0 errores** |

La validación de import verifica: 68 nodos, **ninguna conexión colgando**, una sola rama de
envío al cliente y un solo log de turno, ningún nodo de la topología vieja sobreviviente,
ningún nodo HTTP o Postgres sin credencial, los 17 nodos Code con sintaxis válida, los 18
nodos cambiados todos previstos, y **uno por uno** que sigan vivos los 7 guards de plata de v7
(dorso, numerales, papel especial, faz inversa, nicho, cap de volumen, plantilla forzada), los
4 nuevos del motor y las 7 reglas del gate del compositor.

Los 16 casos del compositor cubren el camino feliz y **nueve formas distintas de rechazo**:
token faltante, tokens invertidos, `$` propio, número inventado, promesa de plazo, JSON
ilegible, error HTTP, kill switch y token sin estampar. En todos, el cliente recibe el
borrador determinístico.

---

## 5. Runbook — se aplica TODO junto

1. **SQL**: `db/curacion-e0-2026-07-26.sql` en el SQL editor de testing. Leer los NOTICES
   (esperados: 83 productos, 139 variantes). No aplicarlo en medio de una conversación real:
   el `drop view` de `bot.variantes` toma un lock exclusivo unos milisegundos.
2. **Importar `n8n/flows/faq-bot-v8.json`** (68 nodos). Las credenciales viajan en el JSON con
   su id real: no hay configuración manual.
3. **`GET /webhook/refrescar-catalogo`** (URL de producción; en ejecución manual el `staticData`
   no persiste).
4. **Sanity SQL** (las 5 del pie del archivo). La 2 es la que importa: el atributo efectivo se
   resuelve solo, las medidas fijas del PVC dan `unidad` heredado y la variante `m2` da `m2`.
5. **Ronda**. Lo que hay que traer:

| # | Mensaje | Qué tiene que pasar |
|---|---|---|
| 1 | "cuánto sale imprimir 200 páginas doble faz en obra 75" | **$17.600**, no $35.600, y que diga "(100 hojas)" |
| 2 | "cuánto sale un anillado para 120 hojas" | $2.400, **sin total** |
| 3 | "necesito anillar 3 apuntes" | $7.200 (sigue multiplicando lo que corresponde) |
| 4 | "cuánto sale un cartel de 1x0.65" | **no** puede salir la promo de $15.000 |
| 5 | "soy de una inmobiliaria, necesito 3 carteles" | dice el mínimo de 6, **sin** $45.000 |
| 6 | "500 rifas" | no cotiza 500 talonarios |
| 7 | "papel vegetal a3" | resuelve (era "no lo tenemos") |
| 8 | "papel kraft a4" | pregunta el **gramaje**, no lista un menú |
| 9 | "cuánto sale anillar" | ofrece las 3 opciones **sin números**, en prosa |
| 10 | cualquiera de los de arriba | el mensaje tiene que **sonar a persona**, no a lista |

Después de la ronda, la consulta que dice si el compositor está sano:

```sql
select accion, notas, borrador, final from bot.decisiones
 order by created_at desc limit 20;
```

Si la tasa de `(compositor:` distinto de `ok` supera ~30%, apagá el kill switch
(`const COMPOSITOR = false;` en `Armar Prompt Compositor`, se edita en la UI sin re-importar)
y traeme los rechazos: el veredicto dice exactamente qué regla se violó.

**Rollback**: re-importar `faq-bot-v7.json`. El SQL no necesita rollback — v7 ignora las
columnas nuevas, así que la base atomizada le es indiferente. Rollback parcial más barato:
el kill switch del compositor, que deja el motor nuevo y la voz vieja.

---

## 6. Preguntas a TG que este build deja tocando la puerta

- **63** (nueva): confirmar que el doble faz se cobra por hoja, y el redondeo de páginas
  impares. El motor ya está construido con `ceil`; si TG dice "por página", se revierte §2.1 y
  vuelve el `dfGate`.
- **32**: práctica de carga con copias. Mientras siga abierta, el `max()` de dos lookups queda.
- **55**: qué pasa con la promo entre 7 y 11 carteles.
- **52**: unidad de venta del resto del catálogo (Ojales sigue sin decidir).
