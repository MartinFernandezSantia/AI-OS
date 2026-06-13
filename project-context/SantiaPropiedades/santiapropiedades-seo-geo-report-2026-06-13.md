# Reporte SEO/GEO — Santia Propiedades (Mar del Plata)

**Sitio auditado:** https://santiapropiedades.com.ar (resuelve a `https://www.santiapropiedades.com.ar`)
**Stack detectado:** Next.js (App Router) — se ve por rutas `/_next/image`, `opengraph-image` generada y metadata vía `generateMetadata`.
**Fecha de auditoría:** Junio 2026
**Objetivo comercial primario:** captar PROPIETARIOS (tasaciones / dejar propiedad en cartera). Secundario: captar demanda (compradores/inquilinos).
**Alcance comercial:** Mar del Plata ciudad (todos los barrios). Oficina física en Nueva Pompeya.
**Excluido por pedido:** alquiler temporario/turístico.

---

## Cómo leer este reporte

Este documento tiene doble función:

1. **Diagnóstico estratégico** (legible por una persona): qué está bien, qué falta y por qué importa para el negocio.
2. **Instrucciones machine-actionable** (para una sesión posterior de Claude Code sobre el repo Next.js): cada hallazgo técnico trae `Página/Ruta`, `Problema`, `Acción concreta` (con el markup/código/texto exacto), `Severidad` y `Done cuando…`.

> Convención para Claude Code: el sitio es Next.js. Las páginas viven presumiblemente en `app/<ruta>/page.tsx`. La metadata se setea con `export const metadata` o `export async function generateMetadata()`. El JSON-LD se inyecta con un `<script type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify(data)}} />` dentro del componente de página. **Verificar la estructura real del repo antes de aplicar** — las rutas exactas son [no verificable] desde fuera.

---

## Inventario de páginas encontradas (navegación real)

| Ruta | Tipo | Title actual | Meta description única | Render |
|---|---|---|---|---|
| `/` | Home | "Santia Propiedades — Compra, venta y alquiler en Mar del Plata" | Sí | SSR (contenido visible) |
| `/ventas` | Servicio | "Venta de propiedades en Mar del Plata \| Santia Propiedades" | Sí | SSR |
| `/alquileres` | Servicio | (verificar) | (verificar) | SSR |
| `/tasaciones` | Servicio | "Tasaciones en Mar del Plata \| Santia Propiedades" | Sí | SSR |
| `/administracion` | Servicio | (verificar) | (verificar) | SSR |
| `/nosotros` | Institucional | "Nosotros \| Santia Propiedades" | Sí | SSR |
| `/contacto` | Conversión | "Contacto \| Santia Propiedades" | Sí | SSR |
| `/propiedades` | Listado | "Propiedades en Mar del Plata \| Santia Propiedades" | Sí | **CSR — renderiza "Cargando propiedades…"** |
| `/propiedades/[id]` | Ficha | **Sin `<title>` ni meta propios** | **NO** | Parcial — el `<head>` no trae metadata SEO |

Martillero a cargo identificado: **Daniel Fernández Santia** — Martillero y Corredor Público, REG N° 2891, Colegio de Martilleros y Corredores Públicos de MDP. Este dato es oro para E-E-A-T y schema; hoy está infrautilizado.

---

# 1. Auditoría técnica SEO/GEO (machine-actionable)

## Resumen de severidad

| # | Hallazgo | Severidad |
|---|---|---|
| 1.1 | Fichas de propiedad sin title ni meta description (metadata SEO ausente en `[id]`) | **Crítico** |
| 1.2 | Listado `/propiedades` es client-side: Google ve "Cargando propiedades…" | **Crítico** |
| 1.3 | Sin JSON-LD en todo el sitio (RealEstateAgent, Product/Offer, FAQ, Breadcrumb) | **Crítico** |
| 1.4 | robots.txt y sitemap.xml [no verificable] desde fuera — confirmar que existan y listen fichas | **Alto** |
| 1.5 | `og:title` / `og:description` idénticos en todas las páginas (no reflejan la página) | **Alto** |
| 1.6 | Imágenes de ficha de propiedad sin `alt` | **Alto** |
| 1.7 | `meta-keywords` genéricas y repetidas en todo el sitio (ruido, sin valor) | **Bajo** |
| 1.8 | Falta página/sección de captación dedicada ("Vendé con nosotros" / "Tasación gratuita") con su propio target | **Alto** (SEO + negocio) |
| 1.9 | NAP no marcado con datos estructurados; reseñas Google ("4,9★") no estructuradas | **Medio** |
| 1.10 | Sin breadcrumbs visibles ni schema en fichas | **Medio** |
| 1.11 | `og:image` de la home declara width=110 / height=44 (imagen rota o mal dimensionada) | **Medio** |
| 1.12 | FAQ de la home no marcada como FAQPage | **Medio** |
| 1.13 | Posible thin content en páginas de servicio (texto duplicado dos veces en el DOM) | **Bajo** |

---

## Capa técnica — bloques accionables

### 1.1 — Fichas de propiedad sin metadata SEO `[CRÍTICO]`

**Página/Ruta:** `/propiedades/[id]` (ej. `/propiedades/c1e9fbf8-4cdb-4ce4-9dec-4fcf1d09bdba`)
**Problema:** El `<head>` de la ficha solo trae `viewport`. No hay `<title>`, ni `meta description`, ni canonical, ni Open Graph propios. El título de la propiedad aparece solo como texto en el body. Esto es lo más grave del sitio: las fichas son las URLs con intención transaccional más alta y hoy son casi invisibles para buscadores y para compartir en redes/WhatsApp.

**Acción concreta:** Implementar `generateMetadata` dinámico en la ruta de ficha, alimentado por los datos de la propiedad (que ya existen: título, operación, barrio, precio, ambientes, m², primera imagen). Patrón:

```tsx
// app/propiedades/[id]/page.tsx
export async function generateMetadata({ params }): Promise<Metadata> {
  const p = await getPropiedad(params.id); // ya existe la fuente de datos
  const titulo = `${p.titulo} — ${p.operacion === 'venta' ? 'Venta' : 'Alquiler'} en ${p.barrio}, Mar del Plata`;
  const desc = `${p.tipo} de ${p.ambientes} amb. y ${p.m2} m² en ${p.barrio}, Mar del Plata. ${p.operacion === 'venta' ? 'En venta' : 'En alquiler'} ${p.precioFormateado}. Consultá con martillero matriculado.`;
  return {
    title: `${titulo} | Santia Propiedades`,
    description: desc.slice(0, 160),
    alternates: { canonical: `https://santiapropiedades.com.ar/propiedades/${p.id}` },
    openGraph: {
      title: titulo,
      description: desc.slice(0, 200),
      url: `https://santiapropiedades.com.ar/propiedades/${p.id}`,
      images: [{ url: p.imagenes[0], width: 1200, height: 630, alt: p.titulo }],
      type: 'website',
      locale: 'es_AR',
    },
    twitter: { card: 'summary_large_image', title: titulo, description: desc.slice(0,200), images: [p.imagenes[0]] },
  };
}
```

**Done cuando…** cada ficha tiene `<title>` único < 60 chars con tipo+operación+barrio+MDP, `meta description` única de 150–160 chars, canonical absoluto a sí misma, y `og:image` = primera foto real de la propiedad (1200×630). Verificable con `view-source:` o Rich Results Test en 3 fichas distintas.

---

### 1.2 — Listado `/propiedades` renderiza client-side `[CRÍTICO]`

**Página/Ruta:** `/propiedades` (y sus filtros `?op=venta`, `?op=alquiler`)
**Problema:** Al fetchear la URL, el HTML servido muestra **"Cargando propiedades…"** y ninguna propiedad. El listado se hidrata con JS en el cliente. Googlebot puede renderizar JS pero lo hace en una segunda pasada, con retraso e inconsistencia; el resto de crawlers (incluidos los de motores de IA) y el preview social ven una página vacía. Esto degrada la indexación de fichas (dependen del listado como hub de enlaces internos) y la página categoría no rankea.

**Acción concreta:**
1. Convertir el listado a Server Component con fetch de datos en servidor (RSC) o usar `generateStaticParams` + ISR para que el HTML inicial ya traiga las tarjetas de propiedad con sus `<a href="/propiedades/[id]">`.
2. Garantizar que cada tarjeta renderice un enlace `<a>` real en el HTML servido (no un `onClick` JS), para que las fichas reciban enlaces internos crawleables.
3. Mantener los filtros como mejora progresiva sobre el listado ya renderizado.

**Done cuando…** `view-source:` de `/propiedades` muestra las tarjetas con sus enlaces `/propiedades/<id>` en el HTML inicial (sin ejecutar JS), y no aparece "Cargando propiedades…" como único contenido.

---

### 1.3 — Sin datos estructurados (JSON-LD) en el sitio `[CRÍTICO para GEO, Alto para SEO]`

**Problema:** No se detecta ningún bloque `application/ld+json`. Para inmobiliaria esto deja sobre la mesa: rich results de propiedades, panel de negocio local, y —clave para el objetivo— **citabilidad en motores de IA**, que se apoyan fuertemente en datos estructurados y NAP consistente.

**Acción concreta A — `RealEstateAgent` en todas las páginas (layout):** Inyectar en `app/layout.tsx` un bloque global:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "RealEstateAgent",
  "name": "Santia Propiedades",
  "image": "https://santiapropiedades.com.ar/opengraph-image.jpg",
  "url": "https://santiapropiedades.com.ar",
  "telephone": "+542236846129",
  "email": "santiapropiedades@gmail.com",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Av. Libertad 3898",
    "addressLocality": "Mar del Plata",
    "addressRegion": "Buenos Aires",
    "addressCountry": "AR"
  },
  "areaServed": { "@type": "City", "name": "Mar del Plata" },
  "founder": { "@type": "Person", "name": "Daniel Fernández Santia", "jobTitle": "Martillero y Corredor Público (REG N° 2891)" },
  "employee": { "@type": "Person", "name": "Daniel Fernández Santia", "jobTitle": "Martillero y Corredor Público" },
  "openingHoursSpecification": [{
    "@type": "OpeningHoursSpecification",
    "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"],
    "opens": "10:00", "closes": "15:00"
  }],
  "sameAs": [
    "https://instagram.com/santiapropiedades_",
    "https://facebook.com/santiapropiedades1"
  ],
  "knowsAbout": ["tasación de propiedades","venta de inmuebles","alquiler de viviendas","administración de alquileres","tasaciones judiciales"]
}
</script>
```

> Nota sobre `aggregateRating`: la home declara "4,9★ en Google Reviews". Solo agregar `aggregateRating` al schema si ese rating es real, verificable y proviene de reseñas en la propia ficha de Google Business. Si no se puede sostener con datos reales, **omitir** (Google penaliza ratings inventados o auto-declarados sin fuente). Marcar como `[no verificable]` hasta confirmar conteo de reseñas.

**Acción concreta B — `Product` + `Offer` en cada ficha:** En `/propiedades/[id]`:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Chalet 3 Amb a Estrenar | Patio + Terraza Privada con Quincho | Reciclado",
  "description": "PH tipo casa, 3 ambientes, 79 m², reciclado a estrenar en Nueva Pompeya, Mar del Plata.",
  "image": ["<URL primera foto>"],
  "category": "Chalet / PH",
  "offers": {
    "@type": "Offer",
    "price": "113500",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock",
    "url": "https://santiapropiedades.com.ar/propiedades/<id>",
    "seller": { "@type": "RealEstateAgent", "name": "Santia Propiedades" }
  }
}
```

(Generar dinámicamente desde los datos de la propiedad; `price` sin separadores de miles, `priceCurrency` desde la moneda real.)

**Acción concreta C — `FAQPage` en la home** (ver 1.12) y **`BreadcrumbList`** en fichas (ver 1.10).

**Done cuando…** Rich Results Test valida sin errores: `RealEstateAgent` en home, `Product`+`Offer` en 3 fichas, `FAQPage` en home. Cero warnings de propiedades requeridas faltantes.

---

### 1.4 — robots.txt y sitemap.xml `[ALTO]`

**Página/Ruta:** `/robots.txt`, `/sitemap.xml`
**Problema:** **[no verificable]** desde la auditoría externa (no se pudieron recuperar directamente). Hay que confirmar que existan, que el sitemap liste TODAS las fichas de propiedad (no solo las páginas estáticas), y que robots no bloquee `/propiedades`.

**Acción concreta:**
1. Crear/confirmar `app/sitemap.ts` (Next.js genera `/sitemap.xml`): debe enumerar páginas estáticas **y** mapear dinámicamente todas las propiedades activas a `/propiedades/<id>` con `lastModified`.

```ts
// app/sitemap.ts
export default async function sitemap() {
  const base = 'https://santiapropiedades.com.ar';
  const estaticas = ['', '/ventas', '/alquileres', '/tasaciones', '/administracion', '/propiedades', '/nosotros', '/contacto']
    .map((p) => ({ url: `${base}${p}`, lastModified: new Date() }));
  const props = await getPropiedadesActivas();
  const fichas = props.map((p) => ({ url: `${base}/propiedades/${p.id}`, lastModified: p.updatedAt }));
  return [...estaticas, ...fichas];
}
```

2. Crear/confirmar `app/robots.ts`:

```ts
// app/robots.ts
export default function robots() {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/'] },
    sitemap: 'https://santiapropiedades.com.ar/sitemap.xml',
  };
}
```

**Done cuando…** `/robots.txt` responde 200, permite `/propiedades` y referencia el sitemap; `/sitemap.xml` responde 200 e incluye al menos todas las fichas activas. Enviado en Google Search Console sin errores.

---

### 1.5 — Open Graph genérico en todo el sitio `[ALTO]`

**Página/Ruta:** todas (`/ventas`, `/tasaciones`, `/nosotros`, `/contacto`, `/propiedades`, home)
**Problema:** `og:title` = "Santia Propiedades — Mar del Plata" y `og:description` = "Más de 20 años acompañando operaciones inmobiliarias en Mar del Plata. Tasaciones profesionales." son idénticos en todas las páginas, aunque el `<title>` sí varía. Al compartir cualquier URL por WhatsApp (canal central de este negocio), el preview es siempre el mismo y no refleja la página.

**Acción concreta:** En cada `generateMetadata`/`metadata`, derivar `openGraph.title` del title de la página y `openGraph.description` de su meta description (no del texto global). Para fichas, ya cubierto en 1.1.

**Done cuando…** compartir `/tasaciones` y `/ventas` por WhatsApp muestra previews distintos y específicos de cada página.

---

### 1.6 — Imágenes de ficha sin `alt` `[ALTO]`

**Página/Ruta:** `/propiedades/[id]` (galería de hasta 15 imágenes por ficha)
**Problema:** Las `<img>` de la galería no tienen `alt` descriptivo. Pierden tráfico de Google Imágenes (relevante en real estate) y accesibilidad.

**Acción concreta:** Generar `alt` dinámico por imagen:
`alt={`${p.titulo} — ${p.barrio}, Mar del Plata — foto ${i+1} de ${p.imagenes.length}`}`
Las imágenes del hero/servicios que hoy salen sin alt (ej. `house2.webp`, `house3.webp` en `/ventas`) deben recibir alt descriptivo o `alt=""` si son puramente decorativas.

**Done cuando…** toda `<img>` de contenido en fichas tiene `alt` no vacío y descriptivo; las decorativas tienen `alt=""` explícito. Cero imágenes sin atributo `alt`.

---

### 1.7 — `meta-keywords` genéricas y repetidas `[BAJO]`

**Página/Ruta:** todas
**Problema:** Todas las páginas comparten `meta-keywords: inmobiliaria Mar del Plata,propiedades MDP,...`. Google ignora `meta keywords` hace años; no daña pero es ruido y señal de plantilla.

**Acción concreta:** Eliminar `keywords` de la metadata global, o dejarla vacía. No invertir tiempo en "mejorarla".

**Done cuando…** las páginas ya no emiten `<meta name="keywords">` repetida, o el equipo confirma que la deja como no-op.

---

### 1.8 — Falta landing de captación dedicada `[ALTO — SEO + negocio]`

**Página/Ruta:** no existe hoy una URL propia para "tasación gratuita" ni "vender/alquilar con nosotros" — `/tasaciones` mezcla particulares + judiciales y los CTA de captación de la home apuntan a `/contacto?tipo=...`.
**Problema:** El objetivo #1 (captar propietarios) no tiene páginas de aterrizaje optimizadas por intención. Hoy "tasación gratuita Mar del Plata" o "cuánto vale mi departamento" no tienen dónde rankear.

**Acción concreta:** Crear las páginas del backlog (sección 3): `/tasaciones/gratis-online` (o `/cuanto-vale-mi-propiedad`) y `/vender-mi-propiedad`. Cada una con su `generateMetadata`, H1 con la keyword, formulario de captación, FAQ propia y JSON-LD FAQ. (Detalle on-page en sección 3.)

**Done cuando…** existen las rutas, responden 200, tienen metadata única y están enlazadas desde home + footer.

---

### 1.9 — NAP y reseñas no estructuradas `[MEDIO]`

**Página/Ruta:** footer global + `/contacto` + `/nosotros`
**Problema:** El NAP (Nombre, Dirección, Teléfono) aparece como texto, no marcado. Hay inconsistencia menor de formato de teléfono: header `(0223) 684-6129`, footer `(0223) 684 6129`, `tel:+5402236846129`, WhatsApp `5492236846129`. La consistencia NAP es un factor central para local SEO y para que los motores de IA citen el negocio con datos correctos.

**Acción concreta:**
1. Unificar el teléfono mostrado a un único formato visible en todo el sitio: **(0223) 684-6129**, y el `tel:` a `tel:+542236846129` (sin el `0` extra; `+54 02236846129` es incorrecto — debe ser `+54 223 684 6129`). **Corregir `tel:+5402236846129` → `tel:+542236846129`.**
2. El NAP queda cubierto por el schema `RealEstateAgent` (1.3 A).
3. Asegurar que la dirección, teléfono y horario en el sitio coincidan **exactamente** con la ficha de Google Business Profile.

**Done cuando…** el teléfono se muestra idéntico en header/footer/contacto, el `tel:` es `+542236846129`, y NAP del sitio == NAP de Google Business == NAP del schema.

---

### 1.10 — Sin breadcrumbs ni su schema `[MEDIO]`

**Página/Ruta:** `/propiedades/[id]`
**Problema:** No hay migas de pan visibles ni `BreadcrumbList`. Ayudan a Google a entender jerarquía y mejoran el snippet.

**Acción concreta:** Agregar breadcrumb visible `Inicio › Propiedades › <título>` con su JSON-LD:

```html
<script type="application/ld+json">
{ "@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
 {"@type":"ListItem","position":1,"name":"Inicio","item":"https://santiapropiedades.com.ar"},
 {"@type":"ListItem","position":2,"name":"Propiedades","item":"https://santiapropiedades.com.ar/propiedades"},
 {"@type":"ListItem","position":3,"name":"<título propiedad>","item":"https://santiapropiedades.com.ar/propiedades/<id>"}
]}
</script>
```

**Done cuando…** las fichas muestran breadcrumb y el Rich Results Test valida `BreadcrumbList`.

---

### 1.11 — `og:image` de la home mal dimensionada `[MEDIO]`

**Página/Ruta:** `/`
**Problema:** La home declara `og:image:width: 110` y `og:image:height: 44` (parece el logo, no una imagen social 1200×630). El resto de páginas sí declaran 1200×630. Preview social pobre al compartir la home.

**Acción concreta:** Unificar `opengraph-image` de la home a 1200×630 (usar `app/opengraph-image.tsx` o un asset estático correcto). Verificar que `og:image:width/height` reflejen el tamaño real.

**Done cuando…** la home declara `og:image` 1200×630 y el preview en WhatsApp/Facebook se ve completo.

---

### 1.12 — FAQ de la home sin `FAQPage` `[MEDIO]`

**Página/Ruta:** `/` (sección "Preguntas frecuentes": comisión, proceso de tasación, documentación para vender, garantías, zonas, tiempo de venta)
**Problema:** Excelente contenido de captación (responde dudas reales de propietarios) pero sin marcado FAQ. Se pierde el rich snippet y, sobre todo, **citabilidad en IA** (estas preguntas son exactamente las que un propietario le hace a ChatGPT).

**Acción concreta:** Agregar `FAQPage` JSON-LD con las 6 preguntas y sus respuestas reales (texto que ya está en la página):

```html
<script type="application/ld+json">
{ "@context":"https://schema.org","@type":"FAQPage","mainEntity":[
 {"@type":"Question","name":"¿Cuánto cobran de comisión?","acceptedAnswer":{"@type":"Answer","text":"<respuesta real de la página>"}},
 {"@type":"Question","name":"¿Cómo es el proceso de tasación?","acceptedAnswer":{"@type":"Answer","text":"<...>"}}
 /* ...las 6... */
]}
</script>
```

**Done cuando…** el `FAQPage` valida en Rich Results Test con las 6 Q&A y los textos coinciden con lo visible en pantalla.

---

### 1.13 — Texto duplicado en el DOM de páginas de servicio `[BAJO]`

**Página/Ruta:** `/ventas`, `/tasaciones`, `/administracion`, `/alquileres`
**Problema:** El cuerpo de cada bloque aparece repetido dos veces en el HTML (probablemente versión desktop/mobile renderizadas ambas). No es duplicado entre URLs, pero infla el DOM y puede confundir el peso semántico.

**Acción concreta:** Revisar que no se rendericen dos copias del mismo párrafo; usar CSS responsive sobre un único bloque en vez de duplicar el contenido en el markup.

**Done cuando…** cada párrafo de servicio aparece una sola vez en el HTML servido.

---

## Capa GEO — Citabilidad en motores de IA (ChatGPT / Claude / Gemini / Perplexity)

**Consulta de prueba representativa del objetivo:** *"¿qué inmobiliaria me conviene para vender mi propiedad en Mar del Plata?"* / *"¿quién hace tasaciones en Mar del Plata?"*

**Estado actual:** baja citabilidad. Los motores de IA citan negocios cuando encuentran (a) NAP consistente y estructurado, (b) datos verificables (matrícula, dirección, años, especialidades), (c) contenido en formato pregunta-respuesta que responde literalmente la consulta, y (d) presencia coherente fuera del sitio (Google Business, directorios). Hoy el sitio no tiene JSON-LD, la FAQ no está marcada, y el diferencial fuerte (martillero matriculado Daniel Fernández Santia, REG N° 2891, 20+ años, trato directo) está en prosa pero no estructurado ni reforzado en contenido orientado a captación.

**Acciones GEO concretas (todas se apoyan en ítems técnicos de arriba):**

1. **NAP consistente y estructurado** — 1.3.A (`RealEstateAgent`) + 1.9 (unificar teléfono). Es el cimiento de toda cita de IA.
2. **Marcar la FAQ como `FAQPage`** — 1.12. Convierte respuestas en unidades citables. Ampliar a preguntas de captación de propietario: *"¿Cuánto vale mi departamento en Mar del Plata?"*, *"¿Conviene vender con inmobiliaria o por mi cuenta?"*, *"¿Qué comisión cobra una inmobiliaria en Mar del Plata?"*, *"¿Cómo elegir un martillero matriculado?"*.
3. **Página "Sobre Daniel Fernández Santia / Nuestra matrícula"** con datos verificables (matrícula, colegio, años, especialidades, zona) — refuerza E-E-A-T y da a la IA una entidad-persona citable. Agregar schema `Person` enlazado al `RealEstateAgent`.
4. **Contenido de respuesta directa** (sección 3, cluster A): páginas que respondan textualmente "cuánto vale mi propiedad", "vender en Mar del Plata paso a paso", "comisión inmobiliaria MDP". Las IA citan el sitio que responde la pregunta de forma estructurada y autónoma.
5. **Coherencia off-site:** asegurar que Google Business Profile, Instagram (`@santiapropiedades_`) y Facebook repitan exactamente el mismo NAP y descripción. (Acción de marketing, fuera del repo, pero condiciona la citabilidad.)

**Done GEO cuando…** una consulta a un motor de IA del tipo "tasar/vender propiedad en Mar del Plata" puede recuperar nombre, matrícula, dirección y especialidad correctos del negocio desde datos estructurados y FAQ marcada.

---

# 2. Mapa de keywords clusterizado

Prioridad de clusters: **(A) Captación de propietarios** > (B) Venta (demanda) > (C) Alquiler tradicional (demanda).
Sesgo deliberado a **competencia media-baja y long-tails geográficas**. Se **excluye** "inmobiliaria Mar del Plata" a secas (alta competencia, marca dominada por grandes players) y **todo alquiler temporario/turístico**.

> Las dificultades son estimaciones cualitativas (alta/media/baja) basadas en intención y competencia local, no en datos de volumen de una herramienta. Recomendado validar con Keyword Planner / herramienta de volumen antes de redactar.

---

## CLUSTER A — Captación de propietarios `[MÁXIMA PRIORIDAD]`

### A1 · Tasación (intención comercial de captación)
**Página objetivo:** NUEVA `/tasaciones/gratis-online` (o `/cuanto-vale-mi-propiedad`) + optimizar `/tasaciones`

| Keyword | Intención | Dificultad | Página objetivo |
|---|---|---|---|
| cuánto vale mi departamento en Mar del Plata | comercial/captación | baja | nueva landing tasación |
| tasación gratis Mar del Plata | comercial | media | nueva landing tasación |
| tasación online propiedad Mar del Plata | comercial | baja | nueva landing tasación |
| cuánto vale mi casa Mar del Plata | comercial | baja | nueva landing tasación |
| tasar departamento Mar del Plata | comercial | media | `/tasaciones` |
| tasación inmueble Mar del Plata | comercial | media | `/tasaciones` |
| tasación judicial Mar del Plata | comercial | baja | `/tasaciones` (sección judiciales) |
| tasación para sucesión Mar del Plata | comercial | baja | `/tasaciones` (judiciales) |
| valor del m2 en [barrio] Mar del Plata | informacional→captación | baja | guía por barrio (estructural) |

### A2 · Vender con inmobiliaria (decisión de poner en cartera)
**Página objetivo:** NUEVA `/vender-mi-propiedad`

| Keyword | Intención | Dificultad | Página objetivo |
|---|---|---|---|
| vender mi casa en Mar del Plata | comercial/captación | media | `/vender-mi-propiedad` |
| vender departamento Mar del Plata | comercial | media | `/vender-mi-propiedad` |
| cómo vender mi propiedad en Mar del Plata | informacional→captación | baja | `/vender-mi-propiedad` + FAQ |
| inmobiliaria para vender mi propiedad Mar del Plata | comercial | media | `/vender-mi-propiedad` |
| conviene vender con inmobiliaria o solo | informacional | baja | blog/FAQ |
| martillero matriculado Mar del Plata | comercial/confianza | baja | `/nosotros` + `/vender-mi-propiedad` |
| vender PH Mar del Plata | comercial | baja | `/vender-mi-propiedad` |
| vender terreno Mar del Plata | comercial | baja | `/vender-mi-propiedad` |

### A3 · Comisiones y proceso (dudas que preceden la decisión)
**Página objetivo:** FAQ ampliada + artículos

| Keyword | Intención | Dificultad | Página objetivo |
|---|---|---|---|
| comisión inmobiliaria Mar del Plata | informacional | baja | FAQ home + artículo |
| cuánto cobra una inmobiliaria por vender | informacional | baja | FAQ/artículo |
| qué documentación necesito para vender una propiedad | informacional | baja | FAQ/artículo |
| cuánto tarda en venderse una propiedad en Mar del Plata | informacional | baja | FAQ/artículo |

### A4 · Poner en alquiler + administración (captación de propietario-rentista)
**Página objetivo:** NUEVA `/alquilar-mi-propiedad` + `/administracion`

| Keyword | Intención | Dificultad | Página objetivo |
|---|---|---|---|
| poner mi departamento en alquiler Mar del Plata | comercial/captación | baja | `/alquilar-mi-propiedad` |
| administración de alquileres Mar del Plata | comercial | media | `/administracion` |
| administración de consorcios Mar del Plata | comercial | media | `/administracion` |
| inmobiliaria que administre mi alquiler Mar del Plata | comercial | baja | `/administracion` |

---

## CLUSTER B — Venta (demanda / compradores)

### B1 · Venta por tipo + ciudad
**Página objetivo:** `/propiedades?op=venta` (categoría) — requiere arreglar render CSR (1.2)

| Keyword | Intención | Dificultad | Página objetivo |
|---|---|---|---|
| departamentos en venta Mar del Plata | transaccional | media | listado venta |
| casas en venta Mar del Plata | transaccional | media | listado venta |
| ph en venta Mar del Plata | transaccional | baja | listado venta |
| locales en venta Mar del Plata | transaccional | baja | listado venta |
| terrenos en venta Mar del Plata | transaccional | baja | listado venta |
| cocheras en venta Mar del Plata | transaccional | baja | listado venta |
| monoambiente en venta Mar del Plata | transaccional | media | listado venta |

### B2 · Venta long-tail por barrio (alta oportunidad, baja competencia)
**Página objetivo:** páginas/landings de barrio (estructural) o filtros indexables

| Keyword | Intención | Dificultad | Página objetivo |
|---|---|---|---|
| departamentos en venta Centro Mar del Plata | transaccional | baja | landing barrio Centro |
| departamentos en venta Güemes Mar del Plata | transaccional | baja | landing Güemes |
| casas en venta Los Troncos Mar del Plata | transaccional | baja | landing Los Troncos |
| departamentos en venta La Perla Mar del Plata | transaccional | baja | landing La Perla |
| departamentos en venta Playa Grande | transaccional | baja-media | landing Playa Grande |
| casas en venta Constitución Mar del Plata | transaccional | baja | landing Constitución |
| propiedades en venta Nueva Pompeya Mar del Plata | transaccional | baja | landing Nueva Pompeya (barrio sede) |

> Empezar por **Nueva Pompeya** (barrio de la oficina, ventaja de relevancia local real) y **Centro/Güemes** (volumen). Las demás según tengan stock real — no crear landings de barrio sin propiedades que las respalden.

---

## CLUSTER C — Alquiler tradicional (demanda / inquilinos)

> **Excluido:** todo alquiler temporario/turístico.

### C1 · Alquiler por tipo + ciudad
**Página objetivo:** `/propiedades?op=alquiler` (requiere arreglar 1.2)

| Keyword | Intención | Dificultad | Página objetivo |
|---|---|---|---|
| departamentos en alquiler Mar del Plata | transaccional | media | listado alquiler |
| casas en alquiler Mar del Plata | transaccional | media | listado alquiler |
| alquiler anual Mar del Plata | transaccional | baja | listado alquiler |
| ph en alquiler Mar del Plata | transaccional | baja | listado alquiler |
| locales en alquiler Mar del Plata | transaccional | baja | listado alquiler |
| monoambiente en alquiler Mar del Plata | transaccional | media | listado alquiler |

### C2 · Alquiler long-tail por barrio
| Keyword | Intención | Dificultad | Página objetivo |
|---|---|---|---|
| departamentos en alquiler Centro Mar del Plata | transaccional | baja | landing barrio |
| departamentos en alquiler Güemes | transaccional | baja | landing barrio |
| alquiler anual La Perla Mar del Plata | transaccional | baja | landing barrio |
| departamentos en alquiler Nueva Pompeya | transaccional | baja | landing barrio (sede) |

### C3 · Dudas de alquiler (informacional, captación secundaria)
| Keyword | Intención | Dificultad | Página objetivo |
|---|---|---|---|
| garantía propietaria o seguro de caución | informacional | baja | FAQ/artículo |
| qué necesito para alquilar en Mar del Plata | informacional | baja | FAQ/artículo |

---

# 3. Backlog priorizado de páginas internas

> Diagnóstico + plan. La **redacción final** de cada página es una sesión posterior; acá van URL, objetivo, cluster y on-page mínimo.

## Quick wins (1–2 semanas, alto impacto / bajo esfuerzo)

### QW1 · Optimizar `/tasaciones` (existente)
- **Objetivo:** capturar intención de tasación, primer paso de captación.
- **Cluster:** A1.
- **On-page mínimo:** H1 "Tasaciones inmobiliarias en Mar del Plata" (ya está) — reforzar con keyword secundaria; agregar bloque "¿Cuánto vale tu propiedad?" con CTA a formulario; FAQ de tasación marcada (`FAQPage`); JSON-LD `Service`. Enlace interno desde home y footer (ya existe).

### QW2 · Nueva `/vender-mi-propiedad`
- **Objetivo:** página de captación #1 para propietarios que evalúan vender.
- **Cluster:** A2 + A3.
- **On-page mínimo:** H1 con "Vender mi propiedad en Mar del Plata"; propuesta de valor (martillero matriculado, trato directo, 20+ años); pasos del proceso (reutilizar los 4 pasos de `/ventas`); bloque comisión/transparencia; FAQ propia marcada; formulario de captación + WhatsApp; metadata única; JSON-LD FAQ.

### QW3 · Nueva landing de tasación-lead `/cuanto-vale-mi-propiedad`
- **Objetivo:** rankear long-tails de altísima intención de captación y convertir.
- **Cluster:** A1.
- **On-page mínimo:** H1 "¿Cuánto vale mi propiedad en Mar del Plata?"; formulario corto (tipo, barrio, m², contacto); explicación de cómo se tasa; CTA WhatsApp; FAQ; metadata única; JSON-LD FAQ + Service.

### QW4 · Marcar FAQ de la home + ampliarla
- **Objetivo:** rich snippet + citabilidad IA, cubre A3.
- **Cluster:** A3.
- **On-page mínimo:** `FAQPage` JSON-LD (1.12) con las 6 actuales + sumar 3–4 de captación de propietario.

### QW5 · Arreglar metadata de fichas (técnico, ver 1.1)
- **Objetivo:** que las URLs transaccionales sean indexables y compartibles.
- **Cluster:** B1/C1 indirecto.
- **On-page mínimo:** `generateMetadata` dinámico + JSON-LD Product/Offer + alt en imágenes + breadcrumb.

## Estructural (mediano-largo plazo)

### ES1 · Arreglar render del listado `/propiedades` (técnico, ver 1.2)
- **Objetivo:** convertir el hub de fichas en indexable (server-render).
- **Cluster:** B1, C1.
- **On-page mínimo:** SSR/ISR con tarjetas y enlaces reales; H1 por operación; metadata diferenciada para `?op=venta` vs `?op=alquiler` (o rutas `/propiedades/venta` y `/propiedades/alquiler` con canonical propio).

### ES2 · Landings por barrio (venta y alquiler)
- **Objetivo:** dominar long-tails geográficas de baja competencia.
- **Cluster:** B2, C2.
- **On-page mínimo:** una ruta por barrio con stock real (ej. `/propiedades/nueva-pompeya`, `/propiedades/centro`, `/propiedades/guemes`); H1 "Propiedades en [barrio], Mar del Plata"; intro con contexto del barrio; listado filtrado server-rendered; metadata única; enlaces internos cruzados. **Crear solo barrios con inventario** para evitar thin/doorway pages.

### ES3 · `/alquilar-mi-propiedad` (captación rentista)
- **Objetivo:** captar propietarios que quieren poner en alquiler.
- **Cluster:** A4.
- **On-page mínimo:** H1 captación; proceso; garantías/caución; enlace a `/administracion`; FAQ; formulario.

### ES4 · Hub de contenido / blog de captación
- **Objetivo:** responder dudas pre-decisión y alimentar GEO.
- **Cluster:** A3 + informacionales de B/C.
- **On-page mínimo:** artículos tipo "Comisión inmobiliaria en Mar del Plata: cómo funciona", "Vender por tu cuenta vs con martillero matriculado", "Documentación para vender una propiedad", "Cuánto tarda una venta en MDP". Cada uno con `Article` schema, autor = Daniel Fernández Santia (E-E-A-T), e interlinking a `/vender-mi-propiedad` y `/tasaciones`.

### ES5 · Página de autoridad del martillero
- **Objetivo:** reforzar E-E-A-T y entidad-persona citable por IA.
- **Cluster:** A2 (confianza), GEO.
- **On-page mínimo:** ampliar `/nosotros` o crear `/martillero` con bio, matrícula REG N° 2891, colegio, especialidades, zona; schema `Person` enlazado a `RealEstateAgent`.

### Roadmap sugerido (orden de ejecución)

| Prioridad | Item | Tipo | Cluster | Esfuerzo |
|---|---|---|---|---|
| 1 | QW5 metadata fichas + Product schema | Técnico | B1/C1 | bajo |
| 2 | QW4 FAQ marcada + ampliada | Quick win | A3 | bajo |
| 3 | QW2 `/vender-mi-propiedad` | Quick win | A2/A3 | medio |
| 4 | QW3 `/cuanto-vale-mi-propiedad` | Quick win | A1 | medio |
| 5 | QW1 optimizar `/tasaciones` | Quick win | A1 | bajo |
| 6 | ES1 SSR listado | Estructural | B1/C1 | alto |
| 7 | ES2 landings por barrio | Estructural | B2/C2 | alto |
| 8 | ES5 página martillero + Person schema | Estructural | GEO | bajo |
| 9 | ES3 `/alquilar-mi-propiedad` | Estructural | A4 | medio |
| 10 | ES4 blog de captación | Estructural | A3 | alto |

---

# 4. Análisis psicológico del visitante (segmentado)

Evaluado sobre el sitio **actual navegado**. Dos perfiles, por separado.

## Perfil A — Propietario `[PRIORITARIO]`
*Quiere vender/alquilar su propiedad. Busca confianza INSTITUCIONAL: seriedad, buen precio, transparencia en comisiones, trayectoria, respaldo legal.*

**Tono y profesionalismo percibido:** Alto y bien calibrado. El sitio habla directo al propietario ("Ponemos tu propiedad a trabajar", "Vender con acompañamiento profesional", toggle "Soy propietario / Soy inquilino"). El énfasis en *martillero matriculado*, *trato directo con el martillero a cargo* y *20+ años* es exactamente el lenguaje que este perfil necesita. La página `/nosotros` nombrando a Daniel Fernández Santia y la matrícula REG N° 2891 es el activo de confianza más fuerte del sitio.

**Indicadores de confianza presentes:** matrícula y colegio profesional (con logo), 20+ años, "+500 operaciones cerradas", "4,9★ Google Reviews", dirección física, los 4 pasos del proceso de venta, FAQ sobre comisión y documentación. Para captación, esto es sólido.

**Indicadores de confianza ausentes / débiles:**
- **Sin prueba social concreta:** "+500 operaciones" y "4,9★" se afirman pero no se muestran (no hay testimonios reales, ni casos, ni reseñas embebidas con nombre). Para una decisión de alto valor, el propietario quiere ver *a quién ayudaron*.
- **Comisión no transparentada:** hay una FAQ "¿Cuánto cobran de comisión?" pero el diferencial de transparencia no está al frente. Este perfil teme la letra chica.
- **Sin foto/credibilidad de la persona:** se nombra al martillero pero la página institucional usa fotos de stock genéricas (casas tipo norteamericano que no son de Mar del Plata). Choca con el mensaje de cercanía y trato personal.
- **Ratings sin fuente verificable** [no verificable]: si "4,9★" no enlaza a la ficha de Google real, resta credibilidad en vez de sumarla.

**Densidad de información:** Adecuada para captación, quizá *justa de menos* en transparencia de proceso/comisión. No sobra. Falta una landing dedicada que consolide el caso "por qué dejar tu propiedad acá".

**Retención estimada:** Media-alta en home y `/ventas`/`/tasaciones`. Lo que haría irse al propietario: falta de testimonios reales y de números concretos de comisión; fotos de stock que rompen la sensación de "inmobiliaria de Mar del Plata, de barrio, con cara visible".

**Media/fotos:** Las fotos de servicios e institucional son **stock genérico no marplatense** (casas suburbanas tipo EE.UU./Canadá). Para este perfil, que valora arraigo local, conviene reemplazarlas por fotos reales de Mar del Plata, de la oficina, y del martillero.

## Perfil B — Comprador/Inquilino
*Busca propiedades. Confianza TRANSACCIONAL: fotos reales, precios claros, respuesta rápida, buena oferta.*

**Tono y profesionalismo percibido:** Correcto y claro. Buscador en home con tabs Comprar/Alquilar, "Respondemos en el día por WhatsApp", precios visibles en las tarjetas. La promesa de rapidez está bien comunicada.

**Indicadores de confianza presentes:** precios en USD claros, m²/ambientes/baños visibles, fichas con galería amplia (15 fotos en el ejemplo) y descripciones detalladas y bien escritas, WhatsApp omnipresente, características en lista.

**Indicadores de confianza ausentes / débiles:**
- **Inventario muy chico:** se ven ~3 propiedades destacadas y el listado de alquiler dice "No hay propiedades disponibles por el momento". Un comprador/inquilino que llega y no encuentra stock se va y no vuelve. Es el mayor riesgo de retención de este perfil.
- **Listado que no carga sin JS:** "Cargando propiedades…" — en conexiones lentas o si algo falla, el visitante ve una página vacía.
- **Fichas no compartibles:** sin og:image propia, mandar una propiedad por WhatsApp no muestra preview atractivo (afecta el boca a boca, central en este negocio).

**Densidad de información:** En la **ficha individual**, muy buena (descripción rica, características, fotos). En el **listado**, hoy insuficiente por falta de stock visible. Equilibrio correcto a nivel ficha.

**Retención estimada:** Alta en una ficha cargada; baja en el listado por inventario vacío/CSR. Lo que lo haría irse: no encontrar propiedades, o que el listado no cargue.

**Media/fotos:** En fichas, fotos reales y abundantes (bien). En páginas de servicio, el mismo problema de stock genérico, aunque a este perfil le pesa menos.

---

## Gap prioritario y conexión con el backlog

**El gap de confianza institucional del Perfil A es el cuello de botella del objetivo comercial.** El sitio *dice* las cosas correctas (matrícula, trayectoria, trato directo) pero **no las prueba ni las consolida en una página de captación**, y las debilita con fotos de stock no locales y métricas sin fuente.

Acciones del backlog que cierran ese gap, en orden:

1. **QW2 `/vender-mi-propiedad`** + **QW3 `/cuanto-vale-mi-propiedad`** — dan al propietario un destino que consolida el caso de confianza y captura la intención.
2. **QW1 + QW4 (FAQ marcada y ampliada con comisión/proceso)** — transparencia que este perfil exige; además mejora GEO.
3. **ES5 página del martillero + Person schema** — convierte la trayectoria de prosa en entidad verificable (humana y para IA).
4. **Reemplazo de fotos de stock por fotos reales de Mar del Plata, la oficina y el martillero** (acción de contenido, no de código) — alinea la percepción visual con el mensaje de cercanía local.
5. **Mostrar prueba social real** (testimonios con nombre, enlace a la ficha de Google con las reseñas) — sostiene el "+500 operaciones / 4,9★" hoy solo afirmado.
6. En paralelo, para no perder al Perfil B: **ES1 (SSR del listado)** y **cargar más inventario** — sin stock visible, toda la captación de demanda se cae.

---

## Anexo — Notas de verificación

- **[no verificable] desde la auditoría externa:** contenido exacto de `/robots.txt` y `/sitemap.xml`; conteo real de reseñas que respalda "4,9★"; metadata de `/alquileres` y `/administracion` (vistas por captura, no fetcheadas en crudo). Confirmar en el repo / Search Console.
- **Confirmado por navegación:** ausencia de JSON-LD; fichas sin metadata SEO; listado CSR ("Cargando propiedades…"); OG global idéntico; og:image de home 110×44; teléfono inconsistente y `tel:` mal formado; martillero = Daniel Fernández Santia, REG N° 2891.
- Validar todo cambio de schema con Google Rich Results Test antes de cerrar cada tarea.
