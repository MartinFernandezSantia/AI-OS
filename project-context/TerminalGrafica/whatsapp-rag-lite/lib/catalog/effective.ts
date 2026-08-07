// Helpers de dominio: cómo se ve un producto DESPUÉS de aplicar la curación en curso.
// Portado VERBATIM del curador. `⟲auto` marca el auto-sinónimo del nombre viejo (se
// muestra en UI, se strippea antes de matchear / generar SQL).

import type { Producto, ProdState, Variante } from "./types";
import { norm, nkProd, nkVar } from "./keys";

/** Estado inicial de curación de un producto, sembrado desde el export. */
export function initProdState(p: Producto): ProdState {
  return {
    status: "pendiente",
    nk: nkProd(p),
    display: p.display_name || "",
    sinonimos: [...(p.sinonimos || [])],
    casos: [...(p.casos_de_uso || [])],
    auto_sinonimo: p.auto_sinonimo,
    oculto: p.oculto,
    por_pagina: p.por_pagina,
    por_pack: p.por_pack,
    variantes: Object.fromEntries(
      (p.variantes || []).map((v) => [
        v.variante_id,
        { display: v.display_variante || "", oculto: v.oculto, nk: nkVar(v) },
      ]),
    ),
  };
}

/** Nombre efectivo (display curado o el nombre vivo). = nombre_canonico del bot. */
export const nombreEf = (p: Producto, s: ProdState): string => (s.display || "").trim() || p.nombre_vivo;

/** Sinónimos efectivos: los curados + el auto-sinónimo del nombre viejo si aplica. */
export function sinonimosEf(p: Producto, s: ProdState): string[] {
  const out = [...s.sinonimos];
  const d = (s.display || "").trim();
  if (d && d !== p.nombre_vivo && s.auto_sinonimo && !out.some((x) => norm(x) === norm(p.nombre_vivo))) {
    out.push(p.nombre_vivo + " ⟲auto");
  }
  return out;
}

/** Marca de la escalera de precio: '' override/qr>1/$0 · '**' 1 regla qr · '*' resto con precio. */
export function marca(v: Variante): string {
  if (v.tiene_override) return "";
  if ((v.n_reglas_cantidad || 0) > 1) return "";
  if ((v.n_reglas_cantidad || 0) === 1) return "**";
  if (!(Number(v.precio_lista) > 0)) return "";
  return "*";
}

/** La línea que el LLM ve en el prompt (usarPropuesto=false → actual, true → curada). */
export function lineaLLM(p: Producto, s: ProdState, usarPropuesto: boolean): string {
  const nombre = usarPropuesto ? nombreEf(p, s) : p.display_name || p.nombre_vivo;
  const sin = usarPropuesto ? sinonimosEf(p, s).map((x) => x.replace(" ⟲auto", "")) : p.sinonimos;
  const casos = usarPropuesto ? s.casos : p.casos_de_uso;
  const vars = p.variantes.filter((v) => !(usarPropuesto ? s.variantes[v.variante_id].oculto : v.oculto));
  const ops = vars.map(
    (v) =>
      ((usarPropuesto ? (s.variantes[v.variante_id].display || "").trim() : (v.display_variante || "").trim()) ||
        v.nombre_vivo) + marca(v),
  );
  let l = "- " + nombre;
  if (sin.length) l += " — también: " + sin.join(", ");
  if (casos.length) l += " — usos: " + casos.join(", ");
  if (ops.length) l += " — opciones: " + ops.join(", ");
  return l;
}

/** ¿La curación difiere del export (hay algo para escribir)? */
export function cambio(p: Producto, s: ProdState): boolean {
  if ((s.display || "") !== (p.display_name || "")) return true;
  if (JSON.stringify(s.sinonimos) !== JSON.stringify(p.sinonimos)) return true;
  if (JSON.stringify(s.casos) !== JSON.stringify(p.casos_de_uso)) return true;
  if (s.auto_sinonimo !== p.auto_sinonimo || s.oculto !== p.oculto || s.por_pagina !== p.por_pagina || s.por_pack !== p.por_pack)
    return true;
  for (const v of p.variantes) {
    const sv = s.variantes[v.variante_id];
    if ((sv.display || "") !== (v.display_variante || "") || sv.oculto !== v.oculto) return true;
  }
  return false;
}
