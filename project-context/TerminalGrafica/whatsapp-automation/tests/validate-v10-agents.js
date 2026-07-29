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
  // El total NO se calcula: precio_lista es el BASE y hay recargo UV (v9.2).
  if (/cantidad\s*\*|\*\s*cantidad/.test(js)) E('Calcular Montos multiplica por cantidad: precio_lista es el BASE, no el total (v9.2)');
  else OK('no calcula totales por cantidad (precio_lista es base, hay recargo UV)');
}

// El compositor tiene que recibir la orden explicita de no calcular.
const comp = N('Agente Compositor');
if (!comp) E('falta el Agente Compositor');
else {
  const sys = comp.parameters.options.systemMessage || '';
  if (!/copias EXACTO|copiá los montos EXACTO|EXACTO/i.test(sys)) E('el compositor no tiene la regla de copiar montos exacto');
  else OK('el compositor tiene prohibido calcular montos');
  if (!/NUNCA lo calculas|no calculas/i.test(sys)) E('el compositor no tiene prohibido calcular totales');
  else OK('el compositor deriva los totales a mail');
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
console.log('\n' + '='.repeat(60));
console.log(err ? 'FALLA: ' + err + ' error(es), ' + ok + ' ok' : 'TODO OK: ' + ok + ' invariantes verificados');
process.exit(err ? 1 : 0);
