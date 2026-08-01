# Catálogo limpio — overlay `bot.producto_meta` / `bot.variante_meta` (v10.8)

> Plan + mapping de la sesión 2026-07-22. Diseño contrastado con el agente Fable en
> 4 rondas adversariales (log al final). **Este es el diff que Martin revisa UNA vez**
> antes de aplicar la migración (`db/catalogo-limpio-overlay.sql`).
> Regla vigente: Claude prepara, **Martin aplica**. Nada toca `public.*`.

## Qué resuelve

La matriz de 34 situaciones mostró que la "zona sucia" de IMPRESIONES mata las
consultas del corazón universitario (apuntes, exámenes, CV, tesis: filas 1, 2, 3, 25,
32 → `ambiguo` → email TENIENDO tabla). Hallazgo de esta sesión: **no son duplicados
reales** — las variantes se distinguen por la columna `color` (`'false'`=b/n,
`'true'`=color) que ni el catálogo ni el matching usaban. El fix es exponer ese eje en
el nombre visible, vía overlay, sin tocar el motor del mostrador.

## Diseño (cerrado con Fable)

**Capa overlay en schema `bot`** — el motor del mostrador no se entera:

1. `bot.producto_meta` (existente) + 3 columnas: `display_name text` (null = nombre
   vivo), `auto_sinonimo boolean default true`, `oculto boolean default false`.
2. `bot.variante_meta` nueva: `variante_id` PK → `product_variants` ON DELETE CASCADE
   (nunca RESTRICT: un delete del admin no puede fallar por nuestra culpa),
   `display_variante`, `oculto`.
3. `bot.rubro_meta` nueva: `categoria_id` PK, `display_name` (solo display; la
   categoría NO participa del matching — verificado).
4. **El overlay se aplica EN LAS VISTAS** (`bot.taxonomia` / `bot.variantes`), con el
   contrato de columnas intacto → Get Catálogo renderiza y Get Precio matchea la misma
   columna coalesced: coherencia por construcción, **cero cambios en nodos Code**.
   `bot.variantes` suma `variante_origen` (nombre vivo, solo telemetría/reconciliación).
   Ambas metas guardan además `nombre_origen` (nombre vivo al momento de curar):
   insumo del watchdog `tg-catalogo-sync` para detectar renames post-curación
   (plan aparte: [`catalogo-sync-workflow.md`](./catalogo-sync-workflow.md)).
5. **Auto-sinónimo del nombre viejo**: cuando hay `display_name`, la vista appendea
   `p.name` a los sinónimos (trackea el nombre VIVO → anti-drift), con dedupe
   normalizado y **gated por `auto_sinonimo`**. Se apaga SOLO para IMPRESIONES:
   'IMPRESIONES' normaliza a 'impresiones' = el término rubro-genérico que la poda
   D4a elimina; auto-appendearlo resucitaría el hijack por rank 1 (hallazgo ronda 3).
6. **Seeding por clave natural** (nombre normalizado + columna color), NUNCA uuids
   hardcodeados (el proyecto de testing y el prod futuro no comparten ids). Lookups
   `INTO STRICT`: 0 o 2+ filas = la migración falla ruidoso.

## EL DIFF — lo que cambia para el bot

### Dedupe zona sucia (variante_meta — 8 renames)

| Producto | Variante viva (color) | Display nuevo |
|---|---|---|
| IMPRESIONES | OBRA 75 GR S/F ('false') | simple faz b/n |
| IMPRESIONES | OBRA 75 GR D/F ('false') | doble faz b/n |
| IMPRESIONES | OBRA 75 GR S/F ('true') | simple faz color |
| IMPRESIONES | OBRA 75 GR D/F ('true') | doble faz color |
| Impresión a4 Papel obra de 106 gr | S/F ('false') | simple faz b/n |
| Impresión a4 Papel obra de 106 gr | D/F ('false') | doble faz b/n |
| Impresión a4 Papel obra de 106 gr | S/F ('true') | simple faz color |
| Impresión a4 Papel obra de 106 gr | D/F ('true') | doble faz color |

Cada variante tiene SU regla quantity_range → salen con `**` (cantidad-first v10.7):
el flujo pregunta cuántas y da el bracket exacto. Matriz 2/25/32 pasan de B a A.
El backstop dorso sigue correcto: "doble faz *" matchea `/doble/`, "simple faz *" no.

### Displays de producto (producto_meta)

| Nombre vivo | display_name | Nota |
|---|---|---|
| IMPRESIONES | Impresiones papel obra 75 gr | + `auto_sinonimo=false` (ver diseño §5). **NO dice A4**: el dato no está en la BD (gate TG abajo) |
| Impresión a4 Papel obra de 106 gr | Impresiones a4 papel obra 106 gr | **PLURAL deliberado** (Fable R2): el eco "impresiones" del cliente cae por contains en AMBOS obra → ambiguo → email honesto, nunca cotización confiada del equivocado |
| Iman. Impresión laminada y corte. | Imanes (impresión laminada y corte) | el punto en medio era ruido al citar |
| Porta Banner Roll up 0..85 x 2.00 mt | Porta Banner Roll up 0.85 x 2.00 mt | typo `0..85` |

NO se renombra: OPP slash-dump (el nombre alimenta el contains de consultas parciales
tipo "opp mate"; renombrar solo puede romper), Sobre Ingles ×2 (gated TG; golden R5
espera el ambiguo), "única"/"." (el render ya lo resuelve), unidades sucias (unidadOk
ya filtra), Cartelerías.

### Sinónimos — PODAS (reemplazo completo del array)

Principio (Fable R2): palabras que NOMBRAN un producto → `sinonimos` (matchean en SQL
rank 1); palabras de INTENCIÓN → `casos_de_uso` (solo guían al LLM, no matchean).
Un término que nombra la CLASE pero rank-1ea a UN producto = hijack (cotización
confiada del producto equivocado).

| Producto | sinonimos ANTES | sinonimos DESPUÉS |
|---|---|---|
| IMPRESIONES | impresiones a color, impresiones, imprimir a color, trabajo de imprenta | **{} (vacío)** — los 4 eran rubro-genéricos; el display ya arranca con "Impresiones" |
| Impresión de Módulos/Apuntes medicina | modulos medicina, **apuntes**, impresion modulos, modulos carrera | apuntes de medicina, modulos medicina, modulos de medicina, modulos carrera medicina, impresion medicina† |
| Impresión a4 106 gr | impresion a4, papel obra impreso, impresion papel obra, hoja a4 impresa | impresion a4, hoja a4 impresa — poda de los 2 clase-nombrados (ronda 4) |

El 'apuntes' pelado en medicina era un hijack activo HOY: un estudiante de derecho
que dice "imprimir apuntes" podía caer rank 1 en el precio especial de medicina.
† = sinónimo anti-header (ver abajo).

**Tier A — podas del seed legacy (scan completo Fable R4, misma anatomía):**

| Producto | Se poda | Por qué |
|---|---|---|
| Vinilo Mate | 'lona mate' | **bug VIVO**: iguala el nombre exacto del producto Lona Mate → rank-1 doble → ambiguo para un nombre exacto listado |
| Microperforado | 'perforado' | cliente pidiendo perforado de hojas (Taller) caía en el film de vidriera |
| Papel Autoadhesivo | 'troquelado', 'adhesivo brillo' | 'troquelado' nombra el servicio de Taller; 'adhesivo brillo' era coin-flip con 'adhesivo brillante' del OPP |
| Sobre Ingles (Librería) | 'sobres' | clase de 4+ productos rank-1 único a uno ('impresiones' con otro sustantivo) |
| Tacos 10x7 negro | 'tacos', 'taco de papel' | clase de 6 rank-1 único al más chico; par singular/plural con Taller |
| Emblocados (Taller) | 'emblocado', 'tacos de papel' | contains lo cubre; par coin-flip |
| OPP Mate/Holo | 'holografico', 'plata', 'crystal', 'glitter' | 'holografico'/'glitter' pisaban por best-rank al producto de Impresión Uv; 'plata' es radiactivo ("¿cuánta plata?") |
| OPP Brillo | 'adhesivo brillante' | par coin-flip con el autoadhesivo |
| Corte x Millar | 'corte' | genérico de servicio; el corte chico suelto es el gap TG-gated |
| Folletos ilustración | 'folletos' | clase de 3, contains multi la cubre |

**Duplicación deliberada — 'volantes' en los 3 folletos:** no es substring de ningún
nombre (la poda seca lo mandaba a regla 4 para una consulta top) → rank-1 TRIPLE →
ambiguo/2b honesto sin perder funnel. Primera aplicación de la duplicación como
herramienta.

**Tier B — flags, NO bloquean (revisar con TG o en digest semana 1):** 'vinil'
(clase-de-vinilos, rank-1 único a Vinilo Mate — misma anatomía, quedó fuera del scan
de Fable, el NOTICE legacy lo va a mostrar); 'vinilo brillo' duplicado (Solvente vs
UV); 'papel para plotear' duplicado; 'impresion montada' (corrugado vs Montado);
'papel especial'; 'protegido'; 'planos' (Autocad como hogar canónico, defendible);
**'papel obra 106 gramos' en OBRA 106 laser** (post-rename hay DOS productos "papel
obra 106": laser $800/hoja vs Riso con tabla desde $180 — pregunta TG: ¿cuándo va
cada uno?).

### Sinónimos — ALTAS (unión con dedupe, preserva curados)

| Términos | Productos |
|---|---|
| espiralado, espiralar | Anillado Plastico a4/oficio 24/48/72/96 hs + Anillado Plastico a3 (NO el Metálico: espiral = plástico) |
| enmicado, enmicar | Plastificado A4, Plastificado Oficio, Plastificado a3 (NO Carnet: 'carnet plastificado' ya lo resuelve) |
| stickers, sticker | Papel Autoadhesivo Brillo / Split |
| iman, imanes | Iman (unión defensiva: ya están si el seed de sinónimos corrió; no-op en ese caso) |

**Anti-header** (rubros mono-producto hoja cuyo encabezado no resuelve al producto por
nombre — el LLM puede ecoar el header como producto con el reagrupado; assert mecánico
en la migración):

| Sinónimo nuevo | Producto |
|---|---|
| impresiones a3 negro tonner | Impresiones a3 tonner negro |
| impresion medicina | Impresión de Módulos/Apuntes medicina |
| impresion ultra violeta | Vinilo, Lona Brillo/Mate Uv |
| carteleria en plastico corrugado | Impresión exterior / montado sobre plástico corrugado |
| encartonado | Montado sobre carton |
| cartones | Cartón |

(LASER queda excluido del assert por regla mecánica — es categoría ancestro; agregarle
'laser' a A5 ILUST sería fabricar el hijack que el resto del plan mata.)

### casos_de_uso (capa LLM pura, cero matching SQL)

| Producto | casos DESPUÉS |
|---|---|
| Impresiones papel obra 75 gr | para imprimir apuntes · para imprimir exámenes o parciales · para trabajos de la facultad · para imprimir un currículum / cv (reemplaza el ruido Haiku: 'para fotos', 'para catálogos a color') |
| OBRA 80 GR (laser) | + para imprimir un currículum / cv |
| Impresión Medicina | para la facultad de medicina (reemplaza 'para la facu', 'para clases' — mismos hijacks de intención) |

CV va como caso de uso en DOS productos a propósito: el LLM ve ambos y repregunta;
nunca hay cotización confiada por SQL (casos_de_uso no matchea).

### Rubros (rubro_meta — solo jerga→humano)

| Categoría viva | display |
|---|---|
| Impresiones Inkjet/Ricoh/Riso/Epson | Impresiones (Riso/inkjet) — el paréntesis feo es feature: su eco NO matchea nada → email honesto; "Impresiones" pelado o "Impresiones papel obra" serían hijack |
| PIEZAS GRAFICAS/PRODUCTOS | Piezas gráficas |
| Solvente | Lonas y vinilos (sus 7 productos SON eso) |
| Impresión Medicina (Precio Especial) | Impresión Medicina (no prometer "precio especial" en un header citable) |

NO se toca "Impresion Ultra Violeta" (renombrarlo a "Impresión UV" duplicaría el
header existente "Impresión Uv" y el group by fusionaría rubros).

## Asserts de la migración (fallan = no aplica)

1. Lookups `INTO STRICT` por clave natural (0 o 2+ filas → excepción).
2. **Tripwire semántico** de la lectura de `color`: precio_lista 75 gr en orden
   100 < 150 < 400 < 600; primer bracket 106 en orden 180 < 230 < 480 < 680.
   (La confirmación por nombre de regla es inválida: las 4 reglas del 75 se llaman
   igual. El ancla es el precio.)
3. Unicidad de displays coalesced de variantes visibles por producto (translate-lower).
4. Colisiones NUEVAS: displays y sinónimos tocados por esta migración no chocan
   (normalizado) contra nombres/displays/sinónimos de otros productos.
   **Scoped a valores nuevos**: el dup preexistente Sobre Ingles queda grandfathered.
5. **Substring-hazard** (ronda 3): ningún sinónimo NUEVO (len ≥ 4) puede ser
   substring del nombre de otro producto — firma mecánica del hijack rank-1
   ('impresiones' ⊆ 3 nombres la habría cazado sola). Scoped a valores nuevos:
   el espacio legacy se REPORTA como NOTICE, no bloquea (ej. 'carton' ⊆ "Montado
   sobre carton" es violación preexistente conocida). **La lista de NOTICEs no se
   archiva: se revisa** — es el input del próximo tier de podas.
6. Todo rubro HOJA con exactamente 1 producto visible: su header display resuelve
   rank 1 o rank 2 al producto único (los sinónimos anti-header existen para pasar esto).
7. Displays de rubro únicos entre categorías (anti-fusión del group by).

## Cambios n8n (HECHOS en `flows/faq-bot-v6.json` — pendiente re-import)

- **Get Catálogo**: render agrupado — `RUBRO: <nombre>` + línea en blanco entre
  bloques + productos con `- ` debajo. Misma lógica de `*`/`**`/única.
- **System Prompt**: leyenda de formato nueva (rubro como encabezado, "- " guion y
  espacio vs " — " raya larga explícitos, nombre = lo que sigue al guion hasta el
  primer " — " si lo hay). El resto del prompt intacto.
- Harness post-edición: **28/28 OK** (ningún nodo Code tocado).

## Gates TG (bloquean partes del go-live, NO el build)

1. **¿El obra 75 gr es A4? ¿hay otros tamaños?** → gate del par de renombres de la
   zona sucia (matriz 2: "apuntes A4 b/n" puede rutear al 106 caro por asimetría).
   **Decisión binaria ya analizada (Fable R4)** si TG confirma A4: display pasa a
   "Impresiones a4 papel obra 75 gr" y los sinónimos 'impresion a4' / 'hoja a4
   impresa' se DUPLICAN en ambos productos (rank-1 doble → ambiguo → email honesto)
   — NUNCA retención en el 106 solo: el plural del display bloquea el rescate por
   contains, la duplicación es lo que preserva el funnel.
2. ¿Imanes se vende al público? → si no: `oculto=true` (suite 9b).
3. Sobre Ingles ×2 (¿unidad vs pack?) → `oculto` de uno (suite 13b).
4. **¿El precio módulos es SOLO para medicina?** — la poda de 'apuntes' lo asume;
   si TG lo da a cualquiera, se re-ensancha.
5. **Dato sucio latente**: 106 b/n S/F tiene precio_lista $120 pero su tabla arranca
   en $180 (hoy invisible: nQr=1 → siempre tabla; si TG desactiva la regla, saldría
   $120 limpio). Preguntar cuál vale.
6. Fotocopias / escaneo / pasacalle: siguen regla 4 (controles negativos suite-4).

## Runbook de aplicación (Martin)

1. Aplicar `db/catalogo-limpio-overlay.sql` en el proyecto Supabase de testing
   (idempotente; si un assert falla NO aplica — leer el mensaje).
2. Sanity: queries comentadas al final del SQL (variante_meta=8, catálogo agrupado, etc.).
3. Re-importar `faq-bot-v6.json` + verificar creds + **togglear el workflow** (resetea
   cache de catálogo; sin toggle hay hasta 10 min de catálogo viejo).
4. Correr `tests/suite-4-mostrador.md` + regresión de goldens suite-3 (R2, R10, R11,
   R15) — R5 debe SEGUIR dando ambiguo para "sobre inglés".
5. Recién ahí, promptfoo cuando Martin lo decida (gate final ya definido en handoff).

## Log del contraste Fable (4 rondas)

- **R1**: validó arquitectura overlay/vistas; enmendó: seeding por clave natural (no
  uuids), tripwire por precio (no por nombre de regla — las 4 se llaman igual), poda
  de sinónimos rubro-genéricos como MUST de la misma migración (hijack rank 1),
  auto-sinónimo con dedupe, asserts sobre nombres coalesced, gate TG del A4.
- **R2**: enmienda estructural — display del 106 en PLURAL (cierra el eco "impresiones"
  por rank 2 → ambiguo honesto); assert mecánico anti-header en vez de lista manual
  (cazó 3 rubros que el chequeo artesanal salteó); `oculto` ahora (las vistas ya se
  recrean igual); asserts scoped a colisiones nuevas (Sobre Ingles habría bloqueado
  la migración); separador doble newline entre rubros; leyenda con '- ' vs ' — '
  explícitos; rubro_meta validado con 4 displays; 5 casos nuevos de suite.
- **R3** (hallazgo propio, Fable validó): el auto-sinónimo de R1 resucitaba el hijack
  que la poda de R2 cerraba (rank 1 le gana al ambiguo de rank 2) → flag
  `auto_sinonimo=false` solo para IMPRESIONES + assert substring-hazard.
- **R4**: corrección factual a Fable (Iman SÍ tiene sinónimos en el seed — las altas
  van como unión defensiva); poda simétrica del 106 validada ('impresion papel obra'
  y 'papel obra impreso' nombran la clase y el assert de R3 no los ve: no son
  substring contiguo de ningún nombre); **scan completo del seed legacy** → Tier A
  (10 productos podados, 'lona mate' era bug vivo) + duplicación deliberada de
  'volantes' + Tier B de flags; convención enmendada: unión con dedupe NORMALIZADO
  + toda poda reporta el array vivo antes de pisarlo (NOTICE); gate a4 escrito como
  decisión binaria (poda-o-duplicación, nunca retención unilateral). Veredicto
  final: **build go**.
