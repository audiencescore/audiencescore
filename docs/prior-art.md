# Prior Art and Related Systems

Reputation systems that verify reviews cryptographically or gate them on
proof of purchase are not new; this page maps the neighboring designs and
where this protocol sits among them. Comparisons here are architectural,
not judgments of the people or companies building these systems — several
of the designs below get important things right, and we say so. Claims
about live systems carry the date we checked them.

## VeriBureau

*Source: [veribureau.com](https://veribureau.com), including its protocol
and methodology pages. Accessed 2026-07-02.*

VeriBureau is a commercial platform for cryptographically signed business
reviews, and the closest existing system to this project. Its design, per
its published pages: a business registers and, after a transaction,
generates a single-use **Proof Token** it shares with the customer;
customers holding a token leave *verified* reviews, while registered users
without one can leave *open* reviews that "carry lower trust weight." All
records land in a public, SHA-256 hash-chained, append-only audit log —
"if any entity — including VeriBureau operators — were to modify, delete,
or reorder a past record, the hash chain would break." Businesses receive
a 0–100 Trust Score weighted by each reviewer's accumulated reputation
(which rewards "text detail, specificity, and uniqueness" and softly
penalizes rating volatility) with industry-calibrated recency decay. Its
methodology page states: "The exact parameters (exponent, decay rate,
weights) are not published to prevent gaming," and that they "are
periodically reviewed and adjusted." The platform is proprietary (© all
rights reserved; no public license or source repository), free during
network formation. At access time its live counters showed roughly 1,470
business profiles, 15 reviews, and 105 audit-chain records.

**Worth adopting, credited here:** the DNS-based vendor-identity
certification ladder (email verification → DNS TXT domain proof →
protocol-participation subdomain) is a clever, cheap identity primitive;
the embeddable score badge is real vendor-side distribution; and
publishing small live numbers without embellishment is exactly the honesty
posture a trust system should have.

**The two architectural differences:**

1. **Who holds the right to speak.** A VeriBureau verified review exists
   only if the business issues a token, so the verified sample is
   assembled by the party being scored — the cryptography proves each
   review is real, but cannot prove the sample is representative. In this
   protocol the review right is minted by the *transaction* and held by
   the *buyer*: every purchaser can speak, and vendor consent is never
   part of the write path. Their token is issued by the vendor; our right
   is issued by the transaction.
2. **Whose score can you recompute.** VeriBureau's audit chain proves its
   *data* wasn't altered, but with unpublished, adjustable scoring
   parameters, no outside party can recompute a Trust Score — data
   integrity without score reproducibility. This protocol draws the
   secrecy line in the opposite place: the score function is an open,
   versioned, deterministic spec any mirror can recompute to the decimal,
   and confidentiality is confined to admission-time anti-fraud checks
   that are hash-committed on activation, publicly logged on every fire,
   and revealed on retirement ([GOVERNANCE.md](https://github.com/audiencescore/audiencescore/blob/main/GOVERNANCE.md)). Notably,
   both projects agree that fraud-detection criteria can't be fully
   public — the difference is whether that secrecy is allowed to touch
   the score.

## Merchant-invitation review platforms

Large review platforms (Trustpilot is the best-known pattern; accessed
descriptions 2026-07-02) distinguish reviews written from
merchant-triggered invitations — post-purchase emails carrying a review
link — from organic reviews. The invitation flow verifies a transaction
happened, but the merchant chooses when and to whom invitations go, so
the verified stream inherits the same selection-bias structure as
vendor-issued tokens. Aggregation and fraud-detection are proprietary,
and the underlying event data is not mirrorable.

## Platform-native "verified purchase" systems

Marketplaces (Amazon-style) label reviews from confirmed buyers of the
item. This is genuine proof-of-purchase gating — the closest mainstream
precedent for receipt-gated verdicts — but it exists inside one closed
platform: the proof works only for purchases made there, scoring and
ranking are proprietary, and neither events nor scores are portable. The
gating primitive is right; the openness is missing.

## Anonymous-but-verifiable reputation research

A published academic literature on blockchain reputation systems
demonstrates zero-knowledge proofs and ring signatures preserving reviewer
anonymity while keeping feedback verifiable — proving "I hold a valid,
unused credential for this transaction" without revealing identity or
purchase history. This is the research base for the privacy layer planned
in [event-spec §6](https://github.com/audiencescore/audiencescore/blob/main/protocol/event-spec.md#6-privacy-posture-forward-looking),
alongside selective disclosure in the W3C Verifiable Credentials family.

## Summary

| | Verified write gated on | Right held by | Score recomputable by anyone | Data mirrorable | Open source |
|---|---|---|---|---|---|
| **This protocol** | cryptographic proof of purchase | buyer (minted by the transaction) | yes — versioned open spec | yes — ODbL commons | yes |
| VeriBureau | vendor-issued Proof Token | vendor (issues/revokes tokens) | no — parameters unpublished | audit log public; scoring closed | no |
| Merchant-invitation platforms | merchant invitation | merchant | no | no | no |
| Marketplace verified purchase | platform purchase record | platform | no | no | no |

*Corrections welcome: if any characterization of a live system above is
out of date or wrong, please open an issue — this page is held to the
same accuracy bar as the rest of the project.*
