# Integrations audit checklist

Load this reference when auditing code that handles inbound webhooks, makes outbound API calls with credentials, implements OAuth flows, or integrates with third-party SDKs.

## Inbound webhooks

### Signature verification

- Every webhook endpoint verifies the request signature using the shared secret provided by the third party. Skipping verification because "the URL is hard to guess" is a finding.
- Signature verification uses constant-time comparison (see cross-cutting checks in `SKILL.md`).
- The signed payload is the raw request body, not the parsed JSON — parsing changes whitespace and field order. Frameworks that auto-parse must expose the raw body for verification.
- Signature algorithm matches the provider's specification (HMAC-SHA256 for Stripe, GitHub, etc.). Verify the algorithm explicitly — do not assume.
- Signing secret is stored as an environment variable or in a secrets manager, never hardcoded.

### Replay protection

- Webhook handlers check the timestamp included in the signature (when the provider includes one) and reject requests older than a reasonable window (typically 5 minutes).
- Idempotency is enforced — the same event ID is not processed twice. Providers retry on non-2xx responses; without idempotency, side effects duplicate.
- Idempotency key storage has appropriate retention (longer than the provider's retry window).

### Endpoint exposure

- Webhook endpoints are documented as such. They are not co-located with user-facing endpoints that share middleware (auth, CSRF) which may not apply.
- Webhook endpoints do not return sensitive data in the response body — providers do not need it, and verbose responses can leak information.
- Logging of webhook payloads excludes sensitive fields (PII, payment details, full event bodies for events that contain secrets).

### Authorization within the payload

- If the webhook claims to act on behalf of a user or resource, verify the claim against the database. A signed webhook only proves it came from the provider — it does not authorize arbitrary state changes.
- Multi-tenant webhooks verify the tenant referenced in the payload matches the account/connection that the secret belongs to.

## Outbound API calls

### Credential handling

- API keys, OAuth tokens, and service credentials are read from environment variables or a secrets manager. Never hardcoded, never committed.
- Credentials are not logged. Verify the logger and any HTTP client middleware do not log `Authorization` headers, request bodies containing tokens, or response bodies containing refreshed tokens.
- Errors raised from outbound calls do not include the full request — error reporters may serialize headers and body verbatim.

### TLS and certificate validation

- TLS certificate validation is enabled. Pattern to flag: `rejectUnauthorized: false`, `verify=False`, `--insecure`, `InsecureSkipVerify: true`, or equivalent.
- Custom CA pinning, if implemented, has a documented rotation procedure. Pinning without rotation is a future outage.

### Request construction

- URLs constructed for outbound calls do not interpolate untrusted input into the host or path without validation. See SSRF section in `references/web.md`.
- Query parameters and headers derived from user input are validated for injection (header injection via CRLF, query parameter pollution).

### Timeouts and retries

- Every outbound call has an explicit timeout. Default infinite timeouts cause cascading failures.
- Retries use exponential backoff with jitter. Aggressive retries amplify rate limit issues and can constitute abuse of the upstream service.
- Retries on non-idempotent operations require an idempotency key — otherwise retries can duplicate side effects.

### Response handling

- Response size is bounded. Large or streamed responses without limits can exhaust memory.
- Response content type is verified before parsing. Parsing JSON without checking can fail unsafely on HTML error pages.
- Status codes are checked explicitly. Pattern to flag: assuming success because the call did not throw.

## OAuth flows

### Authorization code flow

- `state` parameter is generated server-side, cryptographically random, and validated on callback. Missing or unvalidated `state` is a CSRF vulnerability in the OAuth flow.
- `state` is bound to the user's session, not only stored as a cookie that can be reused.
- PKCE (`code_verifier` / `code_challenge`) is used for public clients (SPAs, mobile apps) and recommended for confidential clients.
- `redirect_uri` is validated against an exact-match allowlist on both client and server sides — wildcards and partial matches are a finding.
- Authorization code is exchanged for tokens server-side, never in the browser when a confidential client is possible.

### Token storage

- Access tokens and refresh tokens are stored server-side or in `HttpOnly` cookies. Never in `localStorage`, `sessionStorage`, or accessible JavaScript scope.
- Token expiration is respected — expired tokens are not used and not retried indefinitely.
- Refresh token rotation is implemented if the provider supports it. Old refresh tokens are invalidated server-side after use.

### Scope minimization

- Requested scopes are the minimum required. Pattern to flag: requesting `*` or broad write scopes when read-only would suffice.
- Scope is verified on token receipt — providers may grant fewer scopes than requested.

## Secret rotation

- Long-lived secrets (API keys, OAuth client secrets, webhook signing secrets) have a documented rotation procedure. Even without active rotation, the system must support replacing them without downtime.
- Secrets used by the codebase are referenced indirectly (env var name, secrets manager key), not embedded — this is a precondition for rotation.
- When a provider supports multiple active secrets during rotation (overlapping validity windows), the code accepts both during the transition.

## Third-party SDK risks

- SDK initialization does not happen in module-level code with secrets read at import time — this complicates testing and secret rotation.
- SDK callbacks and event handlers do not trust SDK-provided data implicitly. Treat SDK input the same as any other external input.
- SDK telemetry, crash reporting, and analytics features may exfiltrate data. Verify what is sent and disable telemetry where it transmits sensitive data.
