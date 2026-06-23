# Personal CRM — Spec v1 (WIP)

> Diseño conversado 2026-06-23. Estado: definido, sin código. Continuar próxima sesión.

## Qué es

Memoria estructurada de relaciones (no una agenda): recordar y entender mejor a clientes y
círculo de Martin en el tiempo, alimentada por Hermes y con avisos. Lo construimos nosotros
(no Monica off-the-shelf) para tener UI moderna y que evolucione con las necesidades.

## Decisiones tomadas

- **Build propio**, no herramienta cerrada.
- **Canal-agnóstico**: el canal de ingesta/avisos es un adaptador intercambiable, no se ata a
  WhatsApp. Soportar WhatsApp / Telegram / Discord + UI web. **Arrancar por Telegram** (Bot API
  gratis, se levanta en una tarde) para validar el loop; WhatsApp después reusando el pipeline
  Chatwoot/n8n existente; Discord = otro adaptador.
- **v1 delgado**: personas + hechos + cumpleaños con aviso. Interacciones, follow-ups y vínculos
  en v2.
- **Es un primer pedazo de Hermes**: el parse + cron + adaptadores son su capa de "doer".
- **Dónde vive**: repo propio en `projects/<crm>` (rama feature, nunca main). Companion docs acá.

## Arquitectura

```
  Telegram bot ┐
  WhatsApp     ┤→  [Parse: Claude]  →  [Núcleo CRM]  →  Supabase
  Discord bot  ┘     intención+         upsert/query
                     entidades
       ▲                                     │
       └──────── [Cron diario] ←─────────────┘
                 recordatorios vencidos → avisa por el canal preferido

  UI web (Next + Supabase): revisar, editar, ver perfil + timeline de hechos
```

- **Núcleo** (lógica pura, sin saber de canales): `upsertPersona`, `addHechos`, `setRecordatorio`,
  `getPerfil`, `recordatoriosDelDia`.
- **Parse**: Claude convierte texto libre ("anotá que Juan del print shop cumple el 12/3 y le
  gusta el fútbol") en operaciones estructuradas (crear persona / agregar hechos / armar
  recordatorio).
- **Adaptadores**: cada canal solo hace recibir → parse → núcleo → responde.
- **Cron**: diario, revisa recordatorios vencidos, enriquece con Claude ("la última vez hablaron
  de la cotización de folletos") y avisa.
- **UI**: Next + Supabase (lista, perfil con timeline de hechos, edición, próximos recordatorios).

## Esquema v1 (Supabase)

- **`people`** — `id, full_name, aliases[], relationship_type, business, role, primary_channel,
  handle, language, location, how_met, created_at`
- **`facts`** — `id, person_id, content, category ('interest'|'family'|'preference'|'bio'…),
  source, created_at` ← corazón evolutivo (JSONB/flexible, sin migraciones por hecho nuevo)
- **`reminders`** — `id, person_id, kind ('birthday'|…), recur ('annual MM-DD'|fecha),
  next_fire_at, message, active` ← genérico desde el día 1; cumpleaños = `kind='birthday'`;
  follow-ups de v2 reusan la tabla sin migrar

## Import masivo desde WhatsApp (sin conectar la API)

Camino distinto al ingest on-the-fly: una vez por cliente, para bootstrapear el CRM con contexto
real de la relación. Posible HOY sin infra y sin tocar ToS/API:

1. WhatsApp → abrir chat → **Exportar chat → Incluir archivos** → `_chat.txt` (timestamps) +
   adjuntos (audios `.opus` Android / `.m4a` iOS, imágenes).
2. **Transcribir audios con Whisper local** (open-source, self-host → cumple la regla; y mantiene
   el audio del cliente en la máquina, sin terceros). `.opus`→wav con ffmpeg. Multilingüe ES/EN.
3. **Re-armar la línea de tiempo**: reemplazar cada marcador `PTT-….opus (archivo adjunto)` por su
   transcripción → una sola conversación de texto completa, audios incluidos, en orden.
4. **Claude lee entero** → perfil + hechos atómicos + resumen de la relación + posibles follow-ups
   → upsert al CRM con revisión de Martin.

Caveats: el export de WhatsApp trunca chats muy largos y no adjunta toda la media histórica
(alcanza igual para entender al cliente). Privacidad: Whisper local, no API de terceros.

## Próximos pasos (siguiente sesión)

1. Decidir/afinar: categorías de hechos, multi-idioma, manejo de personas duplicadas/ambiguas.
2. Probar el import de WhatsApp con un chat real: script mínimo export → ffmpeg → Whisper → merge
   → resumen con Claude. Valida la pieza más jugosa antes de construir alrededor.
3. Scaffold: repo en `projects/`, migración Supabase de las 3 tablas, loop mínimo de Telegram
   (mensaje → parse → upsert → responde) end-to-end.
4. UI Next mínima y cron de cumpleaños.
