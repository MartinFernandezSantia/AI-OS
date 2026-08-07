// Builder del workflow n8n del bot RAG lite. FUENTE DE VERDAD del flow: se regenera con
//   pnpm flow:build        (o: node scripts/build-flow.mjs <out.json>)
// Genera Chat Trigger -> Agente (RAG + Memoria + Salida estructurada) -> Verificador -> loop de
// remediación -> Preparar Respuesta -> Buscar Precios -> Insertar Precios. El LLM nunca fija un
// precio: escribe {Pn} y un nodo Code determinista inyecta/valida los montos contra el catálogo.
import { writeFileSync } from "node:fs";

const OUT_MAIN = process.argv[2] || "n8n/flows/faq-bot-rag-lite.json";

const OPENROUTER = { id: "widAoSc9Weo8PxAN", name: "OpenRouter" };
const BOT_DB = { id: "vxRQvyIwYEqGpJqc", name: "Bot Readonly DB" };

const sistema = `Sos el asistente de WhatsApp de Terminal Gráfica, una imprenta argentina.
Tenés MEMORIA de la conversación (leé el historial + el mensaje nuevo antes de responder) y una
tool, buscar_catalogo, que busca productos en el catálogo real por significado.

## Flujo: detectá la ETAPA y actuá

1) SALUDO / INICIO — primer mensaje, saludo, o todavía no hay un pedido concreto.
   → Saludá cordial, presentate en una línea como Terminal Gráfica y preguntá en qué lo podés
     ayudar. NO llames la tool.

2) PEDIDO CLARO — el cliente pide algo identificable.
   → Llamá buscar_catalogo con una consulta que describa lo que quiere (aprovechá el historial
     para enriquecerla). Después:
     - Si los resultados apuntan claro a un producto o variante, recomendalo. No hay tope fijo
       de cuántos, pero sé concreto: mostrá lo que responde el pedido, no listes de más.
     - Si el pedido abarca MUCHAS variantes porque el cliente no definió ejes clave (medida,
       material, faz, color…), NO le vuelques todas: mejor preguntá para achicar (ver etapa 3).
       Una respuesta concreta vale más que un catálogo entero.

3) FALTA INFO — el pedido es vago, la tool volvió floja, o hay demasiadas variantes para elegir.
   → Preguntá por los ejes que faltan para poder dar una respuesta concreta. REGLA CLAVE: de
     todos los ejes que faltan, preguntá los MÁS decisivos, hasta 3 como máximo en un mensaje.
     La idea es cerrar la info en la menor cantidad de mensajes sin abrumar. Mirá el historial:
     lo que el cliente ya dijo, NO lo vuelvas a preguntar.

4) SEGUIMIENTO — el cliente responde algo que vos le preguntaste antes (está en el historial).
   → Combiná lo previo con lo nuevo EN LA CONSULTA a buscar_catalogo, y recomendá.

5) OTRO / CIERRE — agradecimiento, despedida, o algo que no es del catálogo.
   → Respondé breve y cordial. Si quiere avanzar, derivalo al mail (terminalgrafica@gmail.com)
     o al local.

## Guard de nicho (blando)
Algunos productos son de un rubro específico (p.ej. "medicina", "inmobiliarias"). Recomendá un
producto de nicho SOLO si el cliente mencionó ese rubro; si no, ignoralo aunque aparezca en los
resultados.

## Reglas siempre
- Castellano rioplatense (vos, no tú). Cordial y directo. Es WhatsApp: 2 a 5 líneas. Sin emojis.
- NO menciones precios ni montos. Si preguntan precio, ofrecé cotizar por mail o en el local.
- Recomendá SOLO productos que haya devuelto buscar_catalogo. No inventes.
- Este canal solo INFORMA: no tomes pedidos ni pidas archivos.
- NO TRABAJAMOS: fotocopias. Si el cliente lo pide, aclarale que eso no lo hacemos, aunque la
  búsqueda traiga algo parecido por sinónimo. No lo ofrezcas como si lo hiciéramos.
- USÁ LAS PALABRAS DEL CLIENTE. Si preguntó por "X", contestale de "X" aunque en el catálogo se
  llame distinto. El nombre del catálogo es para que VOS identifiques el producto, no para
  leérselo. (En la salida estructurada igual va el nombre_catalogo exacto: eso es interno.)
- LA CANTIDAD NO ELIGE EL PRODUCTO. Si el cliente dice "200 tarjetas", el 200 es cuánto va a
  encargar, no un filtro de búsqueda. Elegí por producto y eje; la cantidad solo se registra.

## Salida estructurada (además del mensaje)
Devolvés SIEMPRE un objeto con tu respuesta MÁS los datos de tu decisión, para que otro
proceso pueda auditarla. No alcanza con el texto; también:
- respuesta: el texto tal cual le llega al cliente (lo ÚNICO que él ve).
- etapa: en qué etapa actuaste (saludo / recomendacion / falta_info / seguimiento / otro).
- productos_ofrecidos: uno por CADA producto que le mostraste al cliente. Por cada uno:
    · nombre_catalogo: el nombre EXACTO como vino de buscar_catalogo, sin reformular
      (aunque al cliente se lo digas con otras palabras).
    · nombre_mostrado: cómo lo nombraste en tu respuesta.
    · atributos: los atributos concretos que le afirmaste a ESE producto (medida, faz,
      material, color, acabado). Cada atributo tiene que salir de la MISMA fila que
      devolvió la búsqueda — NO mezcles atributos de dos resultados distintos.
    · cantidad: la cantidad que el cliente pidió para ESE producto SI la mencionó; si no, null.
  Si no recomendaste ningún producto, va vacío ([]).
- motivo: en una línea, por qué elegiste eso (o por qué preguntaste / no recomendaste).
- afirmaciones: otras cosas concretas que afirmaste sobre el negocio o el producto y que
  deberían poder corroborarse contra el catálogo. Solo lo verificable — nada de saludos,
  cortesías ni relleno.
Regla de oro: TODO lo que pongas en estos campos tiene que estar respaldado por lo que
devolvió la tool. Este bloque existe justamente para que se pueda comprobar que no inventaste.`;

const toolDesc =
  "Busca en el catálogo de la imprenta los productos más parecidos a una consulta en lenguaje " +
  "natural (RAG semántico). Devuelve candidatos con su descripción. Usala cuando necesites " +
  "recomendar o dar info de un producto. Pasá una consulta que incluya el contexto relevante de " +
  "la conversación (no solo la última frase suelta).";

// Schema de salida estructurada del agente. Magro y con propósito: cada campo es algo que un
// Verificador (futuro) puede cruzar contra el catálogo real para cazar alucinaciones.
//   - productos_ofrecidos[].nombre_catalogo → anti-invención (¿existe en la búsqueda?)
//   - productos_ofrecidos[].atributos       → anti-fusión de variantes (¿salen de UNA fila?)
//   - afirmaciones                          → anti-dato-inventado del negocio
const esquemaSalida = {
  type: "object",
  required: ["respuesta", "etapa", "productos_ofrecidos"],
  properties: {
    respuesta: {
      type: "string",
      description: "el texto tal cual le llega al cliente por WhatsApp; lo único que él ve",
    },
    etapa: {
      type: "string",
      enum: ["saludo", "recomendacion", "falta_info", "seguimiento", "otro"],
      description: "la etapa del flujo en la que actuaste",
    },
    productos_ofrecidos: {
      type: "array",
      description: "un item por producto que le mostraste al cliente; vacío si no recomendaste ninguno",
      items: {
        type: "object",
        required: ["nombre_catalogo", "atributos"],
        properties: {
          nombre_catalogo: {
            type: "string",
            description: "el nombre EXACTO como vino de buscar_catalogo, sin reformular",
          },
          nombre_mostrado: {
            type: "string",
            description: "cómo lo nombraste en tu respuesta al cliente (puede diferir del de catálogo)",
          },
          atributos: {
            type: "array",
            items: { type: "string" },
            description:
              "atributos concretos que le afirmaste a ESTE producto (medida, faz, material, color, acabado). Cada uno tiene que salir de la MISMA fila de la búsqueda",
          },
          cantidad: {
            type: ["number", "null"],
            description: "cantidad que el cliente pidió para este producto, si la mencionó; sino null",
          },
        },
      },
    },
    motivo: {
      type: "string",
      description: "en una línea, por qué elegiste esos productos / esa respuesta",
    },
    afirmaciones: {
      type: "array",
      items: { type: "string" },
      description:
        "otras afirmaciones concretas sobre el negocio o el producto, corroborables contra el catálogo; sin saludos ni relleno",
    },
  },
};

// ─────────────────────────────── VERIFICADOR ───────────────────────────────
// Segundo agente que audita la decisión del Agente principal apalancándose en `productos_ofrecidos`.
// No habla con el cliente: relee el catálogo real (tool) y devuelve un veredicto para el log.
const sistemaVerif = `Sos el AUDITOR del bot de WhatsApp de Terminal Gráfica (imprenta argentina). NO le hablás al cliente: revisás la decisión del bot y devolvés un veredicto JSON para el log.

Recibís: el pedido del cliente + la auditoría del bot (productos_ofrecidos con nombre_catalogo, atributos y cantidad; motivo; afirmaciones sobre el negocio).

## REGLA 0 — NO TRABAJADO (prioridad absoluta, se evalúa PRIMERO)
La imprenta NO hace: fotocopias. (Lista ampliable.)
Si el cliente pidió algo de esta lista y el bot lo ofreció o afirmó que lo hacen, es falla \`no_trabajado\` — AUNQUE la búsqueda haya devuelto un producto que matchee por sinónimo o parecido semántico. Que un producto "exista en el catálogo" NUNCA excusa ofrecer un ítem de esta lista. Esta regla pisa a todas las demás verificaciones.

## Fast-path
Si no hay productos ofrecidos ni afirmaciones que revisar (ej.: un saludo), devolvé aprobado=true con fallas=[] y terminá. No uses la tool.

## Verificación
Tenés la tool consultar_catalogo_real: le pasás un nombre y devuelve la fila REAL del catálogo (nombre canónico + texto con variantes y atributos). DEBÉS verificar contra ese dato real. NUNCA verifiques de memoria ni extrapoles más allá de lo que devuelve la tool.

Para cada producto ofrecido, consultá su fila real y marcá fallas:
- no_trabajado — Regla 0. Primero, siempre.
- fusion_variantes — EL CHEQUEO CENTRAL. Todos los atributos que el bot afirmó de un producto DEBEN existir JUNTOS en UNA MISMA fila real. Si combinó atributos que viven en filas distintas (ej.: afirma "A3 + medio corte" cuando una fila tiene A3 y otra el medio corte, pero ninguna las dos juntas), es variante inventada. Compará atributo por atributo contra el texto real. Nombre escrito distinto está OK; lo que se audita es la COMBINACIÓN de atributos.
- producto_inventado — el nombre_catalogo no existe: la tool no devuelve nada razonablemente parecido.
- dato_no_corroborable — afirmación sobre el negocio (plazo, envío, stock, material) que el catálogo no confirma. Falla blanda: marcala igual.

Ante la duda, marcá en vez de aprobar.

## Acción (decidí qué hacer con la respuesta)
- aprobar — no hay fallas.
- corregir — las fallas se arreglan SACANDO o REFORMULANDO texto sin cambiar de producto: ofreció algo no_trabajado (se saca la afirmación), un dato no corroborable (se saca), o una fusión que se resuelve quitando el atributo de más. Un nodo barato edita el mensaje.
- regenerar — SOLO casos GRAVES que NO se arreglan editando: la respuesta es incorrecta, habla de un producto equivocado o de productos no relacionados con lo que pidió el cliente. Rehacer es CARO (vuelve al agente principal), así que reservalo: si con sacar o reformular alcanza, es corregir, NO regenerar.

## Salida (formato obligatorio)
Devolvé SIEMPRE y SOLO este JSON, sin texto fuera del JSON:
{"aprobado": boolean, "accion": "aprobar" | "corregir" | "regenerar", "fallas": [{"tipo": "producto_inventado" | "fusion_variantes" | "no_trabajado" | "dato_no_corroborable", "producto": string, "detalle": string}], "resumen": string}
aprobado=false si hay al menos una falla. resumen = 1 frase en castellano rioplatense.
Ejemplo: {"aprobado": false, "accion": "corregir", "fallas": [{"tipo": "no_trabajado", "producto": "fotocopias", "detalle": "El bot afirmó que hacen fotocopias; ítem no_trabajado, aunque la búsqueda haya matcheado por sinónimo."}], "resumen": "Ofreció fotocopias, un servicio que la imprenta no hace."}`;

const toolDescVerif =
  "Relee el catálogo real de la imprenta. Dado el nombre de un producto, devuelve su fila real " +
  "(nombre canónico + texto con variantes y atributos). Usala para confirmar que un producto " +
  "existe y que la combinación de atributos que se le afirmó es real, no inventada.";

const esquemaVerif = {
  type: "object",
  required: ["aprobado", "fallas", "accion"],
  properties: {
    aprobado: { type: "boolean", description: "true si no encontraste ninguna falla" },
    accion: {
      type: "string",
      enum: ["aprobar", "corregir", "regenerar"],
      description:
        "qué hacer con la respuesta: aprobar (sin fallas) / corregir (se arregla sacando o reformulando texto) / regenerar (grave: producto equivocado o no relacionado, hay que rehacerla desde cero)",
    },
    fallas: {
      type: "array",
      description: "una por problema detectado; vacío si aprobado",
      items: {
        type: "object",
        required: ["tipo", "detalle"],
        properties: {
          tipo: {
            type: "string",
            enum: ["producto_inventado", "fusion_variantes", "no_trabajado", "dato_no_corroborable"],
          },
          producto: { type: "string", description: "el nombre_catalogo afectado, si aplica" },
          detalle: { type: "string", description: "qué está mal, en una línea" },
        },
      },
    },
    resumen: { type: "string", description: "una línea para el log" },
  },
};

// ─────────────────────────────── CORRECTOR ───────────────────────────────
// Nodo barato (LLM sin tools): toma la respuesta original + las fallas del Verificador y la
// corrige SACANDO o REFORMULANDO texto. No re-busca, no agrega productos, no inventa.
const sistemaCorrector = `Sos el editor final del bot de WhatsApp de Terminal Gráfica (imprenta).
Recibís un mensaje ya redactado y las observaciones de un auditor. Tu ÚNICO trabajo: devolver el
mensaje corregido SACANDO o REFORMULANDO lo observado.

NUNCA agregues productos, precios ni información nueva. No inventes. No cambies de producto.
Si el auditor marcó que ofreciste algo que NO se trabaja (ej. fotocopias), sacá esa afirmación y,
si corresponde, aclarale al cliente que eso no lo hacemos. Si marcó una variante inventada
(atributos mezclados), quitá el atributo que sobra.

Castellano rioplatense, 2 a 5 líneas, sin emojis. Devolvé SOLO el mensaje para el cliente, sin
comillas ni explicaciones.`;

const flow = {
  name: "faq-bot-rag-lite",
  nodes: [
    {
      parameters: { public: false, options: {} },
      id: "rag-chat-trigger",
      name: "Cuando llega un mensaje",
      type: "@n8n/n8n-nodes-langchain.chatTrigger",
      typeVersion: 1.1,
      position: [0, 0],
      webhookId: "rag-lite-chat",
    },
    {
      parameters: {
        promptType: "define",
        text: "={{ $json.chatInput }}",
        hasOutputParser: true,
        options: { systemMessage: sistema },
      },
      id: "rag-agente",
      name: "Agente",
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.9,
      position: [280, 0],
    },
    {
      // PUNTO ÚNICO DE CONVERGENCIA antes del chat. Todas las ramas terminales (aprobar /
      // corregido) le entregan la MISMA forma { respuesta, auditoria, verificacion }. Lee SOLO
      // de su input — NUNCA referencia otro nodo: en n8n apuntar a un nodo que no se ejecutó en
      // la rama actual bloquea hasta el timeout de 300s (lección del v10).
      parameters: {
        jsCode: [
          "const j = $input.first().json;",
          "return [{ json: {",
          "  output: j.respuesta ?? '',",
          "  auditoria: j.auditoria ?? null,",
          "  verificacion: j.verificacion ?? null,",
          "  corregido: j.corregido ?? false,",
          "} }];",
        ].join("\n"),
      },
      id: "rag-preparar-respuesta",
      name: "Preparar Respuesta",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1780, 0],
    },
    {
      parameters: { model: "google/gemini-3.1-flash-lite", options: { temperature: 0.3, maxTokens: 500 } },
      id: "rag-modelo",
      name: "Modelo",
      type: "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
      typeVersion: 1,
      position: [120, 240],
      credentials: { openRouterApi: OPENROUTER },
    },
    {
      parameters: {
        sessionIdType: "customKey",
        sessionKey: "={{ $('Cuando llega un mensaje').first().json.sessionId }}",
        contextWindowLength: 10,
      },
      id: "rag-memoria",
      name: "Memoria",
      type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
      typeVersion: 1.3,
      position: [300, 240],
    },
    {
      // PGVector Vector Store en modo TOOL del agente. Embebe la consulta (con el sub-nodo
      // Embeddings) y hace KNN sobre bot.rag_catalogo.
      parameters: {
        mode: "retrieve-as-tool",
        toolName: "buscar_catalogo",
        toolDescription: toolDesc,
        // Schema-cualificado: el nodo NO aplica un schema aparte, así que la tabla va como
        // `bot.rag_catalogo` (si va solo `rag_catalogo`, consulta public y devuelve [] en verde).
        tableName: "bot.rag_catalogo",
        topK: 8,
        options: {
          // Nombres de columna = los del DDL (coinciden con los defaults del nodo).
          columnNames: {
            idColumnName: "id",
            vectorColumnName: "embedding",
            contentColumnName: "text",
            metadataColumnName: "metadata",
          },
        },
      },
      id: "rag-pgvector",
      name: "buscar_catalogo",
      type: "@n8n/n8n-nodes-langchain.vectorStorePGVector",
      typeVersion: 1.3,
      position: [500, 240],
      credentials: { postgres: BOT_DB },
    },
    {
      // Embeddings nativos de Google Gemini. MISMO modelo que la ingesta (gemini-embedding-001).
      // Requiere la credencial "Google Gemini(PaLM) API" con la API key de Google AI Studio.
      parameters: { modelName: "models/gemini-embedding-001" },
      id: "rag-embeddings",
      name: "Embeddings (Google Gemini)",
      type: "@n8n/n8n-nodes-langchain.embeddingsGoogleGemini",
      typeVersion: 1,
      position: [700, 420],
    },
    {
      // Output parser: fuerza al agente a devolver el objeto de auditoría (respuesta + decisión).
      // Convive con la tool buscar_catalogo (mismo patrón que el Agente Selector del v10).
      parameters: {
        schemaType: "manual",
        inputSchema: JSON.stringify(esquemaSalida, null, 2),
      },
      id: "rag-salida",
      name: "Salida · Agente",
      type: "@n8n/n8n-nodes-langchain.outputParserStructured",
      typeVersion: 1.2,
      position: [480, 420],
    },
    {
      // Segundo agente: audita la decisión del Agente principal contra el catálogo real.
      parameters: {
        promptType: "define",
        text:
          "=Pedido del cliente:\n{{ $('Cuando llega un mensaje').first().json.chatInput }}\n\n" +
          "Auditoría del bot (revisala):\n{{ JSON.stringify($json.output, null, 2) }}",
        hasOutputParser: true,
        options: { systemMessage: sistemaVerif },
      },
      id: "rag-verificador",
      name: "Agente Verificador",
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.9,
      position: [620, 0],
    },
    {
      parameters: { model: "google/gemini-3.1-flash-lite", options: { temperature: 0.1, maxTokens: 700 } },
      id: "rag-verif-modelo",
      name: "Modelo · Verificador",
      type: "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
      typeVersion: 1,
      position: [560, 620],
      credentials: { openRouterApi: OPENROUTER },
    },
    {
      parameters: {
        schemaType: "manual",
        inputSchema: JSON.stringify(esquemaVerif, null, 2),
      },
      id: "rag-verif-salida",
      name: "Salida · Verificador",
      type: "@n8n/n8n-nodes-langchain.outputParserStructured",
      typeVersion: 1.2,
      position: [740, 620],
    },
    {
      // Tool del Verificador: relee la fila REAL del catálogo (bot.rag_catalogo) por nombre.
      // Match acento-insensible sobre metadata->>'nombre_canonico' (mismo patrón que el v10).
      parameters: {
        descriptionType: "manual",
        toolDescription: toolDescVerif,
        operation: "executeQuery",
        query:
          "select metadata->>'nombre_canonico' as nombre,\n" +
          "       metadata->>'rubro'           as rubro,\n" +
          "       metadata->>'nicho'           as nicho,\n" +
          "       text\n" +
          "  from bot.rag_catalogo\n" +
          " where translate(lower(metadata->>'nombre_canonico'), $$áéíóúñ$$, $$aeioun$$)\n" +
          "       like $$%$$ || translate(lower($1), $$áéíóúñ$$, $$aeioun$$) || $$%$$\n" +
          " limit 5",
        options: {
          queryReplacement:
            "={{ $fromAI('producto', 'nombre del producto tal como lo reportó el agente, para releerlo del catálogo', 'string') }}",
        },
      },
      id: "rag-verif-tool",
      name: "consultar_catalogo_real",
      type: "n8n-nodes-base.postgresTool",
      typeVersion: 2.6,
      position: [920, 620],
      credentials: { postgres: BOT_DB },
    },
    {
      // Unifica en un solo item lo que las ramas de abajo necesitan: la respuesta + auditoría del
      // Agente (siempre ejecutó → ref segura) y el veredicto del Verificador (su input directo).
      parameters: {
        jsCode: [
          "const ag = $('Agente').first().json.output ?? {};",
          "const audit = (ag && typeof ag === 'object') ? ag : { respuesta: String(ag ?? '') };",
          "let ve = $input.first().json.output ?? $input.first().json ?? {};",
          "if (typeof ve === 'string') { try { ve = JSON.parse(ve); } catch (e) { ve = {}; } }",
          "const accion = ve.accion || (ve.aprobado === true ? 'aprobar' : 'corregir');",
          "return [{ json: {",
          "  respuesta: audit.respuesta ?? '',",
          "  auditoria: audit,",
          "  verificacion: ve,",
          "  accion,",
          "} }];",
        ].join("\n"),
      },
      id: "rag-leer-veredicto",
      name: "Leer Veredicto",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [900, 0],
    },
    {
      // Rutea según la acción que decidió el Verificador.
      parameters: {
        rules: {
          values: [
            {
              conditions: {
                options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
                combinator: "and",
                conditions: [
                  { leftValue: "={{ $json.accion }}", rightValue: "aprobar", operator: { type: "string", operation: "equals" } },
                ],
              },
              renameOutput: true,
              outputKey: "aprobar",
            },
            {
              conditions: {
                options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
                combinator: "and",
                conditions: [
                  { leftValue: "={{ $json.accion }}", rightValue: "regenerar", operator: { type: "string", operation: "equals" } },
                ],
              },
              renameOutput: true,
              outputKey: "regenerar",
            },
          ],
        },
        // Fallback = corregir (cualquier cosa que no sea aprobar/regenerar cae acá).
        options: { fallbackOutput: "extra", renameFallbackOutput: "corregir" },
      },
      id: "rag-switch-accion",
      name: "Ruteo Acción",
      type: "n8n-nodes-base.switch",
      typeVersion: 3.4,
      position: [1120, 0],
    },
    {
      // Loop-cap: $runIndex de ESTE nodo cuenta cuántas veces se pasó por acá en esta ejecución.
      // 0,1,2 → reintenta (3 regeneraciones máx); en la 4ª (índice 3) corta y manda a corregir.
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
          combinator: "and",
          conditions: [
            { leftValue: "={{ $runIndex }}", rightValue: 3, operator: { type: "number", operation: "lt" } },
          ],
        },
        options: {},
      },
      id: "rag-reintentar",
      name: "¿Reintentar? (máx 3)",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [1340, 120],
    },
    {
      // Arma el feedback y lo manda de vuelta al Agente principal como nuevo chatInput.
      // Lee de Leer Veredicto (siempre ejecutó en esta rama → ref segura).
      parameters: {
        jsCode: [
          "const lv = $('Leer Veredicto').first().json;",
          "const fallas = (lv.verificacion && lv.verificacion.fallas ? lv.verificacion.fallas : [])",
          "  .map(f => '- ' + f.tipo + (f.producto ? ' (' + f.producto + ')' : '') + ': ' + f.detalle).join('\\n');",
          "const feedback = [",
          "  'REVISIÓN INTERNA — el auditor observó tu respuesta anterior. Regenerala corrigiendo esto.',",
          "  '',",
          "  'Tu respuesta anterior:',",
          "  '\"\"\"' + (lv.respuesta || '') + '\"\"\"',",
          "  '',",
          "  'Problemas graves detectados:',",
          "  fallas,",
          "  '',",
          "  'Respondé de nuevo al cliente corrigiendo estos problemas. Usá buscar_catalogo si necesitás reconfirmar. No inventes ni ofrezcas lo que no se trabaja.',",
          "].join('\\n');",
          "return [{ json: { chatInput: feedback } }];",
        ].join("\n"),
      },
      id: "rag-feedback-reintento",
      name: "Feedback Reintento",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1560, 240],
    },
    {
      // Corrector: LLM sin tools que edita el mensaje según las fallas. Barato (una sola pasada).
      parameters: {
        promptType: "define",
        text:
          "=Mensaje original:\n\"\"\"{{ $json.respuesta }}\"\"\"\n\n" +
          "Observaciones del auditor a corregir:\n" +
          "{{ ($json.verificacion.fallas || []).map(f => '- ' + f.tipo + (f.producto ? ' (' + f.producto + ')' : '') + ': ' + f.detalle).join('\\n') }}",
        options: { systemMessage: sistemaCorrector },
      },
      id: "rag-corrector",
      name: "Corrector",
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.9,
      position: [1340, -160],
    },
    {
      parameters: { model: "google/gemini-3.1-flash-lite", options: { temperature: 0.2, maxTokens: 400 } },
      id: "rag-corrector-modelo",
      name: "Modelo · Corrector",
      type: "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
      typeVersion: 1,
      position: [1340, 40],
      credentials: { openRouterApi: OPENROUTER },
    },
    {
      // Reconstruye la forma canónica { respuesta(corregida), auditoria, verificacion } leyendo la
      // corrección ($input) + el contexto de Leer Veredicto (siempre ejecutó → ref segura).
      parameters: {
        jsCode: [
          "const raw = $input.first().json;",
          "const corr = raw.output ?? raw.text ?? '';",
          "const texto = (typeof corr === 'string' ? corr : (corr.respuesta ?? '')).trim();",
          "const lv = $('Leer Veredicto').first().json;",
          "return [{ json: {",
          "  respuesta: texto,",
          "  auditoria: lv.auditoria,",
          "  verificacion: lv.verificacion,",
          "  corregido: true,",
          "} }];",
        ].join("\n"),
      },
      id: "rag-aplicar-correccion",
      name: "Aplicar Corrección",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1560, -160],
    },
    {
      parameters: {
        content: [
          "## Bot RAG lite — agente + PGVector (nativo)",
          "",
          "Prueba interna (chat de test del Chat Trigger, sin Chatwoot/WhatsApp).",
          "",
          "El **Agente** tiene: Modelo de chat (OpenRouter), **Memoria** (10 turnos/sesión) y la tool **buscar_catalogo** = nodo **PGVector Vector Store** (modo *Retrieve as Tool*) con el sub-nodo **Embeddings Google Gemini**. El nodo embebe la consulta y hace la búsqueda — sin HTTP ni sub-workflow.",
          "",
          "**Flujo por etapas** (system prompt): saludo · pedido claro (usa la tool) · falta info→pregunta · seguimiento · otro. Guard de nicho blando (por prompt). Sin montos.",
          "",
          "**Salida estructurada** (nodo *Salida · Agente*): el agente devuelve JSON con `respuesta` (lo que ve el cliente) + auditoría: `productos_ofrecidos` (nombre_catalogo tal cual la búsqueda + nombre_mostrado + atributos de UNA fila + cantidad), `motivo` y `afirmaciones`.",
          "",
          "**Agente Verificador** (2º agente): audita contra el catálogo real con la tool **consultar_catalogo_real** (relee bot.rag_catalogo por nombre). Fallas: producto_inventado, fusion_variantes, no_trabajado (Regla 0, autoritativa: fotocopias…), dato_no_corroborable. Decide una **acción**: aprobar / corregir / regenerar.",
          "",
          "**Remediación** (Leer Veredicto → Ruteo Acción): aprobar→sale directo · corregir→**Corrector** (LLM barato que saca/reformula el texto sin re-buscar) · regenerar→(solo casos graves) vuelve al **Agente** con feedback y rehace, **loop máx 3** (¿Reintentar? corta por $runIndex; en el 4º intento cae a Corrector).",
          "",
          "**Preparar Respuesta** (punto único de convergencia): el chat muestra SOLO `respuesta`; `auditoria`, `verificacion` y `corregido` quedan en el item. Lee solo de su input (ref a nodo no ejecutado bloquea 300s).",
          "",
          "⚠️ VERIFICAR EN LA UI:",
          "1) Embeddings (Google Gemini): credencial **Google Gemini(PaLM) API** (API key de Google AI Studio), modelo models/gemini-embedding-001 (el MISMO que la ingesta). Chat + ambos agentes en OpenRouter; solo embeddings en Google.",
          "2) buscar_catalogo y consultar_catalogo_real: Table Name = bot.rag_catalogo (schema-cualificado). Requiere db/rag-embeddings.sql aplicado y la tabla poblada (scripts/rag-ingest.ts).",
        ].join("\n"),
        height: 560,
        width: 540,
      },
      id: "rag-nota",
      name: "Nota",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [0, -520],
    },
  ],
  connections: {
    "Cuando llega un mensaje": { main: [[{ node: "Agente", type: "main", index: 0 }]] },
    Agente: { main: [[{ node: "Agente Verificador", type: "main", index: 0 }]] },
    "Agente Verificador": { main: [[{ node: "Leer Veredicto", type: "main", index: 0 }]] },
    "Leer Veredicto": { main: [[{ node: "Ruteo Acción", type: "main", index: 0 }]] },
    // Switch: salida 0 = aprobar, 1 = regenerar, 2 (fallback) = corregir.
    "Ruteo Acción": {
      main: [
        [{ node: "Preparar Respuesta", type: "main", index: 0 }],
        [{ node: "¿Reintentar? (máx 3)", type: "main", index: 0 }],
        [{ node: "Corrector", type: "main", index: 0 }],
      ],
    },
    // Reintentar: true (0) = feedback→Agente; false (1) = se agota, cae a Corrector.
    "¿Reintentar? (máx 3)": {
      main: [
        [{ node: "Feedback Reintento", type: "main", index: 0 }],
        [{ node: "Corrector", type: "main", index: 0 }],
      ],
    },
    "Feedback Reintento": { main: [[{ node: "Agente", type: "main", index: 0 }]] },
    Corrector: { main: [[{ node: "Aplicar Corrección", type: "main", index: 0 }]] },
    "Aplicar Corrección": { main: [[{ node: "Preparar Respuesta", type: "main", index: 0 }]] },
    Modelo: { ai_languageModel: [[{ node: "Agente", type: "ai_languageModel", index: 0 }]] },
    Memoria: { ai_memory: [[{ node: "Agente", type: "ai_memory", index: 0 }]] },
    buscar_catalogo: { ai_tool: [[{ node: "Agente", type: "ai_tool", index: 0 }]] },
    "Embeddings (Google Gemini)": { ai_embedding: [[{ node: "buscar_catalogo", type: "ai_embedding", index: 0 }]] },
    "Salida · Agente": { ai_outputParser: [[{ node: "Agente", type: "ai_outputParser", index: 0 }]] },
    "Modelo · Verificador": { ai_languageModel: [[{ node: "Agente Verificador", type: "ai_languageModel", index: 0 }]] },
    "Salida · Verificador": { ai_outputParser: [[{ node: "Agente Verificador", type: "ai_outputParser", index: 0 }]] },
    consultar_catalogo_real: { ai_tool: [[{ node: "Agente Verificador", type: "ai_tool", index: 0 }]] },
    "Modelo · Corrector": { ai_languageModel: [[{ node: "Corrector", type: "ai_languageModel", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
};

const json = JSON.stringify(flow, null, 2);
JSON.parse(json);
writeFileSync(OUT_MAIN, json + "\n");
console.error(`OK: ${OUT_MAIN} (${flow.nodes.length} nodos)`);
