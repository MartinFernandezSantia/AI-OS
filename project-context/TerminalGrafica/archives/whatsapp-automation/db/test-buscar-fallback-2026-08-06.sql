-- TEST AISLADO de la query fallback de B-9 (Buscar Candidatos fallback).
-- Preparado por Claude, corre Martin en el SQL Editor de Supabase.
-- Confirma que la fallback (per-token, sin IDF) devuelve candidatos con la MISMA
-- forma que Buscar Candidatos. $1=tokens (Extraer Palabras), $2=ventana, $3=cupo.
-- Si devuelve filas para un pedido normal, la Parte 1 anda.

prepare fb(text, text, int) as
-- BUSQUEDA FALLBACK (B-9) — corre SOLO cuando Buscar Candidatos (IDF) tiro error.
-- Misma FORMA de salida (identicas columnas) para no romper Armar Candidatos, pero
-- SIN la logica IDF (df/pesos/total), que es la parte compleja y probable origen
-- del bug que ya rompio antes. Ranking simple: cuantos tokens del cliente matchea
-- cada producto. Determinística, sin LLM.
-- $1 = tokens normalizados separados por espacio (Extraer Palabras)
-- $2 = ventana (guard de nicho)   $3 = cupo
--
-- OJO (Martin 2026-08-06): se matchea CADA token por separado. Pasar el string
-- entero a un solo ilike '%a b c%' solo matchea esa frase literal y en orden — los
-- % son las puntas, no rellenan huecos. Por eso el join contra unnest(toks).
-- Se evitan <>, #>> y > sueltos: el parser SQL de n8n los parte (ver Buscar
-- Candidatos). length()>0 en vez de <>''; ->/->> se conservan (esos si los banca).
with pedido as (
  select translate(lower(coalesce($2, '')), 'áéíóúñ', 'aeioun') as ventana
),
toks as (
  select distinct t as tok
  from unnest(string_to_array(trim($1), ' ')) as t
  where length(t) > 0
),
buscable as (
  select t.producto_id, t.nombre_canonico,
         ' ' || regexp_replace(
           translate(lower(t.nombre_canonico || ' ' || coalesce(array_to_string(t.sinonimos, ' '), '')),
                     'áéíóúñ', 'aeioun'),
           '[^a-z0-9]+', ' ', 'g') || ' ' as texto
  from bot.taxonomia t
),
-- score = CANTIDAD de tokens que matchea el producto (OR + ranking por cuenta).
-- El join solo emite productos con al menos 1 token: red bien ancha.
crudo as (
  select b.producto_id, b.nombre_canonico,
         count(*)::numeric as score,
         count(*) as n_tokens,
         array_agg(k.tok) as tokens_match
  from buscable b
  join toks k on b.texto like '% ' || k.tok || '%'
  group by b.producto_id, b.nombre_canonico
),
nombrado as (
  select c.producto_id,
         exists (
           select 1 from toks k
           where translate(lower(c.nombre_canonico), 'áéíóúñ', 'aeioun') like '%' || k.tok || '%'
             and length(k.tok) >= 4
         ) as por_nombre
  from crudo c
),
flags as (
  select v.producto_id,
         max(v.atributos->>'nicho') as nicho,
         min(v.precio_lista) filter (where v.precio_lista > 0) as precio_piso,
         max(v.precio_lista) as precio_techo,
         count(*) as n_variantes
  from bot.variantes v
  group by v.producto_id
),
ejes as (
  select e.producto_id,
         jsonb_object_agg(e.k, e.vals) as ejes_variantes
  from (
    select v.producto_id, kv.key as k, jsonb_agg(distinct vv.val) as vals
    from bot.variantes v
    cross join lateral jsonb_each(coalesce(v.atributos, '{}'::jsonb)) kv
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(kv.value) = 'array'  then kv.value
           when jsonb_typeof(kv.value) = 'string' then jsonb_build_array(kv.value)
           when jsonb_typeof(kv.value) = 'number'
             then jsonb_build_array(to_jsonb(trim(both '"' from kv.value::text)))
           else '[]'::jsonb end) as vv(val)
    where kv.key in ('tamano','faz','color','acabado','cobertura','material','papel','gramaje_gr')
    group by v.producto_id, kv.key
  ) e
  group by e.producto_id
),
atrs as (
  select t.producto_id, t.atributos, t.familias
  from bot.taxonomia t
),
filtrado as (
  select c.producto_id, c.nombre_canonico, c.score, c.n_tokens, c.tokens_match,
         f.nicho, f.precio_piso, f.precio_techo, f.n_variantes, nb.por_nombre,
         a.atributos, a.familias, coalesce(ej.ejes_variantes, '{}'::jsonb) as ejes_variantes
  from crudo c
  join flags f using (producto_id)
  join nombrado nb using (producto_id)
  join atrs a using (producto_id)
  left join ejes ej using (producto_id)
  cross join pedido pe
  -- MISMO guard de nicho que el original: un producto de precio por rubro no es
  -- candidato si el cliente no nombro el rubro. Un fallback no relaja reglas de negocio.
  where (f.nicho is null
         or (f.nicho = 'medicina'      and pe.ventana ~ 'medicin')
         or (f.nicho = 'inmobiliarias' and pe.ventana ~ 'inmobiliari|inmueble'))
),
-- SIN corte relativo (a diferencia del IDF, que corta al 40% del mejor): en un
-- fallback queremos la red mas ancha. Todo lo que matcheo al menos 1 token entra;
-- se ordena y se aplica el cupo.
elegidos as (
  select f.*, coalesce((f.atributos->>'default_familia')::boolean, false) as es_default
  from filtrado f
  order by coalesce((f.atributos->>'default_familia')::boolean, false) desc,
           f.score desc, f.n_tokens desc, f.precio_piso asc nulls last
  limit greatest(coalesce($3::int, 8), 1)
)
select e.producto_id, e.nombre_canonico, e.score, e.n_tokens, e.tokens_match,
       e.nicho, e.precio_piso, e.precio_techo, e.n_variantes, e.por_nombre,
       e.familias, e.ejes_variantes, e.es_default,
       row_number() over (order by e.es_default desc, e.score desc, e.n_tokens desc,
                                   e.precio_piso asc nulls last) as orden,
       v.variante_id, v.variante, v.color, v.unidad, v.precio_lista, v.precio_actualizado,
       v.por_pagina, v.por_pack, v.tiene_reglas, v.solo_descuentos, v.tiene_override,
       v.n_reglas_cantidad, v.rangos_cantidad, v.mostrable,
       v.atributos, e.atributos as atributos_producto,
       1 as match_rank, 1 as idx
from elegidos e
join bot.variantes v on v.producto_id = e.producto_id
order by orden, v.precio_lista asc nulls last
;

-- Caso 1: pedido normal multi-palabra (deberia traer varias impresiones/variantes)
execute fb('impresion color obra', '', 8);

-- Caso 2: una sola palabra distintiva
execute fb('tarjetas', '', 8);

-- Caso 3: guard de nicho — 'medicina' sin nombrarla NO deberia aparecer
execute fb('modulos', '', 8);
-- vs nombrando el rubro:
execute fb('modulos medicina', 'necesito para medicina', 8);

deallocate fb;
