'use strict';

// as/0.2a receipts: construction, shape validation, and the standing rules
// of the attestation ladder (spec §3, §4).
//
// Levels are independent attestation types — no level is a prerequisite for
// another — but standing per (holder, offering-version, role) is monotonic:
// it only ascends, and each ascension chains to the prior receipt (I-3).
// Payer-role standing caps at L1 (F1): payers attest value-for-money,
// nothing else.

const crypto = require('node:crypto');
const { signReceipt, coattestReceipt, verifyReceiptSignature } = require('./signing');

const RECEIPT_SPEC = 'as/0.2a';
const ROLES = Object.freeze(['participant', 'payer']);
const LEVELS = Object.freeze({ 1: 'TRANSACTED', 2: 'ENGAGED', 3: 'COMPLETED', 4: 'OUTCOME' });
const PAYER_MAX_LEVEL = 1;
const OFFERING_REF = /^[^@\s]+@[^@\s]+$/; // "<offering_id>@<version>"

/** UUIDv7: time-ordered ids, required for production receipts (spec §4). */
function uuidv7(nowMs = Date.now()) {
  const b = crypto.randomBytes(16);
  const ts = BigInt(nowMs);
  for (let i = 0; i < 6; i++) b[5 - i] = Number((ts >> BigInt(8 * i)) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Build and sign a receipt. The issuer signs the canonical bytes; optional
 * co-attesters sign the identical bytes (payment rail, LMS, marketplace).
 */
function buildReceipt({
  issuerPrivateKey,
  issuerPublicHex,
  holder,
  role,
  offering,
  level,
  event,
  issuedAt,
  prev = null,
  receiptId = uuidv7(),
  coattesterPrivateKeys = [],
}) {
  const receipt = {
    spec: RECEIPT_SPEC,
    receipt_id: receiptId,
    issuer: `ed25519:${issuerPublicHex}`,
    holder,
    role,
    offering,
    level,
    event,
    issued_at: issuedAt,
    prev,
  };
  const shapeError = receiptShapeError(receipt);
  if (shapeError) throw new Error(`refusing to sign a malformed receipt: ${shapeError}`);
  receipt.sig = signReceipt(receipt, issuerPrivateKey);
  receipt.coattest = coattesterPrivateKeys.map((key) => coattestReceipt(receipt, key));
  return receipt;
}

/** Structural validation. Returns null when well-formed, else a plain-English reason. */
function receiptShapeError(receipt) {
  if (!receipt || typeof receipt !== 'object') return 'not an object';
  if (receipt.spec !== RECEIPT_SPEC) return `spec must be "${RECEIPT_SPEC}"`;
  if (typeof receipt.receipt_id !== 'string' || !receipt.receipt_id) return 'receipt_id required';
  if (typeof receipt.issuer !== 'string' || !receipt.issuer.startsWith('ed25519:')) return 'issuer must be "ed25519:<hex>"';
  if (typeof receipt.holder !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.holder)) return 'holder must be a 32-byte hex binding';
  if (!ROLES.includes(receipt.role)) return `role must be one of: ${ROLES.join(', ')}`;
  if (typeof receipt.offering !== 'string' || !OFFERING_REF.test(receipt.offering)) return 'offering must be "<offering_id>@<version>"';
  if (!Number.isInteger(receipt.level) || !(receipt.level in LEVELS)) return 'level must be an integer 1-4';
  if (typeof receipt.event !== 'string' || !receipt.event) return 'event required';
  if (typeof receipt.issued_at !== 'string' || Number.isNaN(Date.parse(receipt.issued_at))) return 'issued_at must be RFC3339';
  if (receipt.prev !== null && typeof receipt.prev !== 'string') return 'prev must be a receipt_id or null';
  return null;
}

/** Full verification: well-formed and the issuer signature holds. */
function verifyReceipt(receipt) {
  return receiptShapeError(receipt) === null && verifyReceiptSignature(receipt);
}

/**
 * Standing rule for a new receipt against the holder's current chain state
 * (I-3 + F1). Returns null when legal, else a plain-English refusal.
 */
function ascensionError({ role, level, currentMaxLevel, prevReceipt }) {
  if (role === 'payer' && level > PAYER_MAX_LEVEL) {
    return 'payer standing caps at L1: payers attest value-for-money, nothing else (F1)';
  }
  if (currentMaxLevel !== null && level <= currentMaxLevel) {
    return `standing only ascends (I-3): holder already stands at L${currentMaxLevel}`;
  }
  if (currentMaxLevel !== null && !prevReceipt) {
    return 'ascensions must chain to the prior receipt (spec §3)';
  }
  return null;
}

module.exports = {
  RECEIPT_SPEC,
  ROLES,
  LEVELS,
  PAYER_MAX_LEVEL,
  uuidv7,
  buildReceipt,
  receiptShapeError,
  verifyReceipt,
  ascensionError,
};
