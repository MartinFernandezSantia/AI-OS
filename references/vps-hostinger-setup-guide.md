# Guía: primer VPS en Hostinger para Chatwoot + n8n + (eventual) sistema de presupuestos

Investigación deep-research (2026-06-22). Stack objetivo: VPS Hostinger KVM (Ubuntu, unmanaged), cada servicio en su contenedor Docker. Chatwoot, n8n + workers, y eventual migración del sistema de presupuestos Next.js + Supabase desde Vercel.

Cada afirmación marcada con [n] está verificada de forma adversarial contra la fuente listada al final. Lo no marcado es práctica estándar establecida.

---

## TL;DR — lo que importa

1. **El KVM 2 (2 vCPU / 8 GB / 100 GB) NO te alcanza para todo a la vez.** Chatwoot solo pide 4 cores / 4 GB como mínimo oficial [13][15]. Supabase self-hosted pide 2 cores / 4 GB mínimo [19]. Sumá n8n + workers + Coolify y te quedás sin CPU antes que sin RAM. **Recomendación: KVM 4 (4 vCPU / 16 GB) si querés todo junto, o KVM 2 + Supabase en la nube (free tier).**
2. **Usá Coolify.** Sos principiante, querés reemplazar Vercel, y Hostinger trae plantilla "Ubuntu 24.04 con Coolify" de un click [5]. Te da deploy git-push, SSL automático y gestión de DBs sin tocar Compose a mano.
3. **La trampa que no sabés que existe: Docker se saltea UFW.** Publicar un puerto con `-p` abre ese puerto a TODO internet aunque tengas `ufw deny` sobre él [1][2][3][10][11][12]. Es la causa #1 de bases de datos hackeadas en VPS de principiantes. Mitigación abajo.
4. **Exposición: seguí con Cloudflare en el frente.** Ya corrés Chatwoot por Cloudflare Tunnel. Para los webhooks de Meta y n8n funciona perfecto. Recomendación matizada abajo (Tunnel vs proxy DNS).

---

## 1. Setup inicial del VPS desde cero

Orden de operaciones la primera vez que entrás:

```bash
# 1. Primer login (Hostinger te da IP + password root por email/panel)
ssh root@TU_IP

# 2. Actualizar todo el sistema
apt update && apt upgrade -y

# 3. Crear usuario no-root con sudo (NUNCA trabajes como root a diario)
adduser martin
usermod -aG sudo martin

# 4. Copiar tu clave SSH al nuevo usuario (corré esto DESDE TU MÁQUINA local)
#    Si no tenés clave: ssh-keygen -t ed25519
ssh-copy-id martin@TU_IP

# 5. Probar que entrás como martin ANTES de cerrar la sesión root
ssh martin@TU_IP   # en otra terminal
```

Razón del usuario no-root: la cuenta root puede hacer cambios destructivos por accidente; un usuario con sudo te obliga a pensar antes de cada comando privilegiado.

**Hardening de SSH** (editar `/etc/ssh/sshd_config`):

```
PermitRootLogin no            # nadie entra como root directo
PasswordAuthentication no     # solo claves, mata el brute-force
PermitEmptyPasswords no
```

Importante: deshabilitá `PasswordAuthentication no` **solo después** de confirmar que entrás con clave. Si te equivocás antes, quedás afuera. Luego:

```bash
sudo systemctl restart ssh
```

Cambiar el puerto SSH (de 22 a algo como 2222) es opcional. Baja el ruido de logs de bots pero NO es seguridad real (security through obscurity). Si lo hacés, abrí ese puerto en el firewall ANTES de reiniciar SSH, y avisale a Hostinger en su firewall de panel.

**Resto del setup base:**

```bash
# Zona horaria (Argentina)
sudo timedatectl set-timezone America/Argentina/Buenos_Aires

# Hostname legible
sudo hostnamectl set-hostname vps-cliente-01

# Swap (Chatwoot pide al menos 1 GB [14]; con 8 GB RAM poné 2-4 GB)
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Actualizaciones de seguridad automáticas y desatendidas
sudo apt install unattended-upgrades -y
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## 2. Seguridad / Hardening

### Firewall (UFW)

```bash
sudo apt install ufw -y
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH        # o tu puerto custom
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### LA TRAMPA CRÍTICA: Docker bypassea UFW

Esto es lo que un principiante en VPS no sabe que no sabe, y es la causa #1 de DBs comprometidas:

- Cuando Docker publica un puerto con `-p`, el tráfico se desvía **antes** de pasar por UFW, así que las reglas de UFW no aplican [1].
- Docker rutea el tráfico de contenedores en la tabla `nat` de iptables; los paquetes se desvían antes de llegar a las cadenas `INPUT`/`OUTPUT` que UFW usa, ignorando el firewall [2].
- Publicar `-p 8000:8000` inserta reglas iptables que abren ese puerto a **todas las interfaces y todas las IPs de origen**, sin importar UFW [3].
- Incluso `ufw deny 8080` NO bloquea el acceso externo a un puerto publicado por Docker [10].
- Resultado real: `-p 0.0.0.0:8080:80` deja un servicio pensado como interno expuesto a internet entero, con UFW "activo" dándote falsa sensación de seguridad [11].

**Cómo protegerte (tres capas, usá todas):**

1. **Nunca publiques puertos de bases de datos.** Postgres y Redis NO llevan `-p`. Los contenedores se hablan por la red interna de Docker usando el nombre del servicio (`postgres:5432`). Una DB sin `-p` no es alcanzable desde afuera.
2. **Si un servicio solo necesita ser local, atá el puerto a localhost:** `-p 127.0.0.1:8000:8000` en vez de `-p 8000:8000`. Así solo es alcanzable desde la propia máquina [3].
3. **Instalá `ufw-docker`** para reconciliar UFW con Docker. Agrega reglas iptables custom en la cadena `DOCKER-USER` vía `/etc/ufw/after.rules`, sin desactivar el manejo de iptables de Docker [12].

```bash
sudo wget -O /usr/local/bin/ufw-docker \
  https://github.com/chaifeng/ufw-docker/raw/master/ufw-docker
sudo chmod +x /usr/local/bin/ufw-docker
sudo ufw-docker install
sudo systemctl restart ufw
```

Con Coolify esto importa menos (su reverse proxy Traefik termina todo en 80/443 y no publicás puertos sueltos), pero la regla "nunca `-p` en una DB" sigue siendo sagrada.

### Seguridad de contenedores

- **Corré contenedores como usuario no-root** (`-u` o `USER` en el Dockerfile). Es la mejor defensa contra escalada de privilegios [4].
- **No expongas puertos de DB al host ni a internet** (ver arriba).
- **Mantené las imágenes actualizadas** — imágenes viejas = CVEs conocidos sin parchear.
- **Redes internas de Docker:** poné Chatwoot, su Postgres y su Redis en una red; n8n y los suyos en otra. Aislamiento por servicio.

### fail2ban

```bash
sudo apt install fail2ban -y
# Banea IPs tras N intentos fallidos de SSH. Config default ya cubre sshd.
```

### Gestión de secretos

- Variables de entorno en archivos `.env` con permisos `chmod 600`, NUNCA commiteados a git.
- En Coolify, cargá los secrets desde su UI (los guarda cifrados), no en archivos planos.
- Para Supabase self-hosted: reemplazá TODAS las credenciales placeholder antes del primer arranque. Generá secrets fuertes: passwords de DB, JWT keys, `SECRET_KEY_BASE` de 64+ chars, `VAULT_ENC_KEY` de exactamente 32 chars; y nunca expongas Postgres directo [20].

### Backups (lo que más se olvida)

- **Qué respaldar:** volúmenes de Postgres (Chatwoot, n8n, Supabase), volúmenes de uploads/adjuntos, los `.env` / secrets, y los compose files.
- **Frecuencia:** DBs diarias, retención mínima 7 días.
- **Off-site obligatorio:** un backup en el mismo VPS no es backup. Mandá los dumps a un bucket S3-compatible (Backblaze B2, Cloudflare R2 — ambos baratos). Coolify tiene backups programados a S3 integrados.
- **Snapshots de Hostinger:** útiles como red de seguridad de "imagen completa", pero NO reemplazan los dumps de DB (un snapshot restaura todo el server, no una tabla puntual).

### Monitoreo básico

- `docker stats` para ver consumo en vivo.
- Uptime Kuma (self-hosted, open-source) para alertas de caída por WhatsApp/Telegram/email. Encaja con tu regla de tooling.
- `journalctl` y `docker logs` para diagnóstico.

---

## 3. Orquestación: comparación y recomendación

| Opción | Deploy | Mantenimiento | Recursos | Superficie de seguridad | Curva |
|---|---|---|---|---|---|
| **Coolify** | Git-push estilo Vercel, UI completa, SSL auto | Bajo (UI + auto-updates) | ~1 GB para sí mismo | Media (es una capa más que asegurar; protegé su panel) | **Baja** |
| **Docker Compose + Traefik/Caddy** | Manual, vos escribís todo | Medio-alto (todo a mano) | Mínimo | Baja (menos piezas) | Alta |
| **Dokku** | Git-push, estilo Heroku, CLI | Medio | Muy bajo | Baja | Media |
| **CapRover** | UI + one-click apps | Bajo-medio | Medio | Media | Baja-media |
| **Portainer** | Solo gestiona/visualiza Docker, no hace build/deploy de git | Bajo | Bajo | Media | Baja |

**Recomendación para tu caso: Coolify.**

Razones:
- Es open-source y self-hosted — cumple tu regla de tooling [6].
- Hostinger lo ofrece como plantilla de un click "Ubuntu 24.04 con Coolify", arrancás sin instalar nada a mano [5].
- Reemplaza Vercel para el sistema de presupuestos (deploy por git push, preview deploys, SSL automático) [6].
- Gestiona Chatwoot y n8n como servicios con sus DBs, reverse proxy (Traefik) y Let's Encrypt incluidos — no tocás iptables ni certificados a mano.
- La curva de aprendizaje más baja de todas, clave siendo tu primer VPS.

Contras a tener presentes:
- Coolify ES una capa más de software con acceso total a Docker. Protegé su panel: ponelo detrás de auth fuerte y, idealmente, no expongas su puerto de admin a internet abierto (atalo a localhost + accedé por túnel, o restringí por Cloudflare Access).
- Consume ~1 GB de RAM solo para correr — contalo en el presupuesto del KVM 2.

Si en el futuro querés control total y mínimo overhead, Docker Compose + Caddy (Caddy da SSL automático con menos config que Traefik/Nginx) es el siguiente paso natural. Pero no empieces ahí.

---

## 4. Exposición a internet: recomendación

Contexto: Chatwoot recibe webhooks de Meta/WhatsApp Cloud API; n8n recibe webhooks entrantes. Ambos necesitan un endpoint HTTPS público con cert válido. Ya corrés Chatwoot por Cloudflare Tunnel.

**Las dos opciones:**

| | Cloudflare Tunnel | Puertos 80/443 abiertos + reverse proxy + Let's Encrypt |
|---|---|---|
| Puertos abiertos al exterior | Ninguno (el túnel sale hacia Cloudflare) | 80 y 443 |
| IP del VPS | Oculta | Expuesta |
| SSL | Lo maneja Cloudflare | Let's Encrypt (lo maneja Coolify/Traefik) |
| Webhooks Meta/n8n | Funcionan (HTTPS entrante válido) | Funcionan |
| Fricción con Coolify | Media (Coolify quiere manejar su propio SSL/Traefik; el túnel se solapa) | Ninguna (Coolify está diseñado para esto) |
| Zero Trust delante | Sí, nativo | No (lo agregás con Cloudflare proxy DNS) |

**Recomendación: Cloudflare en el frente, pero elegí UNA de dos arquitecturas según servicio.**

Opción A — **Cloudflare proxy DNS (nube naranja) + 443 abierto, restringido a IPs de Cloudflare.** Es la que mejor convive con Coolify, porque Coolify/Traefik maneja Let's Encrypt sin pelearse con el túnel. Abrís 443 pero con UFW solo permitís los rangos de IP de Cloudflare, así que en la práctica nadie llega directo a tu IP. Tenés WAF, caché y Zero Trust de Cloudflare. **Esta es la que recomiendo para los servicios nuevos que vivan en Coolify** (sistema de presupuestos, n8n).

Opción B — **Cloudflare Tunnel** (lo que ya usás para Chatwoot). Cero puertos abiertos, IP 100% oculta. Ideal cuando NO querés que Coolify maneje el SSL de ese servicio. **Dejá Chatwoot como está** (ya funciona) y, si querés, sumá un túnel para paneles internos sensibles (el admin de Coolify, n8n editor) detrás de Cloudflare Access.

Gotcha de webhooks con n8n: configurá bien `WEBHOOK_URL` (la URL pública real) en el entorno de n8n, o Meta no valida el endpoint. Es un error de config frecuente, no un problema del túnel.

Regla simple: **lo que sirva al público / reciba webhooks → Opción A en Coolify. Paneles de admin → Opción B (Tunnel + Access) o atados a localhost.**

---

## 5. Dimensionamiento de recursos — el reality check

Mínimos OFICIALES verificados:

- **Chatwoot:** mínimo 4 GB RAM (hasta 10.000 conversaciones/día), 8 GB para 20.000/día [13]. CPU mínimo recomendado 4 cores [15]. Swap ≥ 1 GB [14].
- **n8n queue mode:** corre múltiples instancias — una "main" que recibe triggers/webhooks y genera ejecuciones, y workers separados que las ejecutan; cada worker es su propio proceso Node.js [17]. Requiere Redis como broker [16]. Se activa con `EXECUTIONS_MODE=queue` (default es `regular`) [18].
- **Supabase self-hosted:** mínimo 2 cores / 4 GB / 40 GB SSD; recomendado 4 cores / 8 GB / 80 GB [19]. Son ~8-10 contenedores, pesado.

**¿Alcanza el KVM 2 (2 vCPU / 8 GB / 100 GB [7])?**

- **Chatwoot + n8n (main + 1 worker) + Coolify:** entra en 8 GB pero ajustado, sin headroom. El cuello de botella real es la **CPU: 2 vCPU contra los 4 cores que Chatwoot recomienda**. Para volúmenes chicos (un cliente, pocas conversaciones/día) anda; bajo carga real va a sufrir.
- **+ Supabase self-hosted en el mismo box:** NO. Te pasás de RAM y de CPU. Supabase solo ya pide 2 cores / 4 GB.

**Recomendaciones de dimensionamiento:**

1. **Empezá con KVM 2 si:** Supabase queda en la nube (free/pro tier) y el volumen de Chatwoot es bajo. Es el arranque más barato y válido para un primer cliente.
2. **Pasá a KVM 4 (4 vCPU / 16 GB) si:** querés Chatwoot + n8n + sistema de presupuestos + Supabase self-hosted todo en una caja, o si Chatwoot empieza a manejar volumen real. El salto de CPU es lo que más vas a agradecer.
3. **Cuándo escalar:** mirá `docker stats` y el load average. Si el load supera sostenidamente la cantidad de vCPUs, o el swap se usa de forma constante (no solo picos), es hora.
4. **Disco:** 100 GB del KVM 2 sobra para empezar. Vigilá que los adjuntos de Chatwoot y los logs no lo llenen con el tiempo.

---

## 6. Consideraciones específicas de Hostinger

- Todos los planes VPS usan **KVM (virtualización completa) sobre AMD EPYC con root completo** — se comporta como entorno aislado e independiente, apto para Docker [8].
- **hPanel** ofrece un **gestor de Docker Compose** y plantillas de instalación de un click para **Coolify, n8n y WordPress** [9].
- Plantilla **"Ubuntu 24.04 con Coolify"** preinstalada [5] — el camino más rápido para tu stack.
- KVM 2 confirmado: 2 vCPU / 8 GB RAM / 100 GB NVMe / 8 TB de transferencia [7].
- Snapshots/backups: Hostinger ofrece snapshots y backups a nivel de panel — usalos como red de seguridad, pero mantené tus propios dumps de DB off-site (ver sección 2).
- Limitación a tener presente: las plantillas de un click te dejan andando rápido pero NO hacen el hardening por vos. El setup de la sección 1 y 2 sigue siendo tu responsabilidad.

---

## 7. Sistema de presupuestos Next.js + Supabase: ¿migrar de Vercel?

**¿Conviene salir de Vercel?**

- Vercel para Next.js es excelente y su free/hobby tier es generoso. Migrar a VPS tiene sentido si: querés todo bajo un mismo techo y costo fijo, querés evitar límites/costos de Vercel a escala, o el cliente exige datos en infraestructura propia.
- Con Coolify, deployás Next.js por git-push igual que en Vercel, con SSL automático [6]. La experiencia es comparable para apps simples.

**¿Self-hostear Supabase o seguir en la nube?**

- **Recomendación: seguí con Supabase cloud (free tier) al principio.** Self-hostear Supabase suma ~8-10 contenedores, pide 4 GB / 2 cores propios [19], y te hace responsable de backups, upgrades y seguridad de la DB. Para un primer VPS es mucha superficie nueva.
- Si igual self-hosteás: generá TODOS los secrets (no uses los placeholder [20]), nunca expongas Postgres directo a la red [20], y dimensioná para el extra de RAM/CPU (= KVM 4).
- SSL/dominios: Coolify + Let's Encrypt resuelve los certs. Apuntás el dominio del cliente al VPS (o por Cloudflare proxy, sección 4).
- Variables de entorno: cargalas en la UI de Coolify (cifradas), no en archivos planos commiteados.

**Veredicto:** migrá el front Next.js a Coolify cuando quieras consolidar, pero dejá Supabase en la nube hasta que tengas el VPS rodado. No mezcles "primer VPS" con "primera vez self-hosteando una DB de producción".

---

## 8. Operación y mantenimiento continuo

**Logs:**
- `docker logs -f <contenedor>` para un servicio puntual.
- En Coolify, los logs están en la UI por aplicación.
- `journalctl -u docker` para el daemon.

**Actualizar contenedores sin romper nada:**
- Antes de actualizar: **backup de la DB**.
- Actualizá de a un servicio, no todos a la vez.
- Leé las release notes (Chatwoot y n8n a veces requieren migraciones de DB).
- En Coolify: redeploy desde la UI; mantiene la versión anterior para rollback.

**Ante una caída:**
- `docker ps -a` para ver qué contenedor murió.
- `docker logs <contenedor>` para la causa.
- Si es el VPS entero: el panel de Hostinger permite reiniciar y restaurar snapshot.

**Checklist primeras 24 horas:**
- [ ] Usuario no-root con sudo creado y probado
- [ ] SSH solo por clave (`PasswordAuthentication no`), root deshabilitado
- [ ] UFW activo (deny incoming, allow SSH/80/443)
- [ ] `ufw-docker` instalado (o regla "nunca `-p` en DBs" interiorizada)
- [ ] fail2ban corriendo
- [ ] unattended-upgrades configurado
- [ ] Swap activo
- [ ] Zona horaria y hostname seteados
- [ ] Coolify instalado y su panel protegido (no abierto a internet)
- [ ] Primer servicio (Chatwoot o n8n) deployado y con HTTPS
- [ ] Backups off-site configurados y probados (restaurá uno de prueba)

**Checklist mantenimiento mensual:**
- [ ] `apt update && apt upgrade` (si no es 100% automático)
- [ ] Actualizar imágenes de contenedores (con backup previo)
- [ ] Verificar que los backups off-site corren y se pueden restaurar
- [ ] Revisar `docker stats` y load average — ¿hace falta escalar?
- [ ] Revisar uso de disco (`df -h`) — logs y adjuntos crecen
- [ ] Revisar logs de fail2ban / intentos de acceso raros
- [ ] Revisar CVEs de las versiones que corrés

---

## Fuentes

Calidad: primary = doc oficial; blog/forum = secundaria.

1. Docker docs — packet filtering & firewalls (primary) — https://docs.docker.com/engine/network/packet-filtering-firewalls/
2. ídem
3. OWASP Docker Security Cheat Sheet (primary) — https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html
4. ídem OWASP
5. Hostinger — plantilla Coolify (primary) — https://www.hostinger.com/support/9615197-how-to-use-the-coolify-vps-template-at-hostinger/
6. ídem Hostinger Coolify
7. Hostinger VPS hosting (primary) — https://www.hostinger.com/vps-hosting
8. ídem Hostinger VPS
9. ídem Hostinger VPS
10. chaifeng/ufw-docker (primary, repo) — https://github.com/chaifeng/ufw-docker
11. ídem ufw-docker
12. ídem ufw-docker
13. Chatwoot self-hosted requirements (primary) — https://developers.chatwoot.com/self-hosted/deployment/requirements
14. ídem Chatwoot
15. ídem Chatwoot
16. n8n queue mode docs (primary) — https://docs.n8n.io/hosting/scaling/queue-mode/
17. ídem n8n
18. ídem n8n
19. Supabase self-hosting con Docker (primary) — https://supabase.com/docs/guides/self-hosting/docker
20. ídem Supabase

Fuentes secundarias consultadas (hardening, comparación PaaS, exposición): DigitalOcean initial server setup, MassiveGrid VPS hardening / n8n queue / PaaS comparison, OWASP, selfhostable.dev (Coolify vs CapRover vs Dokku), kenbinlab (reverse proxy vs Cloudflare Tunnel), n8n community forum (validación de webhook Meta).

Cobertura: 5 ángulos, 24 fuentes, 117 claims extraídos, 20 verificados de forma adversarial (3 votos c/u). La síntesis original falló por límite de sesión; este informe la reconstruye desde los claims verificados.

---

# ANEXOS PRÁCTICOS (sesión de preguntas, 2026-06-22)

Nota de método: las secciones A-G salen de los claims verificados + conocimiento de dominio. Las secciones **H (comparación de proveedores) e I (migración) NO fueron verificadas por el workflow** — son conocimiento general; los precios cambian, verificarlos antes de decidir.

## A. Dimensionamiento a tu volumen real (100-1000 conversaciones/día)

- El mínimo oficial de Chatwoot (4 cores / 4 GB) es para **10.000 conv/día**. A 100-1000/día estás 10-100x por debajo: los 2 vCPU del KVM 2 alcanzan.
- **Probablemente NO necesites workers todavía.** El queue mode de n8n (main + workers + Redis) es para throughput alto. A tu volumen, un solo n8n en modo `regular` (default) sobra. Sumá workers cuando un flujo pesado bloquee a otros, no antes.
- Chatwoot + n8n simple + Coolify entran cómodos en KVM 2 a ese volumen, con Supabase en la nube.

## B. Backups a R2 con cron

Dos caminos:
- **Coolify:** backups programados a destino S3-compatible (R2 entra) desde la UI. No escribís cron.
- **Manual:** script con `pg_dump` + subida con `rclone`.

```bash
# /opt/backup-db.sh
docker exec chatwoot-postgres pg_dump -U postgres chatwoot | gzip > /tmp/chatwoot-$(date +\%F).sql.gz
rclone copy /tmp/chatwoot-*.sql.gz r2:mi-bucket/backups/
rm /tmp/chatwoot-*.sql.gz
```

```bash
# crontab -e → diario 3am
0 3 * * * /opt/backup-db.sh
```

Regla de oro: probá una restauración real una vez. Backup no restaurado = no es backup.

## C. Certificados SSL, de cero

- El SSL/TLS es lo que hace `https://`. Cifra el tráfico y prueba que el dominio es legítimo. **Meta no acepta webhooks sin HTTPS y cert válido.**
- **Let's Encrypt** emite certs gratis y automáticos. El reverse proxy (Traefik en Coolify, o Caddy/Nginx manual) los pide, instala y **renueva solo cada ~90 días**. No hay paso de "comprar e instalar".
- **Con Coolify:** ponés el dominio en la app y saca el cert solo. Cero config.
- **Con Cloudflare adelante (proxy o Tunnel):** el cert de cara al público lo pone Cloudflare en su borde. Con Tunnel ni siquiera necesitás Let's Encrypt en el origen (el túnel ya viaja cifrado). Si usás proxy, activá modo "Full" para cifrar también el tramo Cloudflare↔VPS.

## D. ¿Coolify aporta aunque el Next.js siga en Vercel?

Sí, uso real independiente del Next.js. Para Chatwoot + n8n te da: deploy + gestión con sus DBs desde UI, reverse proxy + SSL automático, env vars cifradas, logs/restart/rollback por servicio, backups a R2, y updates desde la UI. Sin Coolify harías todo eso con `docker-compose` a mano + Caddy + scripts. Para 2-3 servicios el Compose plano es viable, pero siendo tu primer VPS, Coolify te ahorra errores. El Next.js en Vercel no es el motivo para usar Coolify; es un bonus si algún día lo migrás.

## E. Cloudflare Zero Trust: sacarte el OTP diario en Chatwoot

El OTP diario aparece porque pusiste Cloudflare Access **delante** de Chatwoot y la política re-autentica cada 24h. Opciones, de mejor a peor:

1. **Recomendada: no pongas Access delante de Chatwoot.** Chatwoot ya tiene login propio robusto (email+password, 2FA opcional). Dejalo detrás de Cloudflare en modo **proxy/WAF** (oculta IP, filtra ataques) pero **sin Access**. El agente entra con su cuenta de Chatwoot, sin OTP. Reservá Access solo para paneles sin buen login (admin de Coolify, editor de n8n).
2. **Si mantenés Access:** alargá la sesión en Cloudflare (Access → app → Session Duration) de 24h a 1 semana/1 mes. El OTP pasa a ocasional.
3. **Cambiá el método:** en vez de PIN por email, usá Google como identity provider. El agente entra con su sesión Google ya iniciada, sin tipear código.

## F. Exposición a internet (conceptos)

- Tu VPS tiene una **IP pública**; cualquiera puede intentar conectarse.
- Un servicio escucha en un **puerto**. "Abrir un puerto" = dejar entrar tráfico externo a él. Cada puerto abierto es una puerta atacable. Mínima exposición = mejor.
- El **DNS** traduce tu dominio a una IP.
- Un **reverse proxy** recibe todo en 443 y reparte internamente + pone el SSL.

Tres modelos:
- **Puertos abiertos (80/443) + reverse proxy:** clásico. IP visible, recibís todo el escaneo de bots. Abrí solo 443 (y 80 para redirigir).
- **Cloudflare Tunnel:** el VPS no abre ningún puerto entrante; hace conexión saliente a Cloudflare. IP oculta. Es lo que ya usás.
- **Cloudflare proxy (nube naranja):** abrís 443 pero el DNS pasa por Cloudflare (filtra ataques, oculta IP). Para que nadie esquive Cloudflare yendo a tu IP directa, el firewall solo acepta IPs de Cloudflare.

Idea de fondo: lo único que escucha de cara a internet es el reverse proxy en 443. DBs y paneles viven en la red interna de Docker, invisibles.

## G. Mantenimiento: cadencia, tiempo y CI/CD

- Parches de seguridad del SO: los aplica `unattended-upgrades` solo, a diario.
- Mantenimiento manual: **mensual, ~30-60 min** una vez rodado (revisar dashboards, actualizar imágenes con backup previo, chequear disco y backups).
- **¿Implica CI/CD? No.** CI/CD es para código que vos compilás (tu Next.js: Vercel ya lo hace). Chatwoot y n8n corren desde imágenes pre-construidas: no hay build, solo bajás versión nueva.
- Lo que sí querés para "verificar tras un upgrade" es **monitoreo de salud + rollback**:
  - Healthchecks de Docker (Coolify muestra "healthy").
  - **Uptime Kuma** (self-hosted, gratis): pinguea tus URLs y avisa por WhatsApp/Telegram si algo cae. Es tu test post-upgrade automático.
  - Rollback: Coolify vuelve a la imagen anterior con un click.
- Flujo de upgrade seguro: backup → actualizar UN servicio → mirar healthcheck/Uptime Kuma → si rompe, rollback.

## H. Comparación de proveedores: Hostinger vs Hetzner (NO verificado, precios orientativos)

Punto clave: a 8 GB de RAM, **Hetzner da el doble de CPU por precio similar o menor**, y la CPU es el cuello de botella para Chatwoot.

- Hostinger **KVM 2**: 2 vCPU / 8 GB / 100 GB
- Hetzner **CX32**: **4 vCPU** / 8 GB / 80 GB

**Modelos de precio (la diferencia más grande):**
- **Hetzner** — pago por hora con tope mensual. Precio EUR + IVA (puede no aplicarte fuera de UE). IPv4 se cobra aparte (~€0,50/mes). 20 TB de tráfico incluidos (planes EU). Backups +20%. **Sin descuento por plazo: mismo precio siempre, sin sorpresa de renovación.**
- **Hostinger** — plazo fijo pagado por adelantado. Barato al inicio (~$6-8/mes KVM 2 en plazo largo) pero **renueva 2-3x más caro**. USD, todo incluido (IPv4, backups semanales, plantillas 1-click).

**Tramo 8 GB (orientativo, EUR netos Hetzner):**

| Plan | vCPU | RAM | Disco | Precio aprox/mes |
|---|---|---|---|---|
| Hetzner CAX21 (ARM) | 4 | 8 GB | 80 GB | ~€6,50 |
| Hetzner CX32 (Intel) | 4 | 8 GB | 80 GB | ~€7 |
| Hetzner CPX31 (AMD) | 4 | 8 GB | 160 GB | ~€13 |
| Hostinger KVM 2 | 2 | 8 GB | 100 GB | ~$6-8 promo / ~$13-16 renovación |

Nota ARM (CAX): el más barato y rinde bien para Docker, pero verificá que las imágenes (Chatwoot, n8n) tengan build ARM64 (las oficiales sí). Si dudás, Intel (CX).

| Aspecto | Hostinger | Hetzner |
|---|---|---|
| CPU por el dinero | Menos (2 vCPU) | **Más (4 vCPU mismo RAM)** |
| Modelo de precio | Plazo fijo, renueva caro | Por hora, mismo precio siempre |
| Panel | hPanel completo y amigable | Cloud Console básico |
| Coolify/n8n 1-click | **Sí, plantilla** | No (script oficial, ~10 min) |
| Backups gestionados | Incluidos | Aparte (+20%) |
| IPv4 | Incluida | Se cobra (~€0,50/mes) |
| Facilidad principiante | **Más fácil** | Algo más de mano |
| Latencia a Argentina | Más regiones (¿Brasil? verificar) | Solo US East (~120-150 ms), sin Sudamérica |
| Flexibilidad | Atado al plazo | Prendés/apagás/redimensionás libre |

**Latencia:** para clientes argentinos, un datacenter en Brasil (~40 ms) le gana a US East (~120-150 ms). Hetzner no tiene Sudamérica. Verificar si Hostinger ofrece São Paulo para VPS.

**Lectura:** para aprender y arrancar → Hostinger (plantilla Coolify, backups, panel amigable). Por valor/CPU y transparencia → Hetzner CX32. Camino sensato: arrancar en Hostinger, migrar a Hetzner si crece o molesta la renovación.

## I. Runbook de migración Hostinger → Hetzner (NO verificado)

Si todo vive en Docker/Coolify, es una tarde, no un proyecto. Lo que lo hace fácil: Docker portable + Cloudflare adelante (la URL pública no cambia) + Supabase en la nube (esa DB no se mueve nunca).

**Pasos:**
1. Contratar Hetzner CX32. Hacer el mismo hardening base (secciones 1-2).
2. Instalar Coolify (script oficial).
3. Recrear los servicios (Chatwoot, n8n) con la misma config y env vars.
4. Restaurar datos desde el último backup en R2 (`pg_dump` → restore).
5. Apuntar el túnel/proxy de Cloudflare al server nuevo.
6. Verificar que todo anda y recién ahí dar de baja Hostinger. Se puede correr en paralelo unos días.

**Trampas que rompen migraciones (no olvidar):**
- **`N8N_ENCRYPTION_KEY`**: n8n cifra las credenciales de los workflows con esta clave. Sin copiarla idéntica, todas las credenciales dejan de funcionar.
- **`SECRET_KEY_BASE` de Chatwoot**: igual; sin preservarla se rompen sesiones y datos cifrados.
- **Allowlists de IP**: revisar que nada dependa de la IP vieja. Con Cloudflare adelante casi no aplica.
- **Tamaño de datos**: más historial/adjuntos = más tarda el dump/restore. A tu volumen, minutos.

**Tiempo:** 2-4 horas la primera vez, menos después. El costo real no es técnico, es el ratito de downtime durante el restore (minimizable corriendo en paralelo).

**Para que tu yo futuro sufra menos, hacé AHORA:**
- Documentá env vars y secrets (sobre todo las dos claves de cifrado) fuera del VPS.
- Mantené backups a R2 corriendo y probá una restauración. Si el backup funciona, la migración funciona: es el mismo proceso.
- Guardá compose files / config de Coolify en un repo git.
