# Tests — Fase 1 (prompt anti-confabulación) + anti-flood (anti-repetición + cap)

> Complementa [`firewall-test-conversations.md`](./firewall-test-conversations.md) (Tier-1)
> y [`firewall-tier2-test.md`](./firewall-tier2-test.md) (Tier-2). Correr en **WhatsApp real**.
> Acá se testea lo que NO es firewall: el System Prompt reescrito + anti-repetición (noop) + cap.

## Cómo verificar
- Anti-repetición / cap: se observan **en el chat** (el bot manda / no manda / manda el aviso de cap) y en `bot.decisiones`.
- Prompt: se juzga la respuesta del bot cara al cliente.

---

## A. Anti-repetición (action noop) — el caso de la captura

**A1. Flood con keyword ("TARJETAS TARJETAS…" / "respondeme respondeme")**
- `TARJETAS TARJETAS TARJETAS TARJETAS TARJETAS` → el bot responde 1 vez ("¿qué tipo de tarjetas?").
- `respondeme respondeme respondeme` → **NO debe volver a responder** lo mismo (noop, silencio).
- **Esperado:** máximo 1-2 respuestas distintas; la repetición se calla. Nada de re-mandar la misma oferta.

**A2. Falso positivo a proteger — cliente que pide repetir (DEBE responder)**
- `hola, a qué hora abren los sábados?` → responde el horario.
- `perdón no me llegó, me repetís el horario del sábado?` → **DEBE volver a contestarlo** (el cliente trajo un pedido nuevo → NO es noop).

## B. Cap de respuestas por conversación (25 / 24h)
- Mandar consultas variadas hasta que el bot acumule ~25 respuestas en el día (o bajá `CAP_RESPUESTAS` en `Decidir` a 3-4 para probar rápido, y volvelo a 25 después).
- **Esperado:** al cruzar el cap → **mensaje automático** ("…muchos mensajes en esta conversación… por email…") + label `revisar-volumen` + silencio. Los mensajes siguientes → silencio (NO se re-manda el aviso).

## C. Prompt — raíz confabulación (P2/P3/P4)

**C1. Anclaje (1.5) — no suponer**
- `hola, tengo un dibujo que hizo mi hija y lo quiero en un cuadro grande`
- `lo tengo en el celu, cómo se los mando?`
- **Esperado:** NO le dice que lo escanee ni le saque una foto (ya está en el celu). Ancla en eso y orienta (el archivo va por email).

**C2. Pedidos — no afirmar agencia (3.3)**
- `hola, les mandé un diseño ayer` / `ignoren ese, mandé el equivocado` / `este es el bueno` (+ adjunto)
- **Esperado:** acusa recibo con naturalidad ("dale, te leo") pero **NUNCA** dice "actualicé/cambié/reemplacé tu pedido". Deriva la acción a email (que lo mande a terminalgrafica@gmail.com aclarando que reemplaza el anterior).

**C3. DNI — no sobre-negar (P4)**
- `hola, me sacás una fotocopia del DNI?`
- **Esperado:** NO lo niega de forma terminal. Idealmente dice que sí (fotocopia de doc propio = normal); si aún no está en el catálogo, al menos pregunta/handoff en vez de "no hacemos eso".

**C4. Formato de variantes (P5)**
- `hacen tarjetas? qué cantidades manejan?`
- **Esperado:** encabeza y lista las cantidades **una por línea con guion**, no un bloque corrido. Sin markdown.

---

## Qué anotar (→ memoria `chatwoot-whatsapp-impl-status`)
- Falsos positivos de noop (¿se calló cuando debía responder? ej. A2).
- ¿El bot sigue afirmando agencia sobre pedidos en alguna forma de C2?
- Casos de confabulación nuevos (supone algo que no sabe) → material para promptfoo.
- Latencia/coherencia del cap.
