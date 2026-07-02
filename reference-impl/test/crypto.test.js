'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateKeyPair,
  publicKeyToString,
  canonicalize,
  signPayload,
  verifyPayload,
} = require('../src/crypto');

test('sign/verify roundtrip', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const payload = { b: 2, a: 1, nested: { z: [1, 2, 3], y: null } };
  const sig = signPayload(privateKey, payload);
  assert.equal(verifyPayload(publicKeyToString(publicKey), payload, sig), true);
});

test('verification fails for a modified payload', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const sig = signPayload(privateKey, { verdict: 'up' });
  assert.equal(verifyPayload(publicKeyToString(publicKey), { verdict: 'down' }, sig), false);
});

test('verification fails for the wrong key', () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const sig = signPayload(alice.privateKey, { verdict: 'up' });
  assert.equal(verifyPayload(publicKeyToString(bob.publicKey), { verdict: 'up' }, sig), false);
});

test('canonicalize is key-order independent', () => {
  assert.equal(
    canonicalize({ a: 1, b: { d: 4, c: 3 } }),
    canonicalize({ b: { c: 3, d: 4 }, a: 1 }),
  );
});

test('canonicalize handles malformed signature input gracefully', () => {
  const { publicKey } = generateKeyPair();
  assert.equal(verifyPayload(publicKeyToString(publicKey), { a: 1 }, 'not-a-signature'), false);
  assert.equal(verifyPayload('not-a-key', { a: 1 }, 'not-a-signature'), false);
});
