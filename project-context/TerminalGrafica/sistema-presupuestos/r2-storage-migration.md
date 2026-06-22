# Migración de storage a Cloudflare R2 + descarga de sesiones pesadas

Investigación y diseño del 2026-06-22. Datos de costos/límites verificados ese día
contra las docs oficiales de Cloudflare, Vercel y Supabase. **Re-chequear los
números el día que se implemente** — precios y límites de estos proveedores pueden
cambiar.

## Problema / requerimientos del cliente

1. Poder subir archivos **mayores a 50 MB**.
2. Que las sesiones **no estén limitadas a 200 MB** (tope auto-impuesto para no
   quemar el 1 GB free de Supabase Storage).

El **free de Supabase topea cada archivo en 50 MB** (límite duro de plataforma, no
configurable sin pasar a Pro). O sea, el requisito #1 no se cumple quedándose en
Supabase free: o se paga Pro o se mueve el storage.

## Decisión: mover solo el storage a R2

Coherente con `decisions/log.md` 2026-06-16. Mantener **Supabase free** para
Postgres (metadata + estados) y Realtime (tablero en vivo), y migrar **solo los
bytes de los archivos a R2** vía URLs prefirmadas (browser → R2 directo, subida y
descarga). Postgres + Realtime siguen gratis y no se tocan: eso es lo que hace
barata y contenida la migración.

### Por qué R2 y no Supabase Pro

| | Supabase Pro | Cloudflare R2 |
|---|---|---|
| Costo base | **USD 25/mes fijos** | **$0** (free 10 GB-mes) |
| Tope por archivo | 500 GB | ~5 GB single PUT / 5 TB multipart |
| Egress | 250 GB incluido, después se paga | **gratis siempre** |
| Latencia AR | S3 + CDN | edge Cloudflare (PoP BsAs), igual o mejor |

Para una sola imprenta, Pro es pagar USD 25/mes fijos aunque uses 2 GB. R2 da el
mismo levantamiento del límite a $0 y sin riesgo de egress. **Pro solo tendría
sentido** si se prioriza no administrar un segundo sistema (cero CORS/lifecycle/
credenciales R2) por encima de los $25/mes.

## Costos

### Implementación (one-time, trabajo de desarrollo)

Reusa casi toda la plomería del módulo broker ya construido (el del QR, que el
cliente pagó **ARS 200.000**). El cambio es swappear *dónde* viven los bytes, no
rehacer el flujo. **Esfuerzo real ~1 a 1,5 días.** Martin lo cotiza al cliente en
**ARS 70.000** (framing ~4 días) — margen holgado; recomendación interna: fundirlo
como mejora del abono mensual en vez de venderlo suelto.

### Mensual corriendo — R2 (una imprenta): **~$0/mes**

Free tier R2: 10 GB-mes storage, 1M Class A (escrituras), 10M Class B (lecturas),
egress gratis siempre. Con ~500 pedidos/mes × ~3 archivos: ~4.500 Class A y ~4.500
Class B → <0,5% del free. Overage (si lo hubiera): storage $0,015/GB-mes, Class A
$4,50/millón, Class B $0,36/millón.

### Cómputo del zip: **$0 en la VPS o $5/mes en Workers**

- **Workers free NO alcanza**: topea en **10 ms de CPU por request** y armar un zip
  de varios GB (CRC32 sobre los bytes) se pasa.
- **Opción A — VPS Hostinger** (la del producto WhatsApp, ya pagada): costo
  marginal **~$0**. Node + streaming, sin límites de CPU. Contra: acopla la
  recepción a esa VPS.
- **Opción B — Cloudflare Workers Paid: USD 5/mes fijos** (10M req + 30M CPU-ms/mes;
  un zip ~5 CPU-seg → miles de sesiones/mes antes de pagar extra). Limpio y pegado
  a R2. **DECISIÓN ABIERTA: VPS vs Worker.**

## Facturación de R2 ante picos transitorios (confirmado en doc oficial)

R2 cobra storage en **GB-mes = promedio del pico diario sobre 30 días**, NO por el
pico instantáneo. Ejemplo oficial: 1 GB por 5 días + 3 GB por 25 días = 2,66 GB-mes.

- Una sesión pesada transitoria casi no mueve el promedio → en la práctica sigue $0.
- Si el promedio del mes superara 10 GB, se paga **solo la porción excedente** a
  $0,015/GB-mes, **solo ese mes**; el siguiente recalcula de cero. No queda nada
  "pegado", no hay salto a un precio fijo.
- **No hay "plan free → plan pago"** que cambiar: el tier gratis viene incluido
  todos los meses y el excedente se factura automático por GB. Solo hace falta un
  **medio de pago cargado**.
- R2 **no frena el servicio** si te pasás; factura el excedente. → setear una
  **alerta de facturación / notificación de uso** en Cloudflare al configurar.

## Latencia: ¿R2 lee más lento que Supabase Storage?

**No — igual o más rápido.** Supabase Storage por debajo es S3 + CDN; R2 es object
storage sobre el edge de Cloudflare (PoP en Buenos Aires). First-byte R2 ~40-80 ms
global; mide 20-40% más rápido que S3 para usuarios distribuidos. Recomendación:
**descargas por dominio propio sobre Cloudflare** para máximo cacheo en el edge.

## Límites / gotchas R2 a tener en cuenta

1. **Tamaño máximo de archivo (a favor):** single PUT hasta ~4,995 GiB; multipart
   hasta 5 TB (partes mín. 5 MiB). Resuelve el requisito #1 con muchísimo headroom.
2. **CORS obligatorio** en el bucket para subidas directas del navegador.
3. **R2 NO tiene transformación de imágenes nativa** (Supabase sí: resize/thumbnails
   on-the-fly). ⚠️ **RIESGO DE REGRESIÓN A VERIFICAR ANTES DE MIGRAR:** chequear si
   el módulo usa transformaciones de Supabase para previews/thumbnails. Para
   archivos de imprenta (PDF/JPG/PNG) probablemente no, pero confirmar.
4. **R2 no tiene RLS por objeto.** Acceso por URL prefirmada (expiry máx 7 días) o
   lógica en Worker. Encaja perfecto con el modelo broker ya vigente — sin regresión.
5. Read-after-write fuertemente consistente. Carga operativa: credenciales R2, CORS,
   lifecycle de borrado (menor pero existe).

## Arquitectura de descarga de sesiones pesadas (hasta 5 GB)

### Por qué cambia respecto de hoy

Hoy la descarga + compresión a zip pasa **en el cliente** (navegador), lo cual
funciona porque las sesiones topean en 200 MB. A 5 GB el zip client-side se rompe:
memoria del navegador (revienta el tab, sobre todo en kiosko/mostrador modesto),
sin resumibilidad (un blob; si se corta en 80% empezás de cero), y CPU/tiempo.

### Restricciones duras

- **El cliente exige un contenedor único (zip), nada de archivos sueltos.**
- **El sistema corre en Vercel serverless**, que topea la **respuesta de una
  función en 4,5 MB** (error 413). → Vercel **no puede servir** un zip de 5 GB:
  queda fuera del camino de la descarga, definitivo.
- Tampoco se puede armar el zip en el navegador a 5 GB.

### Diseño que queda — tres roles separados

1. **Vercel = orquestador** (nunca toca los bytes pesados): emite URLs prefirmadas
   de subida, dispara la generación del zip, devuelve la URL de descarga + estado
   del zip. Solo maneja JSON chico.
2. **Worker (o VPS) = armador del zip:** lee cada archivo de R2 en streaming, lo
   mete en un zip y lo sube de vuelta a R2 por multipart. Patrón productivo
   documentado: ZIP64 streaming de 10 GB+ con ~128 MB de RAM (el zip nunca existe
   entero en memoria, fluye R2 → worker → R2). Vive pegado a R2 → lectura rápida y
   egress gratis. Es el único lugar que puede hacerlo dado el límite de Vercel.
3. **Descarga = directo de R2 al mostrador:** presigned GET al `session.zip`,
   bajado del edge de R2, resumible (range requests), egress gratis. Vercel ni se
   entera.

### Decisiones de diseño

- **Zip en modo "store" (sin compresión).** Los archivos de imprenta (PDF/JPG/PNG)
  ya vienen comprimidos: re-comprimir no achica nada y quema CPU. En store el worker
  solo *contiene* → trabajo casi puro de I/O, liviano, entra en los límites del
  worker. El zip pesa ~la suma de los archivos.
- **Dónde se guarda el zip:** en **R2, mismo bucket**, p. ej. clave
  `sessions/{id}/session.zip`. Nada de otro servicio. Vive ahí hasta que la
  lifecycle rule lo borra post-entrega.
- **Duplicación transitoria de bytes:** mientras coexisten archivos sueltos + zip,
  una sesión de 1 GB ocupa hasta ~2 GB. Es un **pico de segundos/minutos** durante
  el armado, no permanente. Apenas el zip está verificado se **borran los sueltos**
  (el cliente solo baja el contenedor) → vuelve a ~1 GB. Entra holgado en los 10 GB
  free igual.
- **Borrado post-entrega** aplica a zip + fuente (mantiene el promedio GB-mes bajo).
- **Estado del zip:** la sesión necesita un campo `pendiente`/`armando`/`listo`/
  `falló` para que la UI sepa qué mostrar.

### DECISIÓN ABIERTA: cuándo se arma el zip

- **Eager (recomendada):** se arma apenas la sesión se cierra. Cuando el mostrador
  la abre, el zip ya está → descarga instantánea. Toda sesión se imprime, así que
  ninguno se arma al pedo.
- **Lazy:** se arma en el primer "descargar todo", con estado "preparando...".
  Ahorra zips que nadie baje, pero mete espera en el momento que se necesita.

## Decisiones abiertas (para el plan de implementación)

1. **VPS Hostinger ($0) vs Cloudflare Workers Paid ($5/mes)** para armar el zip.
2. **Eager vs lazy** para cuándo generar el zip (recomendado: eager).
3. **Verificar** si el módulo usa transformaciones de imagen de Supabase (riesgo de
   regresión #3 arriba) — homework antes de tocar código.

## Fuentes (verificadas 2026-06-22)

- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- R2 limits: https://developers.cloudflare.com/r2/platform/limits/
- Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Vercel functions limits (4,5 MB respuesta): https://vercel.com/docs/functions/limitations
- Supabase storage file limits: https://supabase.com/docs/guides/storage/uploads/file-limits
- Streaming ZIP64 en Workers (128 MB RAM): https://dev.to/ryan_e200dd10ede43c8fc2e4/how-i-built-streaming-zip64-on-cloudflare-workers-128mb-ram-no-filesystem-3aaf
