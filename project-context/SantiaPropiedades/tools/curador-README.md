# Curador de Propiedades (local, sin infra)

Página HTML de un solo archivo para **elegir qué fotos y videos van**, ponerles categoría y
orden, y escribir una carpeta nueva con los archivos ya renombrados `Cocina - 1.jpg`.

Los originales **no se tocan, no se mueven y no se renombran**. Se copian.

## Requisito: Chrome o Edge en localhost

El Curador escribe archivos en disco, y para eso usa la File System Access API.
Eso significa que, a diferencia del `tagger.html`:

- ✅ **Chrome o Edge**, servido en `http://localhost`
- ❌ **no** funciona en Firefox
- ❌ **no** funciona abriendo el archivo con doble click (`file://`)

Desde esta carpeta:

```bash
cd project-context/SantiaPropiedades/tools
pnpm dlx serve .
```

Y abrí `http://localhost:3000/curador.html` en Chrome.

> Si el puerto 3000 está ocupado, `serve` te dice cuál usó. También sirve
> `python3 -m http.server 3000`.

## Cómo usar

1. Click en **📁 Carpeta** y elegí la carpeta de la propiedad (ej: `Propiedades/Córdoba 2107 2 F`).
   Chrome va a pedir permiso de lectura y escritura: dale **Permitir**.
2. Para cada archivo decidí **✓ Va** / **✕ No va** y tocá la **categoría**.
3. Si hace falta, ajustá el **orden** dentro de la categoría (`↑` `↓` o escribiendo el número).
4. **✓ Terminar** → te muestra el plan completo (`archivo original → nombre nuevo`) antes de
   escribir nada. Revisás y confirmás.
5. Se crea **`<carpeta> curada`** al lado de la original, con los archivos copiados y renombrados.

Chrome puede pedirte confirmar una segunda vez dónde crear la carpeta. Si pasa, elegí la
carpeta que **contiene** a la de la propiedad (ej: `Propiedades/`).

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

Con `Fachada` (2), `Cocina` (3) y un video en `Video`:

```
Nápoles 4619/                  ← intacta
Nápoles 4619 curada/
├── Fachada - 1.jpeg
├── Fachada - 2.jpeg
├── Cocina - 1.jpeg
├── Cocina - 2.jpeg
├── Cocina - 3.jpeg
├── Video - 1.mp4
└── curado.json
```

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
vuelve a aplicar (matchea por nombre de archivo).

## Qué queda afuera

Solo se copian los archivos marcados **va** *y* con categoría. Antes de escribir, el modal
avisa en amarillo si quedaron pendientes sin marcar o archivos "va" sin categoría.

Extensiones reconocidas — imágenes: `jpg jpeg png webp avif gif bmp heic heif tif tiff`;
videos: `mp4 mov m4v webm avi mkv 3gp mpg mpeg wmv`. Cualquier otro archivo de la carpeta
se ignora.
