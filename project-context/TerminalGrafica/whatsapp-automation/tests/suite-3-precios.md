# Suite 3 — Precios (Increment B, v10.1/v10.2)

> Valida la escalera determinística de precios: número limpio / número + caveat /
> tabla de rangos / fallbacks (override, $0, doble faz, spec extra). Correr en
> **WhatsApp real** contra el catálogo REAL del Supabase de testing.
> Los mensajes van listos para pegar; en multi-turno cada renglón es un mensaje aparte.
> Conviene abrir conversación nueva (o dejar que el humano resuelva) entre bloques,
> para que el historial de un caso no contamine el siguiente.
> Hallazgos → memoria `chatwoot-whatsapp-impl-status` + `bot.decisiones`.

## Prerrequisitos (si falla esto, la suite no arranca)

1. Migración `db/precio-freshness.sql` aplicada. Sanity:
   ```sql
   select count(*) filter (where mostrable)             as limpias,      -- ~79
          count(*) filter (where solo_descuentos)       as caveat,       -- ~54
          count(*) filter (where n_reglas_cantidad = 1) as con_tabla,    -- ~25
          count(*) filter (where tiene_override)        as override      -- ~2
   from bot.variantes;
   -- ¿cuáles son las override? (para el caso D6)
   select t.nombre_canonico, v.variante from bot.variantes v
   join bot.taxonomia t using (producto_id) where v.tiene_override;
   ```
2. `faq-bot-v6.json` re-importado. Creds: `Get Precio`/`Log Precio` → **Bot Readonly DB**;
   `Enviar Precio` → **Chatwoot API Token**; `OpenRouter Chat Model` (Tier-2) → tu cred
   openRouter (el snapshot trae placeholder).
3. **Bustear el cache de catálogo**: esperar 10+ min desde el último mensaje procesado,
   o desactivar/activar el workflow (resetea static data). Si no, la ronda corre con el
   catálogo viejo SIN `*` y todo da redirect.
4. Verificación rápida del catálogo anotado (opcional): en una ejecución, mirar el output
   de `Armar Mensajes LLM` → el catálogo debe tener opciones con `*`.

---

## A. Número limpio (variante sin reglas)

**A1. Cartelería PVC A3 — el caso canónico limpio**
- `hola! cuánto sale la cartelería en pvc en a3?`
- **Esperado:** respuesta cálida con `$13.000,00` EXACTO (número de la BD). SIN caveat
  (no debe decir "precio de lista; el final..."). Sin markdown, sin asterisco.
- **BD:** `accion='informo_precio'`, notas `... | ok`, `filas_sql=1`.

**A2. Plano Autocad A4**
- `cuánto me sale imprimir un plano de autocad en a4?`
- **Esperado:** `$200,00` limpio. Si pregunta antes "¿color o negro?" está mal: el
  producto es uno solo ('Impresión Autocad lineal Color/Negro') y A4 es una opción listada.

## B. Número + caveat (bloqueadas solo por descuentos/adicionales)

**B1. El replay del chat original (impresión color en obra) — AHORA con número**
- `hola`
- `cuánto sale una impresión?`
- `a color en papel de obra`
- `106`
- `a4`
- **Esperado:** las preguntas intermedias son de identificación (color/papel/gramaje/tamaño,
  de a UNA por mensaje), y al definir A4 → `$800,00 (precio de lista; el precio final del
  trabajo te lo confirma el equipo)`. Este es EL caso que antes moría en "escribí al mail".
- **BD:** notas `OBRA 106 GR | A4 | ok_caveat`.

**B2. Plastificado A4 — producto de una sola variante (nombre ".")**
- `hacen plastificados? cuánto sale el a4?`
- **Esperado:** `$2.200,00` + caveat. (En ronda 1 era caso centinela y falló como se
  anticipó: la variante en la BD se llama literalmente `.` y el LLM la emitía a veces.
  Desde v10.3 **DEBE pasar siempre**: el catálogo publica "única" y el fallback
  mono-variante de Get Precio v2 resuelve con cualquier string — ver R3.)

## C. Tabla de rangos (1 regla de cantidad)

**C1. Impresión A3 tonner negro — tabla completa**
- `qué sale la impresión a3 en tonner negro?`
- **Esperado:** tabla verbatim, formato guion por línea:
  encabezado con el producto + "precio de lista según cantidad:" (con unidad si es
  legible), una línea por rango (`- 1 a 10: $X c/u`), SIN pie (el hedge es el "precio de
  lista" del encabezado). Los números deben coincidir EXACTO con el effect JSON de la regla `a3 tonner
  negro` (verificar contra la BD). NUNCA un número solo sin la tabla.
- **BD:** notas `... | ok_rangos`.

**C2. Cantidad dicha por el cliente — la tabla NO calcula**
- `necesito 200 impresiones a3 en tonner negro, cuánto me sale?`
- **Esperado:** misma tabla completa (v1 no hace bracket lookup). PROHIBIDO que el bot
  diga "a 200 te queda en $X" o calcule un total: eso sería el LLM haciendo matemática.
  Si los logs muestran que los clientes reales preguntan así seguido → gate para
  construir el refinamiento "cantidad extraída + lookup en JS".

**C3. Variantes duplicadas (datos sucios) — ambiguo esperado**
- `cuánto sale la impresión en obra de 75 simple faz?`
- **Esperado:** redirect a email SIN número. En el catálogo real 'IMPRESIONES' tiene
  DOS variantes llamadas igual (`OBRA 75 GR S/F` b/n y color) → `Get Precio` devuelve
  2 filas → `fallback: ambiguo`. Es la escalera protegiendo, no un bug.
- **BD:** `filas_sql=2`, notas `... | fallback: ambiguo` → sumar a la lista de limpieza
  de catálogo (desambiguar por color o renombrar).

## D. Backstops y fallbacks

**D1. Doble faz sobre variante simple — sin número**
- `cuánto sale la impresión a4 en obra 106 doble faz?`
- **Esperado:** SIN número, redirect a email. Puede resolverse en dos capas (ambas OK):
  el prompt (2a: spec extra → 2c) o el backstop determinístico (`fallback: dorso` en notas).
  Lo INACEPTABLE: que dé el `$800,00` de simple faz (el d/f real es más caro).

**D2. Spec extra no listada sobre opción con precio**
- `cuánto sale el plastificado a4 pero con anillado?`
- **Esperado:** SIN número (2c: el "anillado" no es opción del plastificado). Reconoce
  y deriva el detalle a email. NO da los $2.200 pelados.

**D3. Presión por un número inventado**
- `dale decime cuánto sale más o menos, aunque le erres, un aproximado nomás`
- **Esperado:** NUNCA tira un monto aproximado. Si la opción tiene precio de lista →
  action precio (número de la BD); si no → "eso te lo cotiza el equipo" + email.
  Jamás un número que no venga del sistema.

**D4. Precio dicho por el cliente — no confirmar ni repetir**
- `la otra vez pagué como $500 por esto, sigue ese precio?`
- **Esperado:** no confirma, no niega, no repite el monto del cliente. O da SU precio de
  lista (de la BD) o deriva. El backstop regex descarta cualquier reply del LLM con action
  precio que traiga `$`+dígitos propios.

**D5. Precio $0 en el catálogo — el bug cazado**
- `cuánto sale el papel vegetal a4 x10?`
- **Esperado:** SIN número (jamás "$0,00"), redirect a email.
- **BD:** notas `... | fallback: precio_cero`.

**D6. Override — nunca número**
- Pedir el precio del/los producto(s) que devolvió el sanity SQL de override (prerreq. 1).
- **Esperado:** SIN número, redirect. **BD:** `fallback: override` (si el LLM emitió
  action precio) o answer a email directo (también válido: en catálogo va sin `*`).

## E. Conversación completa / regresión

**E1. Precio → algo más → cierre (costura con la regla del email)**
- `cuánto sale la cartelería pvc en 35x50?`
- (respuesta con `$20.000,00`)
- `no, nada más, gracias`
- **Esperado:** cierre cálido derivando al email. OJO primera mención: si el email nunca
  apareció antes en la conversación, el cierre lleva la dirección COMPLETA
  (terminalgrafica@gmail.com), no "nuestro mail".

**E2. Repetir el precio a pedido — anti-repetición no lo come**
- (seguido de E1, o tras cualquier precio) `perdón no me llegó, me repetís el precio?`
- **Esperado:** lo repite (1 vez). El backstop anti-repetición recién silencia al 3er
  envío idéntico.

**E3. Dos precios en un mensaje — de a uno**
- `pasame el precio de la cartelería pvc a3 y del plano autocad a4`
- (respuesta con uno + ofrecimiento)
- `dale, pasame el otro`
- **Esperado:** primer mensaje → UN número + "¿te paso también el de...?"; el "dale" →
  el segundo número. Nunca los dos montos en una sola respuesta.

**E4. Producto sin ninguna opción con precio — derivar sin entrevista (fix 2c)**
- Elegir un producto cuyo TODO esté bloqueado (los override de D6 sirven).
- `hola, cuánto salen los <producto override>?`
- **Esperado:** deriva a email apenas identifica el producto. NO arranca un funnel de
  tamaño/material/terminación "para el precio" que termine en email igual.

**E5. Regresión general**
- Re-correr [`suite-2-cobertura-nueva.md`](./suite-2-cobertura-nueva.md) completa
  (costura 4/5 "mate", cierres, fuera de rubro, ¿algo más?). El prompt cambió v9→v10.1:
  vigilar que las preguntas de desambiguación de producto SIGAN apareciendo (que el fix
  2c no las haya suprimido) y que nada de suite-2 se haya roto.

---

## Verificación en BD (después de la ronda)

```sql
-- Toda la telemetría de precios de la ronda
select created_at, mensaje_cliente, filas_sql, notas
from bot.decisiones
where accion = 'informo_precio'
order by created_at desc;
```
- `notas` termina en el estado: `ok` / `ok_caveat` / `ok_rangos` / `fallback: <motivo>`.
- `filas_sql=0` = el LLM no resolvió el nombre canónico → candidato a sinónimo
  (`bot.producto_meta`) o a limpieza de nombre.
- `filas_sql=2+` = variantes duplicadas → lista de limpieza (C3).
- Comparar CADA número mostrado contra `select precio_lista from bot.variantes ...`:
  la desviación tolerada es CERO (el número viene de la BD por diseño; si difiere,
  algo está muy roto).

## Ronda 2 — re-test post-fixes v10.3/v10.4 (2026-07-21)

> La ronda 1 se corrió y sus hallazgos generaron el paquete v10.3/v10.4 (commits
> `7d21ad0` + `d27ff48`). Antes de esta ronda: aplicar `db/decisiones-execution-id.sql`,
> re-importar el workflow, **abrir y guardar los 3 nodos Log** (refrescan el schema
> para la columna nueva) y togglear el workflow (cache). Lo que pasó en ronda 1
> (E1, E2, D1, D2, D3, C3, override) no hace falta repetirlo.

**R1. Libro (el caso grave) — replay completo:**
- `Buenas quiero imprimir un libro que tengo en PDF`
- `Dale, pero antes me podes decir cuanto me saldria?`
- `Que opciones hay?`
- `obra de 75 y A4`
- `Ok, pero me podes decir cuanto me costaria?`
- **Esperado:** derivación a email SIN entrevista de specs, dirección ESCRITA a la
  primera (nunca "¿te paso el correo?"), cero productos de laser color ofrecidos como
  "opciones del libro", y los datos que diste ("obra de 75 y A4") nombrados al derivar,
  jamás re-preguntados. La última pregunta de precio → misma derivación, no otra ronda.

**R2. Clase "." muerta — C1 × 3 corridas:** `qué sale la impresión a3 en tonner negro?`
tres veces (conversaciones nuevas). **Esperado:** tabla las 3 veces (ya no depende de
qué variante emita el LLM: el catálogo publica "única" y el fallback mono-variante
absorbe cualquier string). Encabezado SIN ". de" y SIN "por a3".

**R3. B2 de nuevo:** `hacen plastificados? cuánto sale el a4?` → `$2.200,00` + caveat,
sin "opción .".

**R4. Resolución parcial:** conversación sobre autocad, después `y el plano?` →
**Esperado:** `$200,00` (match parcial rank 2; en `notas` aparece "(match parcial)").

**R5. Guardas de resolución:** `cuánto sale el vegetal?` → producto Vegetal (exacto le
gana al contains). `cuánto sale el sobre inglés?` → ambiguo → email (duplicado real).

**R6. Multi-precio (E3 de nuevo):** `pasame el precio de la cartelería pvc a3 y del plano autocad a4`
→ **Esperado:** AMBOS montos en el mismo mensaje. Variante mixta:
`precio de la cartelería pvc a3 y de la impresión a3 tonner negro` → monto del primero
+ "El de ... va por cantidad; si querés te paso la tabla."

**R7. Primera mención (backstop determinístico):** dos derivaciones seguidas → la
segunda dice "nuestro mail" SIEMPRE (ya no depende del LLM). Luego `¿cuál era el correo?`
→ dirección completa (el guard "me repetís el mail" la deja pasar).
Anti-Frankenstein (hallazgo R1: "a nuestro email nuestro mail"): si el LLM escribe la
dirección con lead-in ("a nuestro email X", "a nuestra dirección de correo X"), la
cascada colapsa TODO a "a nuestro mail" — nunca frase duplicada.

**R8. D4 de nuevo:** `la otra vez pagué como $500 por esto, sigue ese precio?` →
**Esperado:** responde (nunca noop), sin confirmar ni repetir el 500.

**R9. execution_id:** tras cualquier caso, `select accion, execution_id from
bot.decisiones order by created_at desc limit 3;` → con valor, y el ID abre la
ejecución en n8n.

**R10. Eco del producto como variante (hallazgo ronda 2, misma conversación):**
- `hacen plastificados? cuánto sale el a4?` (B2)
- `qué sale la impresión a3 en tonner negro?` (C1)
- `necesito 200 impresiones a3 en tonner negro, cuánto me sale?`
- **Esperado:** el tercer mensaje devuelve la tabla con encabezado
  `Impresiones a3 tonner negro, precio de lista según cantidad:` — el nombre UNA sola
  vez (antes: "X de X" porque el render caía al eco del LLM cuando la variante real
  es la clase "."; ahora `vv` sale SOLO de la DB). Y sin cálculo para 200: la tabla
  verbatim es la respuesta (C2 sigue igual).

**R11. Rubro como producto (hallazgo ronda 2 — OPP):**
- `Cuanto sale un opp?` → lista las dos líneas OPP
- `Holografico`
- **Esperado — dos caminos válidos** (invariante: derivación a email, sin número, y
  NUNCA "Soportes Especiales" como nombre — eso es el rubro, no un producto):
  - **Camino A (el ideal — verificado 2026-07-21 post-fix):** el LLM rutea 2c directo
    (los OPP no tienen `*` porque el override los excluye) → answer con derivación a
    email. NO pasa por Get Precio, y eso es correcto: `action precio` es solo para
    opciones con `*`. En `bot.decisiones` queda `informo_capacidad` (Log Respuesta).
  - **Camino B (la red determinística):** el LLM igual emite `action precio` con el
    rubro como producto → rank 3 resuelve el producto real → escalera → email con
    `fallback: override (resuelto por variante)` en notas — la razón verdadera
    (antes: `sin_match` + el rubro en la respuesta).
  Si un día se les quita el override a los OPP, aparece el `*` y esta secuencia debe
  dar el número ($2.400/$2.500). Nit observado en camino A (no bloqueante): la primera
  respuesta preguntó cantidad "para el precio" antes de derivar — 2c pide derivar sin
  entrevista; como derivó en el mismo mensaje, no rompe nada. Vigilar si se repite.

## Qué anotar (→ memoria)
- Misses de resolución (B2, y cualquier `filas_sql=0`): ¿qué nombre emitió el LLM vs el canónico?
- ¿El LLM eligió bien entre action `precio` y 2c en los bordes (D1, D2)?
- ¿Apareció algún monto NO proveniente del sistema en cualquier respuesta? (gravedad máxima)
- UX de la tabla (C1): ¿legible en WhatsApp? ¿TG preferiría "desde $X"? (input para la pregunta a TG)
- Latencia de la rama precio (agrega 1 query + 1 code node: debería ser marginal).
