# Research export memory review, 2026-09-26

Implementation-stage status: locally verified before release. Push and deployment
verification are recorded separately in `release-records/releases.json` and the
existing Word change record; local tests alone do not establish deployment.

## Incident evidence

- The user reported that downloading Research dataset coincided with a crash.
- The user-supplied Render notification confirms a memory-limit restart at
  approximately 16:25 MDT on September 26, 2026.
- Read-only inspection of the canonical service `conversational-mcq`
  (`srv-d987t1vaqgkc73d5l5q0`) confirmed a 512 MB memory limit and 0.5 CPU.
- A research-dataset-v2 export job was created at 22:25:15.288 UTC and marked
  completed at 22:25:25.673 UTC (16:25:25 MDT). Its aggregate row count was 8,468,
  including export tables/dictionaries, not 8,468 students.
- Service startup appeared at 16:25:29, with Next ready at 16:25:32 and a Render
  restart event at 16:25:33. The memory chart showed a sharp peak and restart.
- The timing strongly supports an export/download memory peak. It does not
  identify an exact allocating object, prove a leak, or exclude concurrent work;
  no heap profile from the failed process was available.
- Investigation did not rerun a production export, retrieve student transcripts,
  modify production records, or change the service plan. Read-only operational
  queries used timestamps, statuses, counts and memory totals only.

## Systemic changes

The previous HTTP generation path retained the complete cohort session graphs,
all serialized CSV strings, intermediate ZIP buffers and the final ZIP in memory.
Download then read the whole archive into another buffer. This can exceed a small
container's headroom even when database storage is modest.

The new production path:

1. Uses one RepeatableRead snapshot but fetches and serializes one full session
   at a time, writing CSV chunks to a private directory. All event, response and
   profile row builders retain their existing definitions.
2. Retains compact sealed-attempt observations for cross-attempt comparisons,
   rather than retaining every session's full process/agent logs.
3. Accumulates coverage counts, row counts, byte counts and SHA-256 hashes by
   chunk. CSV parsing handles quoted commas and multiline reasoning. Static
   dictionaries and notes are emitted once.
4. Streams a DEFLATE ZIP to disk and publishes it by same-filesystem rename only
   after the snapshot, safety checks and ZIP generation succeed. Failures remove
   partial temporary files rather than exposing an incomplete archive.
5. Streams the stored file to HTTP with byte-based backpressure and Content-Length
   instead of reading the entire download into RAM. Client cancellation closes
   the file stream. Expired jobs cannot be downloaded.
6. Allows one research-dataset generation per web process; a concurrent request
   gets a retryable 429 `research_export_busy`, not a second memory-heavy build.
7. Removes working directories on success or ordinary failure. On the next export,
   removes recognized abandoned temporary directories older than 24 hours;
   ignores symlinks, unrelated directories and active local spools. This is not
   an unattended cleanup service and does not remove source research records.
8. Starts the existing application supervisor directly from Docker, eliminating
   the extra npm parent process. The web server and durable preparation worker
   are both still started and supervised.

The manifest adds `generation_policy_version=session-spooled-export-v1`.
Dataset schema remains `research-dataset-v2`. Snapshot time, scope, pseudonymization,
restricted-field confirmation, version links and file integrity metadata remain.
CSV row order can now be grouped by session; consumers must use documented keys,
not row position. This is not a new interpretation or a retrospective rewrite of
student products. No database migration is required.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed with zero errors and five pre-existing unused-variable
  warnings in unrelated evaluation fixtures/modules.
- `npm run build`: passed, including 83 static pages and build traces. The first
  invocation stopped before compilation because the sandbox blocked tsx's local
  IPC socket; the approved retry completed. Webpack emitted large-string cache
  warnings and Next reported two existing unused-import warnings. These are not
  evidence that production has been deployed or memory-load tested.
- `git diff --check`: passed.
- `node --max-old-space-size=96 --import tsx prisma/research-export-streaming-smoke-test.ts --stress`:
  passed. Synthetic CSV: 65,536 rows, 81,578,264 bytes; compressed ZIP: 712,487 bytes.
  Byte count and SHA-256 matched the streamed decompression. Regular fixtures also
  checked ZIP CRC, multiline CSV, coverage equivalence, exact row counts,
  dictionary deduplication, invalid headers/paths, export admission, failed
  publication cleanup, and stale-directory cleanup exclusions.
- In the measured stress run, baseline RSS was 96,256,000 bytes and sampled peak
  RSS was 206,487,552 bytes; elapsed time was 2,851 ms. The 96 MiB option limits
  V8 old-space, not whole-process memory. Synthetic text compresses very well;
  this is not a prediction of production compression, latency or concurrency.
- Initial stress verification used async iteration on JSZip's older stream
  interface and failed. The test was corrected to use a native Writable pipeline
  and rerun successfully; generation itself had already succeeded.
- The first disk/compatibility export comparison included independently generated
  `derived_at` timestamps and failed. The comparison now excludes run/snapshot/
  derivation timestamps from separate exports while still comparing all data
  cells and independently checking each manifest's counts and hashes.
- Fourteen regression scripts passed against a disposable, migrated and seeded
  local PostgreSQL database with external-provider networking blocked. The test
  database was dropped afterward. Each script ran with
  `node --import ./scripts/classroom-audit-network-guard.mjs --import tsx prisma/<script>`:

| Script | Result |
| --- | --- |
| `student-collection-learning-summary-smoke-test.ts` | Pass, 45 collection/evidence checks |
| `student-item-admin-audit-smoke-test.ts` | Pass, persisted tutor audit/progression |
| `formative-interpretation-policy-smoke-test.ts` | Pass |
| `student-transcript-quality-regression.ts` | Pass |
| `student-initial-admin-smoke-test.ts` | Pass |
| `student-navigation-matrix-test.ts` | Pass, 65 scenarios including persisted/exported evidence |
| `formative-conversation-v18r2-contract-smoke-test.ts` | Pass |
| `formative-conversation-v18r2-pipeline-runtime-smoke-test.ts` | Pass |
| `formative-conversation-v18r2-lifecycle-runtime-smoke-test.ts` | Pass |
| `student-analysis-ready-export-smoke-test.ts` | Pass, disk/compatibility cell equivalence and file integrity |
| `student-selected-session-export-smoke-test.ts` | Pass, selected-session scope and standard/restricted fields |
| `master-export-smoke-test.ts` | Pass, stream byte equality, length and expired-download rejection |
| `student-research-export-integrity-smoke-test.ts` | Pass |
| `student-research-export-error-ui-smoke-test.ts` | Pass |

The repository's `classroom:audit` includes the collection and streaming suites
for later full regression runs. The full audit was not run in this task.

## Remaining boundaries

- Memory is bounded by one session's full graph plus compact cohort comparisons,
  not constant for arbitrarily large data. A single exceptionally large session
  can still be expensive. Legacy raw/master export generation is not converted
  to session spooling; its download now streams through the shared endpoint.
- Database snapshot timeout is 120 seconds. Exceeding it fails the export; it
  does not silently truncate data. Generation still runs within the HTTP request,
  not a durable background export job.
- Temporary CSVs plus the compressed archive need disk space. If disk writing
  fails, the export fails and cleans up normally. A hard process kill may leave a
  working directory until the next eligible cleanup. Existing seven-day export
  expiry is unchanged; this change does not establish a scheduled retention job.
- Admission control is process-local. Multiple web instances would need a shared
  job/lock policy. Simultaneous student AI work still shares the 512 MB container;
  this patch alone cannot certify classroom capacity or zero future OOMs.
- Production validation and the follow-up runtime budget correction are recorded
  below. They do not establish classroom-scale concurrency capacity.

## Deployment follow-up and runtime heap budgets

The first application release `19dcb316` went Live on September 26 at 17:10 MDT.
One standard all-authorized research export completed with 8,468 table records
and a browser download event. The web and preparation worker stayed running.
However, a subsequent 20-second cgroup sample reached 536,461,312 bytes, close to
the 536,870,912-byte limit. This was not a safe capacity margin. A later sample
showed 513,896,448 bytes of anonymous memory and only 2,048,000 bytes of file
cache; the pressure could not be explained away as disk cache.

A read-only runtime probe reported a default V8 heap limit of 8,593,080,320 bytes
inside that 512 MiB cgroup. Build-sized runtime settings can delay collection
beyond the container's capacity. No heap snapshot was taken, so this observation
does not identify every allocation or prove the sole cause of the earlier OOM.

`scripts/start-app.mjs` now reads Node's actual constrained-memory value and
passes explicit heap flags to each production child, overriding inherited
build-time `NODE_OPTIONS`. The web old-space budget is 37.5% of container memory;
the worker is 18.75%. At 512 MiB these are 192 and 96 MiB respectively, with
4 MiB semi-spaces. The remainder is reserved for native allocations, buffers,
young generations and the supervisor. These are GC budgets, not total RSS caps.
Development and unavailable constraints retain existing behavior. No paid plan
change or student-data change is involved. A single oversized session or enough
concurrent work can still exhaust these budgets and needs capacity planning.

The four `node --test scripts/runtime-memory-budget.test.mjs` checks cover the
512 MiB allocation, larger-container scaling, dev/unavailable constraints and
actual child-process precedence over an inherited 8 GiB setting. The exact
follow-up commit, low-heap regression outcomes and deployment verification are
recorded in the release ledger.

## Related assessment work retained locally

The initial/transfer collection tutor accepts brief, incorrect, option-derived or
uncertain on-topic reasoning as limited evidence without coaching toward the key.
Incomplete fragments receive at most one neutral clarification; procedural
questions, off-topic content and provider failures do not auto-advance merely
because they repeat. Original student words and provider audit output are retained.

Formative summaries may describe demonstrated understanding, evidence-supported
progress and remaining work; they do not use a "Discussed, awaiting confirmation"
category. Progress requires earlier and later eligible student-authored evidence.
Evidence-link validation is not proof of semantic correctness or learning gain.
The revised prompts prefer focused explanations, expand when useful/requested and
label illustrative numbers. No new live-provider evaluation is claimed here.

## Implementation references

- `src/lib/services/teacher-research-data/export-spool.ts`
- `src/lib/services/teacher-research-data/analysis-ready-export.ts`
- `src/lib/services/teacher-research-data/coverage-report.ts`
- `src/lib/services/master-export/storage.ts` and `service.ts`
- Research generation and export download API routes; `Dockerfile`
- [JSZip Node streaming](https://stuk.github.io/jszip/documentation/api_jszip/generate_node_stream.html)
- [Node readable-to-web backpressure](https://nodejs.org/api/stream.html#streamreadabletowebstreamreadable-options)
