# Production-Readiness Review — WhatsApp FAQ Bot (faq-bot-v5 → market grade)

> Review date: 2026-07-07. Scope: everything needed to take the current bot
> (WhatsApp Cloud API → Chatwoot → n8n `faq-bot-v5` → OpenRouter Gemini 2.5
> Flash-Lite → Supabase catalog) to a production deployment on a Hostinger KVM 4
> that performs on par with commercial WhatsApp bots. No code in this doc; it is
> the punch list and the reasoning.
>
> Inputs: full dissection of `n8n/flows/faq-bot-v5.json` + system prompt +
> setup guide; repo research docs (Meta ban risk, guardrails, VPS guide,
> mantenimiento-y-monitoreo); fresh web verification of pricing, n8n scaling,
> Chatwoot channels, media handling and Meta policy (2026-07-07).

---

## 0. Verdict

The bot's **conversation design is already above the DIY average**: assignment-gated
handoff with a repeatable bot→human→bot lifecycle, burst debounce + aggregation,
idempotency, live catalog grounding with a curated synonym layer, decision
logging with a forced-sampling improvement loop, and a red-team suite. Few
small-business bots have any of that.

What separates it from a market-grade product is not intelligence, it is
**engineering around failure, abuse, cost and operations**:

1. Every failure path today ends in **customer silence** (DB down, LLM down,
   n8n down → no reply, no escalation, no alert).
2. The **webhook is unauthenticated** and publicly bypassed in Zero Trust.
3. From **2026-10-01 every bot reply costs money** (verified below), so the
   missing anti-abuse layer is now a budget-protection requirement, not polish.
4. The funnel contradicts the client's intake rule: v5 does **order-intake in
   WhatsApp**, but the client only takes work **via email**.
5. Operations (monitoring, backups, runbooks, business hours, deploy
   reproducibility) are designed on paper but not stood up.

On the two infra questions asked: **no Kubernetes, and no n8n queue mode yet**.
Reasoning in §7. KVM 4 is the right size.

---

## 1. The October 2026 pricing change reframes requirement 6

Verified 2026-07-07 (multiple independent BSP sources; **not yet reflected on
Meta's own pricing page**, so re-verify when Meta publishes rates, promised
before 2026-09-01):

- Since 2025-07-01 WhatsApp charges **per message**, but free-form replies
  inside the 24 h customer-service window ("service messages") have been free.
- Announced 2026-07-01: **from 2026-10-01 service messages are charged per
  message**, at the same per-market rate as utility templates, **no volume
  discounts**. Inbound messages remain free. The 72 h window opened by
  Click-to-WhatsApp ads / FB-IG buttons remains free.
- Argentina utility rate today: **~US$0.026/message**. If service parity holds,
  each bot reply ≈ US$0.026.
- Meta's own "Business Agent" AI is billed per token; third-party bots like
  ours are billed as plain service messages. Only one charge per message.

Consequences:

**a) The commercial proposal has a wrong number.** `propuesta-cliente.md`
promises "WhatsApp Cloud API ≈ USD 0/mes". At ~900 conv/month × ~4-6 bot
replies ≈ **US$90-140/month from October**, before abuse. Fix the proposal
before the client signs; present it as a Meta platform cost (pass-through, in
the client's Meta account), and note the free CTWA 72 h window as a lever
(promoting the WhatsApp button on IG/FB makes those conversations free).

**b) "The cheapest reply is silence" becomes a design principle.** Today the
bot answers everything, including abuse, forever. Every refusal costs the same
as a useful answer. Needed layers, in order of leverage:

1. **Per-user reply cap** — token bucket per `wa_id` (e.g. max N bot replies /
   user / hour and / day). Over the cap → one final handoff message, then
   silence. State in Redis or Postgres (both already in the stack).
2. **Strike system** — repeated injection attempts or off-topic streaks
   (roadmap §4 already sketches this) increment a counter in `bot.decisiones`;
   at threshold → stop replying + label the contact for review. Do NOT keep
   sending the canned injection refusal forever; after 1-2 refusals, silence.
3. **Blocklist** — the roadmap's banned-list (§2b) checked early in the flow
   (Chatwoot contact label is the cleanest), plus WhatsApp's native **Block
   Users API** for hard cases. Caveat verified: you can only block a user who
   messaged within the last 24 h, list cap 64k.
4. **Dedupe** — webhook retries must never produce two paid replies. The
   idempotency check covers the text path; the non-text path has none (§2).
5. **Hard cost caps** — OpenRouter per-key spend limit as the LLM circuit
   breaker; Meta billing alerts once October pricing lands; a daily reply
   counter with a Telegram alert at an anomaly threshold ("bot sent 400
   messages today, normal is 80").
6. **Kill switch** — already designed (global off + handoff-only mode). Make it
   a variable the flow checks first, and document the trigger criteria in the
   runbook.

**c) Message economy.** Burst aggregation already merges rapid-fire inputs into
one reply — that is now a cost feature. Keep answers single-message; never
split into multi-message sequences.

---

## 2. Reliability: eliminate the silent-death paths (requirement 1)

"As little human intervention as possible" is achieved by making failures
self-announcing and self-recovering, not by hoping. From the flow dissection:

**P0 fixes inside the flow:**

- **`Get Catálogo` is a single point of failure** on every text message: no
  retry, no onError. DB hiccup → execution dies → customer gets nothing. The
  red-team safeguard "timeout + fallback if DB is down" was decided but never
  implemented. Fix: retry + onError-continue into a **cached catalog** (see
  §9 — caching also cuts latency and tokens), and if both fail → escalate to
  human with a note instead of dying.
- **LLM failure → silence.** `Llamar LLM` retries 3× then the execution just
  fails. Add an error branch: canned "te derivo con un compañero" + assign
  human + label + alert. Also guard the happy path: a 200 response without
  `choices` (OpenRouter error object) currently throws mid-expression.
- **No n8n Error Workflow configured.** Add a global one: any failed execution
  → Telegram alert + (if a conversation id is present) assign the conversation
  to a human. This single feature converts every unknown failure from "customer
  ghosted" to "human notified".
- **`ESCALAR` routing is brittle**: case-sensitive `contains`. A lowercase
  `escalar` leaks the token to the customer; a legitimate sentence containing
  "ESCALAR" false-triggers handoff. Minimum fix: normalize + exact/startsWith
  match. Better: switch the contract to **structured output** (JSON with an
  `action` field) — sturdier than a magic token and it bounds output size.
- **Non-text branch multiplies replies**: it runs before debounce and
  idempotency, so a 5-photo album = 5 canned messages (5× annoyance today, 5×
  cost from October). Move it behind the debounce, or add a per-conversation
  cooldown ("send the no-attachments notice at most once per N hours").
- **Idempotency is check-then-act** (two concurrent executions can both pass).
  Acceptable at this volume; the debounce makes it rare. Note it, don't
  re-architect.

**P0 fixes outside the flow:**

- **Chatwoot-side safety net is still unconfigured.** The designed backstop for
  "n8n is completely down" (Automation Rule / SLA policy: unassigned
  conversation with no first reply in X min → assign team + label + notify) is
  the only thing that covers total bot failure. Non-negotiable before go-live.
- **Monitoring Layer 1** (Uptime Kuma + Netdata + backup dead-man's-switch +
  external ping → Telegram) is designed in `mantenimiento-y-monitoreo.md` and
  not stood up. It is a go-live gate, not a nice-to-have.
- **Backups**: nightly encrypted `pg_dump` → R2, plus the two keys that make
  restores possible (`N8N_ENCRYPTION_KEY`, Chatwoot `SECRET_KEY_BASE`) stored
  off-VPS, plus **one rehearsed restore**. The VPS guide already documents the
  runbook; execute it.
- **Deploy reproducibility**: the committed v5 export is `active: false` with
  placeholder Postgres credentials and hardcoded ids (assignee 1, credential
  ids 1/2, base URL). The setup guide still describes v1 with a different LLM
  provider. If the VM dies today, rebuilding the bot means archaeology.
  Export the live v5, parametrize base URL / assignee / channel via n8n
  variables or env, and rewrite the setup guide against v5 + KVM 4. This is
  what makes the Hostinger migration a checklist instead of a project.

---

## 3. Security (requirement 6, beyond prompt injection)

- **Close the webhook hole (P0).** `/webhook/*` is bypassed to Everyone and the
  flow does not verify any signature: anyone with the URL can forge Chatwoot
  events and make the bot post messages into real conversations, spam
  customers, or pollute logs. Two clean fixes, do both:
  1. **Take n8n off the public internet entirely.** Chatwoot and n8n share a
     Docker network; register the Chatwoot webhook as the internal
     `http://n8n:5678/webhook/...` and delete the public bypass. Only
     Meta→Chatwoot needs public exposure; nothing external ever needs to reach
     n8n's webhook.
  2. Keep the roadmap's HMAC verification as defense in depth if any n8n
     endpoint must stay public later.
- **Prompt injection: regex is demo-grade, and you already know it.** For prod:
  n8n's native **Guardrails node** (≥1.119.1; Jailbreak + Topical Alignment,
  LLM-based) as input guard, keeping the regex as the free first filter.
  Wire detections into the strike system (§1b) so persistent attackers get
  silence, not free LLM calls. Output guard + faithfulness judge stay deferred
  until RAG/pricing surfaces exist (matches the guardrails research staging).
- **Liability framing** (why output guards eventually matter): Air Canada was
  held legally liable for its chatbot's wrong answer (Moffatt v. Air Canada,
  2024). The soft-handoff rule and "never invent TG-specific claims
  (durability, feasibility, deadlines)" watch-item already point the right way;
  keep them enforced through the weekly sampling.
- **Data**: `bot.decisiones` stores raw customer messages (PII). Define
  retention (e.g. 12 months), and it lives in the client's Supabase, not
  Martin's accounts (registry rule: TG infra under TG ownership). Reminder: the
  separate PII cleanup flagged in memory (`seed-prod.sql` with 526 real
  clients committed in the quote-system repo) is still pending — do not let it
  reach the new testing/prod projects.
- **VPS hardening**: follow the existing guide (non-root, key-only SSH, UFW +
  the Docker-bypasses-UFW trap, never `-p` on Postgres/Redis, fail2ban,
  unattended-upgrades, pinned image tags — n8n currently `:latest`, pin it).
- **Least privilege is already right** (`bot_readonly`, isolated `bot` schema,
  migrations prepared-by-AI applied-by-Martin). Keep it.

---

## 4. Funnel realignment: email is the only intake (requirement 5)

Current v5 behavior conflicts with the client's rule. v5 does order-intake
(collect qty/format/finish → confirm → escalate to a human **in WhatsApp**).
The client takes work **only via email**, where a human quotes.

Recommended target behavior (keeps the best of both):

1. Bot keeps the **info role** unchanged: products, capabilities, hours,
   formats, payment, file specs.
2. On purchase intent, keep the **light spec-gathering** (it is genuinely
   valuable — it turns vague emails into complete ones), but change the
   terminal action: instead of assigning a human in Chatwoot, the bot sends a
   **copy-pasteable summary + the email address + a checklist of what to
   attach** (files, sizes, quantities). One message, done.
3. **Auto-forward the lead**: n8n emails the same summary + conversation link
   to the shop inbox via the already-configured Brevo SMTP. The shop sees the
   lead even if the customer never sends the email, and can chase it. This is
   the "as little human intervention as possible" version of a lead handoff.
4. Human assignment in WhatsApp remains only for: frustration/complaints,
   explicit "quiero hablar con una persona", repeated bot failure, and
   VIP/edge cases. Not for orders.
5. Attachments policy becomes consistent with the single channel: print files
   are **never accepted via WhatsApp** — every attachment response points to
   email (§5).

This is a prompt + two-node change conceptually (summary message + SMTP node),
not a rebuild, but decide it before go-live because it changes the system
prompt's order-intake section and the escalation metrics.

---

## 5. Audio, images and documents (requirement 4) — tiered plan

Today: any non-text message gets one generic canned reply (duplicated per
attachment, see §2). Attachments arrive in the Chatwoot webhook as an
`attachments[]` array with `file_type` and a `data_url` to download. Known
Chatwoot 4.4.x regressions around WhatsApp media 404s — test on the deployed
version before building on it.

- **Tier 0 (go-live): typed canned responses + dedupe.** Branch on
  `file_type`: audio → "no puedo escuchar audios, escribime el texto"; image →
  acknowledge + ask for text; document → "los archivos van por email a X,
  acá te paso qué incluir". Once per burst, not per attachment.
- **Tier 1 (first weeks): audio transcription.** Voice notes are the #1 real
  gap for Argentine customers. Options, all compatible with the flow
  (download `data_url` → transcribe → inject as text into the normal path):
  - **Gemini multimodal via the same model**: send the audio in the LLM call
    itself. Fewest moving parts, no new vendor.
  - **Groq Whisper** (whisper-large-v3-turbo): ~US$0.04 per audio-hour —
    effectively free at this volume, an n8n template exists. Tradeoff flag:
    paid closed SaaS (tooling rule), though trivially replaceable.
  - **Self-hosted faster-whisper** (small/base model): fits the KVM 4 CPU for
    short notes, satisfies the open-source rule, adds an operational moving
    part. Reasonable v2 if the rule matters more than simplicity.
- **Tier 2: images through the multimodal LLM.** Gemini Flash accepts images
  via OpenRouter. Classify then act: reference photo of a job → fold into the
  spec summary (§4); screenshot of a question → answer it. Never claim to have
  "received the design for printing" — files go by email.
- **Tier 3: documents/PDFs — do NOT parse them.** For a print shop an inbound
  PDF is the print asset, not a question. Market bots acknowledge + route;
  parsing adds cost, latency and hallucination surface for zero funnel value.
  Acknowledge + redirect to email, always.

---

## 6. Meta ban protection (requirement 2)

The existing research holds up against 2026 policy (re-verified): task-specific
business bots are explicitly permitted; the AI-provider ban targets
general-purpose assistants; enforcement is behavioral (blocks/reports), not
AI-detection. Operational checklist for go-live:

1. **Business Verification before launch** (currently deferred). Since Oct
   2025, messaging limits are portfolio-level and unverified businesses cap at
   250 unique customers/24 h for messages **outside** the service window.
   A reactive bot lives inside the window, so the cap rarely binds, but
   verification also unlocks trust, display-name approval and higher tiers,
   and the client-owned setup needs it anyway.
2. **Ownership separation** (registry rule): WABA, number, Meta Business
   account, AI API keys — all under TG's accounts, not Martin's. The prepaid
   SIM question stays formally unresolved (research found no first-party
   evidence either way); behavior rules dominate. Keep the SIM alive and
   documented; consider migrating to a TG-owned line number when convenient.
3. **Stay reactive.** No cold outreach, no marketing templates at launch, only
   the 3 pre-approved Utility templates from the README checklist. Ramp
   gradually, no volume spikes.
4. **Quality monitoring as an alert, not a habit**: subscribe the WABA webhooks
   for quality/limit updates and pipe to Telegram; check the quality rating
   weekly in the Hermes digest.
5. **Silence protects quality too.** Replying to hostile/spam traffic invites
   blocks ("Spam" block reason is the heaviest signal). The §1b caps double as
   ban protection.
6. **Human escalation path is a Meta requirement** for automation — already
   built; keep it visible in the bot's language.
7. **Never test on the prod number.** Separate test number/WABA.
8. **Policy watch**: the AI-provider terms are under active antitrust pressure
   (Italy suspension, EC probe) and may change; the Hermes weekly security
   digest should include Meta terms/pricing announcements through at least
   October.

---

## 7. Concurrency, queue mode, Kubernetes and the KVM 4 (his infra bullets)

Reality check on load: ~900 conversations/month ≈ 100-300 webhook executions
per day with bursts of a few per minute. n8n community sizing puts a single
instance + Postgres comfortably up to ~1,000 executions/**day**; queue mode
territory starts around 1k-10k/day. You are 10-100× below the line, and the
per-conversation debounce serializes most of the concurrency anyway.

- **Do now (cheap, real):**
  - Move n8n's own DB from default **SQLite to Postgres** (`DB_TYPE=postgresdb`
    against the box's Postgres). SQLite is the actual production risk (locking,
    durability, no sane backups), not the lack of workers.
  - Pin the n8n image (no `:latest`), set
    `N8N_CONCURRENCY_PRODUCTION_LIMIT≈10-20` as a burst safety valve, set
    execution-data pruning so the DB doesn't bloat, keep `WEBHOOK_URL` correct.
- **Queue mode: defer, but keep the door open.** It is the right move when the
  second client lands (multi-tenant) or executions approach ~1k/day. It is a
  config migration (Redis broker + worker containers + shared encryption key +
  Postgres already in place), not a rewrite — a planned afternoon, so nothing
  needs pre-building today. This matches the existing roadmap ("before the 2nd
  client: queue mode").
- **Kubernetes: no.** On a single VPS, k3s adds RAM overhead, a new failure
  domain and a new skill tax, and buys nothing: no second node means no HA —
  the VPS remains the single point of failure either way. Market bots get
  their resilience from managed multi-node platforms, which is not this
  deployment. Compose + `restart: unless-stopped` + healthchecks + monitoring
  + rehearsed restore delivers the same practical availability here. Revisit
  only if productization reaches "pods of 10-20 clients per server" and even
  then compose-per-VPS (or Coolify, per the VPS guide) is the 80/20.
- **KVM 4 (4 vCPU / 16 GB / 200 GB NVMe): right-sized.** Chatwoot + Sidekiq +
  Postgres + Redis + n8n + monitoring ≈ 4-6 GB RAM and modest CPU at this
  volume — big headroom, including the eventual quote-system migration the VPS
  guide contemplates. The real latency bottleneck is the 5 s debounce + LLM
  call, not the hardware: drop debounce to ~3 s and cache the catalog (§9) to
  land most replies in ~4-6 s, which is at or better than market bots.

---

## 8. Instagram + Messenger later (requirement 3)

The architecture already carries over: Chatwoot normalizes every channel into
the same conversations/messages/webhooks, so the n8n flow needs a channel
allowlist instead of the hardcoded `Channel::Whatsapp` equality (channel
classes: `Channel::FacebookPage`, `Channel::Instagram`), plus per-channel
tweaks (greeting, no WhatsApp-specific template logic).

The hard part is **Meta App Review for self-hosted**: your own Meta app with
Advanced Access (`instagram_business_basic`, `instagram_business_manage_messages`,
`human_agent`, pages-messaging for Messenger), mandatory business verification,
screencasts, privacy policy. Documented pain: self-hosted operators failing
review repeatedly, and a known circular blocker where the Messenger OAuth flow
requests Instagram scopes and gets the Messenger-only review rejected
(chatwoot#13860). Some 4.x releases also had IG events processed but not
displayed — pin a version where the channel is known-good.

Plan: do **not** block the WhatsApp go-live on this; start the app-review
paperwork in parallel (weeks of lead time), reuse the same funnel rules
(info-only + email intake), and note that IG/Messenger have their own messaging
windows (24 h + `human_agent` 7 d) which a reactive bot respects by default.

---

## 9. Model and prompt lifecycle

- **Forced model migration lands the same month as the pricing change:**
  `gemini-2.5-flash-lite` shuts down **2026-10-16** (confirmed on Google's
  deprecations page). Do the cheap insurance now (already an accionable in
  mantenimiento-y-monitoreo): OpenRouter fallback array/preset including the
  successor, then a promptfoo regression run + a red-team pass on the new model
  before October, not during the fire.
- **Successor decision (researched 2026-07-07).** Constraints: cheapest,
  fewest hallucinations, ideally native audio. Verdict:
  - **Primary: `google/gemini-3.1-flash-lite`** — the designated successor
    (GA since May 2026), $0.25/M in / $1.50/M out, **native audio input**
    ($0.50/M ≈ $0.001 per voice note), implicit caching, available on
    OpenRouter. 2.5-3.75× today's price but still $5-15/month at this volume.
    Two open items: its HHEM faithfulness score is unpublished (the current
    model scored 3.3%, top-3 ever measured — high bar), and there's an
    unresolved report of implicit-cache savings not applying on billing —
    verify both before committing.
  - **Challenger/fallback: `openai/gpt-5.4-nano`** — $0.20/$1.25, **HHEM 3.1%
    (best grounded-faithfulness on the leaderboard)**, automatic caching. No
    audio: pairs with a transcription step (Groq whisper-turbo $0.04/audio-hr,
    or self-hosted faster-whisper), which also yields a loggable transcript
    for `bot.decisiones`. Set it as the second entry in the OpenRouter preset.
  - **Dropped: Claude Haiku 4.5** (old shortlist) — 9.8% HHEM, $1/$5 (4-10×
    rivals), no audio, and its 4,096-token prompt-caching minimum exceeds this
    bot's ~2.5k system prompt so caching wouldn't engage.
  - **Budget floor, emergency-fallback only:** deepseek-v4-flash ($0.09/$0.18
    on OpenRouter) / qwen3.5-flash — cheapest but mid-pack faithfulness (~5-6%).
  - **Decision gate:** run the promptfoo suite + the real-catalog battery
    (sinónimos, gremio price test, order-intake) against both candidates; pick
    on measured faithfulness. From October the WhatsApp per-message fee
    (~$0.026) dwarfs LLM cost per reply (~$0.001-0.003), so faithfulness, not
    price, should decide.
- **Prompt caching + catalog caching are one project.** The catalog SQL runs on
  every message; its output is interpolated into the system prompt. Cache the
  catalog string in n8n (TTL 5-15 min): one DB query per interval instead of
  per message, a stable prompt prefix (which is what makes provider-side
  prompt caching actually hit), lower latency, and the §2 DB-failure fallback
  for free (serve stale on error).
- **Consider direct Google API for prod** (explicit safety_settings, first-party
  caching) with OpenRouter kept as the failover/switch layer — the
  provider-agnostic principle stays, the default route changes. Not a gate.
- **Structured output for routing** (§2): replaces the ESCALAR sentinel and
  future-proofs for Increment B actions (show price / escalate / ask).
- **Evals need a flow layer.** promptfoo currently tests the raw model+prompt;
  none of the deterministic guards (regex, routing, debounce, gates) are under
  test. Add a small scripted-webhook suite against a staging Chatwoot (send
  crafted payloads, assert on the Chatwoot conversation state). Feed the golden
  set from real `bot.decisiones` phrases, as already planned. Run both suites
  before any n8n/model/prompt upgrade — that is what "updates don't silently
  break the funnel" looks like with minimal human time.
- **Logging completeness** (feeds requirement 1): add the known-missing
  actions (`fuera_de_tema`, `producto_resuelto`) so `informo_capacidad` stops
  conflating resolution with bluffing, add a per-conversation reply counter
  (feeds cost alerts + strike system), and keep the weekly 5-conversation
  forced sampling as the ground truth. The catalog gap already caught by the
  loop ("fotocopias/copias" = #1 query with no product mapping) is exactly the
  kind of fix that should ship weekly.

---

## 10. Operations the client will feel (requirement 1)

- **Business hours.** The proposal promises a ≤5 min human SLA in hours; the
  bot runs 24/7. Out of hours, escalations must set expectations ("te
  respondemos a partir de las 8:00") instead of promising "en breve". One
  hours-aware branch on the escalation message. In-hours, the Chatwoot SLA rule
  (§2) enforces the promise.
- **Runbook (one page, in this folder):** deploy/rollback, restore-from-backup,
  kill switch criteria and procedure, "bot responde cualquier cosa" incident
  path, "number quality dropped / number blocked" path (appeal + client
  comms fallback), model-migration checklist. Market-grade is mostly this:
  boring, written-down recovery.
- **Weekly cadence (~15 min, honest floor for "minimal human intervention"):**
  Hermes digest = security advisories + Meta policy/pricing watch + bot quality
  sampling (5 lost conversations) + cost counters + synonym/catalog queue.
  Everything else (uptime, disk, backups, CVE patching, restarts) is automated
  by the Layer 1 + unattended-upgrades setup.
- **Commercial hygiene:** update `propuesta-cliente.md` (WhatsApp line item per
  §1a; note that the AI cost estimate already assumed caching) and make the
  abono explicitly cover the October double-event (model migration + pricing
  switch) — it is scheduled work you already see coming.

---

## 11. Prioritized punch list

**P0 — go-live gates (order roughly by dependency):**
1. Close the webhook hole: n8n internal-only (or HMAC), remove the ZT Everyone bypass for `/webhook/*`.
2. Catalog cache + DB-failure fallback; LLM error branch; global n8n Error Workflow → Telegram + human assignment.
3. Chatwoot SLA/automation safety net for "bot down".
4. ESCALAR routing hardening (or structured output).
5. Non-text: typed responses + once-per-burst dedupe; email-redirect policy for files.
6. Funnel realignment to email intake (§4) + business-hours-aware escalation message.
7. Anti-abuse/cost layer: per-user reply caps, strike→silence, blocklist check, OpenRouter spend cap, daily reply-count alert, kill-switch variable.
8. n8n on Postgres, pinned version, concurrency limit, pruning; export the real v5 (no placeholders), parametrize ids/URLs; rewrite setup guide to v5.
9. VPS: KVM 4 hardening per the guide; monitoring Layer 1; encrypted backups to R2 + rehearsed restore (including `N8N_ENCRYPTION_KEY`, `SECRET_KEY_BASE`).
10. Meta: business verification, display name, 3 Utility templates, quality webhooks → Telegram; all accounts under TG ownership; separate test number.
11. Point the bot at the prod Supabase (per-env credentials), `bot.decisiones` retention defined.
12. Fix `propuesta-cliente.md` pricing (October service-message cost).

**P1 — first weeks in prod:**
13. OpenRouter model fallback preset + promptfoo pass on the successor model (hard deadline: before 2026-10-16).
14. Audio transcription tier (Gemini multimodal or Groq; faster-whisper if the open-source rule wins).
15. Image handling via multimodal.
16. n8n Guardrails node (Jailbreak + Topical Alignment) wired into the strike system.
17. Logging completeness (`fuera_de_tema`, `producto_resuelto`, reply counters) + Hermes weekly digest live.
18. Flow-level eval suite (scripted webhooks vs staging Chatwoot).
19. Prompt caching verification (headers) once catalog caching stabilizes the prefix.

**P2 — scale / product track:**
20. Increment B (list prices on demand; `tiene_reglas` still escalate) — after the loop shows N1/N2 resolution is stable.
21. Instagram + Messenger: start Meta app review paperwork early; channel allowlist refactor when approved.
22. Queue mode (Redis broker + workers) when the 2nd client or ~1k executions/day arrives; multi-tenant parametrization (per-inbox prompt/config).
23. Output guard + faithfulness judge when priced answers ship; pgvector decision from real log phrases.
24. Direct Google API as primary route with OpenRouter failover.

---

## Sources / provenance

- Flow facts: dissection of `n8n/flows/faq-bot-v5.json`, `n8n/prompts/system-prompt-tg.md`, `n8n/setup-guide.md`, `n8n/catalog-v5-build.md`, `promptfoo/*` (2026-07-07).
- October pricing: ChakraHQ / hello-charles / Zernio / Flowcall (all reporting Meta's 2026-07-01 announcement; **not yet on Meta's own pricing page** — re-verify ~Sept 2026). AR utility rate ~$0.026 per current rate cards.
- n8n scaling: n8n queue-mode + concurrency docs; community sizing guidance (~1k exec/day threshold).
- Chatwoot channels: Chatwoot IG channel docs + Instagram App Review guide; issues #13860, #12191, #11577/8, #11983, #12144, #12265.
- Media: Groq pricing ($0.04/h turbo), OpenAI STT pricing, faster-whisper CPU guidance, n8n community templates for Chatwoot/WhatsApp media.
- Meta policy/ban: repo research `research/meta-ai-whatsapp-reglas-y-riesgo-baneo.md` (2026-06-22) re-verified 2026-07-07; portfolio-level messaging limits (Oct 2025); Block Users API docs; AGCM/EC antitrust status.
- Hostinger KVM 4: 4 vCPU / 16 GB / 200 GB NVMe (VPSBenchmarks/Hostinger, 2026).
