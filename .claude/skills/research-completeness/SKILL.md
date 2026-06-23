---
name: research-completeness
description: Enforce real-world completeness on any software / architecture / infrastructure research or implementation plan. Trigger whenever Martin asks Claude to research, compare, evaluate, choose, or plan anything technical — a tool, library, framework, service, hosting/infra, data model, integration, protocol, or migration. Forces coverage of the dimensions Claude tends to skip (cost, security, UX, scalability, ops, compliance, lock-in), surfaces 2 strong alternatives plus the recommendation, and includes enterprise-grade options — not just what is popular online.
bike-method-phase: 1  # Phase 1 — Training wheels. Run manually first; validate the output before trusting it.
three-ms-attribution: |
  Adapted from The Three Ms of AI™ © 2026 Nate Herk. All rights reserved.
  The Three Ms of AI™ is a trademark of Nate Herk.
---

# Research / Plan Completeness Enforcer

> Scoped via `/level-up` on 2026-06-23. See `decisions/log.md` (2026-06-23 entry) for the full Method spec and KPI.

## The problem this solves

When Martin asks for research or an implementation plan, the default answer reads clean but skips the dimensions that decide real-world viability — pricing, security, UX, scalability, ops, compliance. The gaps surface only on re-read, costing a re-prompt every time and risking a client decision that missed something. This skill makes the gaps **visible by default**: every dimension is either covered or explicitly marked N/A *with a reason*. Silent omission is the failure mode; this kills it.

**Autonomy level: L2 (Drafted).** Claude drafts the complete research; Martin reviews and decides. The skill does not pick for him — it guarantees the decision surface is complete.

## When this fires

Any request to research, compare, evaluate, choose, recommend, or plan something technical: a tool, library, framework, language, service, hosting/VPS/infra, database, data model, queue, auth approach, integration, API, protocol, or migration path. If in doubt whether it's "technical enough," apply it — the cost of running the rubric is low; the cost of a missed dimension is rework or a bad client call.

## The rubric — cover every applicable dimension

For the thing being researched or planned, address each. If one genuinely does not apply, **write "N/A — <reason>"**. Never drop one silently.

1. **Cost / pricing** — real numbers, not "affordable." Free tier limits and where they break, paid tiers, cost-to-serve per client/unit, hidden costs (egress, seats, overages), and how cost scales with growth. Use ARS where Martin operates, with a USD reference.
2. **Security** — auth model, secret handling, data exposure / blast radius, RLS or access control, known CVEs or a bad track record, defaults that are unsafe.
3. **UX** — for end users and for Martin as operator/admin. Setup friction, day-2 operation, the failure UX (what the user sees when it breaks).
4. **Scalability** — behavior from one client to many. Where the first bottleneck appears, per-client vs shared-resource model, what breaks at 10x.
5. **Ops / maintenance** — who keeps it running, upgrade cadence, breaking-change risk, backups, observability, what rots if untouched for a month.
6. **Compliance / legal** — licensing (esp. for resale — copyleft vs permissive), data residency, platform ToS, anything that bites when reselling to clients.
7. **Lock-in / reversibility** — how hard to migrate off, proprietary formats, exit cost. Cheap to leave beats cheap to enter.
8. **Maturity / track record** — age, maintenance activity, community size, production adoption, bus-factor. Is it abandonware risk?

Not every dimension carries equal weight for every question — lead with the ones that decide it, but account for all eight.

## Three standing rules (Martin's caveats)

These are mandatory, not optional polish:

1. **Always present at least 2 strong alternatives, plus the recommendation.** Make each alternative the best version of its case, not a strawman set up to lose. The goal is a real decision surface, not a foregone conclusion. State explicitly what would make each alternative the right pick.

2. **Constraints are a lens, not a hard filter.** Martin's standing constraints — tools should be free or self-hostable open-source AND Claude-connectable; ARS pricing; small-local-business scale — guide the default recommendation. But if a better option sits *just outside* a constraint (e.g. a paid SaaS, a closed model, a heavier tool), **surface it anyway and name the tradeoff** so Martin can make the call. Don't pre-filter the genuinely-better option out of the conversation.

3. **Include enterprise-grade, not just popular.** Don't stop at "what the internet says is most used / best for indie devs." Also surface what a serious production / enterprise setup would choose for this, and say why it's heavier — so Martin sees the full ladder from scrappy to robust, even if he picks scrappy today.

## Output shape

Default to this structure unless Martin asks for something looser:

1. **One-line framing** — what's being decided and the key axis it turns on.
2. **Options table** — recommendation + 2 alternatives + (where relevant) the enterprise-grade option, scored across the rubric dimensions that matter most for this decision.
3. **The recommendation** — what to pick *for Martin's situation now*, and the single condition that would flip it.
4. **Dimension notes** — anything load-bearing or non-obvious per rubric dimension; explicit N/As with reasons.
5. **What I'm unsure about** — open questions, things needing first-source verification, assumptions made.

Keep it terse and bulleted (Martin's voice rule). Numbers over adjectives. If the research output is decision-worthy, suggest logging it to `decisions/log.md`.

## Sourcing

Prefer current first-party docs (use the Context7 MCP for library/framework/SDK docs; web search for pricing, ToS, CVEs, and recent changes) over training-data memory — pricing and platform terms change. For anything Martin would bet a client on, flag claims that need first-source verification rather than asserting them.

---

> *The Three Ms of AI™ is a trademark of Nate Herk. © 2026 Nate Herk. All rights reserved.*
