// Ingesta RAG del catálogo → embeddings → bot.producto_embeddings (plan rag-lite-bot).
//
//   pnpm tsx scripts/rag-ingest.ts --dry     # arma e imprime los chunks, sin API ni DB
//   pnpm tsx scripts/rag-ingest.ts           # --sql (default): genera rag-embeddings-data.sql
//   pnpm tsx scripts/rag-ingest.ts --apply   # upsert directo vía pg (necesita DATABASE_URL)
//
// Reingesta = truncate + insert completo (el catálogo son ~90 productos; full re-embed
// cuesta centavos). Env: OPENROUTER_API_KEY (salvo --dry), DATABASE_URL (solo --apply).

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExport } from "../lib/catalog/loader";
import { chunksDeExport, type RagChunk } from "../lib/catalog/rag-chunk";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELO = "google/gemini-embedding-001";
const DIMS = 1536; // Matryoshka: se trunca a esto y se re-normaliza L2 del lado del cliente
const EMBED_URL = "https://openrouter.ai/api/v1/embeddings";
const BATCH = 100;

// Export del catálogo (fuente compartida en el contexto de whatsapp-automation, al lado).
// Override con --export <path>.
const DEFAULT_EXPORT = resolve(
  HERE,
  "../../whatsapp-automation/db/export-actualizado-catalogo.json",
);
const OUT_SQL = join(HERE, "..", "rag-embeddings-data.sql");

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (flag: string) => process.argv.includes(flag);

function cargarChunks(): RagChunk[] {
  const path = argVal("--export") || DEFAULT_EXPORT;
  const { data } = parseExport(readFileSync(path, "utf8"));
  const chunks = chunksDeExport(data.productos, data.rubros);
  console.error(`Export: ${path}\nProductos: ${data.productos.length} → chunks: ${chunks.length} (excluye ocultos)`);
  return chunks;
}

/** Trunca a DIMS y normaliza L2. Garantiza dimensión estable sin depender de OpenRouter. */
function truncarNormalizar(v: number[]): number[] {
  if (v.length < DIMS) throw new Error(`El embedding tiene ${v.length} dims (< ${DIMS}); no se puede truncar.`);
  const t = v.slice(0, DIMS);
  const norma = Math.sqrt(t.reduce((s, x) => s + x * x, 0)) || 1;
  return t.map((x) => x / norma);
}

async function embedBatch(textos: string[]): Promise<number[][]> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Falta OPENROUTER_API_KEY en el entorno.");
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODELO, input: textos }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  // OpenRouter/OpenAI no garantiza el orden → reordenar por index.
  const out: number[][] = new Array(textos.length);
  for (const d of json.data) out[d.index] = truncarNormalizar(d.embedding);
  if (out.some((x) => !x)) throw new Error("La respuesta de embeddings no cubrió todos los inputs.");
  return out;
}

async function embedTodos(chunks: RagChunk[]): Promise<number[][]> {
  const res: number[][] = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const lote = chunks.slice(i, i + BATCH);
    console.error(`Embediando ${i + 1}–${i + lote.length} de ${chunks.length}…`);
    res.push(...(await embedBatch(lote.map((c) => c.texto))));
  }
  return res;
}

const hashDe = (texto: string) => createHash("sha256").update(`${texto}|${MODELO}|${DIMS}`).digest("hex");
const vecLiteral = (v: number[]) => `[${v.join(",")}]`;
const sqlStr = (s: string | null) => (s === null ? "null" : `'${s.replace(/'/g, "''")}'`);
const sqlArr = (a: string[]) => `array[${a.map((x) => sqlStr(x)).join(",")}]::text[]`;
const sqlNum = (n: number | null) => (n === null ? "null" : String(n));

function filaSql(c: RagChunk, vec: number[]): string {
  const m = c.meta;
  return (
    `  ('${m.producto_id}', ${sqlStr(m.nombre_canonico)}, ${sqlStr(c.texto)}, ${sqlStr(hashDe(c.texto))}, ` +
    `${sqlStr(m.rubro)}, ${m.familias.length ? sqlArr(m.familias) : "'{}'::text[]"}, ${sqlStr(m.nicho)}, ` +
    `${sqlNum(m.precio_desde)}, ${sqlNum(m.precio_hasta)}, ${m.precio_confiable}, ` +
    `'${vecLiteral(vec)}'::vector, ${sqlStr(MODELO)})`
  );
}

function generarSql(chunks: RagChunk[], vecs: number[][]): string {
  const cols =
    "producto_id, nombre_canonico, chunk_text, content_hash, rubro, familias, nicho, " +
    "precio_desde, precio_hasta, precio_confiable, embedding, modelo";
  const filas = chunks.map((c, i) => filaSql(c, vecs[i])).join(",\n");
  return (
    `-- Generado por scripts/rag-ingest.ts — NO commitear (ruido de vectores).\n` +
    `-- Reingesta idempotente: truncate + insert. Aplicar tras rag-embeddings.sql.\n` +
    `begin;\ntruncate bot.producto_embeddings;\ninsert into bot.producto_embeddings\n  (${cols})\nvalues\n${filas};\ncommit;\n`
  );
}

async function upsert(chunks: RagChunk[], vecs: number[][]): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL para --apply.");
  const { Client } = await import("pg"); // import dinámico: --sql/--dry no requieren pg
  const cli = new Client({ connectionString: url });
  await cli.connect();
  try {
    await cli.query("begin");
    await cli.query("truncate bot.producto_embeddings");
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const m = c.meta;
      await cli.query(
        `insert into bot.producto_embeddings
          (producto_id, nombre_canonico, chunk_text, content_hash, rubro, familias, nicho,
           precio_desde, precio_hasta, precio_confiable, embedding, modelo)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::vector,$12)`,
        [m.producto_id, m.nombre_canonico, c.texto, hashDe(c.texto), m.rubro, m.familias, m.nicho,
          m.precio_desde, m.precio_hasta, m.precio_confiable, vecLiteral(vecs[i]), MODELO],
      );
    }
    await cli.query("commit");
    console.error(`Upsert OK: ${chunks.length} filas en bot.producto_embeddings.`);
  } catch (e) {
    await cli.query("rollback");
    throw e;
  } finally {
    await cli.end();
  }
}

async function main() {
  const chunks = cargarChunks();

  if (has("--dry")) {
    for (const c of chunks) console.log(`\n### ${c.title}\n${c.texto}\n  meta: ${JSON.stringify(c.meta)}`);
    console.error(`\n--dry: ${chunks.length} chunks impresos, sin API ni DB.`);
    return;
  }

  const vecs = await embedTodos(chunks);

  if (has("--apply")) {
    await upsert(chunks, vecs);
  } else {
    writeFileSync(OUT_SQL, generarSql(chunks, vecs), "utf8");
    console.error(`SQL escrito en ${OUT_SQL} (${chunks.length} filas). Aplicar con psql o el SQL Editor.`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
