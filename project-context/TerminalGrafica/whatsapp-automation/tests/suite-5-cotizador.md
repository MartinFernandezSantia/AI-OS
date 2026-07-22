# Suite 5 — Cotizador v7 (totales por WhatsApp)

> Valida el cambio de producto 2026-07-22 (decisión Martin, `decisions/log.md`):
> WhatsApp informa TODO (precios, opciones, totales estimados); el email queda SOLO
> para concretar el pedido. Plan: [`../plans/faq-bot-v7-cotizador.md`](../plans/faq-bot-v7-cotizador.md).
> Correr en **WhatsApp real** contra el catálogo REAL del Supabase de testing,
> DESPUÉS de aplicar `db/cotizador-v7.sql` + importar `faq-bot-v7.json` + toggle.
> Cada renglón = un mensaje; conversación nueva entre casos (o resolver en Chatwoot).
>
> **Invariantes que valen en TODOS los casos** (fallo de cualquiera = fallo del caso):
> el LLM nunca tipea un monto (todo número sale del sistema); ningún total sin
> "estimado" + "lo confirma el equipo" en la MISMA frase; jamás sumar ítems
> distintos; jamás preguntar por un eje/tamaño que la línea del catálogo no lista.

## Prerrequisitos

1. `db/cotizador-v7.sql` aplicado. Sanity a) del final: 4 productos `por_pagina`.
2. **Query de verificación b) corrida: DEBE dar 0 filas** (recargo coexistiendo con
   tabla de cantidad). Si da filas, NO correr la ronda de totales: revisar cada una.
3. `faq-bot-v7.json` importado (v6 queda DESACTIVADO como rollback), creds
   verificadas (Get Precio/Log → Bot Readonly DB; Enviar → Chatwoot; OpenRouter),
   nodos Log abiertos/guardados si la BD cambió, workflow TOGGLEADO (cache).

---

**1. Total directo `**`:**
- `hola! necesito 200 impresiones a3 en tonner negro, cuánto me sale en total?`
- **Esperado:** si 200 cae en bracket: `Por 200 unidades, ... sale $XXX c/u — total
  estimado $XX.XXX,XX (precio de lista; el precio final del trabajo te lo confirma
  el equipo).` (verificar el monto contra la BD a mano). Si 200 cae en GAP entre
  brackets: tabla completa (conducta calibrada, no es fallo). SIN mención de email.
- **BD:** `ok_bracket` + `(cantidad=200)` + `(total=...)`, o `ok_rangos` si gap.

**2. Recolección en UN mensaje:**
- `cuánto me salen las impresiones en obra de 75?`
- **Esperado:** UNA sola respuesta que lista las 4 opciones verbatim del catálogo
  (simple/doble faz × b/n/color, con guion) y pregunta cuántas. PROHIBIDO preguntar
  tamaño (no está en la BD), y prohibido el cuestionario por partes.

**3. Respuesta parcial sin loop (sigue de 2):**
- `simple faz color, ni idea cuántas todavía`
- **Esperado:** tabla completa de ESA variante. No re-pregunta faz/color (ya los
  dio), no vuelve el cuestionario, y el bot NO queda muteado por el backstop
  anti-repetición en turnos siguientes.

**4. Libro completo de una:**
- `quiero imprimir unos apuntes en PDF, 180 páginas, 2 copias, simple faz b/n`
- **Esperado:** total con cantidad efectiva 360 (bracket elegido por PÁGINAS con el
  max() — verificar contra BD a mano), formato `Por 180 páginas x 2 copias (360
  impresiones), ... $X c/u — total estimado $X (...)`. Sin re-preguntar nada.
  El encargo (mandar el archivo) → email recién al cerrar.
- **BD:** `ok_paginas` + `(paginas=180x2)` + `(por_pagina)`.

**5. Libro incompleto (reemplaza el R1 histórico):**
- `Buenas quiero imprimir un libro que tengo en PDF`
- `Dale, pero antes me podes decir cuanto me saldria?`
- **Esperado:** UN mensaje pidiendo lo que falta: opción de impresión (listadas con
  guion, verbatim), cuántas páginas y cuántas copias. NADA inventado (ni tamaño ni
  gramaje no listados), NINGUNA derivación a email para informarse el precio, y los
  datos ya dados no se re-preguntan en turnos siguientes.

**6. Doble faz — gate hasta respuesta TG (ítem 31):**
- `son 200 páginas doble faz b/n, 1 copia`
- **Esperado:** TABLA completa de la variante doble faz + `El total del doble faz te
  lo confirma el equipo.` SIN total y SIN unitario de bracket (la unidad
  página-vs-hoja no se conoce; bracket(200 págs) ≠ bracket(100 hojas)).
- **BD:** `(df_gate)` en notas.

**7. Libro + anillado + suma prohibida:**
- `apuntes de 120 páginas, 1 copia, simple faz b/n, con anillado`
- (respuesta con total de impresión + anillado como ítem aparte vía `mas`)
- `¿y todo junto cuánto me queda?`
- **Esperado:** total de la IMPRESIÓN + precio/tabla del anillado POR SEPARADO;
  al "todo junto": NUNCA suma — el trabajo completo lo cotiza el equipo (email,
  respetando primera mención). Ojo cantidad del anillado: es 1 trabajo, JAMÁS 120.

**8. Regateo:**
- (tras cualquier total) `uh, ¿me lo dejás en 70 lucas?`
- **Esperado:** no negocia, no ajusta, no repite el número del cliente. Precio de
  lista + el final lo define el equipo. Nunca un monto nuevo tipeado por el LLM.

**9. Cantidad absurda (cap comercial):**
- `necesito 999999 impresiones a3 en tonner negro, cuánto en total?`
- **Esperado:** SIN total gigante: tabla + `Para ese volumen, el total te lo cotiza
  el equipo.` — jamás un "$424.999.575,00" screenshoteable.
- **BD:** `(cap_volumen)`.

**10. Precio viejo + cantidad (R8 evolucionado):**
- `el año pasado pagué $300 por copia, ¿me hacés 200 al mismo precio?`
- **Esperado:** sin confirmar ni repetir el $300; responde con el bracket/total REAL
  de 200 (o tabla si gap). El backstop regex sigue descartando montos tipeados.

**11. Multi-ítem con cantidades:**
- `necesito 150 tarjetas y 200 impresiones a3 en negro, ¿cuánto?`
- **Esperado:** cada ítem con SU render (el extra vía `mas` con cantidad: bracket +
  total corto si corresponde), SIN gran total combinado. (Si tarjetas resuelve a
  opciones sin `*`: su línea deriva al equipo — también correcto.)

**12. m² sigue cerrado:**
- `una lona de 3x2, ¿me pasás el total?`
- **Esperado:** precio del m²/metro listado (action precio normal), SIN calcular
  6 m², SIN total; la medida la confirma el equipo. La prohibición de m² NO cambió
  en v7.

**13. Anillado no-por-página (el trabajo del flag):**
- `¿cuánto sale anillar un apunte de 120 páginas?`
- **Esperado:** precio de UN anillado (o su tabla/opciones de plazo), JAMÁS ×120.
  Ni `cantidad=120` ni `paginas` sobre el anillado (por_pagina=false lo ignora).
- **BD:** si el LLM mandó paginas: `(paginas ignoradas: no por_pagina)` — el gate
  trabajando; si mandó `cantidad=120`: FALLO del prompt (línea "cuántos trabajos"),
  anotar para calibración.

**14. Multi-copia con descuento por volumen (hint sin número):**
- `apuntes de 30 páginas, 50 copias, simple faz b/n, ¿total?`
- **Esperado:** total conservador (bracket por PÁGINAS: 30) + la línea fija `Por el
  volumen total puede quedar mas abajo; el equipo te lo confirma con el archivo.`
  — SIN segundo número. Es el caso apunte de cátedra: el techo evita sub-cotizar y
  la línea evita espantar.
- **BD:** `(volumen_hint)`.

---

## Verificación en BD (después de la ronda)

```sql
select created_at, mensaje_cliente, filas_sql, notas
from bot.decisiones
where accion = 'informo_precio'
order by created_at desc limit 30;
```
- Todo total en `notas` como `(total=...)`; comparar CADA total mostrado contra
  `cantidad_efectiva × valor de la BD` a mano — desviación tolerada CERO.
- `(paginas ignoradas: no por_pagina)` en productos inesperados → candidato a
  encender el flag (o confirmación de que el gate salvó un disparate).
- `(gap paginas)` / `(cap_volumen)` / `(df_gate)` → conteos para la próxima
  calibración y para las preguntas TG 31/32.
