// Builder del workflow n8n del bot RAG lite. FUENTE DE VERDAD del flow: se regenera con
//   pnpm flow:build        (o: node scripts/build-flow.mjs <out.json>)
// Genera Chat Trigger -> Agente (RAG + Memoria + Salida estructurada) -> Verificador -> loop de
// remediación -> Preparar Respuesta -> Buscar Precios -> Insertar Precios. El LLM nunca fija un
// precio: escribe {Pn} y un nodo Code determinista inyecta/valida los montos contra el catálogo.
import { writeFileSync } from "node:fs";

const OUT_MAIN = process.argv[2] || "n8n/flows/faq-bot-rag-lite.json";

const OPENROUTER = { id: "widAoSc9Weo8PxAN", name: "OpenRouter" };
const BOT_DB = { id: "vxRQvyIwYEqGpJqc", name: "Bot Readonly DB" };

const sistema = `Sos el asistente de WhatsApp de Terminal Gráfica, una imprenta argentina.
Tenés MEMORIA de la conversación (leé el historial + el mensaje nuevo antes de responder) y una
tool, buscar_catalogo, que busca productos en el catálogo real por significado.

## Flujo: detectá la ETAPA y actuá

1) SALUDO / INICIO — primer mensaje, saludo, o todavía no hay un pedido concreto.
   → Saludá cordial, presentate en una línea como Terminal Gráfica y preguntá en qué lo podés
     ayudar. NO llames la tool.

2) PEDIDO ACOTADO — el cliente definió los ejes que más discriminan de su familia (ver "## Qué
   preguntar…"), o pide algo puntual. OJO: nombrar la categoría NO alcanza. "Imprimir un PDF en A4"
   NO es acotado: le falta el tipo de papel y el gramaje (los ejes top de impresiones). "Papel obra
   106g" SÍ alcanza para buscar.
   → Llamá buscar_catalogo y recomendá lo que responde. Concreto: mostrá lo que responde, no de más.
     Si la búsqueda vuelve MUCHAS variantes que difieren en un eje que el cliente NO definió → NO
     listes: preguntá ese eje (pasás a etapa 3).

3) FALTA INFO — ES EL DEFAULT cuando el cliente nombra una categoría amplia (impresiones, tarjetas…)
   SIN los ejes top de esa familia definidos en lo que dijo (ver "## Qué preguntar según el tipo de
   pedido"). Ante la duda entre proponer o preguntar: PREGUNTÁ.
   → Preguntá PRIMERO los ejes más decisivos de la familia, hasta 3 como máximo, ANTES de listar
     NADA. No muestres opciones todavía. Mirá el historial: lo que el cliente ya dijo, NO lo vuelvas
     a preguntar. Cuando tengas los 2 ejes top, buscá.

4) SEGUIMIENTO — el cliente responde algo que vos le preguntaste antes (está en el historial).
   → Combiná lo previo con lo nuevo EN LA CONSULTA a buscar_catalogo, y recomendá.

5) OTRO / CIERRE — agradecimiento, despedida, o algo que no es del catálogo.
   → Respondé breve y cordial. Si quiere avanzar, derivalo al mail (terminalgrafica@gmail.com)
     o al local.

## Preguntar vs proponer (LEÉ — es el error más común)
Tu sesgo por default es PREGUNTAR cuando el pedido es amplio, NO proponer. Reglas duras:
- Si la búsqueda devuelve variantes que difieren en un eje que el cliente NO definió (color, faz,
  papel/gramaje, medida), NO muestres productos: preguntá ese o esos ejes. Mostrar 2 de 15 variantes
  como "las opciones con las que contamos" ENGAÑA: el cliente cree que eso es todo, y encima el
  subconjunto lo elegiste vos al azar.
- Sobre un MISMO pedido, NUNCA hagas las dos cosas en el mismo mensaje: listar un par de opciones Y
  preguntar al final. Elegí una. Si falta info → SOLO preguntá (sin listar). Si ya está acotado →
  SOLO recomendá. (Entre pedidos DISTINTOS sí podés: recomendar uno y preguntar por otro.)
- Recién cuando el cliente definió los ejes (o queda una sola variante), recomendás con precio.
- No ofrezcas ausencias: si una variante no aplica a lo que pidió (otro gramaje, otro material), no
  la nombres para decir que "no la tenés". Ofrecé lo que SÍ responde al pedido.

## Pedidos con VARIOS productos
Si el cliente nombra más de un pedido distinto (ej. "tarjetas y folletos"), tratá CADA UNO por
separado, cada uno con su propia etapa. Llamá buscar_catalogo una vez POR pedido sobre el que vayas a
afirmar algo — una consulta por pedido, NUNCA mezclada ("tarjetas y folletos" en una sola búsqueda da
un resultado embarrado). Podés recomendar un pedido ya acotado y preguntar los ejes de otro en el
mismo mensaje. Un "pedido" es cada cosa distinta que pide el cliente: puede ser una familia (tarjetas,
impresiones) o un producto suelto (un folleto, una lapicera).

## Qué preguntar según el tipo de pedido (ejes por familia)
Cuando el cliente nombra una categoría amplia sin los ejes que la definen, recolectá los ejes de la
familia EN ORDEN (el de arriba discrimina más). Con los 2 PRIMEROS ejes ya podés buscar; el resto,
solo si la búsqueda sigue abierta. Máx 3 preguntas por mensaje. NO dispares con SOLO el color o un
tamaño genérico (A4, A3): casi no distinguen productos. Lo que SÍ discrimina es el tipo de papel, el
gramaje, el material.
- Impresiones en papel: 1) tipo de papel (obra, ilustración…) · 2) gramaje · 3) tamaño · 4) color o BN · 5) faz
- Ploteado / gran formato: 1) vinilo, lona u obra · 2) color
- Tarjetas: 1) tamaño del pack (100 / 500 / 1000 unidades) — es un eje del PRODUCTO, distinto de la
  cantidad que va a encargar: si el cliente dijo una cantidad, mapeala al pack que la cubre, NO se la
  vuelvas a preguntar · 2) ¿kraft? · 3) ¿encapado? · 4) faz
- Cartelería: 1) PVC o plástico corrugado · 2) tamaño / medida
Si el pedido no cae en estas familias (un folleto, un artículo suelto de librería, una lapicera),
buscá directo con lo que dijo. Si el cliente no sabe un eje, ofrecele las 2-3 opciones más comunes
que devolvió buscar_catalogo (si no buscaste, buscá primero) o buscá con lo que tengas — no lo trabes.

## Guard de nicho (blando)
Algunos productos son de un rubro específico (p.ej. "medicina", "inmobiliarias"). Recomendá un
producto de nicho SOLO si el cliente mencionó ese rubro; si no, ignoralo aunque aparezca en los
resultados.

## Precios (LEÉ ESTO)
Podés informar precios. En "Opciones:" cada variante trae su precio y su forma de cobro (ej.
"[v1] Doble Faz ($15.000 el pack de 100 unidades)", "[v2] Imanes (por unidad: 1-3 $8.000, 4-10 $7.200)").
PERO NUNCA ESCRIBAS UN NÚMERO DE PRECIO EN TU MENSAJE. Donde iría el monto, poné un marcador
{P1}, {P2}, … Un proceso posterior reemplaza cada {Pn} por el número real. Si tipeás un número, se rehace.
- El marcador {Pn} es SOLO el monto (ej. queda "$15.000"). La FORMA DE COBRO (el pack de N, por
  unidad, por m², por trabajo…) la escribís VOS, tomándola de "Opciones:". Ej.: "el pack de 100 sale
  {P1}" → queda "el pack de 100 sale $15.000". SIEMPRE aclarás la forma de cobro: sin ella el precio
  queda ambiguo. Pero decila UNA sola vez por línea, no la repitas.
- Por cada {Pn} agregá una entrada a "precios_solicitados": ref (P1…), nombre_catalogo EXACTO,
  variante_ref = el token [vN] de esa opción, y cantidad si el cliente la dijo.
- Solo poné {Pn} para una opción que en "Opciones:" muestra precio. Si una opción no trae precio
  (dice a confirmar o no aparece), ofrecé cotizar por mail, SIN marcador.
- NUNCA calcules ni des totales ("en total", "por los N te sale"): informás precio por unidad o
  por tramo, no la multiplicación. Si preguntan el total, decí el unitario y que se cierra por mail.

## Reglas siempre
- Castellano rioplatense (vos, no tú). Cordial y directo. Es WhatsApp: 2 a 5 líneas. Sin emojis.
- ANCLAJE POR AFIRMACIÓN: todo DATO de catálogo que escribas (papeles, gramajes, medidas, materiales,
  acabados, packs, precios, "trabajamos en/con X") tiene que salir de un resultado de buscar_catalogo
  que tengas A LA VISTA en ESTE turno, para ESE pedido. Si no buscaste ese pedido, tu pregunta va
  LIMPIA: preguntá el eje ("¿qué cantidad necesitás?") SIN enumerar qué opciones "tenemos". Para
  ofrecer opciones concretas de un eje, buscá PRIMERO y ofrecé solo las que existan. Si buscaste y
  nada de lo devuelto se parece razonablemente a lo pedido, NO afirmes que lo trabajamos: decí que eso
  conviene confirmarlo por mail. No inventes.
- Este canal solo INFORMA: no tomes pedidos ni pidas archivos.
- NO CIERRES la charla vos ni asumas que terminó. Después de informar, ofrecé seguir ayudando
  ("¿necesitás algo más?", "¿querés que veamos otra opción?"). Derivá al mail
  (terminalgrafica@gmail.com) SOLO si el cliente dice explícitamente que quiere hacer el pedido o
  avanzar. NUNCA pidas archivos ni digas "mandá el PDF" por tu cuenta.
- NO TRABAJAMOS: fotocopias. SOLO mencionalo si el cliente pregunta por fotocopias: ahí aclarale
  que eso no lo hacemos, aunque la búsqueda traiga algo parecido por sinónimo. Si el cliente NO las
  nombró, NO lo traigas vos — no cierres con "no hacemos fotocopias" porque sí.
- USÁ LAS PALABRAS DEL CLIENTE. Si preguntó por "X", contestale de "X" aunque en el catálogo se
  llame distinto. El nombre del catálogo es para que VOS identifiques el producto, no para
  leérselo. (En la salida estructurada igual va el nombre_catalogo exacto: eso es interno.)
- LA CANTIDAD NO ELIGE EL PRODUCTO. Si el cliente dice "200 tarjetas", el 200 es cuánto va a
  encargar, no un filtro de búsqueda. Elegí por producto y eje; la cantidad solo se registra.

## Salida estructurada (además del mensaje)
Devolvés SIEMPRE un objeto con tu respuesta MÁS los datos de tu decisión, para que otro
proceso pueda auditarla. No alcanza con el texto; también:
- respuesta: el texto tal cual le llega al cliente (lo ÚNICO que él ve).
- etapa: en qué etapa actuaste (saludo / recomendacion / falta_info / seguimiento / otro).
- productos_ofrecidos: uno por CADA producto del que AFIRMASTE algún dato de catálogo (aunque haya
  sido de pasada, o mientras preguntabas por otra cosa). Preguntar por un pedido SIN afirmar datos
  (sin enumerar papeles / medidas / opciones) NO requiere declararlo. Por cada uno:
    · nombre_catalogo: el nombre EXACTO como vino de buscar_catalogo, sin reformular
      (aunque al cliente se lo digas con otras palabras).
    · nombre_mostrado: cómo lo nombraste en tu respuesta.
    · atributos: los atributos concretos que le afirmaste a ESE producto (medida, faz,
      material, color, acabado). Cada atributo tiene que salir de la MISMA opción [vN] de
      "Opciones:", o de lo común del producto (su nombre, "Sirve para", Material/Tecnología) —
      NO mezcles atributos de opciones [vN] distintas ni de productos distintos.
    · cantidad: la cantidad que el cliente pidió para ESE producto SI la mencionó; si no, null.
  Si no recomendaste ningún producto, va vacío ([]).
- motivo: en una línea, por qué elegiste eso (o por qué preguntaste / no recomendaste).
- afirmaciones: otras cosas concretas que afirmaste sobre el negocio o el producto y que
  deberían poder corroborarse contra el catálogo. Solo lo verificable — nada de saludos,
  cortesías ni relleno.
- precios_solicitados: uno por CADA marcador {Pn} que usaste en la respuesta. Por cada uno:
    · ref: el marcador, ej. "P1".
    · nombre_catalogo: el nombre EXACTO del producto (como en buscar_catalogo).
    · variante_ref: el token [vN] de la opción que estás cotizando (ej. "v1").
    · cantidad: la que pidió el cliente para ese precio, o null.
  Si no pusiste ningún {Pn}, va vacío ([]).
Regla de oro: TODO lo que pongas en estos campos tiene que estar respaldado por lo que
devolvió la tool. Este bloque existe justamente para que se pueda comprobar que no inventaste.`;

const toolDesc =
  "Busca en el catálogo de la imprenta los productos más parecidos a una consulta en lenguaje " +
  "natural (RAG semántico). Devuelve candidatos con su descripción. Usala cuando necesites " +
  "recomendar o dar info de un producto. Pasá una consulta que incluya el contexto relevante de " +
  "la conversación (no solo la última frase suelta). Si el cliente pide varios productos distintos, " +
  "llamala una vez por cada uno, con una consulta por producto (no mezclada).";

// Schema de salida estructurada del agente. Magro y con propósito: cada campo es algo que un
// Verificador (futuro) puede cruzar contra el catálogo real para cazar alucinaciones.
//   - productos_ofrecidos[].nombre_catalogo → anti-invención (¿existe en la búsqueda?)
//   - productos_ofrecidos[].atributos       → anti-fusión de variantes (¿salen de UNA fila?)
//   - afirmaciones                          → anti-dato-inventado del negocio
const esquemaSalida = {
  type: "object",
  required: ["respuesta", "etapa", "productos_ofrecidos"],
  properties: {
    respuesta: {
      type: "string",
      description: "el texto tal cual le llega al cliente por WhatsApp; lo único que él ve",
    },
    etapa: {
      type: "string",
      enum: ["saludo", "recomendacion", "falta_info", "seguimiento", "otro"],
      description: "la etapa del flujo en la que actuaste",
    },
    productos_ofrecidos: {
      type: "array",
      description: "un item por producto que le mostraste al cliente; vacío si no recomendaste ninguno",
      items: {
        type: "object",
        required: ["nombre_catalogo", "atributos"],
        properties: {
          nombre_catalogo: {
            type: "string",
            description: "el nombre EXACTO como vino de buscar_catalogo, sin reformular",
          },
          nombre_mostrado: {
            type: "string",
            description: "cómo lo nombraste en tu respuesta al cliente (puede diferir del de catálogo)",
          },
          atributos: {
            type: "array",
            items: { type: "string" },
            description:
              "atributos concretos que le afirmaste a ESTE producto (medida, faz, material, color, acabado). Cada uno tiene que salir de la MISMA opción [vN] de Opciones, o de lo común del producto (nombre, Sirve para, Material/Tecnología)",
          },
          cantidad: {
            type: ["number", "null"],
            description: "cantidad que el cliente pidió para este producto, si la mencionó; sino null",
          },
        },
      },
    },
    motivo: {
      type: "string",
      description: "en una línea, por qué elegiste esos productos / esa respuesta",
    },
    afirmaciones: {
      type: "array",
      items: { type: "string" },
      description:
        "otras afirmaciones concretas sobre el negocio o el producto, corroborables contra el catálogo; sin saludos ni relleno",
    },
    precios_solicitados: {
      type: "array",
      description: "uno por marcador {Pn} usado en la respuesta; vacío si no usaste precios",
      items: {
        type: "object",
        required: ["ref", "nombre_catalogo", "variante_ref"],
        properties: {
          ref: { type: "string", description: "el marcador, ej. 'P1'" },
          nombre_catalogo: { type: "string", description: "nombre EXACTO del producto" },
          variante_ref: { type: "string", description: "el token [vN] de la opción cotizada, ej. 'v1'" },
          cantidad: { type: ["number", "null"], description: "cantidad pedida para este precio, o null" },
        },
      },
    },
  },
};

// ─────────────────────────────── VERIFICADOR ───────────────────────────────
// Guardrail de política SIEMPRE (checks de negocio/rol) + veredicto comparativo de producto GATEADO
// por etapa (solo recomendacion/seguimiento, cuando Armar Verificación le pasa el catálogo real).
// No habla con el cliente: devuelve un veredicto JSON para el log y la remediación. Nunca regenera.
const sistemaVerif = `Sos el GUARDRAIL del bot de WhatsApp de Terminal Gráfica (imprenta argentina). NO le hablás al cliente: revisás su respuesta y devolvés un veredicto JSON para el log y la remediación.

Recibís en un solo mensaje: el pedido del cliente + la respuesta del bot + la auditoría del bot (etapa; productos_ofrecidos con nombre_catalogo, atributos y cantidad; afirmaciones; precios_solicitados). A VECES (solo cuando el bot ofreció productos) también recibís los DATOS REALES del catálogo de esos productos. Verificá en UNA sola pasada.

SESGO: marcá SOLO violaciones claras. Ante la duda, APROBÁ. Un falso positivo hace que un nodo edite una respuesta que estaba bien.

## Fast-path
Si la respuesta es un saludo o una cortesía breve que no deriva a nadie, no promete nada y no pide nada, devolvé aprobado=true con fallas=[] y terminá.

## A) CHECKS SIEMPRE — política + consistencia, en toda respuesta (con o sin catálogo)
- no_trabajado — REGLA 0, se evalúa PRIMERO. La imprenta NO hace: fotocopias. (Lista ampliable.) Si el bot ofreció o afirmó que hacen algo de esta lista, marcá no_trabajado — aunque exista un producto parecido por sinónimo. Que "exista en el catálogo" no lo excusa.
- info_no_permitida — el bot prometió o afirmó plazos, tiempos de entrega, envíos, stock, o toma/estado de pedidos. SOLO esas categorías. NO audites acá atributos de producto, precios ni formas de cobro: esos los cubre otro proceso y NO son info_no_permitida.
- derivacion_prematura — el bot empujó al cliente al mail ANTES de que el cliente pidiera avanzar. Marcá SOLO si la respuesta cierra mandando al mail Y en el mensaje del cliente NO hay ninguna señal de querer avanzar o hacer el pedido; si es ambiguo, APROBÁ. NO es derivación: ofrecer "cotizar por mail" cuando una opción no tiene precio, ni decir que "el total se cierra por mail" — son parte del guion normal del bot.
- pedido_o_archivo_por_canal — el bot tomó el pedido o pidió archivos para gestionarlos POR EL CHAT (ej.: "mandame el PDF por acá", "te anoto el pedido"). MATIZ: indicarle al cliente que mande el archivo y el pedido AL MAIL (terminalgrafica@gmail.com) está BIEN → NO lo marques.
- fuera_de_rol — el bot respondió algo ajeno al negocio o a su rol (temas que no son la imprenta, opiniones, tareas que no le tocan, salirse del personaje).
- producto_no_declarado — la respuesta AFIRMA datos concretos de catálogo (papeles, gramajes, medidas, materiales, acabados, packs, "trabajamos en X") sobre un producto o pedido que NO figura en productos_ofrecidos. Es un cruce respuesta-vs-auditoría: todo lo que el bot afirma tiene que estar declarado. Las PREGUNTAS no cuentan: pedir un eje ("¿qué cantidad?", "¿color o b/n?") SIN afirmar qué opciones existen está BIEN y NO se marca. Marcá SOLO afirmaciones de dato concreto, nunca preguntas.

## B) COMPARACIÓN DE PRODUCTO — SOLO si te pasé los DATOS REALES del catálogo
Si NO te pasé catálogo, SALTÁ este bloque entero. Si te lo pasé, para cada producto ofrecido buscá su fila real y marcá:
- fusion_variantes — el bot afirmó JUNTOS atributos que no conviven en una misma opción. Un producto puede traer varias opciones "Opciones: [v1]…, [v2]…"; cada [vN] es una variante distinta. Vale para TODAS las opciones: lo que está en el nombre del producto, su descripción ("Sirve para", notas) y las líneas Material/Tecnología. Vale para UNA sola opción: lo que está en el nombre de ESE [vN]. Es fusión si combinó atributos de opciones [vN] DISTINTAS (ej.: "brillo y mate a la vez" cuando [v1] es brillo y [v2] es mate; o el tamaño de [v1] con el acabado de [v2]). También: si hay precios_solicitados, el [vN] cotizado (variante_ref) tiene que ser la MISMA opción cuyos atributos describió.
- producto_inventado — el nombre_catalogo afirmado no aparece: no hay fila real razonablemente parecida (te aviso aparte los nombres sin coincidencia exacta).

## Acción
- aprobar — no hay fallas.
- corregir — SIEMPRE que haya al menos una falla. Un nodo barato edita el mensaje sacando o reformulando lo observado (saca la afirmación no permitida, quita el atributo de más de una fusión, saca el producto inventado). Es la ÚNICA remediación: la respuesta NUNCA se rehace desde cero.

## Salida (formato obligatorio)
Devolvé SIEMPRE y SOLO este JSON, sin texto fuera del JSON:
{"aprobado": boolean, "accion": "aprobar" | "corregir", "fallas": [{"tipo": "no_trabajado" | "info_no_permitida" | "derivacion_prematura" | "pedido_o_archivo_por_canal" | "fuera_de_rol" | "producto_no_declarado" | "fusion_variantes" | "producto_inventado", "producto": string, "detalle": string}], "resumen": string}
aprobado=false si hay al menos una falla; en ese caso accion="corregir". resumen = 1 frase en castellano rioplatense.
Ejemplo: {"aprobado": false, "accion": "corregir", "fallas": [{"tipo": "no_trabajado", "producto": "fotocopias", "detalle": "El bot ofreció fotocopias, un servicio que la imprenta no hace."}], "resumen": "Ofreció fotocopias, que no se trabajan."}`;

const esquemaVerif = {
  type: "object",
  required: ["aprobado", "fallas", "accion"],
  properties: {
    aprobado: { type: "boolean", description: "true si no encontraste ninguna falla" },
    accion: {
      type: "string",
      enum: ["aprobar", "corregir"],
      description:
        "qué hacer con la respuesta: aprobar (sin fallas) / corregir (hay al menos una falla; un nodo barato saca o reformula lo observado). No existe regenerar.",
    },
    fallas: {
      type: "array",
      description: "una por problema detectado; vacío si aprobado",
      items: {
        type: "object",
        required: ["tipo", "detalle"],
        properties: {
          tipo: {
            type: "string",
            enum: [
              "no_trabajado",
              "info_no_permitida",
              "derivacion_prematura",
              "pedido_o_archivo_por_canal",
              "fuera_de_rol",
              "producto_no_declarado",
              "fusion_variantes",
              "producto_inventado",
            ],
          },
          producto: { type: "string", description: "el nombre_catalogo afectado, si aplica" },
          detalle: { type: "string", description: "qué está mal, en una línea" },
        },
      },
    },
    resumen: { type: "string", description: "una línea para el log" },
  },
};

// ─────────────────────────────── CORRECTOR ───────────────────────────────
// Nodo barato (LLM sin tools): toma la respuesta original + las fallas del Verificador y la
// corrige SACANDO o REFORMULANDO texto. No re-busca, no agrega productos, no inventa.
const sistemaCorrector = `Sos el editor final del bot de WhatsApp de Terminal Gráfica (imprenta).
Recibís un mensaje ya redactado y las observaciones de un auditor. Tu ÚNICO trabajo: devolver el
mensaje corregido SACANDO o REFORMULANDO lo observado.

BLINDAJE: si NO encontrás en el mensaje lo que el auditor observa, devolvé el mensaje TAL CUAL, sin
cambios. El auditor puede equivocarse; nunca inventes un problema para "arreglarlo".

NUNCA agregues productos, precios ni información nueva. No inventes. No cambies de producto. Según lo
que marque el auditor:
- no_trabajado (ej. fotocopias): sacá esa afirmación y, si corresponde, aclarale que eso no lo hacemos.
- info_no_permitida (plazos, envíos, tiempos, stock, toma de pedidos): sacá la promesa/afirmación.
- derivacion_prematura: sacá el empujón al mail y ofrecé seguir ayudando por acá.
- pedido_o_archivo_por_canal: sacá la toma de pedido / pedido de archivo por el chat (podés dejar que,
  para avanzar, manden el archivo y el pedido al mail terminalgrafica@gmail.com).
- fuera_de_rol: sacá lo ajeno al negocio.
- producto_no_declarado: sacá los datos de catálogo afirmados de ese producto/pedido (papeles,
  medidas, opciones); si había una pregunta al cliente, dejala TAL CUAL.
- fusion_variantes: quitá el atributo que sobra. producto_inventado: sacá ese producto.

El mensaje puede traer marcadores {P1}, {P2}, … donde va un precio: son PLACEHOLDERS legítimos,
copialos TAL CUAL, no los reescribas ni los borres ni pongas un número. Si sacás un producto entero,
sacá también su {Pn}.

Castellano rioplatense, 2 a 5 líneas, sin emojis. Devolvé SOLO el mensaje para el cliente, sin
comillas ni explicaciones.`;

// ───────────────────────── INSERTAR PRECIOS (nodo terminal) ─────────────────────────
// Copia inline de lib/catalog/price-display.ts (n8n no importa TS). Mantener en sync.
const insertarPreciosCode = [
  "const pr = $('Preparar Respuesta').first().json;   // ref segura (siempre ejecuta)",
  "let texto = String(pr.output || '');",
  "texto = texto.split('\\\\r\\\\n').join('\\n').split('\\\\n').join('\\n');   // saltos escapados como texto → salto real",
  "const aud = pr.auditoria || {};",
  "const solic = Array.isArray(aud.precios_solicitados) ? aud.precios_solicitados : [];",
  "",
  "const nk = (s) => String(s || '').toLowerCase()",
  "  .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n').replace(/[^a-z0-9]+/g,' ').trim();",
  "const asArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch (e) { return []; } })() : []);",
  "const fmt = (n) => '$' + Math.round(Number(n)).toLocaleString('es-AR');",
  "const normNum = (t) => Number(String(t).replace(/[^0-9]/g, ''));",
  "",
  "const byName = new Map();",
  "for (const it of $input.all()) byName.set(nk(it.json.nombre), asArr(it.json.precios));",
  "",
  "function display(pv, cantidad) {",
  "  if (!pv || !pv.cobrable || !pv.unidad) return null;",
  "  const tramos = (pv.tramos || []).map((t) => ({ value: Number(t.value), minQty: Number(t.minQty) || 1, maxQty: t.maxQty == null ? null : Number(t.maxQty) })).filter((t) => t.value > 0);",
  "  let value = Number(pv.precio_lista) > 0 ? Number(pv.precio_lista) : 0;",
  "  let varia = false;",
  "  if (tramos.length) {",
  "    const c = Number(cantidad);",
  "    if (Number.isFinite(c) && c > 0) {",
  "      const orden = tramos.slice().sort((a, b) => a.minQty - b.minQty);",
  "      const exacto = orden.find((x) => c >= x.minQty && (x.maxQty == null || c <= x.maxQty));",
  "      const arriba = orden.find((x) => x.minQty > c);   // hueco/debajo → próximo pack que cubra",
  "      const t = exacto || arriba || orden[orden.length - 1];",
  "      if (t) value = t.value;",
  "    } else {",
  "      value = tramos.slice().sort((a, b) => a.minQty - b.minQty)[0].value;",
  "      varia = true;",
  "    }",
  "  }",
  "  if (!(value > 0)) return null;",
  "  return fmt(value) + (varia ? ' (varía según cantidad)' : '');   // SOLO el monto; la unidad la pone el agente",
  "}",
  "",
  "// 1) INYECCIÓN de {Pn}",
  "const inyectados = [];",
  "for (const s of solic) {",
  "  const token = '{' + String(s.ref || '') + '}';",
  "  if (!s.ref || texto.indexOf(token) === -1) continue;",
  "  const precios = byName.get(nk(s.nombre_catalogo)) || [];",
  "  let pv = precios.find((p) => String(p.ref) === String(s.variante_ref));",
  "  if (!pv && precios.length === 1) pv = precios[0];",
  "  const disp = display(pv, s.cantidad);",
  "  if (disp) inyectados.push(disp);",
  "  texto = texto.split(token).join(disp || 'a confirmar por mail');",
  "}",
  "texto = texto.replace(/\\{P\\d+\\}/gi, 'a confirmar por mail');   // {Pn} huérfanos (incl. minúscula)",
  "",
  "// 1b) DEDUP DE UNIDAD (defensivo): {Pn} ahora inyecta SOLO el monto, la unidad la escribe el",
  "//     agente. Si por su cuenta repite la forma de cobro adyacente, la colapsamos.",
  "texto = texto.replace(/(\\bpor\\s+[a-záéíóúñ0-9²]+)\\s+\\1\\b/gi, '$1');   // 'por trabajo por trabajo'",
  "texto = texto.replace(/(\\bel pack(?:\\s+de\\s+\\d+\\s+unidades)?)\\s+el pack(?:\\s+de\\s+\\d+)?(?:\\s+unidades)?\\b/gi, '$1');   // 'el pack ... el pack'",
  "",
  "// 2) VALIDAR-Y-REPARAR: montos tipeados por el LLM contra el catálogo real. NO se blanquea por",
  "//    'coincide con una cantidad declarada': un precio alucinado que iguala a la cantidad (ej.",
  "//    '1000 volantes' → tipea '$1.000') pasaría. Solo se acepta lo inyectado o un precio REAL.",
  "const preciosReales = new Set();",
  "for (const s of solic) {",
  "  for (const pv of (byName.get(nk(s.nombre_catalogo)) || [])) {",
  "    if (Number(pv.precio_lista) > 0) preciosReales.add(Math.round(Number(pv.precio_lista)));",
  "    for (const t of (pv.tramos || [])) if (Number(t.value) > 0) preciosReales.add(Math.round(Number(t.value)));",
  "  }",
  "}",
  "const validar = (m, n) => {",
  "  if (inyectados.some((iv) => iv.indexOf(m.trim()) !== -1)) return m;   // lo inyectamos nosotros",
  "  if (preciosReales.has(n)) return m;                                   // coincide con catálogo",
  "  return 'a confirmar por mail';                                        // no verificable → reparar",
  "};",
  "texto = texto.replace(/\\$\\s?\\d[\\d.]*/g, (m) => validar(m, normNum(m)));",
  "texto = texto.replace(/\\b(\\d[\\d.]*)\\s*pesos\\b/gi, (m, num) => validar(m, normNum(num)));",
  "",
  "// 3) ANTI-TOTAL: el bot no totaliza; sacar el 'en total' si igual lo escribió",
  "texto = texto.replace(/\\s+en total\\b/gi, '');",
  "",
  "// 4) REGISTRO DE DECISIÓN (bot.rag_decisiones). Si el Verificador MODIFICÓ el mensaje,",
  "//    el registro de productos queda EN BLANCO: no es fiable qué producto sobrevivió a la edición.",
  "const _decision = {",
  "  estado: pr.corregido ? 'corregido' : 'ok',",
  "  productos: pr.corregido ? [] : (Array.isArray(aud.productos_ofrecidos) ? aud.productos_ofrecidos : []),",
  "  precios: pr.corregido ? [] : (Array.isArray(aud.precios_solicitados) ? aud.precios_solicitados : []),",
  "  verificacion: pr.verificacion || null,",
  "};",
  "",
  "return [{ json: { ...pr, output: texto, _decision } }];",
].join("\n");

const flow = {
  name: "faq-bot-rag-lite",
  nodes: [
    {
      parameters: { public: false, options: {} },
      id: "rag-chat-trigger",
      name: "Cuando llega un mensaje",
      type: "@n8n/n8n-nodes-langchain.chatTrigger",
      typeVersion: 1.1,
      position: [0, 0],
      webhookId: "rag-lite-chat",
    },
    {
      // MEMORIA DE DECISIONES (lee lo que Log Decisión escribió): las últimas decisiones OK de esta
      // conversación, para que el agente sepa QUÉ PRODUCTOS ya recomendó (no solo el texto previo).
      // onError=continue: si la tabla no existe, no rompe el turno (contexto vacío).
      parameters: {
        operation: "executeQuery",
        query:
          "select productos, precios, mensaje\n" +
          "  from bot.rag_decisiones\n" +
          " where session_id = $1 and estado = 'ok' and jsonb_array_length(productos) > 0\n" +
          " order by created_at desc\n" +
          " limit 5",
        options: { queryReplacement: "={{ [ String($json.sessionId || '') ] }}" },
      },
      id: "rag-leer-decisiones",
      name: "Leer Decisiones",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [0, 200],
      credentials: { postgres: BOT_DB },
      onError: "continueRegularOutput",
      // CRÍTICO: sesión nueva / tabla vacía → 0 filas → 0 items → Contexto Previo y el Agente NO
      // ejecutan → el PRIMER mensaje de toda conversación muere sin respuesta. alwaysOutputData
      // emite un item igual (Contexto Previo ya filtra el vacío). Mismo footgun que Buscar Precios.
      alwaysOutputData: true,
    },
    {
      // Arma el bloque de contexto estructurado y pasa el chatInput. Ref segura al Chat Trigger y a
      // Leer Decisiones (ambos siempre ejecutan al inicio del turno).
      parameters: {
        jsCode: [
          "const chatInput = $('Cuando llega un mensaje').first().json.chatInput;",
          "let rows = [];",
          "try { rows = $('Leer Decisiones').all().map((i) => i.json).filter((r) => r && Array.isArray(r.productos) && r.productos.length); } catch (e) { rows = []; }",
          "let contextoPrevio = '';",
          "if (rows.length) {",
          "  const lineas = rows.slice().reverse().map((r) => {",
          "    const ps = r.productos.map((p) => (p.nombre_mostrado || p.nombre_catalogo) + (p.cantidad ? ' x' + p.cantidad : '')).join(', ');",
          "    return '- ' + ps;",
          "  });",
          "  contextoPrevio = 'CONTEXTO INTERNO (no es un mensaje del cliente) — productos que YA le recomendaste en mensajes anteriores de esta conversación. Usalos para dar continuidad; no rehagas la búsqueda si el cliente sigue sobre lo mismo:\\n' + lineas.join('\\n') + '\\n\\n';",
          "}",
          "return [{ json: { chatInput, contextoPrevio } }];",
        ].join("\n"),
      },
      id: "rag-contexto-previo",
      name: "Contexto Previo",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [160, 200],
    },
    {
      parameters: {
        promptType: "define",
        text: "={{ $json.chatInput }}",
        hasOutputParser: true,
        // El systemMessage antepone el contexto de decisiones previas (expresión) al prompt estático.
        options: { systemMessage: "={{ $('Contexto Previo').first().json.contextoPrevio }}" + sistema },
      },
      id: "rag-agente",
      name: "Agente",
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.9,
      position: [280, 0],
      // RESILIENCIA: reintenta ante output vacío/malformado transitorio (2 intentos); si aún así el
      // parser de salida falla ("Model output doesn't fit required format"), enruta por la salida de
      // ERROR (main[1]) → Fallback Agente, en vez de matar la ejecución y dejar al cliente sin nada.
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 1000,
      onError: "continueErrorOutput",
    },
    {
      // PUNTO ÚNICO DE CONVERGENCIA antes del chat. Todas las ramas terminales (aprobar /
      // corregido) le entregan la MISMA forma { respuesta, auditoria, verificacion }. Lee SOLO
      // de su input — NUNCA referencia otro nodo: en n8n apuntar a un nodo que no se ejecutó en
      // la rama actual bloquea hasta el timeout de 300s (lección del v10).
      parameters: {
        jsCode: [
          "const j = $input.first().json;",
          "// GUARD contra mensaje vacío: si el Corrector sacó el único contenido (o una rama devolvió",
          "// respuesta vacía), el cliente recibiría un mensaje en blanco. Caemos a un texto seguro.",
          "let output = String(j.respuesta ?? '').trim();",
          "if (!output) output = 'Disculpá, no pude terminar de armar esa respuesta. ¿Me lo repetís o querés que lo veamos por mail (terminalgrafica@gmail.com)?';",
          "return [{ json: {",
          "  output,",
          "  auditoria: j.auditoria ?? null,",
          "  verificacion: j.verificacion ?? null,",
          "  corregido: j.corregido ?? false,",
          "} }];",
        ].join("\n"),
      },
      id: "rag-preparar-respuesta",
      name: "Preparar Respuesta",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1780, 0],
    },
    {
      // Trae metadata.precios de los productos que el agente cotizó (por nombre, normalizado:
      // acentos + puntuación/espacios colapsados, así "…75 gr." matchea el canónico "…75 gr").
      parameters: {
        operation: "executeQuery",
        query:
          "select metadata->>'nombre_canonico' as nombre, metadata->'precios' as precios\n" +
          "  from bot.rag_catalogo\n" +
          " where trim(regexp_replace(translate(lower(metadata->>'nombre_canonico'), $$áéíóúñ$$, $$aeioun$$), '[^a-z0-9]+', ' ', 'g')) = any(\n" +
          "   select trim(regexp_replace(translate(lower(x), $$áéíóúñ$$, $$aeioun$$), '[^a-z0-9]+', ' ', 'g'))\n" +
          "     from jsonb_array_elements_text($1::jsonb) as x)",
        options: {
          // $1 = JSON array de nombres. null-safe: sin precios_solicitados → [] → 0 filas.
          queryReplacement:
            "={{ [ JSON.stringify((((($json.auditoria)||{}).precios_solicitados)||[]).map(p => p.nombre_catalogo)) ] }}",
        },
      },
      id: "rag-buscar-precios",
      name: "Buscar Precios",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [2000, 0],
      credentials: { postgres: BOT_DB },
      // GARANTÍA DE ENTREGA: sin precios_solicitados la query da 0 filas y, sin esto, un nodo con
      // 0 items NO dispara al siguiente → Insertar Precios (terminal) no corre y el mensaje no llega
      // ("No item to return was found"). Con alwaysOutputData emite un item vacío igual y el tail sigue.
      alwaysOutputData: true,
    },
    {
      // NODO TERMINAL + GARANTÍA. Inyecta los {Pn} con el precio real y valida cualquier monto que
      // el LLM haya tipeado contra el catálogo (whitelist de lo inyectado + cantidades declaradas).
      // Monto que no coincide con un precio real → "a confirmar por mail". Copia inline de la lógica
      // de lib/catalog/price-display.ts (n8n no importa TS): si tocás una, actualizá la otra.
      parameters: {
        jsCode: insertarPreciosCode,
      },
      id: "rag-insertar-precios",
      name: "Insertar Precios",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [2220, 0],
    },
    {
      // Registro durable de la decisión del turno (bot.rag_decisiones). onError=continue: si el log
      // falla (permiso/tabla), NO rompe la respuesta al cliente. session_id del Chat Trigger.
      parameters: {
        operation: "executeQuery",
        query:
          "insert into bot.rag_decisiones (session_id, mensaje, estado, productos, precios, verificacion)\n" +
          "values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)",
        options: {
          queryReplacement:
            "={{ (() => { const d = $json._decision || {}; return [ String($('Cuando llega un mensaje').first().json.sessionId || ''), String($json.output || ''), d.estado || 'ok', JSON.stringify(d.productos || []), JSON.stringify(d.precios || []), JSON.stringify(d.verificacion || null) ]; })() }}",
        },
      },
      id: "rag-log-decision",
      name: "Log Decisión",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [2440, 0],
      credentials: { postgres: BOT_DB },
      onError: "continueRegularOutput",
      // Defensivo: Responder depende de que salga un item. El INSERT ya emite uno, pero el flag
      // cubre cualquier variante donde el driver no devuelva filas.
      alwaysOutputData: true,
    },
    {
      // Nodo terminal REAL: re-emite el mensaje para el chat (el output de Log Decisión es el
      // resultado del INSERT, no el mensaje). Ref segura a Insertar Precios (siempre ejecuta).
      parameters: {
        jsCode: "return [{ json: { output: $('Insertar Precios').first().json.output } }];",
      },
      id: "rag-responder",
      name: "Responder",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [2660, 0],
    },
    {
      // maxTokens 900 (no 500): la salida estructurada (respuesta + productos_ofrecidos +
      // precios_solicitados + afirmaciones) más el tool-call trunca el JSON a 500 y el parser lo rechaza.
      parameters: { model: "google/gemini-3.1-flash-lite", options: { temperature: 0.3, maxTokens: 900 } },
      id: "rag-modelo",
      name: "Modelo",
      type: "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
      typeVersion: 1,
      position: [120, 240],
      credentials: { openRouterApi: OPENROUTER },
    },
    {
      parameters: {
        sessionIdType: "customKey",
        sessionKey: "={{ $('Cuando llega un mensaje').first().json.sessionId }}",
        contextWindowLength: 10,
      },
      id: "rag-memoria",
      name: "Memoria",
      type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
      typeVersion: 1.3,
      position: [300, 240],
    },
    {
      // PGVector Vector Store en modo TOOL del agente. Embebe la consulta (con el sub-nodo
      // Embeddings) y hace KNN sobre bot.rag_catalogo.
      parameters: {
        mode: "retrieve-as-tool",
        toolName: "buscar_catalogo",
        toolDescription: toolDesc,
        // Schema-cualificado: el nodo NO aplica un schema aparte, así que la tabla va como
        // `bot.rag_catalogo` (si va solo `rag_catalogo`, consulta public y devuelve [] en verde).
        tableName: "bot.rag_catalogo",
        topK: 8,
        options: {
          // Nombres de columna = los del DDL (coinciden con los defaults del nodo).
          columnNames: {
            idColumnName: "id",
            vectorColumnName: "embedding",
            contentColumnName: "text",
            metadataColumnName: "metadata",
          },
        },
      },
      id: "rag-pgvector",
      name: "buscar_catalogo",
      type: "@n8n/n8n-nodes-langchain.vectorStorePGVector",
      typeVersion: 1.3,
      position: [500, 240],
      credentials: { postgres: BOT_DB },
    },
    {
      // Embeddings nativos de Google Gemini. MISMO modelo que la ingesta (gemini-embedding-001).
      // Requiere la credencial "Google Gemini(PaLM) API" con la API key de Google AI Studio.
      parameters: { modelName: "models/gemini-embedding-001" },
      id: "rag-embeddings",
      name: "Embeddings (Google Gemini)",
      type: "@n8n/n8n-nodes-langchain.embeddingsGoogleGemini",
      typeVersion: 1,
      position: [700, 420],
    },
    {
      // Output parser: fuerza al agente a devolver el objeto de auditoría (respuesta + decisión).
      // Convive con la tool buscar_catalogo (mismo patrón que el Agente Selector del v10).
      parameters: {
        schemaType: "manual",
        inputSchema: JSON.stringify(esquemaSalida, null, 2),
      },
      id: "rag-salida",
      name: "Salida · Agente",
      type: "@n8n/n8n-nodes-langchain.outputParserStructured",
      typeVersion: 1.2,
      position: [480, 420],
    },
    {
      // Segundo agente = guardrail de política + consistencia (siempre) + comparación de producto (gateada por etapa).
      parameters: {
        promptType: "define",
        // Prompt pre-armado por "Armar Verificación": pedido + respuesta + auditoría siempre; los datos
        // reales del catálogo solo si etapa ∈ {recomendacion, seguimiento}. Sin tool, una sola inferencia.
        text: "={{ $json.prompt }}",
        hasOutputParser: true,
        options: { systemMessage: sistemaVerif },
      },
      id: "rag-verificador",
      name: "Agente Verificador",
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.9,
      position: [740, 0],
      // RESILIENCIA: si el auditor falla (parser o modelo), NO bloqueamos la respuesta del cliente:
      // enruta por la salida de ERROR (main[1]) → Fallback Verificador, que aprueba por defecto.
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 1000,
      onError: "continueErrorOutput",
    },
    {
      // maxTokens 1200 (no 700): con varias fallas el veredicto JSON crece y truncaba → parser falla
      // → Fallback aprueba por defecto (falla-abierto justo en las respuestas más rotas). El veredicto
      // es barato, así que damos aire.
      parameters: { model: "google/gemini-3.1-flash-lite", options: { temperature: 0.1, maxTokens: 1200 } },
      id: "rag-verif-modelo",
      name: "Modelo · Verificador",
      type: "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
      typeVersion: 1,
      position: [560, 620],
      credentials: { openRouterApi: OPENROUTER },
    },
    {
      parameters: {
        schemaType: "manual",
        inputSchema: JSON.stringify(esquemaVerif, null, 2),
      },
      id: "rag-verif-salida",
      name: "Salida · Verificador",
      type: "@n8n/n8n-nodes-langchain.outputParserStructured",
      typeVersion: 1.2,
      position: [740, 620],
    },
    {
      // PRE-FETCH DETERMINISTA (reemplaza la tool agéntica del Verificador). Trae de UNA query las
      // filas reales de los productos afirmados con match sobre nombre_canonico normalizado (acentos +
      // puntuación/espacios colapsados: el chunk muestra el nombre con un punto final "…gr." y el LLM
      // lo copia con el punto, pero el canónico no lo tiene → sin esto daba 0 filas). `= any`, no LIKE:
      // trae SOLO lo necesario y un nombre realmente inventado igual NO trae fila → señal de
      // producto_inventado que Armar Verificación detecta. alwaysOutputData: sin productos (saludo)
      // → 0 filas pero igual emite un item para que la cola no se corte.
      parameters: {
        operation: "executeQuery",
        query:
          "select metadata->>'nombre_canonico' as nombre,\n" +
          "       metadata->>'nicho'           as nicho,\n" +
          "       text\n" +
          "  from bot.rag_catalogo\n" +
          " where trim(regexp_replace(translate(lower(metadata->>'nombre_canonico'), $$áéíóúñ$$, $$aeioun$$), '[^a-z0-9]+', ' ', 'g')) = any(\n" +
          "   select trim(regexp_replace(translate(lower(x), $$áéíóúñ$$, $$aeioun$$), '[^a-z0-9]+', ' ', 'g'))\n" +
          "     from jsonb_array_elements_text($1::jsonb) as x)",
        options: {
          // $1 = JSON array de nombres afirmados. null-safe: sin productos → [] → 0 filas.
          queryReplacement:
            "={{ [ JSON.stringify((((($('Agente').first().json.output)||{}).productos_ofrecidos)||[]).map(p => p.nombre_catalogo)) ] }}",
        },
      },
      id: "rag-traer-catalogo",
      name: "Traer Catálogo Real",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [420, 180],
      credentials: { postgres: BOT_DB },
      alwaysOutputData: true,
    },
    {
      // Arma el mensaje de usuario del Verificador. Los CHECKS DE POLÍTICA corren SIEMPRE (pedido +
      // respuesta + auditoría). La COMPARACIÓN DE PRODUCTO (fusion/inventado) es gateada por etapa: solo
      // si etapa ∈ {recomendacion, seguimiento} se inyectan las filas reales ($input) y los faltantes.
      // FALTANTES (nombres afirmados sin fila exacta) se computan SIEMPRE → observabilidad en el log.
      parameters: {
        jsCode: [
          "let ag = $('Agente').first().json.output ?? {};",
          "if (typeof ag === 'string') { try { ag = JSON.parse(ag); } catch (e) { ag = { respuesta: ag }; } }",
          "const aud = (ag && typeof ag === 'object') ? ag : { respuesta: String(ag ?? '') };",
          "const cliente = $('Cuando llega un mensaje').first().json.chatInput || '';",
          "const etapa = String(aud.etapa || '');",
          "const conCatalogo = etapa === 'recomendacion' || etapa === 'seguimiento';",
          "const rows = $input.all().map((i) => i.json).filter((r) => r && r.nombre);",
          "// normalizador espejo del SQL: acentos + colapsa puntuación/espacios (matchea 'gr.' con 'gr')",
          "const nk = (s) => String(s || '').toLowerCase().replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i').replace(/ó/g,'o').replace(/ú/g,'u').replace(/ñ/g,'n').replace(/[^a-z0-9]+/g,' ').trim();",
          "const encontrados = new Set(rows.map((r) => nk(r.nombre)));",
          "const pedidos = (Array.isArray(aud.productos_ofrecidos) ? aud.productos_ofrecidos : []).map((p) => p && p.nombre_catalogo).filter(Boolean);",
          "const faltantes = [...new Set(pedidos.filter((n) => !encontrados.has(nk(n))))];",
          "const partes = [",
          "  'Pedido del cliente:', cliente, '',",
          "  'Respuesta del bot (revisala):', String(aud.respuesta || ''), '',",
          "  'Auditoría del bot:', JSON.stringify(aud, null, 2),",
          "];",
          "if (conCatalogo) {",
          "  const real = rows.length",
          "    ? rows.map((r) => '### ' + r.nombre + (r.nicho ? ' [nicho: ' + r.nicho + ']' : '') + '\\n' + (r.text || '')).join('\\n\\n')",
          "    : '(ninguno de los productos ofrecidos existe en el catálogo)';",
          "  partes.push('', 'DATOS REALES del catálogo (hacé la comparación de producto SOLO contra esto):', real);",
          "  if (faltantes.length) {",
          "    partes.push('', 'PRODUCTOS SIN COINCIDENCIA EXACTA EN EL CATÁLOGO — el bot afirmó estos nombres pero no existen tal cual. Marcá producto_inventado para cada uno:', faltantes.map((n) => '- ' + n).join('\\n'));",
          "  }",
          "}",
          "return [{ json: { prompt: partes.join('\\n'), auditoria: aud, etapa, faltantes, conCatalogo } }];",
        ].join("\n"),
      },
      id: "rag-armar-verif",
      name: "Armar Verificación",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [580, 0],
    },
    {
      // Unifica en un solo item lo que las ramas de abajo necesitan: la respuesta + auditoría del
      // Agente (siempre ejecutó → ref segura) y el veredicto del Verificador (su input directo).
      // Adjunta los `faltantes` de Armar Verificación (siempre ejecutó en las ramas que llegan acá)
      // al objeto verificacion → viajan a la columna verificacion del log (observabilidad, sin plumbing).
      parameters: {
        jsCode: [
          "let ag = $('Agente').first().json.output ?? {};",
          "if (typeof ag === 'string') { try { ag = JSON.parse(ag); } catch (e) { ag = { respuesta: ag }; } }",
          "const audit = (ag && typeof ag === 'object') ? ag : { respuesta: String(ag ?? '') };",
          "let ve = $input.first().json.output ?? $input.first().json ?? {};",
          "if (typeof ve === 'string') { try { ve = JSON.parse(ve); } catch (e) { ve = {}; } }",
          "// Regenerar ya no existe: cualquier acción que no sea 'aprobar' cae a 'corregir'.",
          "const accion = (ve.accion ? ve.accion === 'aprobar' : ve.aprobado === true) ? 'aprobar' : 'corregir';",
          "let faltantes = [];",
          "try { faltantes = $('Armar Verificación').first().json.faltantes || []; } catch (e) { faltantes = []; }",
          "if (ve && typeof ve === 'object') ve.faltantes = faltantes;",
          "return [{ json: {",
          "  respuesta: audit.respuesta ?? '',",
          "  auditoria: audit,",
          "  verificacion: ve,",
          "  accion,",
          "} }];",
        ].join("\n"),
      },
      id: "rag-leer-veredicto",
      name: "Leer Veredicto",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [900, 0],
    },
    {
      // Rutea según la acción que decidió el Verificador.
      parameters: {
        rules: {
          values: [
            {
              conditions: {
                options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
                combinator: "and",
                conditions: [
                  { leftValue: "={{ $json.accion }}", rightValue: "aprobar", operator: { type: "string", operation: "equals" } },
                ],
              },
              renameOutput: true,
              outputKey: "aprobar",
            },
          ],
        },
        // Fallback = corregir (cualquier cosa que no sea aprobar cae acá). Regenerar ya no existe.
        options: { fallbackOutput: "extra", renameFallbackOutput: "corregir" },
      },
      id: "rag-switch-accion",
      name: "Ruteo Acción",
      type: "n8n-nodes-base.switch",
      typeVersion: 3.4,
      position: [1120, 0],
    },
    {
      // Corrector: LLM sin tools que edita el mensaje según las fallas. Barato (una sola pasada).
      parameters: {
        promptType: "define",
        text:
          "=Mensaje original:\n\"\"\"{{ $json.respuesta }}\"\"\"\n\n" +
          "Observaciones del auditor a corregir:\n" +
          "{{ ($json.verificacion.fallas || []).map(f => '- ' + f.tipo + (f.producto ? ' (' + f.producto + ')' : '') + ': ' + f.detalle).join('\\n') }}",
        options: { systemMessage: sistemaCorrector },
      },
      id: "rag-corrector",
      name: "Corrector",
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.9,
      position: [1340, -160],
      // RESILIENCIA: el Corrector NO tenía red y encima es el destino del fallback (veredicto
      // ilegible + loop agotado caen acá). Un 500/timeout de OpenRouter mataba la ejecución. Ahora
      // reintenta y, si falla, enruta por ERROR (main[1]) → Fallback Corrector (pasa el original).
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 1000,
      onError: "continueErrorOutput",
    },
    {
      parameters: { model: "google/gemini-3.1-flash-lite", options: { temperature: 0.2, maxTokens: 400 } },
      id: "rag-corrector-modelo",
      name: "Modelo · Corrector",
      type: "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
      typeVersion: 1,
      position: [1340, 40],
      credentials: { openRouterApi: OPENROUTER },
    },
    {
      // Reconstruye la forma canónica { respuesta(corregida), auditoria, verificacion } leyendo la
      // corrección ($input) + el contexto de Leer Veredicto (siempre ejecutó → ref segura).
      parameters: {
        jsCode: [
          "const raw = $input.first().json;",
          "const corr = raw.output ?? raw.text ?? '';",
          "const texto = (typeof corr === 'string' ? corr : (corr.respuesta ?? '')).trim();",
          "const lv = $('Leer Veredicto').first().json;",
          "return [{ json: {",
          "  respuesta: texto,",
          "  auditoria: lv.auditoria,",
          "  verificacion: lv.verificacion,",
          "  corregido: true,",
          "} }];",
        ].join("\n"),
      },
      id: "rag-aplicar-correccion",
      name: "Aplicar Corrección",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1560, -160],
    },
    {
      // RED DE SEGURIDAD del Corrector. Recibe su salida de ERROR y pasa la respuesta ORIGINAL sin
      // corregir (mejor un mensaje con una observación menor que silencio). corregido=true → el log
      // blanquea productos (no es fiable qué sobrevivió). Ref segura a Leer Veredicto (siempre ejecutó).
      parameters: {
        jsCode: [
          "const lv = $('Leer Veredicto').first().json;",
          "return [{ json: {",
          "  respuesta: lv.respuesta ?? '',",
          "  auditoria: lv.auditoria ?? null,",
          "  verificacion: lv.verificacion ?? null,",
          "  corregido: true,",
          "} }];",
        ].join("\n"),
      },
      id: "rag-fallback-corrector",
      name: "Fallback Corrector",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1560, -320],
    },
    {
      // RED DE SEGURIDAD del Agente. Recibe la salida de ERROR del Agente (parser malformado/vacío o
      // caída del modelo). Emite la forma canónica con un mensaje seguro → Preparar Respuesta (salta
      // al Verificador). El cliente SIEMPRE recibe algo; la ejecución nunca muere por un parse-error.
      parameters: {
        jsCode: [
          "return [{ json: {",
          "  respuesta: 'Perdoná, no te entendí bien. ¿Me lo repetís?',",
          "  auditoria: null,",
          "  verificacion: null,",
          "  corregido: false,",
          "} }];",
        ].join("\n"),
      },
      id: "rag-fallback-agente",
      name: "Fallback Agente",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [280, 260],
    },
    {
      // RED DE SEGURIDAD del Verificador. Recibe su salida de ERROR y aprueba por defecto: entrega la
      // MISMA forma { output: {...} } que espera Leer Veredicto, así el mensaje del bot sale igual.
      parameters: {
        jsCode: [
          "return [{ json: { output: {",
          "  aprobado: true,",
          "  accion: 'aprobar',",
          "  fallas: [],",
          "  resumen: 'auditor no disponible; se aprueba por defecto',",
          "} } }];",
        ].join("\n"),
      },
      id: "rag-fallback-verif",
      name: "Fallback Verificador",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [620, 260],
    },
    {
      parameters: {
        content: [
          "## Bot RAG lite — agente + PGVector (nativo)",
          "",
          "Prueba interna (chat de test del Chat Trigger, sin Chatwoot/WhatsApp).",
          "",
          "El **Agente** tiene: Modelo de chat (OpenRouter), **Memoria** (10 turnos/sesión) y la tool **buscar_catalogo** = nodo **PGVector Vector Store** (modo *Retrieve as Tool*) con el sub-nodo **Embeddings Google Gemini**. El nodo embebe la consulta y hace la búsqueda — sin HTTP ni sub-workflow.",
          "",
          "**Flujo por etapas** (system prompt): saludo · pedido claro (usa la tool) · falta info→pregunta · seguimiento · otro. Guard de nicho blando (por prompt).",
          "",
          "**Precios**: el agente NUNCA tipea un número — escribe {P1},{P2}… y declara `precios_solicitados`. El chunk trae los precios en 'Opciones:' como contexto. **Buscar Precios** lee metadata.precios y **Insertar Precios** (terminal) reemplaza los {Pn} por el precio real y valida cualquier monto tipeado contra el catálogo (no coincide → 'a confirmar por mail'). Solo unitario/tramo, sin totales.",
          "",
          "**Salida estructurada** (nodo *Salida · Agente*): el agente devuelve JSON con `respuesta` + auditoría: `productos_ofrecidos` (nombre_catalogo + atributos + cantidad), `precios_solicitados` ({Pn}→producto/variante_ref/cantidad), `motivo`, `afirmaciones`.",
          "",
          "**Agente Verificador** (2º agente, SIN tool) = GUARDRAIL. Checks de POLÍTICA SIEMPRE: no_trabajado (Regla 0: fotocopias…), info_no_permitida (plazos/envíos/stock/pedidos), derivacion_prematura, pedido_o_archivo_por_canal (matiz: derivar archivo+pedido al mail está OK), fuera_de_rol. COMPARACIÓN DE PRODUCTO (fusion_variantes / producto_inventado) SOLO si etapa ∈ {recomendacion, seguimiento}: ahí **Armar Verificación** inyecta las filas reales de **Traer Catálogo Real** (postgres); fuera de esas etapas no se trae catálogo (prompt corto y barato). Sesgo: ante la duda, aprobá. Decide **acción**: aprobar / corregir (NUNCA regenera).",
          "",
          "**Remediación** (Leer Veredicto → Ruteo Acción): aprobar→sale directo · corregir→**Corrector** (LLM barato que saca/reformula el texto sin re-buscar; blindado: si no ve la observación, deja el mensaje igual). NO hay regeneración: la respuesta nunca vuelve al Agente → tope duro de tokens.",
          "",
          "**Preparar Respuesta** (punto único de convergencia): junta `respuesta` + `auditoria` + `verificacion` + `corregido`. Lee solo de su input (ref a nodo no ejecutado bloquea 300s).",
          "",
          "**Memoria de decisiones** (lazo cerrado): **Leer Decisiones** (postgres) trae las últimas decisiones OK de la sesión y **Contexto Previo** arma un bloque que se antepone al system prompt → el agente sabe QUÉ productos ya recomendó, no solo el texto previo. **Log Decisión** (bot.rag_decisiones, requiere db/rag-decisiones.sql) registra por turno qué recomendó (session_id, mensaje, estado, productos, precios, veredicto); si el Verificador MODIFICÓ el mensaje → productos EN BLANCO. onError=continue. **Responder** re-emite el mensaje al chat.",
          "",
          "⚠️ VERIFICAR EN LA UI:",
          "1) Embeddings (Google Gemini): credencial **Google Gemini(PaLM) API** (API key de Google AI Studio), modelo models/gemini-embedding-001 (el MISMO que la ingesta). Chat + ambos agentes en OpenRouter; solo embeddings en Google.",
          "2) buscar_catalogo (PGVector): Table Name = bot.rag_catalogo (schema-cualificado). Requiere db/rag-embeddings.sql aplicado y la tabla poblada (scripts/rag-ingest.ts). El pre-fetch del Verificador (Traer Catálogo Real) es un postgres normal, sin config de UI.",
        ].join("\n"),
        height: 560,
        width: 540,
      },
      id: "rag-nota",
      name: "Nota",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [0, -520],
    },
  ],
  connections: {
    "Cuando llega un mensaje": { main: [[{ node: "Leer Decisiones", type: "main", index: 0 }]] },
    "Leer Decisiones": { main: [[{ node: "Contexto Previo", type: "main", index: 0 }]] },
    "Contexto Previo": { main: [[{ node: "Agente", type: "main", index: 0 }]] },
    // Agente: main[0] = OK → pre-fetch del catálogo → Verificador; main[1] = ERROR → Fallback Agente.
    Agente: {
      main: [
        [{ node: "Traer Catálogo Real", type: "main", index: 0 }],
        [{ node: "Fallback Agente", type: "main", index: 0 }],
      ],
    },
    "Traer Catálogo Real": { main: [[{ node: "Armar Verificación", type: "main", index: 0 }]] },
    "Armar Verificación": { main: [[{ node: "Agente Verificador", type: "main", index: 0 }]] },
    "Fallback Agente": { main: [[{ node: "Preparar Respuesta", type: "main", index: 0 }]] },
    // Verificador: main[0] = OK → Leer Veredicto; main[1] = ERROR → Fallback Verificador (aprueba).
    "Agente Verificador": {
      main: [
        [{ node: "Leer Veredicto", type: "main", index: 0 }],
        [{ node: "Fallback Verificador", type: "main", index: 0 }],
      ],
    },
    "Fallback Verificador": { main: [[{ node: "Leer Veredicto", type: "main", index: 0 }]] },
    "Leer Veredicto": { main: [[{ node: "Ruteo Acción", type: "main", index: 0 }]] },
    // Switch: salida 0 = aprobar → sale directo; salida 1 (fallback) = corregir → Corrector.
    "Ruteo Acción": {
      main: [
        [{ node: "Preparar Respuesta", type: "main", index: 0 }],
        [{ node: "Corrector", type: "main", index: 0 }],
      ],
    },
    // Corrector: main[0] = OK → Aplicar Corrección; main[1] = ERROR → Fallback Corrector (pasa el original).
    Corrector: {
      main: [
        [{ node: "Aplicar Corrección", type: "main", index: 0 }],
        [{ node: "Fallback Corrector", type: "main", index: 0 }],
      ],
    },
    "Aplicar Corrección": { main: [[{ node: "Preparar Respuesta", type: "main", index: 0 }]] },
    "Fallback Corrector": { main: [[{ node: "Preparar Respuesta", type: "main", index: 0 }]] },
    // Cola de precios + log: Preparar Respuesta → Buscar Precios → Insertar Precios → Log Decisión → Responder.
    "Preparar Respuesta": { main: [[{ node: "Buscar Precios", type: "main", index: 0 }]] },
    "Buscar Precios": { main: [[{ node: "Insertar Precios", type: "main", index: 0 }]] },
    "Insertar Precios": { main: [[{ node: "Log Decisión", type: "main", index: 0 }]] },
    "Log Decisión": { main: [[{ node: "Responder", type: "main", index: 0 }]] },
    Modelo: { ai_languageModel: [[{ node: "Agente", type: "ai_languageModel", index: 0 }]] },
    Memoria: { ai_memory: [[{ node: "Agente", type: "ai_memory", index: 0 }]] },
    buscar_catalogo: { ai_tool: [[{ node: "Agente", type: "ai_tool", index: 0 }]] },
    "Embeddings (Google Gemini)": { ai_embedding: [[{ node: "buscar_catalogo", type: "ai_embedding", index: 0 }]] },
    "Salida · Agente": { ai_outputParser: [[{ node: "Agente", type: "ai_outputParser", index: 0 }]] },
    "Modelo · Verificador": { ai_languageModel: [[{ node: "Agente Verificador", type: "ai_languageModel", index: 0 }]] },
    "Salida · Verificador": { ai_outputParser: [[{ node: "Agente Verificador", type: "ai_outputParser", index: 0 }]] },
    "Modelo · Corrector": { ai_languageModel: [[{ node: "Corrector", type: "ai_languageModel", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
};

const json = JSON.stringify(flow, null, 2);
JSON.parse(json);
writeFileSync(OUT_MAIN, json + "\n");
console.error(`OK: ${OUT_MAIN} (${flow.nodes.length} nodos)`);
