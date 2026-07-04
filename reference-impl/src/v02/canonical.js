'use strict';

// Canonical serialization for as/0.2a receipts. Normative document:
// conformance/CANONICAL.md — the signed bytes are the receipt WITHOUT the
// `sig` and `coattest` fields, keys sorted lexicographically, "," ":"
// separators, UTF-8, no floating-point values.
//
// The JSON encoding itself is shared with the v0.1 canonicalizer, which
// already produces sorted-key, no-whitespace, minimally-escaped JSON — the
// same bytes Python's json.dumps(sort_keys=True, separators=(",", ":"),
// ensure_ascii=False) produces for these payloads. CI proves that byte
// equivalence against the Python reference via conformance/canonical_bytes.json.

const { canonicalize } = require('../crypto');

const EXCLUDED = new Set(['sig', 'coattest']);

/** The canonical receipt payload: every field except sig and coattest. */
function canonicalReceiptPayload(receipt) {
  const payload = {};
  for (const key of Object.keys(receipt)) {
    if (EXCLUDED.has(key)) continue;
    const value = receipt[key];
    if (typeof value === 'number' && !Number.isInteger(value)) {
      throw new TypeError(`canonical receipt: field "${key}" must be an integer (no floats are signable)`);
    }
    payload[key] = value;
  }
  return payload;
}

/** Canonical form as a string (sorted keys, no whitespace, minimal escaping). */
function canonicalReceiptString(receipt) {
  return canonicalize(canonicalReceiptPayload(receipt));
}

/** Canonical form as the exact UTF-8 bytes that are signed. */
function canonicalReceiptBytes(receipt) {
  return Buffer.from(canonicalReceiptString(receipt), 'utf8');
}

module.exports = { canonicalReceiptPayload, canonicalReceiptString, canonicalReceiptBytes };
