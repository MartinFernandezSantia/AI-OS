// El gemelo "Armar Respuesta Precio 2" (2ª pasada tras el Aclarador) es IDENTICO
// a "Armar Respuesta Precio" salvo dos cosas: SEGUNDA_PASADA=true y la fuente de
// slots ($('Parsear Respuesta') -> $('Aplicar Aclarador')). Este script deriva el
// gemelo del original y verifica que estén en sync (o lo reescribe con --write).
//
//   node tests/regen-arp2-twin.js          -> falla si driftearon
//   node tests/regen-arp2-twin.js --write  -> regenera el gemelo desde el original
//
// El harness (code-harness.js) también testea ambos nodos; esto es la red rápida.
const fs = require('fs');
const path = require('path');
const WF = path.join(__dirname, '..', 'n8n', 'flows', process.env.WF || 'faq-bot-v8.json');
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
const orig = wf.nodes.find((n) => n.name === 'Armar Respuesta Precio');
const twin = wf.nodes.find((n) => n.name === 'Armar Respuesta Precio 2');
if (!orig) { console.error('No existe "Armar Respuesta Precio"'); process.exit(2); }
if (!twin) { console.error('No existe "Armar Respuesta Precio 2" (¿corriste build-aclarador?)'); process.exit(2); }

const derive = (code) => {
  let t = code
    .split('const SEGUNDA_PASADA = false;').join('const SEGUNDA_PASADA = true; // GEMELO 2ª pasada')
    .split("$('Parsear Respuesta')").join("$('Aplicar Aclarador')");
  if (t === code) throw new Error('derive: no cambió nada (¿faltan los marcadores en el original?)');
  if (t.includes("$('Parsear Respuesta')")) throw new Error('derive: quedó una ref a Parsear Respuesta');
  return t;
};

const expected = derive(orig.parameters.jsCode);
const write = process.argv.includes('--write');

if (write) {
  twin.parameters.jsCode = expected;
  fs.writeFileSync(WF, JSON.stringify(wf, null, 2) + '\n');
  console.log('Gemelo regenerado desde el original.');
} else if (twin.parameters.jsCode === expected) {
  console.log('OK — gemelo en sync con el original.');
} else {
  console.error('DRIFT — "Armar Respuesta Precio 2" no coincide con el derivado del original.');
  console.error('Corré: node tests/regen-arp2-twin.js --write');
  process.exit(1);
}
