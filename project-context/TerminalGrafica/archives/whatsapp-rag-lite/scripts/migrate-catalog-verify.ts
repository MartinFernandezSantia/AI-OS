// Verificación PREVIA a migrar la curación (bot.product/variant/job/job_material) de dev → prod.
// NO escribe nada: solo lee ambas bases y reporta si la migración es segura.
//
//   DEV_DATABASE_URL=...  PROD_DATABASE_URL=...  pnpm tsx scripts/migrate-catalog-verify.ts
//
// Chequea lo único que puede romper la copia directa: el FK bot.variant.variant_id →
// public.product_variants(id). Si cada variant_id de dev existe en el public de PROD (y, como
// control extra, el nombre de esa variante coincide entre ambos public), los UUID están
// compartidos y la copia va tal cual. Si falta alguno → hay que remapear por clave natural.
// Además confirma que bot.product/variant/job/job_material de PROD estén VACÍAS (para no pisar).

import { Client } from "pg";

const DEV = process.env.DEV_DATABASE_URL;
const PROD = process.env.PROD_DATABASE_URL;
if (!DEV || !PROD) {
  console.error("Faltan DEV_DATABASE_URL y/o PROD_DATABASE_URL en el entorno.");
  process.exit(1);
}

const NAME_CANDIDATES = ["name", "nombre", "variant_name", "nombre_variante", "title", "label", "sku"];

function connect(url: string) {
  const local = /localhost|127\.0\.0\.1/.test(url);
  return new Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
}

async function count(cli: Client, rel: string): Promise<number> {
  const r = await cli.query(`select count(*)::int as n from ${rel}`);
  return r.rows[0].n as number;
}

/** Primera columna "nombre" que exista en public.product_variants (para el control cruzado). */
async function nameCol(cli: Client): Promise<string | null> {
  const r = await cli.query(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='product_variants'`,
  );
  const cols = new Set(r.rows.map((x: { column_name: string }) => x.column_name));
  return NAME_CANDIDATES.find((c) => cols.has(c)) ?? null;
}

async function main() {
  const dev = connect(DEV!);
  const prod = connect(PROD!);
  await dev.connect();
  await prod.connect();
  try {
    // 1. Conteos de la curación en dev + estado de prod (debe estar vacío).
    console.log("── Curación en DEV ──");
    for (const t of ["bot.product", "bot.variant", "bot.job", "bot.job_material"]) {
      console.log(`  ${t.padEnd(18)} ${await count(dev, t)}`);
    }
    console.log("── Destino en PROD (debe estar VACÍO) ──");
    let prodNoVacio = false;
    for (const t of ["bot.product", "bot.variant", "bot.job", "bot.job_material"]) {
      const n = await count(prod, t);
      if (n > 0) prodNoVacio = true;
      console.log(`  ${t.padEnd(18)} ${n}${n > 0 ? "   ⚠️ NO vacío" : ""}`);
    }

    // 2. FK crítico: cada bot.variant.variant_id de dev debe existir en public.product_variants de PROD.
    const devVars = await dev.query<{ variant_id: string; producto: string; variante: string }>(
      `select v.variant_id,
              p.bot_name  as producto,
              coalesce(v.bot_name, '') as variante
       from bot.variant v join bot.product p on p.id = v.product_id`,
    );
    const ids = devVars.rows.map((r) => r.variant_id);
    const uniqIds = [...new Set(ids)];
    const present = await prod.query<{ id: string }>(
      `select id from public.product_variants where id = any($1::uuid[])`,
      [uniqIds],
    );
    const presentSet = new Set(present.rows.map((r) => r.id));
    const missing = devVars.rows.filter((r) => !presentSet.has(r.variant_id));

    console.log("\n── FK bot.variant.variant_id → PROD public.product_variants ──");
    console.log(`  Variantes en dev:        ${devVars.rows.length} (${uniqIds.length} variant_id únicos)`);
    console.log(`  Encontradas en prod:     ${presentSet.size}`);
    console.log(`  FALTAN en prod:          ${missing.length}`);
    if (missing.length) {
      console.log("  ── Sin match (requieren remapeo) ──");
      for (const m of missing.slice(0, 40)) {
        console.log(`    ${m.variant_id}  ·  ${m.producto} → ${m.variante || "(sin display)"}`);
      }
      if (missing.length > 40) console.log(`    … y ${missing.length - 40} más`);
    }

    // 3. Control cruzado de nombres para los ids que SÍ están: confirma que el mismo UUID apunta
    //    al MISMO producto en ambos public (descarta un match de UUID por casualidad).
    const col = await nameCol(prod);
    const colDev = await nameCol(dev);
    if (col && colDev && presentSet.size) {
      const idsOk = [...presentSet];
      const dn = await dev.query(`select id, ${colDev} as nombre from public.product_variants where id = any($1::uuid[])`, [idsOk]);
      const pn = await prod.query(`select id, ${col} as nombre from public.product_variants where id = any($1::uuid[])`, [idsOk]);
      const dmap = new Map(dn.rows.map((r: { id: string; nombre: string }) => [r.id, r.nombre]));
      const mism = pn.rows.filter((r: { id: string; nombre: string }) => dmap.get(r.id) !== r.nombre);
      console.log(`\n── Control cruzado de nombres (col '${col}') ──`);
      console.log(`  Ids comparados: ${idsOk.length} · nombres que NO coinciden dev↔prod: ${mism.length}`);
      for (const r of (mism as { id: string; nombre: string }[]).slice(0, 15)) {
        console.log(`    ${r.id}  dev='${dmap.get(r.id)}'  prod='${r.nombre}'`);
      }
    } else {
      console.log(`\n(Control cruzado de nombres omitido: no se detectó columna de nombre en product_variants.)`);
    }

    // 4. Veredicto.
    const ok = missing.length === 0 && !prodNoVacio;
    console.log("\n════════════════════════════════════════");
    if (ok) console.log("✅ SEGURO: copia directa. Todos los variant_id existen en prod y el destino está vacío.");
    else {
      console.log("⛔ NO copiar directo todavía:");
      if (missing.length) console.log(`   · ${missing.length} variant_id no existen en prod → remapear por clave natural.`);
      if (prodNoVacio) console.log(`   · bot.product/variant/job de prod NO está vacío → revisar antes de escribir.`);
    }
  } finally {
    await dev.end();
    await prod.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
