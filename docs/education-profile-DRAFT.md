# Education vertical profile — DRAFT (non-normative)

> **Status: DRAFT, non-normative, incomplete on purpose.** This is a starting
> shape for the education vertical profile, to be **co-authored with the first
> anchor issuer against their real event stream** — not finalized in the
> abstract. It maps education-native concepts onto the protocol; it does not
> change the protocol (verticals are profiles, never forks — see the
> [README](https://github.com/audiencescore/audiencescore/blob/main/README.md)).
> Promoting any of this to a normative profile is a **spec change** and must go
> through the RFC process in
> [CONTRIBUTING.md](https://github.com/audiencescore/audiencescore/blob/main/CONTRIBUTING.md),
> behind the legal gate below. The runnable shape of the event mapping lives in
> [`reference-impl/examples/education`](https://github.com/audiencescore/audiencescore/tree/main/reference-impl/examples/education)
> (a demonstrator).

## 1. Scope

One vertical profile for **education**: online courses, bootcamps, and
ESA-funded offerings. It fixes how education-native entities and events map onto
the v0.2 primitives — the attestation ladder, roles, versioned composite
offerings — defined in
[`spec/SPEC-v0.2a.md`](https://github.com/audiencescore/audiencescore/blob/main/spec/SPEC-v0.2a.md).

## 2. Entity and offering mapping (to confirm with the partner)

| Education concept | Protocol object | Notes |
| --- | --- | --- |
| Course / cohort / seat sold | **Offering** (versioned) | e.g. `algebra2@v3`. A new cohort or syllabus revision is a new version; history never resets (spec §5, T-8). |
| Instructor | **Entity** (component) | Never reviewed directly; score derived across every offering they appear in. |
| Curriculum / syllabus | **Entity** (component) | Isolatable across instructors and platforms. |
| Platform / LMS | **Entity** (component) | |
| School / provider of record | **Issuer** | Signs receipts; the entity that operates the offering. |
| Marketplace / ESA portal | **Co-attester** | Merchant-of-record issues; marketplace co-attests (spec §4, T-10). |
| Student | **Holder**, participant role | |
| Parent / employer / ESA funder | **Holder**, payer role | Payers rate value-for-money only (F1). |

**Open questions for the partner** (do not guess these): the real component
taxonomy (does "instructor" split into lead vs. TA?); whether cohorts or
calendar terms are the versioning unit; how refunds/withdrawals surface in their
system so they become attested events, not deletions (spec §3).

## 3. Attestation-ladder mapping

This is the mapping the demonstrator encodes; the thresholds and completion
definitions are **the issuer's declared offering criteria**, not ours.

| Native event | Level / role | Condition |
| --- | --- | --- |
| Payment settled (paid offering) | **L1 TRANSACTED**, payer | value moved |
| Enrollment (paid offering) | **L1 TRANSACTED**, participant | seat taken |
| Enrollment (free offering) | *none* | no value moved; participant enters at L2 (F2) |
| Verified progress past threshold | **L2 ENGAGED**, participant | issuer-declared threshold (e.g. ≥60%) |
| Completion / final accepted | **L3 COMPLETED**, participant | issuer-declared completion definition |
| Verified external outcome | **L4 OUTCOME**, participant | e.g. independent assessment, verified placement — mechanics out of scope for v0.2 |

**Free offerings** (free courses, OER) issue no L1 and render as *verified
participant*, not *verified purchaser* — the score discloses that the Sybil cost
is effort, not money (spec §3, F2).

## 4. Legal gate (a launch condition, not code)

Per spec §8, a vertical profile ships only after a **per-vertical legal
review**. For education specifically, this DRAFT must not ship as a normative
profile until that review covers, at minimum:

- **ESA / public-funds** rules for the states in scope (how disbursement events
  may be attested and disclosed).
- **FERPA / student-privacy** exposure — the protocol's pseudonymity (spec §7,
  I-7 k-anonymity) is designed to add zero new disclosure, but this must be
  confirmed against enrollment sensitivity for minors.
- **Minors** — consent and identity handling when participants are children.

This gate belongs to the project owner and legal counsel. It is flagged here,
not resolved.

## 5. What is deliberately not decided here

The exact taxonomy, thresholds, co-attestation partners, refund handling, and
L4 outcome sources are all **left open for co-authoring with the anchor issuer**,
because the whole point of the profile is to fit a real provider's real events —
locking them in against a hypothetical provider would be exactly the abstract
over-fitting this draft is meant to avoid.
