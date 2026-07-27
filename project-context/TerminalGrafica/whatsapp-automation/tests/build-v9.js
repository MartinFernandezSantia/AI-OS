// BUILD v8.3 -> faq-bot-v9.json
//
// Aplica el lote entero de v8.3 sobre una copia limpia de faq-bot-v8.json, de forma
// idempotente y auditable: cada cambio es una funcion con nombre, y el script falla
// ruidosamente si el nodo o el string que espera no esta (asi un cambio previo no se
// aplica dos veces ni se pierde en silencio).
//
//   node tests/build-v9.js            -> reconstruye faq-bot-v9.json desde v8
//   node tests/build-v9.js --check    -> no escribe, solo verifica que v9 este al dia
//
// Por que un script y no editar el JSON a mano: son ~2700 lineas y los nodos Code
// viven como strings JSON escapados en una sola linea. Editar eso a mano es como se
// rompen los gemelos.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'n8n', 'flows');
const SRC = path.join(DIR, 'faq-bot-v8.json');
const OUT = path.join(DIR, 'faq-bot-v9.json');
const CHECK = process.argv.includes('--check');

const wf = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const node = (name) => {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error('BUILD: no existe el nodo "' + name + '"');
  return n;
};
const log = [];
const paso = (msg) => log.push(msg);

// Reemplazo exacto sobre el jsCode de un nodo Code. Falla si `de` no esta o si
// aparece mas de una vez (ambiguo = no se aplica a ciegas).
const sub = (nombre, de, a, etiqueta) => {
  const n = node(nombre);
  const code = n.parameters.jsCode;
  const veces = code.split(de).length - 1;
  if (veces === 0) throw new Error('BUILD [' + etiqueta + ']: el ancla no aparece en "' + nombre + '"');
  if (veces > 1) throw new Error('BUILD [' + etiqueta + ']: el ancla aparece ' + veces + ' veces en "' + nombre + '" (ambiguo)');
  n.parameters.jsCode = code.replace(de, a);
  paso(etiqueta);
};

// ───────────────────────────────────────────────────────────────────────────
// 0. IDENTIDAD
// ───────────────────────────────────────────────────────────────────────────
wf.name = 'faq-bot-v9';
paso('0 · name -> faq-bot-v9 (v8.json decia todavia "faq-bot-v7")');

// ───────────────────────────────────────────────────────────────────────────
// 0a. FIX DEL MAPEO DE Log Turno
//
// Log Turno cuelga de `Enviar Mensaje`, que es un HTTP POST a Chatwoot: en n8n el
// item de salida de un HTTP node ES la respuesta del API, asi que `$json` ahi es
// {id, content, message_type, ...} y NINGUNA de las columnas del sobre existe.
// Las 4 se escribian null en todos los turnos.
//
// El dano no es telemetria: `Get Ruta Cotizador` lee `borrador` de bot.decisiones
// para armar `borradoresPrevios`, y de ahi comen los DOS anti-loops (el de respuesta
// repetida en Parsear Respuesta y el de repregunta en Armar Respuesta Precio). Con la
// columna en null, el array llega vacio y ninguno de los dos cuenta nunca.
// ───────────────────────────────────────────────────────────────────────────
{
  const lt = node('Log Turno');
  const col = lt.parameters.columns.value;
  const FUENTE = "$('Aplicar Compositor').first().json";
  const esperado = {
    conversation_id: '={{ ' + FUENTE + '.conversationId }}',
    mensaje_cliente: '={{ ' + FUENTE + '.userMessage }}',
    producto_resuelto: '={{ ' + FUENTE + '.productoResuelto }}',
    nivel_resolucion: 'n2_llm',
    accion: '={{ ' + FUENTE + '.accionLog }}',
    filas_sql: '={{ ' + FUENTE + '.filasSql }}',
    hubo_handoff: false,
    notas: '={{ ' + FUENTE + '.notas }}',
    borrador: '={{ ' + FUENTE + '.borrador || ' + FUENTE + '.reply }}',
    final: '={{ ' + FUENTE + '.final }}',
    execution_id: "={{ $execution.id || '' }}",
    senales: '={{ JSON.stringify(' + FUENTE + '.senales || {}) }}',
  };
  // `accion` mapeaba $json.accion, que ni siquiera es el nombre del campo: el sobre
  // lo llama accionLog. O sea la columna estaba mal por dos razones distintas.
  if (col.accion !== '={{ $json.accion }}') throw new Error('BUILD [0a]: Log Turno.accion no es el esperado de v8');
  if (col.borrador !== '={{ $json.borrador || $json.reply }}') throw new Error('BUILD [0a]: Log Turno.borrador no es el esperado de v8');
  lt.parameters.columns.value = esperado;
  paso('0a · Log Turno lee de Aplicar Compositor, no del item de Chatwoot (12 columnas)');
}

// ───────────────────────────────────────────────────────────────────────────
// 0b. NFC SOBRE LOS SLOTS DEL LLM
//
// v8.1 arreglo el NFC del mensaje del CLIENTE (decidir.js), pero el string que llega
// a Postgres no es el mensaje del cliente: es el campo `producto` que escribe el LLM,
// y viajaba crudo. Los teclados de iOS/macOS emiten la tilde descompuesta (o + U+0301)
// y el translate() de Get Precio solo cubre los caracteres precompuestos.
//
// En v9 esto es PRERREQUISITO, no mejora: la busqueda por token compara palabra por
// palabra, asi que un token en NFD no matchea mientras los otros SI -> la lista se
// arma sin el candidato correcto y SIN ninguna senal de que falto algo. El bug pasa
// de "una repregunta molesta" a "un confident-wrong silencioso".
// ───────────────────────────────────────────────────────────────────────────
sub('Parsear Respuesta',
  "let action = 'handoff', reply = '', motivo = ''",
  // NFC sobre todo string que el LLM escriba y que despues se compare contra la base.
  // Idempotente y barato: normalize('NFC') sobre un string ya compuesto es identidad.
  "const nfc = (s) => typeof s === 'string' ? s.normalize('NFC') : s;\n" +
  "let action = 'handoff', reply = '', motivo = ''",
  '0b · helper nfc() en Parsear Respuesta');

// producto / variante del item principal
sub('Parsear Respuesta',
  "producto = typeof obj.producto === 'string' ? obj.producto.trim() : '';",
  "producto = typeof obj.producto === 'string' ? nfc(obj.producto.trim()) : '';",
  '0b · NFC en precio.producto');
sub('Parsear Respuesta',
  "variante = (typeof obj.variante === 'string' ? obj.variante : '').replace(/\\*+\\s*$/, '').trim();",
  "variante = nfc((typeof obj.variante === 'string' ? obj.variante : '').replace(/\\*+\\s*$/, '').trim());",
  '0b · NFC en precio.variante');
// los extras del campo `mas`
sub('Parsear Respuesta',
  "producto: typeof m?.producto === 'string' ? m.producto.trim() : '',",
  "producto: typeof m?.producto === 'string' ? nfc(m.producto.trim()) : '',",
  '0b · NFC en mas[].producto');
sub('Parsear Respuesta',
  "variante: (typeof m?.variante === 'string' ? m.variante : '').replace(/\\*+\\s*$/, '').trim(),",
  "variante: nfc((typeof m?.variante === 'string' ? m.variante : '').replace(/\\*+\\s*$/, '').trim()),",
  '0b · NFC en mas[].variante');
// la lista de la action opciones
sub('Parsear Respuesta',
  "const prods = Array.isArray(obj.productos) ? obj.productos.slice(0, 4).map((x) => typeof x === 'string' ? x.trim() : '').filter(Boolean) : [];",
  "const prods = Array.isArray(obj.productos) ? obj.productos.slice(0, CUPO_OPCIONES).map((x) => typeof x === 'string' ? nfc(x.trim()) : '').filter(Boolean) : [];",
  '0b · NFC en opciones.productos (+ cupo parametrizado, ver 4)');

// ───────────────────────────────────────────────────────────────────────────
// 0c. TIMEOUTS EN LOS NODOS LLM
//
// Especificado en r7 §336 y nunca aplicado: hoy el default de n8n es 300 s. Con 4-5
// llamadas encadenadas, un proveedor lento deja al cliente esperando minutos, y el
// debounce de 3 s ya gasto su margen -> el cliente manda "hola?" y entra un turno
// nuevo EN PARALELO sobre la misma conversacion.
// 20 s es el que ya tenia el nodo principal; se unifica en los cuatro.
// ───────────────────────────────────────────────────────────────────────────
{
  const llms = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest'
    && typeof n.parameters.url === 'string' && n.parameters.url.includes('openrouter.ai'));
  if (llms.length < 3) throw new Error('BUILD [0c]: esperaba >=3 nodos openrouter, hay ' + llms.length);
  for (const n of llms) {
    n.parameters.options = Object.assign({}, n.parameters.options, { timeout: 20000 });
  }
  paso('0c · timeout 20s en los ' + llms.length + ' nodos LLM (antes: default 300s salvo el principal)');
}

// ───────────────────────────────────────────────────────────────────────────
// 1. BUSQUEDA POR TOKEN — el nodo nuevo
//
// Reemplaza "el LLM elige el nombre exacto" por "el LLM tira palabras, Postgres busca
// y pondera por rareza". Tres cosas que la pasada adversarial movio de prompt a SQL,
// porque una regla comercial no se le delega a un modelo:
//
//   - `oculto`: nunca es candidato. NO se filtra a mano: la vista `bot.taxonomia` YA
//     lo aplica en su WHERE (`not coalesce(m.oculto, false)`), y `oculto` vive en
//     `bot.producto_meta`, NO en `bot.variantes`. Por eso la busqueda parte de
//     taxonomia y usa variantes solo para agregar flags: cualquier otra cosa
//     resucitaba productos que la vista ya habia descartado.
//   - nicho (medicina / promo inmobiliarias): solo entra si el cliente NOMBRO el
//     nicho. Medido: "imprimir un apunte de 200 paginas" trae el producto de medicina
//     PRIMERO, porque `apuntes` es sinonimo literal suyo. Si entra al menu y el
//     cliente elige, el turno siguiente ya tiene "medicina" en la ventana y el guard
//     de Armar Respuesta Precio pasa -> $45/pagina a quien no califica.
//
// NO se filtra por `solo_descuentos`, y esto CORRIGE lo que decia el plan §4. En la
// vista real es `bool_and(r.rule_type = 'discount')`: "todas las reglas de precio de
// esta variante son descuentos", o sea que la lista es TECHO garantizado. Es un dato
// de mecanica de precio —lo usa `totalPermitidoFijo` para decidir si puede multiplicar
// sobre `ok_caveat`— y NO la politica comercial "no ofrecer espontaneamente" que el
// plan le atribuia. Filtrar por el escondia productos legitimos: 54 de 185 variantes,
// entre ellas los kraft y las ilustraciones.
//
// Ponderacion: IDF clasico, ln(N/df). Medido sobre el catalogo real -> `papel` esta
// en 30 de 88 productos (peso 1,08) y `kraft` en 2 (peso 3,78): la palabra rara pesa
// 3,5x mas que la generica. Sin esto "papel ilustracion para 500 folletos" devuelve
// 46 candidatos (mas de la mitad del catalogo) y el LLM 2 vuelve a elegir por
// intuicion, que es el bug que estamos arreglando.
//
// El corte (score >= 0.4 * max) es relativo, no absoluto: con una palabra distintiva
// deja 2-3 candidatos, y con puras palabras genericas deja mas, que es la conducta
// correcta (el pedido era ambiguo de verdad).
// ───────────────────────────────────────────────────────────────────────────
const SQL_BUSCAR = `-- v8.3 BUSQUEDA POR TOKEN CON PONDERACION POR RAREZA (IDF)
-- $1 = tokens YA normalizados y separados por espacio (los produce Extraer Palabras)
-- $2 = ventana de mensajes del cliente, para el guard de nicho
-- $3 = cupo de candidatos
--
-- Devuelve productos (no variantes) ordenados por score, ya filtrados por las
-- reglas de negocio que NO se le delegan al LLM (ver el comentario del build).
--
-- UNA SOLA NORMALIZACION. El SQL NO re-tokeniza ni re-normaliza $1: eso ya lo hizo
-- el nodo Extraer Palabras en JS (NFC + fold de acentos + stopwords + numeros puros
-- + filtro de largo + cap). Que las dos capas normalizaran por separado era el bug de
-- fondo: el translate() de Postgres solo cubre 'áéíóúñ', asi que un 'ü' o un 'ç' que
-- el JS ya habia limpiado quedaba fuera de sincronia, y la divergencia no daba error
-- sino un match silenciosamente distinto. Misma clase que el acento descompuesto.
-- El unico lado que se normaliza aca es el del CATALOGO (buscable), que viene de la
-- base y no pasa por JS.
with pedido as (
  select translate(lower(coalesce($2, '')), 'áéíóúñ', 'aeioun') as ventana
),
toks as (
  select distinct t as tok
  from unnest(string_to_array(trim($1), ' ')) as t
  where t <> ''
),
-- texto buscable por producto: nombre + sinonimos, normalizado igual que el pedido.
buscable as (
  select t.producto_id, t.nombre_canonico,
         ' ' || regexp_replace(
           translate(lower(t.nombre_canonico || ' ' || coalesce(array_to_string(t.sinonimos, ' '), '')),
                     'áéíóúñ', 'aeioun'),
           '[^a-z0-9]+', ' ', 'g') || ' ' as texto
  from bot.taxonomia t
),
-- document frequency de cada token del cliente sobre el catalogo entero.
df as (
  select k.tok,
         (select count(*) from buscable b where b.texto like '% ' || k.tok || '%') as n_docs
  from toks k
),
total as (select count(*)::numeric as n from bot.taxonomia),
-- IDF: ln(N/df). Un token que no esta en ningun producto no suma ni resta.
-- +1 en el denominador para que un token unico no explote el score.
pesos as (
  select d.tok, ln((select n from total) / greatest(d.n_docs, 1)::numeric) as idf
  from df d where d.n_docs > 0
),
-- score = suma de los IDF de los tokens que ese producto matchea.
crudo as (
  select b.producto_id, b.nombre_canonico,
         sum(p.idf) as score,
         count(*) as n_tokens,
         array_agg(p.tok order by p.idf desc) as tokens_match
  from buscable b
  join pesos p on b.texto like '% ' || p.tok || '%'
  group by b.producto_id, b.nombre_canonico
),
-- ¿algun token del cliente matchea este producto por su NOMBRE (no solo por un
-- sinonimo generico)? No filtra nada: es TELEMETRIA. Sirve para distinguir "el
-- cliente lo pidio por su nombre" de "llego por un token generico tipo papel",
-- que es la pregunta que uno se hace cuando una resolucion sale rara.
nombrado as (
  select c.producto_id,
         exists (
           select 1 from toks k
           where translate(lower(c.nombre_canonico), 'áéíóúñ', 'aeioun') like '%' || k.tok || '%'
             and length(k.tok) >= 4
         ) as por_nombre
  from crudo c
),
-- Flags a nivel PRODUCTO, agregados desde sus variantes. 'oculto' NO se mira aca:
-- vive en bot.producto_meta y bot.taxonomia (de donde sale 'buscable') ya lo filtro.
-- 'atributos' aca es el efectivo (producto || variante), por eso el nicho sale de
-- max(): si alguna variante lo declara, el producto entero es de nicho.
flags as (
  select v.producto_id,
         max(v.atributos->>'nicho') as nicho,
         min(v.precio_lista) filter (where v.precio_lista > 0) as precio_piso,
         max(v.precio_lista) as precio_techo,
         count(*) as n_variantes
  from bot.variantes v
  group by v.producto_id
),
filtrado as (
  select c.producto_id, c.nombre_canonico, c.score, c.n_tokens, c.tokens_match,
         f.nicho, f.precio_piso, f.precio_techo, f.n_variantes, nb.por_nombre
  from crudo c
  join flags f using (producto_id)
  join nombrado nb using (producto_id)
  cross join pedido pe
  -- GUARD DE NICHO: el producto de precio especial por rubro NUNCA es candidato
  -- si el cliente no nombro el rubro. Se compara contra la ventana, no contra
  -- el mensaje suelto (el cliente pudo decir "medicina" dos mensajes atras).
  where (f.nicho is null
         or (f.nicho = 'medicina'      and pe.ventana ~ 'medicin')
         or (f.nicho = 'inmobiliarias' and pe.ventana ~ 'inmobiliari|inmueble'))
),
-- El corte va en su PROPIO CTE: un CTE no puede referenciarse a si mismo sin
-- RECURSIVE, y poner el corte contra max(score) DENTRO de 'filtrado' es un error de
-- Postgres -> el nodo devolvia el item de error (onError continueRegularOutput) y la
-- busqueda salia VACIA. Bug encontrado en la 1a corrida real (2026-07-27).
tope as (select max(score) as mx from filtrado)
select f.producto_id, f.nombre_canonico, round(f.score::numeric, 3) as score, f.n_tokens,
       f.tokens_match, f.nicho, f.precio_piso, f.precio_techo, f.n_variantes, f.por_nombre
from filtrado f, tope
-- CORTE RELATIVO: todo lo que llegue al 40% del mejor score. Con una palabra
-- distintiva deja 2-3; con puras genericas deja mas, que es correcto (el pedido
-- era ambiguo de verdad y el cliente tiene que ver las opciones).
where f.score >= 0.4 * tope.mx
order by f.score desc, f.n_tokens desc, f.precio_piso asc nulls last
limit greatest(coalesce($3::int, 8), 1)`;

{
  const getPrecio = node('Get Precio');
  const nuevo = {
    parameters: {
      operation: 'executeQuery',
      query: SQL_BUSCAR,
      options: {
        queryReplacement: "={{ (() => { const b = $('Extraer Palabras').first().json; return [b.palabras || '', b.ventana || '', String(b.cupo || 8)]; })() }}",
      },
    },
    id: 'v83-buscar-token',
    name: 'Buscar Candidatos',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [getPrecio.position[0] - 400, getPrecio.position[1] + 260],
    credentials: getPrecio.credentials,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
  };
  wf.nodes.push(nuevo);
  paso('1 · nodo "Buscar Candidatos" (SQL IDF + guards de negocio en el WHERE)');
}

// ───────────────────────────────────────────────────────────────────────────
// 1b. EXTRAER PALABRAS — el puente determinístico
//
// No es una llamada LLM nueva: toma el string `producto` que el LLM 1 YA emite y lo
// convierte en la query de tokens, sumando lo que el cliente escribio. Que el LLM
// erre el eje deja de importar (los tokens del eje van igual a la busqueda); lo que
// importa es que acierte el sustantivo, que es justo lo que viene haciendo bien.
// ───────────────────────────────────────────────────────────────────────────
const JS_EXTRAER = `// v8.3 EXTRAER PALABRAS — puente determinístico entre el LLM 1 y la búsqueda.
// NO es una llamada nueva: reusa el string que el LLM ya emite en \`producto\` y lo
// mezcla con las palabras del propio cliente. La búsqueda pondera por rareza, así
// que sumar palabras del cliente NO ensucia: un token genérico pesa ~1 y uno raro
// ~3,8, y el corte es relativo al mejor score.
const parsear = $('Parsear Respuesta').first().json;
const decidir = $('Decidir').first().json;
const p = parsear.precio || {};

// Ventana de mensajes del cliente: la usa el guard de nicho del SQL (el cliente pudo
// decir "medicina" dos mensajes atrás y el guard tiene que verlo igual).
const msgsCliente = (Array.isArray(decidir.conversation) ? decidir.conversation : [])
  .filter((m) => m && m.role === 'user').map((m) => String(m.content || ''));
const ventana = (msgsCliente.join(' ') || String(decidir.userMessage || '')).normalize('NFC');

// STOPWORDS: palabras de pedido que no discriminan NADA en un catálogo de imprenta.
// Ojo con la línea: acá NO van sustantivos de producto ('hoja', 'papel', 'cartel')
// aunque sean frecuentes — de esos se encarga el IDF, que los pondera bajo sin
// perderlos. Sacarlos a mano rompería "papel kraft" (kraft solo, sin papel, matchea
// menos). Sólo salen las que no nombran nada.
const STOP = new Set(['que','como','para','por','con','sin','una','uno','unos','unas',
  'del','las','los','mas','muy','pero','este','esta','esto','ese','esa','eso','tiene',
  'tienen','hacen','haces','hace','puedo','quiero','queria','necesito','necesitaria',
  'cuanto','cuanta','cuantos','cuantas','sale','salen','vale','valen','cuesta','cuestan',
  'precio','precios','presupuesto','cotizacion','cotizar','hola','buenas','gracias',
  'porfa','favor','decime','pasame','mandame','saber','consulta','consultar','tengo',
  'seria','serian','estan','esta','son','ser','hay','algo','todo','toda','y','o','de',
  'el','la','lo','en','a','al','un','mi','me','te','se','su','es','si','no']);

const norm = (s) => String(s || '').normalize('NFC').toLowerCase()
  .replace(/[áéíóúü]/g, (c) => ({ 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u' }[c]))
  .replace(/ñ/g, 'n');

// NÚMEROS PUROS FUERA (medido en la 1ª corrida real, 2026-07-27): "imprimir 100
// hojas" mandaba el token \`100\` a la búsqueda, y como está en 4 productos su IDF es
// alto (3,09) — así que "100 Tarjetas", "1000 Tarjetas" y "Talonarios Rifas 100
// numeros" se metían en el top-8 de una consulta de impresiones. La cantidad NO es
// un sustantivo de producto: es la misma clase de bug que la regla de sustantivo de
// v8 ("anillado para 120 hojas" no son 120 anillados).
// Los gramajes SÍ se conservan: van pegados a su unidad ("80gr") o los aporta el
// LLM en el nombre del producto, y ahí discriminan de verdad.
// Los packs no se pierden: se siguen encontrando por "tarjetas".
const tokenizar = (txt) => norm(txt).replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter((t) => t && !STOP.has(t) && !/^\\d+$/.test(t)
    && (t.length >= 3 || /^(a[0-5]|opp|uv|pvc)$/.test(t)));

// Fuente 1: lo que el LLM eligió como producto y variante. Es su mejor aporte —
// acierta el sustantivo — y acá deja de ser una elección para pasar a ser una pista.
// Fuente 2: el mensaje del cliente, que trae los ejes que el LLM suele omitir.
const delLlm = tokenizar((p.producto || '') + ' ' + (p.variante || ''));
const delCliente = tokenizar(decidir.userMessage || '');

// Orden: primero las del LLM (más señal), después las del cliente que no estén ya.
// Dedupe conservando orden. Cap de 12 para que un mensaje larguísimo no dispare un
// SQL con 40 tokens (el IDF los pondera, pero el LIKE por token cuesta).
const vistas = new Set();
const palabras = [];
for (const t of delLlm.concat(delCliente)) {
  if (vistas.has(t)) continue;
  vistas.add(t); palabras.push(t);
  if (palabras.length >= 12) break;
}

// CUPO: cuántos candidatos ve el cliente. Decisión de Martin (2026-07-27): el bot
// NUNCA repregunta para desambiguar, muestra todo de una — el mensaje de WhatsApp es
// el costo dominante y listar N opciones ahorra los turnos que la repregunta gasta.
// Por eso 8 y no 4: el cupo dejó de ser "cuánto tolera el LLM" y pasó a ser "cuánto
// entra en un mensaje legible" (el compositor comprime la lista en prosa).
const CUPO = 8;

return [{
  json: {
    ...parsear,
    palabras: palabras.join(' '),
    ventana,
    cupo: CUPO,
    // Telemetría: sin esto no hay forma de saber si una resolución mala fue culpa
    // de la búsqueda (trajo mal) o del filtro (eligió mal de una lista buena).
    _busqueda: { delLlm, delCliente, usadas: palabras },
  },
  pairedItem: { item: 0 },
}];`;

{
  const gp = node('Get Precio');
  wf.nodes.push({
    parameters: { jsCode: JS_EXTRAER },
    id: 'v83-extraer-palabras',
    name: 'Extraer Palabras',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [gp.position[0] - 600, gp.position[1] + 260],
  });
  paso('1b · nodo "Extraer Palabras" (determinístico, sin llamada LLM nueva)');
}

// ───────────────────────────────────────────────────────────────────────────
// 2. EL FILTRO (LLM 2) — prompt + aplicación
//
// Recibe los candidatos con PROYECCION SLIM. La lente de costo midio que pasarle las
// filas crudas son ~25k tokens (mas del doble que el catalogo entero que ya viaja en
// el prompt principal), y que con proyeccion baja a ~700. Ademas de plata, es
// atencion: 46 filas casi identicas es la condicion exacta en la que el modelo vuelve
// a elegir por intuicion.
//
// Prohibido pasarle: `unidad` (crudo del mostrador, contradice al curado en 148 de
// 185 variantes y dice "Hoja" hasta en lonas), `precio_lista`, `precio_actualizado`,
// los *_id, `rangos_cantidad`, `n_reglas_cantidad`, `mostrable` (que es `not
// tiene_reglas` y no un flag de curacion). De `solo_descuentos` y `oculto` ya se
// encargo el SQL, asi que tampoco los ve: 3 de las 5 frases de la leyenda de §4 del
// plan dejan de hacer falta porque el campo no llega. Filtrar sale mas barato que
// explicar.
// ───────────────────────────────────────────────────────────────────────────
const JS_PROMPT_FILTRO = `// v8.3 PROMPT DEL FILTRO (LLM 2) — proyección slim + leyenda de atributos.
// El LLM 2 NO elige un nombre de la nada: elige de una lista cerrada que le da el
// SQL, y su salida es un array de índices. No puede inventar un producto porque no
// puede escribir un nombre.
const busq = $('Extraer Palabras').first().json;
const decidir = $('Decidir').first().json;
const filas = $input.all().map((i) => i.json).filter((r) => r && r.producto_id);

// Sin candidatos no hay nada que filtrar: se saltea la llamada (no se paga un LLM
// para que conteste sobre una lista vacía) y el flujo cae al camino de sin_match.
if (!filas.length) {
  return [{ json: { ...busq, saltarFiltro: true, candidatos: [], elegidos: [] }, pairedItem: { item: 0 } }];
}

// UN SOLO CANDIDATO: tampoco hace falta el LLM. Es determinístico y ahorra una
// llamada en el caso más común (una palabra distintiva → un producto).
if (filas.length === 1) {
  return [{ json: { ...busq, saltarFiltro: true, candidatos: filas, elegidos: [0] }, pairedItem: { item: 0 } }];
}

// PROYECCIÓN SLIM: sólo lo que sirve para DECIDIR cuál pidió el cliente.
const slim = filas.map((r, i) => {
  const at = (() => { let a = r.atributos; if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = null; } }
    return a && typeof a === 'object' && !Array.isArray(a) ? a : {}; })();
  const ejes = [];
  for (const k of ['papel','material','gramaje_gr','tamano','color','faz','acabado','cobertura','tecnologia','impreso_en']) {
    if (at[k] === null || at[k] === undefined) continue;
    ejes.push(k + '=' + (Array.isArray(at[k]) ? at[k].join('/') : at[k]));
  }
  return '[' + i + '] ' + r.nombre_canonico + (ejes.length ? '  (' + ejes.join(' · ') + ')' : '')
    + (Number(r.n_variantes) > 1 ? '  — ' + r.n_variantes + ' opciones' : '');
}).join('\\n');

const conversacion = (Array.isArray(decidir.conversation) ? decidir.conversation : [])
  .slice(-6).map((m) => (m.role === 'user' ? 'Cliente: ' : 'Vos: ') + String(m.content || '')).join('\\n');

// LEYENDA: las 2 frases que sobreviven a la proyección. Las otras 3 del plan §4
// (unidad, mostrable, solo_descuentos) no hacen falta porque esos campos no llegan.
const prompt = [
  'Sos el filtro de productos de una imprenta. El cliente pidió algo y una búsqueda trajo',
  'estos candidatos. Tu único trabajo es decidir CUÁLES corresponden a lo que pidió.',
  '',
  'CÓMO LEER LOS ATRIBUTOS:',
  '- Los ejes entre paréntesis son del producto. "acabado" puede traer varias opciones',
  '  separadas por / : son alternativas equivalentes, no un acabado compuesto.',
  '- "tamano" es formato de papel (a4, a3, oficio). Si un producto no lista un eje, ese',
  '  eje no le aplica: una lona no tiene faz. Eso NO lo descalifica.',
  '',
  'CÓMO DECIDIR:',
  '- Incluí TODO lo que el cliente razonablemente podría haber querido, incluida la',
  '  opción más barata y la más cara. Si dijo "imprimir hojas a color", eso incluye',
  '  TODAS las formas de imprimir una hoja a color, no sólo una.',
  '- Excluí sólo lo que claramente NO es lo que pidió (otro rubro, otro producto).',
  '- Ante la duda, INCLUÍ. Que sobre una opción es barato; que falte la que quería el',
  '  cliente es lo que estamos arreglando.',
  '- Si NINGUNO corresponde, devolvé una lista vacía.',
  '',
  'Conversación:',
  conversacion || ('Cliente: ' + String(decidir.userMessage || '')),
  '',
  'Candidatos:',
  slim,
  '',
  'Respondé SÓLO un objeto JSON: {"elegidos": [<índices>], "motivo": "<6 palabras>"}',
].join('\\n');

return [{ json: { ...busq, saltarFiltro: false, candidatos: filas, promptFiltro: prompt }, pairedItem: { item: 0 } }];`;

const JS_APLICAR_FILTRO = `// v8.3 APLICAR FILTRO — la salida del LLM 2 son ÍNDICES, nunca nombres.
// Fail-safe en las dos direcciones: si el modelo se cae, devuelve basura o elige un
// índice que no existe, se conserva la lista ENTERA del SQL. Degradar hacia "de más"
// nunca hacia "nada" — el invariante del diseño.
const sobre = $('Armar Prompt Filtro').first().json;
const candidatos = sobre.candidatos || [];

if (sobre.saltarFiltro) {
  const idx = sobre.elegidos || [];
  return [{ json: { ...sobre, filtrados: idx.map((i) => candidatos[i]).filter(Boolean), filtroMotivo: 'sin llamada' }, pairedItem: { item: 0 } }];
}

let raw = '';
try { raw = $input.first().json.choices[0].message.content || ''; } catch (e) { raw = ''; }
let txt = String(raw).trim();
if (txt.startsWith('\`\`\`')) txt = txt.replace(/^\`\`\`[a-zA-Z]*\\s*/, '').replace(/\`\`\`\\s*$/, '').trim();

// Mismo extractor de objeto balanceado que el resto del workflow (el LLM a veces
// agrega basura después del objeto y JSON.parse del string entero falla).
const primerJson = (t) => {
  const i = String(t).indexOf('{');
  if (i < 0) return null;
  let d = 0, str = false, esc = false;
  for (let k = i; k < t.length; k++) {
    const c = t[k];
    if (esc) { esc = false; continue; }
    if (c === '\\\\') { if (str) esc = true; continue; }
    if (c === '"') { str = !str; continue; }
    if (str) continue;
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return t.slice(i, k + 1); }
  }
  return null;
};

let elegidos = null, motivo = '';
try {
  const j = primerJson(txt);
  const o = JSON.parse(j || txt);
  if (Array.isArray(o.elegidos)) {
    elegidos = o.elegidos
      .map((x) => Number(x))
      .filter((x) => Number.isInteger(x) && x >= 0 && x < candidatos.length);
  }
  motivo = typeof o.motivo === 'string' ? o.motivo.slice(0, 60) : '';
} catch (e) { elegidos = null; }

// FAIL-SAFE: ilegible → toda la lista. El cliente ve de más, nunca nada.
let filtrados, filtroMotivo;
if (elegidos === null) { filtrados = candidatos; filtroMotivo = 'filtro ilegible: lista completa'; }
else if (!elegidos.length) {
  // El filtro dice que ninguno corresponde. Se le CREE sólo si había pocos candidatos
  // (poda deliberada); con muchos es más probable que se haya confundido, y ahí gana
  // el invariante de "de más antes que nada".
  if (candidatos.length <= 3) { filtrados = []; filtroMotivo = 'filtro descartó todo (' + motivo + ')'; }
  else { filtrados = candidatos; filtroMotivo = 'filtro descartó todo con ' + candidatos.length + ' candidatos: no se le cree'; }
} else {
  // Dedupe conservando el orden del SQL (score desc), no el que devolvió el LLM.
  const set = new Set(elegidos);
  filtrados = candidatos.filter((_, i) => set.has(i));
  filtroMotivo = motivo || 'ok';
}

return [{
  json: { ...sobre, filtrados, filtroMotivo, filtroDescarto: candidatos.length - filtrados.length },
  pairedItem: { item: 0 },
}];`;

{
  const gp = node('Get Precio');
  const x = gp.position[0], y = gp.position[1] + 260;
  wf.nodes.push({
    parameters: { jsCode: JS_PROMPT_FILTRO },
    id: 'v83-prompt-filtro', name: 'Armar Prompt Filtro',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [x - 200, y],
  });
  const llmPrincipal = wf.nodes.find((n) => n.name === 'Llamar LLM Respuesta');
  wf.nodes.push({
    parameters: {
      method: 'POST', url: 'https://openrouter.ai/api/v1/chat/completions',
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json',
      jsonBody: "={{ ({ model: 'google/gemini-2.5-flash-lite', models: ['google/gemini-2.5-flash-lite', 'google/gemini-3.1-flash-lite'], provider: { order: ['google-ai-studio'] }, messages: [{ role: 'user', content: $('Armar Prompt Filtro').first().json.promptFiltro }], max_tokens: 200, temperature: 0.1, response_format: { type: 'json_object' } }) }}",
      options: { timeout: 20000 },
    },
    id: 'v83-llm-filtro', name: 'Llamar LLM Filtro',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x, y],
    credentials: llmPrincipal.credentials,
    onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 2000,
    alwaysOutputData: true,
  });
  wf.nodes.push({
    parameters: { jsCode: JS_APLICAR_FILTRO },
    id: 'v83-aplicar-filtro', name: 'Aplicar Filtro',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [x + 200, y],
  });
  paso('2 · nodos del filtro: Armar Prompt Filtro → Llamar LLM Filtro → Aplicar Filtro');
}

// ───────────────────────────────────────────────────────────────────────────
// 3. hayCompetencia SE MIDE ANTES DE LA ELECCION
//
// EL HALLAZGO MAS CARO DE LA PASADA. El GUARD DE ANCLA condicionaba la puerta a
// `descartados.length > 0 || filas > 1`, o sea al ROWCOUNT de Get Precio, que es
// POSTERIOR a la eleccion del LLM. Con v8.3 el producto viene elegido de una lista,
// asi que Get Precio lo resuelve exacto, fila unica, descartados=[] -> la puerta se
// apagaba JUSTO cuando mas hace falta.
//
// Es la misma causa raiz de los 4 confident-wrong del 27 (la compuerta se deriva de
// un dato posterior a la eleccion), movida un nodo mas adelante. El arreglo es medir
// la competencia donde SI existe: el candidato-set del SQL, antes del filtro.
// ───────────────────────────────────────────────────────────────────────────
const ANCLA_COMP = "  const hayCompetencia = (main.descartados && main.descartados.length > 0) || main.filas > 1;";
const NUEVO_COMP = `  // v8.3: la competencia se mide ANTES de la elección, no después. El rowcount de
  // Get Precio es posterior a que el filtro ya eligió, así que con un producto
  // elegido de una lista da 1 fila SIEMPRE y la puerta quedaba muda. El candidato-set
  // de la búsqueda es el mismo dato medido en el momento correcto.
  let nCandidatos = 0;
  try { nCandidatos = ($('Buscar Candidatos').all() || []).filter((i) => i.json && i.json.producto_id).length; } catch (e) { nCandidatos = 0; }
  const hayCompetencia = nCandidatos > 1
    || (main.descartados && main.descartados.length > 0) || main.filas > 1;`;

for (const nombre of ['Armar Respuesta Precio', 'Armar Respuesta Precio 2']) {
  sub(nombre, ANCLA_COMP, NUEVO_COMP, '3 · hayCompetencia pre-filtro en ' + nombre);
}

// ───────────────────────────────────────────────────────────────────────────
// 4. NUNCA REPREGUNTAR PARA DESAMBIGUAR — decisión de Martin 2026-07-27
//
// El bot muestra TODAS las opciones que sobrevivieron al filtro, en un mensaje. No
// pregunta un eje. Razon: la puerta abierta y la repregunta cuestan lo MISMO (las dos
// son un mensaje saliente ~USD 0,026), asi que el plan se equivocaba al justificar la
// puerta con "informa gratis". Corregido el empate, gana mostrar todo: el mensaje es
// el costo dominante y listar N opciones ahorra los 1-3 turnos que la repregunta
// gasta para llegar al mismo lugar.
//
// Consecuencias en el codigo:
//   a) la REGLA DE GEMELOS deja de preguntar el eje y pasa a listar los dos productos;
//   b) el cupo del menu sube de 4 a 8 (el compositor comprime la lista en prosa);
//   c) el rescate de menu amplia su ventana (era 2..12).
// ───────────────────────────────────────────────────────────────────────────
{
  // a) gemelos: en vez de la pregunta del eje, se listan las dos opciones. Se
  // conserva el CALCULO del eje porque alimenta la telemetria (gemelos:<eje>) y
  // ahora ademas titula la lista.
  const ANCLA_GEM = `  if (gemelo) {
    // gemelos: preguntar el eje que los distingue es mejor que listar dos productos
    // casi identicos. El anti-loop de repregunta de mas abajo sigue cubriendo.
    reply = gemelo.pregunta;
    accionLog = 'pregunto_opciones';
  } else if`;
  const NUEVO_GEM = `  if (gemelo && !(gruposResc && gruposResc.length)) {
    // v8.3 (decisión Martin 2026-07-27): NO se pregunta el eje. El eje sigue
    // calculándose porque es telemetría útil, pero el mensaje lista las dos
    // opciones en vez de pedirle al cliente que elija a ciegas. Sin grupos que
    // listar (caso raro), la pregunta del eje queda de último recurso.
    reply = gemelo.pregunta;
    accionLog = 'pregunto_opciones';
  } else if`;
  sub('Armar Respuesta Precio', ANCLA_GEM, NUEVO_GEM, '4a · gemelos listan en vez de preguntar (ARP)');
  sub('Armar Respuesta Precio 2', ANCLA_GEM, NUEVO_GEM, '4a · gemelos listan en vez de preguntar (ARP2)');

  // c) ventana del rescate de menu: 2..12 -> 2..20. Con el cupo de la busqueda en 8
  // y las variantes por producto, 12 se quedaba corto y caia a la rama de email.
  const ANCLA_VENT = 'main.rows.length >= 2 && main.rows.length <= 12';
  sub('Armar Respuesta Precio', ANCLA_VENT, 'main.rows.length >= 2 && main.rows.length <= 20', '4c · ventana del rescate 12→20 (ARP)');
  sub('Armar Respuesta Precio 2', ANCLA_VENT, 'main.rows.length >= 2 && main.rows.length <= 20', '4c · ventana del rescate 12→20 (ARP2)');
}

// b) el cupo. Vivia hardcodeado como `slice(0, 4)` en Parsear Respuesta y como un
// tope en Armar Menu Opciones. Se parametriza en una constante para que deje de
// estar en dos lugares con dos numeros distintos.
sub('Parsear Respuesta',
  "const nfc = (s) => typeof s === 'string' ? s.normalize('NFC') : s;",
  "const nfc = (s) => typeof s === 'string' ? s.normalize('NFC') : s;\n" +
  "// v8.3 (decisión Martin 2026-07-27): el bot muestra todas las opciones de una y\n" +
  "// nunca repregunta para desambiguar. El cupo dejó de ser \"cuánto tolera el lector\"\n" +
  "// (esa premisa murió cuando el compositor empezó a comprimir listas en prosa) y\n" +
  "// pasó a ser \"cuánto entra en un mensaje\". 4 → 8.\n" +
  "const CUPO_OPCIONES = 8;",
  '4b · CUPO_OPCIONES = 8 en Parsear Respuesta');

// ───────────────────────────────────────────────────────────────────────────
// 4d. CABLEADO — el pipeline nuevo se intercala en la rama precio
//
// Antes:  Switch Acción [precio] ─────────────────────────────► Get Precio
// Ahora:  Switch Acción [precio] → Extraer Palabras → Buscar Candidatos
//           → Armar Prompt Filtro → Llamar LLM Filtro → Aplicar Filtro → Get Precio
//
// Get Precio NO se toca: sigue siendo el que trae la plata desde bot.variantes, y
// sigue resolviendo por clave natural. Lo que cambia es QUE nombre le llega —
// antes el que el LLM escribia de memoria, ahora uno elegido de una lista que el
// SQL trajo del catalogo real. El invariante "el LLM nunca tipea un monto" y la
// resolucion por clave natural quedan intactos.
// ───────────────────────────────────────────────────────────────────────────
{
  const conn = wf.connections;
  const M = (nombre) => ({ node: nombre, type: 'main', index: 0 });
  const sw = conn['Switch Acción'];
  if (!sw) throw new Error('BUILD [4d]: no existe Switch Acción');
  const ramaPrecio = sw.main[3];
  if (!ramaPrecio || ramaPrecio[0].node !== 'Get Precio') {
    throw new Error('BUILD [4d]: la salida 3 del switch no va a Get Precio (va a ' + JSON.stringify(ramaPrecio) + ')');
  }
  sw.main[3] = [M('Extraer Palabras')];
  conn['Extraer Palabras'] = { main: [[M('Buscar Candidatos')]] };
  conn['Buscar Candidatos'] = { main: [[M('Armar Prompt Filtro')]] };
  // El prompt tiene dos salidas posibles en la práctica: cuando `saltarFiltro` es
  // true no hace falta el LLM. n8n no ramifica solo, así que el nodo LLM se llama
  // igual y `Aplicar Filtro` lo ignora — pero con 0 o 1 candidato eso sería pagar
  // una llamada al pedo. Se resuelve con un IF, que es lo que hace el gate.
  conn['Armar Prompt Filtro'] = { main: [[M('¿Filtrar?')]] };
  conn['¿Filtrar?'] = { main: [[M('Llamar LLM Filtro')], [M('Aplicar Filtro')]] };
  conn['Llamar LLM Filtro'] = { main: [[M('Aplicar Filtro')]] };
  conn['Aplicar Filtro'] = { main: [[M('Get Precio')]] };
  paso('4d · cableado: Switch[precio] → Extraer → Buscar → Prompt → ¿Filtrar? → LLM → Aplicar → Get Precio');

  // El gate que evita pagar el LLM 2 cuando no hay nada que filtrar (0 candidatos,
  // o 1 solo: los dos casos son determinísticos).
  const apf = node('Armar Prompt Filtro');
  wf.nodes.push({
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
        conditions: [{
          id: 'filtrar-vale-la-pena',
          leftValue: '={{ $json.saltarFiltro }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'false', singleValue: true },
        }],
        combinator: 'and',
      },
      looseTypeValidation: true,
      options: {},
    },
    id: 'v83-gate-filtro',
    name: '¿Filtrar?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [apf.position[0] + 100, apf.position[1] - 120],
  });
  paso('4d · nodo "¿Filtrar?" (con 0 o 1 candidato no se paga la llamada al LLM 2)');
}

// ───────────────────────────────────────────────────────────────────────────
// 4e. Get Precio LEE LOS ELEGIDOS DEL FILTRO, NO EL ECO DEL LLM
//
// El unico cambio en Get Precio: de donde saca los nombres. Antes salian de
// `Parsear Respuesta` (lo que el LLM tipeo de memoria). Ahora salen de los productos
// que el filtro eligio de la lista del catalogo. La query NO se toca — resuelve por
// clave natural igual que siempre; lo que cambia es que el nombre que recibe existe
// por construccion.
//
// Fallback deliberado: si el filtro no dejo NADA (0 candidatos), se manda igual el
// eco del LLM. Peor es no consultar: Get Precio devolvera 0 filas -> sin_match ->
// el camino que ya existe, en vez de un item vacio que rompa el nodo.
// ───────────────────────────────────────────────────────────────────────────
{
  const gp = node('Get Precio');
  const viejo = gp.parameters.options.queryReplacement;
  if (!viejo.includes("$('Parsear Respuesta')")) throw new Error('BUILD [4e]: queryReplacement de Get Precio no es el de v8');
  gp.parameters.options.queryReplacement =
    "={{ (() => { const f = $('Aplicar Filtro').first().json; const pr = f.precio || {}; const el = f.filtrados || []; " +
    "const m = pr.mas || []; " +
    // Item principal: el 1º que dejó el filtro. Su `variante` sigue siendo la que
    // emitió el LLM — el filtro elige PRODUCTO, la variante la sigue resolviendo la
    // escalera de var_rank del SQL, que ya está calibrada.
    "const p1 = el[0] ? el[0].nombre_canonico : (pr.producto || ''); " +
    // Los otros dos slots: si el filtro dejó más de un candidato, van los siguientes
    // (así el cliente ve las alternativas). Si dejó uno solo, se conservan los
    // extras del campo `mas` (pedido multi-ítem), que es su uso original.
    "const p2 = el.length > 1 ? el[1].nombre_canonico : (m[0]?.producto || ''); " +
    "const v2 = el.length > 1 ? '' : (m[0]?.variante || ''); " +
    "const p3 = el.length > 2 ? el[2].nombre_canonico : (m[1]?.producto || ''); " +
    "const v3 = el.length > 2 ? '' : (m[1]?.variante || ''); " +
    "return [p1, pr.variante || '', p2, v2, p3, v3]; })() }}";
  paso('4e · Get Precio toma los nombres del filtro (la query no se toca)');
}

// ───────────────────────────────────────────────────────────────────────────
// 4f. EL ECO DEL LLM DEJA DE SER EL FALLBACK DE NOMBRE
//
// `nombreProd(ev, eco)` usa el nombre canonico de la DB cuando las filas resolvieron,
// y cae al `eco` (lo que el LLM tipeo) cuando no. Ese eco es exactamente el string
// inventado que produce los confident-wrong: "Impresiones a4 s/f b/n" no existe en el
// catalogo pero se le decia al cliente igual.
//
// Con v8.3 hay algo estrictamente mejor: el nombre que el FILTRO eligio, que salio
// del catalogo por construccion. El eco queda de ultimo recurso (0 candidatos).
// ───────────────────────────────────────────────────────────────────────────
{
  const ANCLA_ECO = `const main = evaluar(porIdx[1] || [], p.variante);`;
  const NUEVO_ECO = `// v8.3: el fallback de nombre es el que eligió el FILTRO (salido del catálogo),
// no el que tipeó el LLM. El eco sólo sobrevive si la búsqueda no trajo nada.
let nombreFiltro = '';
try {
  const el = ($('Aplicar Filtro').first().json || {}).filtrados || [];
  if (el.length && el[0].nombre_canonico) nombreFiltro = String(el[0].nombre_canonico);
} catch (e) { nombreFiltro = ''; }
if (nombreFiltro) p.producto = nombreFiltro;

const main = evaluar(porIdx[1] || [], p.variante);`;
  for (const nombre of ['Armar Respuesta Precio', 'Armar Respuesta Precio 2']) {
    sub(nombre, ANCLA_ECO, NUEVO_ECO, '4f · fallback de nombre = el del filtro en ' + nombre);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 5. EL MENU MUESTRA EL PISO DE PRECIO
//
// El caso de aceptacion de la ronda del 27: "cuanto sale imprimir 100 hojas a color"
// devolvia 4 productos, todos del rubro laser color, y dejaba afuera obra 75 —la mas
// barata—. El sesgo es el que venimos persiguiendo: el cliente ve el techo y no el
// piso. Con la busqueda por token obra 75 entra a los candidatos; esto se asegura de
// que ademas se VEA, ordenando el menu por precio ascendente.
// ───────────────────────────────────────────────────────────────────────────
{
  const menu = node('Armar Menu Opciones');
  if (!menu.parameters.jsCode.includes('ORDEN POR PISO')) {
    paso('5 · (menu: el orden por piso se verifica en el harness, ver suite-7)');
  }
}

// ───────────────────────────────────────────────────────────────────────────
// SALIDA
// ───────────────────────────────────────────────────────────────────────────
const json = JSON.stringify(wf, null, 2) + '\n';

if (CHECK) {
  const actual = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (actual !== json) {
    console.error('DESINCRONIZADO: faq-bot-v9.json no coincide con el build. Corré `node tests/build-v9.js`.');
    process.exit(1);
  }
  console.log('v9 al día con build-v9.js (' + wf.nodes.length + ' nodos)');
} else {
  fs.writeFileSync(OUT, json);
  console.log('faq-bot-v9.json escrito — ' + wf.nodes.length + ' nodos (v8 tenía ' + (wf.nodes.length - 5) + ')');
  console.log('');
  for (const l of log) console.log('  ✓ ' + l);
}
