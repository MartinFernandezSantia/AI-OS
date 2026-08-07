// Consulta RAG desde la terminal — "dispararle preguntas" sin n8n (plan rag-lite-bot).
//
//   pnpm rag:query "sirve para plotear un plano a1?"
//   pnpm rag:query --inmobiliarias "cartel para vender una casa"
//
// Embebe la pregunta con el MISMO modelo que la ingesta (gemini-embedding-001) y hace KNN coseno
// sobre bot.rag_catalogo. Los flags de nicho son solo para PROBAR el guard blando localmente
// (en el bot real el nicho lo maneja el prompt del agente). Env: OPENROUTER_API_KEY, DATABASE_URL.

const MODELO = "models/gemini-embedding-001";
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/${MODELO}:embedContent`;
const TABLE = "bot.rag_catalogo";

const has = (flag: string) => process.argv.includes(flag);
const pregunta = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ").trim();

async function embed(texto: string): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY (API key de Google AI Studio).");
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODELO, content: { parts: [{ text: texto }] } }),
  });
  if (!res.ok) throw new Error(`Google embeddings ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { embedding: { values: number[] } };
  return json.embedding.values;
}

async function main() {
  if (!pregunta) {
    console.error('Uso: pnpm rag:query [--medicina|--inmobiliarias] "tu pregunta"');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL.");

  const vec = await embed(pregunta);
  const { Client } = await import("pg");
  const local = /localhost|127\.0\.0\.1/.test(url);
  const cli = new Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
  await cli.connect();
  try {
    // Guard de nicho blando (solo para testing local): un producto de nicho solo aparece si se
    // pasó el flag correspondiente. En el bot real esto lo decide el agente por prompt.
    const { rows } = await cli.query(
      `select metadata->>'nombre_canonico' as nombre,
              metadata->>'rubro'           as rubro,
              metadata->>'nicho'           as nicho,
              round((1 - (embedding <=> $1::vector))::numeric, 4) as sim,
              text
         from ${TABLE}
        where metadata->>'nicho' is null
           or (metadata->>'nicho' = 'medicina'      and $2)
           or (metadata->>'nicho' = 'inmobiliarias' and $3)
        order by embedding <=> $1::vector
        limit 8`,
      [`[${vec.join(",")}]`, has("--medicina"), has("--inmobiliarias")],
    );
    console.log(`\nPregunta: ${pregunta}`);
    console.log(`Flags nicho: medicina=${has("--medicina")} inmobiliarias=${has("--inmobiliarias")}\n`);
    if (!rows.length) {
      console.log("(sin candidatos — ¿la tabla está poblada? corré rag:ingest)");
      return;
    }
    rows.forEach((r, i) =>
      console.log(`${i + 1}. [${r.sim}] ${r.nombre}  (${r.rubro || "s/rubro"}${r.nicho ? `, nicho:${r.nicho}` : ""})`),
    );
  } finally {
    await cli.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
