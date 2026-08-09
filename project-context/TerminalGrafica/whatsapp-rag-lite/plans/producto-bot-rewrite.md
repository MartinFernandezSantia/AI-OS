# Plan — RAG-lite: modelo producto-bot + slot-filling por familia

## Context (por qué)

El bot RAG-lite de TerminalGrafica no converge bien porque le pide al retrieval que
desambigüe la intención del cliente (trabajo que va ANTES de buscar), y porque el modelo de
datos `bot.*` se armó para el faq-bot v10 (búsqueda determinista), no para un RAG. Hoy hay
**dos mecanismos que hacen lo mismo** — `producto_meta` (renombra 1 producto) y `grupo`
(junta variantes) — lo que genera solapamiento (Carnet, Sobres tratados dos veces) y una
fuente de verdad ambigua. La curación de grupos/nombres que Martin ya hizo **no se consume**:
los grupos quedan fuera del export y de los embeddings.

Objetivo: unificar la rama `bot` en una sola abstracción **producto-bot** (la unidad del
chunk RAG), consumir grupos+nombres sin duplicar, y especializar el slot-filling por familia
para que el bot recolecte info discriminante antes de buscar.

## Decisiones tomadas (validadas con Martin)

- **`public` no se toca.** Todo el trabajo es sobre la rama `bot`.
- **Modelo unificado producto-bot.** Un producto-bot apunta a N variantes de public
  (N=1 individual, N>1 grupo). Reemplaza `producto_meta` + `variante_meta` + `grupo` + `grupo_item`.
- **Grupo = 1 chunk; los individuales absorbidos no se emiten** (no generan producto-bot propio).
- **Ejes del slot-filling en el system prompt, a discreción del bot** (no como dato en tabla).
- **El retrieval RAG NO cambia.** Sigue con `topK=8`. El slot-filling NO rutea ni trae un solo
  chunk: enriquece la query para que esas 8 que vuelven sean las relevantes (sin faltantes ni
  colados — ej. AutoCAD colándose en "impresiones", donde ~11 productos × ~4 variantes sí cumplen).
  Agrupar reduce la fragmentación (menos productos sueltos compiten por esos lugares).
  **Meta a futuro:** con las dos afinadas, bajar `topK` de 8 a 4 manteniendo la respuesta correcta
  (ajuste posterior, no en este plan).
- **Rewrite quirúrgico.** La capa de precios (`bot.variantes` + flags de cobro) se conserva.
  El resto de `bot.*` (firewall, decisiones, info_negocio, enums) no se toca.

## Schema nuevo (rama bot)

```sql
create table bot.familia (
  clave   text primary key,   -- impresiones_papel, ploteado, tarjetas, carteleria, libreria, otro
  nombre  text not null,
  nota    text                -- se hornea al embedding (ej. libreria: "se venden sueltos, no es un trabajo")
);

create table bot.producto (
  id           uuid primary key default gen_random_uuid(),
  clave        text unique not null,               -- clave natural estable (NO uuid en metadata)
  nombre_bot   text not null,
  familia      text references bot.familia(clave),
  sinonimos    text[] default '{}',
  casos_de_uso text[] default '{}',
  nicho        text,                               -- heredado; null si el grupo mezcla nicho y no-nicho
  nota         text,
  peso         real default 1.0,                   -- boost SUAVE de ranking (desempata pedidos ambiguos). Dial de revisión.
  oculto       boolean default false,
  updated_at   timestamptz default now()
);
-- Unicidad de nombre_bot NORMALIZado (translate+lower+trim): dos homónimos cruzarían precios
-- en el Map byName de "Insertar Precios". Assert en la migración + índice único funcional.
create unique index bot_producto_nombre_norm_uq
  on bot.producto (translate(lower(trim(nombre_bot)), 'áéíóúñ','aeioun')) where not oculto;

create table bot.producto_item (
  id                  uuid primary key default gen_random_uuid(),
  producto_id         uuid references bot.producto(id) on delete cascade,
  variante_id         uuid references public.product_variants(id) on delete cascade,
  nombre_variante_bot text,
  oculto              boolean default false,
  unique (producto_id, variante_id)
);
-- `orden` descartado en ambas tablas: el LLM no es determinístico, no se puede forzar el orden
-- de presentación sin gastar contexto. `peso` (en bot.producto) sí sirve: ajusta el RANKING del
-- retrieval, no la presentación.
-- Assert en la migración: una variante en UN solo producto-bot (evita cotizarla dos veces).
```

**Se conserva** (capa de precios): `bot.variantes` + los flags `por_pagina`/`por_pack` y
`atributos` (unidad_venta, pack_unidades) que hoy alimentan esa vista. `producto_meta`/
`variante_meta` quedan reducidas a esos campos de cobro. **Se jubilan:** vistas `bot.taxonomia`,
`bot.grupo_variantes`, tabla `bot.rubro_meta`.

## Correcciones de la verificación (Fable) — claves para no romper prod

1. **El precio sigue matcheando por nombre-del-chunk + `[vN]`, NO por `variante_id`.** El LLM
   emite `nombre_catalogo` + `variante_ref [vN]`; el chunk del grupo tiene su `nombre_bot` y
   `metadata.precios` local. NO se tocan `Buscar Precios`/`Traer Catálogo Real`. Se mantienen
   las CLAVES de metadata que hoy consultan (`nombre_canonico`, `producto_id`) apuntando a los
   valores nuevos (`nombre_bot`, `bot.producto.clave`) para que las queries no cambien. `variante_id`
   se agrega DENTRO de `metadata.precios` (auditoría/freshness/`--prices-only`), no como clave de match.
2. **Contexto de cobro POR ITEM.** Un producto-bot agrupa variantes de varios productos public
   (ej. Plastificados = Carnet + A3 + A4 + Oficio). `derivarUnidad`/`precioVariante` hoy leen
   `por_pagina`/`por_pack`/atributos del producto public dueño. El export v4 debe denormalizar
   POR ITEM: `por_pagina`, `por_pack`, `unidad_venta`, `pack_unidades`, `rangos_cantidad`,
   `mostrable`, `tiene_override`, `oculto`, resolviendo `producto_item → variante → product_id →
   producto_meta`. `price-display.ts` cambia de firma: cada opción trae su propio mini-contexto,
   no un `p` de producto-bot.
3. **Absorción por construcción, NO con `oculto`.** Marcar variantes con `variante_meta.oculto`/
   `producto_meta.oculto` las saca de `bot.variantes` (filtra oculto) → los grupos quedarían sin
   escaleras/reglas. Un producto absorbido simplemente NO genera `bot.producto` individual;
   `bot.variantes` no se toca.
4. **Heredar la curación de los absorbidos al grupo.** La migración une (con dedupe normalizado)
   `sinonimos` + `casos_de_uso` + `atributos` + `nicho` de los productos absorbidos al
   `bot.producto` del grupo. Sin esto se pierde señal (ej. "volantes" en los folletos).

## Implementación por fases

### Fase 1 — Datos (repo `whatsapp-automation`, solo lectura de public)
1. Aplicar primero los overlays que Martin ya bajó del dashboard (viven en
   `/mnt/c/Users/marti/Downloads/nombres-bot-*.sql` y `grupos-bot-*.sql`, sin aplicar) sobre el
   modelo viejo, para que la migración los levante.
2. DDL `db/catalogo-producto-bot.sql`: crea `bot.familia`, `bot.producto`, `bot.producto_item`
   + índices (incl. el único funcional de `nombre_bot`). Seed de `bot.familia` con notas (libreria, etc.).
3. `db/migracion-producto-bot.sql` (idempotente, por clave natural):
   - Cada `bot.grupo` → un `bot.producto` + sus `grupo_item` como items; hereda sinónimos/casos/
     atributos/nicho de los absorbidos (dedupe). `nicho` = valor si todos coinciden, null si mezclan.
   - Cada producto public no-oculto cuyas variantes NO estén todas absorbidas → un `bot.producto`
     con sus variantes NO absorbidas como items.
   - **Reglas de borde (asserts + NOTICE):** (a) producto-bot con 0 items → skip; (b) absorción
     parcial de un producto → NOTICE para revisión manual (nombre curado puede mentir sobre el
     remanente); (c) variante en 2 grupos → error; (d) colapso `familias[]`→`familia` escalar
     (regla: primera / la marcada); (e) assert de cobertura: todo producto-bot con `familia` no nula.
4. `db/curador-export-v4.sql` (NO reemplaza v3; coexisten): un objeto por producto-bot con
   `nombre_bot`, `familia`+`nota`, `sinonimos`, `casos_de_uso`, `nicho`, y por cada item el
   contexto de cobro completo del punto 2 (para que price-display funcione por item).
   - Verificación: correr el export; grupos aparecen una sola vez, sin duplicados, con reglas por item.

### Fase 2 — Consumo (repo `whatsapp-rag-lite`)
- `lib/catalog/types.ts`: tipos v4 EN PARALELO a los v3 (no reemplazar — verificar quién más
  consume `Producto`/`Variante`; el export v3 sigue vivo para el dashboard hasta Fase 4).
- `lib/catalog/price-display.ts`: firma por item (cada opción con su contexto de cobro).
- `lib/catalog/rag-chunk.ts`: `chunkRAG` v4 — `nombre_bot — familia`, `También llamado:`,
  `Sirve para:`, **conservar `atributosTexto` (Material/Tecnología/Tamaños)**, hornear
  `familia.nota` + `producto.nota`, `Opciones:` desde items. Metadata: claves ESTABLES
  (`nombre_canonico`=nombre_bot, `producto_id`=`bot.producto.clave`) + `variante_id` dentro de
  `precios`. `nicho` como metadata de filtro.
- `scripts/rag-ingest.ts`: `DEFAULT_EXPORT` → v4; `metaObj()` con las claves de arriba.
  - Verificación: `vitest` (`rag-chunk.test.ts` con fixture v4, `price-display.test.ts`);
    `pnpm rag:ingest --dry` para revisar chunks y su LONGITUD (regresión de tamaño/promediado).

### Fase 3 — Flow (`scripts/build-flow.mjs`)
- Slot-filling por familia en `const sistema`, Etapa 3 (~líneas 30-35): ejes de las 4 familias
  (impresiones papel: tipo/gramaje/tamaño/color/faz; ploteado: vinilo-lona-obra/color; tarjetas:
  pack/kraft/encapado/faz; cartelería: PVC-corrugado/medida). Regla: obtener los ejes top antes
  de disparar; evitar color/tamaño genérico salvo último recurso; tope ≤3 preguntas (pilar v10).
- **NO tocar** `Buscar Precios`/`Traer Catálogo Real` (ver corrección 1).
- Verificador: `Armar Verificación` entrega los items estructurados por `[vN]` y el prompt exige
  que los atributos afirmados salgan del MISMO `[vN]` (grupo=1 chunk debilita el `fusion_variantes`).
- `pnpm flow:build`. **Deploy del flow + re-ingest van JUNTOS** (los nombres de chunk cambian;
  flow viejo contra chunks nuevos no matchea).
  - Verificación end-to-end en el Chat interno de n8n (sin Chatwoot), INCLUYENDO regresión:
    - "necesito imprimir folletos" → falta_info, pregunta ejes de impresiones_papel.
    - "quiero una lona" → producto-bot Lona/Banner con variantes, no 3 sueltos.
    - "sobres" → una sola vez, sin duplicado.
    - Precio por `[vN]` con forma de cobro correcta (probar un grupo multi-producto: Plastificados).
    - Casos que HOY funcionan (no romper).

### Fase 4 — Follow-up (no bloquea el primer ciclo)
- **Reconciliación** (crítico para prod): con membresía materializada, un producto/variante nuevo
  en public NO existe para el bot hasta re-migrar. Definir re-run INSERT-ONLY (nunca pisar campos
  curados: `nombre_bot`/`sinonimos`/`casos_de_uso`) + query de huérfanos (variantes public activas
  sin `producto_item`) como sanity. Sin esto el catálogo queda congelado a la fecha de migración.
- Adaptar el dashboard de `whatsapp-automation` (tools Agrupar/Nombres) a editar `bot.producto`/
  `producto_item`. El primer ingest ya funciona con la migración; el dashboard se adapta después.
- **Re-ranking por `peso`** (mejora iterativa): reemplazar el nodo de búsqueda nativo
  (`retrieve-as-tool`, ordena solo por distancia) por una función SQL/RPC propia que el agente
  llame como tool y combine distancia semántica + `bot.producto.peso` (boost suave: desempata
  pedidos ambiguos sin romper los específicos). El campo `peso` ya queda en el schema desde Fase 1;
  esto solo cablea su uso. Se tunea revisando logs.

## Rollback / seguridad
- La ingesta es truncate+insert: backup del `rag-embeddings-data.sql` vigente antes de aplicar.
- `alwaysOutputData` en los nodos de precios enmascara 0-filas → validar el e2e mira precios reales,
  no solo que "no rompa".

## Archivos clave
- `whatsapp-automation/db/`: `catalogo-producto-bot.sql`, `migracion-producto-bot.sql`, `curador-export-v4.sql`.
- `whatsapp-rag-lite/lib/catalog/`: `types.ts`, `price-display.ts`, `rag-chunk.ts`, `__tests__/`.
- `whatsapp-rag-lite/scripts/`: `rag-ingest.ts`, `build-flow.mjs` (`const sistema`, `Armar Verificación`).

## Fuera de alcance
- `public`, la capa de precios (`bot.variantes`, reglas de cantidad), firewall/decisiones/enums.
- Derivar los ejes del slot-filling desde tabla (quedan en el prompt, a discreción del bot).
