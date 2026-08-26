import "server-only";

// Embeddings vía la API de Google AI Studio (Gemini).
//
// El modelo tiene que ser EL MISMO que usa el nodo "Embeddings Google Gemini" de n8n al
// consultar, o los vectores no son comparables y el retrieval devuelve cualquier cosa.
// Igual de importante el taskType: los documentos se embeben con RETRIEVAL_DOCUMENT y las
// consultas con RETRIEVAL_QUERY. Sin esa distinción los vectores colapsan a matching léxico.
//
// Mismo contrato que whatsapp-rag-lite/scripts/rag-ingest.ts — si cambia allá, cambia acá.

const MODELO = "models/gemini-embedding-001";
const URL = `https://generativelanguage.googleapis.com/v1beta/${MODELO}:batchEmbedContents`;
const BATCH = 100;

/** Precio por millón de tokens de gemini-embedding-001, para el estimado de costo. */
export const USD_POR_MILLON = 0.15;

async function embedLote(textos: string[], key: string): Promise<number[][]> {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: textos.map((t) => ({
        model: MODELO,
        taskType: "RETRIEVAL_DOCUMENT",
        content: { parts: [{ text: t }] },
      })),
    }),
  });
  if (!res.ok) throw new Error(`Google embeddings ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as { embeddings?: { values: number[] }[] };
  const out = (json.embeddings ?? []).map((e) => e.values);
  if (out.length !== textos.length || out.some((v) => !v?.length)) {
    throw new Error("La respuesta de embeddings no cubrió todos los textos enviados.");
  }
  return out;
}

/**
 * Embebe todos los textos, en lotes. El orden de salida respeta el de entrada.
 * Se guarda la dimensión NATIVA del modelo (sin truncar), igual que el CLI del bot lite.
 */
export async function embeder(textos: string[]): Promise<number[][]> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY en .env.local (API key de Google AI Studio).");

  const out: number[][] = [];
  for (let i = 0; i < textos.length; i += BATCH) {
    out.push(...(await embedLote(textos.slice(i, i + BATCH), key)));
  }

  const dims = new Set(out.map((v) => v.length));
  if (dims.size > 1) {
    throw new Error(`Dimensiones inconsistentes entre embeddings: ${[...dims].join(", ")}.`);
  }
  return out;
}
