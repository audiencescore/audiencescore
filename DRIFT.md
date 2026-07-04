# DRIFT.md — v0.1 reality vs. spec v0.2a, in plain English

Written before any v0.2 code, as required by the build instructions: the live
repository was read file-by-file and diffed against `spec/SPEC-v0.2a.md`. Every
difference is recorded here with how it was resolved. **No drift item conflicts
with the spec in a way that required stopping the build** — chiefly because
v0.1 has no live deployment and no live data, so nothing that exists can break.

## GATE-1 decision (recorded first, as required)

**Question:** should v0.2 receipts adopt the TLAA project's Ed25519 signing
format natively, or stay standalone?

**Answer: adopt, per the recommendation.** The project owner pre-delegated
this decision in the handoff ("go with the recommendation" is the documented
answer, and the kickoff instructions granted full control of implementation
decisions). In
practice the conformance vectors in `conformance/` are the byte-level truth for
this format, and the implementation reproduces them exactly. Signing lives
behind one narrow interface (`reference-impl/src/v02/signing.js`), so if the
TLAA project's concrete format ever diverges from these vectors, exactly one
module changes and nothing else does.

## The drift register

**D-1 — Different object models, but nothing to migrate.** v0.1 models a
*vendor* receiving a *binary thumbs-up/down verdict*. v0.2a models *issuers*,
pseudonymous *holders* with roles, versioned composite *offerings*, and
*reviews* carrying a required overall score (the conformance vectors pin it as
an integer, 1–5) plus optional facet scores. The v0.2 spec (§9) says v0.1 maps
cleanly as the degenerate case; strictly, a binary verdict is not a 1–5 score,
so that mapping is looser than the spec implies. **Resolution:** moot in
practice — v0.1 explicitly collected no live data ("No live data is being
collected yet"), so there is no data to migrate and no breakage possible. The
v0.2 layer is added alongside the intact v0.1 reference implementation; the
degenerate-case mapping (up → 5, down → 1, single level, participant role,
atomic offering) is documented but has nothing to run against.

**D-2 — Two different cryptographic encodings now coexist.** v0.1 encodes keys
as base64url SPKI DER, signatures as base64url, hashes as SHA-256, and includes
the signer inside the signed payload. v0.2a receipts use raw 32-byte Ed25519
public keys as lowercase hex with an `ed25519:` prefix, lowercase-hex
signatures, BLAKE3 holder bindings, and exclude `sig` and `coattest` from the
signed bytes. These are different layers (v0.1 event envelope vs. v0.2 receipt
schema), and each is internally consistent with its own normative document.
**Resolution:** implemented side by side; nothing shared, nothing broken.

**D-3 — The repository was dependency-free; the spec requires BLAKE3, which
Node does not ship.** Node's built-in crypto has Ed25519 and SHA-256 but not
BLAKE3, and the holder binding (`blake3(derived_holder_pubkey || salt)`) is
normative. **Resolution:** one audited, exact-version-pinned dependency —
`@noble/hashes` — added to the reference implementation, with a committed
lockfile. This entry is the "prior discussion" the contributing guide requires
for a new dependency. Everything else remains Node built-ins.

**D-4 — v0.1 has no storage layer at all; the spec requires physical
append-only enforcement.** v0.1 keeps events in memory or a JSONL file, so
"append-only" was enforced by code convention. Spec I-5 and the build rules
require that UPDATE and DELETE be *physically refused by the storage layer*.
**Resolution:** the v0.2 store uses SQLite (built into Node ≥ 23.4; CI bumped
from Node 22 to 24) with `BEFORE UPDATE` / `BEFORE DELETE` triggers that abort
the statement inside the storage engine — the application's connection cannot
mutate or delete receipts, reviews, transactions, or protocol events even with
raw SQL. Honest caveat, stated here and in the code: SQLite has no user/role
system, so a production deployment on a server database must additionally use a
database role with no UPDATE/DELETE grants; the reference layer demonstrates
and tests the enforcement pattern (AT-19), and the health check alarms if the
triggers are ever missing.

**D-5 — v0.1 chains all events globally; v0.2 chains receipts per standing.**
The v0.1 log hash-chains every event to its predecessor. v0.2a receipts chain
ascensions per (holder, offering-version, role) through the `prev` field.
**Resolution:** both exist: the v0.1 event log is untouched; v0.2 receipts
implement per-standing chains with monotonicity checked at issuance and audited
by the I-3 health check.

**D-6 — The spec never states the overall-score scale.** §5 requires "one
required overall score" without a range; the conformance vectors use integers 1
through 5. **Resolution (flagged back rather than silently adapted):** overall
is an integer 1–5 in rendering v1 and admission; recorded here as a spec gap to
fold into the next spec revision.

**D-7 — The spec never fixes k for the k-anonymity gate (I-7).**
**Resolution:** k = 10 in rendering v1, matching v0.1's published display floor
of 10, defined as a named parameter of the rendering version (later rendering
versions may change it without touching the ledger). Recorded as a spec gap.

**D-8 — "Batched publication windows" (I-7) is operational, not computable.**
A pure function cannot batch by wall clock. **Resolution:** renderings take an
explicit `window` label as input and never read a clock (that purity is what
AT-14 tests); *when* windows are published is an operator/deployment concern,
documented in the rendering spec.

**D-9 — The old README's tagline is superseded.** v0.1: "every review is proven
by a purchase." v0.2: "every review is proven by a verified transaction or
verified participation" (free offerings enter at L2+ and are labeled as
verified-participant). **Resolution:** README merged from the handoff draft,
preserving the live repo's badges, license table, quickstart, layout table, and
governance links, and stating the two open release gates.

**D-10 — Repository layout gains the handoff's directories.** `spec/`,
`conformance/`, `tests/`, and this file are added at the root, exactly where
the audit protocol expects them. The v0.1 documents in `protocol/` and
`score-spec/` are retained unmodified (superseded versions stay forever, per
governance); rendering v1's normative parameters are added as
`score-spec/rendering-v1.md`.

**D-11 — TLAA is referenced but not vendored.** No TLAA specification exists in
this repository or the handoff package beyond the format the vectors pin.
**Resolution:** the vectors are treated as the normative interchange format
(see GATE-1 above); the swappable signing interface bounds the blast radius if
the upstream format ever differs.

**D-12 — Issuer binding (post-audit MAJOR finding, fixed).** The independent
audit of the v0.2a build found that a receipt was checked for a valid
*signature* but never for being signed by the offering's **declared** issuer.
A stranger could generate their own key, record a fake one-cent "sale" against
someone else's offering, obtain a validly-signed L1 receipt, and post a review
that blended into that offering's score — with no alarm. The spec already
implies the fix (§2: "Issuer — the party signing receipts: the provider of
record"), so enforcing it is faithful to the spec, not a deviation.
**Resolution:** receipts are now bound to the offering's declared issuer at
three layers — issuance (`recordTransaction`, `issueAttestation` refuse a
non-declared issuer), review admission (`submitReview` re-checks), and a
health-check detector (`checkIssuerBinding`) that alarms on any wrong-issuer
receipt already in storage. Regression tests in
`reference-impl/test/v02/at-finding-issuer-binding.test.js` reproduce the
auditor's exact attack and assert every layer refuses it. Proposed as a new
numbered invariant **I-8** for the next spec revision (currently a code-level
detector, consistent with how D-6/D-7 flag spec gaps). Note: the merchant-of-
record / marketplace co-attestation model (spec §4, F9) is unaffected — the
*issuer* is the provider of record; a marketplace co-attests via `coattest`,
it does not become the issuer.

## What was checked and found NOT to be drift

- The seven invariants (I-1..I-7), the threat register (T-1..T-10), roles,
  the attestation ladder, free-offering L2+ entry, versioned offerings,
  entity persistence, and refusal-as-event have no v0.1 counterparts to
  conflict with — they are additive.
- v0.1's score spec, event spec, receipt spec, governance constitution,
  licensing split (Apache-2.0 / CC BY 4.0 / ODbL), CI link checker, and
  community files are unaffected and remain in force.
- The education thesis in the handoff is strategic context only; per the
  build instructions, no education features were built and no vertical
  profile ships in this change.
- Editorial note: the committed copies of the handoff documents neutralize
  personal names ("the project owner", "the implementation") per this
  repository's practice of keeping contributor identity out of the tree. No
  normative statement was changed.
