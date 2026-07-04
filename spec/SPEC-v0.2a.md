# AudienceScore Protocol Spec v0.2 (rev A — post-adversarial review)

Status: DRAFT for sign-off · Supersedes v0.1.0 as a strict generalization (§9)
Rev A integrates findings F1–F10 from the adversarial review register (companion doc).
Tagline invariant preserved: every review is proven by a verified transaction or verified participation — scores no one can buy.

---

## 0. The Decision

**Question:** Does AudienceScore need a v0.2 spec, or can education be handled as a feature on v0.1?

**Decision: v0.2, now — and this document is it.** Three facts force the call:

First, the ledger is append-only and receipts are signed. In an immutable attested system, schema mistakes are permanent: a receipt minted today without an attestation level, a role, or a versioned offering reference can never be retroactively upgraded. Waiting does not reduce the cost of this change; it compounds it with every receipt issued.

Second, the first inbound market pull (education) is unrepresentable in the v0.1 model. v0.1 answers one question: "did you buy this product?" Education asks different ones: "who paid, who attended, what standing does each have, toward which part of which version of which offering?" No feature flag bridges that — it is a data-model gap.

Third, v0.2 is a strict generalization. v0.1 is the degenerate case: single attestation level, single role, atomic unversioned offering. Existing data maps cleanly with zero breakage. The window in which that remains true is now, while adoption is small.

**Scope discipline:** v0.2 adds two primitives — the attestation ladder and composite offerings — plus roles, versioning, the receipt schema, invariants, and threat model that make them safe. It is not an education product. Education becomes a one-page vertical profile that maps its native events onto these primitives. **Verticals are profiles, never forks.**

## 1. Design Principles

1. **Verification ≠ certification.** A receipt proves standing to speak — that an event occurred. It never grades a human. AudienceScore attests events; the aggregate of attested voices grades the provider.
2. **The review object is the transaction object.** You review what you participated in. Everything else is derived.
3. **Raw is forever; scores are renderings.** Reviews are journal entries. Published scores are versioned, deterministic renderings over them. Scoring math can iterate indefinitely without touching the ledger. (Direct port of the SupaLedger invariant.)
4. **Issuers attest, holders review, the protocol renders.** No party performs another party's role — the review-layer rhyme of "AI proposes, humans commit."
5. **Standing must cost something real.** On paid offerings, minimum attack cost equals real revenue to the target. On free offerings, standing costs verified time and effort — and every rendering discloses which kind of cost backs it.
6. **Non-completion is signal, not noise.** Refunds, withdrawals, and dropouts carry the most informative negative signal in the system; the protocol preserves their standing rather than laundering them out.

## 2. Core Objects

**Entity** — anything that accrues a derived score: instructor, curriculum, institution, platform, venue, brand, product line. Entities are never reviewed directly, and entity history persists across every offering they ever appeared in (§5).

**Offering** — the transactable or joinable unit; the thing a receipt points at. Offerings are versioned (algebra2_v3) and declare component entities with roles. An offering with a single component and one version is exactly a v0.1 product.

**Issuer** — the party signing receipts: the provider of record, optionally countersigned by a payment rail, marketplace, or platform. Keyed identity, Ed25519. For marketplace sales, the merchant of record issues; the marketplace co-attests.

**Holder** — a receipt holder and prospective reviewer, in one of two roles: **payer** (funded it) or **participant** (consumed it). One person may hold both. Parent/student, employer/employee, insurer/patient, org/seat-holder are all expressible. Holders are pseudonymous with per-issuer derived keys (§7).

**Receipt** — a signed attestation binding holder → offering-version at an attestation level, in a role (§4).

**Review** — one required overall score, optional component facet scores, optional text — gated by a receipt (§5).

**Rendering** — a versioned deterministic function from raw reviews to published scores (§5).

## 3. The Attestation Ladder

Four levels. **Levels are independent attestation types — no level is a prerequisite for another.** Verticals map native events onto them; not every vertical or offering issues every level, and every published score discloses the level mix and role mix behind it.

**L1 TRANSACTED** — value moved. Purchase, enrollment payment, booking, ESA disbursement. Issuer-signed, ideally co-attested by the payment rail. Payer-role holders cap at L1: they have standing on value-for-money and nothing else.

**L2 ENGAGED** — verifiable use by a participant. LMS progress past a declared threshold, attendance, activation, service delivered.

**L3 COMPLETED** — finished or kept. Completion attestation; for physical goods, retention past the return window.

**L4 OUTCOME** — verified external result. Independent assessment passed, verified placement, repeat purchase or renewal.

Rules:

- **Free offerings** (free courses, OSS, open curricula) issue no L1. Participants enter at L2+, where standing costs verified time. Renderings label this class distinctly — *verified participant* vs. *verified purchaser* — and disclose that no purchase gate exists. The Sybil cost on free offerings is effort, not money, and the score says so.
- Levels are **monotonic** per (holder, offering-version, role): standing only ascends; ascensions chain to prior receipts.
- A review permanently records level and role at posting time and inherits upgrades as annotations.
- **Refund and withdrawal are attested events, not revocations.** A negative review wearing a verified-refund badge is high-value signal. Deliberate departure from the Amazon model, which deletes its most informative reviewers.
- **Attestation requests:** a holder may formally request an L2/L3 attestation they believe they have earned; issuer refusal is a logged protocol event. Renderings disclose each issuer's attestation-issuance rates against cohort norms (see T-7).
- Default renderings weight by level, but must publish both an **all-verified view** and a **completer view**, with completion rate disclosed — level-weighting is never allowed to become survivorship laundering (F6).

## 4. Receipt Schema

```json
{
  "spec": "as/0.2a",
  "receipt_id": "uuidv7",
  "issuer": "ed25519:<pubkey>",
  "holder": "blake3(derived_holder_pubkey || salt)",
  "role": "participant | payer",
  "offering": "<offering_id>@<version>",
  "level": 2,
  "event": "participated",
  "issued_at": "<RFC3339>",
  "prev": "<receipt_id or null>",
  "coattest": ["ed25519:<processor_or_platform_sig>"],
  "sig": "ed25519 over canonical serialization"
}
```

**Issuance rules (critical):**
- L1 receipts MUST issue automatically on the transaction event — never at issuer discretion. Selective issuance is grade inflation on the reviewer pool; the reconciliation invariant (I-2) makes withholding visible as a gap between transactions and receipts.
- L2/L3 attestations follow declared, published criteria per offering (progress threshold, completion definition). Refusals against a holder request are logged events. Platform co-attestation (an LMS or marketplace that is not the provider) is preferred wherever it exists, and renderings disclose the attestation-source mix — issuer-solo L2/L3 is honestly weaker than co-attested L1, and the score shows it.

**Portfolio decision — flagged for the project owner's sign-off, the only one in this spec:** adopt the TLAA Ed25519 receipt format natively rather than defining a parallel schema. For: one trust primitive across the portfolio, TLAA gains its first mass-consumer application, AudienceScore inherits a hardened signing path, agent consumers get one verification codepath. Against: couples two open-source release cycles. **Recommendation: adopt.** Decide before this section is implemented (decision recorded in DRIFT.md). Either way, the receipt scheme requires an **independent cryptographic review before any receipt signs a real transaction** — that gate is non-negotiable and this document does not satisfy it.

## 5. Composite Offerings and Scoring

Reviews attach only to offering-versions. Each review carries one required overall score and may carry facet scores — but only against components the offering declares, and only from participant-role receipts (payers rate value, not delivery).

An entity's score is a rendering over facet scores naming it plus decomposed overall scores from every offering-version where it appears. The same curriculum across five instructors isolates the curriculum; the same instructor across three platforms isolates the instructor.

**Entity persistence rule:** entities accumulate history across all offerings forever. Minting a new offering_id never orphans instructor, curriculum, or institution history — score-resetting by relaunch is structurally impossible (T-8), and issuer offering-turnover rate is itself a disclosed rendering input.

**Version scoping:** renderings are version-scoped by default; cross-version rollups are disclosed as such, and time-decay lives in the rendering version, never the ledger. A 2019 completion does not silently grade a 2026 curriculum.

v0.2 ships rendering v1 — level-and-role-weighted means with disclosed sample mix, dual all-verified/completer views, and k-anonymity gating (I-7). Better attribution models ship as later rendering versions; because renderings are deterministic and versioned, scoring-model debates never block the ledger.

The ontology question stays closed: **the institution is an entity, a component of many offerings, never reviewed and always derived** — it cannot escape its record and cannot be reviewed by anyone who never transacted with it.

## 6. Invariants — Health-Check Register

Challenge-brief hard question: does this introduce new invariants the health check must monitor? Yes — seven.

**I-1 No orphans.** Every review references exactly one valid receipt; every receipt references exactly one offering-version.
**I-2 Reconciliation.** Per issuer per offering: L1 receipts issued must reconcile against attested transaction volume. Gaps beyond tolerance alert. This is the protocol's "balance sheet nets to zero."
**I-3 Monotonicity.** A (holder, offering-version, role) standing level never descends.
**I-4 Rendering integrity.** Every published score recomputes byte-identical from raw reviews plus the named rendering version.
**I-5 Append-only.** Reviews are never mutated or deleted; edits, refunds, upgrades, and attestation refusals are new events.
**I-6 Facet validity.** Facet scores exist only against declared components, from participant receipts only.
**I-7 k-anonymity publication gate.** No rendering publishes below a threshold of k distinct receipts; publication occurs in batched windows to break timing correlation; text display may be suppressed below threshold while scores still accumulate. Protects reviewers inside power relationships (students, patients, employees).

## 7. Privacy and Identity

Enrollment is itself sensitive — a recovery program, a bankruptcy course, a special-needs school. Holders are pseudonymous by default: receipts bind salted hashes of **per-issuer derived keys**, so colluding issuers cannot build cross-provider enrollment graphs. The holder proves receipt possession at review time without revealing identity. No public holder-to-offering directory exists anywhere in the protocol. An optional verified-human badge (proof of personhood) can attach without deanonymization. Issuers already know their own customers; the protocol adds zero new exposure — and I-7 protects the small-cohort cases where content alone could deanonymize.

## 8. Threat Model

**T-1 Issuer mints receipts for shills.** Countered by I-2 reconciliation, rail co-attestation, issuance-anomaly detection. Forging signed receipts is discrete, attributable, legally actionable fraud — unlike deniable astroturf.
**T-2 Sybil standing-farming.** Standing is per-offering, never global karma. On paid offerings the attack funds the victim; on free offerings the cost is verified effort and the score class is disclosed (F2).
**T-3 Verified extortion.** Residual risk that predates verification. Mitigations: issuer right-of-response bound to the same receipt, outlier treatment inside renderings, holder review-history transparency. No overclaim.
**T-4 Selective L1 withholding.** Automatic-issuance rule plus I-2 gap detection.
**T-5 Holder deanonymization.** §7 derived keys, possession proofs, no directory, plus I-7 for small cohorts.
**T-6 Rendering capture.** I-4 determinism and public versioned rendering specs — anyone can recompute any score.
**T-7 Upper-ladder capture.** Issuer gates L2/L3 against expected critics. Countered by published attestation criteria, logged refusals of holder requests, disclosed issuance-rate anomalies, platform co-attestation preference, and disclosed attestation-source mix.
**T-8 Score-resetting via offering churn.** Countered by the entity persistence rule and disclosed offering-turnover rates.
**T-9 Retaliation inside power relationships.** Students, patients, and employees review parties who still hold power over them. Countered by I-7 k-anonymity gating and batched publication; residual risk acknowledged for tiny cohorts.
**T-10 Marketplace-as-issuer conflict.** A marketplace attesting its own catalog has incentives. Merchant-of-record issues; marketplace co-attests; conflicts disclosed in renderings.

**Regulated verticals:** financial-product reviews implicate SEC marketing/testimonial rules; healthcare attestation touches HIPAA. Each vertical profile requires a legal gate before it ships. Not protocol machinery — but a launch condition.

## 9. Migration: v0.1 → v0.2

Every v0.1 review maps to an L1 TRANSACTED participant-role receipt on an atomic, single-version, single-component offering. No data loss, no breaking change; v0.1 is formally the degenerate case. **Implementation note:** this spec was drafted against the v0.1 design model; before building, diff against the live repo (github.com/audiencescore/audiencescore) and flag any drift back into this document rather than silently adapting.

## 10. Out of Scope for v0.2

L4 issuance mechanics (defined, not operationalized); dispute and moderation flows; incentives or tokens of any kind; the education taxonomy (a one-page vertical profile authored after v0.2 lands, behind its own legal gate where applicable); marketplace, ESA, LMS, and payment adapters — those consume the protocol and must be near-zero-effort for issuers (S1), but they are not the protocol.

## 11. Execution Note

Four build units fall out of this document: the §4 receipt schema and signing path, the §5 rendering v1 (dual views, version scoping, k-gating), the §6 invariant checks wired into the health monitor, and the attestation-request/refusal event flow. Hands to Claude Code as a single autonomous run — kickoff-script pattern, not manual phased prompts. Gates before release, in any order: the owner's TLAA sign-off (recorded in DRIFT.md), independent crypto review of the receipt scheme, standard review-agent gauntlet on the implementation.
