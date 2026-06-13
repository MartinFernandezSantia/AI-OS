# Backend performance audit checklist

Load this reference when reviewing API handlers, services, database access code, business logic, background jobs, or worker processes.

## Database queries

- **N+1 queries** — fetching a list of records and then issuing one query per record to load related data. The canonical fix is eager loading (`include`, `with`, `JOIN`) or a batched query. Flag when the loop is over a result set of unbounded or known-large size.
- **Missing indexes** — filtering, sorting, or joining on columns without an index. Flag when:
  - A `WHERE` clause filters on a non-primary-key column that is queried frequently.
  - An `ORDER BY` column has no index and the table is expected to grow.
  - A foreign key column used in joins has no index (not all ORMs create these automatically).
- **Select without field whitelist** — fetching entire rows when only a subset of columns is used. Particularly costly when rows contain large text, JSON blobs, or binary fields.
- **Queries in loops** — issuing one query per item instead of a single query with `IN (...)`, a bulk operation, or a JOIN. Flag unconditionally — this is always a finding.
- **Missing pagination** — queries that return unbounded result sets (no `LIMIT`) on endpoints that could receive large datasets.
- **Unbounded JOINs** — joining tables without filtering conditions that would limit the result set, causing full cross-product scans on large tables.
- **Missing transactions** — multiple related writes issued as separate queries where partial failure would leave data in an inconsistent state.
- **Chatty transactions** — transactions that span multiple round trips or include non-database work (HTTP calls, file I/O) inside the transaction boundary, holding locks longer than necessary.

## Memory

- **Loading large datasets into memory** — fetching entire tables or large result sets into application memory for processing. Flag when the dataset is unbounded or known to be large; streaming or cursor-based processing is the alternative.
- **Buffering large files** — reading entire files into a buffer before processing or sending. Flag when the file size is unbounded; streams should be used instead.
- **Accumulating data in long-lived objects** — arrays, maps, or sets that grow over the lifetime of the process without a bound or eviction strategy (e.g. in-memory caches without TTL or max size).
- **Holding references in closures** — closures that capture large objects and prevent garbage collection. Flag when the closure is long-lived (stored in a map, registered as a listener, used in a job).

## I/O

- **Sequential independent operations** — multiple I/O operations (database queries, external API calls, file reads) issued sequentially with `await` when they are independent and could run in parallel (`Promise.all` or equivalent).
- **Missing connection pooling** — database or external service connections opened per request instead of reused from a pool. Flag if the ORM or driver is not configured with a pool, or if connections are explicitly opened and closed per operation.
- **Synchronous I/O on the main thread** — blocking file system calls (`fs.readFileSync`, equivalent in other runtimes) in request handlers or hot paths. Flag unconditionally in server code.
- **Unbounded concurrency** — parallelizing an unbounded list of I/O operations without a concurrency limit (`Promise.all(items.map(...))` where `items` could be large). This can exhaust connection pools, hit rate limits, or cause memory spikes.

## Cache

- **Missing cache on expensive stable queries** — a query that is computationally or I/O expensive, runs frequently, and returns data that does not change per request (e.g. configuration, reference data, aggregations with low update frequency). Flag as a "requires architectural decision" finding — cache infrastructure may not exist.
- **Cache invalidation on wrong granularity** — invalidating an entire cache namespace on any write when only the affected record needs invalidation. Results in unnecessary cache misses and database load.
- **Caching highly volatile data** — caching data with a TTL longer than its expected update frequency, causing stale reads. Flag when the mismatch is obvious from the code.
- **Missing cache on computed aggregations** — expensive `COUNT`, `SUM`, `AVG`, or `GROUP BY` queries running on every request on large tables without caching. Flag as "requires architectural decision."

## Jobs and async operations

- **Synchronous operations that should be async** — long-running work (sending email, generating reports, processing uploads, calling slow external APIs) executed synchronously in a request handler, blocking the response. Flag as "requires architectural decision" if no job queue exists.
- **Missing timeouts on outbound calls** — HTTP requests or external API calls without an explicit timeout. In a job or worker context this can stall the worker indefinitely.
- **Missing retry limits** — retry logic without a maximum attempt count or backoff strategy, causing infinite retry loops on permanent failures.
- **Jobs that process one item at a time** — job processors that handle one record per execution when batch processing would significantly reduce overhead (DB round trips, external API calls).
- **Missing idempotency in jobs** — jobs that perform non-idempotent operations (sending notifications, charging, writing to external systems) without an idempotency key or deduplication mechanism. Retries will cause duplicate side effects.
