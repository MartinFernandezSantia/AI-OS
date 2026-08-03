-- =============================================================================
-- bot.info_negocio — datos operativos del negocio para la rama INFO del bot.
-- =============================================================================
-- Preparada por Claude, APLICA MARTIN (regla: yo preparo, vos aplicás).
--
-- POR QUÉ EXISTE ESTE ARCHIVO. La tabla la consultan dos lugares del flow:
--   - nodo Postgres `Datos Info`  -> select clave, valor ... order by clave limit 40
--   - tool `consultar_info_negocio` -> where clave ilike '%'||$1||'%'
-- pero la tabla NUNCA se creó (no había migración en el repo ni objeto en la base).
-- Con la tabla ausente, ambas queries devuelven vacío y TODA la rama info queda
-- inerte: cualquier "¿a qué hora abren?" se va a mail. Los tests no lo veían porque
-- mockean las filas (ver tests-fixtures-mienten). Este archivo cierra el hueco y,
-- de paso, deja la tabla versionada y reproducible.
--
-- Son pares clave/valor CURADOS A MANO. NO salen del quote-system (public.*):
-- eso son productos y precios; esto es info del negocio.
-- =============================================================================

create schema if not exists bot;

create table if not exists bot.info_negocio (
  clave       text        primary key,
  valor       text        not null,
  updated_at  timestamptz not null default now()
);

-- La rama info (Salida Info) PUNTÚA cada fila contra la pregunta usando el mapa
-- PISTAS por tema: horario, direccion, pago, envio, plazo, contacto. Conviene que
-- la `clave` contenga la palabra del tema (el scoring hace clave.includes(tema)).
-- Podés tener varias filas por tema (ej. 'horario_semana', 'horario_sabado').

-- --- Grant de lectura para la cred del bot (mismo patrón que el firewall) ------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'bot_readonly') then
    grant usage on schema bot to bot_readonly;
    grant select on bot.info_negocio to bot_readonly;
    raise notice 'Grant SELECT en bot.info_negocio a bot_readonly.';
  else
    raise notice 'Rol bot_readonly no existe: si n8n conecta como otro rol, otorgale SELECT en bot.info_negocio.';
  end if;
end $$;

-- --- SEED — MARTIN COMPLETA con los valores reales de TG y aplica -------------
-- Reemplazá cada 'COMPLETAR: ...' por el dato real. Borrá las filas que no apliquen
-- y agregá las que falten. El `valor` es el texto que puede terminar en el mensaje
-- al cliente (o del que Salida Info arma el respaldo), así que redactalo claro.
insert into bot.info_negocio (clave, valor) values
  ('horario',   'COMPLETAR: días y horarios de atención'),
  ('direccion', 'COMPLETAR: dirección del local'),
  ('pago',      'COMPLETAR: formas de pago (efectivo, transferencia, Mercado Pago, tarjeta)'),
  ('envio',     'COMPLETAR: ¿hay envíos o solo retiro en el local?'),
  ('plazo',     'COMPLETAR: plazos de entrega / cómo se informan'),
  ('contacto',  'COMPLETAR: teléfono / mail / instagram')
on conflict (clave) do nothing;

-- Sanity tras aplicar:
--   select clave, valor from bot.info_negocio order by clave;   -- deben aparecer tus filas
--   select * from bot.firewall_check is otra cosa; acá solo verificá que bot_readonly lee:
--   set role bot_readonly; select count(*) from bot.info_negocio; reset role;
-- =============================================================================
