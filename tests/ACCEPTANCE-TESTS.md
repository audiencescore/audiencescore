# Acceptance Tests — AudienceScore v0.2a

Rules of this document: every test below MUST exist as an automated, executable test
in the repository, MUST pass in CI, and MUST be traceable by its AT number in the
test code. 100% pass is required — this is correctness, not a score. Where a test
says "seed a violation," the test creates the bad state deliberately and passes only
if the system detects or refuses it. Tests are grouped by what they protect.

## Group A — Receipt cryptography and structure (spec §4, conformance/)

**AT-1 Valid signature accepted.** Given vector receipts marked `sig_valid`, the
implementation's verifier accepts each one.
**AT-2 Tampered payload rejected.** Given the vector whose level was altered after
signing, verification fails.
**AT-3 Wrong-key signature rejected.** Given the vector signed by a non-issuer key,
verification fails.
**AT-4 Canonicalization is exact.** The implementation's canonical bytes for each
vector receipt are byte-identical to the reference (sorted keys, no whitespace,
UTF-8, sig excluded). A single differing byte fails the test.
**AT-5 Co-attestation verifies independently.** A receipt with a platform co-signature
verifies against both keys; corrupting either signature is detected.
**AT-6 Ascension chain accepted.** The L2→L3 chained vector (prev linkage) validates
as a legal ascension.
**AT-7 Descension rejected (I-3).** The L3→L2 vector is refused with a monotonicity
violation.
**AT-8 Automatic issuance.** When a transaction event is recorded, an L1 receipt
exists afterward with no code path consulted for permission. The test also proves
the negative: there is no API or function through which issuance can be skipped
for a specific holder (attempting to find one is part of the test design).

## Group B — Roles, free offerings, versioning (findings F1, F2, F7)

**AT-9 Payer/participant split.** A payer-role receipt and a participant-role receipt
for the same offering coexist for different holders; the payer cannot ascend past L1.
**AT-10 Payer facet restriction.** A payer-role review with facet scores is rejected;
overall score only.
**AT-11 Free offering entry at L2.** An offering with no price issues no L1; an L2
participant receipt on it gates a review successfully, and the stored review is
classed *verified participant*, not *verified purchaser*.
**AT-12 Version binding.** A receipt for offering@v1 cannot gate a review attached to
offering@v2.
**AT-13 Refusal is an event.** A holder's attestation request that the issuer refuses
produces an immutable logged event retrievable in the issuer's public issuance stats.

## Group C — Reviews and renderings (spec §5, findings F4, F6)

**AT-14 Determinism (I-4).** Rendering the same raw reviews with the same rendering
version twice, on different days, yields byte-identical published scores.
**AT-15 Dual views.** For a fixture where dropouts rate 1★ and completers rate 5★,
the all-verified view and completer view differ, both publish, and completion rate
is disclosed alongside. A rendering that publishes only the completer view fails.
**AT-16 k-anonymity gate (I-7).** With k−1 receipts' worth of reviews, no score is
publicly rendered; at k, it renders. Review text remains suppressed below threshold
while still counting toward the eventual score.
**AT-17 Facet validity (I-6).** A facet score naming an entity not declared as a
component of the receipted offering-version is rejected.

## Group D — Invariant alarms (each must FIRE when seeded; spec §6)

**AT-18 I-1 orphan alarm.** Seed a review whose receipt reference does not resolve;
the health check flags it.
**AT-19 I-5 append-only enforced physically.** Attempt UPDATE and DELETE on a stored
review and on a stored receipt through the application's database role; both are
refused by the storage layer itself. Edits succeed only as new versioned events.
**AT-20 I-2 reconciliation alarm.** Seed an issuer with 100 attested transactions and
103 L1 receipts; the reconciliation check raises an alert identifying the issuer,
offering, and gap.
**AT-21 I-3 monotonicity alarm.** Seed a descending standing chain directly in
storage; the health check flags it even though the API would have refused it.
**AT-22 T-8 entity persistence.** Retire an offering and mint a successor offering_id
with the same instructor entity; the instructor's derived score still includes the
retired offering's reviews. Any rendering that drops them fails.
**AT-23 T-7 issuance-rate disclosure.** Given two issuers with identical enrollment
but one attesting completion at an anomalously low rate, the rendering output for
that issuer discloses the anomaly.
**AT-24 Privacy floor.** Prove there is no endpoint, query, or export that returns a
holder→offering directory; per-issuer derived keys produce different holder bindings
for the same person across two issuers (fixture check).

## Group E — Hygiene

**AT-25 No test keys in production paths.** A repository scan asserts the conformance
seed bytes and test public keys appear nowhere outside conformance/ and tests.

Traceability: AT-1..8 → §4, F-cryptography; AT-9..13 → F1/F2/F7, §3; AT-14..17 →
§5, F4/F6, I-4/I-6/I-7; AT-18..24 → I-1/I-2/I-3/I-5, T-7/T-8, §7; AT-25 → key hygiene.
