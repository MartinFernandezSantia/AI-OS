// Consulta RAG desde la terminal — "dispararle preguntas" sin Chatwoot (plan rag-lite-bot).
//
//   pnpm tsx scripts/rag-query.ts "sirve para plotear un plano a1?"
//   pnpm tsx scripts/rag-query.ts --inmobiliarias "cartel para vender una casa"
//   pnpm tsx scripts/rag-query.ts --medicina "recetarios"
//
// Embebe la pregunta (misma truncación L2 a 1536 que la ingesta) y llama a bot.match_productos.
// Env: OPENROUTER_API_KEY, DATABASE_URL.

const MODELO = "google/gemini-embedding-001";
const DIMS = 1536;
const EMBED_URL = "https://openrouter.ai/api/v1/embeddings";

const has = (flag: string) => process.argv.includes(flag);
const pregunta = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ").trim();

function truncarNormalizar(v: number[]): number[] {
  if (v.length < DIMS) throw new Error(`El embedding tiene ${v.length} dims (< ${DIMS}).`);
  const t = v.slice(0, DIMS);
  const norma = Math.sqrt(t.reduce((s, x) => s + x * x, 0)) || 1;
  return t.map((x) => x / norma);
}

async function embed(texto: string): Promise<number[]> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Falta OPENROUTER_API_KEY.");
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODELO, input: [texto] }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return truncarNormalizar(json.data[0].embedding);
}

async function main() {
  if (!pregunta) {
    console.error('Uso: pnpm tsx scripts/rag-query.ts [--medicina|--inmobiliarias] "tu pregunta"');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL.");

  const vec = await embed(pregunta);
  const { Client } = await import("pg");
  const cli = new Client({ connectionString: url });
  await cli.connect();
  try {
    const { rows } = await cli.query(
      "select nombre_canonico, rubro, nicho, precio_desde, precio_hasta, precio_confiable, " +
        "round(similitud::numeric, 4) as sim, chunk_text " +
        "from bot.match_productos($1::vector, 8, $2, $3)",
      [`[${vec.join(",")}]`, has("--medicina"), has("--inmobiliarias")],
    );
    console.log(`\nPregunta: ${pregunta}`);
    console.log(`Flags nicho: medicina=${has("--medicina")} inmobiliarias=${has("--inmobiliarias")}\n`);
    if (!rows.length) {
      console.log("(sin candidatos — revisá que la tabla esté poblada)");
      return;
    }
    rows.forEach((r, i) => {
      const precio = r.precio_confiable ? ` — $${r.precio_desde}${r.precio_hasta !== r.precio_desde ? `–${r.precio_hasta}` : ""}` : "";
      console.log(`${i + 1}. [${r.sim}] ${r.nombre_canonico}  (${r.rubro || "s/rubro"}${r.nicho ? `, nicho:${r.nicho}` : ""})${precio}`);
    });
  } finally {
    await cli.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
