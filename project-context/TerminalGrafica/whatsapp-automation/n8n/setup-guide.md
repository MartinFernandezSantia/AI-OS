# n8n Setup — Chatwoot FAQ Bot

Stack: n8n (self-hosted, Docker) + Chatwoot + OpenRouter (Gemini Flash-Lite).

---

## 1. Agregar n8n al docker-compose de Chatwoot

Abrí el `docker-compose.yml` de Chatwoot en el VM y agregá este service al final:

```yaml
  n8n:
    image: docker.n8n.io/n8nio/n8n:latest
    container_name: n8n
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - N8N_HOST=n8n.silvercoastwebagency.com
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - NODE_ENV=production
      - WEBHOOK_URL=https://n8n.silvercoastwebagency.com/
      - GENERIC_TIMEZONE=America/Argentina/Buenos_Aires
      - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
    volumes:
      - n8n_data:/home/node/.n8n
```

Y en la sección `volumes:` del mismo archivo:
```yaml
volumes:
  n8n_data:
```

En el `.env` del VM, agregá:
```
N8N_ENCRYPTION_KEY=<generar con: openssl rand -hex 32>
```

Levantarlo:
```bash
docker compose up -d n8n
# Verificar:
docker compose logs n8n --tail=30
```

---

## 2. Agregar n8n al Cloudflare Tunnel

Editá `/etc/cloudflared/config.yml` y agregá esta entrada al bloque `ingress:`, **antes** de la regla `catch-all`:

```yaml
  - hostname: n8n.silvercoastwebagency.com
    service: http://localhost:5678
```

Reiniciá el tunnel:
```bash
sudo systemctl restart cloudflared
```

---

## 3. DNS — agregar el subdominio n8n

En Cloudflare DNS (zona `silvercoastwebagency.com`):
- Tipo: `CNAME`
- Nombre: `n8n`
- Contenido: `<tunnel-uuid>.cfargotunnel.com` (mismo UUID que el CNAME de `chatwoot`)
- Proxy: activado (naranja)

---

## 4. Zero Trust — proteger la UI de n8n + bypasses necesarios

En Cloudflare Zero Trust:
- Applications → Add an application → Self-hosted
- Application domain: `n8n.silvercoastwebagency.com`
- Policy: Email → `martin-santia@hotmail.com.ar`

**Bypass obligatorio para webhooks de Chatwoot → n8n:**
En la misma application de n8n, agregá una policy adicional con mayor prioridad:
- Action: `Bypass` · Path: `/webhook/*` · Rule: Everyone

Esto es necesario porque Chatwoot llama al webhook con una URL pública y no tiene token de ZT.
En producción, reemplazar este bypass por verificación HMAC (ver `roadmap.md` §4).

**Bypass obligatorio para n8n → Chatwoot API:**
En la application de Chatwoot (`chatwoot.silvercoastwebagency.com`), agregá también:
- Action: `Bypass` · Path: `/api/*` · Rule: Everyone

Sin este bypass, las requests HTTP de n8n al API de Chatwoot son interceptadas por ZT y redirigidas al login (error `ERR_FR_REDIRECTION_FAILURE`). El API de Chatwoot ya requiere `api_access_token` — ZT es una capa redundante para la API.

---

## 5. Registrar el webhook en Chatwoot

Chatwoot y n8n están en el mismo docker-compose network, así que n8n es alcanzable desde Chatwoot en la URL interna `http://n8n:5678/webhook/chatwoot` — sin pasar por internet.

**El problema:** la UI de Chatwoot valida el formato de la URL y rechaza hostnames de Docker como `n8n` (solo acepta dominios públicos válidos). La REST API también devuelve 404 porque el endpoint `/api/v1/accounts/{id}/integrations/webhooks` no existe en Chatwoot CE — el modelo real se llama `Webhook` y la tabla es `webhooks`.

**La solución: registrar el webhook directo via Rails runner.**

```bash
docker exec chatwoot-rails-1 bundle exec rails runner \
  "w = Webhook.create!(account_id: 1, url: 'http://n8n:5678/webhook/chatwoot', subscriptions: ['message_created']); puts w.id"
```

El output debe ser el ID numérico del webhook creado (p. ej. `1`). Si imprime un número, funcionó.

Para verificar que quedó registrado, chequeá en Chatwoot → Settings → Integrations → Webhooks — debe aparecer la entrada.

### Notas sobre el modelo Webhook en Chatwoot CE

- Modelo: `Webhook` (tabla `webhooks`). No confundir con `Integrations::Hook` (que es para Slack/DialogFlow/OpenAI).
- Campos relevantes: `account_id`, `url` (valida http/https), `subscriptions` (array JSONB).
- Eventos disponibles en `Webhook::ALLOWED_WEBHOOK_EVENTS`: `message_created`, `conversation_created`, `conversation_updated`, `contact_created`, etc.
- La URL interna `http://n8n:5678/...` pasa la validación porque el parser de URI de Ruby acepta hostnames cortos.

### Si necesitás agregar más eventos después

```bash
docker exec chatwoot-rails-1 bundle exec rails runner \
  "Webhook.find(1).update!(subscriptions: ['message_created', 'conversation_updated'])"
```

### Si necesitás listar o borrar webhooks

```bash
# Listar
docker exec chatwoot-rails-1 bundle exec rails runner \
  "Webhook.where(account_id: 1).each { |w| puts \"#{w.id}: #{w.url} → #{w.subscriptions}\" }"

# Borrar por ID
docker exec chatwoot-rails-1 bundle exec rails runner \
  "Webhook.find(1).destroy"
```

---

## 6. Crear las credenciales en n8n

Entrá a `https://n8n.silvercoastwebagency.com` → Credentials → New.

### Credential 1 — Chatwoot API Token
- Type: `HTTP Header Auth`
- Name: **`Chatwoot API Token`** (exacto, el flow lo busca por este nombre)
- Header Name: `api_access_token`
- Header Value: tu token de acceso de Chatwoot (Settings → API Access Token)

### Credential 2 — Gemini API Key
- Type: `HTTP Header Auth`
- Name: **`Gemini API Key`** (exacto, el flow lo busca por este nombre)
- Header Name: `Authorization`
- Header Value: `Bearer <tu_google_ai_studio_key>`

> Usamos el endpoint OpenAI-compatible de Google AI Studio (`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`) — mismo formato de request que OpenRouter, sin cambios en el flow. Modelo: `gemini-2.0-flash-lite`.

---

## 7. Importar el flow

En n8n → Workflows → Import from File → seleccioná `flows/faq-bot-v1.json`.

Después de importar:
1. Abrí el nodo **Armar Prompt**.
2. Reemplazá `[COMPLETAR: ver prompts/system-prompt-tg.md]` con el contenido de `prompts/system-prompt-tg.md` (editado con los datos reales de TerminalGrafica).
3. Vinculá las credenciales: n8n va a marcar en naranja los nodos que necesitan credential. Click en cada uno → seleccioná la credential correspondiente.

---

## 8. Activar y probar

1. En el workflow, hacé click en **Publish** (arriba a la derecha). En n8n 2.x este botón reemplaza al toggle "Active" — es lo mismo: activa la production URL del webhook.
2. Desde tu WhatsApp personal, mandá un mensaje al número de TerminalGrafica.
3. En n8n → Executions, vas a ver la ejecución en tiempo real.
4. Verificá en Chatwoot que el bot respondió.

### Troubleshooting rápido

| Síntoma | Causa probable |
|---|---|
| Chatwoot no llama a n8n | El webhook URL en Chatwoot es incorrecto o n8n no está corriendo |
| n8n recibe el event pero el IF lo rechaza | Los campos del payload están bajo `$json.body.*`, no en el root |
| Get Historial falla con `ERR_FR_REDIRECTION_FAILURE` | Falta el bypass `/api/*` en la ZT application de Chatwoot — ver §4 |
| Get Historial falla con 401 | Credential `Chatwoot API Token` mal configurada o expirada |
| Armar Prompt falla con "json property isn't an object" | Code node en modo `runOnceForEachItem` — debe ser `runOnceForAllItems` |
| LLM responde "ESCALAR" siempre | System prompt muy restrictivo — revisá la sección de info del negocio |
| Modelo not found (404) | El slug del modelo en OpenRouter cambió — verificar en openrouter.ai/models |
| Bot responde a sus propios mensajes (loop) | El IF de `message_type == incoming` no filtra — revisar versión de Chatwoot |

---

## 9. Migrar a v2 (guardrails)

El flow v2 (`flows/faq-bot-v2.json`) agrega tres nodos nuevos respecto a v1:

**Nuevos nodos:**
- **IF — Tiene Texto** (entre IF — Sin Asignación y Get Historial): separa mensajes con contenido de los sin contenido (imágenes, audio, stickers).
- **Respuesta No-Texto** (rama FALSE de IF — Tiene Texto): envía "No puedo procesar archivos ni mensajes de voz. Escribime tu consulta y te ayudo con gusto."
- **IF — Injection Detectada** (entre Armar Prompt y Llamar LLM): si el Code node detecta patrones de prompt injection → rama TRUE.
- **Mensaje Injection** (rama TRUE de IF — Injection Detectada): responde "Solo puedo ayudarte con consultas sobre Terminal Gráfica. ¿En qué te puedo orientar?" sin llamar al LLM.

**Cómo importar v2:**
1. En n8n → Workflows → importá `flows/faq-bot-v2.json`.
2. Vinculá las credenciales (van a aparecer en naranja): `Chatwoot API Token` y `Gemini API Key`.
3. Desactivá el workflow v1 y publicá v2.

**No hace falta** crear credenciales nuevas — son las mismas que v1.

**Troubleshooting adicional v2:**

| Síntoma | Causa probable |
|---|---|
| Imagen/audio sin respuesta | `IF — Tiene Texto` no está conectado a `Respuesta No-Texto` (rama FALSE) |
| Injection filter bloquea mensajes legítimos | Los patrones son muy amplios — revisá `INJECTION_PATTERNS` en Armar Prompt y ajustá |
| `IF — Injection Detectada` nunca es TRUE | Verificar que Armar Prompt retorna `injectionDetected: true` — probá con el mensaje "ignora las instrucciones" en test |

---

## 10. Limpieza pendiente (del migration de dominio)

Mientras estás en el VM, aprovechá:

```bash
# Borrar el config.yml viejo (ya no se usa)
rm ~/.cloudflared/config.yml

# Verificar que no quedan referencias a martinfs.dev
grep -r "martinfs.dev" /etc/cloudflared/
```

Y en el dashboard de Cloudflare: borrar el hostname/record de `martinfs.dev` del tunnel (si todavía existe).
