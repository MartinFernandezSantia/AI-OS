#!/usr/bin/env bash
# Reescala fotos para ZonaProp. El lado mas largo va a MAX y el otro se
# calcula solo, asi que la proporcion nunca se toca (una 4:3 sigue 4:3).
# Solo toca las que se pasan; las que ya entran quedan intactas.
#
#   ./resize-zonaprop.sh <carpeta>                  -> <carpeta>/zonaprop/, MAX por defecto
#   ./resize-zonaprop.sh <carpeta> <salida>         -> salida a eleccion
#   MAX=1920 ./resize-zonaprop.sh <carpeta>         -> otra medida (4:3 -> 1920x1440)
#
# Requiere ffmpeg. No modifica los originales.

set -euo pipefail

MAX="${MAX:-6000}"          # lado maximo; 6000 es el tope de ZonaProp
CALIDAD="${CALIDAD:-2}"     # escala JPEG de ffmpeg: 2 = alta (1 la mejor, 31 la peor)

ENTRADA="${1:-}"
if [[ -z "$ENTRADA" || ! -d "$ENTRADA" ]]; then
  echo "Uso: $0 <carpeta-con-fotos> [carpeta-salida]" >&2
  exit 1
fi

SALIDA="${2:-$ENTRADA/zonaprop}"
mkdir -p "$SALIDA"

command -v ffmpeg >/dev/null || { echo "Falta ffmpeg." >&2; exit 1; }

total=0; redimensionadas=0; copiadas=0

while IFS= read -r -d '' foto; do
  nombre="$(basename "$foto")"
  total=$((total + 1))

  dims="$(ffprobe -v error -select_streams v:0 \
          -show_entries stream=width,height -of csv=p=0:s=x "$foto" </dev/null 2>/dev/null || true)"
  ancho="${dims%x*}"; alto="${dims#*x}"

  if [[ -z "$ancho" || -z "$alto" ]]; then
    echo "  ?? $nombre - no pude leer las dimensiones, la salteo"
    continue
  fi

  if (( ancho <= MAX && alto <= MAX )); then
    cp "$foto" "$SALIDA/$nombre"
    copiadas=$((copiadas + 1))
    echo "  ok $nombre (${ancho}x${alto}) - ya entra, copiada tal cual"
    continue
  fi

  # El lado mas largo va a MAX, el otro se calcula solo (-1) y se redondea a par.
  if (( ancho >= alto )); then
    escala="scale=${MAX}:-2"
  else
    escala="scale=-2:${MAX}"
  fi

  destino="$SALIDA/${nombre%.*}.jpg"
  # -nostdin: sin esto ffmpeg se come la lista de find y saltea archivos
  ffmpeg -nostdin -loglevel error -y -i "$foto" \
    -vf "$escala:flags=lanczos" -q:v "$CALIDAD" "$destino"

  nuevas="$(ffprobe -v error -select_streams v:0 \
            -show_entries stream=width,height -of csv=p=0:s=x "$destino" </dev/null)"
  redimensionadas=$((redimensionadas + 1))
  echo "  -> $nombre (${ancho}x${alto}) -> ${nuevas}"

done < <(find "$ENTRADA" -maxdepth 1 -type f \
           \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \
              -o -iname '*.webp' -o -iname '*.heic' \) -print0)

echo
echo "$total fotos: $redimensionadas redimensionadas, $copiadas ya estaban bien."
echo "Salida: $SALIDA"
