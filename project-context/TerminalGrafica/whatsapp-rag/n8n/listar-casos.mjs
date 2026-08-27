// Lista compacta de los casos, para tenerlos a la vista al correr la Fase 4.
import { readFileSync } from "node:fs";
import path from "node:path";

const casos = JSON.parse(readFileSync(path.join(import.meta.dirname, "casos.json"), "utf8"));
for (const [i, c] of casos.entries()) {
  const precio = c["Precio correcto"] ? "$" + c["Precio correcto"] : "(consulta)";
  const rinde = c["Piezas por unidad de cobro"] ?? "-";
  console.log(`${String(i + 1).padStart(2)}|${c["Pedido"]}|${precio}|rinde ${rinde}|${c["Material"]}`);
}
