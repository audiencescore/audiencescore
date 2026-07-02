'use strict';

// Receipt verification and review-right minting. A review right is minted
// from a verified proof of transaction and is single-use: one attested
// transaction, one verdict. See /protocol/receipt-spec.md.
//
// This module implements PUBLIC admission checks only (receipt validity and
// single-use enforcement). Operator-side sealed admission detectors are
// intentionally not part of this repository — see GOVERNANCE.md.

const { sha256Hex, canonicalize, signPayload, verifyPayload } = require('./crypto');

// Proof tiers, strongest first. Weights are defined by the score spec
// (/score-spec/score-spec-v0.1.md) and repeated here for the demo.
const PROOF_TIERS = Object.freeze({
  agent_mandate: { weight: 1.0 },
  vendor_receipt: { weight: 1.0 },
  card_link: { weight: 0.9 },
  email_receipt: { weight: 0.6 },
});

/** A vendor-signed receipt (the "vendor_receipt" proof tier). */
function issueVendorReceipt({ vendorPrivateKey, vendorPublicString, vendorId, txId, amountCents, currency, issuedAt, locality }) {
  const body = {
    spec: 'audience-score/receipt@0.1',
    tier: 'vendor_receipt',
    vendor_id: vendorId,
    tx_id: txId,
    amount_cents: amountCents,
    currency,
    issued_at: issuedAt,
    locality,
  };
  const sig = signPayload(vendorPrivateKey, body);
  return { ...body, vendor_key: vendorPublicString, sig };
}

/** Verify a vendor receipt against the vendor's registered public key. */
function verifyVendorReceipt(receipt, expectedVendorKey) {
  if (receipt.tier !== 'vendor_receipt') return false;
  if (receipt.vendor_key !== expectedVendorKey) return false;
  const { sig, vendor_key, ...body } = receipt;
  return verifyPayload(vendor_key, body, sig);
}

/**
 * Registry of minted review rights. Enforces the core admission rule:
 * one verified transaction mints exactly one right, and a right can be
 * spent exactly once.
 */
class RightsRegistry {
  constructor() {
    this.minted = new Set();
    this.spent = new Set();
  }

  /** Derive the right id from the proof. Deterministic, so double-minting
   *  the same transaction is detectable by anyone holding the receipt. */
  static rightId(receipt) {
    return sha256Hex(canonicalize({ tier: receipt.tier, vendor_id: receipt.vendor_id, tx_id: receipt.tx_id }));
  }

  mint(receipt, expectedVendorKey) {
    if (!verifyVendorReceipt(receipt, expectedVendorKey)) {
      throw new Error('receipt verification failed: no receipt, no verdict');
    }
    const id = RightsRegistry.rightId(receipt);
    if (this.minted.has(id)) {
      throw new Error('review right already minted for this transaction (single-use rule)');
    }
    this.minted.add(id);
    return { right_id: id, tier: receipt.tier, proof_hash: sha256Hex(canonicalize(receipt)) };
  }

  spend(rightId) {
    if (!this.minted.has(rightId)) {
      throw new Error('unknown review right: no receipt, no verdict');
    }
    if (this.spent.has(rightId)) {
      throw new Error('review right already spent (single-use rule)');
    }
    this.spent.add(rightId);
  }
}

module.exports = { PROOF_TIERS, issueVendorReceipt, verifyVendorReceipt, RightsRegistry };
