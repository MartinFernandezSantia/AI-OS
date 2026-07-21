# Matriz de situaciones — gráfica universitaria vs workflow (2026-07-21)

Pedido de Martin: lista extensa de situaciones y pedidos comunes a una gráfica cerca de
una universidad (estudiantes, profesores, diseñadores, gente común) y cómo se comporta
el workflow ante cada una. Objetivo: **el bot informa lo más posible**; deriva al mail
cuando la persona ya no necesita más info o cuando no puede contestar con certeza —
no en situaciones comunes como el costo de imprimir un libro.

Método: catálogo ANOTADO real reconstruido del seed (185 variantes públicas: 77 LIMPIO\* /
79 CAVEAT\* / 25 TABLA\* / 2 OVERRIDE→email / 2 PRECIO_0→email) cruzado contra el árbol
v10.5, co-armado con el agente Fable (contraste adversarial).

**Leyenda veredictos:** A = informa bien · B = deriva pudiendo informar (la clase a
matar) · C = derivación correcta · D = gap de catálogo (handoff regla 4).
Fix: [datos] = producto_meta/BD · [prompt] · [TG] = pregunta a TG · [ya] = en curso.

| # | Pedido (persona) | Ruteo hoy | Qué recibe | V | Fix |
|---|---|---|---|---|---|
| 1 | "Imprimir mi tesis y anillarla, ¿cuánto?" (est.) | Ancla compuesto → email + oferta por página | Email; anillado (LIMPIO) silenciado, página muere en #2 | **B** | v10.6 + [datos] dedupe |
| 2 | "¿Cuánto imprimir apuntes A4 b/n?" (est.) | 2b→2a → IMPRESIONES duplicadas → ambiguo | Email (la tabla existe, no llega) | **B** | [datos] dedupe — LA prioridad |
| 3 | "Imprimir 10 CV" (común) | Mapeo incierto: 2b→zona sucia o laser | Inconsistente | **B** | [datos] sinónimo CV + dedupe |
| 4 | "Lámina A1 de arquitectura" (est. arq.) | A1 no listado → regla 4/5 | Handoff o email | **C/D** | [TG] ¿ploteo hace A1? → medidas |
| 5 | "Plano autocad A3" (est. arq.) | 2a LIMPIO | Número limpio | **A** | — |
| 6 | "20 fotos en ilustración" (común) | 2b → laser CAVEAT | Número + caveat | **A** | [datos] sinónimo "fotos" |
| 7 | "500 tarjetas doble faz" (diseñador) | 2a LIMPIO (500/1000) o CAVEAT (100) | Número | **A** | — |
| 8 | "1000 flyers 10x15" (evento) | 2a Folletos x1000 CAVEAT | Número + caveat | **A** | — |
| 9 | "Talonarios de rifas" (centro est.) | 2a → TABLA | Tabla verbatim | **A** | — |
| 10 | "Plastificar mi credencial" (común) | 2a carnet CAVEAT | Número + caveat | **A** | — |
| 11 | "Lona 2x1 con ojales para stand" (común) | Lona CAVEAT; "ojales" (LIMPIO en Taller) tratado como spec → silenciado | Un número o ninguno | **B** | v10.6 |
| 12 | "Stickers troquelados" (diseñador) | Si mapea: autoadhesivo LIMPIO/TABLA; si no: regla 4 | Número o handoff | **A/D** | [datos] sinónimo stickers |
| 13 | "¿Hacen imanes?" (común) | Regla 4 | Handoff | **D** | [TG] ¿los hacen? (Iman TABLA existe — mapeo) |
| 14 | "Tengo la tesis impresa, ¿encuadernan?" (est.) | Debería ser 2a → TABLA directo | Tabla — SI el ancla compuesto no sobre-dispara | **A**⚠ | golden R14 anti-sobre-disparo |
| 15 | "Refilar 200 hojas" (común) | 2a → TABLA | Tabla | **A** | — |
| 16 | "¿Cuánto la fotocopia?" (todos, consulta #1) | Regla 4 | Handoff cada vez | **D** | [ya] foto lista TG |
| 17 | "¿Hacen sellos?" (común) | Regla 4 | Handoff | **D** | [TG] |
| 18 | "¿Me escanean estos apuntes?" (est.) | Regla 4 | Handoff | **D** | [TG] — casi seguro escanean |
| 19 | "Te mando el archivo por mail / traigo USB" | Mail: 2c ✓; USB: no documentado → regla 4 | Mail bien; USB handoff | **A / C** | [TG] ¿USB? → Info del negocio |
| 20 | "Papel vegetal x10" (técnico) | PRECIO_0 → email | Email (dato roto en BD) | **B** | [datos] precio real → [TG] |
| 21 | "¿Tienen papel perlado?" (diseñador) | Regla 4 | Handoff, ni sí ni no | **C** | — |
| 22 | "¿Para cuándo estaría? Es para mañana" (consulta #2) | Plazo no documentado → regla 4 | Handoff SIEMPRE (salvo anillados: plazo es variante) | **C caro** | [TG] plazos por rubro → Info del negocio |
| 23 | "¿Aceptan Mercado Pago? ¿Seña?" (todos) | No documentado → regla 4 | Handoff | **C caro** | [TG] medios de pago |
| 24 | "¿Me hacés precio por 500?" sobre un LIMPIO | 2a número; descuento → "lo ve el equipo" | Número + derivación honesta | **A/C** | — |
| 25 | "40 exámenes doble faz" (profesor) | OBRA 75 D/F duplicada → ambiguo (dorso NO bloquea: D/F es variante listada ✓) | Email | **B** | [datos] dedupe |
| 26 | "¿Imprimen con prueba de color?" (diseñador) | Regla 4 | Handoff | **C** | — |
| 27 | "¿Hacen envíos?" (común) | Regla 4 | Handoff | **C caro** | [TG] → Info del negocio |
| 28 | "Un pasacalle" (común) | Sinónimo faltante → regla 4 | Handoff | **D** | [datos] sinónimo→lona si TG los hace |
| 29 | "Apuntes de medicina" (est. med.) | 2a Medicina CAVEAT | Número + caveat | **A** | — |
| 30 | "Sobres ingleses para invitaciones" (común) | Duplicado Librería/Soportes → ambiguo | Email | **B** | [datos] renombrar (¿unidad vs pack?) |
| 31 | "Anillar apuntes, ¿cuánto?" (est.) | 2b entre 24/48/72/96hs → LIMPIO | Número Y plazo (plazo es variante) | **A** | — |
| 32 | "Imprimir y anillar apuntes" (EL combo universitario) | Ancla → email + oferta; impresión→zona sucia; anillado silenciado | Email pelado | **B doble** | dedupe + v10.6 — el caso más valioso |
| 33 | "Fotocopia del DNI" (trámite) | Gap fotocopias → regla 4 | Handoff | **D** | [ya] foto lista |
| 34 | "¿Hasta qué hora están?" | Info documentada | Answer | **A** | — |

## Hallazgos estructurales (contraste Fable)

1. **La zona sucia de IMPRESIONES es EL corazón del público universitario** (filas 1, 2,
   3, 25, 32: apuntes, exámenes, CV, tesis). Las variantes duplicadas (OBRA 75 D/F ×2,
   S/F ×2; 106gr ídem) matan en `ambiguo→email` consultas que TIENEN tabla. El dedupe en
   `producto_meta` desbloquea más valor que cualquier fix de prompt. **Fix #1.**
2. **Generalización multi-ítem (v10.6) — SEGURA, aplicada.** Informar el precio de lista
   de CADA ítem que el cliente nombró (vía `mas`) no reabre el configurador: el pecado del
   configurador era PREGUNTAR specs; esto no pregunta nada. Candado estructural: el LLM
   no puede sumar números que nunca ve (se inyectan post-hoc). Condiciones: reactiva
   (los ítems los nombra el cliente, el bot nunca propone el desglose), el ancla v10.5
   sigue mandando para el componente por-página, y el cap de `mas` (2 extras) es el freno.
3. **La clase "C-cara"** (plazos, pagos, envíos, USB, escaneo): handoffs recurrentes que
   una lista de datos de TG convierte en answers de Info del negocio. Plazo es la consulta
   #2 del mostrador y hoy escala SIEMPRE. Anillados muestra el patrón bueno: cuando el
   plazo es dato (variante 24/48/72/96hs), el bot informa con certeza total.
4. **Sobre-disparo del ancla** (fila 14): "encuadernar la tesis YA impresa" es un ítem
   simple con tabla, no un compuesto. Golden R14 lo vigila.
5. **Sinónimos de mostrador** (CV, fotos, stickers, pasacalle): gaps invisibles a las
   suites actuales porque hablan en nombres de catálogo → **suite-4 en lenguaje de
   cliente** (pendiente).

## Ranking de fixes por valor

1. **Dedupe zona sucia IMPRESIONES** [datos, producto_meta] — ya priorizado en handoff.
2. **Paquete de preguntas a TG** (una sola lista): foto lista de precios (fotocopias),
   plazos estándar por rubro, medios de pago/seña, envíos, USB en mostrador, escaneo,
   imanes, medidas de ploteo (¿A1?), precio real vegetal x10, sobres ingleses duplicados.
3. **v10.6** [prompt] — multi-ítem reactivo. APLICADA 2026-07-21.
4. **Sinónimos de mostrador** [datos] — CV, fotos, stickers, pasacalle, etc.
5. **Golden anti-sobre-disparo** — R14 en suite-3.

Ningún mecanismo nuevo: el contrato `mas` + la escalera existentes absorben todo.
