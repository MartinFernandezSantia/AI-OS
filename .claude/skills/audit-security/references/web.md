# Web layer audit checklist

Load this reference when auditing HTTP request handlers, web framework code, server actions, or any code that processes input from the network.

## Input validation and sanitization

- Every input crossing a boundary (query params, route params, body, headers, cookies, uploaded files) is validated by schema before use.
- Validation runs on the server side, even when the client also validates.
- Validation rejects unknown fields by default. No silent passthrough of extra properties.
- Type coercion is explicit — no relying on framework auto-coercion for security-sensitive fields (IDs, amounts, permissions).
- Sanitization is distinct from validation. HTML, SQL, shell, URL, and template contexts each require context-specific encoding when output.

## Authentication and authorization

### Authentication

- Every protected route or action verifies an authenticated session before executing logic.
- Session state is read from a trusted source (signed cookie, server-side session store, validated JWT), not from request body or headers controlled by the client.
- No path-based or method-based assumptions about who is authenticated. Every handler checks explicitly.
- Logout invalidates the session server-side, not only client-side cookie deletion.

### Authorization

- Authorization checks are performed after authentication on every protected resource access. Authentication ≠ authorization.
- No reliance on UI hiding to enforce authorization. Server validates every action.
- Permission checks use the authenticated user from session, not from request input.
- Multi-tenant code verifies the authenticated user has access to the tenant being queried — not only that the user is authenticated.

### Sessions and tokens

- Session cookies have `HttpOnly`, `Secure` (in production), and an appropriate `SameSite` attribute.
- Session IDs are regenerated on privilege change (login, password change, role change).
- Session expiration is enforced server-side, not only via cookie expiration.
- Refresh tokens, if used, are stored server-side or in `HttpOnly` cookies — never accessible to JavaScript.
- JWT validation includes signature, expiration (`exp`), issuer (`iss`), audience (`aud`) when applicable. No `alg: none`.

## CSRF

- All state-changing endpoints (POST, PUT, PATCH, DELETE) are protected against CSRF.
- Protection mechanism is verified: CSRF token, double-submit cookie, `SameSite=Strict` or `Lax` cookie, or origin/referer validation.
- API endpoints consumed only by SPAs with bearer tokens (no cookies) are exempt — confirm cookies are not used for auth on those endpoints.

## CORS

- `Access-Control-Allow-Origin` is not `*` when `Access-Control-Allow-Credentials: true`.
- Allowed origins are an explicit allowlist, not reflected from the request `Origin` header without validation.
- Allowed methods and headers are minimal — no blanket `*` unless justified.
- Preflight cache (`Access-Control-Max-Age`) is reasonable.

## Security headers

Verify these headers are set on responses (typically via middleware or framework config):

- `Content-Security-Policy` — restrict script, style, img, connect sources. No `unsafe-inline` or `unsafe-eval` unless justified with a nonce or hash.
- `Strict-Transport-Security` — present in production with reasonable `max-age`.
- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY` or `SAMEORIGIN`, or equivalent CSP `frame-ancestors`.
- `Referrer-Policy` — at least `strict-origin-when-cross-origin`.
- `Permissions-Policy` — restrictive defaults for sensors, camera, microphone, geolocation if not used.

## Rate limiting

- Endpoints that can be abused are rate-limited: login, password reset, signup, password change, contact forms, search, expensive queries, file uploads.
- Rate limit key is appropriate (per IP, per user, per API key, or composite). Per-IP alone is insufficient for authenticated abuse.
- Failures return `429 Too Many Requests` with `Retry-After`, not `500`.
- Distributed deployments use a shared store (Redis or equivalent) — not per-instance memory.

## File uploads

- File type validated by content inspection (magic bytes / MIME detection from content), not only by extension or client-supplied `Content-Type`.
- File size limited at multiple layers: framework, reverse proxy, application logic.
- Filename sanitized — no path traversal characters, no shell metacharacters, no double extensions used to bypass type checks.
- Files stored outside the web root or in a separate origin / bucket. Never served from the upload directory directly.
- Uploaded files are not executable on the server. Verify the storage location has no execution permissions and the web server does not interpret them as scripts.
- Images are re-encoded or validated structurally if displayed. SVG uploads require sanitization (can contain scripts).

## SSRF

- Any outbound HTTP request whose target URL is derived from user input validates the destination:
  - URL must be HTTPS (or HTTP with explicit justification).
  - Host must be on an allowlist OR explicitly not on a blocklist of internal ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`, metadata IPs like `169.254.169.254`).
- DNS resolution result is validated, not only the input string — DNS rebinding bypasses string-only checks.
- Redirects are not blindly followed when the initial target was user-derived.

## Open redirects

- Redirect targets derived from query params or input are validated against an allowlist or restricted to same-origin relative paths.
- Reject absolute URLs, protocol-relative URLs (`//evil.com`), and URLs with backslashes that some parsers normalize.

## Mass assignment / over-posting

- Endpoints that accept objects whitelist allowed fields before passing to ORM or business logic.
- No spreading of request body directly into create/update operations: `User.create({...req.body})` is a finding.
- Sensitive fields (`role`, `isAdmin`, `tenantId`, `userId`, `permissions`, `verified`, `balance`) are never settable from request input on user-facing endpoints.

## IDOR (Insecure Direct Object Reference)

- Access to a resource by ID verifies the authenticated user owns or has permission to access that resource, not only that the ID exists.
- Pattern to flag: `findById(req.params.id)` returned to the user without ownership check.
- Applies to read, update, and delete operations on any resource referenced by ID.
- Sequential or guessable IDs amplify the risk. UUIDs reduce but do not eliminate the need for authorization checks.

## Race conditions in handlers (TOCTOU)

- Operations that check-then-act on a resource use atomic operations or proper locking:
  - Stock decrement, balance debit, token consumption, idempotency keys.
- Permission checks immediately before privileged operation, not at handler entry — state may change in between.
- Idempotency for non-idempotent operations (payments, charges) implemented with a unique request key, not best-effort dedupe.
