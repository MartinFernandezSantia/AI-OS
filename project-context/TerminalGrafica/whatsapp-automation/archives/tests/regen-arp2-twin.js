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

// ── v9: EL GEMELO YA NO SE DERIVA DEL ORIGINAL ────────────────────────────────
// En v8.3b aparecieron asimetrías DELIBERADAS (build-v9.js §3a-bis y §4f): la
// elección de variante y `nombreFiltro` viven sólo en el original, porque en la 2ª
// pasada el SQL ya eligió y `filtrados[0]` apunta al candidato que FALLÓ. O sea el
// gemelo dejó de ser una copia y pasó a ser un pariente: derivarlo por recorte de
// texto es frágil y da un DRIFT permanente.
//
// El guard cambia de pregunta. Ya no verifica "¿son idénticos?" sino lo único que de
// verdad importa: **¿algún fix quedó aplicado en uno solo?**. Eso se mide sobre los
// marcadores que el build inserta en AMBOS (cada `sub(...)` del bloque los aplica a
// los dos nodos), más los invariantes estructurales del gemelo.
//
// Por qué importó: hasta el 2026-07-28 este script corría sin `WF=` (o sea contra v8)
// y decía OK toda la sesión mientras v9 estaba en DRIFT. Un guard que sólo pasa sobre
// el archivo que NO se importa no protege nada. Lo cazó el consejo del 28.
const V9 = wf.nodes.some((n) => n.name === 'Aplicar Verificador');

if (V9) {
  const A = orig.parameters.jsCode, B = twin.parameters.jsCode;
  const fallos = [];

  // 1. Invariantes del gemelo: es la 2ª pasada y lee del Aclarador.
  if (!/const SEGUNDA_PASADA = true;/.test(B)) fallos.push('el gemelo no tiene SEGUNDA_PASADA = true');
  if (!/const SEGUNDA_PASADA = false;/.test(A)) fallos.push('el original no tiene SEGUNDA_PASADA = false');
  if (B.includes("$('Parsear Respuesta')")) fallos.push('el gemelo lee de Parsear Respuesta (debería ser Aplicar Aclarador)');
  if (!B.includes("$('Aplicar Aclarador')")) fallos.push('el gemelo no lee de Aplicar Aclarador');

  // 2. Las asimetrías siguen siendo asimetrías (si aparecen en el gemelo, alguien
  //    aplicó de más y el render va a nombrar el producto equivocado).
  for (const [frag, quien] of [
    ['const elegirVariante = (vs) =>', 'elección de variante'],
    ['let nombreFiltro =', 'nombreFiltro'],
  ]) {
    if (!A.includes(frag)) fallos.push('el ORIGINAL perdió ' + quien);
    if (B.includes(frag)) fallos.push('el GEMELO ganó ' + quien + ' (debería vivir sólo en el original)');
  }

  // 3. Lo que SÍ tiene que estar en los dos: todo fix que el build aplica a ambos.
  //    Esta lista es la que caza "arreglé uno y me olvidé del otro".
  const EN_AMBOS = [
    ['hayCompetencia', 'competencia pre-filtro'],
    ['cambioProd', 'aviso de cambio de producto'],
    ['producto_nombre', 'nombre del producto en senales'],
    ['let pendiente = null;', 'pregunta pendiente'],
    ['pendiente = null;\n    }', 'el anti-loop limpia la pendiente'],
    ['precio especial desde', 'template de bajo_minimo sin "Ese precio"'],
    ["tipo: 'opcion'", 'pendiente en las ramas de opciones'],
    ['CLIENTE_DICE', 'supuesto del trabajo normal'],
  ];
  // Con límite de palabra: `includes('cambioProd')` daría true sobre `XXcambioProdXX`,
  // que es justamente el renombre accidental que este guard tiene que cazar.
  const tiene = (txt, frag) => (/^[A-Za-z_$][\w$]*$/.test(frag)
    ? new RegExp('(^|[^\\w$])' + frag + '($|[^\\w$])').test(txt)
    : txt.includes(frag));
  for (const [frag, quien] of EN_AMBOS) {
    const enA = tiene(A, frag), enB = tiene(B, frag);
    if (enA !== enB) fallos.push(quien + ': está en ' + (enA ? 'el original y NO en el gemelo' : 'el gemelo y NO en el original'));
    else if (!enA) fallos.push(quien + ': no está en ninguno de los dos');
  }

  if (fallos.length) {
    console.error('GEMELOS DESALINEADOS:');
    fallos.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('OK — gemelos alineados (' + EN_AMBOS.length + ' fixes en ambos, 2 asimetrías sólo en el original).');
  process.exit(0);
}

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
