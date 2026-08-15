# Prompt de rediseño UX/UI — Catalog Curator (para Claude Design)

## Context

Martin quiere rediseñar en Claude Design la UI del **catalog-curator** de Terminal Gráfica: una app interna Next.js que sirve para "curar" el catálogo real de una imprenta y dejarlo listo para que lo consuma un bot/RAG. Va a adjuntar capturas del diseño actual.

El pedido concreto **no es escribir código**, es producir un **prompt** que él copiará en Claude Design pidiendo un rediseño completo orientado a UX/UI. El prompt debe: (1) explicar cómo funciona el curador, (2) mantener la paleta actual, (3) pedir un prototipo interactivo de todo el flujo, y (4) atacar 4 problemas concretos con dirección sugerida pero dejando libertad de ejecución.

Decisiones tomadas con Martin: **alcance = todo el flujo** (Curar + Agrupar + sidebar/progreso); **entregable = prototipo interactivo**; **dirección = dirigido pero abierto**.

Los datos de dominio, flujo y paleta salieron de explorar el repo (`lib/catalog-state.ts`, `components/curar-workspace.tsx`, `components/product-queue.tsx`, `components/product-editor.tsx`, `components/agrupar-workspace.tsx`, `app/globals.css`).

---

## EL PROMPT (copiar todo lo que sigue en Claude Design)

> Adjunto capturas de la app actual. Quiero un **rediseño completo orientado a UX/UI** de una herramienta interna llamada **Catalog Curator**. Entregame un **prototipo interactivo navegable** (artifact React/HTML) que muestre las vistas rediseñadas con datos de ejemplo realistas, en **modo claro y oscuro**. Mantené la identidad visual actual (paleta y tipografía abajo). Antes de maquetar, entendé bien el dominio y los problemas.
>
> ### Qué es y para qué sirve
> Es una herramienta **interna de un solo operador** (no es una tienda ni un panel público). Sirve para tomar el catálogo real de una imprenta —cientos de productos con sus variantes— y **curarlo** para que un bot/asistente de IA lo entienda bien: nombres claros, sinónimos, casos de uso, y variantes bien agrupadas. El éxito es terminar de curar todo el catálogo de forma rápida y con poca fatiga. La velocidad y la sensación de avance son centrales.
>
> ### Cómo funciona (modelo mental)
> Hay dos capas de datos: el **catálogo real** (inmutable) y una **capa curada por el bot** que se superpone encima. El operador trabaja en dos vistas:
>
> **1. Curar** — la vista principal. Dos paneles:
> - **Cola** (izquierda): todos los productos **agrupados por categoría** (secciones colapsables). Cada producto muestra un indicador de estado. Hay un filtro "Solo pendientes" y búsqueda rápida (⌘K).
> - **Editor** (derecha): se edita **un producto a la vez**. Se ajusta su nombre para el bot, sinónimos, casos de uso, nicho, una nota, y la unidad de venta de cada **variante**. Botones "Guardar y siguiente" (⌘↵) y "Ocultar y siguiente" avanzan automáticamente al próximo pendiente. La interacción es de teclado y en cadena: curás uno, saltás al siguiente, decenas de veces por sesión.
>
> Estados de un producto: **pendiente** (sin curar), **curado** (listo), **desactualizado** (aparecieron variantes nuevas en el catálogo real que faltan curar), **oculto** (excluido a propósito), y un marcador **sin guardar** mientras se edita.
>
> **2. Agrupar** — vista secundaria. Un mismo producto del bot puede **agrupar variantes que vienen de varios productos distintos** del catálogo real (ej: unificar "Tarjeta 9x5" y "Tarjeta personal" bajo un solo producto "Tarjetas"). Acá se ven los productos del bot con sus variantes (checkboxes) y se **mueven variantes de un grupo a otro**. Cada variante pertenece a un solo grupo.
>
> **Sidebar**: navegación entre las dos vistas + una barra de progreso global del catálogo.
>
> ### Los 4 problemas que el rediseño DEBE resolver
> Te explico el problema y una dirección sugerida; tenés libertad total en cómo lo resolvés en UX, siempre que ataque la causa.
>
> 1. **La presentación de los productos es pobre.** La cola es una lista angosta y monótona, y el editor es un formulario denso de un solo producto. Cuesta escanear, ubicarse y sentir contexto. → Repensá cómo se listan y se editan los productos: jerarquía visual clara, densidad cómoda, estado legible de un vistazo, y que el editor no se sienta un formulario plano. Que curar decenas seguidos sea fluido y hasta satisfactorio.
>
> 2. **El progreso se siente lentísimo y los mensajes no ayudan.** Hoy hay toasts de celebración genéricos ("Quedan 120", "Hito 25%") sobre el total del catálogo, que con cientos de productos hacen sentir que nunca se avanza. → Rediseñá el sistema de feedback de progreso para que dé sensación de avance real y momentum: micro-logros alcanzables, foco en la categoría o el bloque actual, no en el total lejano. Los mensajes deben informar y motivar, no ser ruido.
>
> 3. **La barra de progreso es global (sobre el total), debería ser por categoría.** Ver "82 de 340" es desmoralizante. → El progreso principal debe organizarse **por categoría**: cada categoría con su propio avance (ej: "Tarjetas 8/12"), de modo que el operador cierre categorías completas como unidades de trabajo manejables. Podés mantener un total agregado secundario, pero el protagonista es el avance por categoría.
>
> 4. **Los productos redundantes no se distinguen y confunden.** Un producto puede seguir apareciendo como "pendiente" en la cola aunque **sus variantes ya fueron agrupadas dentro de OTRO producto** en la vista Agrupar. Ese producto ya nunca se va a guardar por sí mismo (es redundante), pero hoy solo lleva un iconito gris con tooltip y parece que todavía falta trabajo. → Distinguí visualmente y con claridad estos productos "ya cubiertos en otro grupo": atenuarlos, separarlos, agruparlos aparte o excluirlos del conteo de pendientes, y explicar en la propia UI que sus variantes ya viven en otro producto (con enlace/referencia a ese grupo destino). El operador tiene que entender de un vistazo que ahí no hay nada que hacer, sin abrir un tooltip.
>
> ### Identidad visual a mantener (no cambiar la paleta)
> - **Acento principal**: terracota / naranja quemado → `oklch(0.6126 0.1544 43.9343)` (variante clara `oklch(0.6926 0.1544 43.9343)`). Es el color de marca; usalo para acciones primarias y estado "curado/éxito".
> - **Neutrales**: grises neutros. Claro → fondo `oklch(1 0 0)`, texto `oklch(0.145 0 0)`. Oscuro → fondo `oklch(0.145 0 0)`, texto `oklch(0.985 0 0)`. Borde sutil `oklch(0.872 0.01 258)`.
> - **Estados**: error/destructivo = rojo `oklch(0.577 0.245 27.325)`; warning / "desactualizado" / "sin guardar" = ámbar (`#f59e0b` / `#d97706`); éxito / "curado" = el terracota primario. No hay verde de éxito y no hace falta agregarlo (pero si un verde suave ayuda a la legibilidad de estados, proponelo como opción).
> - **Tipografía**: Geist (sans) y Geist Mono (monoespaciada para comandos/IDs). Escala con base algo grande y cómoda de leer.
> - **Radios**: base ~10px (escala 6/8/10/14px). Estética limpia, moderna, tipo shadcn/ui "new-york", con Radix + lucide como referencia de componentes. Soportá modo claro y oscuro con toggle.
>
> ### Qué entregar
> - Prototipo interactivo con las **tres piezas rediseñadas**: vista **Curar** (cola + editor), vista **Agrupar**, y **sidebar con el nuevo sistema de progreso por categoría**.
> - Navegable entre vistas, con datos de ejemplo que muestren los 4 casos: productos pendientes, curados, desactualizados y "ya agrupados en otro grupo".
> - Ambos temas (claro/oscuro).
> - Al final, una breve nota explicando las decisiones de UX que tomaste para cada uno de los 4 problemas.

---

## Notas para Martin (no van en el prompt)

- El prompt es autocontenido: podés pegarlo tal cual junto a tus capturas. Si querés, agregá 1–2 frases sobre el volumen real del catálogo (cuántos productos/categorías) — ayuda a que el diseño escale a tu caso.
- La detección de "variantes ya agrupadas en otro producto" **ya existe en el código** (`groupedElsewhereCount` / `groupedInto` en `lib/catalog-state.ts`), hoy solo mal expuesta con un ícono. O sea: el rediseño del problema 4 es puramente de UI, el dato ya está disponible.
- El progreso por categoría **también ya se calcula** (`curatedCount`/`totalCount` por `CategoryGroup`); hoy vive como badge chico. Reusable directo cuando implementes el rediseño.

## Verificación

No aplica implementación de código en este paso. El resultado se valida así:
1. Pegar el prompt + capturas en Claude Design y revisar que el prototipo cubra las 3 vistas y los 4 problemas.
2. Chequear que la paleta terracota + neutros + Geist se respete en claro y oscuro.
3. Si el diseño convence, en un segundo paso se traduce al código real reusando `groupedElsewhereCount`/`groupedInto` y los conteos por categoría ya existentes.
