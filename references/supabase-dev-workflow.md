# Supabase: aislar prod + workflow de dev

Guía general (cualquier proyecto que use Supabase). Dos temas que van juntos:
proteger prod de un borrado accidental, y trabajar en dev de forma que el repo
sea la verdad completa y `db reset` local reconstruya fiel.

---

## 1. Aislar prod (que un error no la pueda borrar)

El peligro real es `supabase db reset --linked` (y `db push`): borran/reescriben la
DB **remota**. Defensas ordenadas de la más infalible a la más frágil.

### Capa 1 — Recuperabilidad (la única infalible)
Todo lo demás se bypassea; esto no.
- **Activá PITR (Point-in-Time Recovery)** en prod (plan Pro). Volvés a cualquier segundo.
- En free: confirmá daily backups + `pg_dump` manual antes de tocar prod.
- Mentalidad: no confíes en "no me voy a equivocar"; confiá en "lo recupero en 5 min".

### Capa 2 — Aislamiento de capacidad (la que de verdad importa)
Que el entorno local **no pueda alcanzar prod**.
- **Nunca dejes prod linkeado en local.** Sin `supabase/.temp/project-ref`, `--linked` falla solo. Si linkeás para algo puntual → `supabase unlink` al terminar.
- **No guardes el access token de prod en tu máquina** (`~/.supabase/access-token` o `SUPABASE_ACCESS_TOKEN`). Sin token con permisos sobre prod, ningún reset la alcanza.
- **Proyecto de staging separado.** El único Supabase que linkeás/reseteás en local es uno de juguete. Prod se toca solo por migraciones revisadas vía CI, donde el único comando permitido es `db push` (nunca `reset`).

### Capa 3 — Speed bumps (baratos pero burlables)
Deny rules en `.claude/settings.json` (string-matching; se esquivan con eval/alias, pero frenan el resbalón obvio). Apuntar SOLO a lo que toca remoto, para no bloquear el `db reset` local que es seguro:
```
"Bash(*--linked*)",
"Bash(*db push*)",
"Bash(*supabase link*)",
```
Nota: NO denegar `pnpm supabase` en bloque — mataría el reset local diario.

---

## 2. Workflow de dev

### El loop
- **Source of truth = migraciones** (`supabase/migrations/`), committeadas. Nada de schema vive solo en prod.
- **Comando diario: `supabase db reset` SIN `--linked`.** Borra y recrea solo el Postgres local en Docker (replay de migraciones + `seed.sql`). Seguro, corrélo 20 veces al día. El peligro nunca fue `db reset`, fue `--linked`.

Flujo de un cambio de schema:
1. `supabase migration new <nombre>`
2. Editás el SQL
3. `supabase db reset` (local) → testeás desde cero
4. Anda → `db push` a staging, y a prod solo por CI

### Data: fake, no prod
- **Seed de fake data committeado** (`supabase/seed.sql`). Determinístico, rápido, lo comparte git, anda en CI.
- Evitar copiar prod como rutina: PII real, el Storage (blobs) no viaja en un dump SQL, y te tienta a apuntar a prod.
- Excepción puntual: si necesitás *formas* realistas (volumen, edge cases), dump **anonimizado de una sola vez**, no el loop diario.
- Storage en apps de upload: el seed SQL siembra las **filas**; los archivos de prueba los subís a mano contra el Storage local.

---

## 3. El gran "gotcha": no todo vive en las migraciones

`db reset` local solo replica `migrations/` + `seed.sql` + `config.toml`. **Todo lo que
clickeás en el dashboard es invisible para él** → por eso un reset puede no reconstruir fiel
("drift de dashboard").

Vive FUERA de las migraciones (y hay que llevarlo a config/SQL a mano):
- **Config de Auth** — providers (Google…), templates de email, JWT settings, **hooks** → `config.toml`
- **Buckets de Storage** + policies → `config.toml` (`[storage.buckets]`) o insert en migración
- **RLS policies** clickeadas en vez de escritas en SQL
- **Extensions, roles, grants, cron (pg_cron), webhooks**
- **Edge Functions** → aparte, en `supabase/functions/`

### Caso típico: custom claims en el JWT (Custom Access Token Hook)
Tiene DOS partes en lugares distintos — por eso un reset que solo trae la función no alcanza:

**A) La función → migración** (es solo una función Postgres + grants):
```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable as $$
declare
  claims jsonb;
  user_role text;
begin
  select role into user_role from public.user_roles where user_id = (event->>'user_id')::uuid;
  claims := event->'claims';
  if user_role is not null then
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
  end if;
  event := jsonb_set(event, '{claims}', claims);
  return event;
end; $$;

-- sin estos grants Auth no puede llamar la función:
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
```

**B) El cableado → `config.toml`** (esto es config, NO schema; en prod es el toggle Auth > Hooks del dashboard):
```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"
```
Migración + config.toml juntos = paridad real. Sin (B), aunque la función exista, Auth local no la usa.

---

## 4. Cura del drift que YA tenés en prod

Para recuperar lo que está en prod pero en ningún archivo:
```bash
supabase link --project-ref <id>   # link puntual, solo para leer
supabase db pull                    # introspecciona prod y escribe una migración con el schema actual
supabase unlink                     # te desconectás de prod (Capa 2)
```
`db pull` es **solo lectura** sobre prod (no la toca, la fotografía). La config de Auth/Storage
NO la trae `db pull` → esa la copiás a mano al `config.toml` mirando el dashboard.

---

## 5. La disciplina que cierra el tema

**El dashboard es de solo lectura.** Nada de schema o config nace de un click:
todo se escribe como migración (schema) o en `config.toml` (auth/storage/hooks), se prueba
con `db reset` local, y recién ahí va a prod. Así el reset local SIEMPRE reconstruye fiel,
porque el repo es la verdad completa.
