# Plan: retirar el bloque B del Verificador (deja de mirar productos y precios)

> **Regla AIOS:** este plan es del modo plan. Al aprobarse, moverlo a
> `project-context/TerminalGrafica/whatsapp-rag-lite/plans/retirar-bloque-b-verificador.md`
> y commitear en el AIOS. Es el "Plan diferido" que quedó al pie de
> `plans/trabajos-variantes.md` (L155-156).

## Contexto

El Verificador del bot RAG-lite de TerminalGrafica es un 2º agente (guardrail) que
revisa la respuesta del bot y devuelve un veredicto JSON. Hoy hace dos cosas:

- **Bloque A — política/rol (SIEMPRE):** 6 checks que no dependen del catálogo real.
- **Bloque B — comparación de producto (gateado por etapa):** audita productos y
  precios contra las filas reales del catálogo, que un pre-fetch (`Traer Catálogo
  Real`) le inyecta.

**Decisión del dueño:** el Verificador NO debe auditar productos ni precios (ni
sueltos ni de trabajos), solo política/rol. El bloque B se retira entero. Esto también
elimina el pre-fetch de catálogo y su plumbing, y deja un prompt más corto y barato en
todas las etapas.

Motivación de fondo: tras el rediseño del modelo de trabajos (variantes-de-trabajo con
componentes), la comparación de producto del Verificador dejó de aportar y arriesgaba
falsos positivos sobre las nuevas formas `[tN]`. El check que SÍ se conserva para el
cruce respuesta-vs-auditoría es `producto_no_declarado`, que vive en el bloque A y no
toca el catálogo real.

El flow n8n se genera con `scripts/build-flow.mjs` (`pnpm flow:build`) — **nunca** se
edita el JSON a mano. Todos los cambios son en el builder.

## Resultado esperado

Quedan los **6 checks de política** del bloque A: `no_trabajado`, `info_no_permitida`,
`derivacion_prematura`, `pedido_o_archivo_por_canal`, `fuera_de_rol`,
`producto_no_declarado`. Desaparecen `fusion_variantes` y `producto_inventado`. El
Verificador ya no recibe el catálogo real ni computa `faltantes`. Nada aguas abajo se
rompe: el ruteo aprobar/corregir, el Corrector y el logging dependen de
`accion`/`corregido`, no de los tipos del bloque B.

## Mapa de remoción (verificado contra el código actual)

Archivo único: `project-context/TerminalGrafica/whatsapp-rag-lite/scripts/build-flow.mjs`.

### 1. Eliminar el nodo `Traer Catálogo Real` (L1048-1079)
Es el `postgres` `executeQuery` (`id: rag-traer-catalogo`) que pre-fetchea filas por
`nombre_canonico`. Borrar el objeto-nodo entero, incluido su comentario (L1049-1055).

### 2. Recablear `Agente → Armar Verificación` directo (L1368-1375)
- `Agente.main[0]` pasa de `[{ node: "Traer Catálogo Real" }]` a
  `[{ node: "Armar Verificación" }]`. (`main[1]` → Fallback Agente queda igual.)
- Borrar la entrada de conexión `"Traer Catálogo Real": { main: [...] }` (L1374).
- Ajustar el comentario L1367 ("pre-fetch del catálogo → Verificador").

### 3. `Armar Verificación` (code, L1080-1121): quitar todo lo de catálogo
- Quitar `const conCatalogo = …` (L1092) y todo el bloque `if (conCatalogo) {…}`
  (L1104-1112).
- Quitar el cómputo que solo servía al bloque B: `const rows = $input.all()…` (L1093),
  el normalizador `nk` (L1095), `const encontrados = …` (L1096), `const pedidos = …`
  (L1097) y `const faltantes = …` (L1098).
- Ya no se lee `$input` (antes eran las filas del pre-fetch; al recablear pasaría a ser
  el output del Agente, que igual no se usa).
- `return` nuevo: `[{ json: { prompt: partes.join('\n'), auditoria: aud, etapa } }]`
  (se van `faltantes` y `conCatalogo`). `partes` queda solo con pedido + respuesta +
  auditoría (L1099-1103).
- Ajustar el comentario del nodo (L1081-1084) a "arma el prompt de política; ya no
  inyecta catálogo".

### 4. `Leer Veredicto` (code, L1122-1152): sacar la lectura de `faltantes`
- Quitar `let faltantes = []; try { faltantes = $('Armar Verificación')…` (L1136-1137)
  y la línea `if (ve && typeof ve === 'object') ve.faltantes = faltantes;` (L1138).
- Ajustar el comentario del nodo (L1125-1126) que menciona adjuntar `faltantes`.
- El resto (`accion`, `respuesta`, `auditoria`, `verificacion`) no cambia.

### 5. `sistemaVerif` (prompt, L412-442)
- Sacar del intro la mención a los "DATOS REALES del catálogo" (L414: la frase "A VECES
  (solo cuando el bot ofreció productos) también recibís los DATOS REALES…").
- Borrar el bloque **`## B) COMPARACIÓN DE PRODUCTO`** entero (L429-432), incluido su
  encabezado.
- En **`## A)`** (L421), sacar el "(con o sin catálogo)" del título.
- En **`## Acción`** (L436), quitar la referencia a "saca el producto inventado" / "quita
  el atributo de más de una fusión" si menciona el bloque B; dejar solo lo de política.
- En la **Salida** (L440), sacar `"fusion_variantes"` y `"producto_inventado"` del enum
  de `tipo`.

### 6. `esquemaVerif` (L444-482)
- Quitar `"fusion_variantes"` y `"producto_inventado"` del `enum` de `tipo`
  (L471-472).

### 7. `sistemaCorrector` (prompt, L487-511) — cosmético
- Quitar la línea `- fusion_variantes: quitá el atributo que sobra.
  producto_inventado: sacá ese producto.` (L504). El Corrector no rompe si nunca le
  llega ese tipo; es solo limpieza para no documentar checks que ya no existen.

### 8. Limpiar comentarios de doc + sticky notes que referencian el pre-fetch
**Comentarios JS** (no afectan runtime, solo doc):
- Cabecera de la sección VERIFICADOR (L408-411): menciona el veredicto comparativo
  gateado por etapa y "cuando Armar Verificación le pasa el catálogo real".
- Comentario del nodo Verificador (L1005) y del prompt pre-armado (L1008-1009).
- Header del nodo `Armar Verificación` (L1081-1084): describe el gateo + FALTANTES.
- Header del nodo `Leer Veredicto` (L1122-1126): describe que adjunta `faltantes`.

**Sticky notes (CONTENIDO visible en la UI de n8n, no comentarios JS)** — editar los
strings, no borrarlos como si fueran comentarios:
- L1326: describe el Verificador con "COMPARACIÓN DE PRODUCTO … SOLO si etapa ∈ …" y
  la inyección de filas reales desde `Traer Catálogo Real`.
- L1337: "El pre-fetch del Verificador (Traer Catálogo Real) es un postgres normal…".

### 9. README.md (L107-120)
Documenta el bloque B y el nodo `Traer Catálogo Real`. Actualizar la descripción del
Verificador para reflejar que ahora es solo política/rol.

### 10. Archivar el flow de test huérfano
`n8n/flows/faq-bot-rag-lite-TEST-error-modelo.json` NO lo genera el builder (solo
escribe `OUT_MAIN` + `OUT_CHATWOOT`) y quedaría con 4 referencias al nodo eliminado.
Moverlo a `archives/` (o borrarlo). Decisión del dueño: **archivarlo**.

## Downgrade aceptado (decisión consciente del dueño)
`faltantes` era el único check **determinista** (match SQL exacto, no-LLM) de nombres
inventados, y se computaba siempre para observabilidad en el log. Al retirar el bloque B
se pierde: un nombre alucinado que el bot igual haya declarado en `productos_ofrecidos`
ya no lo caza nadie (`producto_no_declarado` solo cruza respuesta-vs-auditoría, no valida
contra el catálogo). **Se acepta a sabiendas** — es coherente con la decisión de que el
Verificador no mire catálogo. Queda registrado acá y en el commit.

## Lo que NO se toca (verificado)
- `producto_no_declarado` sigue vivo: está en el bloque A (L427), es cruce
  respuesta-vs-auditoría y **no** usa el catálogo real.
- El pre-fetch del Agente principal (tools RAG `buscar_catalogo` / `consultar_info_negocio`)
  es independiente y no se toca.
- Ruteo Acción, Corrector, Aplicar Corrección, Fallbacks, logging: sin cambios (dependen
  de `accion`/`corregido`).
- No hay tests que cubran el bloque B (confirmado: la suite de `lib/catalog/__tests__`
  es de ingesta/chunk, no del flow del Verificador).

## Verificación

1. `pnpm flow:build` regenera **ambos** flows (`n8n/flows/faq-bot-rag-lite.json` y
   `-chatwoot.json`) sin errores.
2. `grep -rn "Traer Catálogo Real\|fusion_variantes\|producto_inventado\|DATOS REALES\|conCatalogo\|faltantes" scripts/build-flow.mjs n8n/flows/faq-bot-rag-lite.json n8n/flows/faq-bot-rag-lite-chatwoot.json README.md`
   → sin coincidencias en el builder, los 2 JSON generados ni el README. (El JSON
   `-TEST-error-modelo.json` ya no está: se archivó en el paso 10.)
3. `grep -n "producto_no_declarado" scripts/build-flow.mjs` → sigue presente en
   `sistemaVerif`, `esquemaVerif` y `sistemaCorrector` (el bloque A intacto).
4. `pnpm exec tsc --noEmit` sigue OK (no toca TS, pero confirma que nada colateral se
   rompió) y `pnpm test` verde.
5. Revisión visual del JSON generado: el nodo `Agente Verificador` recibe de
   `Armar Verificación`, que ahora cuelga directo del `Agente`; no existe nodo
   `Traer Catálogo Real`.

## Cierre
Commit en el AIOS (rama de trabajo actual), mensaje estilo
`refactor(tg-rag): retirar bloque B del Verificador (deja de auditar productos/precios)`.
Mover este plan a `whatsapp-rag-lite/plans/` y tachar la sección "Plan diferido" al pie
de `plans/trabajos-variantes.md`.
