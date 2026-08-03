# Changeset — actualizar tu instancia n8n de `1d631cb` a la actual

> **Para qué:** tu n8n corre la versión `1d631cb` (31/07). Te faltan los otros dos
> commits del 31: `8585b95` y `ce38455`. Este archivo lista los cambios exactos para
> aplicarlos **a mano, conservando tu layout y tus sticky notes** (sin re-importar todo).
> **4 nodos afectados.** Después de aplicar: correr los tests (abajo).

## Método recomendado: copiar nodos desde un scratch (sin retipear código)

Retipear 200 líneas del motor de precios es pedir un bug. En vez de eso:

1. **Importá** `faq-bot-v10-live.json` en un workflow **NUEVO/scratch** (NO tu workflow real).
2. En el scratch, seleccioná y copiá (Ctrl+C) estos 4 nodos: **`Buscar Candidatos`**,
   **`Calcular Montos`**, **`Salida Info`**, **`Datos Info`**.
3. En tu workflow real: borrá los viejos `Buscar Candidatos`, `Calcular Montos`,
   `Salida Info`, y pegá (Ctrl+V) los 4 copiados.
4. **Reconectá** los cables (n8n no siempre preserva las conexiones entre nodos al pegar)
   y **revinculá las credenciales** de los nodos Postgres (ver abajo).
5. Borrá el workflow scratch.

Así el código viaja exacto y tu layout de los otros ~70 nodos queda intacto. El detalle de
cada nodo está abajo para que verifiques que quedó bien.

---

## Cambio 1 — `Buscar Candidatos` (commit `ce38455`)  · 2 ediciones quirúrgicas

Si preferís editarlo a mano en vez de copiar el nodo, son **exactamente dos líneas** dentro
de la query. n8n pasa la query por un parser propio que **parte `<>` y `#>>`** y tira
`Syntax error at line 23 near ">"` → la búsqueda de catálogo sale **vacía**.

**a)** en el CTE `toks`:
```diff
-  where t <> ''
+  where length(t) > 0
```

**b)** en el CTE `ejes`, la rama `when ... = 'number'`:
```diff
-           when jsonb_typeof(kv.value) = 'number' then jsonb_build_array(kv.value #>> '{}')
+           when jsonb_typeof(kv.value) = 'number'
+             then jsonb_build_array(to_jsonb(trim(both '"' from kv.value::text)))
```

---

## Cambio 2 — `Calcular Montos` (commit `8585b95`)  · reemplazo de código

Se agregó el **cap de volumen**: topea el total cuando la cantidad es absurda (hallazgo A-1
de la ronda del 31: `999.999 unidades → $399,9M`; el fix muestra el unitario y capa el total).
Es el **único productor de montos del flujo**, así que **copiá el nodo entero** (método de
arriba) — no lo edites por partes. Fuente de referencia limpia: `tests/build-v10-agents-parte2.js`
línea 313, pero **la verdad viva es el nodo del JSON del repo** (el build no está 100% sincronizado).

---

## Cambio 3 — `Salida Info` (commit `8585b95`)  · reemplazo de código

Era una línea (copiaba `respuestaInfo`, y si venía vacío escalaba a mail). Ahora es la red
determinística: usa las filas de `Datos Info` de respaldo. Reemplazá TODO el código del nodo
por esto:

```js
// RED DETERMINISTICA DE LA RAMA INFO (Martin, 2026-07-31)
// Un dato que ya esta en una tabla no deberia depender de que un LLM se acuerde de pedirlo.
// Datos Info trae la tabla SIEMPRE; aca se usa de respaldo. Si el agente contesto, gana su
// redaccion; si no, se arma el texto desde las filas. Sin llamada LLM extra.
const d = $('Leer Intención').first().json;
const texto = String(d.respuestaInfo || '').trim();

let filas = [];
try {
  filas = $('Datos Info').all()
    .map((i) => i.json)
    .filter((r) => r && r.clave && r.valor);
} catch (e) { filas = []; }

const norm = (s) => String(s || '').normalize('NFC').toLowerCase()
  .replace(/[áéíóúü]/g, (c) => ({ 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u' }[c]))
  .replace(/ñ/g, 'n');

const PISTAS = {
  horario: ['horario', 'hora', 'abren', 'abre', 'cierran', 'cierra', 'sabado', 'sabados',
    'domingo', 'feriado', 'atienden', 'atiende', 'abierto', 'hoy', 'ahora'],
  direccion: ['direccion', 'donde', 'ubicado', 'ubicacion', 'local', 'quedan', 'queda', 'llegar'],
  pago: ['pago', 'pagar', 'tarjeta', 'efectivo', 'transferencia', 'debito', 'credito', 'mercado'],
  envio: ['envio', 'envios', 'mandan', 'mandar', 'entrega', 'domicilio', 'cadeteria'],
  plazo: ['plazo', 'demora', 'tardan', 'tarda', 'cuando', 'listo', 'urgente'],
  contacto: ['telefono', 'contacto', 'whatsapp', 'mail', 'correo', 'instagram'],
};

const pregunta = norm(d.userMessage || '');
const temas = Object.keys(PISTAS).filter((t) => PISTAS[t].some((p) => pregunta.includes(p)));

const puntuar = (r) => {
  const clave = norm(r.clave);
  let score = 0;
  for (const t of temas) {
    if (clave.includes(t)) score += 3;
    if (PISTAS[t].some((p) => clave.includes(p))) score += 2;
  }
  for (const w of pregunta.split(/[^a-z0-9]+/).filter((w) => w.length >= 5)) {
    if (clave.includes(w)) score += 2;
  }
  return score;
};

const relevantes = filas.map((r) => ({ ...r, _score: puntuar(r) }))
  .filter((r) => r._score > 0)
  .sort((a, b) => b._score - a._score)
  .slice(0, 4);

const respaldo = relevantes.map((r) => String(r.valor).trim()).join('\n');
const final = texto || respaldo;

return [{ json: {
  ...d,
  final,
  accion: 'info',
  hayRespuesta: final.length > 0,
  infoDelAgente: texto.length > 0,
  infoDelRespaldo: !texto && respaldo.length > 0,
  notas: 'v10-info' + (texto ? ' fuente=agente' : (respaldo ? ' fuente=tabla' : ' fuente=ninguna'))
    + ' filas=' + filas.length + ' relevantes=' + relevantes.length
    + (temas.length ? ' temas=' + temas.join(',') : ''),
} }];
```

---

## Cambio 4 — `Datos Info` (commit `8585b95`)  · NODO NUEVO

Crear un nodo **Postgres** nuevo:
- **Tipo:** Postgres · **Operation:** Execute Query
- **Credencial:** `Bot Readonly DB` (la misma que usan los otros Postgres)
- **Settings:** `Always Output Data` = ON · `On Error` = Continue (Regular Output)
- **Query:**
```sql
-- RESPALDO DETERMINISTICO DE LA RAMA INFO. Misma tabla que la tool consultar_info_negocio,
-- pero sin depender de que el LLM la llame: trae la tabla entera (es chica) y Salida Info
-- elige las filas que aplican. El limit es la red por si la tabla crece.
select clave, valor from bot.info_negocio order by clave limit 40
```

---

## Rewiring (commit `8585b95`)

La rama info cambia de `Switch Intención (info) → Salida Info` a **`Switch Intención (info) →
Datos Info → Salida Info`**:

1. Borrá el cable `Switch Intención` (salida **info**) → `Salida Info`.
2. Conectá `Switch Intención` (salida **info**) → **`Datos Info`**.
3. Conectá **`Datos Info`** → **`Salida Info`**.

El resto de la rama info (`Salida Info → ¿Info Resuelta?`) no cambia.

---

## Verificación (después de aplicar)

Desde `whatsapp-automation/`:
```
WF=faq-bot-v10-live.json node tests/validate-v10-agents.js
WF=faq-bot-v10-live.json node tests/test-cap-e-info.js
```
`test-cap-e-info.js` es el test nuevo que entró con `8585b95` — cubre justo el cap y la rama info.
Y en WhatsApp real: probá una consulta de horario ("¿a qué hora abren los sábados?") — antes se
iba a mail, ahora tiene que responder con el dato.
