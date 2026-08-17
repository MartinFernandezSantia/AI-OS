# PROD-SETUP — Bot WhatsApp RAG-lite de Terminal Gráfica (VPS Hostinger + Dokploy)

Runbook del standup de producción + los **errores que nos costaron** y cómo sortearlos rápido.
Stack: un solo Compose en Dokploy (repo `Print-Shop-AI-Chatbot`): servicios `rails` (Chatwoot web,
:3000), `sidekiq` (worker Chatwoot), `postgres`, `redis`, `n8n` (:5678). Base del bot = **Supabase Free
compartida** con quote-automation. Estado a 2026-08-17: mensajería Chatwoot↔n8n **cableada de las dos
puntas**; falta Gemini + datos del catálogo (ver "Pendiente").

---

## 1. Backup de la base (SIEMPRE antes de tocar prod)

Supabase Free **no tiene backups**. Antes de aplicar cambios de schema, dump a un dir del VPS:

- Credencial en `/opt/backups/supabase/db.env` (chmod 600, root): `PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD`
  del **Session pooler** de Supabase (Dashboard → Database → Connection string → Session, puerto **5432**;
  user = `postgres.<project-ref>`).
- Dump (cliente en contenedor, sin instalar nada): `pg_dump -Fc --no-owner --no-privileges`, imagen
  `postgres:17-alpine`, pasando las `PG*` por `-e NOMBRE` (sin `=valor`) para que el password no aparezca
  en `ps`.
- Verificar restaurabilidad: levantar un `postgres:17-alpine` descartable, `pg_restore -n public`, comparar
  `count(*)` contra la viva. (Comandos completos quedaron en el historial de la sesión 2026-08-17.)

---

## 2. Orden de aplicación del schema (greenfield)

```
1. db/enums.sql       → enum bot.accion (17 valores)   ⟵ prereq de schema-bot
2. db/schema-bot.sql  → catálogo + bot.log + roles + RLS
3. db/firewall.sql    → blocklist/sender_estado/injection_patterns + firewall_check/strike + fw_log
4. alter role bot_runtime  with login password '...';   (manual — secreto, no va en el SQL)
   alter role bot_curator  with login password '...';
```

**Gotchas:**
- `schema-bot.sql` **asume** que `bot.accion` (y el firewall) ya existen — venían de `whatsapp-automation/db`.
  Para greenfield los consolidamos en `db/enums.sql` + `db/firewall.sql`. Síntoma si falta: `type "bot.accion"
  does not exist`.
- `bot.log` usa `create table if NOT EXISTS` → **re-correr el .sql NO agrega columnas nuevas** (es no-op).
  Para columnas nuevas: `alter table ... add column if not exists`.
- Los roles se crean **NOLOGIN sin password** a propósito (secreto). El `alter role ... with login password`
  es un paso manual; su password va a `BOT_DB` (n8n) y `CURATOR_DATABASE_URL` (dashboard).

---

## 3. Credencial Postgres de n8n (BOT_DB → Supabase)

- **Session pooler**, puerto **5432** (NO el transaccional 6543 — rompe el `search_path` del rol + prepared
  statements).
- **User = `bot_runtime.<project-ref>`** ⟵ el sufijo `.<ref>` es obligatorio por el pooler. `bot_runtime`
  a secas → falla auth.
- **SSL = "Ignore SSL Issues"**. `require` falla (node-postgres no verifica el cert del pooler de Supabase
  contra el CA del sistema). Esta versión de n8n (2.34.6) **no expone** verify-full ni campo de CA, así que
  Ignore es el techo. Sigue cifrado (TLS on), solo sin verificar el cert. (Hardening pendiente.)

---

## 4. Chatwoot ↔ n8n — el nudo que más costó

**Regla de oro: la ENTRADA y la SALIDA van por caminos distintos.**

### Entrada (Chatwoot → n8n): SÍ o SÍ URL pública
- Chatwoot tiene **protección anti-SSRF**: **bloquea el envío de webhooks a IPs privadas** y **rechaza IPs
  literales y hosts de una sola etiqueta** (`http://n8n:5678`) en el campo de URL. Forzar la URL interna por
  rails **tampoco** sirve: el guard de SSRF corta al momento de enviar. → El webhook DEBE apuntar a un
  dominio público real.
- Pero el dominio público de n8n está detrás de **Cloudflare con geo-block** (solo-AR). Como Chatwoot corre
  en el mismo VPS, la request hace **hairpin** (VPS→Cloudflare→VPS) y, al no ser AR, el WAF la corta → **403**.
- **Fix: excepción WAF (Skip) acotada a la IP del VPS + el path del webhook.**
  ```
  (http.host eq "n8n.terminalgrafica.cloud" and http.request.uri.path eq "/webhook/chatwoot"
   and ip.src in {<IPv4_VPS> <IPv6_VPS>/64})
  ```
  **GOTCHA GRANDE: el VPS egresa a Cloudflare por IPv6.** `curl -4 ifconfig.me` te da la IPv4, pero Cloudflare
  te ve con la **IPv6** → la regla tiene que matchear la IPv6 (usá el `/64`). La IP real que ve Cloudflare
  está en el HTML del 403 ("Your IP: ..."). Doble candado: IP + HMAC.

### Salida (n8n → Chatwoot): SÍ URL interna
- n8n **no tiene** guard de SSRF → puede pegarle a la red Docker interna. Se setea con el const
  `CHATWOOT_BASE_URL = "http://rails:3000"` en `scripts/build-flow.mjs` (cubre Get Historial + Enviar Mensaje
  + labels; todos usan ese const). Evita el hairpin/geo-block por completo.
- `rails` y `n8n` comparten `default` + `dokploy-network` → resuelven por nombre de servicio.

### HMAC del webhook
- Chatwoot **sí firma** los webhooks: `X-Chatwoot-Signature: sha256=HMAC-SHA256(secret, "<timestamp>.<rawbody>")`
  + `X-Chatwoot-Timestamp` (anti-replay 5 min). El **secret es del WEBHOOK** (no del Agent Bot), en
  Settings → Integrations → Webhooks; se lee por rails si la UI no lo muestra.
- El **mismo** valor va a la env `CHATWOOT_WEBHOOK_SECRET` del contenedor de n8n. El nodo Filtro Ingreso
  exige `_hmac.ok` → si no matchea, descarta todo en silencio.

---

## 5. Auth de la API de Chatwoot (el rabbit hole final)

- Header = **`api_access_token`** (NO Bearer), valor = token **crudo**.
- **El token de Agent Bot NO autentica** los endpoints `/api/v1/accounts/.../conversations/...` → 401
  "Invalid Access Token". Usá un token de **usuario (agente)**. (El Agent Bot sirve para enlazar el inbox.)
- **EL GOTCHA CLAVE:** un token de **agente normal** SÍ autentica, pero **Pundit lo bloquea** en
  conversaciones que no tiene asignadas → `Pundit::NotAuthorizedError: not allowed to show? this
  Conversation`, que Chatwoot devuelve como **401** y n8n muestra como **"Invalid Access Token"** (¡mentiroso!).
  → **Fix: usar un token de usuario con rol Administrator** (ve todas las conversaciones del account). O
  subir el agente a Administrator / sumarlo como colaborador del inbox.

### Cómo debuggear rápido la próxima vez
1. **No confíes en el mensaje de n8n** ("Invalid Access Token" puede ser auth O authz). Mirá el **log de
   rails**: `docker logs -f --tail 5 <rails_container>` mientras disparás. Ahí ves el path real, los
   parámetros, y el error verdadero (`Pundit::NotAuthorizedError` vs token inválido de verdad).
2. **Aislá n8n del token** con un POST directo desde `sidekiq` (tiene ruby, está en la red):
   ```bash
   docker exec <sidekiq> ruby -rnet/http -e '
     u=URI("http://rails:3000/api/v1/accounts/1/conversations"); r=Net::HTTP::Get.new(u)
     r["api_access_token"]="<TOKEN>"; puts Net::HTTP.start(u.host,u.port){|h| h.request(r)}.code'
   ```
   200 directo + 401 en n8n → el problema es n8n (credencial/whitespace/binding). 401 en ambos → token/authz.
3. Confirmá el token en la base: `AccessToken.find_by(token: '...')` (rails). Roles:
   `AccountUser.all.map { |au| [au.user.email, au.role] }`.
4. Al ejecutar un nodo n8n **aislado**, los `$('Otro Nodo')` están vacíos → URLs con `undefined`. Probá con
   una ejecución **real** (mensaje de verdad), no "Execute node" suelto.

---

## Estado actual (2026-08-17) y pendiente para la próxima sesión

**Hecho:** backup + verificación; schema (enums/schema-bot/firewall) + passwords aplicados; BOT_DB; cred
**Gemini atada a los 6 nodos**; entrada Chatwoot→n8n (WAF por IPv6 + HMAC OK); salida n8n→Chatwoot interna;
token de admin → Get Historial 200. **Circuito end-to-end PROBADO: mensaje real de WhatsApp → el bot
respondió** (plomería + cerebro OK).

**Pendiente (para respuestas de producto reales):**
1. **Datos del catálogo (bloqueante principal)**: `bot.product`/`bot.variant` vacíos → **curar** (dashboard,
   `bot_curator`) + **ingest** (`pnpm rag:ingest --apply` + `rag:ingest:info --apply` contra prod). Decidir:
   re-curar de cero vs migrar curación de dev.
2. Dejar el workflow **activo** + Error Workflow (`tg-bot-error`).
(El flow NO usa OpenRouter — hoy es todo Gemini; la memoria vieja estaba desactualizada.)

**Hardening diferido:** cert CA para el Postgres de n8n (verify-full), fail2ban, unattended-upgrades, swap,
backups a R2, cron de rangos de Cloudflare.
