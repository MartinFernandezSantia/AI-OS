# Tagger de Propiedades (local, sin infra)

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
- **calidad**: buena, recuperable, mala, duplicada
- **problemas** (varios): autos, personas, cartel-alquila, muebles, objetos, desorden, muy-oscura — solo cosas que se ven a simple vista. La calidad técnica de la foto la evalúa Claude al editar.
- **uso** (varios): zonaprop, web, ficha, descartar
- **portada**: ★ marca la foto principal del aviso
- **notas**: texto libre

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
      "calidad": "recuperable",
      "problemas": ["autos", "cartel-alquila"],
      "uso": ["web", "zonaprop"],
      "notas": "",
      "portada": true
    }
  ]
}
```

La columna **problemas** es la que alimenta el prompt de limpieza en Higgsfield: dice exactamente qué sacar de cada foto.
