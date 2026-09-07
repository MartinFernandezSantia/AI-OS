"use client";

import { useState } from "react";
import { ingestar, previewIngesta, type Hojas, type Preview } from "@/lib/actions";
import type { Estrategia } from "@/lib/chunk";

type Estado =
  | { fase: "cerrado" }
  | { fase: "cargando" }
  | { fase: "confirmar"; preview: Preview }
  | { fase: "ingestando"; preview: Preview }
  | { fase: "listo"; insertadas: number; destino: string }
  | { fase: "error"; mensaje: string };

function Fila({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-[var(--color-text-muted)]">{label}</span>
      <span className="text-right text-sm font-medium">{children}</span>
    </div>
  );
}

export function IngestDialog({
  hojas,
  estrategia,
  nChunks,
}: {
  hojas: Hojas;
  estrategia: Estrategia;
  nChunks: number;
}) {
  const [e, setE] = useState<Estado>({ fase: "cerrado" });

  async function abrir() {
    setE({ fase: "cargando" });
    try {
      setE({ fase: "confirmar", preview: await previewIngesta(hojas, estrategia) });
    } catch (err) {
      setE({ fase: "error", mensaje: err instanceof Error ? err.message : String(err) });
    }
  }

  async function confirmar(preview: Preview) {
    setE({ fase: "ingestando", preview });
    const r = await ingestar(hojas, estrategia);
    setE(
      r.ok
        ? { fase: "listo", insertadas: r.insertadas!, destino: r.destino! }
        : { fase: "error", mensaje: r.error! },
    );
  }

  const cerrar = () => setE({ fase: "cerrado" });

  return (
    <>
      <button
        onClick={abrir}
        disabled={e.fase === "cargando"}
        className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-sm text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {e.fase === "cargando" ? "Consultando…" : `Cargar ${nChunks} bloques`}
      </button>

      {e.fase !== "cerrado" && e.fase !== "cargando" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(ev) => {
            // Cerrar al clic afuera, salvo mientras escribe (interrumpir a medias confunde).
            if (ev.target === ev.currentTarget && e.fase !== "ingestando") cerrar();
          }}
        >
          <div className="w-full max-w-md rounded-lg border bg-[var(--color-surface)] p-5 shadow-lg">
            {e.fase === "ingestando" && (
              <div className="flex flex-col items-center justify-center gap-3 py-8">
                <span
                  aria-hidden="true"
                  className="size-9 animate-spin rounded-full border-2 border-[var(--color-border-strong)] border-t-[var(--color-primary)]"
                />
                <p className="text-sm text-[var(--color-text-muted)]">Cargando el catálogo…</p>
              </div>
            )}

            {(e.fase === "confirmar") && (
              <>
                <h2 className="text-base font-semibold">Cargar el catálogo del bot</h2>

                <div className="mt-4 divide-y rounded-md bg-[var(--color-sunken)] px-3 py-1">
                  <Fila label="Destino">
                    <code className="font-mono text-xs">{e.preview.destino}</code>
                  </Fila>
                  <Fila label="Tabla">
                    <code className="font-mono text-xs">{e.preview.tabla}</code>
                  </Fila>
                  <Fila label="Hay ahora">
                    {e.preview.filasActuales === null ? (
                      <span className="text-[var(--color-danger)]">no se pudo consultar</span>
                    ) : (
                      `${e.preview.filasActuales} filas`
                    )}
                  </Fila>
                  <Fila label="Se van a insertar">{e.preview.aInsertar} bloques</Fila>
                  <Fila label="Costo estimado">
                    ~{e.preview.tokens.toLocaleString("es-AR")} tokens (~US$
                    {e.preview.usd.toFixed(5)})
                  </Fila>
                </div>

                {e.preview.errorConteo && (
                  <p className="mt-3 rounded-md bg-[var(--color-danger-soft)] p-2 font-mono text-xs text-[var(--color-danger)]">
                    {e.preview.errorConteo}
                  </p>
                )}

                <p className="mt-4 text-sm">
                  {e.preview.filasActuales
                    ? `Esto borra las ${e.preview.filasActuales} filas actuales y las reemplaza.`
                    : "Esto reemplaza el contenido de la tabla."}{" "}
                  <span className="text-[var(--color-text-muted)]">
                    Es lo que lee el bot para contestar.
                  </span>
                </p>

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    onClick={cerrar}
                    className="rounded-md px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => confirmar(e.preview)}
                    className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-sm text-[var(--color-primary-foreground)] hover:opacity-90"
                  >
                    Sí, cargar
                  </button>
                </div>
              </>
            )}

            {e.fase === "listo" && (
              <>
                <h2 className="text-base font-semibold">Listo</h2>
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                  {e.insertadas} bloques en <code className="font-mono text-xs">{e.destino}</code>.
                  El bot ya lee esto.
                </p>
                <div className="mt-5 flex justify-end">
                  <button
                    onClick={cerrar}
                    className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-sm text-[var(--color-primary-foreground)] hover:opacity-90"
                  >
                    Cerrar
                  </button>
                </div>
              </>
            )}

            {e.fase === "error" && (
              <>
                <h2 className="text-base font-semibold text-[var(--color-danger)]">
                  No se pudo cargar
                </h2>
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                  La tabla quedó como estaba: la escritura va en una transacción.
                </p>
                <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--color-danger-soft)] p-3 font-mono text-xs text-[var(--color-danger)]">
                  {e.mensaje}
                </pre>
                <div className="mt-5 flex justify-end">
                  <button
                    onClick={cerrar}
                    className="rounded-md px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
                  >
                    Cerrar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
