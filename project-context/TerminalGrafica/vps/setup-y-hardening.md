# VPS Terminal Grafica — setup, deploy y hardening

Runbook del VPS de **producción** de Terminal Grafica (imprenta), donde corre el stack de WhatsApp: Chatwoot + n8n. Documenta cómo quedó armado, los comandos usados, las trampas resueltas y lo que falta. Fecha de standup: **2026-08-16/17**.

> Secrets NO van acá. Las claves reales viven en la UI de Dokploy (cifradas) y en el gestor de contraseñas de Martin. Este doc solo describe la estructura.

---

## 1. Infraestructura

| Pieza | Valor |
|---|---|
| Proveedor VPS | Hostinger (KVM) |
| IP pública | `2.25.108.12` |
| Hostname | `srv1904615` |
| Dominio | `terminalgrafica.cloud` (comprado en Hostinger) |
| DNS | Cloudflare (nameservers del dominio apuntando a Cloudflare) |
| Orquestador | **Dokploy** (self-hosted, open-source; Traefik + Let's Encrypt) |
| SO | Ubuntu (unmanaged) |

**Subdominios (todos vía Traefik/443, proxied en Cloudflare + SSL Full strict):**
- `chat.terminalgrafica.cloud` → Chatwoot
- `n8n.terminalgrafica.cloud` → n8n
- `dokploy.terminalgrafica.cloud` → panel de Dokploy

> Nota: el puerto `3000` (panel Dokploy) NO está expuesto a internet. Dokploy corre como servicio de Docker Swarm y respeta UFW. Se accede solo por el subdominio.

---

## 2. Acceso SSH

- Login **solo por clave** (`PasswordAuthentication no`). Brute-force por password cerrado.
- La clave privada la sirve el **SSH agent de Bitwarden**.
- `PermitRootLogin no` — se opera con el usuario `martin` (sudo).
- `UsePAM yes` (no se toca; apagarlo rompe validación de cuenta/sesión).

**Gotcha:** SSH al **dominio** falla si el record está proxied (naranja), porque Cloudflare solo pasa 80/443. Para SSH usar la **IP directa**: `ssh martin@2.25.108.12`.

---

## 3. Deploy del stack (Dokploy)

**Repo:** `github.com/MartinFernandezSantia/Print-Shop-AI-Chatbot`
(clonado local en `projects/TerminalGrafica/Print-Shop-AI-Chatbot`).

Todo el stack en un `docker-compose.yaml`, desplegado como **un servicio tipo Compose** en Dokploy, conectado por **GitHub**.

**Servicios y versiones (FIJAS, nada de `latest`):**

| Servicio | Imagen | Puerto interno |
|---|---|---|
| Chatwoot web (`rails`) | `chatwoot/chatwoot:v4.16.2-ce` | 3000 |
| Chatwoot worker (`sidekiq`) | `chatwoot/chatwoot:v4.16.2-ce` | — |
| Postgres + pgvector | `pgvector/pgvector:pg16` | 5432 |
| Redis | `redis:7.4-alpine` | 6379 |
| n8n | `docker.n8n.io/n8nio/n8n:2.34.6` | 5678 |

**Decisiones del compose:**
- Sin `ports:` publicados en las apps → el routing lo hace Traefik por dominio. Postgres/Redis solo por red interna.
- `rails` y `n8n` unidos a la red externa **`dokploy-network`** (si no, Traefik no los alcanza → 502).
- Secrets como `${VARIABLES}`, cargados en la pestaña **Environment** de Dokploy (cifrados). `.env` en `.gitignore`; `.env.example` solo lista nombres.

**Config de dominios en Dokploy:** un Domain por servicio → `rails`:3000, `n8n`:5678, con HTTPS/Let's Encrypt ON.

**Cloudflare para el primer cert:** subdominios en **DNS-only (gris)** para que Let's Encrypt valide; una vez emitido, pasar a **proxied (naranja) + SSL Full (strict)**.

---

## 4. Trampas resueltas durante el deploy

| Síntoma | Causa | Fix |
|---|---|---|
| `Compose file not found` | Dokploy busca `docker-compose.yml`, el archivo es `.yaml` | Compose Path = `./docker-compose.yaml` |
| `502 Bad Gateway` en los dominios | Servicios no estaban en `dokploy-network`; Traefik no los alcanza | Agregar red externa `dokploy-network` a `rails` y `n8n` |
| `rails` loopea con `pg_isready: option requires an argument: U` | Faltaba `POSTGRES_USERNAME` en el env → `-U` sin argumento | Cargar el bloque completo de env de Chatwoot en Dokploy |
| `relation "installation_configs"/"inboxes" does not exist` | La DB nunca creó el esquema (el entrypoint no migra solo en prod) | Correr una vez: `bundle exec rails db:chatwoot_prepare` |
| `502` solo en n8n | Puerto del Domain mal seteado | Poner container port `5678` |
| n8n: `Python 3 missing task runner` | Warning inofensivo (solo afecta nodos Code en Python) | Ignorar |
| Redis: `Memory overcommit must be enabled` | Warning del kernel | `sysctl vm.overcommit_memory=1` (pendiente) |

---

## 5. Hardening de seguridad (2026-08-17)

### Firewall base (UFW)

```
Default: deny (incoming), allow (outgoing), deny (routed)
Allow: 22/tcp (SSH), 80/tcp, 443/tcp
```

### La trampa: Docker saltea UFW

Docker publica puertos por la cadena NAT/FORWARD de iptables, **por delante de UFW**. Un contenedor con `-p 9999:80` queda accesible a internet aunque UFW tenga `deny 9999`.

**Demostrado en vivo:** con `sudo ufw deny 9999` + `docker run -d -p 9999:80 nginx:alpine`, el puerto respondía `HTTP 200` desde afuera. Tras instalar `ufw-docker`, el mismo puerto da **timeout**.

### Fix aplicado: ufw-docker + allowlist de Cloudflare

Se eligió resolverlo en **capa firewall** (no en un middleware de Traefik): más robusto, independiente de que Dokploy regenere su config, y cierra el bypass en el mismo paso.

```bash
# 1. Instalar ufw-docker (hace que los puertos Docker respeten UFW)
sudo wget -O /usr/local/bin/ufw-docker \
  https://github.com/chaifeng/ufw-docker/raw/master/ufw-docker
sudo chmod +x /usr/local/bin/ufw-docker
sudo ufw-docker install

# 2. Permitir SOLO IPs de Cloudflare hacia 80/443
#    (ufw-docker enruta por FORWARD → se usa 'ufw route allow', no 'ufw allow')
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  sudo ufw route allow proto tcp from $ip to any port 80,443 comment 'Cloudflare'
done
for ip in $(curl -s https://www.cloudflare.com/ips-v6); do
  sudo ufw route allow proto tcp from $ip to any port 80,443 comment 'Cloudflare'
done

# 3. Aplicar
sudo ufw reload
```

**Qué logra:**
- Los puertos publicados por Docker dejan de saltear UFW (el default `deny routed` cierra todo lo no permitido).
- 80/443 solo aceptan tráfico de Cloudflare → nadie esquiva Cloudflare (ni el geo-block de AR) pegándole a la IP directa.
- Downtime ~cero porque los `allow` se agregan antes del `reload`.

**Verificado desde fuera de AR (atacante externo):**
- `http://2.25.108.12:9999` → timeout (bypass cerrado).
- `https://2.25.108.12` (IP directa) → timeout (solo-Cloudflare).
- `https://chat.terminalgrafica.cloud` desde AR → OK (prod arriba).

### Estabilidad y parches automáticos (2026-08-17)

**Timezone del server a hora AR** (para cron y logs):

```bash
sudo timedatectl set-timezone America/Argentina/Buenos_Aires
```

**Swap 2 GB + tuning de memoria** (colchón anti-OOM para Chatwoot + fix del warning de Redis):

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# swappiness bajo + overcommit para Redis (bgsave)
printf 'vm.swappiness=10\nvm.overcommit_memory=1\n' | sudo tee /etc/sysctl.d/99-vps.conf
sudo sysctl --system
```

**unattended-upgrades conservador** — parches de seguridad automáticos, pero SIN auto-reboot y con Docker fuera del auto-update (para que un `docker-ce` no tumbe el bot sin aviso):

```bash
sudo apt install -y unattended-upgrades
# activar el ciclo automático
sudo tee /etc/apt/apt.conf.d/20auto-upgrades > /dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
# overrides (drop-in 51 pisa al default 50)
sudo tee /etc/apt/apt.conf.d/51custom-unattended > /dev/null <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Package-Blacklist {
    "docker-ce";
    "docker-ce-cli";
    "containerd.io";
};
EOF
```

**Cron de reboot** — desacopla "instalar parche" de "reiniciar". apt deja la bandera `/var/run/reboot-required` cuando un parche pide reboot (kernel, glibc); el cron reinicia solo si está, y solo domingos 04:00 AR:

```bash
sudo tee /usr/local/bin/reboot-if-needed.sh > /dev/null <<'EOF'
#!/bin/bash
if [ -f /var/run/reboot-required ]; then
    logger "reboot-if-needed: parche pendiente, reiniciando"
    /sbin/reboot
fi
EOF
sudo chmod +x /usr/local/bin/reboot-if-needed.sh
echo '0 4 * * 0 root /usr/local/bin/reboot-if-needed.sh' | sudo tee /etc/cron.d/weekly-reboot
```

Docker arranca al boot (`systemctl is-enabled docker` = enabled) y los contenedores tienen `restart: always`/`unless-stopped`, así que el stack vuelve solo tras el reboot.

### Notas de seguridad Cloudflare

- Todos los subdominios: **proxied + SSL Full (strict)**.
- **Cloudflare Free Managed Ruleset**: ya viene activo por defecto en plan Free (no hay toggle).
- **Bot Fight Mode**: dejar **OFF** — rompe los webhooks de Meta/WhatsApp (no son un browser, no resuelven el challenge).
- **Regla WAF geo-block**: bloquea todo el tráfico que no venga de Argentina. Ojo: impide probar los dominios proxied desde afuera de AR (para testear desde afuera, pegarle a la IP cruda, que no pasa por Cloudflare).

---

## 6. Pendientes

**Hardening (sección 2 de la guía `references/vps-hostinger-setup-guide.md`):**
- [x] Timezone del server a `America/Argentina/Buenos_Aires` (2026-08-17).
- [x] Swap 2 GB + `vm.swappiness=10` + `vm.overcommit_memory=1` (fix del warning de Redis) (2026-08-17).
- [x] `unattended-upgrades` conservador: sin auto-reboot, Docker en blacklist (2026-08-17).
- [x] Cron de reboot domingos 04:00 AR, solo si `/var/run/reboot-required` (2026-08-17).
- [ ] Cron mensual que re-corre el loop de rangos de Cloudflare (los CIDR cambian de vez en cuando).
- [ ] `fail2ban` — evaluado y DESPRIORIZADO: SSH ya es solo-clave (no hay password que forzar) y todo lo web entra por Cloudflare (el host solo ve IPs de CF → banear = cortarse solo). Marginal.
- [ ] **Backups off-site a R2** (`pg_dump` + `rclone`) — lo más crítico que falta. DIFERIDO: el cliente todavía no cargó método de pago en Cloudflare (R2 lo exige aunque el free tier no cobre).

**Funcional (el bot):**
- [x] Super-admin de Chatwoot y owner de n8n creados.
- [x] WhatsApp Cloud API reconectado en Chatwoot (2026-08-17). Ver "Trampas de la conexión WhatsApp" abajo.
- [ ] Importar el workflow del bot en n8n.
- [ ] Cablear Chatwoot ↔ n8n con `CHATWOOT_WEBHOOK_SECRET`.

### Trampas de la conexión WhatsApp Cloud (2026-08-17)

Se reusó la app de Meta + número + token permanente (System User) de dev; solo se repuntó el webhook a prod. Dos trampas costaron el rato:

1. **El geo-block WAF rompía el handshake del webhook.** Los servidores de Meta que validan la Callback URL no están en AR → la regla solo-AR los bloqueaba. Fix: excepción en la regla de Cloudflare para la ruta del webhook:
   ```
   (ip.src.country ne "AR" and not http.request.uri.path contains "/webhooks/")
   ```
   Abre solo `/webhooks/*` al mundo (seguro: Chatwoot valida verify token + firma de Meta); el resto sigue solo-AR.

2. **Número argentino con `15` de más → Sidekiq descartaba los mensajes.** Los mensajes llegaban a `rails` pero Sidekiq logueaba `Inactive WhatsApp channel: unknown - +549223155934526`. Chatwoot v4.16 rutea el inbox por el **`display_phone_number` del payload** + el `phone_number_id` (`WebhookChannelFinderService`), NO por la columna `phone_number` a secas. La UI había guardado el número con un `15` (prefijo local móvil AR que no va en E.164): guardado `+549223155934526` vs Meta manda `5492235934526`. Fix directo en la DB (la UI lo re-normaliza y lo rompe):
   ```sql
   UPDATE channel_whatsapp SET phone_number = '+5492235934526' WHERE id = 2;
   ```
   Igualar EXACTO al `display_phone_number` del payload (sacarlo de los logs de `rails`, no adivinar el formato). El `phone_number_id` no se toca; los mensajes salientes usan ese ID, no la columna.

---

## 7. Referencias

- Guía de investigación previa: `references/vps-hostinger-setup-guide.md` (recomendaba Coolify; se usó Dokploy).
- Repo del stack: `github.com/MartinFernandezSantia/Print-Shop-AI-Chatbot`.
- Rangos IP de Cloudflare: https://www.cloudflare.com/ips-v4 · https://www.cloudflare.com/ips-v6
- ufw-docker: https://github.com/chaifeng/ufw-docker
