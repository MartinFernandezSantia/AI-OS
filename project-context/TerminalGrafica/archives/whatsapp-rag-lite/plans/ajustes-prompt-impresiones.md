# Plan — Ajustes de prompt del bot RAG lite (impresiones por uso, cantidad-vs-pack, achicar) + spec de curación


## Context

Probando el bot (n8n, arquitectura nativa RAG) Martin encontró varios problemas de comportamiento y juntó correcciones de datos que le pasó un empleado de TG. La exploración confirmó que son **tres flujos distintos**:

- **A) Prompt/comportamiento** — se arregla en `scripts/build-flow.mjs` (`sistema`). ESTA sesión.
- **B) Datos del catálogo** — van por overlay SQL en el esquema `bot` (que Martin aplica) + re-ingesta. NO por el prompt. Se captura el spec acá para un pase de `/tg-curar-catalogo` aparte.
- **C) Ítems que piden código nuevo + decisión de precio** — DIFERIDOS.

Bugs concretos que motivan A:
- El bot pregunta "tipo de papel + gramaje" en impresiones — términos técnicos que casi nadie sabe.
- A "módulos de enfermería" no recomendó las impresiones de medicina (que sí aparecieron en el RAG) y ofreció "emblocados" como agregado no pedido.
- A "las necesito a color" buscó `impresión color papel obra 75g 106g ilustración 300g` — query sobre-específica; los papeles/gramajes de los ejemplos del prompt se filtran a las búsquedas.
- Cuando la cantidad pedida no cae en un pack, el bot no informa las cantidades que sí se trabajan.
- El `sistema` está verboso (~142 líneas) con redundancia (la consigna "preguntá, no propongas" está en 3 lugares; "Salida estructurada" duplica el JSON schema).

Resultado buscado: impresiones guiadas por USO (no por papel técnico), regla clara de cantidad-vs-pack, sin agregados no pedidos, y un prompt más corto y sin ejemplos de papel que ensucien las búsquedas.

---

## Workstream A — Cambios de prompt (`scripts/build-flow.mjs`, constante `sistema`)

### A1. Impresiones por USO, no por papel técnico (el cambio central)
Reemplazar la línea de ejes de "Impresiones en papel" (hoy L72: *"1) tipo de papel · 2) gramaje · 3) tamaño · 4) color/BN · 5) faz"*) por un flujo basado en uso:
- Preguntar **para qué es** la impresión (apuntes, folleto, foto, cartel, etc.) + **color o b/n** + **cantidad** — NO preguntar papel ni gramaje.
- El bot **infiere el papel** desde el uso con una guía interna (abajo) y **busca con ese papel específico** (una consulta acotada, no un volcado de papeles).
- Si el uso no alcanza para decidir, ofrece 1-2 opciones concretas que devolvió `buscar_catalogo`, en lenguaje llano.

**⚠️ CONFIRMÁ ESTE MAPEO USO→PAPEL** (guía interna del bot, sale del catálogo real + lo del empleado):
| Uso del cliente | Papel a recomendar/buscar |
|---|---|
| Apuntes, textos, borradores, impresión común | **Obra 75 gr** (A4, económico; b/n o color). Default. (obra 75 = obra 80) |
| Igual, con más cuerpo | Obra 106 gr |
| Color de calidad, láminas, afiches | Láser color (obra 80/106, ilustración) |
| Fotos, folletos, tapas con brillo | Ilustración brillo 150 / mate 250-300 gr |
| Tapas, invitaciones, algo premium | Opalina 250 gr |
| Resistente al agua | **OPP** (láser, simil vinilo, menor calidad) — el ÚNICO papel resistente al agua |
| Autoadhesivo / etiquetas / tipo vinilo | Sticker/Etiqueta autoadhesivo (agrupa varios; NO es lo de resistencia al agua) |
| Rústico / decorativo | Kraft 130 / 300 gr |
| Calcar / traslúcido | Vegetal |
| Módulos/apuntes de facultad (medicina) | Producto "módulos de medicina" (económico por página) |

Notas de datos ya verificadas: obra 75 es **solo A4**; el A5 láser (ilustración mate 250) es **a color**.

### A2. Regla cantidad-vs-pack (nueva, general)
Agregar a "## Reglas siempre": *si la cantidad que pide el cliente no coincide con un pack/tramo exacto: (1) informale las cantidades que SÍ se trabajan (ej. tarjetas: 100, 500, 1000), (2) mapeá lo pedido al pack más chico que lo CUBRE (300 → pack de 500), (3) dale el precio de ESE pack. No inventes un pack de 300 ni prorratees el precio.* (Generaliza lo que hoy solo existe para tarjetas; `precioDisplay` ya redondea hacia arriba al tramo que cubre.)

### A3. No ofrecer agregados no pedidos (nueva)
Agregar regla: *respondé SOLO lo que el cliente pidió; no ofrezcas productos o servicios extra/complementos que no pidió (ej. emblocados, laminados). Recién si pregunta por más, sumás.* (Ataca el "emblocados como agregado" del bug de enfermería.)

### A4. Scrub de ejemplos de papel/gramaje que se filtran a las búsquedas
- Quitar "Papel obra 106g" como ejemplo de pedido acotado (L25-26) → reemplazar por un ejemplo sin papel concreto.
- La guía uso→papel (A1) es interna para DECIDIR qué buscar; el prompt aclara explícitamente: **no vuelques nombres técnicos de papel al cliente ni los uses como texto de búsqueda literal salvo el que corresponde al uso.** Refuerza la regla existente "USÁ LAS PALABRAS DEL CLIENTE".

### A6. Guard de nicho por INFERENCIA de dominio, no por palabra ni lista (el bug de enfermería)
El guard actual (L82-85) exige que el cliente mencione el rubro literal ("medicina") y por eso NO recomendó "módulos de medicina" a "módulos de enfermería". El fix NO es ampliar la lista de rubros aceptados (agregás enfermería y después viene pediatría, kinesiología, bioquímica — ninguna enumeración alcanza). Reescribir la regla para que el modelo **infiera pertenencia de dominio**: *el nicho define un DOMINIO (ej. "medicina" = cualquier carrera/área de salud). Recomendá el producto de nicho cuando el pedido del cliente cae dentro de ese dominio, razonándolo vos — no exijas la palabra exacta ni te limites a una lista. Si el pedido no tiene nada que ver con el dominio, ignoralo aunque aparezca en los resultados.* Ejemplos SOLO para ilustrar que debe generalizar (no son whitelist): enfermería, pediatría, kinesiología → todos caen en "medicina". Es prompt, no datos.

### A5. Achicar y de-duplicar (objetivo: prompt más corto y tenso)
- **"## Salida estructurada" (L126-154, 29 líneas):** colapsar — hoy repite casi textual el `esquemaSalida` JSON (que ya describe cada campo). Dejar solo: qué es cada campo top-level en 1 línea, la completitud de `productos_ofrecidos` (declarar todo lo que afirmás), la mecánica `{Pn}`, y la "regla de oro". Los sub-bullets que duplican el schema se van.
- **"preguntá, no propongas":** hoy en etapa 3 + toda "## Preguntar vs proponer" + bullet ANCLAJE. Unificar a un lugar fuerte + referencias cortas.
- **"## Precios":** tensar el ejemplo del marcador (L92-95) sin perder la regla "nunca tipees un número".
- No tocar: el schema `esquemaSalida`, la lógica de `{Pn}`, ANCLAJE POR AFIRMACIÓN (recién agregado), multi-producto, guard de nicho.

### Archivos y verificación (A)
- Editar SOLO `scripts/build-flow.mjs` (constante `sistema`, quizá `toolDesc`).
- `pnpm flow:build` → OK. `pnpm test` → 29/29 (no se toca precios).
- Prueba en vivo (Martin, nodo Chat interno de n8n): "necesito imprimir unos apuntes" → pregunta uso/color/cantidad, NO papel técnico → recomienda obra 75. "algo resistente al agua" → OPP. "módulos de enfermería" → recomienda medicina (una vez aplicado B), sin ofrecer emblocados. Cantidad fuera de pack → informa las trabajadas. Claude NO ve las ejecuciones: Martin pasa el dato.

---

## Workstream B — Spec de curación de datos (próximo pase `/tg-curar-catalogo`)

Overlay en esquema `bot` (NUNCA `public`), por clave natural, que Martin aplica + re-ingesta (`pnpm rag:ingest --apply`). Cambios:

1. **Ocultar "Cartón"** (`oculto: true`, clave `carton|cartones`). Solo se ofrecen los encartonados ("Montado sobre cartón").
2. **Obra 75:** casos_de_uso "apuntes, textos, impresiones comunes"; nota "default para impresión común; obra 75 = obra 80".
3. **OPP:** nota/casos_de_uso "resistente al agua, tipo vinilo plástico (menor calidad); único papel láser resistente al agua".
4. **A5 láser:** tipificar/aclarar que es **a color** (hoy `color:null`).
5. **Cocodrilo:** es un **brochesito** (broche cocodrilo), no encuadernación tipo espiral; ajustar display/sinónimos/casos_de_uso. (Confirmar con empleado si igual sirve para encuadernar.)
6. **Carpetas de presentación:** corregir el framing — **son personalizadas, las imprime la gráfica**. Hoy están en `libreria` con nota "no son trabajo de impresión a medida" (contradice). Revisar familia_nota / familia + casos_de_uso.
7. **Imanes:** nota/atributo "impresión laminada en lámina A3".
8. **"Soportes especiales" → "Papeles especiales":** son para impresión. Ya no es entidad (solo grupo de origen; los 6 productos ya están en impresiones_papel) → probable no-op; a lo sumo confirmar naming. Baja prioridad.
9. **Encartonado incluye impresión encapada:** nota informativa (aclara que suma la impresión en encapado). El precio-composición es Workstream C.

> Nota: el caso enfermería NO va en datos — se resuelve por la regla A6 (inferencia de dominio). Enumerar sinónimos no escala.

Ítems 5, 6, 9 → generan preguntas en `preguntas-tg.md` (confirmación del negocio).

---

## Workstream C — Diferido (código nuevo + decisión de precio)

- **Planos "puede salir entre $X e $Y" por cobertura:** hoy `price-display.ts` no tiene primitiva de rango continuo (solo escalera por cantidad y desde/hasta entre variantes). Requiere primitiva nueva + su copia inlineada en el Code node "Insertar Precios" de n8n. Los tiers existen (lineal $5.000 → 100% $12.000 el m²); falta definir cómo mostrarlo.
- **Encartonado + impresión encapada:** composición de precio → toca el motor de cotización (quote-automation), fuera de este repo.

---

## Notas para después
- El `SKILL.md` de `tg-curar-catalogo` describe el modelo pre-RAG (render viejo, motor v7); no cubre `familia_nota`/`nota`/`nicho`/`peso` ni el paso de re-ingest. Actualizarlo antes o durante el pase B.
- Cohesividad con historial → sigue diferida a Chatwoot.
