# Education issuer adapter — DEMONSTRATOR

**This is illustrative code, not a product and not a live integration.** Same
posture as [`reference-impl/demo.js`](../../demo.js): it shows *how* an education
issuer would feed the AudienceScore v0.2 protocol from its own operational
events, so a design/sales conversation has something concrete to point at and
the real adapter has a shape to start from. Do not point it at real learner
data as-is.

## What it shows

An education issuer — an online course platform, a bootcamp, or an ESA
marketplace — already emits the events the [attestation ladder](../../../spec/SPEC-v0.2a.md)
needs. The adapter just maps them:

| Native event (generic webhook) | Protocol primitive |
| --- | --- |
| `payment.succeeded` (paid offering) | **L1 TRANSACTED**, payer role |
| `enrollment.created` (paid offering) | **L1 TRANSACTED**, participant role |
| `enrollment.created` (free offering) | *no L1* — no value moved; participant enters at L2 on verified progress (spec §3, F2) |
| `lms.progress`, `pct >= L2 threshold` | **L2 ENGAGED**, participant role |
| `lms.completed` | **L3 COMPLETED**, participant role |

Receipt signing, the append-only SQLite store, monotonic standing, issuer
binding, and every invariant are the **real v0.2 modules** — the adapter only
routes events to them.

## Run it

```sh
node reference-impl/examples/education/demo-education.js
```

It replays a synthetic webhook stream for a paid course and a free course
(including deliberately out-of-order and below-threshold events, to show they
are absorbed as no-ops), verifies every issued receipt, posts receipt-gated
reviews, renders a deterministic dual-view score, and runs the invariant health
check (expects zero violations).

## Files

- [`adapter.js`](adapter.js) — the `EducationIssuerAdapter` interface and the
  generic event→primitive mapping.
- [`demo-education.js`](demo-education.js) — the runnable worked example above.

The adapter is exercised in CI by
[`reference-impl/test/education-adapter.test.js`](../../test/education-adapter.test.js)
so it can't silently rot.

## What a real integration changes (and why this is only a demonstrator)

1. **Holder identity is stubbed.** In the protocol (spec §7) the holder controls
   a root secret that never leaves the holder's own agent; the issuer receives an
   already-pseudonymous binding and therefore *cannot* build a cross-provider
   enrollment graph. This demonstrator derives a demo binding issuer-side so the
   example runs without holder agents — reproducing the per-issuer-derived-key
   unlinkability *mechanism*, but trading away the real privacy property. **A
   production adapter must never derive holder roots issuer-side.**

2. **Idempotency.** Real webhook streams retry and reorder. `handle()` already
   absorbs out-of-order ascensions as no-ops, but a production adapter must also
   dedupe by the provider's event id so a re-delivered `payment.succeeded` does
   not mint a second L1. That bookkeeping is out of scope here.

3. **Co-attestation.** The demonstrator issues issuer-solo receipts. Where an
   LMS or payment rail can co-sign (spec §4), the real adapter should pass the
   co-attester keys so renderings can disclose the stronger attestation source.

4. **Mapping is provider-specific.** The event names here are generic. The real
   adapter maps one concrete provider's events, and the exact thresholds and
   completion definitions come from that provider's declared offering criteria —
   which is why the [education vertical profile](../../../docs/education-profile-DRAFT.md)
   is a **draft to be co-authored with the first anchor issuer**, not finalized
   in the abstract.

## Not done here (on purpose)

No real provider integration, no live data, no deployment, no legal sign-off.
Regulated-vertical and ESA legal review is a launch gate (spec §8), not a code
concern — flagged, not resolved.
