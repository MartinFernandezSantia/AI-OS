// VALIDACION DEL EXPERIMENTO v10-AGENTS
//
// No compara contra v9 (es otra arquitectura a proposito). Chequea los INVARIANTES
// del diseno — las cosas que, si se rompen, convierten el experimento en el bug
// que ya pagamos caro en v8/v9.
//
//   node tests/validate-v10-agents.js
//   WF=faq-bot-v9-test.json node tests/validate-v10-agents.js
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'n8n', 'flows');
const ARCHIVO = process.env.WF || 'faq-bot-v9-test.json';
const wf = JSON.parse(fs.readFileSync(path.join(DIR, ARCHIVO), 'utf8'));

let err = 0;
let ok = 0;
const E = (m) => { err++; console.log('  ERROR  ' + m); };
const OK = (m) => { ok++; console.log('  ok     ' + m); };

const N = (nombre) => wf.nodes.find((n) => n.name === nombre);
const porTipo = (t) => wf.nodes.filter((n) => n.type.endsWith(t));

console.log('=== validando ' + ARCHIVO + ' (' + wf.nodes.length + ' nodos) ===\n');

// ───────────────────────────────────────────────────────────────────────────
console.log('1. INVARIANTE DE PLATA — ningun agente produce montos');
// ───────────────────────────────────────────────────────────────────────────
const calc = N('Calcular Montos');
if (!calc) E('falta "Calcular Montos": sin el, nadie produce los montos de forma deterministica');
else {
  const js = calc.parameters.jsCode;
  if (!/precioLista|precio_lista/.test(js)) E('Calcular Montos no lee precio_lista de la fila SQL');
  else OK('Calcular Montos deriva los montos de precio_lista (SQL)');
  if (!/montosAutorizados/.test(js)) E('Calcular Montos no emite montosAutorizados');
  else OK('emite montosAutorizados para el chequeo posterior');
  // EL TOTAL YA NO ESTA PROHIBIDO — pero sigue siendo del CODIGO, nunca del LLM.
  //
  // v9.2 (2026-07-28) prohibia multiplicar: precio_lista es el BASE y hay recargo
  // UV, asi que un total sub-cotizaba. Martin lo reemplazo el 2026-07-29: se
  // cotiza cerrado SOLO donde no hay recargo posible (ver seccion 8e, que
  // verifica las tres condiciones). Lo que NO cambio: quien multiplica.
  if (!/monto \* cantidad/.test(js)) E('Calcular Montos ya no calcula el total (deberia: decision 2026-07-29)');
  else OK('el total lo produce el codigo (no el LLM), con sus tres guards');
}

// El compositor tiene que recibir la orden explicita de no calcular.
const comp = N('Agente Compositor');
if (!comp) E('falta el Agente Compositor');
else {
  const sys = comp.parameters.options.systemMessage || '';
  if (!/copias EXACTO|copiá los montos EXACTO|EXACTO/i.test(sys)) E('el compositor no tiene la regla de copiar montos exacto');
  else OK('el compositor tiene prohibido calcular montos');
  // Desde el 2026-07-29 el compositor SI puede decir totales — los que le llegan
  // ya calculados. Lo que sigue prohibido es que los saque el.
  if (!/lo multiplicas vos/i.test(sys)) E('el compositor no tiene prohibido multiplicar por su cuenta');
  else OK('el compositor copia los totales, no los calcula');
}

// El guard deterministico posterior: numeros del texto vs autorizados.
const pv = N('Prompt Verificador');
if (!pv) E('falta Prompt Verificador');
else {
  const js = pv.parameters.jsCode;
  if (!/numerosNoAutorizados|noAutorizados/.test(js)) E('no hay chequeo deterministico de montos en el texto');
  else OK('extrae los montos del borrador y los compara con los autorizados');
}

const lv = N('Leer Verificador');
if (!lv) E('falta Leer Verificador');
else {
  const js = lv.parameters.jsCode;
  // El guard tiene que MANDAR sobre el LLM: un agente no puede aprobar un monto
  // que el calculo deterministico no produjo.
  if (!/montoInventado\s*&&|&&\s*!montoInventado/.test(js)) {
    E('el guard de monto inventado no invalida la aprobacion del LLM');
  } else OK('el guard deterministico manda sobre el veredicto del agente');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n2. INVARIANTE DE TOOLS — solo lectura, SQL fijo');
// ───────────────────────────────────────────────────────────────────────────
const tools = porTipo('postgresTool');
if (!tools.length) E('no hay ninguna tool de Postgres: el experimento pierde sentido');
for (const t of tools) {
  const q = String(t.parameters.query || '');
  if (!/^\s*select/i.test(q)) E('tool "' + t.name + '": no empieza con SELECT');
  else if (/\b(insert|update|delete|drop|alter|truncate|grant|revoke)\b/i.test(q)) {
    E('tool "' + t.name + '": tiene una sentencia de escritura');
  } else OK('tool "' + t.name + '": SELECT de solo lectura');

  // El SQL lo fija el build; el agente solo aporta VALORES via queryReplacement.
  const repl = (t.parameters.options || {}).queryReplacement || '';
  if (!/\$fromAI/.test(repl)) E('tool "' + t.name + '": no usa $fromAI en queryReplacement');
  else if (/\$fromAI/.test(q)) E('tool "' + t.name + '": $fromAI dentro del SQL (inyeccion)');
  else OK('tool "' + t.name + '": el agente aporta valores, no SQL');

  if (!t.credentials || !t.credentials.postgres) E('tool "' + t.name + '": sin credencial de Postgres');
}
// La credencial tiene que ser la de solo lectura.
const credsPg = new Set(wf.nodes.filter((n) => n.credentials && n.credentials.postgres)
  .map((n) => n.credentials.postgres.name));
if ([...credsPg].some((c) => !/readonly/i.test(c))) {
  console.log('  aviso  credencial de Postgres no marcada readonly: ' + [...credsPg].join(', '));
} else OK('todas las tools usan la credencial readonly');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n3. INVARIANTE DE AGENTES — modelo + parser + salida cerrada');
// ───────────────────────────────────────────────────────────────────────────
const agentes = porTipo('langchain.agent');
console.log('  agentes: ' + agentes.map((a) => a.name).join(', '));
if (agentes.length < 5) E('esperaba al menos 5 agentes (intencion, selector, relevancia, compositor, verificador)');
else OK(agentes.length + ' agentes con rol propio');

for (const a of agentes) {
  const tieneModelo = Object.values(wf.connections).some((c) =>
    (c.ai_languageModel || []).some((g) => g.some((x) => x.node === a.name)));
  const tieneParser = Object.values(wf.connections).some((c) =>
    (c.ai_outputParser || []).some((g) => g.some((x) => x.node === a.name)));
  if (!tieneModelo) E('agente "' + a.name + '" sin modelo conectado');
  if (!tieneParser) E('agente "' + a.name + '" sin output parser (devolveria prosa libre)');
  if (tieneModelo && tieneParser) OK('agente "' + a.name + '": modelo + parser');
  if (a.onError !== 'continueRegularOutput') {
    E('agente "' + a.name + '": sin onError=continueRegularOutput (un fallo del LLM corta el turno)');
  }
}

// El de relevancia NO tiene tools a proposito: su insumo es la lista cerrada.
const toolsDe = (agente) => Object.entries(wf.connections)
  .filter(([, c]) => (c.ai_tool || []).some((g) => g.some((x) => x.node === agente)))
  .map(([src]) => src);
const tr = toolsDe('Agente Relevancia');
if (tr.length) E('el Agente Relevancia tiene tools (' + tr.join(', ') + '): tiene que elegir de la lista cerrada');
else OK('Agente Relevancia sin tools (lista cerrada, no puede re-buscar)');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n4. INVARIANTE DEL VERIFICADOR — ve TODO (decision Martin 2026-07-29)');
// ───────────────────────────────────────────────────────────────────────────
if (pv) {
  const js = pv.parameters.jsCode;
  if (!/filasCrudas/.test(js)) E('el verificador no recibe las filas crudas de la base');
  else OK('el verificador recibe el resultado SQL crudo completo');
  if (!/hechos/.test(js)) E('el verificador no recibe los hechos autorizados');
  else OK('el verificador recibe los hechos autorizados');
  if (!/borrador/.test(js)) E('el verificador no recibe el mensaje que va a salir');
  else OK('el verificador recibe el mensaje por salir');
  if (!/conversation|dialogo/.test(js)) E('el verificador no recibe la conversacion');
  else OK('el verificador recibe la conversacion del cliente');
}
const ac = N('Armar Candidatos');
if (ac && !/filasCrudas/.test(ac.parameters.jsCode)) E('Armar Candidatos no preserva las filas crudas');
else if (ac) OK('las filas crudas se preservan desde la busqueda');

const tv = toolsDe('Agente Verificador');
if (!tv.length) E('el verificador no tiene tool para releer la base');
else OK('el verificador puede releer la base: ' + tv.join(', '));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n5. INVARIANTE DE SALIDA — un solo envio, escalacion a mail');
// ───────────────────────────────────────────────────────────────────────────
const envios = wf.nodes.filter((n) => n.name === 'Enviar Mensaje');
if (envios.length !== 1) E('esperaba exactamente 1 nodo "Enviar Mensaje", hay ' + envios.length);
else OK('un solo punto de envio al cliente');

// Todo lo que llega a Enviar Mensaje tiene que venir de un chequeo.
const haciaEnvio = Object.entries(wf.connections)
  .filter(([, c]) => (c.main || []).some((g) => g.some((x) => x.node === 'Enviar Mensaje')))
  .map(([src]) => src);
console.log('  entran a Enviar Mensaje: ' + haciaEnvio.join(', '));
if (haciaEnvio.includes('Agente Compositor')) E('el compositor escribe DIRECTO al cliente sin pasar por el verificador');
else OK('nada llega al cliente sin pasar por un chequeo');
if (!haciaEnvio.includes('¿Aprobado?')) E('la rama verificada no llega a Enviar Mensaje');

// La escalacion existe y es a mail.
if (!N('Label Escalación') || !N('Mensaje Escalación')) E('falta la rama de escalacion');
else OK('rama de escalacion presente');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n6. INVARIANTE DE FIREWALL — los dos tiers siguen en el camino');
// ───────────────────────────────────────────────────────────────────────────
for (const n of ['Firewall Tier-1', 'Guardrails Tier-2', 'Strike Tier-2', 'Verificar HMAC']) {
  if (!N(n)) E('falta "' + n + '"');
  else OK('presente: ' + n);
}
// El primer agente no puede recibir trafico sin pasar por el firewall.
const haciaIntencion = Object.entries(wf.connections)
  .filter(([, c]) => (c.main || []).some((g) => g.some((x) => x.node === 'Prompt Intención')))
  .map(([src]) => src);
if (!haciaIntencion.length) E('Prompt Intención no recibe nada');
else if (!haciaIntencion.every((s) => /Tier-2|Firewall/.test(s))) {
  E('hay trafico que llega a los agentes sin pasar el firewall: ' + haciaIntencion.join(', '));
} else OK('todo el trafico a los agentes pasa por el firewall Tier-2');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n6b. RUTEO DE SWITCHES — cada salida a donde dice su regla');
//
// El bug de 2026-07-29: las salidas de `Switch Firewall` estaban corridas un
// lugar y `pass` (mensaje legitimo) apuntaba a la negativa. Todo cliente normal
// recibia "solo puedo ayudarte con consultas sobre Terminal Grafica". El grafo
// estaba conectado y los invariantes daban verde: nada miraba la SEMANTICA.
// ───────────────────────────────────────────────────────────────────────────
const RUTEO = {
  'Switch Ruteo': {
    skip: 'Descartar (debounce/dup)', greeting: 'Saludo Bienvenida',
    injection: 'Mensaje Anti-Injection', process: 'Guardrails Tier-2',
    cap: 'Mensaje Cap Email',
  },
  'Switch Firewall': {
    pass: '¿Tiene Texto?', refusal: 'Mensaje Firewall Refusal',
    silence: 'Aviso Rate Firewall', drop: 'Descartar Firewall (drop)',
    fallback: '¿Tiene Texto?',
  },
  'Switch Strike Tier-2': {
    refusal: 'Mensaje Refusal Tier-2', silence: 'Silencio Tier-2',
    fallback: 'Silencio Tier-2',
  },
  'Switch Intención': {
    info: 'Salida Info', otro: 'Silencio Otro', catalogo: 'Prompt Selector',
  },
};

for (const [nombre, esperado] of Object.entries(RUTEO)) {
  const nodo = N(nombre);
  if (!nodo) { E('falta el switch "' + nombre + '"'); continue; }
  const p = nodo.parameters || {};
  const keys = (p.rules && p.rules.values ? p.rules.values : []).map((r, i) => r.outputKey || ('regla' + i));
  const opts = p.options || {};
  if (opts.fallbackOutput === 'extra') keys.push(opts.renameFallbackOutput || 'fallback');
  const salidas = (wf.connections[nombre] || {}).main || [];

  let malas = 0;
  for (const [clave, destino] of Object.entries(esperado)) {
    const idx = keys.indexOf(clave);
    if (idx === -1) { E(nombre + ': no declara la salida "' + clave + '"'); malas++; continue; }
    const van = (salidas[idx] || []).map((x) => x.node);
    if (!van.includes(destino)) {
      E(nombre + ' salida ' + idx + ' (' + clave + ') deberia ir a "' + destino + '" y va a [' + (van.join(', ') || 'NADA') + ']');
      malas++;
    }
  }
  keys.forEach((k, i) => {
    if (!(salidas[i] || []).length) { E(nombre + ' salida ' + i + ' (' + k + ') SIN CABLEAR'); malas++; }
  });
  if (!malas) OK(nombre + ': ' + keys.length + ' salidas al destino correcto');
}

// Los IF: salida 0 = true, salida 1 = false. Un IF invertido es igual de mudo.
const IFS = {
  '¿Tiene Texto?': ['Wait — Debounce', 'Respuesta No-Texto'],
  '¿Violación Real Tier-2?': ['Strike Tier-2', 'Prompt Intención'],
  '¿Hay Algo Que Decir?': ['Agente Compositor', 'Label Escalación'],
  // false NO va derecho a mail: pasa por el IF de reintento (seccion 9)
  '¿Aprobado?': ['Enviar Mensaje', '¿Reintentar?'],
  '¿Reintentar?': ['Prompt Reintento', 'Label Escalación'],
  '¿Info Resuelta?': ['Enviar Mensaje', 'Label Escalación'],
};
for (const [nombre, [siTrue, siFalse]] of Object.entries(IFS)) {
  if (!N(nombre)) { E('falta el IF "' + nombre + '"'); continue; }
  const s = (wf.connections[nombre] || {}).main || [];
  const t = (s[0] || []).map((x) => x.node);
  const f = (s[1] || []).map((x) => x.node);
  if (!t.includes(siTrue)) E(nombre + ' (true) deberia ir a "' + siTrue + '" y va a [' + (t.join(', ') || 'NADA') + ']');
  else if (!f.includes(siFalse)) E(nombre + ' (false) deberia ir a "' + siFalse + '" y va a [' + (f.join(', ') || 'NADA') + ']');
  else OK(nombre + ': true/false en el sentido correcto');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n7. GRAFO — sin referencias colgadas');
// ───────────────────────────────────────────────────────────────────────────
const nombres = new Set(wf.nodes.map((n) => n.name));
let colgadas = 0;
for (const [src, conns] of Object.entries(wf.connections)) {
  if (!nombres.has(src)) { E('conexion desde nodo inexistente: ' + src); colgadas++; }
  for (const grupos of Object.values(conns)) {
    for (const g of grupos) for (const c of g) {
      if (!nombres.has(c.node)) { E('conexion ' + src + ' -> ' + c.node + ' (inexistente)'); colgadas++; }
    }
  }
}
if (!colgadas) OK('todas las conexiones apuntan a nodos existentes');

const dup = wf.nodes.map((n) => n.name).filter((n, i, a) => a.indexOf(n) !== i);
if (dup.length) E('nodos duplicados: ' + dup.join(', '));
else OK('sin nodos duplicados');

// REFERENCIAS $('Nodo') — no viven en `connections`, asi que el chequeo de grafo
// no las ve: el JSON importa perfecto y revienta EN EJECUCION con "Referenced
// node doesn't exist". Paso en la primera corrida real (2026-07-29): tres nodos
// heredados de v9 apuntaban a nodos que esta arquitectura no tiene.
{
  let rotas = 0;
  for (const n of wf.nodes) {
    const blob = JSON.stringify(n.parameters || {});
    const refs = new Set();
    for (const m of blob.matchAll(/\$\(\\?['"]([^'"\\]+)\\?['"]\)/g)) refs.add(m[1]);
    for (const r of refs) {
      if (!nombres.has(r)) { E('"' + n.name + '" referencia $(\'' + r + '\'), que no existe'); rotas++; }
    }
  }
  if (!rotas) OK('ninguna expresion $(...) apunta a un nodo inexistente');
}

// Las columnas de los logs tienen que existir en el sobre del nodo que leen. Una
// columna NOT NULL que llega null hace REBOTAR el INSERT entero y, con
// onError:continueRegularOutput, falla EN SILENCIO (bug del 2026-07-28: cero
// filas de la rama normal durante un dia entero de trabajo).
{
  const lt = N('Log Turno');
  const lv = N('Leer Verificador');
  if (lt && lv) {
    // El sobre de Leer Verificador = lo que declara explicitamente + todo lo que
    // arrastra el spread `...d`. Se rastrea la cadena de spreads hacia atras
    // hasta `Decidir`, que es donde nacen conversationId/userMessage.
    const CADENA = ['Leer Verificador', 'Prompt Verificador', 'Leer Compositor',
      'Calcular Montos', 'Armar Candidatos', 'Leer Selector', 'Prompt Selector',
      'Leer Intención', 'Prompt Intención'];
    let sobre = '';
    for (const nombre of CADENA) {
      const n = N(nombre);
      if (!n) continue;
      sobre += '\n' + n.parameters.jsCode;
      // si el nodo NO hace spread, la cadena se corta ahi
      if (!/\.\.\.d\b/.test(n.parameters.jsCode)) break;
    }
    // `Decidir` es el origen del sobre: sus campos viajan por toda la cadena.
    const dec = N('Decidir');
    if (dec) sobre += '\n' + dec.parameters.jsCode;

    const faltan = [];
    for (const [col, expr] of Object.entries(lt.parameters.columns.value)) {
      const m = String(expr).match(/\$\('Leer Verificador'\)\.first\(\)\.json\.(\w+)/);
      if (m && !new RegExp('\\b' + m[1] + '\\b').test(sobre)) faltan.push(col + ' (' + m[1] + ')');
    }
    if (faltan.length) E('Log Turno mapea campos que no existen en el sobre: ' + faltan.join(', '));
    else OK('Log Turno: todas las columnas existen en el sobre (incl. las heredadas por spread)');
  }
}

// Nodos huerfanos (sin entrada y sin ser trigger)
const conEntrada = new Set();
for (const conns of Object.values(wf.connections)) {
  for (const grupos of Object.values(conns)) {
    for (const g of grupos) for (const c of g) conEntrada.add(c.node);
  }
}
const TRIGGERS = ['n8n-nodes-base.webhook'];
const SUBNODOS = ['lmChatOpenRouter', 'outputParserStructured', 'postgresTool', 'stickyNote'];
const huerfanos = wf.nodes.filter((n) =>
  !conEntrada.has(n.name) &&
  !TRIGGERS.includes(n.type) &&
  !SUBNODOS.some((s) => n.type.endsWith(s)) &&
  !Object.keys(wf.connections).includes(n.name));
if (huerfanos.length) console.log('  aviso  nodos sin entrada ni salida: ' + huerfanos.map((n) => n.name).join(', '));

const sinEntrada = wf.nodes.filter((n) =>
  !conEntrada.has(n.name) &&
  !TRIGGERS.includes(n.type) &&
  !SUBNODOS.some((s) => n.type.endsWith(s)));
if (sinEntrada.length) console.log('  aviso  nodos sin entrada: ' + sinEntrada.map((n) => n.name).join(', '));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n8b. UNIDAD DE COBRO — unidad_venta manda sobre la columna `unidad`');
//
// `unidad` dice "Hoja" en 142 de 165 variantes del catalogo real, pero solo 48
// se cobran por hoja: el resto es unidad/pack/trabajo/m2/metro y el dato bueno
// esta en atributos.unidad_venta. Decir "por hoja" en un anillado (que se cobra
// por trabajo) es un 120x si el cliente multiplica por sus 120 hojas.
// ───────────────────────────────────────────────────────────────────────────
{
  const arm = N('Armar Candidatos');
  const calc2 = N('Calcular Montos');
  const pv = N('Prompt Verificador');
  const busca = N('Buscar Candidatos');

  // el dato tiene que VENIR del SQL, no alcanza con leerlo en JS
  if (busca && !/v\.atributos/.test(busca.parameters.query || '')) {
    E('Buscar Candidatos no trae v.atributos: unidad_venta nunca llegaria al pipeline');
  } else OK('el SQL trae v.atributos (donde vive unidad_venta)');

  if (arm) {
    const js = arm.parameters.jsCode;
    if (!/unidad_venta/.test(js)) E('Armar Candidatos no lee unidad_venta: diria "por Hoja" en todo');
    else OK('Armar Candidatos lee unidad_venta');
  }
  if (calc2) {
    const js = calc2.parameters.jsCode;
    if (!/cobro/.test(js)) E('Calcular Montos no usa `cobro`: el texto del hecho saldria de la columna que miente');
    else OK('Calcular Montos arma el texto desde `cobro` (unidad_venta)');
    if (!/esPorTrabajo/.test(js)) E('Calcular Montos no marca esPorTrabajo: el compositor no sabe que ese monto NO se multiplica');
    else OK('marca esPorTrabajo (el monto es el trabajo completo)');
    // NADIE puede volver a caer a `unidad`: en las 6 variantes donde seria el
    // unico dato, dice "Hoja" y las 6 se cobran de otra forma.
    if (/c\.unidad\b/.test(js)) E('Calcular Montos volvio a leer c.unidad: ese fallback devuelve una unidad incorrecta');
    else OK('Calcular Montos NO cae a `unidad` como fallback');
    if (!/if \(!unidad\)/.test(js)) E('Calcular Montos no bloquea el precio sin unidad de cobro: un monto suelto lo lee cada cliente como quiere');
    else OK('sin unidad de cobro el precio va a caveat, no a hecho');
  }
  // el campo confuso no puede viajar en el candidato: si no existe, nadie lo lee
  // ojo la regex: `unidadVenta:` y `unidadCruda:` SI tienen que estar, se busca
  // la clave `unidad:` exacta.
  if (arm && /^\s*unidad:\s*r\./m.test(arm.parameters.jsCode)) {
    E('`unidad` volvio al objeto candidato: el nombre promete la unidad de cobro y trae otra cosa');
  } else if (arm) OK('`unidad` NO viaja en el candidato (solo `cobro`)');
  if (pv) {
    const js = pv.parameters.jsCode;
    if (!/se cobra/.test(js)) E('Prompt Verificador no le muestra al auditor como se cobra');
    else OK('el verificador ve "se cobra: <unidad_venta>"');
  }

  // PACKS: `por_pack` es un BOOLEANO; la cantidad esta en pack_unidades.
  // Leerlo como numero daba "el pack de true" en el mensaje al cliente.
  if (arm) {
    const js = arm.parameters.jsCode;
    if (!/pack_unidades/.test(js)) E('Armar Candidatos no lee pack_unidades: por_pack es booleano, diria "pack de true"');
    else OK('Armar Candidatos saca el tamanio del pack de pack_unidades');
    if (!/pack_tiers/.test(js)) E('Armar Candidatos no lee pack_tiers: el cliente no se entera de los otros packs');
    else OK('Armar Candidatos expone los otros tamanios de pack');
  }

  // PEDIDO MINIMO: por debajo del minimo el precio no vale (promo inmobiliarias:
  // $15.000 llevando 6, suelto $19.500). Ya diagnosticado en v9, perdido en v10.
  if (arm && !/min_unidades/.test(arm.parameters.jsCode)) {
    E('Armar Candidatos no lee min_unidades: cotizaria por debajo del pedido minimo');
  } else if (arm) OK('Armar Candidatos lee min_unidades');
  if (calc2) {
    const js = calc2.parameters.jsCode;
    if (!/minUnidades/.test(js)) E('Calcular Montos no aplica el pedido minimo: emitiria un precio que no vale');
    else OK('Calcular Montos bloquea el hecho bajo el pedido minimo');
  }
  if (pv && !/MINIMO/.test(pv.parameters.jsCode)) {
    E('Prompt Verificador no muestra el minimo: el auditor no puede detectar una cotizacion bajo minimo');
  } else if (pv) OK('el verificador ve el pedido minimo');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n8e. TOTALES — el codigo multiplica, el LLM copia');
//
// Decision de Martin (2026-07-29): se cotiza cerrado SOLO donde no hay recargo
// posible. Reemplaza la politica del 28 ("no se da el total"). El riesgo nuevo
// es multiplicar donde no corresponde — anillado tiene multiplica:true pero
// significa "3 anillados salen 3x", no "x120 hojas".
// ───────────────────────────────────────────────────────────────────────────
{
  const calc3 = N('Calcular Montos');
  const pv3 = N('Prompt Verificador');
  const comp3 = N('Agente Compositor');
  if (calc3) {
    const js = calc3.parameters.jsCode;
    if (!/const total =|total = monto \* cantidad/.test(js)) E('Calcular Montos no calcula el total');
    else OK('el total lo calcula el codigo, no el LLM');
    // las tres condiciones: sin alguna, se cotiza de menos o se cobra de mas
    if (!/uvPosible/.test(js)) E('no excluye los productos UV: el precio guardado es el BASE, el total sub-cotizaria');
    else OK('excluye UV del total (precio base + recargo del taller)');
    if (!/multiplicable/.test(js)) E('no mira `multiplica`: multiplicaria un pack por sus propias unidades');
    else OK('respeta el flag multiplica (los packs no se multiplican)');
    if (!/cantidadEsLaUnidad/.test(js)) {
      E('no verifica que la cantidad este en la unidad de cobro: "anillar 120 hojas" x $2.400 = 120x');
    } else OK('solo multiplica si la cantidad esta en la unidad de cobro');
    if (!/motivoSinTotal/.test(js)) E('no registra por que no hay total: el compositor improvisaria la razon');
    else OK('registra por que no hay total (evita razones inventadas)');
    // el total tiene que estar autorizado o el guard lo marca inventado
    if (!/h\.total\]/.test(js) && !/flatMap/.test(js)) {
      E('los totales no entran en montosAutorizados: el guard los marcaria como precio inventado');
    } else OK('los totales entran en montosAutorizados');
  }
  if (pv3 && !/TOTAL AUTORIZADO/.test(pv3.parameters.jsCode)) {
    E('el verificador no ve los totales: rechazaria un total legitimo');
  } else if (pv3) OK('el verificador ve los totales como autorizados');
  if (comp3) {
    const sys = comp3.parameters.options.systemMessage;
    if (!/COTIZAS TOTALES/.test(sys)) E('el compositor no sabe que puede dar totales');
    else OK('el compositor sabe que puede cotizar totales');
    if (!/lo multiplicas vos/.test(sys)) E('el compositor no tiene prohibido calcular el total por su cuenta');
    else OK('el compositor tiene prohibido calcular totales');
  }
  // AVISO DE CANAL: una vez por conversacion (no en cada turno: es mensaje pago)
  if (calc3 && !/avisoDado/.test(calc3.parameters.jsCode)) {
    E('no se controla el aviso de canal: lo repetiria en cada mensaje');
  } else if (calc3) OK('el aviso de canal va una sola vez por conversacion');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n8c. CORRECCION DEL VERIFICADOR — reescribe prosa, nunca plata');
//
// El verificador puede devolver el mensaje corregido (decision de Martin
// 2026-07-29). Eso lo convierte en el UNICO que escribe sin que nadie lo audite
// despues, asi que su correccion tiene que pasar por el mismo chequeo
// deterministico de montos que el borrador del compositor.
// ───────────────────────────────────────────────────────────────────────────
{
  const leerV = N('Leer Verificador');
  const ag = N('Agente Verificador');
  if (leerV) {
    const js = leerV.parameters.jsCode;
    if (!/mensajeCorregido/.test(js)) E('Leer Verificador no lee mensajeCorregido');
    else OK('Leer Verificador acepta la correccion del auditor');
    // EL GUARD: sin esto el verificador puede tipear un monto sin control.
    if (!/montosDeLaCorreccion/.test(js)) {
      E('la correccion NO pasa por el guard de montos: el verificador podria inventar plata sin auditor');
    } else OK('la correccion pasa por el guard deterministico de montos');
    if (!/correccionRechazada/.test(js)) E('no se registra cuando la correccion trae plata inventada');
    else OK('una correccion con plata inventada queda registrada');
  }
  if (ag) {
    const sys = ag.parameters.options.systemMessage;
    if (!/mensajeCorregido/.test(sys)) E('el prompt del verificador no le explica como corregir');
    else OK('el prompt explica cuando corregir y cuando rechazar');
    if (!/No agregues ni cambies un solo/.test(sys)) E('el prompt no le prohibe tocar los montos al corregir');
    else OK('el prompt le prohibe tocar montos al corregir');
  }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n8d. CANALES Y PROMESAS — lo que el bot no puede ofrecer');
// ───────────────────────────────────────────────────────────────────────────
{
  // El telefono: al local NO se contesta, ofrecerlo manda a un canal muerto.
  const conTel = wf.nodes.filter((n) => /476-0019|\(0223\)/.test(JSON.stringify(n.parameters || {})));
  if (conTel.length) E('se ofrece un telefono (al local no se contesta): ' + conTel.map((n) => n.name).join(', '));
  else OK('ningun nodo ofrece el telefono');

  const comp = N('Agente Compositor');
  if (comp) {
    const sys = comp.parameters.options.systemMessage;
    if (!/NUNCA TOMAS UN PEDIDO/.test(sys)) E('el compositor no tiene prohibido tomar pedidos (este canal informa)');
    else OK('el compositor tiene prohibido ofrecer/tomar pedidos');
    if (!/NO PIDAS ARCHIVOS/.test(sys)) E('el compositor no tiene prohibido pedir archivos (no los podemos recibir)');
    else OK('el compositor tiene prohibido pedir archivos');
  }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n9. LOOP DE REINTENTO — acotado a UNA vuelta');
//
// Es el unico ciclo del grafo. Un ciclo mal acotado no se cae: gira contra la
// API paga y le manda N mensajes al cliente. Estos chequeos son estructurales
// a proposito — que exista el IF no alcanza, tiene que ser IMPOSIBLE dar dos
// vueltas.
// ───────────────────────────────────────────────────────────────────────────
{
  const reint = N('¿Reintentar?');
  const prompt = N('Prompt Reintento');
  const leerV = N('Leer Verificador');
  const leerC = N('Leer Compositor');

  if (!reint) E('falta el IF "¿Reintentar?"');
  else OK('existe el IF "¿Reintentar?"');
  if (!prompt) E('falta "Prompt Reintento"');
  else OK('existe "Prompt Reintento"');

  // el ciclo se cierra donde tiene que cerrarse
  const salidasReint = ((wf.connections['¿Reintentar?'] || {}).main || []);
  const dest = (i) => (salidasReint[i] || []).map((c) => c.node);
  if (!dest(0).includes('Prompt Reintento')) E('¿Reintentar? salida 0 (true) no va a Prompt Reintento');
  else OK('¿Reintentar? true -> Prompt Reintento');
  if (!dest(1).includes('Label Escalación')) E('¿Reintentar? salida 1 (false) no va a Label Escalación: el turno moriria mudo');
  else OK('¿Reintentar? false -> Label Escalación (mail)');

  const salidasPR = ((wf.connections['Prompt Reintento'] || {}).main || [])[0] || [];
  if (!salidasPR.some((c) => c.node === 'Agente Compositor')) E('Prompt Reintento no vuelve al Agente Compositor: el loop no cierra');
  else OK('Prompt Reintento -> Agente Compositor (el ciclo cierra)');

  // ¿Aprobado? false tiene que ir al IF de reintento, NO derecho a mail
  const salidasAprob = ((wf.connections['¿Aprobado?'] || {}).main || []);
  if (!((salidasAprob[1] || []).map((c) => c.node).includes('¿Reintentar?'))) {
    E('¿Aprobado? salida 1 (false) no pasa por ¿Reintentar?: el rechazo escalaria sin intentar corregir');
  } else OK('¿Aprobado? false -> ¿Reintentar?');

  // LA COTA. Sin esto el ciclo es infinito.
  if (leerV) {
    const js = leerV.parameters.jsCode;
    if (!/puedeReintentar/.test(js)) E('Leer Verificador no calcula puedeReintentar');
    else OK('Leer Verificador calcula puedeReintentar');
    if (!/intento\s*<\s*2/.test(js)) E('COTA AUSENTE: puedeReintentar no exige intento < 2 — el loop seria infinito');
    else OK('cota dura: solo reintenta si intento < 2');
    // la plata no se reintenta: los montos son identicos en la 2da vuelta
    if (!/!montoInventado/.test(js)) E('puedeReintentar no excluye montoInventado: reintentar no puede arreglar un monto');
    else OK('montoInventado NO es reintentable (va derecho a mail)');
  }

  // el contador tiene que venir de n8n ($runIndex), no de un campo del sobre
  // que se pueda arrastrar sin incrementarse.
  if (leerC) {
    const js = leerC.parameters.jsCode;
    if (!/\$runIndex/.test(js)) E('Leer Compositor no deriva `intento` de $runIndex: un contador propio se desincroniza y el loop no termina');
    else OK('`intento` sale de $runIndex (lo lleva n8n, no nosotros)');
  }

  // el feedback tiene que llegar de verdad al compositor
  if (prompt) {
    const js = prompt.parameters.jsCode;
    if (!/queFalta/.test(js)) E('Prompt Reintento no pasa queFalta: el compositor reintentaria a ciegas');
    else OK('Prompt Reintento le pasa el feedback del auditor al compositor');
    if (!/Calcular Montos/.test(js)) E('Prompt Reintento no relee Calcular Montos: perderia los hechos autorizados');
    else OK('Prompt Reintento conserva los hechos autorizados originales');
  }

  // NO puede haber otro ciclo en el grafo. Este es el unico permitido.
  {
    const salidas = (n) => Object.values((wf.connections[n] || {}).main || [])
      .flat().map((c) => c.node);
    const ciclos = [];
    const visitar = (nodo, camino, vistos) => {
      if (camino.length > 60) return;
      for (const sig of salidas(nodo)) {
        if (sig === camino[0]) { ciclos.push([...camino, sig].join(' -> ')); continue; }
        if (vistos.has(sig)) continue;
        visitar(sig, [...camino, sig], new Set([...vistos, sig]));
      }
    };
    const arranques = wf.nodes.map((n) => n.name);
    const encontrados = new Set();
    for (const a of arranques) {
      ciclos.length = 0;
      visitar(a, [a], new Set([a]));
      for (const c of ciclos) encontrados.add(c);
    }
    const permitido = (c) => /Prompt Reintento/.test(c) && /Agente Compositor/.test(c);
    const inesperados = [...encontrados].filter((c) => !permitido(c));
    if (inesperados.length) E('ciclo(s) inesperado(s) en el grafo: ' + inesperados.slice(0, 3).join(' ;; '));
    else OK('el reintento es el UNICO ciclo del grafo');
  }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n10. EL ENVIO SE VERIFICA ANTES DE LOGUEAR (503 de Chatwoot, 2026-07-29)');
{
  const envio = wf.nodes.find((n) => n.name === 'Enviar Mensaje');
  if (!envio) E('no existe "Enviar Mensaje"');
  else {
    // sin reintento, un 503 transitorio pierde el mensaje para siempre
    if (envio.retryOnFail === true && Number(envio.maxTries) >= 3) {
      OK('Enviar Mensaje reintenta (>=3 intentos)');
    } else E('Enviar Mensaje no reintenta: un 503 de Chatwoot pierde el mensaje');
    // sin alwaysOutputData el fallo no deja item y Chequear Envio no puede leerlo
    if (envio.alwaysOutputData === true) OK('emite item aun fallando (para poder chequearlo)');
    else E('Enviar Mensaje sin alwaysOutputData: el chequeo de entrega se queda sin dato');
    // el onError se CONSERVA a proposito: sin el, el flujo se corta y no se loguea nada
    if (envio.onError === 'continueRegularOutput') OK('conserva onError (si no, no se loguea el fallo)');
    else E('Enviar Mensaje sin onError: un fallo corta el flujo y no deja rastro');
  }

  const cheq = wf.nodes.find((n) => n.name === 'Chequear Envio');
  if (!cheq) E('no existe "Chequear Envio"');
  else {
    const js = cheq.parameters.jsCode || '';
    if (/envio_fallido/.test(js)) OK('marca accion=envio_fallido cuando no se entrego');
    else E('Chequear Envio no marca el fallo: el log sigue diciendo que se contesto');
    if (/idMensaje|\.id\b/.test(js)) OK('la entrega se decide por el id que devuelve Chatwoot');
    else E('Chequear Envio no lee el id del mensaje creado');
  }

  // EL ORDEN IMPORTA: Enviar -> Chequear -> Log. Si Log colgara de Enviar
  // directo, volveria a registrar como entregado lo que se perdio.
  const sal = (n) => ((wf.connections[n] || {}).main || []).flat().map((c) => c.node);
  if (sal('Enviar Mensaje').includes('Chequear Envio')) OK('Enviar Mensaje -> Chequear Envio');
  else E('Enviar Mensaje no pasa por Chequear Envio');
  if (!sal('Enviar Mensaje').includes('Log Turno')) OK('Log Turno YA NO cuelga directo del envio');
  else E('Log Turno cuelga directo de Enviar Mensaje: registraria un 503 como entrega');
  if (sal('¿Se Entregó?').includes('Log Turno')) OK('las dos ramas de ¿Se Entregó? loguean');
  else E('¿Se Entregó? no llega a Log Turno');
  if (sal('¿Se Entregó?').includes('Label Envío Fallido')) OK('un envio perdido se etiqueta para revision');
  else E('un envio perdido no se etiqueta: nadie se entera');

  // Log Turno tiene que leer el sobre CORREGIDO, no el del verificador
  const logT = wf.nodes.find((n) => n.name === 'Log Turno');
  const mapeo = JSON.stringify((logT.parameters.columns || {}).value || {});
  if (/Chequear Envio/.test(mapeo)) OK('Log Turno lee el sobre de Chequear Envio');
  else E('Log Turno lee otro nodo: el accion=envio_fallido no llegaria al INSERT');
}

console.log('\n11. LA OFERTA POR CANTIDAD NO SE PIERDE (promo inmobiliarias, 2026-07-29)');
{
  const calc = wf.nodes.find((n) => n.name === 'Calcular Montos');
  const js = calc.parameters.jsCode || '';
  // el `continue` viejo tiraba la promo entera cuando el cliente pedia menos
  if (/ofertaBajoMinimo/.test(js)) OK('la oferta bajo minimo se emite marcada');
  else E('no existe ofertaBajoMinimo: la promo se sigue descartando');
  if (/bajo_minimo/.test(js)) OK('bajo el minimo no se calcula total');
  else E('falta el motivoSinTotal bajo_minimo: podria multiplicar y sub-cotizar');
  // el minimo tiene que ir DENTRO de `texto`, que el compositor copia literal
  if (/texto:[\s\S]{0,400}llevando '\s*\+\s*c\.minUnidades/.test(js)) {
    OK('el minimo viaja pegado al monto (no como caveat borrable)');
  } else E('el minimo no esta dentro de `texto`: el numero puede viajar solo');

  // el flag del aviso de canal se lee de Decidir, NO del sobre heredado
  if (/\$\('Decidir'\)[\s\S]{0,80}avisoDado/.test(js)) {
    OK('avisoDado se lee de Decidir (7 nodos de distancia, se diluia)');
  } else E('avisoDado sale del sobre: se pierde en la cadena y repite el mail');

  const lv = wf.nodes.find((n) => n.name === 'Leer Verificador');
  const jsv = lv.parameters.jsCode || '';
  if (/ofertasBorradas/.test(jsv)) OK('hay guard contra el borrado de ofertas');
  else E('el verificador puede borrar una oferta sin que nadie lo note');
  // compara MONTOS, no texto: si comparara la frase, romperia al reformular
  if (/montosOferta[\s\S]{0,200}enCorreccion\.includes/.test(jsv)) {
    OK('el guard compara montos, no la redaccion');
  } else E('el guard no compara montos: reformular la oferta lo rompe');

  const sysVer = wf.nodes.find((n) => n.name === 'Agente Verificador')
    .parameters.options.systemMessage;
  if (/NUNCA BORRES UNA OFERTA POR CANTIDAD/.test(sysVer)) OK('el prompt se lo prohibe explicito');
  else E('el prompt del verificador no prohibe borrar ofertas');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(err ? 'FALLA: ' + err + ' error(es), ' + ok + ' ok' : 'TODO OK: ' + ok + ' invariantes verificados');
process.exit(err ? 1 : 0);
