# Database audit checklist

Load this reference when auditing code that queries the database, defines schemas, configures ORM, writes RLS policies, or executes migrations.

## SQL injection in raw SQL

- All SQL queries use parameterized statements. Values from any source other than constants in code are passed as parameters, not concatenated into the query string.
- Pattern to flag: string concatenation or interpolation into a query, including template literals (`` `SELECT * FROM x WHERE id = ${id}` ``).
- Identifiers (table names, column names) cannot be parameterized — when they must be dynamic, they must be validated against an explicit allowlist of known values before interpolation.
- `ORDER BY` and `LIMIT` clauses derived from input require explicit validation — many parameterizers do not accept them as parameters.
- Stored procedures called with dynamic SQL inside are not safe by virtue of being stored procedures.

## ORM-specific audits

### General

- ORM query builders are safe for values by default. Audit focuses on escape hatches.
- Any use of raw query methods (`prisma.$queryRawUnsafe`, `db.$executeRawUnsafe`, Drizzle's `sql.raw`, Sequelize's `sequelize.query` with `replacements: false`, Knex's `.raw` without bindings, TypeORM's `query()`) is a finding unless input is provably safe.
- Tagged template literals that the ORM treats as parameterized (`prisma.$queryRaw\`...\``, Drizzle's `` sql`...` ``) are safe for values but not for identifiers — verify identifiers are constants or validated.

### Field selection and exposure

- Queries returning user objects to the API must select fields explicitly. Pattern to flag: returning the entire model when it includes sensitive fields (`passwordHash`, `resetToken`, internal flags).
- ORM serializers, virtual fields, and lifecycle hooks may include sensitive data — verify.

### Migrations

- Migrations are reviewed for: data loss (drops, renames without preserving data), index changes that lock tables, default values applied to large tables (long locks).
- Migrations do not contain credentials, real production data, or hardcoded environment-specific values.

## Supabase-specific

### Row Level Security (RLS)

- RLS is **enabled** on every table accessible by the anon or authenticated role. A table without RLS enabled is publicly readable/writable through PostgREST when exposed.
- Policies exist for each operation that should be allowed: `SELECT`, `INSERT`, `UPDATE`, `DELETE`. Missing policy for an operation means the operation is denied (good) — but verify that intentional access has an explicit policy.
- Policies use `auth.uid()`, `auth.jwt()`, or `auth.role()` correctly. Compare against trusted JWT claims, not request input.
- `INSERT` policies use `WITH CHECK`, not `USING` (which is ignored for inserts).
- `UPDATE` policies should have both `USING` (which rows can be updated) and `WITH CHECK` (what the row must look like after update) — missing `WITH CHECK` allows users to update rows into states they could not insert.
- Policies that reference other tables must ensure those tables also have appropriate RLS — a permissive join can bypass intended restrictions.

### Service role key

- The `service_role` key bypasses RLS entirely. It must never be exposed to the client, embedded in mobile apps, or shipped in frontend bundles.
- Server code using the service role key must enforce authorization manually — RLS is no longer protecting it.
- Webhook handlers, edge functions, and admin endpoints that use the service role are high-risk audit targets.

### Anon vs authenticated role

- The anon key is public and embeddable in clients. Verify it does not grant access to tables it should not — RLS is the only protection.
- Anonymous policies should be narrowly scoped (e.g., read-only on public content). Avoid `USING (true)` for anon role on any table with sensitive columns.

### Storage buckets

- Bucket access policies are defined and reviewed. Public buckets are intentional, not accidental defaults.
- File upload paths derived from user input are validated — `userId/filename` patterns must verify `userId` matches `auth.uid()`.

### Database functions and triggers

- `SECURITY DEFINER` functions run with the privileges of the function owner — these bypass RLS by design. Audit their internal logic carefully.
- Triggers attached to sensitive tables may perform actions outside the policy scope. Verify.

## Transactional race conditions

- Operations that modify shared state (stock, balance, counters, unique constraints) inside transactions use appropriate locking:
  - `SELECT ... FOR UPDATE` for pessimistic locking.
  - Optimistic locking via version column when the workflow allows retries.
  - Unique constraints + handling of conflict errors as the correctness boundary, not as defense-in-depth.
- Read-then-write patterns without a transaction or lock are race conditions waiting to happen.
- Application-level locks (in-memory mutexes) are insufficient in distributed deployments.

## Indexes and exposed data

- Foreign keys to sensitive tables are indexed — missing indexes can cause queries to scan and expose data through slow-query logs or timing.
- No sensitive data in unencrypted columns when at-rest encryption is a requirement.
- No PII in column names that propagate to logs or error messages.

## Connection security

- Database connection strings include TLS settings appropriate to the environment (`sslmode=require` or stricter in production).
- Connection pool size and timeout settings reviewed — exhausted pools can become a DoS vector.
- Read replicas, if used, do not bypass RLS — verify the role and connection are consistent.
