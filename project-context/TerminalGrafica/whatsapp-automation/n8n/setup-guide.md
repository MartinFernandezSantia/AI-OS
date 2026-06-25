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

## 4. Zero Trust — proteger la UI de n8n

En Cloudflare Zero Trust:
- Applications → Add an application → Self-hosted
- Application domain: `n8n.silvercoastwebagency.com`
- Policy: Email → `martin-santia@hotmail.com.ar`

> Los webhooks de n8n (`/webhook/*`) no requieren autenticación Zero Trust — Cloudflare los pasa directamente.

---

## 5. Configurar el webhook en Chatwoot

En Chatwoot → Settings → Integrations → Webhooks → New Webhook:

**URL:**
```
http://n8n:5678/webhook/chatwoot
```

> Usamos la URL interna de Docker (`http://n8n:5678`) porque Chatwoot y n8n están en el mismo docker-compose network. No pasa por internet.

**Eventos a activar:**
- [x] Message Created

Guardar.

---

## 6. Crear las credenciales en n8n

Entrá a `https://n8n.silvercoastwebagency.com` → Credentials → New.

### Credential 1 — Chatwoot API Token
- Type: `HTTP Header Auth`
- Name: **`Chatwoot API Token`** (exacto, el flow lo busca por este nombre)
- Header Name: `api_access_token`
- Header Value: tu token de acceso de Chatwoot (Settings → API Access Token)

### Credential 2 — OpenRouter API Key
- Type: `HTTP Header Auth`
- Name: **`OpenRouter API Key`** (exacto)
- Header Name: `Authorization`
- Header Value: `Bearer <tu_openrouter_key>`

---

## 7. Importar el flow

En n8n → Workflows → Import from File → seleccioná `flows/faq-bot-v1.json`.

Después de importar:
1. Abrí el nodo **Armar Prompt**.
2. Reemplazá `[COMPLETAR: ver prompts/system-prompt-tg.md]` con el contenido de `prompts/system-prompt-tg.md` (editado con los datos reales de TerminalGrafica).
3. Vinculá las credenciales: n8n va a marcar en naranja los nodos que necesitan credential. Click en cada uno → seleccioná la credential correspondiente.

---

## 8. Activar y probar

1. En el workflow, toggle **Active** (arriba a la derecha).
2. Desde tu WhatsApp personal, mandá un mensaje al número de TerminalGrafica.
3. En n8n → Executions, vas a ver la ejecución en tiempo real.
4. Verificá en Chatwoot que el bot respondió.

### Troubleshooting rápido

| Síntoma | Causa probable |
|---|---|
| Chatwoot no llama a n8n | El webhook URL en Chatwoot es incorrecto, o n8n no está corriendo |
| n8n recibe el event pero falla en Get Historial | Credential de Chatwoot mal configurada |
| LLM responde "ESCALAR" siempre | System prompt muy restrictivo — revisá la sección de info del negocio |
| Bot responde a sus propios mensajes (loop) | El IF de `message_type == incoming` no está filtrando — revisá la versión de Chatwoot |

---

## 9. Limpieza pendiente (del migration de dominio)

Mientras estás en el VM, aprovechá:

```bash
# Borrar el config.yml viejo (ya no se usa)
rm ~/.cloudflared/config.yml

# Verificar que no quedan referencias a martinfs.dev
grep -r "martinfs.dev" /etc/cloudflared/
```

Y en el dashboard de Cloudflare: borrar el hostname/record de `martinfs.dev` del tunnel (si todavía existe).
