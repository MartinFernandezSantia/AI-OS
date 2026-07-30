# Curador de Propiedades (local, sin infra)

Página HTML de un solo archivo para **elegir qué fotos y videos van**, ponerles categoría y
orden, y descargar un ZIP con los archivos ya renombrados `Cocina - 1.jpg`.

Los originales **no se tocan, no se mueven y no se renombran**. Se copian dentro del ZIP.

## Cómo abrirlo

Igual que el tagger: **doble click en `curador.html`**. Anda en Firefox, Chrome o Edge, y
también por `file://` — no necesita servidor ni permisos de disco.

> Nada se sube a ningún lado. Los archivos se leen en el navegador y el ZIP se arma en tu
> máquina; no hay backend.

## Cómo usar

1. Click en **📁 Subir carpeta** y elegí la carpeta de la propiedad
   (ej: `Propiedades/Córdoba 2107 2 F`). El navegador pide confirmar que subís la carpeta:
   aceptá. El nombre de la propiedad sale de la carpeta.
2. Para cada archivo decidí **✓ Va** / **✕ No va** y tocá la **categoría**.
3. Si hace falta, ajustá el **orden** dentro de la categoría (`↑` `↓` o escribiendo el número).
4. **✓ Terminar** → te muestra el plan completo (`archivo original → nombre nuevo`) antes de
   armar nada. Revisás y confirmás.
5. Se descarga **`<carpeta> curada.zip`**. Lo descomprimís donde quieras y adentro está la
   carpeta `<carpeta> curada` con todo renombrado.

## Atajos

| Tecla | Qué hace |
|---|---|
| `↑` `↓` (o `←` `→`) | archivo anterior / siguiente |
| `A` | marcar **va** (de nuevo = volver a pendiente) |
| `D` | marcar **no va** |
| `1`–`9` | asignar las primeras 9 categorías |
| `[` `]` | subir / bajar el orden dentro de la categoría |
| `Tab` | saltar al próximo pendiente (o "va" sin categoría) |

## Qué sale

Con `Fachada` (2), `Cocina` (3) y un video en `Video`, se baja
`Nápoles 4619 curada.zip` y adentro tiene:

```
Nápoles 4619 curada/
├── Fachada - 1.jpeg
├── Fachada - 2.jpeg
├── Cocina - 1.jpeg
├── Cocina - 2.jpeg
├── Cocina - 3.jpeg
├── Video - 1.mp4
└── curado.json
```

El ZIP va **sin comprimir** (método "store"): los JPEG y MP4 ya vienen comprimidos, así que
volver a comprimirlos casi no baja el tamaño y tarda mucho más. El ZIP pesa parecido a la
suma de los archivos que elegiste.

La numeración arranca en **1 por cada categoría**. La extensión original se conserva
(`.jpeg` queda `.jpeg`, no se convierte nada).

`curado.json` queda adentro con la decisión completa (incluido el mapa
`origen → destino`), así se puede rehacer o auditar la curación después.

## Categorías

Vocabulario controlado, igual que el `VOCAB` del tagger — se edita en el objeto `VOCAB`
arriba de todo en `curador.html`:

`Fachada, Entrada, Living, Comedor, Cocina, Baño, Dormitorio, Balcón, Terraza, Patio,
Jardín, Pileta, Lavadero, Placard, Cochera, Amenities, Vista, Entorno, Aérea, Plano, Video`

El **orden del VOCAB es el orden en que salen las categorías** en la carpeta curada.
Con **+ nueva** agregás una al vuelo (esas van al final).

## Retomar más tarde

Autoguarda en el navegador por nombre de propiedad: volvés a cargar la misma carpeta y
aparece todo como lo dejaste (te avisa "↺ N restaurados" arriba a la derecha).

Para llevarlo a otra máquina o tenerlo versionado, **⬇ JSON** exporta y **⬆ Importar** lo
vuelve a aplicar (matchea por ruta relativa, y si no la encuentra, por nombre de archivo).

## Qué queda afuera

Solo entran al ZIP los archivos marcados **va** *y* con categoría. Antes de armarlo, el
modal avisa en amarillo si quedaron pendientes sin marcar o archivos "va" sin categoría.

Extensiones reconocidas — imágenes: `jpg jpeg png webp avif gif bmp heic heif tif tiff`;
videos: `mp4 mov m4v webm avi mkv 3gp mpg mpeg wmv`. Cualquier otro archivo de la carpeta
se ignora.

Si la carpeta tiene **subcarpetas**, sus fotos y videos también se levantan (se listan por
ruta). En el ZIP salen todos planos, agrupados por la categoría que les pusiste.

## Nota

Todo se hace en memoria, así que una carpeta muy grande (varios GB de video) puede hacer
trabajar al navegador. Para tandas así conviene curar de a una propiedad.
