// Qué hay REALMENTE ingestado en bot.rag_catalog: cuántos chunks, de cuándo, y los datos
// de metadata que el auditor necesita. Solo LEE.
//
// Sirve para no deducir el estado de la base desde el Excel: son dos cosas distintas y la
// que manda para el bot es la base.
//
//   node visor/scripts/estado-ingesta.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

// .env.local solo para sacar BOT_DB. No se imprime nunca.
const ENV = path.resolve(import.meta.dirname, "../.env.local");
for (const linea of readFileSync(ENV, "utf8").split("\n")) {
  const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
if (!process.env.BOT_DB) throw new Error("falta BOT_DB en .env.local");

const cliente = new pg.Client({ connectionString: process.env.BOT_DB, ssl: { rejectUnauthorized: false } });
await cliente.connect();

const { rows } = await cliente.query(`
  select
    text,
    metadata->>'coleccion'  as coleccion,
    metadata->>'material'   as material,
    metadata->>'modo'       as modo,
    metadata ? 'escala'     as tiene_escala,
    metadata ? 'es_base'    as tiene_es_base,
    metadata ? 'sin_minimo' as tiene_sin_minimo,
    metadata->>'sin_minimo' as sin_minimo
  from bot.rag_catalog
  order by metadata->>'coleccion', metadata->>'material'
`);

console.log(`${rows.length} chunks en bot.rag_catalog\n`);
for (const r of rows) {
  const faltan = [
    !r.tiene_escala && "escala",
    !r.tiene_es_base && "es_base",
    !r.tiene_sin_minimo && "sin_minimo",
  ].filter(Boolean);
  console.log(
    `  ${(r.coleccion ?? "?").padEnd(24)} | ${(r.material ?? "?").padEnd(46)} | ${(r.modo ?? "?").padEnd(7)}` +
      `${faltan.length ? "  ⚠ SIN " + faltan.join(", ") : `  sin_minimo=${r.sin_minimo}`}`,
  );
}

// Los precios que el bot está leyendo AHORA para los materiales m2, que es donde cambió
// la tarifa. Se saca del texto porque es lo que ve el modelo.
console.log("\n── precios por m2 según el texto ingestado ──");
for (const r of rows.filter((x) => x.modo === "m2")) {
  const m = r.text.match(/Precio por m2 — [^:]+: \$[\d.]+/);
  if (m) console.log(`  ${m[0]}`);
}

await cliente.end();
