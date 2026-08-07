// Ingesta RAG del catálogo → embeddings → bot.rag_catalogo (plan rag-lite-bot, enfoque nativo).
//
//   pnpm rag:ingest --dry     # arma e imprime los chunks, sin API ni DB
//   pnpm rag:ingest           # --sql (default): genera rag-embeddings-data.sql (truncate+insert)
//   pnpm rag:ingest --apply   # upsert directo vía pg (necesita DATABASE_URL admin)
//
// El vector se guarda con la dimensión NATIVA del modelo (sin truncar): la query en n8n usa el
// MISMO modelo (google/gemini-embedding-001), así los vectores son comparables. Reingesta =
// truncate + insert. Env: OPENROUTER_API_KEY (salvo --dry), DATABASE_URL (solo --apply).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExport } from "../lib/catalog/loader";
import { chunksDeExport, type RagChunk } from "../lib/catalog/rag-chunk";

const HERE = dirname(fileURLToPath(import.meta.url));
// Embeddings vía API de Google AI Studio (Gemini) — MISMO proveedor/modelo que el nodo
// "Embeddings Google Gemini" de n8n (así los vectores de ingesta y query son comparables).
const MODELO = "models/gemini-embedding-001";
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/${MODELO}:batchEmbedContents`;
const BATCH = 100;
const TABLE = "bot.rag_catalogo";

// Export del catálogo (fuente compartida en el contexto de whatsapp-automation, al lado).
const DEFAULT_EXPORT = resolve(HERE, "../../whatsapp-automation/db/export-actualizado-catalogo.json");
const OUT_SQL = join(HERE, "..", "rag-embeddings-data.sql");

const argVal = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (flag: string) => process.argv.includes(flag);

function cargarChunks(): RagChunk[] {
  const path = argVal("--export") || DEFAULT_EXPORT;
  const { data } = parseExport(readFileSync(path, "utf8"));
  const chunks = chunksDeExport(data.productos, data.rubros);
  console.error(`Export: ${path}\nProductos: ${data.productos.length} → chunks: ${chunks.length} (excluye ocultos)`);
  return chunks;
}

async function embedBatch(textos: string[]): Promise<number[][]> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY (API key de Google AI Studio) en el entorno.");
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: textos.map((t) => ({ model: MODELO, content: { parts: [{ text: t }] } })),
    }),
  });
  if (!res.ok) throw new Error(`Google embeddings ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { embeddings: { values: number[] }[] };
  const out = (json.embeddings || []).map((e) => e.values); // orden = orden de requests; dim nativa
  if (out.length !== textos.length || out.some((x) => !x)) {
    throw new Error("La respuesta de embeddings no cubrió todos los inputs.");
  }
  return out;
}

async function embedTodos(chunks: RagChunk[]): Promise<number[][]> {
  const res: number[][] = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const lote = chunks.slice(i, i + BATCH);
    console.error(`Embediando ${i + 1}–${i + lote.length} de ${chunks.length}…`);
    res.push(...(await embedBatch(lote.map((c) => c.texto))));
  }
  const dims = new Set(res.map((v) => v.length));
  console.error(`Dimensión de los embeddings: ${[...dims].join("/")} (todas deben coincidir).`);
  if (dims.size > 1) throw new Error("Dimensiones inconsistentes entre embeddings.");
  return res;
}

const vecLiteral = (v: number[]) => `[${v.join(",")}]`;
const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;
const metaObj = (c: RagChunk) => ({
  producto_id: c.meta.producto_id,
  nombre_canonico: c.meta.nombre_canonico,
  rubro: c.meta.rubro,
  nicho: c.meta.nicho,
  familias: c.meta.familias,
  precio_desde: c.meta.precio_desde,
  precio_hasta: c.meta.precio_hasta,
  precio_confiable: c.meta.precio_confiable,
  precios: c.meta.precios,
});

function generarSql(chunks: RagChunk[], vecs: number[][]): string {
  const filas = chunks
    .map((c, i) => `  (${sqlStr(c.texto)}, ${sqlStr(JSON.stringify(metaObj(c)))}::jsonb, ${sqlStr(vecLiteral(vecs[i]))}::vector)`)
    .join(",\n");
  return (
    `-- Generado por scripts/rag-ingest.ts — NO commitear (ruido de vectores).\n` +
    `-- Reingesta idempotente. Aplicar tras rag-embeddings.sql (como owner/admin).\n` +
    `begin;\ntruncate ${TABLE};\ninsert into ${TABLE} (text, metadata, embedding)\nvalues\n${filas};\ncommit;\n`
  );
}

async function upsert(chunks: RagChunk[], vecs: number[][]): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL para --apply.");
  const { Client } = await import("pg");
  // Supabase (pooler o directo) exige SSL; en local no. Usá el connection string del
  // POOLER (aws-0-...pooler.supabase.com:5432) — el directo db.<ref>.supabase.co es IPv6-only.
  const local = /localhost|127\.0\.0\.1/.test(url);
  const cli = new Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
  await cli.connect();
  try {
    await cli.query("begin");
    await cli.query(`truncate ${TABLE}`);
    for (let i = 0; i < chunks.length; i++) {
      await cli.query(
        `insert into ${TABLE} (text, metadata, embedding) values ($1, $2::jsonb, $3::vector)`,
        [chunks[i].texto, JSON.stringify(metaObj(chunks[i])), vecLiteral(vecs[i])],
      );
    }
    await cli.query("commit");
    console.error(`Upsert OK: ${chunks.length} filas en ${TABLE}.`);
  } catch (e) {
    await cli.query("rollback");
    throw e;
  } finally {
    await cli.end();
  }
}

/** Refresca text + metadata (incluye precios) SIN re-embeber. Los dígitos de precio no mueven la
 *  semántica del vector, así que un cambio de precios se aplica barato con esto. Match por producto_id. */
async function pricesOnly(chunks: RagChunk[]): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL para --prices-only.");
  const { Client } = await import("pg");
  const local = /localhost|127\.0\.0\.1/.test(url);
  const cli = new Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
  await cli.connect();
  try {
    let n = 0;
    for (const c of chunks) {
      const r = await cli.query(
        `update ${TABLE} set text = $1, metadata = $2::jsonb where metadata->>'producto_id' = $3`,
        [c.texto, JSON.stringify(metaObj(c)), c.meta.producto_id],
      );
      n += r.rowCount || 0;
    }
    console.error(`--prices-only: ${n} filas actualizadas (text+metadata, sin re-embeber).`);
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

  if (has("--prices-only")) {
    await pricesOnly(chunks);
    return;
  }

  const vecs = await embedTodos(chunks);

  if (has("--apply")) {
    await upsert(chunks, vecs);
  } else {
    writeFileSync(OUT_SQL, generarSql(chunks, vecs), "utf8");
    console.error(`SQL escrito en ${OUT_SQL} (${chunks.length} filas). Aplicar como owner/admin.`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
