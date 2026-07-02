# Reference Implementation

A dependency-free Node.js (18+) implementation of the protocol and score
spec, licensed Apache-2.0. It is a demonstrator and executable
specification — not production software.

## Run the demo

```sh
node reference-impl/demo.js
```

Shows the full loop: signed receipts → single-use review rights → signed
verdict events on a hash-chained log → tamper detection → deterministic
score rendering → an MCP query returning a signed score manifest, verified
client-side.

## Run the tests

```sh
node --test reference-impl/test/*.test.js
```

## Layout

| File | Implements |
|---|---|
| `src/crypto.js` | Ed25519 over canonical JSON, SHA-256 |
| `src/events.js` | Event envelope, append-only hash-chained log ([event-spec](../protocol/event-spec.md)) |
| `src/receipts.js` | Vendor receipts, single-use rights registry ([receipt-spec](../protocol/receipt-spec.md)) |
| `src/score.js` | The v0.1 score function ([score-spec](../score-spec/score-spec-v0.1.md)) |
| `src/mcp-server.js` | Minimal MCP (JSON-RPC 2.0 over stdio) server exposing `get_score` |

## Query it from an MCP client

The server takes an event-log JSONL file and exposes one tool, `get_score`:

```sh
node reference-impl/src/mcp-server.js /path/to/events.jsonl
```

Every response is a signed manifest; verify it with
`verifyPayload(signer, manifest, sig)` from `src/crypto.js`, or any Ed25519
implementation — trusting the transport is never required.
