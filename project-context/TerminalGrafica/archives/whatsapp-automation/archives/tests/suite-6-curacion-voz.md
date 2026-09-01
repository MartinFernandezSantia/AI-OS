# Suite 6 — Curación 2026-07-24b + regla de voz (ronda puntual)

> Valida SOLO lo que se cambió el 2026-07-24, aparte de la suite 5.
> Correr en **WhatsApp real** contra el catálogo de testing.
> Cada renglón = un mensaje; conversación nueva entre casos (o resolver en Chatwoot).
>
> **Prerrequisitos:**
> - Sección A (curación): `db/curacion-2026-07-24b.sql` aplicado + `GET /webhook/refrescar-catalogo`. ✅ Martin ya aplicó.
> - Sección B (voz): además, **`faq-bot-v7.json` re-importado** (la regla de voz es un
>   cambio de prompt; si NO re-importaste, saltear la sección B).
>
> Montos de referencia (verificar contra la BD): Vegetal a4 $1.000 / oficio-a3 $2.000 ·
> Anillado plástico a4/oficio $2.400 · plástico a3 $3.200 · metálico desde $3.200 ·
> Promo inmobiliarias $15.000 por cartel.

---

## A. Curación (aplicada)

**1. Papel vegetal a4 (desambiguación del $0 oculto):**
- `hola, cuánto sale el papel vegetal a4?`
- **Esperado:** un número limpio, **$1.000** (producto "Vegetal"), con el caveat neutro.
  NO un ítem a $0, NO "tenemos estas opciones" ambiguo entre dos vegetales, NO deriva a
  email. (Antes de ocultar los x10 $0, esto quedaba ambiguo.)
- **BD:** resuelve a un solo producto (Vegetal), número.

**2. Papel vegetal a3 / oficio (el hermano):**
- `cuánto sale el papel vegetal a3?`
- **Esperado:** resuelve al mismo "Vegetal" vivo → **$2.000** (variante oficio/a3), o te
  muestra las dos opciones (a4 $1.000 / oficio-a3 $2.000). Nunca el $0 ni ambiguo ni email.

**3. Anillado "urgente" (sin prometer tiempo):**
- `cuánto sale un anillado urgente?`
- **Esperado:** lo trata como anillado común: te muestra las opciones (plástico a4/oficio
  $2.400, plástico a3 $3.200, metálico) **SIN mencionar plazos ni "24 hs"** y sin forzar
  una sola. Que aparezcan 3 opciones (en vez de "plástico vs metálico") NO es fallo — el
  colapso a3/a4 está pendiente. Si el bot pasa "anillado urgente" literal y cae a
  sin_match / repregunta, **anotalo** (es el borde que dejamos marcado).

**4. Espiralado (que la poda no rompió el funnel):**
- `hacen espiralado?`
- **Esperado:** sí, resuelve a los anillados plásticos (muestra opciones o pregunta cuál).
  NO sin_match, NO email. Confirma que sacar los sinónimos de urgencia no se llevó puesto
  "espiralar/espiralado", que se conservan.

**5. Promo inmobiliarias (por cartel, no por 6):**
- `cuánto sale la promo de carteles para inmobiliarias?`
- **Esperado:** **$15.000 por cartel**, con la aclaración de que es llevando 6 (el display
  dice "cartel de 1 × 0,65 m, llevando 6"). NO "$15.000 por los 6".
- **BD:** resuelve a la promo, número $15.000.

## B. Regla de voz — SOLO si re-importaste el workflow

**6. Nombre que no mapea (no filtrar "el catálogo"):**
- `cuánto sale imprimir en bookcel de color?`
- **Esperado:** como "bookcel" no existe, pregunta o deriva — pero la respuesta **NO debe
  decir** "el catálogo", "la lista de precios", "el sistema" ni "la variante", ni tirar un
  nombre interno de SKU (tipo "Impresiones a3 Negro Tonner"). Tiene que sonar a persona
  del mostrador. (Este es el frase exacta del incidente 15.)

**7. Consulta normal (framing humano):**
- `qué opciones de tarjetas personales tienen?`
- **Esperado:** lista las opciones con lenguaje humano ("tenemos estas..."), **sin** "según
  el catálogo" / "la lista tiene" / "la variante". Nombra los productos como los diría un
  cliente, no como están cargados.

---

## Nota — dos cosas que NO son fallo de estos cambios

- El **"lo confirma el equipo" sin mail** (incidente 15) no lo arregla esta regla de voz;
  quedó para el refinador. Si sigue apareciendo, es esperado.
- El **caso 3** cayendo a sin_match con "anillado urgente" literal es diseño, no bug (el
  LLM debería pasar "anillado", no "anillado urgente").
