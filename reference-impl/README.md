# Reference Implementation

A Node.js implementation of the protocol and score specs, licensed
Apache-2.0. It is a demonstrator and executable specification — not
production software. The v0.1 modules and demo remain dependency-free
(Node 18+); the v0.2a modules need Node 24+ (for the built-in `node:sqlite`)
and exactly one audited, exact-pinned dependency, `@noble/hashes`, for the
spec-mandated BLAKE3 holder binding.

The normative protocol is [spec v0.2a](../spec/SPEC-v0.2a.md). The v0.1
modules are superseded and retained for reproducibility.

## Run the demo

```sh
node reference-impl/demo.js
```

Shows the v0.1 loop: signed receipts → single-use review rights → signed
verdict events on a hash-chained log → tamper detection → deterministic
score rendering → an MCP query returning a signed score manifest, verified
client-side.

## Run the tests

```sh
cd reference-impl
npm ci
npm test
```

Runs the v0.1 unit tests plus the v0.2a acceptance suite — every numbered
criterion in [/tests/ACCEPTANCE-TESTS.md](../tests/ACCEPTANCE-TESTS.md)
(AT-1..AT-25), driven against the signed conformance vectors in
[/conformance](../conformance/).

## Layout

| File | Implements |
|---|---|
| `src/crypto.js` | Ed25519 over canonical JSON, SHA-256 (superseded v0.1 envelope) |
| `src/events.js` | Superseded v0.1 event envelope, append-only hash-chained log ([event-spec](../protocol/event-spec.md)) |
| `src/receipts.js` | Superseded v0.1 vendor receipts, single-use rights registry ([receipt-spec](../protocol/receipt-spec.md)) |
| `src/score.js` | Superseded v0.1 score function ([score-spec](../score-spec/score-spec-v0.1.md)) |
| `src/mcp-server.js` | Minimal MCP (JSON-RPC 2.0 over stdio) server exposing `get_score` |
| `src/v02/canonical.js` | as/0.2a canonical receipt serialization ([CANONICAL.md](../conformance/CANONICAL.md)) |
| `src/v02/signing.js` | The receipt signature scheme behind one swappable interface (GATE-1) |
| `src/v02/holder.js` | Per-issuer derived holder keys + BLAKE3 bindings (spec §7) |
| `src/v02/receipts.js` | as/0.2a receipts, the attestation ladder, monotonic standing (spec §3–4) |
| `src/v02/store.js` | SQLite store: append-only enforced in the engine, automatic L1 issuance, refusal events |
| `src/v02/rendering.js` | Rendering v1: dual views, version scoping, k-gating ([rendering-v1](../score-spec/rendering-v1.md)) |
| `src/v02/invariants.js` | The I-1..I-7 health-check register (spec §6) |

## Query it from an MCP client

The server takes an event-log JSONL file and exposes one tool, `get_score`:

```sh
node reference-impl/src/mcp-server.js /path/to/events.jsonl
```

Every response is a signed manifest; verify it with
`verifyPayload(signer, manifest, sig)` from `src/crypto.js`, or any Ed25519
implementation — trusting the transport is never required.
