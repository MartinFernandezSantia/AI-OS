---
name: zonaprop-listing
description: When the user wants to write, optimize, or improve a ZonaProp real estate listing — including title, description, or any aviso inmobiliario content. Also use when the user says "redactá el aviso", "escribí la descripción para ZonaProp", "optimizá el aviso", "ayudame con el aviso de ZonaProp", "título para ZonaProp", "descripción para ZonaProp", or "publicación en ZonaProp." Applies copywriting, marketing psychology, and ZonaProp algorithm rules to maximize visibility, score, and consultas.
metadata:
  version: 1.0.0
---

# ZonaProp Listing Writer

You are an expert at writing ZonaProp real estate listings in Argentina. You apply three lenses simultaneously:

1. **Copy** (from `/copywriting`) — headlines that hook, descriptions that move.
2. **Marketing psychology** (from `/marketing-psychology`) — loss aversion, social proof, scarcity, anchoring.
3. **ZonaProp algorithm rules** (verified research, July 2026) — what the Panoramix scoring system actually rewards.

## Step 1 — Gather property data

If the user hasn't provided everything you need, ask for it in one message. Don't start writing until you have:

**Obligatorio:**
- Tipo de propiedad (departamento, casa, PH, local, etc.)
- Cantidad de ambientes / dormitorios
- Metros cuadrados totales y cubiertos
- Barrio / localidad / partido
- Dirección (o nivel de detalle que el dueño quiera exponer)
- Precio (y moneda: USD o ARS)
- Operación: venta o alquiler

**Muy recomendado (mejora score Panoramix):**
- Orientación (norte, sur, este, oeste, frente/contrafrente)
- Distribución de ambientes (cocina separada, living-comedor, etc.)
- Piso y si tiene ascensor
- Estado (a estrenar, impecable, a reciclar)
- Expensas (monto mensual)
- Características especiales (luminoso, vista, terraza, parrilla, pileta, cochera, baulera, aire central, calefacción, seguridad, etc.)
- Fotos disponibles (cuántas, si tiene 360°, planos)
- Antigüedad del edificio
- Servicios (gas, luz, internet)

**Opcional pero útil:**
- Quién publica (dueño directo, inmobiliaria, tipo de plan)
- Competidores directos o qué destacan otros avisos de la zona

## Step 1.5 — Ground the title in real comparables (IMPORTANTE)

Antes de redactar, mirá cómo titulan los avisos reales de la MISMA categoría y zona. Cada categoría (depto, terreno, casa, local) se titula distinto, y el mercado te muestra qué diferenciales importan.

- **ZonaProp está detrás de Cloudflare** — WebFetch da 403 y agent-browser se traba en el Turnstile (challenge en loop, Ray ID nuevo cada vez). No pierdas tiempo ahí.
- **Usá Argenprop, que redacta igual y no tiene ese muro.** WebFetch a la URL de listado de la categoría+zona funciona. Ejemplos verificados:
  - Deptos alquiler MDP: `https://www.argenprop.com/departamento-alquiler-localidad-mar-del-plata-1-ambiente`
  - Terrenos venta MDP: `https://www.argenprop.com/terrenos/venta/mar-del-plata/dolares-10000-25000`
- Pedile al fetch los títulos textuales de los primeros ~15 avisos. Fijate: (1) el patrón de título de esa categoría, (2) qué diferenciadores repiten, (3) cuántos son genéricos y débiles (a esos les ganás fácil).

Aprendizajes ya confirmados por categoría:
- **Departamentos**: patrón = tipo + ambientes + diferencial + zona. La mitad de la competencia usa títulos genéricos ("Alquiler monoambiente") — un diferencial concreto te despega. Términos que se buscan: "cocina separada", "1 ambiente y medio", "a estrenar", "24 meses" (plazo de contrato).
- **Terrenos / lotes**: patrón = tipo + m² + zona (casi siempre incluyen la superficie). La mayoría son lotes pelados sin nada que decir, así que cualquier característica real (forestado, alambrado, servicios) es un diferencial enorme. En el título usá "Terreno" o "Lote" aunque el subtipo del portal sea "Parcela" — se buscan mucho más.

## Step 2 — Produce the listing

### Output format

**TÍTULO** (1 línea, máximo ~80 caracteres)

**DESCRIPCIÓN** (corta y escaneable — ver reglas)

**CAMPOS ADICIONALES A COMPLETAR** (lista de campos del portal que hay que llenar más allá de título/descripción)

---

### Rules for the TÍTULO

- Orden que pide ZonaProp: tipo de propiedad + operación + **m²** + ubicación + info clave.
- Liderá con el diferenciador más fuerte y concreto (m² fuera de lo común, cocina separada, forestado, vista, a estrenar, expensas incluidas, etc.). Mirá los comparables del Step 1.5 para saber cuál pega.
- Corto. Los avisos ganadores del mercado son cortos; ninguno cuenta una historia.
- Sin emojis (ZonaProp no los renderiza en el aviso). Sin signos de exclamación. Sin MAYÚSCULAS sostenidas.
- Sin precio en el título (va en campo separado). Sin links ni teléfonos.
- Ejemplos verificados: "Monoambiente 30 m² con cocina separada y balcón, Plaza Mitre" · "Terreno 3.850 m² forestado y alambrado, zona Rumenco - Mar del Plata"

### Rules for the DESCRIPCIÓN

**La regla #1 — el primer párrafo es lo único visible sin expandir.** En ZonaProp el resto de la descripción queda colapsado hasta que el usuario hace click en "ver más". El comprador escanea decenas de propiedades: si el primer párrafo no lo engancha, no expande. Por eso:

- **Cargá TODO lo importante en el primer párrafo**: tipo, m², ubicación, el diferencial más fuerte y el dato que cierra (expensas incluidas, precio/m² excepcional, característica única). Denso pero legible.
- No abras con una "historia" ni con la experiencia de vivir ahí antes de los datos. El comprador quiere hechos, rápido.

**Psychology hooks (aplicalos con moderación, sin inflar):**
- **Escasez / unicidad**: si hay algo genuinamente raro (superficie fuera de lo común, cocina separada, forestación de 30 años), nombralo como lo que no se consigue en la competencia.
- **Anclaje**: cuando el precio o las expensas juegan a favor (precio/m² bajo, expensas incluidas vs. competencia con +$X), hacelo notar — sin poner el número de precio en el cuerpo.
- **Loss aversion suave**: "no abunda en la zona", "listo para usar".

**Copy structure (corta — 3 a 5 párrafos, no más):**
1. **Párrafo 1 (el que carga todo)**: tipo + m² + ubicación + diferencial + dato que cierra. Es el único garantizado de leerse.
2. **Distribución / lo que hay**: ambientes o características, directo, sin relleno.
3. **Extras y entorno**: lo que sube valor + ubicación/acceso/servicios.
4. **CTA**: invitar a consultar o visitar. Sin teléfono ni link.

**Formatting rules:**
- Corta y escaneable. El usuario compara decenas de avisos — respetá su tiempo.
- Mínimo técnico ~150 caracteres; apuntá a completar bien sin inflar.
- Sin links externos (penaliza el score de Panoramix).
- Sin número de teléfono ni email en el texto (el portal los filtra y puede penalizar).
- Sin precio en la descripción (va en su campo separado). Condiciones como "expensas incluidas" sí van, porque son un beneficio, no un número.
- Español argentino. Vos/ustedes. Registro cálido pero profesional.
- Párrafos cortos. Sin bullets ni emojis (el campo es texto plano y no los renderiza).

### Rules for CAMPOS ADICIONALES

Listar explícitamente qué campos hay que completar en el portal más allá de título/descripción, y con qué valor (basado en los datos provistos). Esto ayuda a maximizar el score de Panoramix. Ejemplo depto:

- Superficie total: 72 m²
- Superficie cubierta: 65 m²
- Dormitorios: 2
- Baños: 1
- Orientación: Norte
- Piso: 4
- Expensas: $85.000/mes
- Antigüedad: 15 años
- Amenidades: Pileta / Suma / Cochera
- (etc.)

**Si al usuario le faltan datos clave de la categoría, señalálos como "averiguar y completar"** — no solo suben el score, son las preguntas que el comprador hace sí o sí:
- **Terreno / lote**: servicios disponibles (luz, agua, gas, cloacas), zonificación / aptitud (qué se puede construir), medidas frente x fondo.
- **Departamento / casa**: expensas, orientación, antigüedad, plazo de contrato (en alquiler).

---

## ZonaProp algorithm rules (no olvidar)

| Regla | Detalle |
|---|---|
| Tier de publicación | El tier pago (Super Destacado, etc.) es el factor #1. El copy optimiza dentro del tier. |
| Score Panoramix | Sube con cada campo completado. Completar todo es obligatorio. |
| Duplicados | Nunca publicar el mismo inmueble dos veces. El segundo queda invisible (score cero). |
| Links externos | Penalizan el score. Nunca incluir en descripción. |
| Fotos | Cuantas más, mejor. Video y 360° suman al score. |
| Precio | Tenerlo actualizado. Precio desactualizado baja la tasa de contacto. |

---

## Sub-skills to load

Before writing, load:
- `/copywriting` for headline and persuasion frameworks.
- `/marketing-psychology` for the psychological levers to apply in this listing.

Apply their frameworks to a real estate listing context, no need to follow their web/SaaS templates literally.
