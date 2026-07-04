'use strict';

// The receipt signature scheme — and the ONE module that knows what it is.
//
// GATE-1 (spec §4): the TLAA Ed25519 receipt format was adopted, per the
// recommendation recorded in DRIFT.md. Keys are raw 32-byte Ed25519 public
// keys carried as "ed25519:<lowercase hex>"; signatures are lowercase hex
// over the canonical receipt bytes (conformance/CANONICAL.md); co-attestation
// entries are "ed25519:<hex sig>" made by co-attester keys over the same
// bytes. Everything outside this module treats signing as an opaque
// interface, so swapping receipt formats means replacing this file and
// nothing else.
//
// Key generation uses node:crypto's CSPRNG. The fixed-seed keys in
// conformance/ are test vectors only and must never appear here (AT-25
// scans for them).

const crypto = require('node:crypto');
const { canonicalReceiptBytes } = require('./canonical');

// DER wrappers for raw Ed25519 key material (RFC 8410 structures).
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const KEY_PREFIX = 'ed25519:';
const RAW_KEY_HEX = /^[0-9a-f]{64}$/;
const SIG_HEX = /^[0-9a-f]{128}$/;

/** Generate a fresh Ed25519 key pair (CSPRNG). */
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, publicHex: rawPublicHex(publicKey) };
}

/** The raw 32-byte public key of a node KeyObject, lowercase hex. */
function rawPublicHex(publicKey) {
  return publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
}

/** Import a raw hex public key (with or without the "ed25519:" prefix). */
function publicKeyFromHex(hex) {
  const raw = hex.startsWith(KEY_PREFIX) ? hex.slice(KEY_PREFIX.length) : hex;
  if (!RAW_KEY_HEX.test(raw)) throw new TypeError('expected a 32-byte lowercase-hex Ed25519 public key');
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(raw, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

/** Build a private KeyObject from a 32-byte seed (used for derived holder keys). */
function privateKeyFromSeed(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) {
    throw new TypeError('expected a 32-byte seed');
  }
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** Sign a receipt's canonical bytes. Returns the lowercase-hex signature. */
function signReceipt(receipt, privateKey) {
  return crypto.sign(null, canonicalReceiptBytes(receipt), privateKey).toString('hex');
}

/** Co-attest a receipt: a second signature over the identical canonical bytes. */
function coattestReceipt(receipt, privateKey) {
  return KEY_PREFIX + signReceipt(receipt, privateKey);
}

/**
 * Verify a receipt's issuer signature against the key the receipt itself
 * claims. Returns false (never throws) for malformed keys or signatures —
 * a hostile receipt must fail closed.
 */
function verifyReceiptSignature(receipt) {
  try {
    if (typeof receipt.issuer !== 'string' || !receipt.issuer.startsWith(KEY_PREFIX)) return false;
    if (typeof receipt.sig !== 'string' || !SIG_HEX.test(receipt.sig)) return false;
    return crypto.verify(
      null,
      canonicalReceiptBytes(receipt),
      publicKeyFromHex(receipt.issuer),
      Buffer.from(receipt.sig, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Verify one co-attestation entry against a co-attester's known public key.
 * Co-attester identity is registry knowledge (the receipt does not carry it).
 */
function verifyCoattestation(receipt, coattestEntry, coattesterPublicHex) {
  try {
    if (typeof coattestEntry !== 'string' || !coattestEntry.startsWith(KEY_PREFIX)) return false;
    const sig = coattestEntry.slice(KEY_PREFIX.length);
    if (!SIG_HEX.test(sig)) return false;
    return crypto.verify(
      null,
      canonicalReceiptBytes(receipt),
      publicKeyFromHex(coattesterPublicHex),
      Buffer.from(sig, 'hex'),
    );
  } catch {
    return false;
  }
}

module.exports = {
  KEY_PREFIX,
  generateKeyPair,
  rawPublicHex,
  publicKeyFromHex,
  privateKeyFromSeed,
  signReceipt,
  coattestReceipt,
  verifyReceiptSignature,
  verifyCoattestation,
};
