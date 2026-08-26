"use client";

import type { Estrategia } from "@/lib/chunk";
import type { Stats } from "@/lib/tokens";

const ETIQUETAS: Record<Estrategia, string> = {
  "coleccion-material": "Colección + material",
  coleccion: "Colección",
  producto: "Producto",
};

interface Props {
  hojas: string[];
  stats: Stats;
  /** Cuántos chunks da cada estrategia, para mostrarlo en el tab sin cambiar de vista. */
  conteos: Record<Estrategia, number>;
  estrategia: Estrategia;
  onEstrategia: (e: Estrategia) => void;
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-faint)]">{label}</div>
      <div className="mt-0.5 text-sm font-medium tabular-nums">{valor}</div>
    </div>
  );
}

export function StatsBar({ hojas, stats, conteos, estrategia, onEstrategia }: Props) {
  return (
    <div className="rounded-lg border bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-center gap-1">
        {(Object.keys(ETIQUETAS) as Estrategia[]).map((e) => (
          <button
            key={e}
            onClick={() => onEstrategia(e)}
            className={[
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              e === estrategia
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]",
            ].join(" ")}
          >
            {ETIQUETAS[e]}{" "}
            <span className="tabular-nums opacity-70">({conteos[e]})</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
        <Dato label="Chunks" valor={String(stats.chunks)} />
        <Dato label="Caracteres" valor={stats.chars.toLocaleString("es-AR")} />
        <Dato label="Tokens aprox." valor={"~" + stats.tokens.toLocaleString("es-AR")} />
        <Dato
          label="Más largo"
          valor={stats.masLargo ? `${stats.masLargo.chars.toLocaleString("es-AR")} ch` : "—"}
        />
      </div>

      {stats.masLargo && (
        <p className="mt-3 truncate text-xs text-[var(--color-text-faint)]">
          El más largo es «{stats.masLargo.titulo}». Hojas leídas: {hojas.join(" · ")}
        </p>
      )}
    </div>
  );
}
