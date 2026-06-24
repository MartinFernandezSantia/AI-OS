# Plan: R2 como storage de archivos + descarga ZIP vía Cloudflare Worker

## Context

El sistema de recepción de archivos del print-shop (proyecto `quote-automation-system` + kiosko `recepcion-cliente`) hoy guarda los archivos en **Supabase Storage** y arma el ZIP de la sesión **en el navegador del empleado** (`fflate`, store-mode, hasta 200 MB en memoria). En el presupuesto al cliente quedó sin costear el "worker" que empaqueta las sesiones pesadas.

La salida más barata es no tener un worker de fondo corriendo 24/7: generar el ZIP **al vuelo en el momento de descarga**, store-mode (sin compresión, igual que hoy — los assets de imprenta no comprimen). Para que eso sea gratis hay que correrlo en un **Cloudflare Worker pegado al bucket R2** (egress de R2 gratis, sin tope de duración de streaming), no en Vercel (Hobby tiene tope de duración de función y mide bandwidth, perdiendo el egress gratis de R2).

**Coupling clave:** el Worker lee de R2 por binding. Por eso migrar el storage a R2 es prerequisito del ahorro, no un extra opcional. Resultado final: línea "worker" del presupuesto = **$0**, sin depender del VPS de Chatwoot.

Decisiones tomadas: entrega en **2 fases**; **cutover limpio** (sesiones efímeras, TTL 12h, sin copiar datos viejos).

---

## Estado actual (hechos que mandan)

- **Dos caminos de presign distintos:**
  - **Kiosko**: navegador → broker `POST /api/reception/sessions/[id]/upload-url` (service-role, approval-gated) → `signedUrl` → PUT directo. **Ya es server-side**; solo cambia el cuerpo del presign.
  - **Mostrador (staff)**: `createStorageBackend()` en `lib/file-reception/transport/storage.ts` presigna **en el navegador** vía Supabase RLS. Con R2 esto **debe** moverse a un endpoint server-side (los secrets de R2 no pueden ir al browser).
- El ZIP bulk se arma en `components/employee/mostrador/employee-panel.tsx` (`downloadAll`) con `buildZip`/`triggerDownload` de `lib/file-reception/zip.ts`.
- `markDone`/`removeFile` del staff llaman `storage.removePrefix(...)` desde el browser — con R2 también van a server.
- Convención de key intacta: `<sessionId>/<fileId>/<safeName>` (`storagePath` + `safeName`). Las filas `files.storage_path` siguen siendo válidas contra R2.
- **`cacheComponents: true`** en `next.config.ts` → **NO declarar `export const runtime`** en los route handlers (los handlers ya corren en Node por defecto, así que `node:crypto`/`aws4fetch` funcionan sin declararlo). `fflate` solo lo usa `zip.ts`. No hay aws-sdk.
- Auth staff a reusar: `supabase.auth.getClaims()` → rechazar si `!claims || is_anonymous === true`.
- CORS hoy es **fail-open**: `cors.ts` hace echo de cualquier origin si `RECEPTION_ALLOWED_ORIGINS` está vacío. Rate-limit (`checkRateLimit`) es **no-op** si Upstash no está configurado. Ambos deben endurecerse (ver §3 Seguridad).

---

## FASE 1 — Migrar storage a Cloudflare R2

Deployable y verificable sola. Saca a Supabase Storage; el ZIP sigue armándose en el browser por ahora.

### 1.1 Backend R2 (nuevo) — `lib/file-reception/transport/r2.ts`
Librería: **`aws4fetch`** (~7 KB, sin deps, sirve en node/edge; presign SigV4 con `signQuery: true`). Se descarta `@aws-sdk/client-s3` por bundle. R2 es S3-compatible → presigned URLs funcionan directo.

Exporta:
- `r2Client()` — `AwsClient` desde env (region `auto`).
- `presignPut(key, size, expires=300)` — **query-only, NO firmar `content-type`** (evita mismatch con el header que manda el browser), pero **SÍ firmar `Content-Length: size`** (F1) → R2 rechaza un body que no coincida con el `size` declarado, así el cap de 50 MB/archivo se aplica en el storage, no solo en la DB.
- `presignGet(key, downloadName?, expires=600)` — agrega `response-content-disposition=attachment; filename=...` y **`response-content-type=application/octet-stream`** (F5) cuando hay `downloadName`, para que un archivo subido como `.svg`/`.html` no se renderice (XSS almacenado) en el preview.
- `deletePrefix(prefix)` — ListObjectsV2 (`?list-type=2&prefix=`) + DELETE por key. **R2 lista recursivo por prefijo**, así que reemplaza el walk de dos niveles de `storage.ts`.
- Reusar/copiar `safeName()` y `storagePath()` (convención de key idéntica).

### 1.2 Endpoint staff de presign (nuevo) — `app/api/reception/staff/presign/route.ts`
Gated con `getClaims()` (NO el token broker del kiosko; sin declarar `runtime`). Body `{ op: 'get'|'delete', sessionId, fileId, name }` validado con zod — **`sessionId`/`fileId` UUID-validados (`SessionIdSchema`)**. El prefijo de borrado se **arma server-side** como `` `${sessionId}/${fileId}/` ``, **nunca se acepta un `prefix` crudo del cliente** (F4 — evita `../`/prefijo vacío que borre de más). Rate-limit **por `claims.sub`** (no IP), reusando `checkRateLimit` (F7/F9): **`rl:reception-staff-presign`, 120 pedidos / 10 min por empleado** (holgado para ráfagas de `get` al abrir sesiones de hasta 30 archivos; el `delete` es una fracción mínima). Es el equivalente staff del broker del kiosko.

> **`op:'put'` excluido (confirmado).** El mostrador nunca sube archivos — `uploadFile` no se invoca desde el host (comentarios en `SessionContext.tsx` y `SupabaseRealtimeTransport.ts`). La subida es 100% del kiosko vía broker. El endpoint staff solo expone `get` + `delete`.

### 1.3 Reescribir `lib/file-reception/transport/storage.ts`
`createStorageBackend()` deja de usar el cliente Supabase del browser y pasa a llamar `/api/reception/staff/presign`:
- `signedUrl` → `{op:'get', sessionId, fileId, name: downloadName}` → `url`.
- `removePrefix` → `{op:'delete', sessionId, fileId}` (prefijo armado server-side).
- `uploadFile` → **stub no usado en el host** (la interfaz `StorageBackend` lo exige pero el mostrador nunca lo llama). Dejar un noop que loguee/throw "no soportado en host", o mantener `putWithProgress` sin endpoint server (muerto). No se presigna PUT desde el staff.
La interfaz `StorageBackend` (`SessionTransport.ts`) **no cambia** → `SupabaseRealtimeTransport`, `SessionContext` y `employee-panel` no tocan firmas. Quitar `BUCKET` y el cliente Supabase. `isSupabaseConfigured()` queda (Supabase sigue dando Realtime + Postgres).

### 1.4 Cambiar broker del kiosko — `app/api/reception/sessions/[sessionId]/upload-url/route.ts`
Reemplazar `supabase.storage.from(BUCKET).createSignedUploadUrl(path)` por `await presignPut(path, size)` (pasando el `size` ya validado, que ahora se firma como `Content-Length`). Mantener respuesta `{ path, signedUrl }`. Caps/approval-gate intactos.

> **Ciclo de vida del "vale" de subida:** la URL prefirmada se emite **por archivo, on-demand** y vive **5 min** (`expires=300`). La **sesión** vive 12 h (`SESSION_TTL_MS`). Si el vale vence con la sesión abierta, el kiosko simplemente pide otro (el token de sesión sigue válido). La key firmada es siempre `<sessionId>/<fileId>/<safeName>` con `sessionId` server-side y `fileId` UUID-validado → **un cliente solo puede escribir en su propia sesión**, nunca en otra (doble candado: `validateSession` liga token↔sesión, y la key está clavada al prefijo de su sesión).

### 1.5 Cambiar delete — `app/api/reception/sessions/[sessionId]/files/[fileId]/route.ts`
Swap del list/remove de Supabase (dos niveles) por `deletePrefix` de R2 (un prefijo).

### 1.6 CORS — bucket R2 + endurecer `cors.ts` (F2)
- **Bucket R2**: permitir PUT/GET/HEAD desde orígenes del kiosko (`tg-recepcion…`), mostrador (`tg-presupuestos…`), localhost y el túnel/LAN del kiosko físico (espejar `RECEPTION_ALLOWED_ORIGINS`). `AllowedHeaders: ["content-type"]`, `ExposeHeaders: ["ETag"]`. Aplicar con `wrangler r2 bucket cors put` o dashboard. **Bucket público = OFF** (solo presigned + binding del Worker).
- **`lib/services/file-reception/cors.ts`**: invertir el default a **fail-closed** — si `RECEPTION_ALLOWED_ORIGINS` está vacío, **denegar** cross-origin (no echo). Log de warning.
- **`lib/supabase/proxy.ts` (`updateSession`)** aplica hoy `receptionCorsHeaders()` a **todo** `/api/reception/**` con un solo allowlist. **Bifurcar por path** (F3): `/api/reception/staff/**` → nuevo `staffCorsHeaders()` que permite **solo el origin del mostrador** y falla-cerrado incondicionalmente; el resto sigue con `receptionCorsHeaders()` (ya fail-closed). Sin esto, el endpoint `download-url` (cookie-auth) queda expuesto cross-origin → riesgo CSRF-equivalente para mintear tokens. Confirmar `SameSite` de la cookie de sesión Supabase como última línea.
- Nota: `proxy.ts` **sí** es el middleware activo (convención Next 16, export `proxy`+`config`) — el Worker de descarga no lo atraviesa, pero los endpoints staff en Vercel sí.

### 1.7 Env nuevas (Vercel)
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=tg-uploads`, `R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com`. Kiosko: **sin env nuevas** (R2 queda detrás del broker). `pnpm add aws4fetch`.

**Verificación Fase 1:** ring → approve → subir 2-3 archivos desde kiosko → confirmar PUT 200 a R2 (Network tab) y objetos en `<sessionId>/<fileId>/<safeName>` (dashboard / `wrangler r2 object get`) → "Descargar todo" (todavía browser-side) baja el ZIP OK → `markDone` vacía el prefijo en R2 → `removeFile` borra `<sessionId>/<fileId>/`.

---

## FASE 2 — Descarga ZIP vía Cloudflare Worker

Reemplaza el armado in-browser por streaming R2 → Worker → navegador.

### 2.1 Worker (nuevo dir) — `projects/TerminalGrafica/tg-zip-worker/`
`wrangler.toml` (binding `BUCKET` → `tg-uploads`; secret `RECEPTION_DOWNLOAD_SECRET`), `src/index.ts`, `package.json` (dep `client-zip`), `tsconfig.json`.

Librería: **`client-zip`** — store-mode (= `level:0` actual), basada en WHATWG Streams, `makeZip(asyncIterable)` devuelve `ReadableStream` para `new Response(stream)`. Streaming real con memoria acotada (Workers 128 MB). Emite Zip64 solo si >4 GB (moot con cap 200 MB). Se descarta `fflate` (bufferea todo).

`src/index.ts`:
1. Parsear `?sid&uid&exp&sig[&name]`. **Validar formato ANTES de tocar `crypto`** (F13): `sid`/`uid` deben matchear regex UUID, `exp` debe matchear `^\d{10,13}$` y parsear como entero (rechazar `NaN`/`Infinity`/negativo — `Number("abc")=NaN` haría `now>NaN===false` = token eterno). 400 si cualquiera falla. `name` se valida aparte (paso 5).
2. Validar HMAC con Web Crypto (`crypto.subtle`): recomputar sobre el string exacto `${sid}.${uid}.${exp}` (token **atado al userId**, F3b — el `uid` es audit/correlación, no authz en el Worker; ver decisiones), base64url. **Compare constant-time con `crypto.subtle.timingSafeEqual`** (extensión de Workers) o XOR byte-a-byte — **nunca `===`** (F3a). Rechazar 403 si no matchea, 410 si `now > exp`.
3. `env.BUCKET.list({ prefix: \`${sid}/\` })` — **prefijo con barra final obligatoria** (F12 — evita que `sid="abc"` matchee `abcdef/`). `sid` ya UUID-validado en paso 1. Paginar `truncated`/`cursor` (con cap 30 es 1 página).
4. Entry name = último segmento del key (`safeName`), con el mismo dedup que `zip.ts` `suffixed()` (`art.pdf` → `art (1).pdf`). Input = `(await env.BUCKET.get(key)).body`. Saltear keys que devuelvan null.
5. **Sanitizar `name` en el Worker** (F11b — no confiar solo en `zipBaseName` de Vercel; el Worker es un servicio independiente): strip a `[\w\-]`, máx 60, fallback `pedido`. Header con **RFC 5987** `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(name)}.zip` para evitar inyección por `"`/CRLF.
6. `makeZip(entries)` → `Response` con `Content-Type: application/zip`, el `Content-Disposition` de arriba, `Cache-Control: no-store`.
7. **Logging**: loguear **solo `sid`/`uid`/status, nunca la URL completa ni `sig`** (F14 — Cloudflare loguea query strings por defecto; restringir acceso al dashboard / no Logpush con query string).

### 2.2 Helper de firma — `lib/services/file-reception/broker.ts`
Agregar `signDownloadToken(sessionId, userId, exp)` = base64url(HMAC-SHA256(`RECEPTION_DOWNLOAD_SECRET`, `${sessionId}.${userId}.${exp}`)) con `node:crypto` (al lado de `hashToken`/`generateToken`). **Debe byte-matchear** lo que recomputa el Worker. `RECEPTION_DOWNLOAD_SECRET` **server-only, sin prefijo `NEXT_PUBLIC_`** (F10). `broker.ts` ya tiene `import 'server-only'`.

### 2.3 Endpoint staff de URL firmada (nuevo) — `app/api/reception/staff/download-url/route.ts`
Gate **idéntico al de las rutas staff existentes** (`app/api/products/export`): `getClaims()` → 401 si `!claims`, **403 si `app_role` no es el del mostrador** (replicar el check de rol real, no solo `is_anonymous`; open-Q3). Sin declarar `runtime`. Rate-limit `rl:reception-download` **keyeado por `claims.sub`** (F7/F9), con **guard fail-closed** (F15): si `NODE_ENV==='production'` y `UPSTASH_*` no está seteado → **503** (no degradar a no-op). Valida `sessionId` (`SessionIdSchema`), `exp = now + 60` (**TTL 60s**, F6), arma `sig` con `signDownloadToken(sessionId, claims.sub, exp)`, opcional `name = zipBaseName(session.name)`. Devuelve `{ url: \`${WORKER_BASE_URL}/?sid=…&uid=…&exp=…&sig=…&name=…\` }` con headers **`Referrer-Policy: no-referrer`** y `Cache-Control: no-store` (F6). El mismo guard fail-closed aplica al endpoint staff de presign (§1.2).

### 2.4 UI mostrador — `components/employee/mostrador/employee-panel.tsx`
Reemplazar el cuerpo de `downloadAll`: en vez de fan-out de `downloadUrl` + `buildZip` + `triggerDownload`, hacer `fetch('/api/reception/staff/download-url', {sessionId})` → `window.location.href = url`. Mantener el spinner `zippingId` y el toast de demo-mode. Quitar el import de `buildZip`/`triggerDownload`/`zipBaseName`.

### 2.5 Limpieza
- `lib/file-reception/zip.ts`: borrar `buildZip` y `triggerDownload`; **conservar `zipBaseName`** (lo usa el route server-side — moverlo a un util sin `"use client"` o importarlo server-side, es puro).
- Quitar `fflate` de `package.json` (único consumidor era `zip.ts`).
- Sin fallback in-browser (reintroduce el problema de memoria/bandwidth). Camino único de descarga = Worker.

### 2.6 Env nuevas
Vercel: `RECEPTION_DOWNLOAD_SECRET`, `WORKER_BASE_URL`. Worker: `wrangler secret put RECEPTION_DOWNLOAD_SECRET` (igual a Vercel) + binding `BUCKET`.

### Secuencia de deploy Fase 2
1. Deploy Worker (`wrangler deploy`) + `wrangler secret put RECEPTION_DOWNLOAD_SECRET`; anotar URL.
2. Set `WORKER_BASE_URL` + mismo `RECEPTION_DOWNLOAD_SECRET` en Vercel.
3. Deploy Next con endpoint `download-url`, helper de firma y cambio de UI.

**Verificación Fase 2:** "Descargar todo" navega a la URL del Worker y baja `<zipBaseName>.zip` → abrir y confirmar todos los archivos + duplicado como `name (1).ext` → tamper test (editar `sig` o `exp` pasado) → 403/410 → preview de archivo único sigue OK por presigned GET → probar la **sesión más pesada real** end-to-end.

---

## Archivos a crear / modificar

**Fase 1 — crear:** `lib/file-reception/transport/r2.ts`, `app/api/reception/staff/presign/route.ts`.
**Fase 1 — modificar:** `lib/file-reception/transport/storage.ts`, `app/api/reception/sessions/[sessionId]/upload-url/route.ts`, `app/api/reception/sessions/[sessionId]/files/[fileId]/route.ts`, `package.json` (+aws4fetch).

**Fase 2 — crear:** `tg-zip-worker/` (Worker), `app/api/reception/staff/download-url/route.ts`.
**Fase 2 — modificar:** `lib/services/file-reception/broker.ts` (+`signDownloadToken`), `components/employee/mostrador/employee-panel.tsx`, `lib/file-reception/zip.ts`, `package.json` (−fflate).

**Kiosko (`recepcion-cliente`):** solo si el PUT falla por content-type → tocar `lib/broker/client.ts putWithProgress` (sacar el header). Por defecto, sin cambios.

---

## Seguridad (del review — fixes ya bakeados arriba)

| # | Sev | Fix | Dónde |
|---|-----|-----|-------|
| F1 | Alta | Firmar `Content-Length` en presign PUT → R2 aplica el cap de tamaño | §1.1, §1.4 |
| F2 | Alta | `cors.ts` fail-closed + CORS solo-mostrador para `/staff/**` + bucket público OFF | §1.6 |
| F3 | Alta | Worker: compare constant-time (`timingSafeEqual`/XOR, no `===`) + token atado a `userId` | §2.1, §2.2, §2.3 |
| F4 | Media | Delete staff arma el prefijo server-side desde `sessionId`+`fileId` UUID-validados; nunca prefix crudo | §1.2 |
| F5 | Media | `response-content-type=octet-stream` en presign GET de preview (anti-XSS almacenado) | §1.1 |
| F6 | Media | TTL 60s + `Referrer-Policy: no-referrer` + `no-store`; no loguear URLs | §2.3 |
| F7/F9 | Media | Rate-limit endpoints staff por `claims.sub`; Upstash fail-closed en prod | §1.2, §2.3 |
| F10 | Baja | `RECEPTION_DOWNLOAD_SECRET` server-only (sin `NEXT_PUBLIC_`) | §2.2 |
| **Auditoría Fase 2 ↓** | | | |
| F11b | Alta | Worker **sanitiza `name` por su cuenta** + `Content-Disposition` RFC 5987 (anti header-injection CRLF/`"`) | §2.1.5 |
| F13 | Alta | Worker valida formato de `sid`/`uid` (UUID) y `exp` (`\d{10,13}`, no NaN/∞) **antes** del HMAC | §2.1.1 |
| F3-staff | Alta | Bifurcar CORS en `proxy.ts`: `/staff/**` solo-mostrador, fail-closed (anti-CSRF) | §1.6 |
| F12 | Media | Prefijo de `list()` con **barra final** + `sid` UUID-validado (anti prefix-confusion) | §2.1.3 |
| F14 | Media | Worker **no loguea URL/`sig`** (CF loguea query strings); solo `sid`/`uid`/status | §2.1.7 |
| F15 | Media | Guard runtime fail-closed: prod sin Upstash → 503 (no no-op silencioso) | §2.3, §1.2 |
| Q3 | Media | Gate staff por **`app_role`** (igual que rutas existentes), no solo `is_anonymous` | §2.3 |

**Decisiones aceptadas (documentar en decision log):**
- **IDOR entre sesiones**: cualquier staff autenticado puede presignar/descargar cualquier sesión. Aceptado por diseño (print-shop de un local, todos los empleados de confianza). Revisar si aparecen sucursales/roles.
- **Token irrevocable hasta expirar**: la granularidad de revocación es el TTL de 60s. Aceptado (F4/F8). Si se necesitara más, la mitigación es nonce single-use en Upstash KV que el Worker chequea+borra.
- **`uid` en el token = audit/correlación, NO authz en el Worker** (el Worker no puede verificar identidad). Su valor de seguridad colapsa en la confidencialidad del secret (F4).
- **Leakage residual por `window.location.href`** (History API / DevTools en la máquina del staff): aceptado dado TTL 60s + dispositivos de confianza (F8).
- **Render de archivos del cliente — auditado, sin ejecución de JS en la app.** Los únicos sinks son `<img>` (kiosko `FileThumb`; mostrador siempre muestra ícono porque no tiene los bytes), donde un SVG malicioso **no ejecuta scripts** por spec. El signed URL de archivo único solo se usa para armar el zip, nunca se navega. `presignGet` con `octet-stream`+attachment (F5) cubre un futuro download de archivo único. **El sistema no es vulnerable.**
- **Lo que pasa en el dispositivo del empleado/cliente queda fuera de scope (decisión explícita).** Si alguien extrae el zip y abre un archivo localmente, es manejo de archivo local entre el negocio y su cliente, no responsabilidad del sistema. → **No** se rechaza SVG ni se valida magic bytes (F11 descartado).

## Riesgos / edge cases

- **Mismatch de firma en PUT** si el browser manda un header no firmado → presign query-only (content-type sin firmar), pero **sí** `Content-Length`. Verificar 200 en el test real.
- **String HMAC distinto** entre `node:crypto` (Vercel) y Web Crypto (Worker) → ambos firman el string byte-idéntico `${sid}.${uid}.${exp}` + base64url. Parity check al levantar.
- **Clock skew** en TTL 60s → si aparecen 410 espurios, subir a 90s.
- **Delete a R2 en `markDone`**: `SupabaseRealtimeTransport.persist` (que llama `removePrefix`) debe **borrar en R2 antes** de broadcastear el done, si no quedan bytes huérfanos / race con un Worker en vuelo.
- **CORS** debe incluir el origen del túnel/LAN del kiosko físico, o el PUT preflight falla silencioso (subida "colgada").
- **CPU del Worker** en sesión pesada (30 archivos cerca del cap, R2 lento) → tope free tier. Probar en verificación Fase 2.

## Checklist de deploy (gates)
- [ ] `pnpm audit` tras `pnpm add aws4fetch` / `client-zip` (sin CVEs).
- [ ] Bucket R2 con acceso público **OFF**.
- [ ] `RECEPTION_ALLOWED_ORIGINS` y `UPSTASH_*` **seteadas en prod** (si no, CORS y rate-limit degradan).
- [ ] `RECEPTION_DOWNLOAD_SECRET` idéntico byte-a-byte en Vercel y Worker; parity check de firma (node:crypto base64url ↔ Web Crypto).
- [ ] Documentar procedimiento de rotación de `RECEPTION_DOWNLOAD_SECRET` y `R2_SECRET_ACCESS_KEY`.
- [ ] Acceso a logs del Worker en Cloudflare restringido; sin Logpush de query strings.
- [ ] Confirmar `app_role` correcto del mostrador para el gate de los endpoints staff.

## Costos (para cerrar el presupuesto)
- Worker free tier (~100k req/día) sobra. Egress R2 gratis. R2: storage + Class A/B ops, centavos a esta escala.
- Línea "worker" = **$0**. Confirmar números exactos actuales de Cloudflare antes de mandar el número firme al cliente (opcional, puedo traerlos).
