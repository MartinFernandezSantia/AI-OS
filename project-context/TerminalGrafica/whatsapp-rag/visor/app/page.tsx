"use client";

import { useMemo, useState } from "react";
import { ChunkCard } from "@/components/chunk-card";
import { Dropzone } from "@/components/dropzone";
import { StatsBar } from "@/components/stats-bar";
import { chunks, type Estrategia } from "@/lib/chunk";
import { datosDeHojas, type Datos } from "@/lib/parse";
import { stats } from "@/lib/tokens";
import { leerXlsx } from "@/lib/xlsx";

export default function Page() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [nombre, setNombre] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [estrategia, setEstrategia] = useState<Estrategia>("coleccion-material");

  async function cargar(f: File) {
    setCargando(true);
    setError(null);
    try {
      const hojas = await leerXlsx(await f.arrayBuffer());
      setDatos(datosDeHojas(hojas));
      setNombre(f.name);
    } catch (e) {
      // Herramienta interna: el mensaje crudo sirve más que un texto amable.
      setError(e instanceof Error ? e.message : String(e));
      setDatos(null);
      setNombre(null);
    } finally {
      setCargando(false);
    }
  }

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

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Visor de chunks</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Los bloques de texto que va a leer el bot, tal cual se van a embeber. Todo en memoria:
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

      {datos && todas && (
        <>
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
              El archivo se leyó pero no salió ningún chunk. ¿Tiene las hojas Productos y
              Materiales con esos nombres?
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {actuales.map((c, i) => (
                <ChunkCard key={`${estrategia}-${i}`} chunk={c} indice={i} />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
