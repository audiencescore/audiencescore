# Mirroring (design)

Target properties for the mirror protocol; tooling ships with the first
live deployment.

1. **Full-fidelity export.** The event log is exportable as JSONL, one
   canonical-form event per line, in chain order. A mirror that replays the
   file through the verifier in
   [event-spec §5](../protocol/event-spec.md#5-log-verification) holds
   provably the same history as the origin.
2. **Incremental sync.** Because the log is append-only and hash-chained, a
   mirror syncs by requesting events after its current head hash. Any fork
   or rewrite at the origin is immediately visible as a head mismatch.
3. **Independent recomputation.** A mirror recomputes any score with the
   published score spec and compares against origin-signed manifests via
   the `event_set_hash`. Divergence is publishable proof of origin
   misbehavior.
4. **License obligations.** Mirrors operate under the
   [ODbL](LICENSE-ODbL): attribution and share-alike for adapted databases.
