// Reconstrucción de bot.variant (dropeada por accidente) desde el export v4.
// Genera db/rebuild-variant.sql: DDL + índices + RLS + policy + grant (todo se fue con el DROP)
// y repuebla las variantes VISIBLES del export, resolviendo product_id por JOIN a la bot.product
// viva (key = producto_id). NO reconstruye variantes hidden=true (el export las filtra).
//
//   node scripts/rebuild-variant.mjs            # lee el export default, escribe db/rebuild-variant.sql
//   node scripts/rebuild-variant.mjs <export>   # override de ruta
//
// Aplica MARTIN como owner en el SQL editor (convención: Claude prepara, Martin aplica).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPORT = process.argv[2]
  || resolve(HERE, "../../whatsapp-automation/db/export-actualizado-catalogo-v4.json");
const OUT = join(HERE, "..", "db", "rebuild-variant.sql");

// El SQL editor de Supabase vuelca el resultado como [{ export: { ...v4 } }].
const raw = JSON.parse(readFileSync(EXPORT, "utf8"));
const exp = Array.isArray(raw) ? raw[0].export : (raw.export ?? raw);
const productos = exp.productos;

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;         // literal SQL con escape de comilla
const lit = (v) => (v === null || v === undefined ? "null" : v); // number/bool crudos, null → null

const filas = [];
for (const p of productos) {
  for (const it of p.items || []) {
    const attrs = it.atributos || {};
    const origen = it.variante_origen ?? null;
    // bot_name explícito solo si el display curado difiere del nombre vivo; si no, null (cascada).
    const botName =
      origen != null && it.nombre_variante_bot && it.nombre_variante_bot !== origen
        ? it.nombre_variante_bot
        : null;
    const saleUnit = attrs.unidad_venta ?? null;
    const packUnits = attrs.pack_unidades ?? null;
    filas.push(
      `  (${q(p.producto_id)}, ${q(it.variante_id)}, ${botName === null ? "null" : q(botName)}, ` +
        `${saleUnit === null ? "null" : q(saleUnit)}, ${lit(packUnits)}, ${it.por_pack ? "true" : "false"})`,
    );
  }
}

const sql = `-- Reconstrucción de bot.variant desde ${EXPORT.split("/").pop()} (${exp.exportado}).
-- La tabla fue DROPEADA por accidente: esto recrea DDL + índices + RLS + policy + grant y repuebla.
-- Repuebla ${filas.length} variantes VISIBLES. CAVEAT: el export excluye hidden=true → esas NO se restauran.
-- Aplica como OWNER (bypasa RLS). Fuente del DDL: db/schema-bot.sql §2.
begin;

-- 1. Tabla + índices (idéntico a schema-bot.sql §2) ----------------------------------------------
create table if not exists bot.variant (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references bot.product(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  bot_name   text,
  sale_unit  bot.sale_unit,
  pack_units integer,
  by_pack    boolean not null default false,
  hidden     boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (product_id, variant_id)
);
create unique index if not exists bot_variant_variant_uq  on bot.variant (variant_id);
create index        if not exists bot_variant_product_idx on bot.variant (product_id);

-- 2. RLS + policy + grant (se fueron con el DROP) ------------------------------------------------
alter table bot.variant enable row level security;
drop policy if exists curator_all on bot.variant;
create policy curator_all on bot.variant for all to bot_curator using (true) with check (true);
grant select, insert, update, delete on bot.variant to bot_curator;

-- 3. Datos: product_id se resuelve por JOIN a la bot.product viva (key = producto_id) ------------
insert into bot.variant (product_id, variant_id, bot_name, sale_unit, pack_units, by_pack)
select p.id, v.variant_id::uuid, v.bot_name, v.sale_unit::bot.sale_unit, v.pack_units::int, v.by_pack
from (values
${filas.join(",\n")}
) as v(product_key, variant_id, bot_name, sale_unit, pack_units, by_pack)
join bot.product p on p.key = v.product_key;

commit;

-- Verificación (esperado: ${filas.length} filas; 0 productos-key sin match):
--   select count(*) from bot.variant;
--   select v.product_key from (values ...) ... left join bot.product p on p.key = v.product_key where p.id is null;
`;

writeFileSync(OUT, sql);
console.error(`OK: ${filas.length} variantes → ${OUT}`);
console.error(`Productos con items: ${productos.filter((p) => (p.items || []).length).length} de ${productos.length}`);
