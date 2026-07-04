# Rendering v1 (spec v0.2a)

Status: **draft**. Spec identifier: `audiencescore/rendering@1`.
Implements spec v0.2a §5 (see [/spec/SPEC-v0.2a.md](../spec/SPEC-v0.2a.md));
the reference implementation is `reference-impl/src/v02/rendering.js`.

Rendering v1 is a versioned, deterministic, **pure** function from
(raw reviews, this rendering version, an explicit window boundary) to
published scores. It reads no clock, no randomness, no network: the same
inputs produce byte-identical output on any machine on any day (I-4).
Superseded rendering versions stay in this directory forever, so every
historical score remains reproducible.

## 1. Inputs

- The offering-version (or entity) being rendered.
- Every admitted review for it, joined with its receipt standing: role,
  level at posting, and the chain's maximum attested level as of the window.
- The issuer attestation-issuance statistics for the cohort (for §6).
- `window_end` — an explicit timestamp bound. Only reviews posted and
  receipts issued at or before it enter the rendering. Publication happens
  in batched windows (I-7); the batching cadence is operational, but the
  boundary is always an explicit input so any published score recomputes
  exactly.

## 2. Normative parameters

| Parameter | Value | Meaning |
|---|---|---|
| `K_ANONYMITY` | **10** | No score or review text publishes below 10 distinct receipts (I-7). |
| `COMPLETER_LEVEL` | **3** | The completer view includes standings whose chain reached L3+. |
| `LEVEL_WEIGHT` | L1 1.0 · L2 1.25 · L3 1.5 · L4 2.0 | Weight by the chain's max attested level. |
| `ROLE_WEIGHT` | participant 1.0 · payer 0.5 | Payers attest value-for-money; participants attest delivery. |
| `ANOMALY_RATIO` | **0.5** | An issuer's completion-attestation rate below 0.5 × the cohort median is disclosed as anomalous (T-7). |

## 3. The score

A review's weight is `LEVEL_WEIGHT[chain_max_level] × ROLE_WEIGHT[role]`.
Each published view is the weighted mean of `overall` (an integer 1–5; see
DRIFT.md D-6), rounded half-up to 4 decimal places after all computation.

**Two views always publish together (F6):** the *all-verified* view over every
review and the *completer* view over reviews whose standing reached
`COMPLETER_LEVEL`, with the completion rate disclosed beside them.
Level-weighting is never allowed to become survivorship laundering — the
dropouts' view is a first-class output, not a footnote.

## 4. Disclosure block

Every offering rendering carries: the level mix, role mix, and
verified-purchaser / verified-participant class mix of its sample; the
attestation-source mix (co-attested vs. issuer-solo); whether a purchase gate
exists at all (free offerings say `purchase_gate: false` and render as
*verified participant*, F2); and the k-anonymity floor in force.

## 5. Scoping

Renderings are **version-scoped by default** (F7). A cross-version rollup is
a distinct subject (`offering-all-versions:<id>`) that always carries
`cross_version: true` and the per-version breakdown. Entity renderings span
every offering-version that ever declared the entity as a component —
**including retired offerings** (T-8): history is permanent by construction.

## 6. Issuer honesty disclosure

Each offering rendering disclosures its issuer's completion-attestation rate
against the cohort median, the anomaly flag (`ANOMALY_RATIO`), and the count
of logged attestation refusals (T-7): an issuer that gates completion
attestations against expected critics becomes visible in every score it
touches.

## 7. Facets

Facet scores render per declared component entity, from participant-role
reviews only (I-6), with the same weighting and the same k-gate as the
headline views.
