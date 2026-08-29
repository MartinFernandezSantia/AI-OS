// Vuelca los parámetros de un nodo del flow emitido a un archivo JSON suelto, para poder
// pasarlos a update_workflow por el MCP sin re-importar el flow entero a mano.
//
//   node n8n/extraer-nodo.mjs "Auditar Cotización" > /tmp/x.json
import { readFileSync } from "node:fs";
import path from "node:path";

const nombre = process.argv[2];
if (!nombre) throw new Error('uso: node n8n/extraer-nodo.mjs "<nombre del nodo>"');

const flow = JSON.parse(readFileSync(path.join(import.meta.dirname, "flows/cotizador-v1.json"), "utf8"));
const nodo = flow.nodes.find((n) => n.name === nombre);
if (!nodo) throw new Error(`el flow no tiene un nodo "${nombre}" (hay: ${flow.nodes.map((n) => n.name).join(", ")})`);

process.stdout.write(JSON.stringify(nodo.parameters));
