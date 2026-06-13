# System design checklist

Reference for the `design-system` skill. Work through every area for each plan.
If an area does not apply, state why — do not skip silently.

---

## Infrastructure

- What runtime environment is required (server, serverless, edge, worker)?
- Where will the system be hosted? What is the deployment strategy?
- Are there environment-specific requirements (dev / staging / prod)?
- Does the system need horizontal scaling? At what point?
- Is there a CI/CD pipeline? What does it need to support?

---

## Data

- What data does the system persist? Who owns it?
- What DB engine fits the access patterns (relational, document, key-value)?
- What is the schema at a high level? Which entities and relationships are core?
- Are there irreversible decisions here (schema migrations, data formats)?
- Does any data need to be shared across modules, or is ownership clear?
- What is the data retention policy?

---

## Cache

- Are there reads expensive enough to warrant caching?
- What layer is appropriate (in-memory, distributed, CDN, query-level)?
- What gets cached? What is the TTL?
- What is the invalidation strategy?
- If caching is not needed now, at what scale would it become necessary?

---

## Auth

- What authentication mechanism is required (session, JWT, OAuth, API key)?
- What roles or permission levels does the system need?
- How are sessions managed (expiry, refresh, revocation)?
- How are tokens stored and transmitted securely?
- Are there multi-tenant concerns (data isolation between clients)?

---

## Integrations

- What external services does the system depend on?
- What protocols are used (REST, webhook, queue, SDK)?
- How are credentials managed and rotated?
- What happens when an integration is unavailable? Is degraded mode acceptable?
- Are there rate limits on the external service that affect design?

---

## Rate limiting

- Which endpoints or operations are exposed to abuse or high volume?
- At what layer should rate limiting be applied (API gateway, app, service)?
- What are the limits and what happens when they are exceeded?

---

## Backups

- What data must be backed up?
- How frequently? What is the retention period?
- How is recovery tested? What is the RTO/RPO expectation?
- Are backups stored separately from the primary data store?

---

## Maintenance mode

- How can the system be taken offline without breaking active clients?
- Is there an env var that redirects all traffic to a maintenance screen?
- What does the user-facing experience look like during maintenance?
- Does the mobile/API client handle maintenance mode responses gracefully?

---

## Data collection & audit

- What user actions or system events need to be tracked for business purposes?
- Are there compliance or legal requirements for audit trails?
- Who needs access to this data? How is it queried?
- How long must audit data be retained?

---

## Cost considerations

- What is the estimated cost at current scale? At 10x?
- Are there components with variable cost that could spike unexpectedly?
- Are there cheaper alternatives for low-usage features?
- What is the cost of the external integrations at scale?
