# Build n8n v5 — acceso al catálogo (por incrementos)

> Implementa el roadmap §1 (decisión 2026-06-29). Base de datos: ver `../data-model.md`.
> Estrategia: **incrementos**. A = catálogo vivo en el prompt + logging (bajo riesgo).
> B = resolución estructurada + precios. Construir y validar A antes de B.

## Prerrequisitos (los corre Martin)

1. Migración aplicada al local (`bot` schema) — ✅ hecho 2026-06-29.
2. Crear el rol: correr `supabase/bot-readonly-role.sql` con una password fuerte.
3. En n8n: nueva **credencial Postgres** "Bot Readonly DB" apuntando al Postgres local
   (container `supabase_db_TerminalGrafica`), usuario `bot_readonly`, su password.
   - Local directo: host del container / `localhost:54322` (puerto del Postgres local de Supabase).
   - Si n8n corre en otro container: usar la red de Docker (host = nombre del service de la BD).

---

## Incremento A — catálogo vivo en el prompt + logging

Cambia el mínimo del flow v4: reemplaza la lista estática de productos del nodo
`System Prompt` por el catálogo real, y registra cada decisión.

### A1. Nodo nuevo `Get Catálogo` (Postgres, credencial Bot Readonly DB)

Va **antes** de `Armar Prompt` (en paralelo a / después de `Get Historial`). Devuelve UNA fila
con el catálogo ya formateado como texto, listo para inyectar:

```sql
select string_agg(
  nombre_canonico || ' [' || categoria || ']' ||
  case when cardinality(sinonimos)    > 0 then ' — también: ' || array_to_string(sinonimos, ', ')    else '' end ||
  case when cardinality(casos_de_uso) > 0 then ' — usos: '    || array_to_string(casos_de_uso, ', ') else '' end,
  E'\n' order by categoria, nombre_canonico
) as catalogo
from bot.taxonomia;
```

> Catálogo chico (~24 productos) → consultar en cada ejecución es trivial. Cachear (n8n static
> data, refresh ~1h) es optimización para más adelante, no para A.

### A2. Modificar `Armar Prompt`

Donde hoy el system prompt tiene la sección **"Productos y servicios disponibles"** con la lista
escrita a mano, reemplazarla por el valor de `Get Catálogo`:

```
Productos y servicios disponibles (catálogo vivo — esta es la fuente de verdad, no inventes nada fuera de esto):
{{ $node["Get Catálogo"].json.catalogo }}
```

Y agregar a las instrucciones del prompt (sección Reglas):
- "Para entender qué producto pide el cliente, usá los nombres, los 'también:' (sinónimos) y los
  'usos:'. Si el cliente lo nombra distinto pero coincide con un sinónimo o un uso, es ese producto."
- **Soft handoff (regla dura): NUNCA digas que no trabajan algo de forma terminal.** Si no encontrás
  el producto en el catálogo o dudás, escalá (devolvé `ESCALAR`), no afirmes "no hacemos eso".

> El resto del prompt v4 (tono rioplatense, persona no-bot, ESCALAR como token solo, SEGURIDAD
> anti-injection) queda IGUAL. A es un cambio de datos, no de comportamiento.

### A3. Logging a `bot.decisiones` (2 puntos terminales)

Dos nodos Postgres nuevos (misma credencial), uno en cada salida terminal:

**Al responder** (después de `Enviar Respuesta`):
```sql
insert into bot.decisiones (conversation_id, mensaje_cliente, nivel_resolucion, accion, hubo_handoff)
values ($1, $2, 'n2_llm', 'informo_capacidad', false);
```

**Al escalar** (en la rama de `IF — Escalar` = true, junto a `Asignar Agente`):
```sql
insert into bot.decisiones (conversation_id, mensaje_cliente, nivel_resolucion, accion, hubo_handoff)
values ($1, $2, 'ninguno', 'handoff', true);
```

Parámetros: `$1` = id de conversación (del webhook), `$2` = mensaje crudo del cliente.

> En A logueamos grueso (volumen + tasa de escalación). El `producto_resuelto`, `candidatos` y
> `filas_sql` finos llegan en B (cuando haya resolución estructurada).

### A4. Validar A
- Preguntar por un producto con un sinónimo y ver que lo reconoce.
- Preguntar por algo que NO está → confirmar que escala (no dice "no trabajamos eso").
- `select accion, count(*) from bot.decisiones group by 1;` → ver que registra.

---

## Incremento B — resolución estructurada + precios (después de validar A)

Cambia el modo de la llamada LLM de texto libre a **salida estructurada**, para poder traer precios.

1. **Resolución estructurada:** el LLM, con la taxonomía en el prompt, devuelve JSON:
   `{ producto_id | null, intent: 'info'|'precio'|'escalar'|'saludo', clarify?: string, candidatos: [...] }`.
2. **Si intent='precio' y hay producto_id** → nodo `Get Variantes`:
   ```sql
   select variante, color, unidad, precio_lista, tiene_reglas, mostrable
   from bot.variantes where producto_id = $1 order by precio_lista;
   ```
3. **Composición del precio (regla dura):**
   - `mostrable = true` → mostrar "variante: $precio" con plantilla fija (el LLM no tipea el número).
   - `tiene_reglas = true` (mostrable=false) → NO mostrar número: "desde $X; para el precio exacto
     necesito cantidad y medida, te paso un asesor" (rango + captura) o escalar.
   - Mezcla → mostrar las mostrables y para las que tienen reglas, el gatillo de captura.
4. **Logging fino:** completar `producto_resuelto`, `candidatos`, `filas_sql`, `nivel_resolucion`.
5. **Fase 2 (cálculo real con reglas):** llamar al motor del quote-system (`lib/quote-utils.ts`)
   expuesto como endpoint — recién cuando A y B estén sólidos y el loop dé datos.

---

## Orden
1. [Martin] Rol + credencial Postgres en n8n (prereqs 2-3).
2. [Juntos] Incremento A (A1-A4) y validar.
3. [Juntos] Incremento B.
