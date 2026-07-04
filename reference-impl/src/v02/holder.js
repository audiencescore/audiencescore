'use strict';

// Holder pseudonymity (spec §7): per-issuer derived keys plus a BLAKE3
// binding. A holder has one root secret; for each issuer a distinct key pair
// is derived from (root secret, issuer public key), so two issuers comparing
// notes see two unrelated holder bindings — no cross-provider enrollment
// graph is constructible (F8, AT-24).
//
// Binding (normative, conformance/CANONICAL.md):
//   holder = blake3(derived_holder_pubkey || salt), lowercase hex.
//
// BLAKE3 is not in node:crypto; @noble/hashes is the repository's single
// audited, exact-pinned dependency (see DRIFT.md D-3).

const crypto = require('node:crypto');
const { blake3 } = require('@noble/hashes/blake3.js');
const { privateKeyFromSeed, rawPublicHex } = require('./signing');

/** A holder's root secret. CSPRNG; never leaves the holder's agent. */
function generateHolderRoot() {
  return crypto.randomBytes(32);
}

/** A per-issuer binding salt. CSPRNG. The fixed salt in conformance/ is test-only. */
function generateSalt() {
  return crypto.randomBytes(32);
}

/**
 * Derive the holder's key pair for one issuer:
 * seed = blake3(root_secret || issuer_public_key_bytes).
 * Same root + same issuer is stable; different issuers are unlinkable.
 */
function deriveHolderKeyPair(rootSecret, issuerPublicHex) {
  if (!(rootSecret instanceof Uint8Array) || rootSecret.length !== 32) {
    throw new TypeError('holder root secret must be 32 bytes');
  }
  const issuerBytes = Buffer.from(
    issuerPublicHex.startsWith('ed25519:') ? issuerPublicHex.slice(8) : issuerPublicHex,
    'hex',
  );
  const seed = blake3(Buffer.concat([Buffer.from(rootSecret), issuerBytes]));
  const privateKey = privateKeyFromSeed(seed);
  const publicHex = rawPublicHex(crypto.createPublicKey(privateKey));
  return { privateKey, publicHex };
}

/** The pseudonymous holder binding: blake3(pubkey bytes || salt), hex. */
function holderBinding(holderPublicHex, salt) {
  const pub = Buffer.from(holderPublicHex, 'hex');
  return Buffer.from(blake3(Buffer.concat([pub, Buffer.from(salt)]))).toString('hex');
}

module.exports = { generateHolderRoot, generateSalt, deriveHolderKeyPair, holderBinding };
