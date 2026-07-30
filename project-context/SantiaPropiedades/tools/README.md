# Tagger de Propiedades (local, sin infra)

> Hay dos herramientas en esta carpeta:
> - **`tagger.html`** (este archivo) — taggea las fotos para que Claude las mire y arme prompts. No renombra nada.
> - **`curador.html`** — elegí qué va y qué no, con categoría y orden, y escribe una carpeta `<nombre> curada` con los archivos renombrados `Cocina - 1.jpg`. Ver `curador-README.md`.

Página HTML de un solo archivo para taggear las fotos de cada propiedad. Sin Supabase, sin deploy, sin auth. Corre en Firefox abriendo el archivo directo (`file://`).

## Cómo usar

1. Abrí `tagger.html` en Firefox (doble click).
2. Click en **📁 Carpeta** y elegí una carpeta de `../Propiedades/` (ej: `Córdoba 2107 2 F`).
3. Taggeá cada foto. Navegá con ↑ ↓. El nombre de la propiedad sale de la carpeta.
4. **⬇ Exportar JSON** → descarga `tags.json`. Guardalo en la carpeta de esa propiedad: `Propiedades/<Propiedad>/tags.json`.
5. Para seguir más tarde: cargá la carpeta de nuevo (autoguarda en el navegador) o usá **⬆ Importar JSON** sobre un `tags.json` ya exportado.

Los archivos originales NO se tocan ni se renombran. Todo el tagging vive en el JSON.

## Dimensiones (vocabulario controlado)

- **espacio**: fachada, entrada, living, comedor, cocina, baño, dormitorio, balcón, vista, placard, lavadero, entorno, plano
- **toma**: exterior, interior, detalle, contexto
- **uso** (varios): zonaprop, web, ficha, descartar
- **portada**: ★ marca la foto principal del aviso
- **notas para Claude**: texto libre — acá dejás cualquier cosa que necesites que mire o corrija sí o sí

> Martin taggea el "qué es" (espacio/toma/destino) + notas. La calidad de la foto y qué corregir (autos, desorden, muebles, luz, etc.) lo identifica Claude mirando cada imagen.

> Editar el vocabulario = editar el objeto `VOCAB` arriba de todo en `tagger.html`.

## Formato del `tags.json`

```json
{
  "propiedad": "Córdoba 2107 2 F",
  "generado": "2026-06-27",
  "total": 25,
  "fotos": [
    {
      "archivo": "WhatsApp Image 2026-06-26 at 10.30.01 AM.jpeg",
      "espacio": "fachada",
      "toma": "exterior",
      "uso": ["web", "zonaprop"],
      "notas": "sacá los autos de adelante",
      "portada": true
    }
  ]
}
```

Con el espacio + las notas, Claude mira cada foto, decide qué limpiar/corregir y arma el prompt de Higgsfield.
