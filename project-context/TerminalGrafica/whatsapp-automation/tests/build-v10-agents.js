// BUILD v10-AGENTS -> faq-bot-v9-test.json
//
// EXPERIMENTO. No es la linea de v9 y no va a produccion tal cual esta.
//
// Reemplaza la cadena "un LLM decide todo + 2000 lineas de JS deterministico" por
// una CADENA DE AGENTES CON ROL, cada uno con tools reales contra la base, que se
// verifican mutuamente. La hipotesis a medir es si varios especialistas chicos, con
// acceso acotado a datos, resuelven mejor que un generalista con un prompt gigante.
//
//   node tests/build-v10-agents.js                  -> escribe faq-bot-v9-test.json
//   node tests/build-v10-agents.js --check          -> no escribe, verifica que este al dia
//   node tests/build-v10-agents.js --out <archivo>  -> escribe a otro lado
//
// DOS DECISIONES DE MARTIN QUE MANDAN SOBRE TODO EL DISENO (2026-07-29):
//
//   1. LOS MONTOS SON DETERMINISTICOS. Ningun agente tipea un numero. `Calcular
//      Montos` (Code) los deriva de las filas SQL y el compositor los recibe como
//      HECHOS CERRADOS que solo puede redactar. Esto conserva la leccion cara de
//      v8/v9: los 4 confident-wrong del 27 (1,42x / 1,25x / 1,76x / 100x en rifas)
//      y el 1,86x del 28 salieron todos de un LLM eligiendo un numero.
//
//   2. EL VERIFICADOR VE TODO. Es el unico agente que recibe a la vez el mensaje
//      que esta por salir Y el resultado CRUDO Y COMPLETO de la consulta a la base
//      (no un resumen, no los candidatos ya filtrados). Es el auditor final: puede
//      detectar que el selector se equivoco de producto, porque ve las filas que el
//      selector descarto.
//
// POR QUE LOS AGENTES SI PUEDEN TENER TOOLS ACA:
// La tool de Postgres es SELECT sobre `bot.*` con la credencial `Bot Readonly DB`.
// El agente elige QUE buscar (eso es lo que se quiere testear), pero no puede
// escribir, y el precio que se le muestra al cliente no sale de su boca.
const fs = require('fs');
const path = require('path');

const { aplicarTarget } = require('./target');

const DIR = path.join(__dirname, '..', 'n8n', 'flows');
const SRC = path.join(DIR, 'faq-bot-v9.json');
const CHECK = process.argv.includes('--check');
const argOut = process.argv.indexOf('--out');
const OUT = argOut !== -1
  ? path.resolve(process.argv[argOut + 1])
  : path.join(DIR, 'faq-bot-v9-test.json');

const MODELO = 'google/gemini-3.1-flash-lite';
const MODELO_FALLBACK = 'google/gemini-2.5-flash-lite';

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const srcNode = (name) => {
  const n = src.nodes.find((x) => x.name === name);
  if (!n) throw new Error('BUILD: no existe el nodo "' + name + '" en v9');
  return n;
};

const log = [];
const paso = (m) => log.push(m);

// ───────────────────────────────────────────────────────────────────────────
// PIEZAS QUE SE HEREDAN DE v9 TAL CUAL
//
// No se reescriben: son determinísticas, están testeadas y no es lo que el
// experimento quiere medir. Si además cambiaran, no sabríamos si un resultado
// distinto viene de los agentes o de haber tocado la plomería.
// ───────────────────────────────────────────────────────────────────────────
const HEREDADOS = [
  'Chatwoot Webhook',       // entrada
  'Verificar HMAC',         // seguridad
  'Filtro Ingreso',
  '¿Tiene Texto?',
  'Respuesta No-Texto',
  'Wait — Debounce',        // antiflood
  'Get Historial',
  'Decidir',                // dedupe + armado del sobre + conversation[]
  'Switch Ruteo',
  'Descartar (debounce/dup)',
  'Saludo Bienvenida',
  'Mensaje Anti-Injection',
  'Firewall Tier-1',        // jailbreak deterministico (SQL)
  'Switch Firewall',
  'Mensaje Firewall Refusal',
  'Aviso Rate Firewall',
  'Descartar Firewall (drop)',
  'OpenRouter Chat Model',  // modelo del guard Tier-2
  'Guardrails Tier-2',      // jailbreak semantico
  'Router Fail Tier-2',
  '¿Violación Real Tier-2?',
  'Strike Tier-2',
  'Switch Strike Tier-2',
  'Mensaje Refusal Tier-2',
  'Silencio Tier-2',
  'Buscar Candidatos',      // SQL IDF: la busqueda buena, se conserva
  'Extraer Palabras',
  'Enviar Mensaje',
  'Log Turno',
  'Label Escalación',
  'Mensaje Escalación',
  'Log Escalación',
  // rama `cap` del Switch Ruteo (salida 4): el tope de 25 respuestas/24h. Sin
  // estos dos la salida queda sin cablear y la conversacion muere muda.
  'Mensaje Cap Email',
  'Label Cap',
];
// NO se heredan, a proposito:
//   - Chequear/Guardar Cache Catálogo, Get Catálogo, ¿Cache Fresco?, Refrescar
//     Catálogo, Purgar Cache: v9 mete el catalogo ENTERO en el prompt y por eso
//     necesita cachearlo. Aca el Agente Selector consulta la base por tool, asi
//     que no hay catalogo que cachear. Es la simplificacion mas grande del
//     experimento — y tambien lo que hay que medir: si el agente explora peor
//     que tener todo el catalogo a la vista, se ve en la suite.
//   - Mensaje Anti-Injection y Log Silencio: colgaban de ramas de v9 que aca no
//     existen. Se re-agregan si el experimento los necesita.

const wf = {
  name: 'faq-bot-v10-agents',
  nodes: [],
  connections: {},
  active: false,
  settings: src.settings || { executionOrder: 'v1' },
  pinData: {},
  meta: src.meta || {},
};

for (const nombre of HEREDADOS) {
  wf.nodes.push(JSON.parse(JSON.stringify(srcNode(nombre))));
}
paso('heredados de v9: ' + HEREDADOS.length + ' nodos (plomeria, firewall, busqueda SQL)');

// ═══ EL ENVIO SE REINTENTA (Martin, 2026-07-29: caso real) ═══
//
// Chatwoot devolvio "Service temporarily unavailable" y el cliente NUNCA recibio
// la respuesta. El mensaje estaba bien generado y verificado; se perdio en el
// ultimo metro, y Martin lo tuvo que reenviar a mano.
//
// Dos problemas distintos, los dos en este nodo:
//
//  1. NO REINTENTABA. Un 503 de Chatwoot es transitorio (contenedor reiniciando,
//     Rails saturado): el segundo intento casi siempre pasa. Se le ponen 3
//     intentos con 3s de espera.
//
//     Es seguro reintentar: un 503 significa que Chatwoot no proceso nada, asi
//     que no hay mensaje a medio crear que se pueda duplicar.
//
//  2. EL FALLO SE VEIA COMO EXITO. \`onError: continueRegularOutput\` (que se
//     CONSERVA a proposito, ver abajo) hace que el flujo siga como si nada:
//     Log Turno escribia \`final\` con el mensaje y la base afirmaba que el
//     cliente lo habia recibido. El log mentia, que es peor que el error — te
//     ciega justo para diagnosticarlo. Eso lo arregla 'Chequear Envio' (parte 2).
//
// POR QUE NO SE QUITA EL onError: si el nodo tira error, el flujo se corta y no
// se loguea NADA. Quedaria sin mensaje Y sin rastro: peor que ahora.
const nodoEnvio = wf.nodes.find((n) => n.name === 'Enviar Mensaje');
if (!nodoEnvio) throw new Error('Enviar Mensaje no se heredo: el fix del 503 no se aplico');
nodoEnvio.retryOnFail = true;
nodoEnvio.maxTries = 3;
nodoEnvio.waitBetweenTries = 3000;
// hace falta para poder LEER la respuesta de Chatwoot en el nodo siguiente: sin
// esto, un fallo no deja item y el chequeo no tiene con que trabajar.
nodoEnvio.alwaysOutputData = true;
paso('Enviar Mensaje: 3 reintentos + alwaysOutputData (503 de Chatwoot, 2026-07-29)');

const CRED_PG = srcNode('Buscar Candidatos').credentials.postgres;
const CRED_OR = srcNode('OpenRouter Chat Model').credentials.openRouterApi;

// ───────────────────────────────────────────────────────────────────────────
// HELPERS DE CONSTRUCCION
// ───────────────────────────────────────────────────────────────────────────
let _y = 0;
const pos = (x, y) => [x, y != null ? y : (_y += 180)];

const add = (n) => { wf.nodes.push(n); return n; };

// El indice de salida es POSICIONAL y absoluto: connections[nodo].main[i] es la
// salida i del nodo, se haya cableado o no la i-1. Los huecos quedan como [].
//
// Esto costo caro (2026-07-29): antes esto rellenaba con `while (length <= salida)
// push([])` y despues hacia push en el indice pedido — pero como el cableado se
// recorre en orden de lista, una salida que se declaraba DESPUES ocupaba el hueco
// de la anterior. `Switch Firewall` quedo corrido un lugar entero: la salida `pass`
// (mensaje legitimo) apuntaba a `Mensaje Firewall Refusal`, o sea que TODO cliente
// normal recibia la negativa y nunca llegaba al bot. Ahora el indice se respeta
// literal y `validarSwitches()` (parte 2) compara contra las reglas declaradas.
const conectar = (desde, hacia, tipo = 'main', salida = 0) => {
  wf.connections[desde] = wf.connections[desde] || {};
  const arr = (wf.connections[desde][tipo] = wf.connections[desde][tipo] || []);
  while (arr.length <= salida) arr.push([]);
  arr[salida].push({ node: hacia, type: tipo, index: 0 });
};

// Un agente = 3 nodos (agent + modelo + parser) + sus tools.
// El parser estructurado es OBLIGATORIO en todos: sin el, la salida del agente es
// prosa libre y el nodo siguiente tiene que parsear texto — que es exactamente el
// tipo de acoplamiento fragil que rompio a v7.
const agente = (nombre, systemMessage, schema, x, y) => {
  const A = add({
    parameters: {
      promptType: 'define',
      text: '={{ $json.promptAgente }}',
      hasOutputParser: true,
      options: { systemMessage, maxIterations: 5, returnIntermediateSteps: true },
    },
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.9,
    position: pos(x, y),
    name: nombre,
    onError: 'continueRegularOutput',
  });
  const M = add({
    parameters: {
      model: MODELO,
      options: { temperature: 0.1, maxTokens: 900, responseFormat: 'json_object' },
    },
    type: '@n8n/n8n-nodes-langchain.lmChatOpenRouter',
    typeVersion: 1,
    position: pos(x - 40, (y || _y) + 200),
    name: 'Modelo · ' + nombre,
    credentials: { openRouterApi: CRED_OR },
  });
  const P = add({
    parameters: { schemaType: 'manual', inputSchema: JSON.stringify(schema, null, 2) },
    type: '@n8n/n8n-nodes-langchain.outputParserStructured',
    typeVersion: 1.2,
    position: pos(x + 120, (y || _y) + 200),
    name: 'Salida · ' + nombre,
  });
  conectar(M.name, nombre, 'ai_languageModel');
  conectar(P.name, nombre, 'ai_outputParser');
  return A;
};

// Tool de Postgres: SELECT parametrizado por $fromAI. El SQL lo fija el build; lo
// unico que decide el agente son los VALORES. Esa es la linea: el agente elige que
// preguntar, no como consultar la base.
const toolPg = (nombre, descripcion, query, agenteDestino, x, y) => {
  const T = add({
    parameters: {
      descriptionType: 'manual',
      toolDescription: descripcion,
      operation: 'executeQuery',
      query,
      options: {},
    },
    type: 'n8n-nodes-base.postgresTool',
    typeVersion: 2.6,
    position: pos(x, y),
    name: nombre,
    credentials: { postgres: CRED_PG },
    onError: 'continueRegularOutput',
  });
  conectar(nombre, agenteDestino, 'ai_tool');
  return T;
};

// ═══════════════════════════════════════════════════════════════════════════
// AGENTE 1 · INTENCION
//
// Clasifica y NADA MAS. No responde, no cotiza, no elige producto. Tiene una sola
// tool (info del negocio) porque la rama informativa muere aca mismo: preguntar
// "hasta que hora abren" no tiene por que atravesar la cadena de precio entera.
// ═══════════════════════════════════════════════════════════════════════════
const A1 = agente(
  'Agente Intención',
  [
    'Sos el clasificador de entrada de una imprenta argentina (Terminal Gráfica).',
    'Tu UNICA salida es una clasificacion. NO redactas la respuesta al cliente,',
    'NO decis precios, NO elegis productos.',
    '',
    'Clasifica el ultimo mensaje del cliente en una de estas intenciones:',
    '  precio      - pide o negocia un precio, cantidades, "cuanto sale", "me haces X"',
    '  info        - horarios, direccion, formas de pago, plazos, envios, contacto',
    '  producto    - pregunta si HACEN algo, sin pedir precio todavia',
    '  seguimiento - contesta a algo que el bot ya le pregunto (elige una opcion, da una cantidad)',
    '  otro        - saludo suelto, agradecimiento, off-topic',
    '',
    'Para `info` USA la tool consultar_info_negocio y devolve la respuesta textual',
    'en `respuestaInfo`. Si la tool no trae nada, dejala vacia: NO inventes horarios,',
    'direcciones ni plazos. Un dato inventado sobre el negocio es peor que no responder.',
    '',
    'Respondes SIEMPRE en JSON con el esquema pedido.',
  ].join('\n'),
  {
    type: 'object',
    required: ['intencion', 'confianza'],
    properties: {
      intencion: { type: 'string', enum: ['precio', 'info', 'producto', 'seguimiento', 'otro'] },
      confianza: { type: 'number', description: '0 a 1' },
      respuestaInfo: { type: 'string', description: 'solo si intencion=info y la tool trajo el dato; si no, vacio' },
      motivo: { type: 'string' },
    },
  },
  -600, 0
);

toolPg(
  'consultar_info_negocio',
  'Devuelve datos operativos del negocio: horarios, direccion, formas de pago, plazos de entrega, envios. Usala cuando el cliente pregunta por como funciona el negocio y NO por el precio de un producto.',
  "select clave, valor from bot.info_negocio where clave ilike '%' || $1 || '%' or $1 = '' limit 12",
  'Agente Intención',
  -900, 260
);
// El $fromAI va en los parametros de la query, no en el SQL: el texto del cliente
// nunca se concatena al SQL.
wf.nodes.find((n) => n.name === 'consultar_info_negocio').parameters.options = {
  queryReplacement: "={{ $fromAI('tema', 'tema consultado: horario, direccion, pago, plazo, envio', 'string', '') }}",
};
paso('A1 Intención + tool consultar_info_negocio');

// ═══════════════════════════════════════════════════════════════════════════
// AGENTE 2 · SELECTOR DE PRODUCTO
//
// Traduce el pedido en lenguaje natural a terminos de busqueda. Es el reemplazo
// del par "LLM Respuesta -> Extraer Palabras" de v9.
//
// Su tool NO es la busqueda final: es una exploracion del catalogo por nombre. La
// busqueda posta (IDF, con los guards de nicho) la sigue corriendo el nodo SQL
// deterministico `Buscar Candidatos`, aguas abajo. Si el agente pudiera hacer la
// busqueda final, se saltearia los guards de negocio que costaron 3 rondas.
// ═══════════════════════════════════════════════════════════════════════════
const A2 = agente(
  'Agente Selector',
  [
    'Sos el especialista en catalogo de una imprenta argentina (Terminal Gráfica).',
    'Tu trabajo es traducir el pedido del cliente a TERMINOS DE BUSQUEDA del catalogo.',
    '',
    'NO decis precios. NO elegis la variante final. NO redactas nada para el cliente.',
    '',
    'Usa la tool explorar_catalogo para ver como se llaman realmente los productos',
    'antes de decidir. El cliente dice "tarjetas", el catalogo puede decir',
    '"Tarjetas personales 9x5". Tu salida tiene que usar las palabras del CATALOGO.',
    '',
    'Devolve en `terminos` las palabras que mejor identifican el producto (2 a 6).',
    'Devolve en `cantidad` el numero que pidio el cliente si lo dijo, o null.',
    'Si el pedido menciona VARIOS productos distintos, listalos en `productos`.',
    'Si no entendes que producto es, dejalo vacio y poné `necesitaAclaracion: true`',
    'con la pregunta corta que haria falta. Preferir preguntar antes que adivinar.',
  ].join('\n'),
  {
    type: 'object',
    required: ['terminos'],
    properties: {
      terminos: { type: 'array', items: { type: 'string' } },
      productos: { type: 'array', items: { type: 'string' } },
      cantidad: { type: ['number', 'null'] },
      necesitaAclaracion: { type: 'boolean' },
      pregunta: { type: 'string' },
      motivo: { type: 'string' },
    },
  },
  -200, 0
);

toolPg(
  'explorar_catalogo',
  'Busca productos del catalogo por nombre o sinonimo aproximado y devuelve como se llaman canonicamente, su rubro y su rango de precios. Usala para descubrir el nombre real de lo que pide el cliente. NO devuelve el precio final a cotizar.',
  [
    'select t.nombre_canonico, t.categoria,',
    "       array_to_string(t.sinonimos, ', ') as sinonimos,",
    '       count(v.variante_id) as n_variantes,',
    '       min(v.precio_lista) filter (where v.precio_lista > 0) as desde,',
    '       max(v.precio_lista) as hasta',
    '  from bot.taxonomia t',
    '  left join bot.variantes v on v.producto_id = t.producto_id',
    ' where translate(lower(t.nombre_canonico), $$áéíóúñ$$, $$aeioun$$) like $$%$$ || translate(lower($1), $$áéíóúñ$$, $$aeioun$$) || $$%$$',
    '    or exists (select 1 from unnest(t.sinonimos) s',
    '                where translate(lower(s), $$áéíóúñ$$, $$aeioun$$) like $$%$$ || translate(lower($1), $$áéíóúñ$$, $$aeioun$$) || $$%$$)',
    ' group by t.nombre_canonico, t.categoria, t.sinonimos',
    ' limit 15',
  ].join('\n'),
  'Agente Selector',
  -500, 260
);
wf.nodes.find((n) => n.name === 'explorar_catalogo').parameters.options = {
  queryReplacement: "={{ $fromAI('termino', 'una palabra del producto a buscar en el catalogo', 'string') }}",
};
paso('A2 Selector + tool explorar_catalogo');

// ═══════════════════════════════════════════════════════════════════════════
// AGENTE 3 · RELEVANCIA
//
// Recibe TODOS los candidatos que devolvio la busqueda SQL, con sus precios y
// reglas, y decide cuales contestan de verdad lo que el cliente pidio. Es el que
// pone confidenceScore.
//
// No tiene tools a proposito: su insumo es exactamente el resultado de la busqueda,
// y darle otra puerta a la base lo dejaria "buscar de nuevo" hasta encontrar algo
// que le guste — que es como se fabrica un confident-wrong.
// ═══════════════════════════════════════════════════════════════════════════
const A3 = agente(
  'Agente Relevancia',
  [
    'Sos el filtro de relevancia de una imprenta argentina (Terminal Gráfica).',
    '',
    'Recibis: el pedido del cliente y una LISTA CERRADA de candidatos del catalogo,',
    'cada uno con su id, nombre, variante, precio y reglas.',
    '',
    'Elegis cuales de esos candidatos contestan lo que el cliente pidio.',
    '',
    'REGLAS DURAS:',
    '  - Solo podes elegir candidatos de la lista, por su `idx`. NO inventes productos.',
    '  - NO copies ni escribas precios. Los montos los calcula otro proceso.',
    '  - Si hay varios que son la MISMA cosa en distinta medida o color, elegilos a',
    '    todos: el cliente tiene que poder comparar.',
    '',
    'ELEGI SIEMPRE QUE PUEDAS. Devolver la lista vacia manda al cliente a escribir',
    'un mail, asi que es la peor respuesta posible cuando habia algo razonable.',
    'Solo devolve vacio si NINGUN candidato tiene que ver con lo que se pidio.',
    '',
    'CUANDO EL CLIENTE ESPECIFICA UN EJE (doble faz, color, un tamaño, un gramaje):',
    '  - Si hay un candidato que coincide con ese eje, elegí ESE.',
    '  - Si NINGUNO coincide exactamente, elegí igual los del mismo producto: el',
    '    cliente prefiere ver las opciones que existen antes que un mail.',
    '  - NUNCA devuelvas vacio solo porque falta la variante exacta que pidio.',
    '',
    'LA CANTIDAD NO SE USA PARA ELEGIR. Si pide "200 paginas", eso es cuanto va a',
    'encargar, no un filtro del producto. Elegí por el PRODUCTO y el EJE.',
    '',
    'CONFIANZA: 0..1, cuan seguro estas de que ese candidato es lo que pidieron.',
    '  - coincide producto y eje -> 0.9',
    '  - coincide el producto, el eje no esta claro -> 0.7',
    '  - es del mismo producto pero otra variante -> 0.5',
    '  Si no la sabes, no pongas el campo: se asume que elegiste con criterio.',
    '  No uses valores bajos para "ser prudente" — un valor bajo NO abre una',
    '  revision humana, mata la respuesta.',
    '',
    '  - Si el cliente pidio algo de un nicho especifico (ej: medicina) y los',
    '    candidatos son genericos, marcá `dudaNicho: true` (sin bajar la confianza).',
  ].join('\n'),
  {
    type: 'object',
    required: ['elegidos'],
    properties: {
      elegidos: {
        type: 'array',
        items: {
          type: 'object',
          required: ['idx', 'confianza'],
          properties: {
            idx: { type: 'number', description: 'el idx del candidato en la lista recibida' },
            confianza: { type: 'number' },
            porque: { type: 'string' },
          },
        },
      },
      dudaNicho: { type: 'boolean' },
      motivo: { type: 'string' },
    },
  },
  600, 0
);
paso('A3 Relevancia (sin tools: lista cerrada)');

// ═══════════════════════════════════════════════════════════════════════════
// AGENTE 4 · COMPOSITOR
//
// Redacta. Recibe los montos YA CALCULADOS por `Calcular Montos` y su unico
// trabajo es ponerlos en castellano rioplatense.
//
// DECISION DE MARTIN: el compositor NO tipea numeros. Recibe `hechos[]` con el
// texto exacto de cada monto y tiene que reproducirlo caracter por caracter.
// ═══════════════════════════════════════════════════════════════════════════
const A4 = agente(
  'Agente Compositor',
  [
    'Escribis los mensajes de WhatsApp de una imprenta argentina (Terminal Gráfica).',
    '',
    'Recibis HECHOS ya verificados. Tu trabajo es redactarlos, no calcularlos.',
    '',
    'REGLA ABSOLUTA SOBRE LOS NUMEROS:',
    '  Cada hecho trae un campo `texto` con el monto ya formateado.',
    '  Lo copias EXACTO, caracter por caracter. No lo redondeas, no lo sumas,',
    '  no lo multiplicas por la cantidad, no estimas.',
    '',
    'COTIZAS TOTALES, PERO NO LOS CALCULAS.',
    '  Cuando un hecho trae "TOTAL YA CALCULADO", ese total esta autorizado:',
    '  decilo, es lo que el cliente vino a buscar. Copialo tal cual.',
    '  Cuando NO lo trae, es porque ese producto no se puede totalizar asi.',
    '  Deci el precio unitario y que el total se confirma por mail — pero NUNCA',
    '  lo multiplicas vos, ni "a modo de referencia". Un total que no vino en',
    '  los hechos esta mal aunque la cuenta te de bien.',
    '',
    'VOZ:',
    '  - Castellano rioplatense, vos (no tu). Cordial y directo.',
    '  - Corto: es WhatsApp. 2 a 5 lineas. Sin saludos largos ni firmas.',
    '  - Sin emojis salvo que el cliente use.',
    '  - No prometas plazos, stock ni descuentos que no esten en los hechos.',
    '  - Si hay varias opciones, listalas cortito para que pueda elegir.',
    '',
    'NUNCA TOMAS UN PEDIDO (decision de Martin 2026-07-29).',
    '  Este canal INFORMA. El pedido se hace por mail o en el local.',
    '  No preguntes "¿querés que avancemos?", no digas "tomo el pedido", no',
    '  confirmes nada como si lo hubieras registrado: no hay donde registrarlo.',
    '  Si el cliente quiere avanzar, lo mandas a terminalgrafica@gmail.com o al',
    '  local. Prometer que tomaste un pedido que nadie recibio es peor que no',
    '  contestar.',
    '',
    'NO PIDAS ARCHIVOS. No podemos recibirlos ni procesarlos por este canal.',
    '  Nada de "pasame el archivo", "mandame el diseño", "envianos el PDF".',
    '  El archivo va por mail o se lleva al local.',
    '',
    'NO INVENTES POR QUE FALTA UN DATO. Si el total no se puede dar, decis que',
    '  se confirma por mail y listo. NO expliques la causa ("hay recargos",',
    '  "depende de otros factores del trabajo", "segun el material"): esas',
    '  razones no estan en los hechos y suenan a letra chica que nadie te dio.',
    '',
    'SI EL PEDIDO TRAE UN BLOQUE "SEGUNDO INTENTO":',
    '  Un auditor rechazo tu mensaje anterior y te dice por que. Corregí ESO',
    '  puntualmente — no reescribas de cero ni cambies de tema.',
    '  Los montos NO se tocan: son los mismos hechos autorizados de siempre.',
    '  Si el reclamo fue que no contestabas la pregunta, contestala derecho y',
    '  primero, antes de cualquier aclaracion.',
  ].join('\n'),
  {
    type: 'object',
    required: ['mensaje'],
    properties: {
      mensaje: { type: 'string', description: 'el texto tal cual va a WhatsApp' },
      usoTodosLosHechos: { type: 'boolean' },
      motivo: { type: 'string' },
    },
  },
  1400, 0
);
paso('A4 Compositor (montos como hechos cerrados)');

// ═══════════════════════════════════════════════════════════════════════════
// AGENTE 5 · VERIFICADOR
//
// DECISION DE MARTIN: este es el que VE TODO. Recibe:
//   - el mensaje que esta por salir
//   - el pedido original del cliente
//   - los hechos deterministicos
//   - Y EL RESULTADO CRUDO COMPLETO DE LA CONSULTA A LA BASE (todas las filas,
//     incluidas las que el selector descarto)
//
// Por eso puede detectar la clase de error que ningun otro nodo ve: que el
// producto elegido no era el que el cliente pidio, porque tiene enfrente la fila
// que si correspondia. Ademas tiene una tool para releer la base por su cuenta.
// ═══════════════════════════════════════════════════════════════════════════
const A5 = agente(
  'Agente Verificador',
  [
    'Sos el auditor final de una imprenta argentina (Terminal Gráfica). Nada sale',
    'al cliente sin tu visto bueno.',
    '',
    'Recibis CUATRO cosas:',
    '  1. El mensaje que esta por enviarse.',
    '  2. Lo que el cliente pidio realmente (toda la conversacion).',
    '  3. Los hechos deterministicos con los montos autorizados.',
    '  4. EL RESULTADO CRUDO Y COMPLETO de la consulta a la base: TODAS las filas',
    '     que la busqueda devolvio, incluidas las que se descartaron.',
    '',
    'Tenes la tool verificar_en_base para releer el catalogo por tu cuenta si algo',
    'no te cierra. Usala cuando sospeches que se eligio el producto equivocado.',
    '',
    'RECHAZAS el mensaje si:',
    '  a) Tiene un numero que NO figura en los hechos autorizados. Esto es lo mas',
    '     grave que podes encontrar: significa que se invento un precio.',
    '  b) El producto del que habla no es el que el cliente pidio, y en las filas',
    '     crudas se ve uno que si correspondia.',
    '  c) Afirma algo del negocio (plazo, stock, envio, descuento) que no esta en',
    '     los hechos.',
    '  d) No contesta la pregunta que el cliente hizo.',
    '',
    'Ante la duda RECHAZAS: derivar a un humano es barato, un precio mal dicho no.',
    '',
    'Si rechazas, en `queFalta` explicas en una linea que le tiene que llegar al',
    'humano que va a atender.',
    '',
    '═══ PODES CORREGIR EL MENSAJE (decision de Martin 2026-07-29) ═══',
    '',
    'Si el problema se arregla SACANDO o REESCRIBIENDO texto, y los montos ya',
    'estan bien, devolve el mensaje corregido en `mensajeCorregido` con',
    '`aprobado: true`. Sale ESE en vez del original.',
    '',
    'CORREGIS vos (no rechaces) cuando:',
    '  - Ofrece tomar un pedido o dice que lo tomo. Este canal informa; el pedido',
    '    va por mail o al local. Sacá esa parte.',
    '  - Pide un archivo ("pasame el PDF"): no los podemos recibir por acá.',
    '  - Explica por que falta un dato ("hay recargos", "depende del trabajo").',
    '    Dejá que el total se confirma por mail, sin la explicacion.',
    '  - Sobra una frase de relleno o una promesa que nadie autorizo.',
    '',
    'RECHAZAS igual (sin corregir) cuando el problema es de FONDO: el producto',
    'esta equivocado, no contesta lo que preguntaron, o hay un monto mal. Eso no',
    'se arregla editando el texto.',
    '',
    'NUNCA BORRES UNA OFERTA POR CANTIDAD (Martin, 2026-07-29).',
    'Cuando un hecho dice "llevando N o mas", ese es un precio mejor que existe de',
    'verdad y que el cliente tiene derecho a conocer, aunque haya pedido menos.',
    'Ejemplo real que salio mal: el cliente dijo que era de una inmobiliaria y pidio',
    '3 carteles. El mensaje traia el suelto ($19.500 c/u) Y la promo ($15.000 c/u',
    'llevando 6). Se borro la promo por "innecesaria" y el cliente se fue sin saber',
    'que existia. NO es relleno: es la razon de ser de ese producto.',
    'Lo mismo con cualquier alternativa mas barata o pack mas grande que figure en',
    'los hechos. Podes acortar como esta redactada; el dato tiene que quedar.',
    '',
    'REGLA ABSOLUTA AL CORREGIR: los montos del mensaje corregido tienen que ser',
    'EXACTAMENTE los de los hechos autorizados. No agregues ni cambies un solo',
    'numero. Un monto tuyo que no este en la lista tumba el mensaje entero — el',
    'chequeo automatico corre igual sobre tu correccion.',
    'Tampoco cambies de producto ni agregues informacion nueva: sacas o reescribis',
    'lo que ya estaba, nada mas.',
  ].join('\n'),
  {
    type: 'object',
    required: ['aprobado', 'motivo'],
    properties: {
      aprobado: { type: 'boolean' },
      motivo: { type: 'string' },
      falla: {
        type: 'string',
        enum: ['ninguna', 'precio_inventado', 'producto_equivocado', 'dato_inventado', 'no_contesta', 'otra'],
      },
      queFalta: { type: 'string' },
      // el mensaje ya corregido. Vacio = no hizo falta tocarlo.
      mensajeCorregido: {
        type: 'string',
        description: 'el mensaje corregido, listo para enviar; vacio si el original estaba bien',
      },
      queCorregi: { type: 'string', description: 'que le sacaste o cambiaste, en una linea' },
      confianza: { type: 'number' },
    },
  },
  2200, 0
);

toolPg(
  'verificar_en_base',
  'Relee el catalogo real para confirmar que un producto y su precio existen tal como se estan por informar. Usala cuando dudes de que el producto elegido sea el que el cliente pidio.',
  [
    'select t.nombre_canonico, t.categoria, v.variante, v.precio_lista, v.unidad,',
    '       v.mostrable, v.solo_descuentos, v.por_pagina, v.por_pack',
    '  from bot.taxonomia t',
    '  join bot.variantes v on v.producto_id = t.producto_id',
    ' where translate(lower(t.nombre_canonico), $$áéíóúñ$$, $$aeioun$$) like $$%$$ || translate(lower($1), $$áéíóúñ$$, $$aeioun$$) || $$%$$',
    ' order by v.precio_lista asc nulls last',
    ' limit 20',
  ].join('\n'),
  'Agente Verificador',
  1900, 260
);
wf.nodes.find((n) => n.name === 'verificar_en_base').parameters.options = {
  queryReplacement: "={{ $fromAI('producto', 'nombre del producto a verificar contra el catalogo', 'string') }}",
};
paso('A5 Verificador + tool verificar_en_base (ve las filas crudas)');

module.exports = { wf, add, conectar, agente, toolPg, paso, log, CHECK, OUT, SRC, srcNode, MODELO, MODELO_FALLBACK, aplicarTarget, pos };

// El resto (nodos Code puente, cableado y escritura) vive en build-v10-agents-parte2.js
// y se carga aca abajo para mantener cada archivo legible.
require('./build-v10-agents-parte2.js');
