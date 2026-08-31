// Arma el system prompt del bot: la plantilla (plans/system-prompt-v1.md) + las 3
// inyecciones leídas del Excel. Escribe n8n/prompt-final.txt y mide el resultado.
//
// Es el prototipo del builder de la Fase 3: `build-flow.mjs` va a importar `armarPrompt()`
// y meter el resultado en el JSON del flow. Se separa así para poder ver e iterar el
// prompt sin tocar el workflow.
//
//   node n8n/armar-prompt.mjs
import fs from "node:fs";
import path from "node:path";
import { abrir, cadenasDe, dec } from "../visor/scripts/lib-xlsx.mjs";

const AQUI = import.meta.dirname;
/** Techo duro: más que esto y el prompt vuelve a pesar más que los datos.
 * 3000→3050 el 2026-08-31 al sumar la regla anti pregunta+cotización (ejecución 732):
 * el prompt quedó en ~3010. Si vuelve a chocar, toca RECORTAR, no subir de nuevo. */
const TOPE_TOKENS = 3050;
const OBJETIVO_TOKENS = 2000;
/** Castellano ≈ 3,3 chars por token. Estimación, igual que visor/lib/tokens.ts. */
const CHARS_POR_TOKEN = 3.3;

const { entradas } = abrir();
const wbXml = entradas.find((e) => e.nombre === "xl/workbook.xml").contenido.toString("utf8");
const hojas = [...wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"[^>]*\/?>/g)].map((m) => ({ nombre: m[1], rid: m[2] }));
const rels = entradas.find((e) => e.nombre === "xl/_rels/workbook.xml.rels").contenido.toString("utf8");
const ridToTarget = Object.fromEntries([...rels.matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
const cadenas = cadenasDe(entradas.find((e) => e.nombre === "xl/sharedStrings.xml").contenido.toString("utf8"));

/** Filas de una hoja como arrays de celdas con dato. */
function filas(nombreHoja) {
  const h = hojas.find((x) => x.nombre === nombreHoja);
  const xml = entradas.find((e) => e.nombre === "xl/" + ridToTarget[h.rid].replace(/^\//, "")).contenido.toString("utf8");
  const out = [];
  for (const fila of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas = [];
    for (const c of fila[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const vm = (c[2] || "").match(/<v>([\s\S]*?)<\/v>/);
      if (!vm) continue;
      let val = vm[1];
      if (/t="s"/.test(c[1])) val = cadenas[Number(val)] ?? val;
      celdas.push(dec(String(val)).trim());
    }
    if (celdas.length) out.push(celdas);
  }
  return out;
}

// ── La PARTE 1 (la fórmula de cotización) YA NO VA AL PROMPT ─────────────────────────
// Desde v2 el LLM no calcula: declara qué cotizar y el nodo Code hace la cuenta (ver el
// auditor en build-flow.mjs). La fórmula sigue viviendo en el Excel y la sigue consumiendo
// el auditor a través de FUENTE_COTIZAR — pero el modelo ya no la necesita.
//
// Se sigue LEYENDO y validando igual: si el cliente reescribe esas líneas, el build tiene
// que romper. La PARTE 1 es la especificación del cálculo, y `build-flow.mjs` verifica que
// el auditor la reproduzca contra los 46 casos. Perder la validación sería perder el aviso
// de que la fuente de verdad cambió.
const instr = filas("Instrucciones").map((f) => f[0]);
const ini = instr.findIndex((l) => /PARTE 1/.test(l));
const fin = instr.findIndex((l) => /PARTE 2/.test(l));
if (ini < 0 || fin < 0) throw new Error("no encontré los separadores de PARTE 1/2");
const ESPERADAS = [
  /hoja Materiales: '([^']+)' y '([^']+)'/,
  /Buscar en Materiales el tramo/,
  /el mínimo por trabajo de la hoja Parámetros/,
  /Redondear al múltiplo indicado en Parámetros/,
];
const PARTE_1 = instr.slice(ini + 1, fin).join("\n").trim();
for (const re of ESPERADAS) {
  if (!re.test(PARTE_1)) throw new Error(`la PARTE 1 ya no dice: ${re}`);
}

// ── {{PARAMETROS}} ─────────────────────────────────────────────────────────────────────
// Van al prompt solo para que el bot pueda EXPLICARLOS si el cliente pregunta. Aplicarlos
// es tarea del nodo Code, que los tiene horneados desde la misma hoja.
const PARAMETROS = filas("Parámetros").slice(1).map(([p, v, nota]) => `- ${p}: ${v}${nota ? ` (${nota})` : ""}`).join("\n");

const PLANTILLA = fs.readFileSync(path.join(AQUI, "../plans/system-prompt-v1.md"), "utf8");

const prompt = PLANTILLA.replace("{{PARAMETROS}}", PARAMETROS);

const sinResolver = prompt.match(/\{\{[A-Z_]+\}\}/g);
if (sinResolver) throw new Error(`placeholders sin resolver: ${sinResolver.join(" ")}`);

const tokens = Math.round(prompt.length / CHARS_POR_TOKEN);
fs.writeFileSync(path.join(AQUI, "prompt-final.txt"), prompt);

console.log(`PARTE_1: ${PARTE_1.length} ch (validada, NO inyectada) · PARAMETROS: ${PARAMETROS.length} ch`);
console.log(`\nprompt: ${prompt.length} chars · ~${tokens} tokens → n8n/prompt-final.txt`);
if (tokens > TOPE_TOKENS) {
  console.error(`\n✗ ABORTADO: ${tokens} tokens supera el techo de ${TOPE_TOKENS}.`);
  process.exit(1);
}
if (tokens > OBJETIVO_TOKENS) console.log(`⚠ pasa el objetivo de ${OBJETIVO_TOKENS} (techo ${TOPE_TOKENS}).`);
else console.log(`✓ dentro del objetivo de ${OBJETIVO_TOKENS}.`);

/** Para que build-flow.mjs lo meta en el JSON del flow sin re-implementar nada. */
export { prompt, tokens };
