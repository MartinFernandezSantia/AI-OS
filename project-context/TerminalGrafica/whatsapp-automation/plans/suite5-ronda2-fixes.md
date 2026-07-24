# Suite-5 Ronda 2 — Diagnóstico y paquete de fixes r6 (2026-07-23)

> Diagnóstico de los incidentes que Martin reportó de la ronda 2 de suite-5
> (corrida en WhatsApp real contra el catálogo curado) + el paquete de fixes
> construido en esta sesión. Estado: **CONSTRUIDO, pendiente de aplicar**
> (runbook en `handoff-proximas-sesiones.md` §⭐). Harness: **81/81**.
> Contraste Fable: esta sesión corrió EN Fable + ronda adversarial r6-review
> (§5: 7 hallazgos, los 5 accionables ya corregidos en este mismo paquete).

---

## 1. Qué pasó — incidente por caso (numeración = casos de suite-5)

| Caso | Síntoma | Causa raíz | Fix |
|---|---|---|---|
| 4 | "apuntes en PDF, 180 pág, 2 copias, simple faz b/n" → Get Precio 0 filas → email | El LLM emitió el producto INVENTADO "Impresiones a4 s/f color" (fusión del nombre de la variante única de medicina, que es idéntico a un nombre de producto) + variante "simple faz b/n" que medicina no tiene. `sin_match` derivaba a email. | RC-1, RC-2, RC-3 |
| 5 | Menú de 1 sola opción para "libro en PDF"; presupuso medicina; pide "el número" | Medicina entra como candidato por el "apuntes" de su display; menú de 1 opción renderizado como menú; copy pedía número. | RC-2, RC-4, RC-5 |
| 7 | "apuntes 120 pág + anillado" → menú SOLO de anillado → "1" → email | (a) El LLM descartó el ítem impresiones al emitir opciones; (b) elegido "1", Get Precio dio 0 filas: el escape mono-variante exigía variante no-alfanumérica y la variante del anillado se llama como el producto (la curación pasada 1 asumió un fallback que no existía así). | RC-1, RC-3, RC-6 |
| 11 | Menú de 12 líneas de tarjetas; ignoró las 200 impresiones a3 | El cupo de `productos` era 3 y los 3 packs de tarjetas lo llenaron → el a3 quedó afuera. Además 12 líneas = sopa. | RC-5, RC-6 |
| 12 | Lona 3x2 → menú crudo de 2 productos, sin datos para elegir | Menú correcto pero mudo: el "ancho máx 1.52" vivía en el nombre de la variante, y "Lona Mate" salía duplicada (variante = producto). | RC-4 (curación) |
| 13 | Anillado con "de 24 horas" en la respuesta + frase acartonada | El nombre de la variante única del anillado ("...24 hs") se filtra al catálogo/render; el prompt no pedía el precio DENTRO de una frase natural. La decisión I14 de curación era plazo → equipo. | RC-4, RC-7 |
| 14 | "30 pág, 50 copias, simple faz b/n" → 0 filas → email | El LLM emitió producto inventado + variante "doble faz b/n" (el cliente dijo SIMPLE). Si hubiera matcheado, salía el precio del doble faz. | RC-1, RC-3, guard faz inversa |
| 18 | "106" (respuesta a la repregunta de papel) → 0 filas → email | Producto inventado "Impresiones a4 s/f b/n" (fusión producto+variante). | RC-1, RC-3 |
| 20* | "150 tarjetas" → precio directo del pack de 100 Simple Faz sin preguntar | Variante presupuesta (I13 reincidente) + cambio de producto post-menú sin `volver`/opciones. `por_pack` evitó el ×150. | RC-3 (prompt), telemetría |
| 21 | Menú tarjetas en orden 100/1000/500 y variantes repetidas ×3 | `order by nombre_canonico` = orden de string; sin pivot de packs. | RC-5 |
| 25* | "¿hasta qué hora están hoy?" repetido → silencio | **NO era bug** (aclaración Martin 2026-07-24): re-preguntó para confirmar que el bot no re-manda la misma respuesta. El silencio es lo deseado (ahorra un mensaje pago). RC-8 revertido. | RC-8 (revertido) |

\* No numerados por Martin pero visibles en las capturas.

**Lo que funcionó y NO se tocó:** total directo con bracket (caso 1), recolección
en un mensaje (2/3), cap 999999 (9), anti-regateo (8/10), papel especial y su
ventana (15-17), menú determinístico + elección por número (22/23), stickiness
(24), firewall en recolección (27), libro E2E por el camino nuevo (28).

---

## 2. Causas raíz → fixes (paquete r6)

### RC-1 — `sin_match`/`ambiguo` derivaban a email (violaba "WhatsApp informa TODO")
Un fallo de RESOLUCIÓN (el LLM inventó una clave) no es un precio que el sistema
no pueda dar: es recuperable repreguntando. Ahora en `Armar Respuesta Precio`:
- `sin_match` → repregunta fija ("¿Me lo decís de nuevo o me contás para qué lo
  necesitás?") — sin email.
- `ambiguo` (2-12 filas reales) → **menú rescate** numerado determinístico con
  esas filas (mismo formato que Armar Menu; nombra el producto si es uno solo).
- Ambos loguean `accion='pregunto_opciones'` (el `Log Precio` ahora toma
  `accionLog` del render) → el follow-up cae al ESPECIALISTA, que sí tiene el
  catálogo cotizable para resolver.
- Anti-loop espejo del menú: la misma repregunta 2 veces → derivación email.
- Los fallbacks legítimos (override, qr_multiple, precio_cero, dorso,
  papel_especial, producto_incoherente, sql_error) SIGUEN yendo a email.
- Sobre una repregunta NO se renderizan los extras de `mas` (reaparecen en el
  follow-up vía "los datos ya dados no se re-preguntan").

### RC-2 — Guard de NICHO (medicina) + selección de candidatos genéricos (r6d)
El precio especial de medicina ($45/pág) salía para cualquier "apuntes", y en el
caso 5 medicina fue el ÚNICO candidato del menú (ni siquiera aparecían las
impresiones comunes). Dos capas:
- **Guard determinístico** en render Y menú: producto cuyo nombre matchea
  `/medicin/i` solo fluye si el cliente nombró el nicho en la conversación; si
  no, repregunta honesta ("¿Es material de medicina...?"). Config = lista
  `NICHOS` en los dos Code nodes. Esto CIERRA el resultado grave (medicina no
  llega al cliente sin mención) pero solo recupera, no ofrece lo correcto.
- **Selección (r6d, nota de Martin post-review):** la raíz era que la línea de
  medicina es la única del catálogo con "apuntes" en el NOMBRE (obra 75 tenía
  sinónimos vacíos) → el LLM la elegía como único candidato. Fix en las dos
  capas: (a) regla explícita en ambos prompts — los candidatos de un documento
  GENÉRICO son las impresiones por página COMUNES; medicina solo si el cliente
  la nombró y NUNCA como reemplazo de las comunes; (b) curación b §5 — sinónimos
  `apuntes`/`libro` en obra 75 y `libro` en 106 (rank-1 exacto + anclaje visible
  en la línea "también:" del catálogo), preservando `por_pagina=true`.
Gate de datos sigue siendo la pregunta TG 34; el alcance comercial es la 36.

### RC-3 — Prompts: anti-fusión, multi-ítem, escape del menú
- **Anti-fusión** (especialista + general): "producto" es la línea `- ` verbatim;
  PROHIBIDO fusionar producto+opción o inventar nombres ("Impresiones a4 s/f b/n"
  NO existe). Con ejemplo negativo explícito.
- **Multi-ítem nunca se descarta** (los dos prompts): todos definidos → principal
  + `mas`; alguno necesita elección → `opciones` con TODOS los productos en juego;
  al elegir del menú, los otros ítems ya definidos van en `mas` (ejemplo del caso
  7 real en el prompt del especialista).
- **Escape del menú** (especialista): si lo pedido NO está entre las líneas del
  último menú → `opciones` de nuevo, nunca un precio forzado.
- **Guard faz inversa** (determinístico, espejo del dorso): cliente pidió simple
  faz y la fila resuelta es doble faz → `fallback: faz_incoherente` → repregunta
  "¿simple o doble faz?". Cierra la mitad peligrosa del caso 14.

### RC-4 — Curación b (`db/curacion-2026-07-23b.sql`)
Variantes ÚNICAS con nombre-de-producto → `display_variante='.'`:
1. Anillado 24 hs (el "24 hs" deja de mostrarse; sinónimos express/urgente quedan)
2. Medicina "Impresion a4 s/f color" (elimina el material de fusión de RC-1)
3. "Lona Mate" (= producto, salía duplicada)
4. Lona Front Brillo: el ancho sube al display del producto → **"Lona front
   brillo (ancho máx 1,52 m)"**, variante '.'. El cliente de la lona 3x2 ahora VE
   el límite en el menú y puede descartar solo (el bot sigue sin calcular m² —
   esa prohibición no cambió).
Además el System Prompt ya no dice que el plazo del anillado "se elige como
variante" (quedó stale post-curación): plazos → equipo, coherente con I14.

### RC-5 — Menú: orden, pivot de packs, cupo 4
- **Orden natural**: los números ordenan como números → 100, 500, 1000.
- **Pivot de packs**: si TODOS los productos del menú son `<N> <misma familia>`
  con variantes idénticas → variantes UNA vez + "packs de 100, 500 o 1000" en el
  header. 12 líneas → 4. El especialista tiene la regla de mapeo inverso
  ("producto" = "<pack> <familia>"); si pifia, cae en `sin_match` → repregunta
  (recuperable, ya no email).
- **Cupo de `opciones` 3 → 4** (query + Parsear + prompts): 3 packs de tarjetas
  ya no expulsan al segundo ítem del pedido.

### RC-6 — Get Precio: escape mono-variante real
`(count(variantes)==1 AND variante no-alfanumérica)` → `count(variantes)==1` a
secas. Un producto de UNA variante matchea aunque el slot variante venga vacío o
mal (no hay nada que elegir). Telemetría: `(variante rescatada: mono)`.

### RC-7 — Naturalidad
- Menú: "decime cuál opción querés (vale mandar solo el número)" — el número es
  atajo, no requisito (nota de Martin).
- Opción ÚNICA: sin menú — "Para eso tenemos X: decime cuántas páginas...".
- Prompts: {{PRECIO}} DENTRO de una frase natural ("El anillado te queda en
  {{PRECIO}}"), nunca coletilla.

### RC-8 — repeatNote — REVERTIDO 2026-07-24 (aclaración de Martin)
Mi fix original agregaba una excepción (pregunta repetida / "???" → re-contestar).
**Martin aclaró que NO era un bug:** él re-preguntó la hora a propósito para
confirmar que el bot NO re-mandara la misma respuesta — con el cobro de Meta por
mensaje (desde 1-oct-2026), callarse ante una pregunta ya respondida es lo
DESEADO, no un fallo. La excepción quedó revertida; el bot vuelve a `noop` cuando
su respuesta no agregaría nada nuevo. El backstop determinístico de 2 repeticiones
textuales sigue como estaba. (El caso "???" tras silencio se acepta: un mensaje
ahorrado vale más que romper el silencio.)

---

## 3. Decisiones tomadas en esta sesión (reversibles) y puntos abiertos

1. **Pivot de packs ON por defecto.** Riesgo: el LLM chico reconstruye mal
   "<pack> <familia>". Mitigación: regla explícita + `sin_match` ahora repregunta
   (antes: email = conversación muerta). Rollback: revertir el bloque `esFamilia`
   en Armar Menu Opciones.
2. **La idea de Martin de una 2ª llamada LLM post-menú (decidir si enviar o
   volver al LLM principal): NO por ahora.** Lo que la motivaba (menús tontos de
   1 opción, robóticos, orden malo) se resolvió determinístico = 0 tokens, 0
   latencia, 0 riesgo de hallucination en un paso monetario. Reevaluar en ronda 3
   si los menús siguen sintiéndose torpes.
3. **Caso 12 (lona 3x2 → elegir mate por el ancho): NO se automatiza.** Decidir
   por el cliente exigiría interpretar "3x2" (¿cuál es el ancho?) — exactamente
   la clase de inferencia que el mundo cerrado prohíbe. Con el ancho visible en
   el menú, decide el cliente.
4. **Pregunta TG 36 (nueva):** ¿el precio especial de medicina es exclusivo del
   material de medicina o se lo dan a cualquier apunte? Define si el guard de
   nicho se queda como está o se relaja.
5. Caso 17 (corrección "dale en blanco común" sin la palabra "papel" no
   desbloquea la ventana): documentado como aceptado en suite-5 r4 — sin cambio.

## 4. Ronda adversarial r6-review (Fable, misma sesión) — hallazgos y qué se hizo

La ronda ejecutó el código real de los nodos con 10 escenarios de ataque además
del harness. Confirmó 7 hallazgos; H1-H6 se corrigieron en este paquete:

- **H1 (ALTA, corregido):** el guard dorso testeaba también el ECO del LLM
  (`variPedida`) — con el escape mono-variante nuevo, "módulos de medicina,
  doble faz" con eco `variante='doble faz'` sacaba el TOTAL del simple faz
  ($16.200 con cara de correcto), y la propia repregunta `faz_incoherente`
  inducía el camino (cliente contesta "doble faz" → eco → número equivocado).
  Fix: `varianteEsDF` SOLO con datos de DB (variante + nombre canónico);
  verificado contra el export que ningún mono real contiene doble/dorso.
- **H2 (MEDIA, corregido):** `s\s*\/\s*f` matcheaba por substring ("folleto**s /
  f**lyers") y repreguntaba la faz contradiciendo al cliente. Fix: `\b` en ambos
  lados (ídem el `d/f` de pidioDF, que tenía el hazard espejo pre-r6).
- **H3 (MEDIA-BAJA, corregido):** la ventana K=3 del guard nicho olvidaba
  "medicina" tras un desvío en la recolección → repreguntaba lo ya dicho hasta
  el anti-loop. Fix: ventana nicho = TODOS los mensajes user de la conversación
  (Decidir ya la capea a ~6). El guard papel mantiene su K=3 (calibración aparte).
- **H4 (MEDIA-BAJA, corregido en curación b):** esconder "24 hs" del render no
  alcanzaba — el catálogo del LLM seguía diciendo "entrega al dia siguiente"
  (material para prometer un plazo que I14 devolvió al equipo). Fix: poda de ese
  sinónimo y esos usos en `producto_meta` del anillado.
- **H5 (BAJA, corregido):** menú pivotado + "la 2" sin pack: el prompt no decía
  con qué action pedir el pack (el especialista podía emitir `opciones` con la
  familia sin número → `menu_sin_match` → conversación reseteada). Fix: "si no
  dijo el pack, preguntáselo con action answer".
- **H6 (BAJA, corregido parcial):** el menú rescate de ambiguo ahora también
  filtra el nicho (no OFRECE medicina a quien no la nombró) y no duplica
  header+línea en grupos mono ("Lona Mate: / 1. Lona Mate"). Queda como aspereza
  conocida: el rescate solo lista filas que RESOLVIERON (un multi-variante sin
  match de variante no aparece).
- **H7 (riesgo residual, VIGILAR en ronda 3):** el escape mono descarta en
  silencio atributos del slot variante que ningún guard cubre (tamaño "oficio",
  color "b/n" sobre la mono de medicina). Telemetría ya existe: revisar las
  filas con `(variante rescatada: mono)` en `bot.decisiones` después de la
  ronda 3 antes de decidir guards de tamaño/color.

Aguantaron el ataque (sin cambio): expresión de Log Precio, cupo 4 en las 3
capas, repeatNote vs anti-loop (el ciclo A-B-C largo lo corta el cap 25/24h),
SQL de Get Precio sin filas duplicadas, claves naturales de curación b contra el
export vivo, mapeo inverso del pivot, opción única con qr=1 y precio $0.

## 5. Ronda 3 — replay mínimo

Tras aplicar (runbook §⭐ del handoff): re-correr **4, 5, 7, 11, 12, 13, 14, 15→18,
20, 21, 25 (repetido + "???")** y los C2 que faltaron; regresión rápida de 1, 9,
10, 22-24, 27, 28. En BD: `notas` con `(repregunta)`, `(variante rescatada: mono)`,
`fallback: faz_incoherente`, `fallback: producto_nicho`, `menu_pack`, `menu_unico`,
`menu_nicho` son los marcadores nuevos a vigilar.
