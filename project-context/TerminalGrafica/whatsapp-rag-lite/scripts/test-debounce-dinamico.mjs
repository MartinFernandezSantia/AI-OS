// Tests del DEBOUNCE DINAMICO del nodo "Wait — Debounce" (flow faq-bot-rag-lite-chatwoot).
//
// El Wait espera lo que FALTE para completar la ventana de 15s desde que el cliente mando el
// mensaje, en vez de 15s fijos ENCIMA de lo que ya tardaron HMAC + Filtro Ingreso + Tier-1.
// Asi el cliente espera ~15s en total, no 15+X.
//
// OJO: esto es una COPIA de la logica que vive inlineada en la expresion `amount` del nodo.
// n8n no deja testear una expresion desde afuera, asi que si tocas una, actualiza la otra.
// Correr con: node scripts/test-debounce-dinamico.mjs
//
// El caso de `created_at` en 3 formatos no es paranoia: `Decidir` ya tiene un helper num()
// justamente porque Chatwoot lo manda inconsistente (unix seg, string numerico o ISO). Aca se
// resuelve por MAGNITUD (>1e11 == milisegundos) en vez de asumir la unidad.

// replica exacta de la logica de la expresion, con Date.now() y created_at inyectables
function calc(raw, now) {
  const VENTANA = 15;
  let ms = null;
  if (typeof raw === 'number' || (raw != null && String(raw).trim() !== '' && Number.isFinite(Number(raw)))) {
    const n = Number(raw); ms = n > 1e11 ? n : n * 1000;
  } else if (raw != null) { const t = Date.parse(raw); if (Number.isFinite(t)) ms = t; }
  if (ms == null) return VENTANA;
  const transcurrido = (now - ms) / 1000;
  if (!Number.isFinite(transcurrido) || transcurrido < 0) return VENTANA;
  return Math.max(0, Math.min(VENTANA, VENTANA - transcurrido));
}

const NOW = Date.parse('2026-08-21T12:00:10.000Z'); // 10s despues del mensaje
const T0ms = Date.parse('2026-08-21T12:00:00.000Z'); // unix MILISEGUNDOS
const T0s  = T0ms / 1000;                            // unix SEGUNDOS

const casos = [
  ['unix segundos (number), 10s transcurridos', T0s, 5],
  ['unix ms (number), 10s transcurridos',        T0ms, 5],
  ['string numerico segundos',                   String(T0s), 5],
  ['ISO string',                                 '2026-08-21T12:00:00.000Z', 5],
  ['pipeline tardo 6s -> espera 9',              Date.parse('2026-08-21T12:00:04.000Z')/1000, 9],
  ['pipeline tardo 20s -> espera 0',             Date.parse('2026-08-21T11:59:50.000Z')/1000, 0],
  ['created_at ausente -> fallback 15',          null, 15],
  ['created_at basura -> fallback 15',           'no-es-fecha', 15],
  ['reloj adelantado (futuro) -> fallback 15',   Date.parse('2026-08-21T12:00:30.000Z')/1000, 15],
];

let fail = 0;
for (const [nombre, raw, esperado] of casos) {
  const got = calc(raw, NOW);
  const ok = Math.abs(got - esperado) < 0.001;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nombre.padEnd(42)} -> ${got}s (esperado ${esperado}s)`);
}
console.log(fail ? `\n${fail} FALLARON` : '\nTodos OK');
