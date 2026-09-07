"use client";

import { useMemo, useState } from "react";
import { ChunkCard } from "@/components/chunk-card";
import { Dropzone } from "@/components/dropzone";
import { IngestDialog } from "@/components/ingest-dialog";
import { StatsBar } from "@/components/stats-bar";
import type { Hojas } from "@/lib/actions";
import { avisos, chunks, type Estrategia } from "@/lib/chunk";
import { datosDeHojas } from "@/lib/parse";
import { stats } from "@/lib/tokens";
import { leerXlsx } from "@/lib/xlsx";

export default function Page() {
  // Se guardan las hojas CRUDAS (no solo los datos parseados): la ingesta las manda al server,
  // que rearma los chunks con los mismos módulos puros en vez de confiar en lo que venga del browser.
  const [hojas, setHojas] = useState<Hojas | null>(null);
  const [nombre, setNombre] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [estrategia, setEstrategia] = useState<Estrategia>("coleccion-material");

  async function cargar(f: File) {
    setCargando(true);
    setError(null);
    try {
      setHojas(await leerXlsx(await f.arrayBuffer()));
      setNombre(f.name);
    } catch (e) {
      // Herramienta interna: el mensaje crudo sirve más que un texto amable.
      setError(e instanceof Error ? e.message : String(e));
      setHojas(null);
      setNombre(null);
    } finally {
      setCargando(false);
    }
  }

  const datos = useMemo(() => (hojas ? datosDeHojas(hojas) : null), [hojas]);

  // Las tres estrategias salen de los mismos datos: cambiar de tab no re-parsea el archivo.
  const todas = useMemo(() => {
    if (!datos) return null;
    return {
      "coleccion-material": chunks(datos, "coleccion-material"),
      coleccion: chunks(datos, "coleccion"),
      producto: chunks(datos, "producto"),
    } as Record<Estrategia, ReturnType<typeof chunks>>;
  }, [datos]);

  const actuales = todas?.[estrategia] ?? [];

  // Problemas que el chunk no puede mostrar (rinde faltante, drift, pieza que no entra).
  const problemas = useMemo(() => (datos ? avisos(datos) : []), [datos]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Visor del catálogo</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Los bloques de texto que va a leer el bot, tal cual se van a cargar. Todo en memoria:
          no escribe a ninguna base.
        </p>
      </header>

      <Dropzone onArchivo={cargar} cargando={cargando} cargado={nombre} />

      {error && (
        <div className="mt-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--color-danger)]">No se pudo leer el archivo</p>
          <p className="mt-1 font-mono text-xs text-[var(--color-danger)]">{error}</p>
        </div>
      )}

      {datos && todas && hojas && (
        <>
          {problemas.length > 0 && (
            <div className="mt-4 rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-4">
              <p className="text-sm font-medium text-[var(--color-warning)]">
                {problemas.length === 1
                  ? "1 problema que el bloque no muestra"
                  : `${problemas.length} problemas que los bloques no muestran`}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {problemas.map((a, i) => (
                  <li key={i} className="text-xs text-[var(--color-warning)]">
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6">
            <StatsBar
              hojas={datos.hojas}
              stats={stats(actuales)}
              conteos={{
                "coleccion-material": todas["coleccion-material"].length,
                coleccion: todas.coleccion.length,
                producto: todas.producto.length,
              }}
              estrategia={estrategia}
              onEstrategia={setEstrategia}
            />
          </div>

          {actuales.length === 0 ? (
            <p className="mt-6 rounded-lg border bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-muted)]">
              El archivo se leyó pero no salió ningún bloque. ¿Tiene las hojas Productos y
              Materiales con esos nombres?
            </p>
          ) : (
            <>
              <div className="mt-6 flex items-center justify-between gap-4">
                <p className="text-sm text-[var(--color-text-muted)]">
                  Esto es lo que va a leer el bot.
                </p>
                <IngestDialog hojas={hojas} estrategia={estrategia} nChunks={actuales.length} />
              </div>

              <div className="mt-3 space-y-3">
                {actuales.map((c, i) => (
                  <ChunkCard key={`${estrategia}-${i}`} chunk={c} indice={i} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
