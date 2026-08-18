# Conectar un número a la WhatsApp Cloud API — desde 0, con la cuenta del CLIENTE

Runbook para dar de alta el número de Terminal Gráfica en la **WhatsApp Business Platform
(Cloud API)** de Meta y cablearlo al Chatwoot self-hosted (que a su vez dispara n8n → bot).
Escenario: **los activos son del cliente** (TG), no míos. Yo entro como admin para operar.

> Meta mueve las etiquetas de UI seguido. Los pasos están descriptos por su FUNCIÓN, no por el
> texto exacto del botón. Si un nombre no aparece igual, buscá el que haga lo mismo.

---

## 0. Regla de oro de propiedad (leer antes de tocar nada)

Todo lo que se cree tiene que colgar del **Business Portfolio del cliente** (Terminal Gráfica),
no de mi cuenta personal:

- El **Meta Business Portfolio** (Business Manager) es del cliente.
- El **número** y la **WhatsApp Business Account (WABA)** quedan como activos de ESE portfolio.
- Yo me agrego como **admin / socio** para gestionar. Si algún día corto con el cliente, ellos
  se quedan con su número y su WABA; yo solo pierdo acceso.

**Cómo dar acceso sin que yo sea dueño:** el cliente me suma como **usuario admin** de su Business
(Business Settings → Users → People → Add), o me comparte los activos puntuales (la app + la WABA)
con permiso de control total. Alternativa si el cliente no quiere lidiar con esto: lo hacemos por
**pantalla compartida** logueado con SU usuario.

---

## 1. Prerrequisitos (juntar ANTES de empezar)

- [ ] **Un número de teléfono** que:
  - NO tenga una cuenta de WhatsApp / WhatsApp Business activa. Si la tiene, hay que **borrar la
        cuenta de WhatsApp de ese número primero** (Ajustes de la app → Cuenta → Eliminar cuenta),
        si no, el alta falla.
  - Pueda recibir **SMS o llamada** para el código de verificación (OTP).
  - Idealmente un número que el cliente NO use para chatear a mano (una vez en la Cloud API, el
    número deja de funcionar con la app normal de WhatsApp).
- [ ] Una **cuenta de Facebook** con la que el cliente sea admin de su negocio (para crear/entrar al
      Business Manager).
- [ ] **Datos legales del negocio** para la verificación: razón social, dirección, y algún
      comprobante (constancia AFIP / factura de servicio a nombre del negocio / etc.).
- [ ] El **Chatwoot en prod ya andando** (`chat.terminalgrafica.cloud`), que es donde vamos a
      pegar las credenciales y de donde sacamos la URL del webhook.

---

## 2. Business Manager del cliente

1. Entrar a **business.facebook.com** con el usuario del cliente.
2. Crear (o confirmar) el **Business Portfolio** de Terminal Gráfica: nombre legal, mail del
   negocio.
3. En **Business Settings → Users → People**, agregarme a mí como **Admin** (o hacerlo por pantalla
   compartida). Anotar el **Business Portfolio ID**.

---

## 3. App en Meta for Developers

1. Entrar a **developers.facebook.com** con un usuario que sea admin del Business del cliente.
2. **My Apps → Create App**.
3. Tipo de app: **Business**. Vincularla al **Business Portfolio del cliente** (paso 2) — esto es lo
   que hace que la app y la WABA queden como activos DEL CLIENTE.
4. Nombre: p. ej. `Terminal Grafica WhatsApp`.

---

## 4. Agregar el producto WhatsApp

1. En la app → **Add Product → WhatsApp → Set up**.
2. Meta crea automáticamente una **WABA de prueba + un número de test**. Ese número NO es el nuestro;
   sirve solo para probar la API. Vamos a agregar el número real en el paso siguiente.
3. Confirmá que la WABA quede dentro del portfolio del cliente (si te pregunta, elegí el del cliente,
   no "crear nueva" bajo otro dueño).

---

## 5. Agregar y verificar el número REAL

1. WhatsApp → **API Setup** (o "Configuración de la API").
2. **Add phone number** / "Agregar número de teléfono".
3. Completar:
   - **Display name** (nombre que ve el cliente en el chat): `Terminal Gráfica`. Meta lo revisa; el
     número igual funciona con el nombre en estado "pendiente".
   - **Categoría** del negocio, descripción corta.
   - **Número** con código de país (`+54 9 …`).
4. **Verificar por OTP** (SMS o llamada). Meter el código.
5. Al terminar, anotá de esta pantalla:
   - **Phone number ID** (NO es el número; es un id largo).
   - **WhatsApp Business Account ID (WABA ID)**.

---

## 6. Token PERMANENTE (System User) — NO usar el temporal de 24 h

El token que muestra "API Setup" arriba dura **24 h**. Para producción necesitamos uno permanente,
atado a un **System User** (no a una persona, así no se rompe si alguien sale del negocio).

1. **Business Settings → Users → System Users → Add**.
   - Nombre: `tg-whatsapp-bot`. Rol: **Admin** (o Employee con los activos asignados).
2. Con el system user seleccionado → **Add Assets**: asignarle
   - la **App** (paso 3) con control total, y
   - la **WABA** (paso 5) con control total.
3. **Generate new token**:
   - Elegir la **App**.
   - Permisos: **`whatsapp_business_messaging`** y **`whatsapp_business_management`**.
   - (Sin expiración.)
4. **Copiar el token — se muestra UNA sola vez.** Guardalo en Bitwarden (bóveda del cliente).

---

## 7. Verificación del negocio (Business Verification)

Necesaria para operar en serio: sube los límites de mensajería y saca el cartel de "negocio no
verificado".

1. **Business Settings → Security Center → Start Verification**.
2. Subir los datos legales (paso 1). Puede tardar **días** en aprobarse.
3. Se puede **empezar a probar** antes de la verificación (número de test / límites bajos), pero el
   número real del cliente conviene tenerlo verificado antes de anunciarlo.

---

## 8. Cablear el canal en Chatwoot

En Chatwoot (self-hosted): **Inbox → Add Inbox → WhatsApp**, provider **WhatsApp Cloud**.

Completar con lo de los pasos 5 y 6:

| Campo en Chatwoot | Valor |
|---|---|
| Phone number | el número, formato internacional |
| Phone number ID | del paso 5 |
| WhatsApp Business Account ID | del paso 5 (WABA ID) |
| API key / Access token | el token permanente del paso 6 |

Al guardar, Chatwoot te da **dos cosas** que van en Meta:
- una **Webhook Callback URL** (algo como `https://chat.terminalgrafica.cloud/webhooks/whatsapp/<número>`)
- un **Verify Token**.

Copialas.

---

## 9. Webhook en la app de Meta

1. App → WhatsApp → **Configuration → Webhooks → Edit**.
2. **Callback URL** = la URL de Chatwoot (paso 8).
3. **Verify Token** = el token de Chatwoot (paso 8).
4. Guardar → Meta hace un GET de verificación; tiene que dar OK contra Chatwoot.
5. **Subscribe** al campo **`messages`** (como mínimo). Ese es el que manda los mensajes entrantes.

---

## 10. Registro del número + PIN de dos pasos

La Cloud API pide el número **registrado** con un **PIN de 6 dígitos** (two-step verification).

1. Setear el **PIN de verificación en dos pasos** en el WhatsApp Manager (o durante el alta).
   Guardalo en Bitwarden: si Meta re-pide verificar, sin el PIN te trabás.
2. Chatwoot (versiones nuevas) registra el número solo al crear el inbox. Si quedó "pending",
   registrar desde WhatsApp Manager / API.

---

## 11. App a modo LIVE

En el dashboard de la app (developers.facebook.com), pasar el toggle de **Development → Live**
(arriba). Sin esto, los webhooks de producción no entran de forma estable.

---

## 12. Prueba end-to-end

1. Desde un WhatsApp **personal cualquiera**, mandar un mensaje al número del cliente.
2. Verificar la cadena completa:
   - entra a **Chatwoot** (aparece la conversación),
   - Chatwoot dispara el **webhook a n8n**,
   - el **bot responde** (consulta de producto → ofrece producto real + precio; consulta de info →
     horario/dirección).
3. Si algo no llega: `docker logs -f rails` en el VPS muestra el error real (ver `PROD-SETUP.md`).

---

## Gotchas / notas

- **El número muere para la app normal de WhatsApp** una vez en la Cloud API. Que el cliente lo
  tenga presente: no puede seguir chateando a mano desde ese número con la app de siempre.
- **Límites de mensajería**: arrancás en un tramo bajo (típico 250–1.000 conversaciones/24 h) hasta
  que el negocio esté **verificado** y la **calidad** del número sea buena. Sube solo con el uso.
- **Ventana de servicio de 24 h**: responder a un usuario que te escribió es **gratis/servicio**
  dentro de las 24 h. Iniciar vos la conversación fuera de ventana necesita **plantillas (templates)**
  aprobadas y se cobra. Para un bot informativo (siempre responde a quien escribe) esto casi no pega.
- **Display name pendiente**: el número funciona aunque el nombre visible siga en revisión.
- **Token**: siempre el de **System User** (paso 6), nunca el temporal ni uno atado a mi persona.
- **Dueño = cliente**: si en algún paso Meta ofrece crear la WABA/app "a tu nombre", frená y elegí
  el Business del cliente. Es el punto que hace que todo esto sea del cliente y no mío.

---

_Referencias del stack: `PROD-SETUP.md` (Chatwoot↔n8n en el VPS), `db/` (schema del bot)._
