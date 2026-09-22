# Korean full-text search operations

HaloPress has two supported compositions over one analyzer, indexer, lease, and
SQLite FTS5 contract:

| Responsibility | Cloudflare | Node |
| --- | --- | --- |
| Analyzer | same-script `AnalyzerDurableObject` | one long-lived Worker Thread |
| Durable jobs | D1 `full_text_job` | local SQLite `full_text_job` |
| Wake-up | Queue plus scheduled reconciliation | one-second SQLite polling plus disposable nudge |
| Index/query | D1 SQLite FTS5 | local SQLite FTS5 |

Cloudflare still deploys one Worker. The code-owned entry wrapper composes Nitro
`fetch` with Queue `queue`, scheduled reconciliation, and the same-script
SQLite-backed DO. Node does not emulate those bindings: it composes the portable
search core with the application's existing `.data/halopress.sqlite` connection.
There is no auxiliary search Worker, Loader, Pipeline, Redis, or process per
request.

Content and immutable publication revisions remain authoritative. Publishing,
unpublishing, deleting, and publishing a Schema write a durable `full_text_job`
row in the same SQLite transaction or D1 batch as the source mutation. Queue
delivery is only a wake-up; the five-minute scheduled reconciler redispatches
pending or expired leases.

## Topology and analyzer contract

- The main Worker publishes job identities to `SEARCH_INDEX_QUEUE`, consumes
  them, owns D1 leases and generation activation, and handles raw queries.
- `SEARCH_ANALYZER_DO` resolves one stable object name,
  `garu:<sha256(complete analyzer descriptor)>`. Model, Wasm, analyzer-source,
  tokenizer-generation, compatibility-date, and flag changes produce a new
  identity.
- The model is a deploy-time immutable `ArrayBuffer`. Wrangler imports Wasm
  through `CompiledWasm`, so the DO receives a `WebAssembly.Module` and never
  compiles arbitrary bytes on a request path.
- Analyzer RPC batches contain one to four `{ id, input }` chunks, preserve
  batch/item identity and order, and return a success or typed error for every
  item. Each normalized chunk is at most 24 KiB.
- The main Worker writes only the successful consecutive prefix. A later failed
  item leaves its D1 checkpoint pending, so retry resumes without skipping or
  double-activating a generation.
- The DO does not store authoritative work or index state and currently performs
  no application storage writes. SQLite is selected because Workers Free
  supports SQLite-backed Durable Objects.
- The portable compatibility response contains only the analyzer contract,
  artifact identity, and tokenizer metadata. DO `objectName`, compiled-module
  representation, and model-byte diagnostics remain in the Cloudflare adapter.
- Node uses the same content-derived artifact identity. Its executor bounds 32
  pending calls, owns one model/Wasm initialization, restarts after a thread
  exit, and propagates initialization or call failure as retryable unavailable
  state rather than empty search terms.
- The Node runner polls SQLite every second, claims at most four jobs per cycle,
  and uses the existing five-minute leases and checkpoints. The in-process
  publication nudge only reduces latency; pending and expired database rows are
  recovered after restart without it.

One final D1 batch rechecks the current publication revision and field
eligibility, replaces the FTS rows, and activates the complete generation.
Partial staging rows never affect MATCH or BM25.

## Build, plan, and deploy

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:deploy
node scripts/prepare-cloudflare-search-topology.mjs \
  --config wrangler.jsonc --plan
bash scripts/validate-cloudflare-durable-search.sh
bash scripts/validate-cloudflare-durable-search.sh --execute
pnpm deploy:cf -- --dry-run
pnpm deploy:cf
```

The non-mutating resource plan names the main Worker, D1/R2 bindings, Queue,
cron, DO class/binding/migration, analyzer modules, routes, variables, secret
requirements, billable dimensions, deployment order, and any legacy Worker
cleanup.

A real deployment runs in this order:

1. inspect or prepare the main secret;
2. resolve D1 and apply migrations;
3. create or reuse the Queue;
4. deploy and invoke a uniquely named real-Garu DO compatibility probe;
5. delete that isolated probe and namespace;
6. deploy the main Worker;
7. invoke the main Worker's
   `/__halopress/search/analyzer-health` gate, including a real Korean query;
8. detach the old `<main-worker>-search` Queue consumer after the gate passes;
9. delete that old Worker with the Queue and D1 data left intact.

The `new_sqlite_classes` migration is append-only and a one-way production
constraint. Deployment code never deletes or recreates the production
`AnalyzerDurableObject` namespace. If the isolated or main activation gate
fails, the command exits without deleting the old Worker.

For multiple sites, give the main Worker, D1 database, and R2 bucket unique
names. The Queue defaults to `<main-worker>-search-index`. Override it only when
adopting an existing Queue:

```bash
HALOPRESS_SEARCH_QUEUE_NAME=newsroom-search-index pnpm deploy:cf
```

During the one-time migration, override the name of the Worker to remove only
when the historical name was customized:

```bash
HALOPRESS_LEGACY_SEARCH_WORKER_NAME=old-search-name pnpm deploy:cf
```

For a custom domain where Wrangler output does not contain an invokable URL,
provide the deployed origin for the activation gate:

```bash
HALOPRESS_ACTIVATION_URL=https://cms.example.com pnpm deploy:cf
```

## Recovery and failure behavior

The Operations screen reports pending, active, failed, ready, and stale work,
chunk progress, tokenizer generation, query epoch, and the latest error.

- **Retry failed** returns failed jobs to `pending` while preserving checkpoint
  and staging generation.
- **Reindex all** creates bounded Schema fan-out jobs. Existing complete rows
  remain active until each replacement generation is complete.
- Lost Queue delivery or exhausted Queue retention does not lose work. Content
  publication succeeds, D1 remains pending, and scheduled reconciliation retries.
- DO initialization or RPC failure produces bounded Queue retry and eventually a
  visible failed job. It does not publish false empty search results.
- Raw query failure returns typed retryable `503 analyzer_unavailable`. The
  existing client may retry with browser-tokenized token mode when that advertised
  behavior is enabled.
- D1 unavailability affects indexing and queries, not source content. Restore D1,
  apply migrations, and run a full reindex.
- On Node, keep `.data/halopress.sqlite`, `-wal`, and `-shm` on the same local
  host. The shared connection uses WAL, `synchronous=NORMAL`, and a 5-second busy
  timeout. Apply migration 0011 before startup. Missing search tables leave the
  runner visibly unavailable.
- A crashed Node analyzer rejects outstanding calls retryably and starts a new
  long-lived thread for the same artifact generation. Durable checkpoints, not
  memory, determine where indexing resumes.
- Stop the Node process with `SIGTERM`. Nitro waits for the current bounded
  cycle, stops polling, and terminates the Worker Thread; no second process or
  orphan thread is expected.

## Node validation evidence

Validation on 2026-07-24 used Node 24.13.0 and the pinned Garu 0.9.11 model:

| Measurement | Result |
| --- | --- |
| Model bytes | 1,438,231 |
| Cold Worker initialization | 46.875 ms |
| Five warm two-item batches | 6.899, 2.129, 1.077, 0.972, 0.762 ms |
| Worker-reported process RSS after warm calls | 143,343,616 bytes |
| Durable polling bound | 1,000 ms plus one bounded cycle |
| Event-loop check | a zero-delay main-thread timer advanced during Worker analysis |

These latency and RSS values are environment evidence, not capacity promises.
The automated runtime suite also closes and reopens a temporary file after a
partial checkpoint, resumes to six complete chunks, runs a permission-gated
BM25 query, retains the prior active FTS generation during a WAL write, restarts
a crashed analyzer, and shuts down a built Node SSR process cleanly. Run:

```bash
pnpm vitest run tests/node-search-analyzer.test.ts \
  tests/node-search-sqlite-integration.test.ts
pnpm exec nuxt build --preset node-server
pnpm test:node-search:built-runtime
```

## Measured topology comparison

Measurements below were taken on 2026-07-23 with Wrangler 4.110.0 and Garu
0.9.11. The legacy artifacts were rebuilt from commit `51fe137`; the DO
topology was deployed twice with uniquely named Worker, D1, R2, Queue, and DO
namespace resources. No production resource was changed, and every validation
resource was deleted and checked for absence.

| Dimension | Legacy static Worker topology | Same-script DO topology |
| --- | --- | --- |
| Named production Workers | main + `halopress-search` (2) | main (1) |
| Search execution boundary | service binding to a public-CORS Worker | same-script SQLite DO binding |
| Durable resources | D1 + R2 + Queue | D1 + R2 + Queue + DO namespace |
| Production deploy units | two Worker configs and deploys | one Worker config and deploy |
| Raw Worker uploads | 8,762.29 + 1,862.28 = 10,624.57 KiB | 7,766.37 KiB |
| Gzip Worker uploads | 1,697.20 + 1,591.50 = 3,288.70 KiB | 3,003.36 KiB |
| Analyzer artifact bytes | model 1,438,231 + Wasm 400,868 | identical |
| Query/index analyzer billing | auxiliary Worker invocation | DO request plus DO duration |

The combined deployed-code footprint fell by 2,858.20 KiB raw (26.9%) and
285.34 KiB gzip (8.7%). This total is useful for deployment maintenance, not
quota enforcement: Cloudflare evaluates the upload limit for each Worker. The
legacy topology kept each Worker comfortably below 3 MB, while the consolidated
Worker is only about 68.6 KiB below 3 MiB.

The final isolated full topology deployment reported:

- upload `7,766.37 KiB / 3,003.36 KiB gzip`;
- startup `168 ms`;
- first same-script health and Korean-query completion `2,897 ms`;
- Nitro fetch `404` for an uninstalled root and D1-bound install status `200`;
- all 12 migrations applied, the three FTS control/job/index tables present, and
  exactly one Queue producer and consumer on the main Worker.

Tail sampling showed why topology simplicity, not a blanket CPU reduction, is
the defensible benefit:

- the legacy stateless Worker analyzed the same one-item Korean query with
  `193`, `173`, `2`, and `198 ms` CPU across four sequential requests; different
  isolates made “warm” behavior non-deterministic;
- the final named DO used `108 ms` CPU for compatibility initialization, `14 ms`
  for the first three-item batch, and `3 ms` for the repeated batch; the
  stateless probe wrapper used `2 ms` CPU;
- DO wall times for those calls were `213`, `49`, and `39 ms`. The legacy
  stateless call wall times were `193`, `179`, `3`, and `200 ms`, excluding
  client-to-edge network time.

Fresh `workers.dev` routes returned Cloudflare 1042 and 1104 responses without
reaching the Worker during propagation, then the same unchanged deployment
passed after about 20 seconds. The deployment gates therefore retry for a
bounded 30-second window and still fail closed before legacy cleanup. The first
cleanup experiment also proved that Cloudflare will not delete a Queue consumer
Worker; the supported order is now encoded and tested as consumer detach,
Worker deletion, then Queue deletion for fully isolated validation.

## Limits and cost model

Queue messages contain only a job ID, far below the 128 KB message limit. Queue
consumers use batch size one and concurrency two; each job calls the DO once per
bounded four-chunk analyzer batch.

Cloudflare currently documents SQLite-backed Durable Objects on both Workers
Free and Paid. Free includes 100,000 DO requests and 13,000 GB-s per day. Paid
includes 1 million requests and 400,000 GB-s per month, then charges by request
and duration. Each RPC method call is one billed DO request, and duration is
based on a 128 MB allocation. The current analyzer uses no DO application
storage reads or writes.

The production Wrangler bundle is minified. The final isolated remote deployment
measured 7,766.37 KiB before compression and 3,003.36 KiB gzip; the post-change
local dry-run measured 7,765.67 KiB and 3,002.92 KiB gzip. Both are close enough
to the documented 3 MB Workers Free limit that a real target-account deployment
is a mandatory compatibility gate, not an assumption. Paid allows a 10 MB
compressed Worker. Model and Wasm bytes account for 1,839,099 uncompressed
bytes.

The DO design removes a named Worker, service binding, public analyzer surface,
and a second deployment configuration. It does not remove D1, R2, Queue, or cron,
and it adds billed DO requests and duration. For current bounded concurrency this
is a meaningful operational simplification, but it is not established as a
request-cost reduction. Adopt the DO topology for its smaller resource graph and
single deployment unit; treat Free-plan acceptance and sustained latency as
release gates rather than inferred benefits.

Operational limits and prices can change; verify before capacity planning:

- <https://developers.cloudflare.com/durable-objects/platform/pricing/>
- <https://developers.cloudflare.com/durable-objects/platform/limits/>
- <https://developers.cloudflare.com/queues/platform/limits/>
- <https://developers.cloudflare.com/workers/platform/limits/>
- <https://developers.cloudflare.com/d1/platform/limits/>

The single content-derived object serializes analysis for one analyzer
generation. This is intentionally simple and suitable for HaloPress's bounded
Queue concurrency, but it is a scaling limit. Measure latency and DO request
duration before raising indexing concurrency.

## Why Pipelines and Loader are not used

The [Pipelines Bluesky fan-out
example](https://developers.cloudflare.com/pipelines/examples/bluesky-firehose-fanout/)
is useful for restart-safe cursoring, bounded batches, and fan-out from a
stateful DO consumer. Its actual topology ingests a firehose into Pipelines and
multiple R2/Iceberg sinks. HaloPress already has a transactional D1 outbox,
Queue wake-ups/retries, D1 FTS tables, and generation-aware reconciliation.
Adding a Pipeline would preserve those resources and add another delivery
lifecycle, so the relevant batching ideas are implemented directly.

Dynamic Worker Loader was also rejected. The real 1,438,231-byte Garu model
exceeded Loader environment limits, precompiled Wasm could not be deserialized
through that environment, and the working raw-Wasm module shape was not part of
the public Dynamic Workers module-type contract. It also required Workers Paid.
Neither rejected execution path remains in deployment code.

## D1 smoke tests

Apply migrations and verify FTS5:

```bash
pnpm db:d1:apply:local
pnpm wrangler d1 execute DB --local --command \
  "SELECT sql FROM sqlite_master WHERE name = 'full_text_fts';"
```

After a remote deployment and indexed publication:

```bash
pnpm wrangler d1 execute DB --remote --command \
  "SELECT status, count(*) AS jobs FROM full_text_job GROUP BY status;"
pnpm wrangler d1 execute DB --remote --command \
  "SELECT content_id FROM full_text_fts WHERE full_text_fts MATCH 'morph_text : \"학교\"' LIMIT 5;"
```

Never edit `full_text_fts`, `full_text_chunk`, or index-state rows as source
content. Use the Operations reindex action to recover derived data.

## Query contract

`GET /api/keyword-search/capabilities` advertises:

- `browser` mode lazy-loads the shared browser tokenizer and submits bounded
  `rawTerms` and `morphTerms`;
- `server` mode submits bounded raw text; the main Worker invokes its same-script
  DO, then runs the permission-gated D1 query.

Runtime configuration:

```bash
NUXT_PUBLIC_KEYWORD_SEARCH_MODE=server
NUXT_PUBLIC_KEYWORD_SEARCH_BROWSER_FALLBACK=true
```

There is no public search-Worker URL or analyzer CORS surface. The token request
contract, permission checks, BM25 weighting, cursor fingerprint, generation
checks, cache headers, and headless `shared/keyword-search-client.ts` behavior
remain unchanged.
