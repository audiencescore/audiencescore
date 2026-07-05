# Multi-tenant ingestion + transaction de-duplication — design

**Status:** design for the next pilot build. Pilot deployment, pre-cryptographic-audit.

Two capabilities so AudienceScore is "designed for everyone to connect" from day one:

1. **Platform-direct ingestion** — platforms, protocols, marketplaces, large merchants, and
   individual merchants can all send us transactions through ONE authenticated rail, and a
   platform can cover all of its merchants from a single integration (Stripe-Connect model).
2. **De-duplication across sources** — when the same real sale is reported by several partners
   (e.g. Stripe AND QuickBooks AND the merchant, all connected), it produces exactly ONE
   review-right, never several.

The two are one system: every source posts the same normalized event; the dedup layer decides
mint-vs-corroborate.

---

## Grounding in the current ledger (already present)

- `transactions(tx_id PRIMARY KEY, issuer, offering, amount_cents, occurred_at)` — the PK on
  `tx_id` is the natural idempotency anchor. Two inserts with the same `tx_id` cannot both
  succeed.
- `recordTransaction()` already: (a) mints the L1 receipt in the SAME atomic transaction as the
  `transactions` row (no discretionary skip — T-4/AT-8), (b) enforces the offering's declared
  issuer (PR #9), and (c) accepts `coattesterPrivateKeys` so a receipt can carry co-signatures.
- All ledger tables are append-only at the storage engine (I-5). **Corroborations therefore go in
  a NEW append-only table — we never UPDATE a receipt to add a co-signer after the fact.**

---

## Part 1 — Platform-direct ingestion

### New tables (append-only)

- `partners(partner_id PK, name, kind, public_hex, auth_ref, scopes, created_at)`
  `kind ∈ {platform, protocol, rail, marketplace, merchant}`. A partner is any external actor
  authorized to send transactions. Keyed Ed25519 identity.
- `partner_issuer_links(partner_id, issuer_id, connected_account_ref, linked_at)` — maps a
  platform's connected merchant to our issuer identity. One platform → many issuers. This is what
  makes "connect once, cover all merchants" work.
- `corroborations(corroboration_id PK, tx_id, receipt_id, source_partner_id, source_txn_ref,
  amount_cents, occurred_at, sig, logged_at)` — every additional source that resolves to an
  already-minted transaction lands here (see Part 2).

### One ingestion endpoint

`POST /v1/transactions` — authenticated per partner (API key / OAuth client-credentials / mTLS),
body signed by the partner's key. Normalized event:

```
{ partner_id, issuer_ref | connected_account_ref, offering_ref,
  rail, processor_txn_id, amount_cents, currency, occurred_at,
  customer_contact?, role?, partner_sig }
```

The existing Stripe webhook handler, and future QuickBooks/Square/Shopify connectors, become
**producers** that translate their native events into this one call. A platform or protocol that
wants to send us data directly calls it directly. Everything funnels through the same dedup path.

### Platform onboarding (Stripe-Connect clone)

`POST /v1/partners/{id}/merchants` (or the OAuth callback) provisions issuer identities in bulk
for a platform's connected merchants and custodially generates each signing key. The merchant's
one-time action is a single OAuth consent; the platform + AudienceScore do the rest.

### Custodial signing at scale

Extend the existing swappable signing interface (GATE-1): key backend is file-based in the pilot,
KMS/enclave in production. Ed25519 requires the secure-enclave path (Turnkey/QuorumOS-style), not
vanilla AWS KMS (whose native curves are RSA/ECDSA/SM2). Trust shift is disclosed; reconciliation
(I-2) is the check that a custodied key is not minting phantom receipts.

---

## Part 2 — De-duplication (the double-dipping fix)

### The canonical transaction key

All sources must compute the SAME key for the SAME real sale, and the key must never collide
across merchants. Definition:

```
tx_canonical_key = "{issuer_id}|{rail}:{normalize(processor_txn_id)}"
```

The payment rail's transaction id (Stripe `pi_…`/`ch_…`, Square `payment_id`) is the shared
anchor, because it propagates downstream: a Shopify order and a QuickBooks payment both usually
carry the originating Stripe id. When two partners carry the same rail id, they collapse to the
same key automatically. `tx_id` in the ledger IS this canonical key.

**Fallback when no shared processor id** (cash sale seen by POS + accounting; manual invoice):
a surrogate key over `{issuer_id}|{amount_cents}|{currency}|{time-bucket}|{customer_hash?}`, matched
within a tolerance window before minting. Conservative thresholds; every ambiguous near-match is
logged as a protocol event for audit rather than silently merged.

### Mint-or-corroborate (better than first-come-and-discard)

On each `/v1/transactions`:

1. Compute `tx_canonical_key`.
2. **Atomically** attempt to mint via `recordTransaction` using the canonical key as `tx_id`
   (SQLite: PK conflict; production Postgres: `INSERT … ON CONFLICT DO NOTHING`).
   - **First source to land MINTS** — the one receipt, the one single-use review-right. This is
     Dusty's "first to get the token," made race-safe by the atomic insert.
   - **Every later source for the same key does NOT mint.** It appends a `corroborations` row and
     (optionally) its co-signature. Three partners seeing one sale → **one receipt corroborated
     three times = a STRONGER receipt, not three phantom ones.** Double-dipping becomes
     multi-source verification. Rendering can surface "verified by N independent sources."
3. **Delivery is keyed to the transaction, not the source.** The mint creates the claim link;
   whichever source first supplies a deliverable customer contact sends it, exactly once. So if the
   merchant mints without an email and Stripe later corroborates WITH the email, the review link
   still goes out — and still only once.

### Why this preserves every anti-fraud property

- **No score inflation:** one canonical key → one `transactions` row → one receipt → one
  review-right. Volume counts the sale once regardless of how many partners report it.
- **No double reviews:** the single-use review right per receipt (already enforced; reuse → 409)
  means one transaction yields at most one review.
- **Stronger, not weaker:** corroboration raises confidence and feeds reconciliation (I-2). If a
  merchant mints receipts a connected rail never corroborates, the gap is visible — the same
  mechanism that catches an issuer minting for shills.

### Edge cases to handle in the build

- **Offering resolution:** a raw payment knows an amount, not which offering. Connectors map
  processor product/price → offering, or fall back to a default offering per issuer.
- **Refund/dispute after mint:** a later `payment_intent.refunded`/dispute event posts a
  corroboration of type `reversed`; rendering can discount reversed transactions.
- **Priority is display-only:** first-come owns the review-right; source authority (rail >
  accounting > self-reported) only affects weighting/label, never who minted — so there is no
  contested re-mint.

---

## Build order

1. `partners` + `partner_issuer_links` + `corroborations` tables; the `/v1/transactions` endpoint
   with canonical-key mint-or-corroborate.
2. Refactor the Stripe webhook handler to be a producer of `/v1/transactions`.
3. Platform bulk-merchant provisioning + custodial key backend interface.
4. QuickBooks and Square connectors as additional producers (proves cross-source dedup end-to-end).
5. Extend the live-check acceptance script with a double-dip test: post the same canonical key from
   two partners, assert one receipt + one corroboration + one review-right + one delivery.
