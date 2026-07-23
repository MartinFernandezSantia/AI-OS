-- C2: grant de lectura del router (Get Ruta Cotizador lee bot.decisiones).
-- En TESTING el rol bot_readonly NO existe (la cred "Bot Readonly DB" conecta
-- como owner y ya lee/escribe bot.decisiones — Log Respuesta lo prueba en cada
-- turno), así que acá esto es un no-op con NOTICE. Queda guardado para prod:
-- si allá la cred usa un rol restringido, este bloque le da el SELECT.
-- Si el rol de prod tiene OTRO nombre, cambiá 'bot_readonly' por ese nombre.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'bot_readonly') then
    grant select on bot.decisiones to bot_readonly;
    raise notice 'Grant SELECT de bot.decisiones otorgado a bot_readonly.';
  else
    raise notice 'Rol bot_readonly no existe: sin grants (n8n como owner ya accede).';
  end if;
end $$;
