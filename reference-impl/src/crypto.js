'use strict';

// Cryptographic primitives for the Audience Score reference implementation.
// Ed25519 signatures over canonical JSON, SHA-256 hashing. No dependencies
// beyond node:crypto.

const crypto = require('node:crypto');

/** Generate an Ed25519 key pair. */
function generateKeyPair() {
  return crypto.generateKeyPairSync('ed25519');
}

/** Export a public key as base64url-encoded SPKI DER. */
function publicKeyToString(publicKey) {
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
}

/** Import a public key from base64url-encoded SPKI DER. */
function publicKeyFromString(encoded) {
  return crypto.createPublicKey({
    key: Buffer.from(encoded, 'base64url'),
    type: 'spki',
    format: 'der',
  });
}

/**
 * Canonical JSON: object keys sorted lexicographically at every level,
 * no whitespace. Two structurally equal objects always serialize to the
 * same bytes, so hashes and signatures are reproducible by any mirror.
 */
function canonicalize(value) {
  // Non-finite numbers have no JSON representation; JSON.stringify silently
  // turns them into `null`, which would collide with a real null. Reject them
  // so a signed payload can never mean two different things.
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('canonicalize: non-finite numbers are not representable');
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    // JSON semantics: undefined array slots serialize as null.
    return '[' + value.map((v) => canonicalize(v === undefined ? null : v)).join(',') + ']';
  }
  // JSON semantics: object properties whose value is undefined are omitted.
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  const entries = keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k]));
  return '{' + entries.join(',') + '}';
}

/** SHA-256 of a string, hex encoded. */
function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Sign the canonical form of a payload. Returns base64url signature. */
function signPayload(privateKey, payload) {
  const data = Buffer.from(canonicalize(payload), 'utf8');
  return crypto.sign(null, data, privateKey).toString('base64url');
}

/** Verify a base64url signature over the canonical form of a payload. */
function verifyPayload(publicKeyString, payload, signature) {
  const data = Buffer.from(canonicalize(payload), 'utf8');
  try {
    return crypto.verify(
      null,
      data,
      publicKeyFromString(publicKeyString),
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

module.exports = {
  generateKeyPair,
  publicKeyToString,
  publicKeyFromString,
  canonicalize,
  sha256Hex,
  signPayload,
  verifyPayload,
};
