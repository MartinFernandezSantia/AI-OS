# Plan — Formulario de carga de avisos (SantiaPropiedades)

> Estado: aprobado 2026-07-01. Implementación en `projects/SantiaPropiedades/carga-aviso/` (repo propio, gitignored del AIOS).

## Context

Martin necesita una herramienta interna estilo Zonaprop para que el martillero (Daniel Fernández Santia) cargue los datos de una propiedad y se guarden para que Martin arme el aviso. Hoy ese pase de datos es manual/informal. La app resuelve la captura estructurada en un wizard de 5 pasos, con la mayoría de los campos como combobox y dos textareas para "destacados" con ejemplos que orienten al martillero.

**Decisiones tomadas con Martin:**
- App **standalone Next.js 16 + React + TS** (separada del sitio Next de SantiaPropiedades).
- Escribe a la **misma Supabase** de SantiaPropiedades (cuenta personal de Martin, Free) en **tablas nuevas**.
- Al enviar: **INSERT** en Supabase con un `bool` de estado (`procesado`: nuevo=false / hecho=true).
- Acceso del martillero con **passcode compartido**, validado del lado servidor; el INSERT usa la **service-role key** en el server (nunca en el cliente). La tabla queda cerrada a `anon` por RLS.
- Fotos fuera de alcance (ya existe `tools/tagger.html` para eso).

**Infra (chequeada):** `projects/*` está en `.gitignore` del AIOS → el proyecto vive en `projects/SantiaPropiedades/` como repo git propio, sin trackearse en el AIOS. Node 24.16, pnpm 11.6 disponibles. Regla de ramas: en `projects/` nunca commitear a `main`, usar rama feature.

## Prerrequisitos que aporta Martin (no puedo leer .env / el repo del sitio no está acá)

1. **Supabase URL** del proyecto SantiaPropiedades (`https://<ref>.supabase.co`).
2. **service_role key** (va en `.env.local`, solo server) y **anon key** (por si se usa client read; en principio no hace falta).
3. **Passcode** a compartir con el martillero (va en `.env.local` como `INTAKE_PASSCODE`).
4. Aplicar la migración SQL que preparo (regla: yo preparo migraciones, Martin las aplica en Supabase).

## Ubicación y stack

- Path: `/home/martin/AI-OS/projects/SantiaPropiedades/carga-aviso/`  → `git init` propio, rama `feat/form-carga-aviso`.
- Next.js 16 (App Router) + React + TypeScript + pnpm. Verificar API específicas de Next 16 (Server Actions, `cookies`) con Context7 durante la implementación.
- Estilos: CSS modules o Tailwind (Tailwind recomendado por velocidad). UI limpia, mobile-first (el martillero puede cargar desde el celular).
- `@supabase/supabase-js` v2 para el INSERT server-side.

## Modelo de datos (migración SQL — Martin la aplica)

Tabla `public.avisos_intake` (nombre claro para no chocar con tablas del sitio):

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | |
| `created_at` | timestamptz default `now()` | |
| `procesado` | boolean default `false` | **el bool de estado**: false=nuevo, true=hecho |
| `operacion` | text | 'alquiler' \| 'venta' |
| `tipo_propiedad` | text | casa, departamento, terreno, ph, bodega_galpon, parcela, campo, deposito, garage, local_comercial, oficina_comercial |
| `subtipo` | text null | solo casa/departamento |
| `calle_numero` | text | |
| `provincia` | text | |
| `ciudad` | text | |
| `superficie_total` | numeric null | m² |
| `superficie_cubierta` | numeric null | m² |
| `superficie_semicubierta` | numeric null | m² |
| `antiguedad_estreno` | boolean default false | "a estrenar" |
| `antiguedad_anios` | int null | si no es a estrenar |
| `ambientes` | int null | |
| `dormitorios` | int null | |
| `banos` | int null | |
| `toilettes` | int null | |
| `cocheras` | int null | |
| `mas_ambientes` | text[] | multi-select Paso 4 |
| `servicios` | text[] | ascensor, encargado, caja_fuerte |
| `extras` | text[] | aire_acondicionado, amoblado, ... |
| `facilidades` | text[] | apto_profesional, parrilla, ... |
| `luminoso` | text null | alto \| medio \| bajo |
| `orientacion` | text null | N, S, E, O, NE, NO, SE, SO |
| `cantidad_plantas` | int null | |
| `cobertura_cochera` | text null | cubierta \| semi \| descubierta |
| `disposicion` | text null | frente \| contrafrente \| interno \| lateral |
| `pisos_edificio` | int null | |
| `deptos_por_piso` | int null | |
| `destacados_propiedad` | text null | textarea 1 |
| `destacados_entorno` | text null | textarea 2 |
| `moneda` | text | USD \| ARS |
| `precio` | numeric null | alquiler o venta |
| `expensas` | numeric null | ARS, si aplica |

**RLS:** `enable row level security`. Sin policies para `anon`/`authenticated` → nadie escribe ni lee con anon key. El INSERT lo hace el server con service-role (bypassa RLS). Martin lee desde el dashboard de Supabase o una vista propia autenticada.

## Estructura de la app

```
carga-aviso/
  app/
    layout.tsx
    page.tsx                 # gate de passcode + wizard
    actions.ts               # 'use server' → valida passcode + INSERT service-role
  components/
    PasscodeGate.tsx
    Wizard.tsx               # estado del form + navegación de pasos + progress bar
    steps/Step1..Step5.tsx
    fields/ (Select, MultiChip, NumberField, SegmentedRadio, TextArea)
  lib/
    supabaseServer.ts        # createClient con SUPABASE_URL + SERVICE_ROLE (server only)
    options.ts               # todas las listas de opciones (single source of truth)
  .env.local                 # (Martin) SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTAKE_PASSCODE
```

**Flujo de passcode:** `PasscodeGate` pide la clave → la manda al server action → si coincide con `INTAKE_PASSCODE`, setea una cookie httpOnly de sesión corta y muestra el wizard. El action de submit revalida la cookie antes de insertar. Passcode nunca queda en el bundle del cliente.

## Wizard — campos por paso (mayoría combobox)

**Paso 1 — Operación y tipo**
- `operacion`: segmented radio (Alquiler / Venta).
- `tipo_propiedad`: select. `subtipo`: select **dependiente** que aparece solo para Casa/Departamento (mapa en `options.ts`):
  - Casa → Barrio con acceso privado, Bungalow, Cabaña, Chalet, Condominio, Duplex, PH, Prefabricada, Triplex.
  - Departamento → Apartaestudio, Duplex, Triplex, Estándar, Loft, Monoambiente, Piso, Semipiso.

**Paso 2 — Ubicación**
- `calle_numero`: text. `provincia`: select con las 24 (23 provincias + CABA). `ciudad`: text.

**Paso 3 — Superficie y ambientes**
- `superficie_total`, `superficie_cubierta`: number (m²).
- Antigüedad: checkbox "A estrenar" → si off, number `antiguedad_anios`.
- `ambientes`, `dormitorios`, `banos`, `toilettes`, `cocheras`: selects 0–10+ (o steppers).

**Paso 4 — Más ambientes, servicios, extras, facilidades, detalles**
- Multi-select (chips) `mas_ambientes`: Balcón, Cocina, Comedor, Lavadero, Living, Living comedor, Baulera, Comedor diario, Dependencia de servicio, Dormitorio en suite, Escritorio, Hall, Jardín, Patio, Sótano, Terraza, Vestidor.
- Multi-select `servicios`: Ascensor, Encargado, Caja fuerte.
- Multi-select `extras`: Aire acondicionado, Amoblado, Calefacción, Quincho, SUM, Vigilancia, Alarma, Caldera, Cocina equipada, Lavarropas, Microondas, Secarropas, Termotanque.
- Multi-select `facilidades`: Apto profesional, Parrilla, Permite mascotas, Pileta, Acceso para discapacitados, Hidromasaje, Sala de juegos, Uso comercial.
- Detalles (selects/numbers): `luminoso` (alto/medio/bajo), `orientacion` (N/S/E/O/NE/NO/SE/SO), `cantidad_plantas` (number), `cobertura_cochera` (cubierta/semi/descubierta), `disposicion` (frente/contrafrente/interno/lateral), `pisos_edificio` (number), `superficie_semicubierta` (number m²), `deptos_por_piso` (number).
- **Dos textareas con ejemplos de placeholder** (Martin pidió esto):
  - `destacados_propiedad` — placeholder: *"Ej: Muy luminoso, sol de mañana. Pisos de madera originales restaurados. Cocina integrada con isla. Placares en todos los dormitorios. Balcón aterrazado con parrilla."*
  - `destacados_entorno` — placeholder: *"Ej: Zona residencial tranquila y arbolada. A 3 cuadras del subte. Cerca de colegios, plaza y shopping. Fácil acceso a autopista."*

**Paso 5 — Precio**
- `moneda`: select (USD / ARS). `precio`: number. `expensas`: number (ARS, opcional).

**Cierre:** pantalla de revisión (resumen de todo) → botón "Enviar" → server action inserta → confirmación con opción de "Cargar otra propiedad".

## UX/UI (prioridad del pedido)

- Wizard con progress bar de 5 pasos, navegación Anterior/Siguiente, validación por paso antes de avanzar.
- Mobile-first, tap targets grandes, chips claros para multi-select, selects nativos (mejor en mobile).
- Aplicar skills de diseño durante la build: `frontend-design` (armado), `refactoring-ui` + `web-typography` (pulido), `ux-heuristics` (validación de flujo).
- Autosave del borrador en `localStorage` para que el martillero no pierda la carga si se corta.

## Pasos de implementación

1. Mover este plan al AIOS y commitear.
2. `pnpm create next-app` (Next 16, TS, Tailwind, App Router) en `projects/SantiaPropiedades/carga-aviso/`; `git init` + rama `feat/form-carga-aviso`.
3. `lib/options.ts` con todas las listas + mapa tipo→subtipo (single source of truth, reusado por form y validación).
4. Migración SQL de `avisos_intake` + RLS → entregar a Martin para que la aplique.
5. `lib/supabaseServer.ts` + `app/actions.ts` (validación de passcode + INSERT service-role).
6. `PasscodeGate` + cookie de sesión.
7. `Wizard` + Steps 1–5 + componentes de campo + pantalla de revisión + confirmación.
8. Pulido UI (refactoring-ui / web-typography), autosave localStorage.
9. `.env.local.example` documentando las 3 variables (Martin crea `.env.local` real).

## Verificación (end-to-end)

- `pnpm dev`; abrir la app → probar passcode incorrecto (rechaza) y correcto (entra).
- Completar los 5 pasos, verificar subtipo dependiente, multi-selects, textareas con placeholders, validación por paso.
- Enviar → confirmar en el dashboard de Supabase que aparece la fila en `avisos_intake` con `procesado=false` y los `text[]` bien cargados.
- Cerrar el navegador a mitad de carga → reabrir → verificar autosave (localStorage).
- Confirmar que el bundle del cliente NO contiene el passcode ni la service-role key (grep en `.next`).

## Fuera de alcance (v1)

- Carga de fotos (usar `tools/tagger.html`).
- Panel de Martin para ver/marcar `procesado=true` (v2; por ahora dashboard de Supabase).
- Publicación automática a Zonaprop / sitio.
- Login real del martillero (Supabase Auth) — pospuesto por decisión de usar passcode.
