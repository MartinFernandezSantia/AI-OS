# Suite 4 — lenguaje de mostrador (catálogo limpio v10.8)

> Casos escritos en PALABRAS DE CLIENTE REAL, no en nombres de catálogo — los gaps
> de sinónimos eran invisibles a las suites 1-3 porque esas hablan en nombres.
> Diseñada junto al overlay `producto_meta` (plans/catalogo-limpio-producto-meta.md,
> contraste Fable rondas 2-4).
>
> **Prerrequisitos:** `db/catalogo-limpio-overlay.sql` aplicada (asserts OK, 8 filas
> en variante_meta) · `faq-bot-v6.json` v10.8 re-importado · workflow TOGGLEADO
> (cache de catálogo) · cada caso en conversación NUEVA salvo que se indique.
> **Regresión pareja:** re-correr suite-3 R2, R10, R11, R15 — y R5 debe SEGUIR dando
> ambiguo → email para "sobre inglés" (el dup sigue gated por TG).

## A. Zona sucia IMPRESIONES (el corazón universitario)

**1. Apuntes A4 b/n (matriz #2, la consulta #1):** `¿cuánto sale imprimir apuntes en A4 blanco y negro?`
- Esperado HOY (gate TG del a4 abierto): identifica las líneas de impresiones por el
  caso de uso "para imprimir apuntes" del 75 gr; como el cliente dijo A4 y solo el
  106 lista a4, es válido que pregunte o rutee al 106 — lo INVÁLIDO es email directo
  teniendo tabla, o inventar que el 75 es A4.
- Post-respuesta TG (si 75 = a4): pregunta 75 vs 106 (o la que TG defina como
  default) → faz → cantidad → bracket.
- Anotar cuál de los dos caminos dio: es el insumo del gate.

**2. Exámenes (matriz #25):** `quiero imprimir 40 exámenes doble faz`
- Esperado: pregunta UNA vez b/n o color (los usos del 75 gr rutean; sin la
  migración esto era ambiguo→email) → con "b/n": bracket exacto
  **$96,00 c/u** (tabla 150/96/88/86/84; 40 cae en 11-50), cantidad en la frase.

**3. CV (matriz #3):** `¿me imprimís 10 CV?`
- Esperado: repregunta entre las dos líneas con el caso de uso cv (Impresiones papel
  obra 75 gr / OBRA 80 GR laser). NUNCA precio directo sin definir producto; nunca
  handoff.

**4. CASO TESTIGO del dedupe:** `¿cuánto están las impresiones doble faz color?`
- Esperado: repregunta entre los dos "papel obra" (75/106) — o si el LLM emite
  `producto: "impresiones"`, el SQL da ambiguo → email honesto. **PROHIBIDO** un
  precio directo confiado: sería el hijack que la poda + el display plural matan.
  (Sin la enmienda plural del 106 este caso FALLA — es el testigo de la ronda 2.)

**5. Clase pelada:** `papel obra` (como consulta de precio)
- Esperado: repregunta (2b) o ambiguo→email. Nunca resolución silenciosa a UN
  producto (antes caía dudosamente al 106).

**18. Funnel post-poda:** `¿hacen impresiones?`
- Esperado: answer con las líneas de impresión y repregunta. NO email seco, NO
  handoff: la poda no debe matar el funnel — la conversión queda en la capa LLM.

## B. Sinónimos de mostrador nuevos

**6a. Espiralado directo (gemelo R14):** `tengo la tesis ya impresa, ¿me la espiralás? ¿cuánto?`
- Esperado: UNA pregunta (plazo 24/48/72/96 hs) → número limpio o caveat ($ del
  anillado; son `*`, no `**`). El ancla de trabajo compuesto NO debe dispararse.

**6b. Espiralado compuesto:** `quiero imprimir y espiralar mi tesis`
- Esperado: ancla 2c — email + (opcional) oferta de costo por página. Sin entrevista.

**17. Espiralado pelado:** `¿hacen espiralado?` → `¿cuánto sale?`
- Esperado: pregunta el plazo entre las 5 líneas de anillado plástico (multi-match
  rank 1 no rompe nada: el LLM desambigua, después número).

**7. Enmicado:** `¿me enmicás una hoja A4?`
- Esperado: Plastificado A4 → **$2.200,00** + caveat (solo_descuentos).

**19. Enmicado carnet (exclusión correcta):** `¿me enmicás un carnet?`
- Esperado: Carnet 9x13 cm vía su nombre/sinónimo propio → número + caveat. Excluir
  a Carnet del sinónimo 'enmicado' no deja agujero.

**8. Stickers:** `quiero stickers troquelados`
- Esperado: Papel Autoadhesivo Brillo / Split (matriz #12). El detalle troquelado →
  como siempre (spec al pasar → email para el detalle).

**9a. Imanes:** `¿tenés imanes para heladera? ¿cuánto salen?`
- Esperado: producto Imanes, pregunta cuántos (`**`) → tabla (8000/7200/6500) o
  bracket si dio cantidad. [9b si TG responde que NO se venden al público: producto
  `oculto` → regla 4 handoff.]

**11. Mapeo byn→b/n (post-identificación, misma conversación que un caso A):**
`la simple faz en blanco y negro, ¿qué sale?`
- Esperado: variante "simple faz b/n" resuelta (el LLM mapea del catálogo) →
  cantidad-first → tabla/bracket.

## C. Podas Tier A (el catálogo deja de desinformar)

**20. Perforado:** `¿me hacés perforado en estas hojas?`
- Esperado: NUNCA Microperforado (el film de vidriera). Perforaciones (Taller) o
  derivación honesta.

**21. Tacos:** `¿cuánto salen los tacos?`
- Esperado: 2b entre los tamaños/colores (6 líneas). NO precio directo del 10x7
  negro (el viejo sinónimo 'tacos' rank-1eaba ahí).

**22. Volantes (valida la duplicación deliberada):** `quiero volantes, ¿qué precio tienen?`
- Esperado: 2b entre los 3 folletos (ilustración / obra b/n / obra color). NO
  handoff (la poda seca hubiera fabricado regla 4), NO precio directo de uno.

**23. Troquelado:** `¿hacen troquelado de etiquetas?`
- Esperado: sin cotización confiada del autoadhesivo; Trazado/Troquelado de Taller
  o flujo normal de identificación. (El sinónimo 'troquelado' del autoadhesivo era
  coin-flip.)

## D. Reagrupado + red anti-header

**15. Header-echo (test de regresión de la red):** conversación donde el bot ofrece
las impresiones a3 y el cliente elige: `dale, los de a3 negro`
- Esperado: aunque el LLM emita el encabezado del rubro ("Impresiones a3 Negro
  Tonner") como producto, el sinónimo anti-header resuelve → tabla/bracket del
  producto. En notas NO debe aparecer `sin_match`.

**16. Módulos sin decir medicina:** `¿me imprimís unos módulos?`
- Esperado: pregunta si son de medicina (el nombre del producto sigue conteniendo
  "Módulos") o identifica producto — NUNCA el precio especial de medicina directo
  para un cliente que no dijo medicina (la poda de 'apuntes'/'modulos' pelados).

## E. Controles negativos (TG-gated: deben SEGUIR igual)

**10. Fotocopias:** `¿hacen fotocopias?` → handoff regla 4 (gap hasta foto de lista TG).
**12. Pasacalle:** `¿me hacen un pasacalle?` → handoff regla 4 (hasta respuesta TG).
**13a. Sobre inglés:** `¿cuánto sale el sobre inglés?` → ambiguo → email (dup real
grandfathered; espejo del golden R5). [13b post-resolución TG: `oculto` de uno →
flujo normal.]
**14. Medidas grandes (gemelo R16 en lenguaje mostrador):** `¿imprimen láminas A1?`
→ por hoja: regla 4; cartelería/lona: "se calcula por m²" + precio del m² si lo pide,
sin convertir medidas ni confirmar factibilidad.

## Qué anotar

- Caso 1: qué camino dio (insumo del gate a4).
- `bot.decisiones`: los casos A deben loguear `informo_precio` con estado ok/ok_caveat/
  ok_rangos/ok_bracket — vigilar que `fallback: ambiguo` DESAPARECE de las consultas
  de impresiones con producto+variante definidos (era la firma de la zona sucia).
- NOTICEs de la migración (podas + HAZARD LEGACY): pegarlos en el plan como input
  del próximo tier.
