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

-- --- SEED — valores reales de TG (Martin, 2026-08-03) -------------------------
-- Datos confirmados por Martin. Queda UNA fila 'COMPLETAR' (factura): resolver con
-- TG antes o después de aplicar. Los `valor` están redactados como frases claras y
-- autónomas: son los hechos que el agente de info lee y parafrasea (no los tipea el
-- LLM de memoria). Podés editar el texto libremente; mantené las claves legibles.
insert into bot.info_negocio (clave, valor) values
  ('horario_semana',  'De lunes a viernes atendemos de 8 a 20 hs.'),
  ('horario_sabado',  'Los sábados atendemos de 9 a 13 hs. Domingos cerrado.'),
  ('direccion',       'Estamos en Rodríguez Peña 3865.'),
  ('estacionamiento', 'No tenemos estacionamiento propio para clientes, pero se puede estacionar sobre ambos lados de la calle Rodríguez Peña.'),
  ('pago',            'Aceptamos efectivo y transferencia. Para arrancar un trabajo se pide una seña del 30%.'),
  ('factura',         'COMPLETAR: ¿emiten factura? ¿qué tipo (A/B/C)?'),
  ('envio',           'No hacemos envíos: los trabajos se retiran en el local, en Rodríguez Peña 3865.'),
  ('plazo',           'El plazo de entrega depende de cada trabajo y se confirma por mail.'),
  ('urgente',         'Trabajamos pedidos urgentes, pero eso se coordina por mail o directamente en el local.'),
  ('contacto',        'Este WhatsApp es solo informativo. Para hacer un pedido o hablar con una persona del equipo, escribinos a terminalgrafica@gmail.com o acercate al local.'),
  ('contacto_redes',  'Nos encontrás en Instagram (instagram.com/terminalgrafica) y en Facebook (facebook.com/terminalgrafica).'),
  ('presentacion',    'Soy el asistente virtual de Terminal Gráfica.')
on conflict (clave) do nothing;

-- Sanity tras aplicar:
--   select clave, valor from bot.info_negocio order by clave;   -- deben aparecer tus filas
--   select * from bot.firewall_check is otra cosa; acá solo verificá que bot_readonly lee:
--   set role bot_readonly; select count(*) from bot.info_negocio; reset role;
-- =============================================================================
