// Consulta RAG desde la terminal — "dispararle preguntas" sin n8n (plan rag-lite-bot).
//
//   pnpm rag:query "sirve para plotear un plano a1?"
//   pnpm rag:query --inmobiliarias "cartel para vender una casa"
//
// Embebe la pregunta con el MISMO modelo que la ingesta (gemini-embedding-001) y hace KNN coseno
// sobre bot.rag_catalogo. Los flags de nicho son solo para PROBAR el guard blando localmente
// (en el bot real el nicho lo maneja el prompt del agente). Env: OPENROUTER_API_KEY, DATABASE_URL.

const MODELO = "google/gemini-embedding-001";
const EMBED_URL = "https://openrouter.ai/api/v1/embeddings";
const TABLE = "bot.rag_catalogo";

const has = (flag: string) => process.argv.includes(flag);
const pregunta = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ").trim();

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
  return json.data[0].embedding;
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
  const cli = new Client({ connectionString: url });
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
