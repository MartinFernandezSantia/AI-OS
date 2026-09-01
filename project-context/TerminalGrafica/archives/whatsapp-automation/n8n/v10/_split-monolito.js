#!/usr/bin/env node
// =============================================================================
// _split-monolito.js — desagrega faq-bot-v10-live.json en un archivo por nodo.
// =============================================================================
// PARA QUÉ. El workflow vivo es un JSON monolítico ilegible en diff. Este script
// lo parte, byte-exacto, en un archivo por nodo bajo ./nodes/, más un mapa de
// conexiones (CONEXIONES.md). Los nodos-agente se guardan JUNTO con sus sub-nodos
// (modelo, parser, tools), porque en n8n no funcionan separados.
//
// ES EL MOTOR DE SINCRONIZACIÓN. Flujo de trabajo:
//   1. editás el workflow en n8n
//   2. exportás el monolito sobre ../flows/faq-bot-v10-live.json
//   3. corrés:  node _split-monolito.js
//   4. `git diff` te muestra EXACTAMENTE qué nodos cambiaron
// Para actualizar UN nodo en n8n sin re-importar todo: pegá el .json de ./nodes/.
//
// La verdad vive en el monolito; esta carpeta es su proyección legible + versionable.
// NO editar los archivos de ./nodes/ a mano esperando que suban al monolito: la
// dirección de sync es monolito -> nodes/, no al revés.
// =============================================================================
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'flows', 'faq-bot-v10-live.json');
const OUTDIR = path.join(__dirname, 'nodes');

const wf = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const nodes = Array.isArray(wf.nodes) ? wf.nodes : [];
const conns = wf.connections || {};
const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));

// --- 1. detectar sub-nodos: los conectados a un nodo por un puerto ai_* -------
const AI = ['ai_languageModel', 'ai_outputParser', 'ai_tool', 'ai_memory', 'ai_embedding'];
const parentOf = {}; // subNodo -> nodo dueño
for (const [src, out] of Object.entries(conns)) {
  for (const type of AI) {
    if (!out[type]) continue;
    for (const grp of out[type]) for (const c of grp) parentOf[src] = c.node;
  }
}

// --- 2. agrupar: cada nodo main lleva sus sub-nodos ai_ ------------------------
const groups = {}; // nodoMain -> [nodoMain, ...subNodos]
for (const n of nodes) if (!parentOf[n.name]) groups[n.name] = [n];
for (const n of nodes) {
  if (!parentOf[n.name]) continue;
  const p = parentOf[n.name];
  (groups[p] || (groups[p] = [byName[p]])).push(n);
}

// --- 3. slug para nombres de archivo -----------------------------------------
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/·/g, '-').replace(/[¿?¡!().]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

// --- 4. escribir un archivo por grupo (formato pegable en n8n) ----------------
if (fs.existsSync(OUTDIR)) fs.rmSync(OUTDIR, { recursive: true, force: true });
fs.mkdirSync(OUTDIR, { recursive: true });

const index = [];
const usedSlugs = {};
for (const [main, grp] of Object.entries(groups)) {
  const names = new Set(grp.map((n) => n.name));
  // conexiones INTERNAS del grupo (los cables ai_ sub-nodo -> agente). Las main
  // hacia afuera NO van: el archivo es un nodo aislado, re-importable.
  const localConns = {};
  for (const nm of names) {
    if (!conns[nm]) continue;
    const filtered = {};
    for (const [type, arr] of Object.entries(conns[nm])) {
      const kept = arr.map((g) => g.filter((c) => names.has(c.node)));
      if (kept.some((g) => g.length)) filtered[type] = kept;
    }
    if (Object.keys(filtered).length) localConns[nm] = filtered;
  }
  let base = slug(main) || 'nodo';
  if (usedSlugs[base]) base = base + '-' + (++usedSlugs[base]);
  else usedSlugs[base] = 1;
  const file = base + '.json';
  fs.writeFileSync(path.join(OUTDIR, file),
    JSON.stringify({ nodes: grp, connections: localConns }, null, 2) + '\n');
  index.push({ main, file, subs: grp.slice(1).map((n) => n.name), type: grp[0].type });
}
index.sort((a, b) => a.main.localeCompare(b.main));

// --- 5. CONEXIONES.md: índice + cableado main exacto --------------------------
const short = (t) => (t || '').split('.').pop();
let md = '';
md += '# v10 — nodos desagregados + mapa de conexiones\n\n';
md += '> Generado por `_split-monolito.js` desde `../flows/faq-bot-v10-live.json`.\n';
md += '> **No editar a mano** esta carpeta esperando que suba al monolito: la sync es\n';
md += '> monolito → nodes/. Para el modelo mental por etapas, ver `../../MAPA.md`.\n\n';
md += '## Cómo se usa\n\n';
md += '- **Sincronizar:** exportá el workflow sobre el monolito y corré `node _split-monolito.js`. `git diff` muestra qué nodos cambiaron.\n';
md += '- **Actualizar un nodo en n8n:** importá/pegá su `.json` de `nodes/` (trae el nodo + sus sub-nodos ai_).\n\n';
md += `## Índice de nodos (${index.length} archivos, ${nodes.length} nodos)\n\n`;
md += '| archivo | nodo | tipo | sub-nodos incluidos |\n|---|---|---|---|\n';
for (const it of index) {
  md += `| \`nodes/${it.file}\` | ${it.main} | ${short(it.type)} | ${it.subs.length ? it.subs.join(', ') : '—'} |\n`;
}
md += '\n## Cableado (conexiones `main`, en orden de salida)\n\n';
md += 'Cada línea: nodo origen → por cada salida `[i]`, los destinos. Los nodos Switch/If\ntienen varias salidas; el índice `[i]` es el orden del puerto.\n\n';
for (const n of nodes) {
  const out = conns[n.name];
  if (!out || !out.main) continue;
  const parts = out.main.map((grp, i) => {
    const dests = (grp || []).map((c) => c.node).join(', ');
    return dests ? `[${i}]→ ${dests}` : null;
  }).filter(Boolean);
  if (parts.length) md += `- **${n.name}**  ${parts.join('   ')}\n`;
}
md += '\n## Sub-nodos ai_ (modelo / parser / tool → agente)\n\n';
for (const [sub, agent] of Object.entries(parentOf)) {
  md += `- \`${sub}\` → **${agent}**\n`;
}
fs.writeFileSync(path.join(__dirname, 'CONEXIONES.md'), md);

console.log(`OK: ${index.length} archivos de nodo (${nodes.length} nodos), CONEXIONES.md actualizado.`);
