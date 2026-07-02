# Score Specification v0.1

Status: **draft**. Spec identifier: `audience-score/score-spec@0.1`.

The score is a **versioned, deterministic, pure function** over verdict
events. Any party holding the event log and this document must be able to
recompute any published score exactly. Every published score manifest
carries the spec version that produced it, so historical scores remain
reproducible after the spec evolves.

## 1. Inputs

All admitted events of type `verdict` (per
[event-spec](../protocol/event-spec.md)) matching the query scope:

- `vendor_id` — required.
- locality scope — optional; v0.1 defines `national` (no filter) and
  `state` (filter on `body.service_locality.state`). Metro resolution is
  reserved for a future revision.
- `computed_at` — the rendering timestamp; an explicit input, so a
  rendering is reproducible for any past instant.

## 2. Weights

Each verdict event `e` contributes weight:

```
w(e) = tier_weight(e) × decay(e)
```

**Proof-tier weights** (normative for v0.1):

| tier | weight |
|---|---|
| `agent_mandate` | 1.0 |
| `vendor_receipt` | 1.0 |
| `card_link` | 0.9 |
| `email_receipt` | 0.6 |

Unknown tiers weigh 0 (excluded).

**Time decay** with a 24-month half-life:

```
decay(e) = 0.5 ^ (age_days(e) / 730)
age_days(e) = (computed_at − e.body.issued_at) / 86 400 000 ms, floored at 0
```

## 3. The score

Let `W` be the sum of `w(e)` over all in-scope verdicts and `W↑` the sum
over verdicts with `verdict = "up"`:

```
score = W↑ / W
```

The headline score is the **percentage of verified thumbs-up** — nothing
else enters it.

## 4. Confidence: Wilson lower bound

Published alongside the score, the Wilson score interval lower bound at 95%
confidence (`z = 1.96`), computed on the weighted counts (`n = W`,
`p̂ = W↑ / W`):

```
lower = ( p̂ + z²/2n − z·√( (p̂(1−p̂) + z²/4n) / n ) ) / ( 1 + z²/n )
```

clamped to ≥ 0. Agents that must rank conservatively should rank on the
lower bound, not the point score — it is what prevents a 2-for-2 vendor
from outranking a 480-for-500 one.

## 5. Display floors

- **Headline floor.** No score is displayed for scopes with fewer than
  **10** verdicts (raw count, not weighted). Below the floor the manifest
  reports `displayed: false` and null score fields — preventing a handful
  of verdicts from defining a vendor.
- **Dimension floor.** Each optional dimension chip (`quality`, `on_time`,
  `price`, `service`) displays its percent-positive only at ≥ **10**
  answered chips for that dimension in scope.

## 6. Rounding

Published values are rounded half-up to 4 decimal places, after all
computation.

## 7. Score manifests

A rendering is published as a signed manifest:

```json
{
  "manifest": {
    "spec_version": "audience-score/score-spec@0.1",
    "vendor_id": "…",
    "locality": { "state": "CO" },
    "sample_size": 12,
    "displayed": true,
    "score": 0.75,
    "wilson_lower_bound": 0.4677,
    "dimensions": { "on_time": { "displayed": true, "percent_positive": 1, "sample_size": 12 } },
    "computed_at": "2026-07-02T00:00:00.000Z",
    "provenance": {
      "event_count": 12,
      "event_set_hash": "<sha256 of the sorted ids of the exact event set used>"
    }
  },
  "signer": "<rendering key, base64url SPKI Ed25519>",
  "sig": "<base64url Ed25519 signature over the canonical manifest>"
}
```

The `event_set_hash` pins the exact events used, so a mirror can prove a
manifest was computed on the claimed data. The signature makes the manifest
portable: an agent that fetched it through any intermediary can still verify
who rendered it and that nothing was altered.

## 8. Non-goals of v0.1

Deliberately not yet specified, pending RFCs backed by data: account
diversity and age weighting, statistical outlier treatment for coordinated
verdict clusters, dispute-lane handling, and metro-resolution scoring.
These belong to admission and weighting policy and will be versioned here
when specified — never applied silently to an existing spec version.
