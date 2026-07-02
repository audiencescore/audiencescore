# Receipt & Review-Right Specification v0.1

Status: **draft**. Spec identifier: `audience-score/receipt@0.1`.

The admission rule of the whole protocol is one sentence: **no receipt, no
verdict.** A verdict can only be written by spending a *review right*, and a
review right is only minted from a verified proof of transaction, exactly
once per transaction.

This one rule removes the free fake-review attack outright: an instruction
to "write fifty bad reviews of the bakery across the street" produces
nothing, because there are no fifty transactions to attach them to. Every
remaining attack must spend real money on real transactions, which changes
the economics of fraud from free to expensive.

## 1. Proof tiers

Accepted proofs of transaction, strongest first. Tier weights (used by the
score function) are normative in [/score-spec](../score-spec/score-spec-v0.1.md).

| Tier | Proof | Weight (v0.1) |
|---|---|---|
| `agent_mandate` | Signed agentic-commerce payment records (AP2/ACP/UCP-style mandates, card-network agent receipts) | 1.0 |
| `vendor_receipt` | A receipt signed by a participating vendor's registered key (for example, TLAA-style signed receipts) | 1.0 |
| `card_link` | A card-linked or bank-feed transaction match | 0.9 |
| `email_receipt` | A parsed email receipt | 0.6 — accepted, weighted lower, and flagged as such |

## 2. Vendor receipt format (`vendor_receipt` tier, this spec)

```json
{
  "spec": "audience-score/receipt@0.1",
  "tier": "vendor_receipt",
  "vendor_id": "<vendor id>",
  "tx_id": "<vendor-unique transaction id>",
  "amount_cents": 2500,
  "currency": "USD",
  "issued_at": "<ISO 8601 UTC timestamp>",
  "locality": { "country": "US", "state": "CO" },
  "vendor_key": "<base64url SPKI Ed25519 public key>",
  "sig": "<base64url Ed25519 signature over the canonical body>"
}
```

The signature covers every field except `vendor_key` and `sig` themselves,
and must verify against the vendor's registered public key. Adapters for
the other three tiers normalize their proofs into an equivalent verified
statement: *this buyer completed this transaction with this vendor at this
time in this locality*.

## 3. Review rights

- **Minting.** A verified proof mints exactly one review right. The right id
  is deterministic — `sha256(canonical {tier, vendor_id, tx_id})` — so a
  second minting attempt for the same transaction is detectable by anyone.
- **Single use.** Spending a right consumes it. One attested transaction,
  one verdict, ever.
- **Expiry (reserved).** v0.1 sets no expiration window. A future revision
  may bound how long after the transaction a right remains spendable; this
  will go through the RFC process.

## 4. Public admission checks

The following checks are public and deterministic; they are the only
admission logic in the reference implementation:

1. proof verifies under its tier's rules;
2. right not previously minted (uniqueness of `right_id`);
3. right not previously spent;
4. verdict event is well-formed under [event-spec.md](event-spec.md) and
   chains correctly.

Operator-side sealed admission detectors — the anti-fraud layer for attacks
that survive the receipt gate, such as wash trading — exist *outside* this
repository and are governed by the commitment/reveal/audit machinery in
[GOVERNANCE.md](../GOVERNANCE.md). They can flag or quarantine a submission
with a public signed event; they can never alter score math or edit the log.
