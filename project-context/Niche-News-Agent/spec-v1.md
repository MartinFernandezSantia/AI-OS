# Niche News Agent — Spec v1 (WIP)

> Diseño conversado 2026-06-23. Estado: definido, sin código. Continuar próxima sesión.

## Qué es

Segundo trabajo de Hermes: scraper/curador de noticias de un nicho que Martin especifica.
Manda un digest diario por notificación con lo más relevante; Martin selecciona 1+ noticias
y pasan a un pipeline de creación de contenido (v1: post de blog). Comparte infra con el CRM
(cron + adaptador Telegram + Supabase + Claude) → Hermes empieza a justificarse con 2 doers.

## Palanca clave

**Es casi todo n8n, que ya self-hostea Martin.** Nodos RSS + schedule trigger + HTTP + llamada
a Claude. El scraper+digest = un workflow de n8n + Claude + Telegram, con Supabase de estado.
Poco código propio, sobre rieles existentes.

## Decisiones tomadas

- **Fuentes v1 = Backbone + RSSHub** (sin X):
  - **RSS** de medios del nicho.
  - **Google News RSS** — feeds por query (`/rss/search?q=...`), cobertura amplia inmediata.
  - **GDELT** — base global de noticias abierta, consultable por tema, gratis.
  - **RSSHub** (open-source, self-host → cumple regla) para fuentes sin RSS.
  - **X queda FUERA de v1**: no hay lectura gratis/confiable; API paga y cara, scraping va contra
    ToS y bloquean fuerte, nitter murió. Mismo aprendizaje que el research de engagement. Sumable
    best-effort en v2 solo si el nicho lo exige. El sistema debe funcionar aunque X falle.
- **Salida de contenido v1 = post de blog** (en la voz de Martin, como borrador a revisar, nunca
  auto-publicado). Script de reel de IG → v2.
- **Multi-nicho desde el día 1**, arrancar con uno.
- **Notificación/selección por Telegram**, reusando el adaptador del CRM.

## Flujo

```
  [Cron diario] → fetch fuentes → dedup/cluster → Claude rankea vs nicho
        → guarda en Supabase → digest top-N por Telegram
        → Martin elige 1+ (responde números) → pipeline de contenido → borrador blog para revisar
```

- **Rankeo**: Claude puntúa cada cluster contra la definición de nicho + ángulo de Martin. Pasada
  barata con Haiku para filtrar, Claude para resumir el top.
- **Dedup/cluster**: por URL + similitud de título (o embeddings) para no repetir la misma historia.
- **Contenido**: el item elegido entra a un sub-pipeline que usa skills existentes
  (`copywriting` / `content-strategy`) respetando la voz de Martin. Reel (v2) usaría
  `short-form-video` / `make-a-video`.

## Esquema (Supabase)

- **`niches`** — id, name, definition (para el rankeo), angle/notas, active
- **`sources`** — id, niche_id, type ('rss'|'gnews'|'gdelt'|'rsshub'), url/query, active
- **`items`** — id, source_id, niche_id, title, url, published_at, summary, cluster_id, score,
  status ('new'|'digested'|'selected'|'content_done'), created_at
- **`digests`** — id, niche_id, date, item_ids[], sent_at

## Próximos pasos (siguiente sesión)

1. Definir el/los primeros nichos (definición + ángulo) y armar la lista de fuentes RSS semilla.
2. Levantar RSSHub self-host (Docker) y validar 1-2 feeds que no tengan RSS nativo.
3. Workflow n8n: schedule → fetch (RSS/GNews/GDELT/RSSHub) → dedup → Claude rank+summary →
   Supabase → digest Telegram.
4. Sub-pipeline de selección → borrador de blog en la voz de Martin.
