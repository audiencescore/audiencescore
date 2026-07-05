'use strict';

// Canonical transaction identity for cross-source de-duplication.
//
// The same real sale can be reported by several connected partners (the
// payment rail, the merchant, their accounting software). Each report must
// resolve to ONE key so the ledger mints one receipt and one review-right,
// and every later report becomes a corroboration — never a second receipt.
// See docs/pilot/MULTI-TENANT-AND-DEDUP-DESIGN.md.
//
// Resolution priority:
//   1. rail      — a payment-rail transaction id (Stripe pi_/ch_, Square
//                  payment id) is the shared fingerprint that propagates
//                  downstream; an exact, safe merge.
//   2. surrogate — no rail id but a customer identifier is present → a
//                  surrogate over issuer+amount+currency+hour+customer,
//                  strong enough to merge (same customer, same amount, same
//                  hour is the same sale, not a coincidence).
//   3. unique    — neither a rail id nor a customer identifier → do NOT
//                  merge. Two unrelated cash sales of the same amount must
//                  not collapse: wrongly merging suppresses a real review,
//                  which is worse than a rare duplicate. Mint standalone.
//
// Every key is scoped by issuer, so two merchants never collide.

const crypto = require('node:crypto');
const { uuidv7 } = require('../v02/receipts');

function sha256hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Stable 16-hex-char fingerprint of a customer contact (email/phone), or null. */
function customerHash(contact) {
  if (contact === null || contact === undefined) return null;
  const norm = String(contact).trim().toLowerCase();
  if (!norm) return null;
  return sha256hex(norm).slice(0, 16);
}

// UTC-hour bucket for surrogate keys — coarse on purpose: a customer's
// duplicate reports land in the same hour; distinct sales rarely share
// issuer+amount+customer+hour by accident.
function hourBucket(occurredAt) {
  const d = new Date(occurredAt);
  if (Number.isNaN(d.getTime())) throw new Error('occurred_at must be a valid RFC3339 timestamp');
  return d.toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
}

/**
 * Compute the canonical transaction key for a normalized ingest event.
 * Returns { key, basis } with basis ∈ {'rail','surrogate','unique'}.
 */
function canonicalTxnKey({ issuerId, rail, processorTxnId, amountCents, currency, occurredAt, customerContact }) {
  if (!issuerId) throw new Error('canonical key requires issuerId');
  const railName = String(rail || '').trim().toLowerCase();
  const railId = String(processorTxnId || '').trim();
  if (railName && railId) {
    return { key: `${issuerId}|rail:${railName}:${railId}`, basis: 'rail' };
  }
  const ch = customerHash(customerContact);
  if (ch) {
    const cur = String(currency || '').trim().toLowerCase();
    return {
      key: `${issuerId}|surr:${amountCents}:${cur}:${hourBucket(occurredAt)}:${ch}`,
      basis: 'surrogate',
    };
  }
  return { key: `${issuerId}|uniq:${uuidv7()}`, basis: 'unique' };
}

module.exports = { canonicalTxnKey, customerHash, sha256hex };
