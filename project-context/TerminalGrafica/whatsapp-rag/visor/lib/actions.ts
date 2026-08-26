"use server";

// Server actions de la ingesta. El browser NUNCA ve la API key ni el connection string.
//
// Decisión de diseño: el cliente manda las HOJAS CRUDAS, no los chunks ya armados. El server
// los rearma con los mismos módulos puros (parse.ts / chunk.ts), así lo que se ingesta es
// reproducible desde el archivo y no depende de que el browser mande algo coherente.

import { chunks, type Chunk, type Estrategia } from "./chunk";
import { contarFilas, destino, reemplazarCatalogo, TABLA } from "./db";
import { embeder, USD_POR_MILLON } from "./embeddings";
import { datosDeHojas } from "./parse";
import { estimarTokens } from "./tokens";

export type Hojas = Record<string, string[][]>;

export interface Preview {
  destino: string;
  tabla: string;
  /** Filas que hay hoy en la tabla y que se van a borrar. null = no se pudo consultar. */
  filasActuales: number | null;
  /** Por qué no se pudo consultar, si es el caso. */
  errorConteo: string | null;
  aInsertar: number;
  tokens: number;
  usd: number;
}

/** Arma los chunks del lado del server, desde las hojas crudas. */
function armar(hojas: Hojas, estrategia: Estrategia): Chunk[] {
  const cs = chunks(datosDeHojas(hojas), estrategia);
  if (!cs.length) throw new Error("El archivo no produjo ningún chunk.");
  return cs;
}

/**
 * Lo que se muestra ANTES de escribir: a dónde va, qué se pisa, cuánto sale.
 * No escribe nada ni gasta créditos.
 */
export async function previewIngesta(hojas: Hojas, estrategia: Estrategia): Promise<Preview> {
  const cs = armar(hojas, estrategia);
  const tokens = cs.reduce((a, c) => a + estimarTokens(c.texto), 0);

  // El conteo es informativo: si la base no responde, igual se muestra el resto del preview
  // (el error real va a aparecer al confirmar, que es cuando importa).
  let filasActuales: number | null = null;
  let errorConteo: string | null = null;
  try {
    filasActuales = await contarFilas();
  } catch (e) {
    errorConteo = e instanceof Error ? e.message : String(e);
  }

  return {
    destino: destino(),
    tabla: TABLA,
    filasActuales,
    errorConteo,
    aInsertar: cs.length,
    tokens,
    usd: (tokens / 1_000_000) * USD_POR_MILLON,
  };
}

export interface Resultado {
  ok: boolean;
  insertadas?: number;
  destino?: string;
  error?: string;
}

/**
 * Embebe y reemplaza el catálogo. Esto SÍ gasta créditos y pisa la tabla.
 * Los errores vuelven como valor, no como excepción: la UI los muestra crudos.
 */
export async function ingestar(hojas: Hojas, estrategia: Estrategia): Promise<Resultado> {
  try {
    const cs = armar(hojas, estrategia);
    const vecs = await embeder(cs.map((c) => c.texto));
    const insertadas = await reemplazarCatalogo(
      cs.map((c, i) => ({ texto: c.texto, meta: c.meta, embedding: vecs[i] })),
    );
    return { ok: true, insertadas, destino: destino() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
