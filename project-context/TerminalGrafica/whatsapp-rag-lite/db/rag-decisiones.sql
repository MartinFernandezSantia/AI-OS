-- Registro de decisiones del bot RAG lite: por cada mensaje del bot, qué productos recomendó.
-- Tabla PROPIA (no bot.decisiones del v10) para no mezclar la analítica del experimento.
-- Se escribe con la misma credencial que el v10 usa para loguear (rol del bot, que ya inserta en
-- bot.decisiones). Aplicar en el SQL Editor como owner/admin.

create table if not exists bot.rag_decisiones (
  id           uuid primary key default gen_random_uuid(),
  session_id   text not null,                 -- conversación (sessionId del Chat Trigger / conv de Chatwoot)
  created_at   timestamptz not null default now(),
  mensaje      text not null,                 -- el texto FINAL enviado (ya con los precios inyectados)
  estado       text not null default 'ok',    -- ok | corregido | regenerado | rechazado
  productos    jsonb not null default '[]',   -- productos que sobrevivieron; [] si corregido/rechazado
  precios      jsonb not null default '[]',   -- precios_solicitados declarados
  verificacion jsonb                          -- veredicto del Verificador (accion, fallas) — observabilidad
);

create index if not exists rag_decisiones_session_idx on bot.rag_decisiones (session_id, created_at);

-- El bot escribe con el mismo rol que ya inserta en bot.decisiones (la cred "Bot Readonly DB").
-- Ajustá el nombre del rol si difiere; sin el grant el INSERT falla (el nodo Log Decisión tiene
-- onError=continue, así que un fallo de log NO rompe la respuesta al cliente).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'bot_readonly') then
    grant usage on schema bot to bot_readonly;
    grant insert, select on bot.rag_decisiones to bot_readonly;
  end if;
end $$;
