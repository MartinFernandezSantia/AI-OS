// Migra la curación (bot.product/variant/job/job_material) de dev → prod, PRESERVANDO los id.
// Corré ANTES scripts/migrate-catalog-verify.ts y confirmá veredicto ✅.
//
//   DEV_DATABASE_URL=...  PROD_DATABASE_URL=...  pnpm tsx scripts/migrate-catalog-apply.ts          # dry-run (rollback)
//   DEV_DATABASE_URL=...  PROD_DATABASE_URL=...  pnpm tsx scripts/migrate-catalog-apply.ts --apply  # commitea
//   ...  --force   # permite escribir aunque prod NO esté vacío (por default aborta)
//
// Copia en orden de FK: product → variant → job → job_material. Toda la escritura va en UNA
// transacción en prod: si algo falla, rollback total. Preserva los id (bot.variant.product_id y
// bot.job_material.* dependen de ellos). El FK bot.variant.variant_id → public.product_variants(id)
// asume que verify dio ✅ (todos los variant_id existen en el public de prod).

import { Client } from "pg";

const DEV = process.env.DEV_DATABASE_URL;
const PROD = process.env.PROD_DATABASE_URL;
const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
if (!DEV || !PROD) {
  console.error("Faltan DEV_DATABASE_URL y/o PROD_DATABASE_URL en el entorno.");
  process.exit(1);
}

// Orden de inserción = orden de FK. Columnas explícitas (incluye id, para preservarlo).
const TABLES: { rel: string; cols: string[] }[] = [
  { rel: "bot.product", cols: ["id", "key", "bot_name", "synonyms", "use_cases", "niche", "note", "hidden", "updated_at"] },
  { rel: "bot.variant", cols: ["id", "product_id", "variant_id", "bot_name", "sale_unit", "pack_units", "by_pack", "hidden", "updated_at"] },
  { rel: "bot.job", cols: ["id", "key", "bot_name", "synonyms", "use_cases", "niche", "note", "show_total", "hidden", "updated_at"] },
  { rel: "bot.job_material", cols: ["id", "job_id", "bot_variant_id"] },
];

function connect(url: string) {
  const local = /localhost|127\.0\.0\.1/.test(url);
  return new Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
}
const count = async (cli: Client, rel: string) => (await cli.query(`select count(*)::int n from ${rel}`)).rows[0].n as number;

async function main() {
  const dev = connect(DEV!);
  const prod = connect(PROD!);
  await dev.connect();
  await prod.connect();
  try {
    // Guarda: prod debe estar vacío (salvo --force).
    let prodNoVacio = false;
    for (const { rel } of TABLES) if ((await count(prod, rel)) > 0) prodNoVacio = true;
    if (prodNoVacio && !FORCE) {
      console.error("⛔ bot.product/variant/job de prod NO está vacío. Corré verify, revisá, y usá --force si de verdad querés escribir encima.");
      process.exit(1);
    }

    await prod.query("begin");
    let total = 0;
    for (const { rel, cols } of TABLES) {
      const src = await dev.query(`select ${cols.join(", ")} from ${rel}`);
      const collist = cols.join(", ");
      const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
      for (const row of src.rows) {
        await prod.query(`insert into ${rel} (${collist}) values (${ph})`, cols.map((c) => row[c]));
      }
      console.log(`  ${rel.padEnd(18)} ${src.rows.length} filas insertadas`);
      total += src.rows.length;
    }

    if (APPLY) {
      await prod.query("commit");
      console.log(`\n✅ COMMIT: ${total} filas migradas a prod.`);
    } else {
      await prod.query("rollback");
      console.log(`\n🧪 DRY-RUN (rollback): ${total} filas se insertarían OK. Volvé a correr con --apply para commitear.`);
    }
  } catch (e) {
    await prod.query("rollback").catch(() => {});
    throw e;
  } finally {
    await dev.end();
    await prod.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
