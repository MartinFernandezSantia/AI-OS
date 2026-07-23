# Plan faq-bot-v7 — cotizador por WhatsApp (Increment C1)

> Estado: **CONSTRUIDO 2026-07-22 (OK de Martin + Fable rondas 1-2 + verificación en
> el motor real). Pendiente de APLICAR — runbook en la sección ⭐ del handoff.**
> Artefactos: `db/cotizador-v7.sql` · `n8n/flows/faq-bot-v7.json` (v6 intacto como
> rollback) · `tests/code-harness.js` 41/41 · `tests/suite-5-cotizador.md` (14 casos)
> · suite-3/suite-2 auditadas y anotadas.
> Decisión de producto (Martin, 2026-07-22): el cliente se informa TODO lo necesario en
> materia de precios y servicios por WhatsApp; el email queda SOLO para concretar el
> pedido (mandar el archivo). El comportamiento v10.x de R1 (libro → email sin cotizar)
> era el diseñado, y Martin lo rechazó como producto. Este plan lo reemplaza.

## 0. La idea en una línea

Ante intención de cotizar, el bot junta los datos mínimos EN UN mensaje (opciones
listadas + cantidad según corresponda) y el sistema calcula el total
(precio × cantidad, respetando brackets) de forma determinística. El LLM sigue sin
tipear jamás un monto: solo clasifica y extrae; n8n multiplica e inyecta.

## 1. Qué NO cambia (invariantes intocables)

- Mundo cerrado: lo no listado no existe. Solo se pregunta por opciones listadas.
- El LLM nunca tipea montos ni multiplica. Todo número sale de `bot.variantes` y todo
  cálculo vive en `Armar Respuesta Precio`.
- Escalera determinística: override / >1 regla cantidad / $0 / ambiguo / sin_match /
  dorso → sin número, email. Tabla verbatim para 1 regla de cantidad sin cantidad dada.
- PROHIBIDO calcular m²/metros (medidas las confirma el equipo). Sin cambios.
- NUNCA sumar ítems distintos (`mas` no suma; "¿y todo junto?" → el armado lo cotiza
  el equipo). El total es siempre POR ÍTEM.
- Stateless por mensaje; primera mención del mail; anti-repetición; firewall Tier-1/2;
  regla 4 (pregunta directa por lo no listado → handoff); regla 5; R14 (el ancla no se
  dispara sobre trabajos que son UN ítem con tabla).
- Anti-screenshot: todo número viaja pegado a su condición en la MISMA frase.

## 2. Arquitectura — v7-lite (C1) ahora, split multi-nodo (C2) con gate objetivo

**C1 (este plan): cero nodos LLM nuevos.** Se extiende el action `precio` calibrado
(v10.2→v10.8) + `Parsear` + `Armar`. Razones (Fable r1 sostuvo):

- La multiplicación es determinística → va en el Code node. Un AI-Agent con tools
  obligaría al LLM a copiar números del tool result a su reply (rompe el principio).
- El flujo es stateless: cada mensaje reentra por el mismo camino. Un nodo LLM
  especialista exigiría un router LLM por turno = otra llamada con sus propios modos
  de falla; duplica superficie sin ganar seguridad.
- La conducta de precio costó 5+ rondas de calibración; rehacerla en un nodo nuevo es
  recalibrar de cero. C2 heredará una spec PROBADA (la conducta C1 validada).
- 21k chars ≈ 5-6k tokens: trivial para flash-lite. El cuello es interferencia entre
  reglas, no tokens.

**Gate C1→C2 (números fijados AHORA para que "C2 después" no sea "C2 nunca").** Se
extrae el cotizador a nodo especialista (prompt propio + solo las líneas del producto)
si CUALQUIERA de:

- (a) La regresión (suite-2 + matriz golden) rompe **>3 goldens no-precio** que pasaban
  en baseline v10.8 con los mismos datos. Sin filtro de "atribución": cuenta TODO fallo
  (si era bug de datos, se corrige el dato y cuenta la re-corrida final).
  **Kill-switch aparte: UN solo fallo de clase plata** (monto no proveniente del
  sistema, o sub-cotización) = gate inmediato. Los fallos de plata no se promedian.
- (b) El prompt v7 supera **27k chars** (hoy 21k). Cláusula anti-gaming: si para entrar
  en 27k hay que comprimir/re-redactar reglas YA calibradas, eso ES el gate disparado
  (comprimir una regla calibrada = recalibrarla).
- (c) Oscilación observable: los goldens de recolección (suite-5 casos 2, 3 y 5)
  fallan en DOS rondas consecutivas DESPUÉS de aplicar fixes entre rondas.
- Regresión de tono/calidez sin romper conducta: NO es gate numérico; flag de revisión
  manual en la ronda.

## 3. Totales determinísticos (Armar Respuesta Precio)

Estados que dan TOTAL (siempre con `cantidad` válida presente):

| Estado | Total | Condición |
|---|---|---|
| `ok_bracket` | `cantidad × bracket.value` | como hoy + total |
| `ok` (sin reglas) | `cantidad × precio_lista` | siempre |
| `ok_caveat` | `cantidad × precio_lista` | **SOLO si `solo_descuentos = true`** |

**El agujero que cierra la condición (Fable r1, el hallazgo grave):** `tiene_reglas`
incluye recargos (supercharge — existen en el ruleset; `precio_actualizado`/
`solo_descuentos` documentados en `db/precio-freshness.sql`). Para esas variantes
`precio_lista` es PISO: un total grande anclado por debajo de la realidad es
sub-cotización a escala (la dirección prohibida — la misma por la que existe el
backstop dorso). Con `solo_descuentos=true` la lista es techo garantizado → el total
es cota superior (sorpresa positiva en mostrador, permitida).
`tiene_reglas && !solo_descuentos` → unitario + caveat, sin total. La columna YA viaja
en Get Precio: cero SQL nuevo para esto.

Reglas de render del total:

- **Plantilla SIEMPRE forzada** en todo render con total (disciplina de `ok_bracket`
  hoy, extendida como invariante): cantidad + "estimado" + "lo confirma el equipo" en
  la MISMA frase. Un total JAMÁS entra por `{{PRECIO}}` en template libre del LLM.
  Formato: `Por 200 unidades, <opción> de <producto> sale $425,00 c/u — total estimado
  $85.000,00 (precio de lista; el precio final del trabajo te lo confirma el equipo).`
- El caveat es el CAVEAT ya calibrado de Armar. NO se le agrega "cuando mandes el
  archivo por mail" (chocaría con el email reposicionado, §6, y ensucia el anti-eco).
- **Cap comercial:** `cantidad_efectiva > 10000` → sin total: unitario/tabla + "para
  ese volumen te cotiza el equipo". (El límite del parseo 999999 protege el lookup,
  no la sensatez comercial; un "total estimado $424.999.575,00" es un
  screenshot-compromiso absurdo.)
- Fallbacks: sin cambios (email honesto).
- `mas`: cada ítem extra acepta `cantidad?` y rinde con SUS reglas (unitario de
  bracket + total corto si su estado lo permite). Sin gran total. Sin esto,
  "150 tarjetas y 200 impresiones a3" daría total para el main y "¿te paso la tabla?"
  para el extra cuya cantidad el cliente ACABA de decir.

## 4. Recolección en UN mensaje (prompt)

- **Solo para productos con opciones `*`/`**`.** Producto sin `*` → 2c intacto
  (derivación sin entrevista; golden E4 es el contra-caso). Spec no listada → regla 5
  intacta. La delimitación es mecánica (la marca), no de vibes.
- **Se pregunta por OPCIÓN listada, nunca por "ejes"** (Fable r1): "elegí entre estas
  opciones: [variantes verbatim, formato guion] y decime cuántas". El catálogo no
  tiene ejes estructurados; pedir "¿qué tamaño?" a un producto cuyo display no lista
  tamaño = afirmar que existe = violar mundo cerrado. Con el catálogo limpio, las 4
  variantes faz×color listadas SON la pregunta.
- **Cantidad: solo se pregunta en `**`.** En `*`: cantidad dada → total; no dada →
  unitario directo, NUNCA preguntarla (si no, A1/A2 regresionan con fricción nueva).
- **Respuesta parcial → re-preguntar SOLO lo que falta, en un mensaje.** Explícito en
  el prompt (stateless: sin esto flash-lite repite el cuestionario completo, y el
  backstop anti-repetición umbral 2 puede MUTEAR al bot en medio de la cotización).
  Golden obligatorio (suite-5 caso 3).
- **La edición más peligrosa del v7 (Fable r1):** el intro del prompt hoy dice "NO
  tomás datos de pedidos. NO armás el pedido juntando especificaciones" — en tensión
  frontal con esto. Se reescribe distinguiendo: juntar datos PARA COTIZAR una opción
  listada (SÍ, en un mensaje) ≠ tomar datos del ENCARGO (NO, va por email). Merece
  golden propio y ronda de calibración dedicada.

## 5. Libro / trabajos por página

- **Campos nuevos del action `precio`: `paginas` (1..5000) y `copias` (1..1000),
  opcionales.** n8n calcula; el LLM extrae. `cantidad` premultiplicada por el LLM está
  PROHIBIDA (multiplicación encubierta: inauditable y flash-lite yerra aritmética).
- **Semántica verificada en el motor** (`lib/quote-utils.ts` del quote-system,
  fuente de verdad): un CartItem tiene UN solo `quantity`; el primer rango que matchea
  gana; no existe noción de páginas/copias en el código. La ambigüedad restante es
  práctica del operador (¿carga 360 o 2×180?).
- **Cálculo (Fable r2, enmienda dura):** unitario del total =
  **`max( u(bracket(paginas)), u(bracket(paginas×copias)) )`**;
  total = `paginas × copias × ese unitario`.
  - Bajo brackets monótonos (lo normal) equivale a bracket por copia: exacto si el
    mostrador bracketea por copia; techo (sorpresa positiva) si bracketea el total.
  - El `max` cubre rulesets NO monótonos (carga sucia / recargo por volumen), donde
    "bracket por páginas" solo podría sub-cotizar. Dos `find` sobre el mismo array: gratis.
  - **Gap en la key `paginas`** (cantidad entre brackets) → tabla completa, sin total
    (conducta de gap ya calibrada; no se "rescata" con el lookup del total: el gap es
    zona de negociación del mostrador).
  - **Multi-copia con descuento por volumen** (`copias ≥ 2` y
    `u(bracket(total)) < u(bracket(paginas))` — condición ya computada por el max):
    se appendea línea fija SIN número: "por el volumen total puede quedar más abajo;
    el equipo te lo confirma con el archivo". El caso real es el apunte de cátedra
    (30 páginas × 50 copias): sin esta línea, el total conservador ancla +40-70% arriba
    y espanta al cliente que el v7 quiere retener. Dirección sin monto: no sub-cotiza.
- **Doble faz: gate duro hasta respuesta de TG.** No sabemos si el precio de la
  variante d/f es por página (carilla) o por hoja. Asumir `ceil(paginas/2)` podría
  sub-cotizar 2×; y un "unitario sin total" TAMBIÉN miente (la selección de bracket ya
  necesita la unidad: bracket(200 páginas) ≠ bracket(100 hojas)). Conducta: doble faz +
  `paginas` presentes → **TABLA completa verbatim, sin bracket lookup y sin total** +
  "el total del doble faz te lo confirma el equipo". Pregunta nueva en preguntas-tg.
- **Flag `por_pagina` en `bot.producto_meta`** (boolean, default false), expuesto como
  columna extra de `bot.variantes` (la vista ya joinea `producto_meta`) y sumado al
  SELECT del nodo Get Precio (¡vive en el nodo, no en la vista! → re-import
  obligatorio; sin eso el flag llega undefined y el gate queda muerto en silencio —
  por eso el flag va también a `notas` para verlo en telemetría).
  `Armar` usa `paginas`/`copias` SOLO si `por_pagina=true`; si no, los ignora con nota.
  Es el backstop determinístico contra "mi banner tiene 6 paños" → lona × 6.
  - Seed `true` (sesgo a MENOS true: el falso negativo solo pierde el total; el falso
    positivo multiplica cualquier cosa): IMPRESIONES obra 75, impresión 106 gr,
    impresiones a3 tonner, Riso, módulos/apuntes medicina. Fotocopias si existiera con
    `*` (hoy no está — pregunta TG vigente).
  - `false` deliberado: Autocad/planos ("3 planos" es cantidad normal) y — el trabajo
    MÁS importante del flag — **Anillado, Encuadernado, Plastificado** ("anillar un
    apunte de 120 páginas" NO es 120 anillados).
- **Hazard aparte que el flag NO cubre:** el mismo mensaje puede inducir
  `cantidad=120` (no `paginas`) sobre el anillado → 120 anillados × $X por el path de
  cantidad. Mitigación doble: línea de prompt ("para anillado/encuadernado/plastificado
  la cantidad es CUÁNTOS trabajos, nunca las páginas del documento") + golden suite-5
  caso 13. Backstop barato opcional: producto no-`por_pagina` + mensaje que matchea
  /p[aá]ginas/ + cantidad > 30 → sin total (unitario/tabla).
- Encuadernado/anillado nombrado por el cliente junto al libro → ítem `mas` aparte
  (su tabla/precio), sin total del trabajo. "¿Y todo junto?" → nunca suma; el armado
  lo cotiza el equipo al encargar.

## 6. Email reposicionado (prompt, sección "Email y cierre")

El email aparece SOLO para: (a) encargar / mandar el archivo, (b) fallbacks que el
sistema no puede cotizar, (c) el cierre. Preguntas de precio de opciones `*`/`**` se
responden COMPLETAS en WhatsApp sin mención del email. La regla del "¿algo más?" queda
para el cierre de pedido.

- Degradación segura por construcción: si el LLM sobre-generaliza a productos sin `*`,
  cae en sin_match/override → fallback email. La regla 6 del mundo cerrado no se toca.
- La primera mención de la dirección se muda típicamente al cierre: E1 pasa de golden
  de borde a golden de camino principal. Backstop de Parsear sin cambios.
- El ancla libro 2c del prompt se REESCRIBE al flujo §5 (recolección → total por
  página). Sus invariantes internos PERSISTEN: no ofrecer productos ajenos como
  "opciones del libro", datos ya dados jamás re-preguntados, dirección escrita (nunca
  "¿te paso el correo?").

## 7. Contrato (Parsear Respuesta)

- `paginas`/`copias`: validación tolerante idéntica a `cantidad` (string numérico
  aceptado), rangos 1..5000 / 1..1000.
- **Conflicto:** `paginas` presente y válido → `cantidad` SE IGNORA;
  `cantidad_efectiva = paginas × (copias || 1)`; nota `(cantidad ignorada: paginas
  presentes)`. Nunca promediar/elegir mayor. Neutraliza la premultiplicación detectable.
- `copias` sin `paginas` → se ignoran ambos, flujo normal, nota en telemetría.
- `mas[i].cantidad?`: validación idéntica.
- Anti-total-tipeado: cubierto por plantilla forzada en todo total + la regex de plata
  existente que descarta templates del LLM con montos.

## 8. Cambios por archivo (checklist de build)

1. **`n8n/flows/faq-bot-v7.json`** (copia de v6; v6 queda intacto):
   - System Prompt: intro (cotizar ≠ encargo), sub-reglas 2a-2c (recolección §4, ancla
     → §5), "Email y cierre" (§6), leyenda `**` (pedir todo lo faltante en un mensaje),
     línea anillado-cantidad-es-trabajos, "¿todo junto?" → nunca suma.
   - `Parsear Respuesta`: §7.
   - `Armar Respuesta Precio`: totales §3, cálculo por página §5 (max de dos lookups,
     gap, línea de volumen, gate doble faz, gate `por_pagina`, cap 10000), `mas` con
     cantidad, flag `por_pagina` y `cantidad_efectiva` en `notas`.
   - `Get Precio`: agregar `v.por_pagina` al SELECT (el SQL vive EN el nodo).
2. **`db/cotizador-v7.sql`** (Martin aplica; transaccional, patrón overlay):
   - `alter table bot.producto_meta add column por_pagina boolean not null default false;`
   - Recrear `bot.variantes` con `coalesce(pm.por_pagina,false) as por_pagina`
     (DROP+CREATE + re-grant, mismo patrón del overlay; verificar dependencias de la
     vista antes del DROP).
   - Seeds `por_pagina=true` por clave natural (lista §5) + asserts de conteo.
   - **Query de verificación pre-v7 (hazard Fable r1):** variantes con
     `n_reglas_cantidad = 1 AND tiene_reglas AND NOT solo_descuentos` → si devuelve
     filas, la tabla verbatim de esas variantes puede mentir para abajo (recargo
     coexistente con la quantity rule); revisar cada una antes de habilitar totales.
3. **`tests/code-harness.js`**: casos nuevos — paginas/copias válidos e inválidos,
   conflicto cantidad+paginas, copias sin paginas, max() con brackets no monótonos,
   gap en key paginas, cap 10000, solo_descuentos gate, mas.cantidad, doble faz gate,
   por_pagina=false ignora paginas.
4. **`tests/suite-5-cotizador.md`**: los 14 casos de §9.
5. **`tests/suite-3-precios.md`**: re-escribir R1 (libro → recolección + total),
   R12 (total de la impresión SÍ / total del trabajo armado NO), C2/R15 (bracket +
   total), B1 (recolección en un mensaje), E1 (re-etiquetar como golden principal de
   primera mención). El resto INTACTO (ver §9).
6. **`tests/suite-2-*.md`**: auditar TODA expectativa "precio → email" que v7
   invalida ANTES de correr la regresión (si no, falsos rojos/verdes ensucian la
   calibración).
7. **`preguntas-tg.md`**: +2 preguntas (§10).

## 9. Suites

**Goldens que DEBEN sobrevivir intactos** (cualquier cambio = regresión): A1, A2 (y
guard nuevo: sin pregunta de cantidad en `*`), B2, C1 (tabla sin cantidad), C3, D1
(dorso), D2, D3, D4/R8, D5 ($0), D6 (override), E2, E4 (sin `*` → email sin
entrevista), R2, R3, R4, R5 (sobre inglés ambiguo→email), R6, R7 (primera mención +
anti-Frankenstein), R10, R11, R13 (invariante no-suma), R14 (el ancla no se dispara),
R15, R16, prohibición m² (nuevo golden explícito).

**Suite-5 — cotizador (14 casos):**

1. Total directo `**`: "necesito 200 impresiones a3 en tonner negro, ¿cuánto en
   total?" → "$425,00 c/u — total estimado $85.000,00 (…)". Sin email.
2. Recolección un mensaje: "¿cuánto me salen las impresiones en obra de 75?" → UNA
   respuesta con las 4 opciones verbatim + cuántas. PROHIBIDO preguntar tamaño.
3. Parcial sin loop: (sigue) "simple faz color, ni idea cuántas" → tabla de ESA
   variante; no re-pregunta faz/color; no queda muteado por anti-repetición.
4. Libro completo de una: "apuntes en PDF, 180 páginas, 2 copias, simple faz b/n" →
   total con el max() de brackets (verificar contra BD a mano), sin re-preguntar.
   Encargo → email.
5. Libro incompleto: "quiero imprimir un libro que tengo en PDF" → UN mensaje pidiendo
   páginas, copias y opción entre las listadas. Nada inventado. (Reemplaza R1.)
6. Doble faz gate: "200 páginas doble faz b/n, 1 copia" → TABLA completa, sin total,
   "el total del doble faz te lo confirma el equipo".
7. Libro + anillado: "apuntes 120 páginas, 1 copia, simple faz b/n, con anillado" →
   total impresión + anillado como ítem aparte; "¿y todo junto?" → nunca suma.
8. Regateo: "uh, ¿me lo dejás en 70 lucas?" → no negocia, no repite el número del
   cliente; lista + lo define el equipo.
9. Cantidad absurda: "999999 impresiones a3, ¿total?" → sin total gigante; derivación
   por volumen (cap).
10. Precio viejo + cantidad: "pagué $300 por copia el año pasado, ¿200 al mismo
    precio?" → sin confirmar el 300; bracket real de 200.
11. Multi-ítem con cantidades: "150 tarjetas y 200 impresiones a3 en negro" → cada
    ítem con su render (`mas` con cantidad), SIN gran total.
12. m² cerrado: "una lona de 3x2, ¿el total?" → precio del m² listado, sin calcular
    6 m², sin total.
13. Anillado no-por-página: "¿cuánto sale anillar un apunte de 120 páginas?" → precio
    de UN anillado (o tabla), JAMÁS ×120.
14. Multi-copia volumen: "30 páginas, 50 copias, simple faz b/n" → total conservador +
    línea fija "por el volumen total puede quedar más abajo…" sin número extra.

## 10. Preguntas TG nuevas (van a preguntas-tg.md)

1. **Unidad del doble faz:** el precio de la variante doble faz de impresiones,
   ¿es por página (carilla) o por hoja? (Desbloquea el total d/f del cotizador.)
2. **Práctica de bracket multi-copia:** para N copias de un documento de P páginas,
   ¿el mostrador carga UN ítem con N×P impresiones (bracket del total) o N ítems /
   bracket por copia? (Permite pasar del techo conservador al total exacto.)

## 11. Orden de build

1. OK de Martin a este plan (única revisión: este archivo).
2. `db/cotizador-v7.sql` (Martin aplica; correr la query de verificación de recargos
   coexistentes ANTES de habilitar totales).
3. Editar `faq-bot-v7.json` (prompt + Parsear + Armar + Get Precio) + harness
   (`node tests/code-harness.js` verde).
4. Import v7 en n8n (v6 queda desactivado como rollback), creds + toggle.
5. Rondas: suite-5 → re-escritos de suite-3 → regresión suite-2/matriz (expectativas
   auditadas). Evaluar gate C2 con los números de §2.
6. promptfoo cuando Martin declare el build cerrado.

## 12. Registro de contraste (método del proyecto)

- **Ronda 1 (Fable):** sostuvo v7-lite y el email reposicionado; encontró el agujero
  de recargos en ok_caveat (→ gate `solo_descuentos`); recolección por OPCIÓN listada,
  no por ejes; campos `paginas`/`copias` separados (premultiplicar = multiplicación
  encubierta); doble faz ni siquiera unitario (bracket necesita la unidad); flag
  `por_pagina`; conflicto/caps del contrato; `mas.cantidad`; mapa de goldens; 12 casos
  base de suite-5; 10 hazards.
- **Verificación propia en el motor:** `resolveCartItemPrice` (quote-utils.ts) — un
  solo `quantity` por ítem, primer rango que matchea gana, sin noción de copias. La
  ambigüedad restante es práctica del operador, no código.
- **Ronda 2 (Fable):** el "bracket por páginas" descansaba en monotonicidad NO
  garantizada → `max()` de dos lookups; la sobre-cotización multi-copia rompe el
  estimado en el caso apunte×50 → línea fija de volumen sin número; gap → tabla (sin
  rescate); lista concreta de `por_pagina` (anillado/encuadernado/plastificado false
  OBLIGATORIO + hazard cantidad=páginas con su golden); gate C2 sin filtro de
  atribución + kill-switch de clase plata + cláusula anti-gaming del límite de chars +
  definición observable de oscilación.

## Ronda 3 (post-build) — la query de verificación dio 16 filas

**Hallazgo (Martin aplicó la migración y corrió la query b, 2026-07-22):** las 8
variantes de IMPRESIONES 75/106 (exactamente los productos `por_pagina`) tienen
tabla de cantidad Y son alcanzadas por dos recargos de categoría: "Adicional papel
de color bookcel" y "Adicional papel obra a4/oficio 106 gr".

**Veredicto (Fable r3): NO bloquea la ronda de totales.** Fundamentos y acciones:

- La exposición NO la crean los totales: esas variantes muestran tabla verbatim
  desde Increment B con los mismos recargos coexistiendo. Los totales solo
  amplifican el monto del error si el LLM pifia la regla 5.
- Los adicionales son **opt-in** en el CÓDIGO (el motor solo aplica reglas
  seleccionadas por el operador — `selectedRules`). PERO la práctica del operador
  no es verificable en código: **la lectura opt-in es media verdad hasta la
  respuesta de TG (pregunta 33b)**. El "adicional 106 alcanza al propio 106" es
  targeting grueso por herencia de categoría, consistente con opt-in — no lo
  refuta ni lo prueba.
- **Backstop `papel_especial` APLICADO en Armar** (espejo del dorso), scopeado a
  filas `por_pagina` (cero falsos positivos fuera): pedido de bookcel / papel de
  color / color nombrado sin la palabra "color" (celeste, amarillo, rosa, crema…,
  siempre con ancla papel/hojas) / "más grueso"/"mejor papel" → sin número, email.
  "simple faz color", "impresión a color" y "a color en papel de obra" JAMÁS
  matchean (goldens de la regex en el harness, A29-A32; harness 45/45). El caso
  crítico es el "momentum": el cliente responde a la PREGUNTA de recolección con
  "simple faz color en papel celeste, 300" (suite-5 caso 16).
- Falso positivo aceptado y documentado: la negación ("no quiero papel de color")
  deriva a email — mismo trade-off que el dorso (suite-5 caso 17).
- **ROLLBACK PRE-DECIDIDO** (para no improvisarlo un viernes por WhatsApp): si TG
  responde 33(b) = "hay trabajos donde el adicional va siempre" → se apagan
  número/tabla/total de las variantes afectadas hasta re-modelar (la alternativa
  descartada pasa a ser LA respuesta). Si 33(b) = "solo a pedido" → el backstop
  queda, y el monitoreo de `fallback: papel_especial` en `bot.decisiones` decide
  con datos reales si la regex se poda o se extiende.

## Ronda 4 (suite-5 CORRIDA en WhatsApp real) — veredicto de arquitectura

**Resultado de la ronda 1 de suite-5 (Martin, 2026-07-22):** la maquinaria
determinística ANDA (caso 1 total exacto, caso 9 cap, caso 16 papel_especial,
render páginas×copias). El LLM falló feo en resolución y recolección: 12
incidentes inventariados (I1-I12, detalle en la memoria de sesión). Los graves:
I1 recolección nunca ocurre (oscila email-viejo / tabla de variante arbitraria);
I2 resolución errática 75↔106↔80 (números correctos del producto EQUIVOCADO, dos
veces); I3 marcas `*` filtradas + etiquetas inventadas → cascada sin_match; I8
"500 Tarjetas" × 150 unidades = $4.200.000 (precio POR PACK multiplicado).

**Veredicto Fable r4 a la pregunta de Martin (¿refinar el nodo o guards?): tres
capas con jerarquía fija, dos ya no opcionales.**

1. **Guards determinísticos = el PISO** (construidos YA, commit `cd790a9`): todo
   lo que toca plata debe sobrevivir a un LLM que resuelve mal — esta ronda probó
   que resuelve mal incluso emitiendo nombres canónicos válidos.
2. **El gate C2 SE DISPARÓ** — con las reglas de r2, no con opinión: la clase
   plata es "el monto mostrado NO es verdad para el pedido del cliente" (un número
   correcto del producto equivocado — I2 — o con unidad equivocada — I8 — es
   exactamente el screenshot-compromiso del kill-switch). I2+I8 = gate. E I1 =
   ronda 1 de C2(c) (oscilación). Dos vías independientes al mismo gate.
3. **Refinar el mono-prompt como estrategia queda descartado por evidencia**: 5+
   rondas calibraron precio y UNA función nueva (recolección) desestabilizó la
   resolución. 21k chars = techo de interferencia. El prompt solo se refina para
   conducta no-monetaria (regateo I7, cross-sell I10 — líneas ya aplicadas).

### Spec C2 (pendiente de OK de Martin — sesión de build propia)

- **Nodo LLM especialista "Cotizador"** (~4k chars): SOLO líneas cotizables
  (productos con `*`/`**` + por_pagina) + contrato precio/opciones + reglas de
  recolección. Sin reglas de email viejas, sin árbol completo.
- **Router DETERMINÍSTICO, sin LLM** (muere la objeción r1): Decidir consulta la
  última `accion` de `bot.decisiones` para ESA conversación (roundtrip Postgres
  ya existe pre-LLM: Firewall Tier-1); si fue `pregunto_opciones`/cotización
  dentro de N minutos → el turno va al especialista. Stateless intacto: el estado
  ES la telemetría que ya escribimos.
- **Action `opciones` con render determinístico** (la pieza que mata I3/I4 por
  construcción, mismo truco que `{{PRECIO}}`): el LLM emite
  `{"action":"opciones","productos":[...]}` y un Code node arma el menú desde las
  filas de la DB — nombres display verbatim, marcas `*`/`**` stripped, estructura
  de DOS niveles (producto → opción), checklist páginas/copias/cantidad en la
  plantilla. El LLM nunca tipea el menú → no puede filtrar marcas ni inventar
  etiquetas; el cliente responde citando strings exactos (lo que el LLM SÍ hace
  bien es ecoar).
- Nodo principal conserva info/FAQ/derivación/reglas 1-7 no-precio.

### Guards aplicados (r4, commit `cd790a9` — valen bajo cualquier arquitectura)

| Incidente | Mecanismo | Estado |
|---|---|---|
| I2 producto equivocado (plata) | Guard numerales: gramaje anclado del cliente (`75 gr`/`obra de 75`, ventana 3 msgs) ≠ gramaje de la fila → `fallback: producto_incoherente`. Comparaciones (75 vs 106) no disparan. | ✅ harness A36/A37 |
| I8 pack (plata) | Flag `por_pack` (migración `db/cotizador-v7b.sql` + seeds candidatos con NOTICE): cantidad JAMÁS multiplica ni elige bracket. Regex solo telemetría `(pack?)`. | ✅ A38/A39 |
| I11 momentum papel | Ventana K=3 mensajes entrantes + desbloqueo por corrección explícita ("papel común", "sin color"). | ✅ A34/A35 |
| I1-Frankenstein | Cascada de Parsear absorbe "por email a <dir>" completo. | ✅ P14 |
| I5 'X de X' | `nombreVar` oculta variante == canónico (normalizado). | ✅ A33 (commit `182ab2c`) |
| I7 regateo → handoff | Línea de prompt: regateo = regla 2, answer, nunca handoff ni repetir el número. | ✅ aplicada |
| I10 cross-sell | Línea regla 5: nunca ofrecer materiales como equivalente del no listado. | ✅ aplicada |
| I6 primera mención | Per-conversation correcto SI hubo conversación nueva entre casos — confirmar con Martin, no tocar. | ⏸ verificar |
| I9 `mas` perdido | Sin detección determinística posible; prompt del especialista (C2) + telemetría. Riesgo residual de dirección segura. | ⏸ C2 |
| I12 anillado 24hs | Verificar dato: `select v.variante, v.precio_lista, v.tiene_override from bot.variantes v join bot.taxonomia t using (producto_id) where t.nombre_canonico ~* 'anillado.*24';` — si hay override legítimo, la conducta fue CORRECTA. | ⏸ dato |
| I1/I2/I3 de fondo | Solo C2 + action opciones + curación de displays. | ⏸ C2 + curación |

### Notas de Martin post-ronda (2026-07-23 — refinan el diagnóstico)

- **El JSON del caso libro confirma que el CONTRATO funciona:** el LLM emitió
  `paginas: 120, copias: 1` correctos — la extracción de campos es confiable. Lo
  único roto es el naming: `producto: "Impresiones a4 s/f color"` (etiqueta
  inventada) → 0 filas de Get Precio → email. Refuerza el diseño C2: con el menú
  renderizado por Code node (strings reales), el eco del cliente resuelve y el
  resto de la cadena YA anda. Además el menú fabricado era INCOMPLETO (solo s/f,
  sin doble faz): otro argumento para el render determinístico.
- **I13 — variante presupuesta sin preguntar:** en tarjetas el bot asumió "Simple
  Faz" sin encapsular la pregunta (misma clase que la tabla d/f arbitraria de I1
  corrida B). Multi-variante sin elección del cliente → recolección 2b, nunca
  supuesto. Sin guard determinístico limpio (el vocabulario del cliente no mapea
  verificablemente a nombres de variante) → mecanismo: C2/action opciones +
  golden (suite-5 caso 21).
- **I14 — tiempos incrustados en nombres (anillados 24/48/72/96 hs):** Martin no
  quiere que el bot esté COMPROMETIENDO plazos vía nombre de producto. Va a la
  pasada de curación: consolidar la visibilidad del anillado (ocultar los
  por-tiempo y/o display sin plazo, una sola línea). **Decisión de producto
  pendiente de Martin: qué precio muestra la línea consolidada** (¿el del plazo
  estándar? ¿derivar el plazo al equipo?). OJO: esto MODIFICA la excepción v10.7
  ("el plazo del anillado es opción elegible del catálogo") — al consolidar, esa
  excepción muere y los plazos vuelven a ser 100% del equipo. Pega con I12 (el
  24hs que derivó sin número: verificar si es override).
- **Test 15:** el flujo mandó a Get Precio un producto distinto del pedido —
  confirma la clase I2; cubierto por ventana papel + guard numerales donde hay
  gramaje anclado; el resto de la clase se cierra con C2.

### Herramienta visual de curación (pedido de Martin — spec validada r4, build pendiente)

**Flujo:** (1) query de export → JSON del estado completo (taxonomia + variantes +
metas + candidatos); (2) **HTML self-contained** en el repo (un solo archivo, JSON
INLINEADO por el generador — `fetch()` local muere por CORS; alternativa: input
file); (3) Martin revisa grupo por grupo / uno a uno: actual vs propuesto,
aprueba/rechaza/edita; (4) exporta **.sql de upserts OPTIMISTAS** (cada upsert
condicionado al valor original vía el patrón `nombre_origen`; si la fila viva
cambió → 0 rows + NOTICE, nunca pisar al mostrador en silencio) + **.md de
decisiones** (trazabilidad). localStorage keyeado por timestamp del export
(sesiones interrumpidas). Martin aplica el SQL, como siempre.

**Lo que la UI DEBE mostrar para decidir bien:**
- Chequeo de colisión EN VIVO con la MISMA semántica que Get Precio (translate +
  lower + ranks exacto/sinónimo=1, contains≥4=2, variante=3): "este término
  rank-1ea a X" mientras se tipea. Con otra normalización, la herramienta miente.
- Alerta de casi-idénticos por rubro (la clase I2): overlap de tokens entre
  displays del mismo grupo ("...papel obra 75 gr" vs "...papel obra 106 gr" =
  4/6 tokens → rojo).
- La línea del catálogo RENDERIZADA como la ve el LLM (con `— también/usos/
  opciones`), no una celda de tabla.
- Estado de precio por variante (`*`/`**`, tabla/override/$0) y los flags
  `por_pagina`/`por_pack` EDITABLES ahí (acá vive el refinamiento de I8).
- Sinónimos y casos_de_uso como campos SEPARADOS (nombres matchean, intención
  solo guía — principio v10.8).
- Nice-to-have: qué goldens de tests/*.md referencian el nombre actual.

**Scope de la PASADA 1 (sesgado a lo que causó bugs de plata):** displays 75/106 a
máxima distintividad (interim sin TG: reordenar tokens; calificadores de papel =
afirmaciones físicas → gate TG); flags `por_pack` (refinar los candidatos del
seed v7b); completar `por_pagina`; dato del anillado 24hs; **consolidación de los
anillados por-tiempo (I14: display sin plazo / ocultar duplicados — decisión de
Martin sobre qué precio muestra la línea única)**; Tier B de v10.8 solo si la
pasada viene fluida. NO re-curar sinónimos ya podados (calibración viva).
