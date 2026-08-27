import "server-only";

// Acceso a Postgres para la ingesta. SERVER-ONLY: el connection string nunca toca el browser.
//
// El rol es `bot_curator` (least-privilege): tiene select/insert/delete sobre bot.rag_catalog
// y nada más. OJO con TRUNCATE — en Postgres requiere ser DUEÑO de la tabla y no se puede
// otorgar por grant, así que acá se borra con DELETE. Dentro de la transacción el efecto es
// el mismo; solo cambia que no reinicia secuencias (esta tabla no tiene ninguna).

import type { Client } from "pg";

export const TABLA = "bot.rag_catalog";

/** Host de la conexión, para mostrarlo en la confirmación. Nunca expone credenciales. */
export function destino(): string {
  const url = process.env.BOT_DB;
  if (!url) return "(sin configurar)";
  try {
    const u = new URL(url);
    return u.port && u.port !== "5432" ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return "(connection string inválido)";
  }
}

async function conectar(): Promise<Client> {
  const url = process.env.BOT_DB;
  if (!url) {
    throw new Error(
      "Falta BOT_DB en .env.local — connection string del rol bot_curator (pooler de Supabase, puerto 5432).",
    );
  }
  const { Client } = await import("pg");
  // Supabase exige SSL; en local no. El pooler usa cert propio → rejectUnauthorized false.
  const local = /localhost|127\.0\.0\.1/.test(url);
  const cli = new Client({
    connectionString: url,
    ssl: local ? undefined : { rejectUnauthorized: false },
  });
  await cli.connect();
  return cli;
}

/** Cuántas filas hay hoy en la tabla. Sirve para avisar qué se va a pisar. */
export async function contarFilas(): Promise<number> {
  const cli = await conectar();
  try {
    const r = await cli.query<{ n: string }>(`select count(*)::text as n from ${TABLA}`);
    return Number(r.rows[0]?.n ?? 0);
  } finally {
    await cli.end();
  }
}

export interface FilaIngesta {
  texto: string;
  meta: Record<string, unknown>;
  embedding: number[];
}

/**
 * Reemplaza el contenido de la tabla, en UNA transacción: si algo falla, rollback y la tabla
 * queda como estaba. Idempotente — lo que se ve en el visor es exactamente lo que queda.
 */
export async function reemplazarCatalogo(filas: FilaIngesta[]): Promise<number> {
  if (!filas.length) throw new Error("No hay chunks para ingestar.");

  const cli = await conectar();
  try {
    await cli.query("begin");
    // En Supabase pgvector vive en el schema `extensions`, y el search_path del rol
    // (`"$user", public`) no lo incluye: el cast `::vector` sin calificar falla con
    // `type "vector" does not exist`. SET LOCAL muere con la transacción.
    await cli.query("set local search_path = public, extensions");
    await cli.query(`delete from ${TABLA}`);
    for (const f of filas) {
      await cli.query(
        `insert into ${TABLA} (text, metadata, embedding) values ($1, $2::jsonb, $3::vector)`,
        [f.texto, JSON.stringify(f.meta), `[${f.embedding.join(",")}]`],
      );
    }
    await cli.query("commit");
    return filas.length;
  } catch (e) {
    await cli.query("rollback").catch(() => {});
    throw e;
  } finally {
    await cli.end();
  }
}
