"use client";

import { useState } from "react";
import type { Chunk } from "@/lib/chunk";
import { estimarTokens } from "@/lib/tokens";

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-[var(--color-muted)] px-1.5 py-0.5 text-xs tabular-nums text-[var(--color-text-muted)]">
      {children}
    </span>
  );
}

export function ChunkCard({ chunk, indice }: { chunk: Chunk; indice: number }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(chunk.texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // clipboard puede fallar sin https o sin permiso; no vale romper la vista por eso
    }
  };

  // Cuántas líneas de precio lleva: con la estrategia colección+material debe ser SIEMPRE 1.
  // Si son 2 o más, el bot tiene que elegir cuál escala aplicar — eso es lo que se viene a ver.
  const nPrecios = (chunk.texto.match(/^Precio por /gm) ?? []).length;

  return (
    <article className="overflow-hidden rounded-lg border bg-[var(--color-surface)]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-[var(--color-sunken)] px-4 py-2.5">
        <span className="text-xs tabular-nums text-[var(--color-text-faint)]">
          {String(indice + 1).padStart(2, "0")}
        </span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={chunk.titulo}>
          {chunk.titulo}
        </h2>
        <Badge>{chunk.texto.length.toLocaleString("es-AR")} ch</Badge>
        <Badge>~{estimarTokens(chunk.texto)} tok</Badge>
        {typeof chunk.meta.productos === "number" && <Badge>{chunk.meta.productos} med.</Badge>}
        {nPrecios > 1 && (
          <span className="rounded-md bg-[var(--color-danger-soft)] px-1.5 py-0.5 text-xs text-[var(--color-danger)]">
            {nPrecios} escalas
          </span>
        )}
        <button
          onClick={copiar}
          className="rounded-md px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-hover)]"
        >
          {copiado ? "copiado" : "copiar"}
        </button>
      </header>

      {/* El texto EXACTO que se va a embeber: monoespaciado y respetando saltos de línea. */}
      <pre className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[13px] leading-relaxed">
        {chunk.texto}
      </pre>
    </article>
  );
}
