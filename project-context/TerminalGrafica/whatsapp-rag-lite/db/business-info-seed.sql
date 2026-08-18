-- =============================================================================
-- bot.business_info — SEED de la info operativa del negocio (greenfield key/value)
-- =============================================================================
-- Fuente de la rama INFO del bot: la tool `consultar_info_negocio` lee de
-- bot.rag_business_info, que se puebla con `pnpm rag:ingest:info --apply` LEYENDO
-- esta tabla (select key, value from bot.business_info where value not ilike 'COMPLETAR%').
--
-- Reemplaza al viejo bot.info_negocio(clave, valor) del v10 (info-negocio.sql): el
-- greenfield renombró la tabla a bot.business_info(key, value). Las CLAVES quedan en
-- ESPAÑOL a propósito (el scoring por tema hace key.includes('horario'|'pago'|…)).
--
-- Valores confirmados por Martin (2026-08-03). Queda UNA fila 'COMPLETAR' (factura):
-- el ingest la SALTEA sola (filtro value not ilike 'COMPLETAR%') hasta que la llenes.
-- Aplicar como owner/admin (la tabla la crea schema-bot.sql). Idempotente.
-- =============================================================================

insert into bot.business_info (key, value) values
  ('horario_semana',  'De lunes a viernes atendemos de 8 a 20 hs.'),
  ('horario_sabado',  'Los sábados atendemos de 9 a 13 hs. Domingos cerrado.'),
  ('direccion',       'Estamos en Rodríguez Peña 3865.'),
  ('pago',            'Aceptamos efectivo y transferencia. Para arrancar un trabajo se pide una seña del 30%.'),
  ('envio',           'No hacemos envíos: los trabajos se retiran en el local, en Rodríguez Peña 3865.'),
  ('plazo',           'El plazo de entrega depende de cada trabajo y se confirma por mail.'),
  ('urgente',         'Trabajamos pedidos urgentes, pero eso se coordina por mail o directamente en el local.'),
  ('contacto',        'Este WhatsApp es solo informativo. Para hacer un pedido o hablar con una persona del equipo, escribinos a terminalgrafica@gmail.com o acercate al local.'),
  ('contacto_redes',  'Nos encontrás en Instagram (instagram.com/terminalgrafica) y en Facebook (facebook.com/terminalgrafica).')
on conflict (key) do nothing;

-- Sanity tras aplicar:
--   select key, value from bot.business_info order by key;                 -- 12 filas
--   select count(*) from bot.business_info where value not ilike 'COMPLETAR%';  -- 11 (las que ingesta)
