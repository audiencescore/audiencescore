# Event Specification v0.1

> **Superseded.** This v0.1 document is retained verbatim for reproducibility
> (see [GOVERNANCE.md](../GOVERNANCE.md)). The normative protocol is now
> [spec v0.2a](../spec/SPEC-v0.2a.md); [DRIFT.md](../DRIFT.md) records how v0.1
> was reconciled with it.

Status: **draft**. Spec identifier: `audiencescore/event@0.1`.
Normative for the historical v0.1 event log. The v0.1 implementation was
retired at HEAD; git history and the signed v0.1.0 release tag remain the
reproducibility archive.

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

Signatures and hashes are computed over **canonical JSON**. Because a mirror
in another language must produce byte-identical bytes to verify a signature or
recompute a score, the canonical form is pinned rather than left to each
JSON library:

- Object keys are sorted by Unicode code point at every nesting level and
  emitted with no insignificant whitespace; arrays keep their order. (The
  event and verdict schemas use only ASCII keys, for which this order is
  unambiguous.)
- Strings use JSON's minimal escaping; the output is UTF-8.
- Numbers are **finite only** — `NaN` and `Infinity` are not representable and
  MUST be rejected, never coerced to `null`. Values that reach a signed
  payload are integers or already rounded to fixed precision by the score
  spec, so no float-formatting ambiguity is signed over.
- `undefined` is not a value; object properties whose value is `undefined`
  are omitted.

This follows the [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
model; a conforming implementation SHOULD follow JCS so a Go/Python/Rust mirror
computes the same bytes as the JavaScript reference (`reference-impl/src/crypto.js`),
which is normative for v0.1. Hashes are SHA-256, hex-encoded; keys and
signatures are base64url-encoded; public keys use SPKI DER.

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
- `vendor.id` — a **typed vendor identifier**, never a bare name; see
  [§5 Vendor identity](#5-vendor-identity).
- `vendor.locality` / `service_locality` — locality is captured at write
  time so scores can render at national, state, and metro resolution.
- `receipt.right_id` — the single-use review right this verdict spends
  (see [receipt-spec.md](receipt-spec.md)). One right, one verdict — enforced
  at admission; §6 log verification does not itself dedupe `right_id`, so in
  v0.1 single-use is operator-attested, not reconstructible from the log alone
  ([receipt-spec §4](receipt-spec.md#4-admission-checks)).
- `receipt.proof_hash` — hash of the underlying proof, linking the verdict
  to its transaction without embedding the transaction's contents.

### 4.2 Reserved types

`flag`, `quarantine`, `detector_commitment`, `detector_reveal`, and
`audit_attestation` are reserved for the moderation and accountability
machinery described in [GOVERNANCE.md](../GOVERNANCE.md); they will be
specified in a subsequent revision through the RFC process. All of them
are public events: moderation is visible even when detector internals
are not.

## 5. Vendor identity

A verdict binds to a **typed vendor identifier**, never to a bare name. The
`vendor.id` field of a verdict (§4.1) always takes one of the forms below,
strongest first, and the identifier is chosen at write time from the
strongest form the underlying proof supports:

- **`key:<vendor-key>`** — a DNS-verified vendor key. The vendor proved
  control of its domain (a DNS TXT record binding the domain to an Ed25519
  key) and the identifier *is* that key. Strongest binding: the vendor is
  exactly whoever holds the key.
- **`platform:<namespace>:<merchant-id>`** — a merchant identity issued by a
  platform and read straight out of the cryptographic proof itself: the
  sending domain of a DKIM-signed receipt, or the merchant field of an
  agentic-commerce payment mandate (for example `platform:stripe:acct_1a2b`,
  or `platform:<email-domain>:<merchant>`). The namespace names the issuing
  system; the merchant-id is that system's stable identifier for the vendor.
- **`place:<hash>`** — the local fallback: a hash of the vendor's display name
  plus its normalized postal address, for a physical vendor with neither a
  verified key nor a platform identity.

### Invariants

1. **Names are display labels, never keys.** A human-readable name is only
   ever displayed, never used to match, join, or score. Two verdicts attach
   to the same vendor if and only if their typed identifiers are equal —
   never because their names look alike.
2. **Merges require proof.** Two identifiers are treated as one entity only
   when common control is cryptographically proven (for example, a key-holder
   signing an assertion that a given `platform:` or `place:` identifier is
   also theirs), and every merge is itself a signed, public event. The
   identity graph is therefore auditable and reversible — never an operator
   quietly relabeling a name.

## 6. Log verification

A conforming verifier accepts a log if and only if, walking from the first
event: each event's `prev` equals the hash of the preceding event's full
canonical form (or genesis for the first), each `id` matches its recomputed
value, and each `sig` verifies against `signer`. The retired v0.1
implementation in git history is the executable form of this paragraph.

## 7. Privacy posture (forward-looking)

v0.1 identifies reviewers only by per-event public keys. The target design
is zero-knowledge attestation: proving "I hold a valid, unused right for
this vendor, in this window, in this locality" without revealing the
buyer's identity or purchase history — selective disclosure in the W3C
Verifiable Credentials family. This is research-stage; see the open
questions in the repository issues.
