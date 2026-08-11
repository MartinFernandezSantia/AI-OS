// Ingesta RAG del catálogo → embeddings → bot.rag_catalogo (plan rag-lite-bot, enfoque nativo).
//
//   pnpm rag:ingest --dry     # arma e imprime los chunks, sin API ni DB
//   pnpm rag:ingest           # --sql (default): genera rag-embeddings-data.sql (truncate+insert)
//   pnpm rag:ingest --apply   # upsert directo vía pg (necesita DATABASE_URL admin)
//
// INFO DEL NEGOCIO (segunda tool consultar_info_negocio; fuente = tabla bot.info_negocio):
//   pnpm rag:ingest --info --dry     # imprime las filas de bot.info_negocio (necesita DATABASE_URL)
//   pnpm rag:ingest --info           # genera rag-info-negocio-data.sql (truncate+insert)
//   pnpm rag:ingest --info --apply   # upsert directo a bot.rag_info_negocio
//
// El vector se guarda con la dimensión NATIVA del modelo (sin truncar): la query en n8n usa el
// MISMO modelo (google/gemini-embedding-001), así los vectores son comparables. Reingesta =
// truncate + insert. Env: GEMINI_API_KEY (API key de Google AI Studio, salvo --dry), DATABASE_URL
// (solo --apply). NO OpenRouter: los embeddings van por la API de Google (mismo modelo que el nodo).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExportV4 } from "../lib/catalog/loader";
import { chunksDeExport, type RagChunk } from "../lib/catalog/rag-chunk";

const HERE = dirname(fileURLToPath(import.meta.url));
// Embeddings vía API de Google AI Studio (Gemini) — MISMO proveedor/modelo que el nodo
// "Embeddings Google Gemini" de n8n (así los vectores de ingesta y query son comparables).
const MODELO = "models/gemini-embedding-001";
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/${MODELO}:batchEmbedContents`;
const BATCH = 100;
const TABLE = "bot.rag_catalogo";
// Índice vectorial de la info del negocio (segunda tool consultar_info_negocio). Fuente de verdad de
// los DATOS: bot.info_negocio (pares clave/valor curados). --info lee de ahí y embebe en TABLE_INFO.
const TABLE_INFO = "bot.rag_info_negocio";
const INFO_SOURCE = "bot.info_negocio";

// Export del catálogo v4 (modelo producto-bot; curador-export-v4.sql). Fuente compartida al lado.
const DEFAULT_EXPORT = resolve(HERE, "../../whatsapp-automation/db/export-actualizado-catalogo-v4.json");
const OUT_SQL = join(HERE, "..", "rag-embeddings-data.sql");
const OUT_SQL_INFO = join(HERE, "..", "rag-info-negocio-data.sql");

const argVal = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (flag: string) => process.argv.includes(flag);

function cargarChunks(): RagChunk[] {
  const path = argVal("--export") || DEFAULT_EXPORT;
  const { data } = parseExportV4(readFileSync(path, "utf8"));
  const chunks = chunksDeExport(data.productos);
  console.error(`Export v4: ${path}\nProducto-bot: ${data.productos.length} → chunks: ${chunks.length} (excluye ocultos)`);
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

async function embedTodos(textos: string[]): Promise<number[][]> {
  const res: number[][] = [];
  for (let i = 0; i < textos.length; i += BATCH) {
    const lote = textos.slice(i, i + BATCH);
    console.error(`Embediando ${i + 1}–${i + lote.length} de ${textos.length}…`);
    res.push(...(await embedBatch(lote)));
  }
  const dims = new Set(res.map((v) => v.length));
  console.error(`Dimensión de los embeddings: ${[...dims].join("/")} (todas deben coincidir).`);
  if (dims.size > 1) throw new Error("Dimensiones inconsistentes entre embeddings.");
  return res;
}

const vecLiteral = (v: number[]) => `[${v.join(",")}]`;
const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;
const metaObj = (c: RagChunk) => ({
  producto_id: c.meta.producto_id, // clave natural (estable testing↔prod)
  nombre_canonico: c.meta.nombre_canonico, // = nombre_bot (clave de match del flujo de precios)
  familia: c.meta.familia,
  nicho: c.meta.nicho,
  precio_desde: c.meta.precio_desde,
  precio_hasta: c.meta.precio_hasta,
  precio_confiable: c.meta.precio_confiable,
  precios: c.meta.precios, // cada uno lleva variante_id (auditoría/--prices-only)
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
    await cli.query("begin");
    let n = 0;
    const misses: string[] = [];
    for (const c of chunks) {
      const r = await cli.query(
        `update ${TABLE} set text = $1, metadata = $2::jsonb where metadata->>'producto_id' = $3`,
        [c.texto, JSON.stringify(metaObj(c)), c.meta.producto_id],
      );
      const rc = r.rowCount || 0;
      n += rc;
      if (rc === 0) misses.push(c.meta.producto_id);
    }
    await cli.query("commit");
    console.error(`--prices-only: ${n} filas actualizadas (text+metadata, sin re-embeber).`);
    if (misses.length) {
      console.error(
        `⚠️ ${misses.length} producto-bot sin fila en la tabla (requieren INGEST FULL, no --prices-only): ${misses.join(", ")}`,
      );
    }
  } catch (e) {
    await cli.query("rollback");
    throw e;
  } finally {
    await cli.end();
  }
}

// ─────────────────────────── INFO DEL NEGOCIO (--info) ───────────────────────────
// Segunda tool del agente (consultar_info_negocio). La fuente de verdad de los DATOS es la tabla
// bot.info_negocio (pares clave/valor curados a mano). --info la lee, embebe cada `valor` y llena
// bot.rag_info_negocio. Requiere DATABASE_URL (la fuente vive en la DB, no en un JSON como el catálogo).
type InfoRow = { clave: string; texto: string };
const metaInfo = (r: InfoRow) => ({ clave: r.clave });

/** Client de pg con SSL a lo Supabase (pooler/directo); en local sin SSL. Igual criterio que upsert(). */
async function pgConnect(url: string) {
  const { Client } = await import("pg");
  const local = /localhost|127\.0\.0\.1/.test(url);
  const cli = new Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
  await cli.connect();
  return cli;
}

/** Lee bot.info_negocio como filas {clave, texto}. Excluye las filas placeholder ('COMPLETAR…'). */
async function cargarInfoNegocio(): Promise<InfoRow[]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`Falta DATABASE_URL: --info lee los datos de ${INFO_SOURCE}.`);
  const cli = await pgConnect(url);
  try {
    const r = await cli.query(`select clave, valor from ${INFO_SOURCE} where valor not ilike 'COMPLETAR%' order by clave`);
    const rows: InfoRow[] = r.rows.map((x: { clave: string; valor: string }) => ({ clave: String(x.clave), texto: String(x.valor) }));
    console.error(`${INFO_SOURCE}: ${rows.length} filas (excluye placeholders 'COMPLETAR').`);
    if (!rows.length) throw new Error(`${INFO_SOURCE} vacía o inexistente: aplicá ../whatsapp-automation/db/info-negocio.sql primero.`);
    return rows;
  } finally {
    await cli.end();
  }
}

function generarSqlInfo(rows: InfoRow[], vecs: number[][]): string {
  const filas = rows
    .map((r, i) => `  (${sqlStr(r.texto)}, ${sqlStr(JSON.stringify(metaInfo(r)))}::jsonb, ${sqlStr(vecLiteral(vecs[i]))}::vector)`)
    .join(",\n");
  return (
    `-- Generado por scripts/rag-ingest.ts --info — NO commitear (ruido de vectores).\n` +
    `-- Reingesta idempotente. Aplicar tras rag-info-negocio.sql (como owner/admin).\n` +
    `begin;\ntruncate ${TABLE_INFO};\ninsert into ${TABLE_INFO} (text, metadata, embedding)\nvalues\n${filas};\ncommit;\n`
  );
}

async function upsertInfo(rows: InfoRow[], vecs: number[][]): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL para --info --apply.");
  const cli = await pgConnect(url);
  try {
    await cli.query("begin");
    await cli.query(`truncate ${TABLE_INFO}`);
    for (let i = 0; i < rows.length; i++) {
      await cli.query(`insert into ${TABLE_INFO} (text, metadata, embedding) values ($1, $2::jsonb, $3::vector)`, [
        rows[i].texto,
        JSON.stringify(metaInfo(rows[i])),
        vecLiteral(vecs[i]),
      ]);
    }
    await cli.query("commit");
    console.error(`Upsert OK: ${rows.length} filas en ${TABLE_INFO}.`);
  } catch (e) {
    await cli.query("rollback");
    throw e;
  } finally {
    await cli.end();
  }
}

async function ingestInfo(): Promise<void> {
  const rows = await cargarInfoNegocio();
  if (has("--dry")) {
    for (const r of rows) console.log(`\n### ${r.clave}\n${r.texto}`);
    console.error(`\n--info --dry: ${rows.length} filas impresas, sin API ni escritura.`);
    return;
  }
  const vecs = await embedTodos(rows.map((r) => r.texto));
  if (has("--apply")) {
    await upsertInfo(rows, vecs);
  } else {
    writeFileSync(OUT_SQL_INFO, generarSqlInfo(rows, vecs), "utf8");
    console.error(`SQL escrito en ${OUT_SQL_INFO} (${rows.length} filas). Aplicar como owner/admin.`);
  }
}

async function main() {
  // --info: rama independiente (fuente = bot.info_negocio en la DB, no el export del catálogo).
  if (has("--info")) {
    await ingestInfo();
    return;
  }

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

  const vecs = await embedTodos(chunks.map((c) => c.texto));

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
