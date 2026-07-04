# AudienceScore v0.2 — Adversarial Review Findings Register

Method: red-team pass across verticals (education, healthcare, B2B software, marketplaces, hospitality, home services, financial products, OSS/free content) plus steelman of the strongest opposing positions. Format: Critic findings → Resolver deltas, applied to spec rev A. Severity: CRITICAL (architecture wrong), MAJOR (exploitable as specced), MINOR (tighten), STRATEGIC (not a protocol problem, but real), HELD (attack failed — design survived).

---

## CRITICAL — architecture was wrong, now fixed

**F1 — Payer ≠ beneficiary.** The spec assumed the buyer is the consumer. In the biggest markets they aren't: parent pays / student attends, employer pays / employee uses, insurer pays / patient is treated, org buys 500 seats / employees use them. ESA money is a three-party split (state pays, parent directs, child consumes). v0.2 as written couldn't say who holds standing. **Delta:** receipts now carry a role — payer or participant. Payer standing caps at L1 (they can attest value-for-money, nothing else); participants ascend L2–L4. Seat activation under a master transaction issues participant receipts. This one primitive covers education, B2B, and healthcare simultaneously.

**F2 — Free offerings break the purchase gate.** Education's largest segment includes free content (MOOCs, Khan-style platforms, open curricula), and OSS is entirely free. "Proof of purchase" yields no L1, and if the ladder requires L1 first, the wedge market's biggest shelf is unreviewable. Worse, free enrollment costs nothing, which resurrects the Sybil attack the purchase gate exists to kill. **Delta:** levels are now independent attestation types — no L1 prerequisite. Free offerings enter at L2+, where standing costs verified time and effort instead of money. Renderings must label the class distinctly (verified participant vs. verified purchaser) and disclose that no L1 exists. Attack cost shifts from money to time; the spec says so out loud instead of pretending.

**F3 — Upper-ladder capture.** L1 has external co-attestation (payment rails). L2/L3 were attested solely by the issuer — meaning the entity being reviewed controls who climbs to the most heavily weighted standing. A school that suspects a student will review badly simply never attests their completion. The automatic-issuance rule covered transactions but not completions, which involve issuer judgment. This is the grade-inflation instinct moved one layer up. **Delta:** holders can formally request attestation; refusals are logged protocol events. Renderings disclose each issuer's attestation-issuance rates against cohort norms — anomalously stingy L3 issuance becomes visible. Platform co-attestation (LMS ≠ provider) is preferred wherever it exists. New threat entry T-7. Honest position now in spec: issuer-solo L2/L3 is weaker than co-attested L1, and every score discloses its attestation-source mix.

## MAJOR — exploitable as specced, now fixed

**F4 — Reviewer inside a power relationship.** Product buyers review from safety. Students review people who still control their grades, recommendations, and small cohorts where "the one who complained about the pacing" is identifiable from text alone. Pseudonymity alone doesn't survive a 9-person cohort. **Delta:** new invariant I-7 — no rendering publishes below a k-anonymity threshold of distinct receipts, and publication is batched in windows to break timing correlation. Text display can be suppressed below threshold while still counting toward score.

**F5 — Score-resetting via offering churn.** A provider with a bad record mints a new offering_id and starts clean — the restaurant-relaunching-on-delivery-apps move. **Delta:** entity persistence rule made explicit: entities accumulate across every offering they ever appeared in, forever; new offering IDs never orphan instructor, curriculum, or institution history. Issuer offering-turnover rate is a disclosed rendering input. New threat entry T-8.

**F6 — Survivorship laundering.** Weighting L3/L4 higher sounds rigorous but selects for people who liked it enough to finish; the dropouts holding the negative signal sit at L1. Naive level-weighting is a positivity bias with extra steps. **Delta:** renderings publish two views — all-verified and completer-view — plus mandatory completion-rate disclosure. Non-completion is signal, not noise (same logic that kept refund reviews alive).

**F7 — Staleness and versioning.** A 2019 completion reviewing in 2026 describes a course that no longer exists. **Delta:** offerings are versioned; receipts bind to the version; renderings are version-scoped by default with cross-version rollups disclosed and time-decay defined in the rendering version, not the ledger.

## MINOR — tightened

**F8 — Cross-issuer correlation.** Reused holder keys let colluding issuers build enrollment graphs. Delta: per-issuer derived keys mandated.
**F9 — Marketplace-as-issuer conflict.** A marketplace issuing receipts for its own catalog has incentives; merchant-of-record rule plus co-attestation noted in threat model.
**F10 — Regulated-vertical speech.** Financial-product reviews trip SEC marketing/testimonial rules; healthcare attestation touches HIPAA. Not protocol problems — each vertical profile now requires a legal gate before launch. (Same reflex as the fund: consult counsel per vertical.)

## STRATEGIC — steelman of the opposition

**S1 — Adoption adverse selection (the strongest opposing argument).** Why would a mediocre provider ever issue receipts? Only above-average providers volunteer, so the system risks becoming a badge for the already-good. Resolution is go-to-market, not protocol: absence becomes signal (a provider with no verified score reads like a restaurant with no reviews), and the wedge is demand-side mandate — ESA programs and marketplaces requiring receipt issuance as a listing condition. The protocol's job is only to make issuance cheap and automatic; the spec now says adapters must be near-zero-effort for issuers.

**S2 — "Unverified reviews are good enough."** They were, barely, for $12 purchases in a human-read market. The counter is already the thesis: verification value scales with ticket size, and agent buyers cannot safely consume unverified corpora at all.

## HELD — attacks that failed

Sybil standing-farming on paid offerings (attack funds the victim — economics held). Refund-as-signal (survived re-attack; generalized into F6). Derivation-only entity scores (no direct-review path found around it). Rendering determinism (capture requires public, recomputable math changes — visible by construction).

## External gates still required (no schedule, just gates)

1. Independent cryptographic review of the receipt scheme before any receipt signs a real transaction — self-reviewed crypto is how protocols die, and this review does not substitute.
2. Legal pass per regulated vertical profile (F10) before that profile ships.
3. Run the repo through the standard review-agent gauntlet once the implementation lands — this register is the design-layer pass, not the code-layer pass.
