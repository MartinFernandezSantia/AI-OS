"use client";

import { useCallback, useRef, useState } from "react";

interface Props {
  onArchivo: (f: File) => void;
  cargando: boolean;
  /** Nombre del archivo ya cargado, para mostrar en modo compacto. */
  cargado: string | null;
}

export function Dropzone({ onArchivo, cargando, cargado }: Props) {
  const [encima, setEncima] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const soltar = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setEncima(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onArchivo(f);
    },
    [onArchivo],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setEncima(true);
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={soltar}
      onClick={() => input.current?.click()}
      className={[
        "cursor-pointer rounded-lg border-2 border-dashed px-6 text-center transition-colors",
        cargado ? "py-4" : "py-14",
        encima ? "border-[var(--color-primary)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border-strong)] bg-[var(--color-surface)] hover:bg-[var(--color-sunken)]",
      ].join(" ")}
    >
      <input
        ref={input}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onArchivo(f);
          e.target.value = ""; // permite recargar el MISMO archivo tras editarlo en Excel
        }}
      />
      {cargando ? (
        <p className="text-sm text-[var(--color-text-muted)]">Parseando…</p>
      ) : cargado ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          <span className="font-medium text-[var(--color-foreground)]">{cargado}</span>
          {" · clic o arrastrá otro para recargar"}
        </p>
      ) : (
        <>
          <p className="text-base font-medium">Arrastrá el .xlsx del catálogo</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            o hacé clic para elegirlo. Se parsea en tu navegador: no sale de tu máquina.
          </p>
        </>
      )}
    </div>
  );
}
