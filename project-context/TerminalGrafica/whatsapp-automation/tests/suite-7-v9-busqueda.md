# Suite 7 — v9: búsqueda por palabra + filtro (estado del bot)

> **Qué es esta suite.** No es sólo "probar v8.3": es la foto del estado del bot para
> decidir qué optimizar después. Por eso está ordenada por lo que cuesta plata, no por
> lo que es fácil de probar.
>
> **Cómo se corre.** WhatsApp real contra el catálogo de testing, conversación nueva
> entre casos (o resolver en Chatwoot). Cada renglón `>` es un mensaje del cliente.
> Anotá el mensaje que salió **textual** — la voz importa tanto como el número.
>
> **Prerrequisitos (los tres, en orden):**
> 1. **SQL:** ninguno nuevo. v9 no trae migración. ✅
> 2. **Re-importar `n8n/flows/faq-bot-v9.json`** (71 nodos). Las credenciales viajan
>    con su id, así que no hay trabajo manual.
> 3. **`GET /webhook/refrescar-catalogo`** — sólo si tocaste el catálogo desde la
>    última corrida. Ojo: **únicamente la URL de producción persiste** (`staticData`
>    no se guarda en ejecuciones manuales); el botón Execute del editor no sirve.
>
> **Rollback:** re-importar `faq-bot-v8.json`. No hay nada que revertir en la base.
>
> **Antes de correr nada, corré esto:**
> ```
> node tests/build-v9.js --check      # v9 al día con su build
> WF=faq-bot-v9.json node tests/code-harness.js       # 221/221
> WF=faq-bot-v9.json node tests/regen-arp2-twin.js    # gemelo en sync
> WF=faq-bot-v9.json node tests/validate-v8-import.js # 0 errores
> ```

---

## 0. La consulta que valida el fix del log — CORRER PRIMERO

El bug 0a: `Log Turno` leía el `$json` de la respuesta de Chatwoot, así que
`borrador`, `final` y `senales` se escribían **null en todos los turnos**. Y como
`borradoresPrevios` sale de ahí, **los dos anti-loops nunca contaban nada**.

Mandale **cualquier** mensaje al bot (por ejemplo `hola`), y después:

```sql
select mensaje_cliente, accion, notas,
       borrador is not null as tiene_borrador,
       final    is not null as tiene_final,
       senales  is not null as tiene_senales,
       execution_id
  from bot.decisiones
 order by created_at desc limit 3;
```

**Esperado: las tres columnas en `true`.** Si alguna sigue en `false`, **parar acá** —
todo lo que sigue se depura a ciegas y los anti-loops están muertos.

> Es la consulta de `v8-3` §5 quater, corrida ahora como verificación en vez de como
> diagnóstico: la causa ya se encontró leyendo el workflow.

---

## A. El caso de aceptación — la razón de ser de v8.3

Evidencia real de la ronda del 27, no un caso inventado.

**A1. El piso y el techo juntos**
> `cuánto sale imprimir 100 hojas a color?`

- **Esperado:** entre las opciones aparece **`Impresiones papel obra 75 gr`** —la más
  barata del catálogo, que es inkjet y vive en otro rubro— junto a las del rubro láser
  color. En v8 salían **sólo las 4 del láser**: el cliente veía el techo y no el piso.
- **Falla si:** vuelve a listar sólo láser color, o si lista obra 75 **sola** (el techo
  también tiene que estar: el cliente elige, no el bot).
- **Anotá:** cuántas opciones salieron y en qué orden.
- **BD:** `notas` trae los nombres canónicos que entraron. `senales.filas` dice cuántas.

**A2. La palabra rara manda (ponderación por rareza)**
> `necesito papel kraft a4`

- **Esperado:** resuelve a los **2 productos kraft**, no a los 31 que contienen la
  palabra `papel`. El IDF pondera `kraft` (2 de 88 productos) ~3,5× más que `papel`
  (30 de 88).
- **Falla si:** aparecen productos sin kraft, o si deriva a email por ambiguo.

**A3. El caso que explotaba (46 candidatos)**
> `busco papel ilustración para 500 folletos`

- **Esperado:** las ilustraciones arriba. Medido en el plan: sin ponderación esto traía
  **46 candidatos, más de la mitad del catálogo**.
- **Anotá:** si salen productos que no tienen nada que ver, es que el corte por score
  (0.4 × el mejor) quedó flojo → es un número para calibrar, no un bug.

---

## B. Plata — los guards que la pasada adversarial marcó

Esta sección es la más importante. Un error acá cuesta dinero real.

**B1. El nicho no se filtra a quien no califica** ⚠️ *el hallazgo de la lente de plata*
> `cuánto sale imprimir un apunte de 200 páginas?`

- **Esperado:** cotiza impresión común (obra 75 y hermanos). **NUNCA** aparece
  `Impresión de módulos/apuntes de medicina` ni su precio especial ($45/página).
- **Por qué importa:** `apuntes` es sinónimo literal del producto de medicina, así que
  la búsqueda lo trae **primero**. En v9 el guard vive en el `WHERE` del SQL, no en el
  prompt: si aparece, el guard no está funcionando.
- **Falla si:** lo menciona, aunque sea para descartarlo. Nombrarlo ya filtra que existe.

**B2. La promo de inmobiliarias, igual**
> `cuánto sale un cartel de 1x0.65?`

- **Esperado:** el corrugado real (**$19.500**). **No** la promo de $15.000.
- **Falla si:** aparece la promo sin que el cliente haya dicho "inmobiliaria".

**B3. El nicho SÍ aparece cuando corresponde**
> `hola, imprimen apuntes de medicina?`

- **Esperado:** ahora sí, el producto de medicina y su precio. El guard es
  condicional, no una prohibición.
- **Falla si:** lo esconde igual → el guard quedó demasiado duro y perdés una venta.

**B4. La ventana, no el mensaje suelto**
> `hola, imprimen apuntes de medicina?`
> *(esperá la respuesta)*
> `son 200 páginas`

- **Esperado:** el segundo mensaje **sigue** cotizando medicina. El guard mira la
  conversación entera, no el último mensaje.

**B5. `solo_descuentos`: entra sólo si lo pedís por nombre**
> `cuánto sale el papel kraft 300?`

- **Esperado:** lo cotiza (lo pediste por nombre).
- Contra-prueba: `qué papeles gruesos tienen?` → **no** debería ofrecer
  espontáneamente los `solo_descuentos` (54 de 185 variantes).
- **Anotá:** este es el más difícil de juzgar. Si dudás, anotá qué salió y lo miramos.

**B6. La puerta abierta sigue saliendo** ⚠️ *el hallazgo más caro*
> `cuánto sale imprimir 300 hojas?`

- **Esperado:** un número **+ la puerta**: *"Si lo necesitás en color es otro precio,
  avisame."* El color mueve **4×** ($100 vs $400 la página); el gramaje, 20%.
- **Por qué importa:** en v8 la compuerta salía del rowcount de `Get Precio`, o sea
  *después* de que el LLM ya había elegido. Con v9 el producto viene elegido de una
  lista → `Get Precio` resuelve exacto → **la puerta se apagaba justo cuando más hace
  falta**. Ahora se mide sobre el candidato-set pre-filtro.
- **Falla si:** sale el número pelado, sin puerta.
- **BD:** `notas` tiene que traer `(puerta:color)`.

**B7. Una sola puerta por mensaje**
- En B6, **no** deberían salir dos ("si lo querés en color… y si lo querés doble faz…").
  Dos supuestos declarados se leen como un formulario.

---

## C. La conducta nueva: mostrar todo, nunca repreguntar

*Decisión de Martin, 2026-07-27 (`decisions/log.md`).*

**C1. Los gemelos listan, no preguntan**
> `cuánto sale el papel kraft a4?`

- **Esperado:** lista **las dos** opciones (Kraft 130 y Kraft 300) en un mensaje.
- **Falla si:** pregunta *"¿De qué gramaje lo necesitás?"* — esa es la conducta de v8.
- **BD:** `notas` sigue trayendo `(gemelos:gramaje_gr)`. El eje se sigue **calculando**
  (es telemetría útil); lo que cambió es que ya no se pregunta.

**C2. El cupo subió a 8**
> `qué tipos de impresión tienen?`

- **Esperado:** hasta 8 opciones, redactadas por el compositor como prosa legible, no
  como una lista cruda de 8 renglones.
- **Anotá:** **¿se lee bien?** Esta es la pregunta abierta de la suite. El cupo de 4 se
  fijó cuando el compositor no funcionaba; si con 8 el mensaje queda ilegible, el
  número se baja — pero se baja **con evidencia**, no por precaución.

**C3. El anti-loop sigue vivo**
> Repetí el mismo pedido ambiguo 3 veces seguidas.

- **Esperado:** a la tercera deriva a mail en vez de mandar la misma lista otra vez.
- **Depende del fix del log (§0).** Si §0 falló, esto falla también.

---

## D. Resolución — que no se rompió lo que andaba

**D1. La palabra distintiva sigue siendo quirúrgica**
> `cuánto sale anillar?` → 3 opciones de anillado (los ocultos por plazo no salen).
> `me hacen fotocopias?` → impresiones.
> `precio de las rifas?` → talonarios.
> `una lona de 3x2` → lonas, y **NO** talonarios (la frontera de palabra aguanta).

**D2. Doble faz por hoja** *(la inferencia más cara del catálogo, pregunta TG 63)*
> `cuánto sale imprimir 200 páginas a doble faz?`

- **Esperado:** cuenta **100 hojas**, no 200. El mensaje dice "a doble faz (100 hojas)".
- **Falla si:** cotiza 200 → sub-cotiza 2× en cada trabajo a doble faz.

**D3. El pack no multiplica**
> `necesito 200 tarjetas`

- **Esperado:** te ofrece los packs (100 / 500 / 1000). **NUNCA** 200 × el precio del
  pack. En suite-5 esto dio $4.200.000 una vez.

**D4. El acento descompuesto (bug 0b)**
> Desde un teclado de **iPhone o Mac**: `cuánto sale una impresión a color?`

- **Esperado:** resuelve normal.
- **Por qué:** iOS/macOS emiten la tilde descompuesta (`o` + U+0301). En v8 eso moría
  en silencio; en v8.3 sería **peor** (el token no matchea, los otros sí → la lista se
  arma sin el candidato correcto y sin ninguna señal de que faltó algo).
- **Si no tenés iPhone a mano:** saltealo, el harness lo cubre (T5).

---

## E. Costo y latencia — para decidir qué optimizar

Esto no es pass/fail: son **mediciones** para la conversación de optimización.

**E1. ¿Cuántas llamadas LLM por turno?**
En n8n, Executions → una ejecución de precio → contá los nodos `Llamar LLM *` que
corrieron.
- **Esperado:** 2 en el caso común (respuesta + compositor). El filtro **no** corre con
  0 o 1 candidato (el nodo `¿Filtrar?` lo saltea).
- **Anotá cuántas veces corrió `Llamar LLM Filtro`** sobre el total de turnos de precio.
  Ese número decide si el gate está bien puesto.

**E2. ¿Cuánto tarda?**
Cronometrá desde que mandás hasta que llega la respuesta.
- **Referencia v8:** ~6,6 s típico, ~11,5 s el peor.
- **Anotá el peor caso.** Si pasa de ~15 s, el cliente ya se fue y hay que mirar el
  pipeline.

**E3. ¿Cuántos candidatos trae la búsqueda?**
```sql
select mensaje_cliente, notas, senales->>'filas' as filas_sql,
       senales->>'descartados' as descartados
  from bot.decisiones
 where accion in ('informo_precio','pregunto_opciones')
 order by created_at desc limit 20;
```
- **Para qué:** si `filas` viene alto seguido, el corte por score está flojo. Si viene
  siempre 1, el corte está **duro** y el filtro no está viendo alternativas — que es el
  bug que arreglamos, disfrazado.

---

## F. Lo que esta suite NO cubre (a propósito)

Para que nadie lea un verde como más de lo que es:

- **El SQL de búsqueda no tiene test automático.** El IDF y los tres guards viven en
  Postgres y necesitan la base. El harness cubre los 3 nodos Code (19 tests), no la
  query. **La sección B es la única verificación real de los guards de negocio.**
- **La suite entera pregunta "dada una búsqueda razonable, ¿el resto aguanta?"**. La
  clase *"la búsqueda trajo cualquier cosa"* sólo la ve la sección A. Es la misma
  limitación estructural que tenía el harness antes (`armar(precioObj, rows, dec)`
  recibe las filas ya resueltas), un escalón más arriba.
- **No mide el confident-wrong.** Un número equivocado dicho con confianza se ve
  igual que uno correcto. Para eso hace falta cruzar `bot.decisiones` contra el
  catálogo, offline.

---

## Plantilla para anotar

```
Caso   Mensaje                          Salió                          ¿OK?  Nota
────────────────────────────────────────────────────────────────────────────────
A1     imprimir 100 hojas a color       ...                            
B1     apunte de 200 páginas            ...                            
B6     imprimir 300 hojas               ...                            
C2     qué tipos de impresión tienen    ...                            ¿legible con 8?
E2     (peor latencia observada)        ... s                          
```
