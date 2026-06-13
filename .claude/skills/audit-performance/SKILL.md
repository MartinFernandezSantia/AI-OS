---
name: audit-performance
description: Performance audit checklist for code reviews. Used by the code-reviewer agent to detect performance issues in delivered code. Covers frontend (bundle, rendering, data fetching, assets, Core Web Vitals) and backend (queries, memory, I/O, cache, async operations).
---

# Performance audit checklist

This skill provides the performance audit checklist for the code-reviewer agent. Apply the general criteria below to all code, then load only the references relevant to the code being reviewed.

## How to use this skill

1. Review the **general criteria** below before loading any reference.
2. Load the references relevant to the code being reviewed:
   - Components, screens, client-side logic, styling → `references/frontend.md`
   - APIs, services, queries, business logic, jobs → `references/backend.md`
3. If the code spans both layers, load both references.
4. Report findings in the `## Performance findings` section of the code-reviewer output. Do not mix performance findings with code quality findings.

## General criteria

### Evidence requirement

Only flag performance issues with a real signal:
- A pattern is known to cause measurable degradation at realistic data volumes or request rates.
- The issue is visible at development scale (e.g. a query in a loop, a blocking operation on the main thread).
- The project CLAUDE.md defines a performance target this code demonstrably misses.

Do not flag speculative or micro-optimization issues ("this could be slow if the dataset grows to millions"). Flag concrete patterns with known impact.

### Finding classification

Before reporting a finding, classify it:

- **Requires fix** — a concrete code change resolves it without architectural decisions (parallelize two fetches, add a missing index, remove an unnecessary re-render). Report as a finding with a suggestion.
- **Requires architectural decision** — the fix involves caching infrastructure, async job queues, CDN configuration, or schema changes the backend agent cannot decide unilaterally. Report as an open question to the orchestrator, not as a finding with a suggestion.

### Severity calibration

- **Critical** — causes failure or severe degradation under realistic load (unbounded memory growth, query that locks a table, synchronous operation that blocks the event loop for seconds).
- **High** — measurable degradation at expected scale (N+1 query on a paginated list, large bundle blocking initial render, missing index on a high-frequency filter).
- **Medium** — clear improvement available without urgency (sequential fetches that could be parallel, missing lazy loading on below-fold images, redundant re-renders on stable data).
- **Low** — minor improvement, low impact (unused import adding negligible bundle weight, memoization that would save trivial computation).

### Zero-cost optimizations

Apply zero-cost optimizations (those that do not add complexity, dependencies, or infrastructure) directly without flagging — consistent with the global CLAUDE.md performance principle. Only flag issues that require a deliberate decision or code change beyond the immediate implementation.

## Additional resources

### Reference files

- **`references/frontend.md`** — Bundle size, rendering, data fetching, images and assets, Core Web Vitals patterns.
- **`references/backend.md`** — Database queries, memory, I/O, cache, jobs and async operations.
