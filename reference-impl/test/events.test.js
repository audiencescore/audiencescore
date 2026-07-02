'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPair, publicKeyToString } = require('../src/crypto');
const { createEvent, EventLog, GENESIS } = require('../src/events');
const { issueVendorReceipt, RightsRegistry } = require('../src/receipts');

function makeVerdict(log, verdict = 'up') {
  const reviewer = generateKeyPair();
  return createEvent({
    type: 'verdict',
    prev: log.head(),
    privateKey: reviewer.privateKey,
    signerString: publicKeyToString(reviewer.publicKey),
    body: {
      verdict,
      dimensions: {},
      narrative: null,
      vendor: { id: 'v1', locality: { country: 'US', state: 'CO' } },
      service_locality: { state: 'CO' },
      receipt: { tier: 'vendor_receipt', right_id: 'r1', proof_hash: 'p1' },
      issued_at: '2026-07-01T00:00:00.000Z',
    },
  });
}

test('empty log head is genesis', () => {
  assert.equal(new EventLog().head(), GENESIS);
});

test('append and verify a chained log', () => {
  const log = new EventLog();
  for (let i = 0; i < 5; i++) log.append(makeVerdict(log));
  assert.equal(log.events.length, 5);
  assert.equal(log.verifyChain(), true);
});

test('tampering with any event breaks chain verification', () => {
  const log = new EventLog();
  for (let i = 0; i < 5; i++) log.append(makeVerdict(log));
  const copy = EventLog.fromJSONL(log.toJSONL());
  copy.events[2].body.verdict = 'down';
  assert.equal(copy.verifyChain(), false);
});

test('an event that does not chain is rejected', () => {
  const log = new EventLog();
  log.append(makeVerdict(log));
  const orphan = makeVerdict(new EventLog()); // prev = genesis, wrong for a non-empty log
  assert.throws(() => log.append(orphan), /does not chain/);
});

test('JSONL roundtrip preserves the chain', () => {
  const log = new EventLog();
  for (let i = 0; i < 3; i++) log.append(makeVerdict(log));
  const restored = EventLog.fromJSONL(log.toJSONL());
  assert.equal(restored.verifyChain(), true);
  assert.deepEqual(restored.events, log.events);
});

test('review rights are single-use and require a valid receipt', () => {
  const vendor = generateKeyPair();
  const vendorKey = publicKeyToString(vendor.publicKey);
  const receipt = issueVendorReceipt({
    vendorPrivateKey: vendor.privateKey,
    vendorPublicString: vendorKey,
    vendorId: 'v1',
    txId: 'tx-1',
    amountCents: 1000,
    currency: 'USD',
    issuedAt: '2026-07-01T00:00:00.000Z',
    locality: { country: 'US', state: 'CO' },
  });

  const registry = new RightsRegistry();
  const right = registry.mint(receipt, vendorKey);
  assert.throws(() => registry.mint(receipt, vendorKey), /already minted/);
  registry.spend(right.right_id);
  assert.throws(() => registry.spend(right.right_id), /already spent/);
  assert.throws(() => registry.spend('nonexistent'), /no receipt, no verdict/);

  const forged = { ...receipt, amount_cents: 999_999 };
  assert.throws(() => new RightsRegistry().mint(forged, vendorKey), /verification failed/);
});
