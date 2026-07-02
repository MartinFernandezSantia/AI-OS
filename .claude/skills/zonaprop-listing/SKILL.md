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

## Step 2 — Produce the listing

### Output format

**TÍTULO** (1 línea, máximo ~80 caracteres)

**DESCRIPCIÓN** (mínimo 400 palabras, máximo ~1.000)

**CAMPOS ADICIONALES A COMPLETAR** (lista de campos del portal que hay que llenar más allá de título/descripción)

---

### Rules for the TÍTULO

- Incluye: tipo + ambientes + barrio, en ese orden.
- Suma el diferenciador más fuerte (luminoso, vista, terraza, a estrenar, cochera, etc.).
- Sin emojis. Sin signos de exclamación. Sin mayúsculas innecesarias.
- Sin precio en el título (va en campo separado del portal).
- Sin links, sin números de teléfono.
- Ejemplo: "Departamento 3 ambientes con terraza en Palermo Hollywood"

### Rules for the DESCRIPCIÓN

**Psychology hooks to apply:**
- **Loss aversion**: redactar desde lo que el comprador/inquilino podría perder si no lo toma, no solo desde características.
- **Escasez / unicidad**: si hay algo genuinamente único (orientación, piso alto, último disponible), decirlo explícitamente.
- **Social proof implícita**: referencias a la zona, el barrio, el estilo de vida.
- **Anclaje**: mencionar el precio o las expensas en relación favorable cuando aplique.
- **Visualización**: que el lector se imagine viviendo ahí. Describir la luz, los usos de los espacios, la dinámica del día a día.

**Copy structure:**
1. **Párrafo de apertura (gancho)**: 2-3 oraciones que describan la experiencia de vivir ahí, no las especificaciones. Que enganche.
2. **Distribución y espacios**: describir el recorrido por la propiedad, ambiente por ambiente, con detalle.
3. **Diferenciales y extras**: todo lo que sube el valor percibido (luminosidad, vistas, amenidades, cochera, baulera, etc.).
4. **Ubicación y entorno**: barrio, accesibilidad, comercios, transporte, parques.
5. **Call to action**: invitar al contacto o visita. Sin teléfono ni link.

**Formatting rules:**
- Mínimo 400 caracteres. Apuntar a 600-900 para máxima completitud.
- Sin links externos (penaliza el score de Panoramix).
- Sin número de teléfono ni email en el texto (el portal los filtra y puede penalizar).
- Sin precio en la descripción (va en su campo separado).
- Español argentino. Vos/ustedes. Registro cálido pero profesional.
- Párrafos cortos. Sin bullets en la descripción del portal (el campo es texto plano).

### Rules for CAMPOS ADICIONALES

Listar explícitamente qué campos hay que completar en el portal más allá de título/descripción, y con qué valor (basado en los datos provistos). Esto ayuda a maximizar el score de Panoramix. Ejemplo:

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
