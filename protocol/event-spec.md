# Event Specification v0.1

Status: **draft**. Spec identifier: `audiencescore/event@0.1`.
Normative for the event log; the reference implementation in
[`/reference-impl`](../reference-impl/) implements it.

## 1. Design rules

1. **Events are the only state.** Everything published — scores, dimension
   sub-scores, moderation outcomes — is a deterministic rendering over the
   event log. Renderings are reproducible: same log, same spec version,
   same output.
2. **Append-only, hash-chained.** Events are never edited or deleted. Each
   event commits to the hash of its predecessor, so any mutation of history
   is detectable by anyone holding a copy.
3. **Signed at the source.** Every event carries an Ed25519 signature made
   by the actor that created it (reviewer, vendor, or operator process).
4. **Outcomes, not causes.** The required verdict payload is a single
   binary judgment, because an outcome is attestable and a cause is not.
   Free-text narrative is optional context, clearly labeled subjective, and
   never input to score computation.

## 2. Canonical serialization

Signatures and hashes are computed over **canonical JSON**: object keys
sorted lexicographically at every nesting level, arrays in order, no
insignificant whitespace, UTF-8 encoding. Hashes are SHA-256, hex-encoded.
Keys and signatures are base64url-encoded; public keys use SPKI DER.

## 3. Event envelope

```json
{
  "spec": "audiencescore/event@0.1",
  "type": "verdict",
  "prev": "<sha256 hex of the previous event's canonical form, or 64 zeros>",
  "body": { "...type-specific payload..." },
  "signer": "<base64url SPKI Ed25519 public key>",
  "id": "<sha256 hex of the canonical {spec, type, prev, body, signer}>",
  "sig": "<base64url Ed25519 signature over the canonical {spec, type, prev, body, signer}>"
}
```

The signature covers `prev`, binding each event to its position: a valid
event replayed at another position fails verification. An empty log's head
is the genesis value (64 zero characters).

## 4. Event types

### 4.1 `verdict` (this spec)

```json
{
  "verdict": "up",
  "dimensions": { "quality": true, "on_time": true, "price": null, "service": null },
  "narrative": "optional free text, subjective",
  "vendor": { "id": "<vendor id>", "locality": { "country": "US", "state": "CO" } },
  "service_locality": { "state": "CO" },
  "receipt": { "tier": "vendor_receipt", "right_id": "<sha256 hex>", "proof_hash": "<sha256 hex>" },
  "issued_at": "<ISO 8601 UTC timestamp>"
}
```

- `verdict` — required; `"up"` or `"down"`: *would you use this vendor again?*
- `dimensions` — optional; up to four fixed binary chips: `quality`
  (as promised), `on_time`, `price` (as quoted), `service`. `null` or
  omitted means not answered. No other dimensions are valid in v0.1.
- `narrative` — optional free text. Subjective context only; never scored.
- `vendor.locality` / `service_locality` — locality is captured at write
  time so scores can render at national, state, and metro resolution.
- `receipt.right_id` — the single-use review right this verdict spends
  (see [receipt-spec.md](receipt-spec.md)). One right, one verdict, ever.
- `receipt.proof_hash` — hash of the underlying proof, linking the verdict
  to its transaction without embedding the transaction's contents.

### 4.2 Reserved types

`flag`, `quarantine`, `detector_commitment`, `detector_reveal`, and
`audit_attestation` are reserved for the moderation and accountability
machinery described in [GOVERNANCE.md](../GOVERNANCE.md); they will be
specified in a subsequent revision through the RFC process. All of them
are public events: moderation is visible even when detector internals
are not.

## 5. Log verification

A conforming verifier accepts a log if and only if, walking from the first
event: each event's `prev` equals the hash of the preceding event's full
canonical form (or genesis for the first), each `id` matches its recomputed
value, and each `sig` verifies against `signer`. The reference implementation
(`reference-impl/src/events.js`) is the executable form of this paragraph.

## 6. Privacy posture (forward-looking)

v0.1 identifies reviewers only by per-event public keys. The target design
is zero-knowledge attestation: proving "I hold a valid, unused right for
this vendor, in this window, in this locality" without revealing the
buyer's identity or purchase history — selective disclosure in the W3C
Verifiable Credentials family. This is research-stage; see the open
questions in the repository issues.
