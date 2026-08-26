// Estimador de tokens. NO es un tokenizador real: 1 token ≈ 4 chars es la regla de pulgar
// para texto latino. Alcanza para comparar estrategias entre sí, que es todo lo que se le
// pide. La UI lo muestra como "~N" para que nadie lo lea como exacto.

export const estimarTokens = (texto: string): number => Math.ceil(texto.length / 4);

export interface Stats {
  chunks: number;
  chars: number;
  tokens: number;
  /** El chunk más largo, que es el que marca el techo de un retrieval. */
  masLargo: { titulo: string; chars: number } | null;
}

export function stats(chunks: { titulo: string; texto: string }[]): Stats {
  const chars = chunks.reduce((a, c) => a + c.texto.length, 0);
  const max = chunks.reduce<{ titulo: string; chars: number } | null>(
    (a, c) => (a === null || c.texto.length > a.chars ? { titulo: c.titulo, chars: c.texto.length } : a),
    null,
  );
  return { chunks: chunks.length, chars, tokens: Math.ceil(chars / 4), masLargo: max };
}
