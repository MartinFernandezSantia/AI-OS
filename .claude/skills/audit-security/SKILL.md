---
name: audit-security
description: Security audit checklist for code reviews. Use when auditing code that receives external input, handles auth/authz/sessions, accesses sensitive data, executes external-effect operations, or touches databases or third-party integrations. Loaded by the security agent.
---

# Security audit checklist

This skill provides the audit checklist for the security agent. Apply the cross-cutting checks below to every audit. Then load only the references relevant to the code being audited.

## How to use this skill

1. Apply the **cross-cutting checks** below to all code under audit.
2. Identify which domains the code touches and load the corresponding references:
   - HTTP layer, request handlers, web framework code → `references/web.md`
   - Database queries, ORM usage, RLS policies → `references/database.md`
   - Webhooks, outbound API calls, OAuth flows, third-party SDKs → `references/integrations.md`
3. If the code spans multiple domains, load all relevant references.
4. Report findings using the format defined in the security agent file. Severity calibration also lives there.

## Cross-cutting checks

Apply these to every audit regardless of domain.

### Secrets handling

- No hardcoded credentials, tokens, API keys, private keys, or connection strings in source code.
- No secrets committed to the repository — check for `.env`, key files, or credentials in test fixtures.
- Secrets read from environment variables or a secrets manager, never from user input or untrusted sources.
- No secrets in error messages, logs, stack traces, or HTTP responses.
- No secrets in URLs, query strings, or referrer headers.

### Sensitive data in logs

- Verify the logger's redact configuration covers all domain-sensitive fields, not only generic ones (`password`, `token`).
- No full request or response bodies logged without filtering.
- No PII logged unless strictly necessary and justified.
- No session cookies, auth headers, or refresh tokens in logs.

### Error messages

- User-facing errors must not reveal stack traces, file paths, internal queries, framework internals, or library versions.
- Distinguish generic message to the user from detailed log on the server.
- Validate this even when the project follows the global error handling principles — confirm no internals leak.

### Timing attacks

- Comparison of secrets, tokens, hashes, or HMACs uses constant-time comparison, not `===`, `==`, or `String.equals`.
- Applies to: password verification, API key checks, signature verification (webhooks, JWT), token comparison.

### Dependency vulnerabilities

- If a lockfile is present (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `poetry.lock`, `Gemfile.lock`, `go.sum`, `Cargo.lock`), flag that the orchestrator should run the corresponding audit command (`npm audit`, `pnpm audit`, `pip-audit`, `bundle audit`, `govulncheck`, `cargo audit`). Do not run these yourself — they may have side effects.
- Flag visibly outdated versions of critical dependencies (auth libraries, frameworks, crypto libraries, ORMs) even if no CVE is immediately known.
- If no lockfile is present, flag it in `Open questions`.

### Reporting unaudited areas

If you cannot audit a relevant area due to missing context, missing lockfile, missing configuration, missing access to infrastructure, or environment variables that cannot be verified, state it explicitly in `Open questions`. Silent omission of unaudited areas is not acceptable.

### Verification mode

When re-invoked to verify a fix, audit only the changed code and adjacent affected areas. Confirm the original finding is resolved and check that the fix did not introduce new issues. Do not re-audit unrelated code.

## Additional resources

### Reference files

- **`references/web.md`** — HTTP layer audits: input validation, auth/authz/sessions, CSRF, CORS, security headers, rate limiting, file uploads, SSRF, open redirects, mass assignment, IDOR, race conditions in handlers.
- **`references/database.md`** — Database audits: SQL injection, ORM escape hatches, Supabase RLS and service role handling, transactional race conditions.
- **`references/integrations.md`** — Third-party integration audits: inbound webhooks, outbound API calls with credentials, OAuth flows, secret rotation in integrations.
