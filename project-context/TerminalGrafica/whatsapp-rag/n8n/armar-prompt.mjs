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
/** Techo duro: más que esto y el prompt vuelve a pesar más que los datos. */
const TOPE_TOKENS = 3000;
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

// ── {{INSTRUCCIONES_PARTE_1}}: entre los dos separadores ═══ ──────────────────────────
const instr = filas("Instrucciones").map((f) => f[0]);
const ini = instr.findIndex((l) => /PARTE 1/.test(l));
const fin = instr.findIndex((l) => /PARTE 2/.test(l));
if (ini < 0 || fin < 0) throw new Error("no encontré los separadores de PARTE 1/2");
// La PARTE 1 está escrita para QUIEN EDITA EL EXCEL: habla de hojas y columnas. El bot no
// ve hojas — ve el texto de los chunks. Se re-apunta cada referencia a dónde el bot la
// encuentra de verdad. Mismo problema que los deícticos del chunk: el destinatario cambió.
const REAPUNTAR = [
  [/hoja Materiales: '([^']+)' y '([^']+)'/g, "el catálogo publica su '$1' y su '$2'"],
  [/Buscar en Materiales el tramo/g, "Buscar en la escala del material el tramo"],
  [/el mínimo por trabajo de la hoja Parámetros/g, "el mínimo por trabajo (ver Parámetros vigentes)"],
  [/Redondear al múltiplo indicado en Parámetros/g, "Redondear al múltiplo indicado en Parámetros vigentes"],
];
let PARTE_1 = instr.slice(ini + 1, fin).join("\n").trim();
for (const [re, rep] of REAPUNTAR) {
  const antes = PARTE_1;
  PARTE_1 = PARTE_1.replace(re, rep);
  // Si el cliente reescribe la PARTE 1, este reemplazo deja de aplicar en silencio y el
  // prompt vuelve a hablarle al bot de hojas de cálculo. Mejor que falle el build.
  if (PARTE_1 === antes) throw new Error(`la PARTE 1 ya no dice: ${re}`);
}

// ── {{PARAMETROS}} ─────────────────────────────────────────────────────────────────────
const PARAMETROS = filas("Parámetros").slice(1).map(([p, v, nota]) => `- ${p}: ${v}${nota ? ` (${nota})` : ""}`).join("\n");

// ── {{CASOS_PARAMETROS}}: las filas marcadas "(activa el …)" ───────────────────────────
const CASOS = filas("Casos de prueba")
  .slice(1)
  .filter((f) => /\(activa el/.test(f[0]))
  .map((f) => `- ${f[0].replace(/\s*\(activa el.*\)/, "")} → $${Number(f.at(-1)).toLocaleString("es-AR")}`)
  .join("\n");

const PLANTILLA = fs.readFileSync(path.join(AQUI, "../plans/system-prompt-v1.md"), "utf8");

const prompt = PLANTILLA
  .replace("{{INSTRUCCIONES_PARTE_1}}", PARTE_1)
  .replace("{{PARAMETROS}}", PARAMETROS)
  .replace("{{CASOS_PARAMETROS}}", CASOS);

const sinResolver = prompt.match(/\{\{[A-Z_]+\}\}/g);
if (sinResolver) throw new Error(`placeholders sin resolver: ${sinResolver.join(" ")}`);

const tokens = Math.round(prompt.length / CHARS_POR_TOKEN);
fs.writeFileSync(path.join(AQUI, "prompt-final.txt"), prompt);

console.log(`PARTE_1: ${PARTE_1.length} ch · PARAMETROS: ${PARAMETROS.length} ch · CASOS: ${CASOS.length} ch`);
console.log(`\nprompt: ${prompt.length} chars · ~${tokens} tokens → n8n/prompt-final.txt`);
if (tokens > TOPE_TOKENS) {
  console.error(`\n✗ ABORTADO: ${tokens} tokens supera el techo de ${TOPE_TOKENS}.`);
  process.exit(1);
}
if (tokens > OBJETIVO_TOKENS) console.log(`⚠ pasa el objetivo de ${OBJETIVO_TOKENS} (techo ${TOPE_TOKENS}).`);
else console.log(`✓ dentro del objetivo de ${OBJETIVO_TOKENS}.`);

/** Para que build-flow.mjs lo meta en el JSON del flow sin re-implementar nada. */
export { prompt, tokens };
