# Reference Implementation

A Node.js implementation of the protocol and score specs, licensed
Apache-2.0. It is a demonstrator and executable specification — not
production software. The current implementation needs Node 24+ (for the
built-in `node:sqlite`) and exactly one audited, exact-pinned dependency,
`@noble/hashes`, for the spec-mandated BLAKE3 holder binding.

The normative protocol is [spec v0.2a](../spec/SPEC-v0.2a.md). The v0.1
implementation was retired at HEAD; git history and the signed v0.1.0 release
tag remain the reproducibility archive.

## Run the demo

```sh
node reference-impl/demo.js
```

Shows the current pilot loop: receipt issued by the v0.2 pilot runtime →
review admitted through the HTTP API → deterministic score rendering → an MCP
query returning a signed score manifest, verified client-side.

## Run the tests

```sh
cd reference-impl
npm ci
npm test
```

Runs the v0.2a acceptance suite, pilot API tests, and transport tests — every
numbered criterion in [/tests/ACCEPTANCE-TESTS.md](../tests/ACCEPTANCE-TESTS.md)
(AT-1..AT-25), driven against the signed conformance vectors in
[/conformance](../conformance/).

## Layout

| File | Implements |
|---|---|
| `src/crypto.js` | Ed25519 over canonical JSON and SHA-256 helpers shared by the pilot runtime |
| `src/mcp-http-server.js` | Streamable HTTP pilot read API exposing v0.2 `get_score` and `get_score_evidence` |
| `src/v02/canonical.js` | as/0.2a canonical receipt serialization ([CANONICAL.md](../conformance/CANONICAL.md)) |
| `src/v02/signing.js` | The receipt signature scheme behind one swappable interface (GATE-1) |
| `src/v02/holder.js` | Per-issuer derived holder keys + BLAKE3 bindings (spec §7) |
| `src/v02/receipts.js` | as/0.2a receipts, the attestation ladder, monotonic standing (spec §3–4) |
| `src/v02/store.js` | SQLite store: append-only enforced in the engine, automatic L1 issuance, refusal events |
| `src/v02/rendering.js` | Rendering v1: dual views, version scoping, k-gating ([rendering-v1](../score-spec/rendering-v1.md)) |
| `src/v02/invariants.js` | The I-1..I-7 health-check register (spec §6) |

## Query it from an MCP client

The current pilot read server speaks MCP Streamable HTTP and exposes
`get_score(offering)` plus `get_score_evidence(offering)`:

```sh
node reference-impl/src/mcp-http-server.js
```

Every response is a signed manifest; verify it with
`verifyPayload(signer, manifest, sig)` from `src/crypto.js`, or any Ed25519
implementation — trusting the transport is never required.
