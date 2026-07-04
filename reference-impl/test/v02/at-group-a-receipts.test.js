'use strict';

// Group A — Receipt cryptography and structure (AT-1 .. AT-8).
// The conformance vectors in conformance/vectors.json are the byte-level
// truth; the implementation must accept every valid one and reject every
// invalid one.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalReceiptString } = require('../../src/v02/canonical');
const { verifyReceiptSignature, verifyCoattestation } = require('../../src/v02/signing');
const { verifyReceipt, ascensionError } = require('../../src/v02/receipts');
const { loadVectors, loadCanonicalFixture, makeIssuer, makeStore, enroll, T0 } = require('./helpers');

const V = loadVectors();
const byId = new Map(V.receipts.map((item) => [item.receipt.receipt_id, item.receipt]));

test('AT-1: every sig_valid vector receipt is accepted', () => {
  for (const item of V.receipts.filter((i) => i.expect === 'sig_valid')) {
    assert.equal(verifyReceipt(item.receipt), true, `${item.name} must verify`);
  }
});

test('AT-2: the payload tampered after signing is rejected', () => {
  const item = V.receipts.find((i) => i.name === 'tampered_level_after_signing');
  assert.equal(verifyReceiptSignature(item.receipt), false);
  assert.equal(verifyReceipt(item.receipt), false);
});

test('AT-3: a signature by a non-issuer key claiming the issuer is rejected', () => {
  const item = V.receipts.find((i) => i.name === 'wrong_key_claims_issuer');
  assert.equal(verifyReceiptSignature(item.receipt), false);
});

test('AT-4: canonical bytes are byte-identical to the reference for every vector', () => {
  const fixture = loadCanonicalFixture();
  for (const item of V.receipts) {
    const ours = canonicalReceiptString(item.receipt);
    assert.equal(ours, fixture[item.receipt.receipt_id], `${item.name}: a single differing byte fails this test`);
  }
});

test('AT-5: co-attestation verifies independently and corrupting either signature is detected', () => {
  const item = V.receipts.find((i) => i.name === 'valid_l1_participant_coattested');
  const receipt = item.receipt;
  assert.equal(verifyReceiptSignature(receipt), true);
  assert.equal(verifyCoattestation(receipt, receipt.coattest[0], V.keys.platform), true);

  const brokenIssuerSig = { ...receipt, sig: flipHexChar(receipt.sig) };
  assert.equal(verifyReceiptSignature(brokenIssuerSig), false);

  const brokenCoattest = 'ed25519:' + flipHexChar(receipt.coattest[0].slice('ed25519:'.length));
  assert.equal(verifyCoattestation(receipt, brokenCoattest, V.keys.platform), false);
});

test('AT-6: the chained ascension vectors validate as legal ascensions', () => {
  for (const name of ['chain_l1_to_l2', 'chain_l2_to_l3']) {
    const receipt = V.receipts.find((i) => i.name === name).receipt;
    const prev = byId.get(receipt.prev);
    assert.ok(prev, `${name} must chain to an existing receipt`);
    assert.equal(prev.holder, receipt.holder);
    assert.equal(prev.offering, receipt.offering);
    assert.equal(prev.role, receipt.role);
    const refusal = ascensionError({
      role: receipt.role,
      level: receipt.level,
      currentMaxLevel: prev.level,
      prevReceipt: prev,
    });
    assert.equal(refusal, null, `${name} must be a legal ascension`);
  }
});

test('AT-7: the descending chain vector is refused as an I-3 violation', () => {
  const receipt = V.receipts.find((i) => i.name === 'descending_chain_l3_to_l2').receipt;
  const prev = byId.get(receipt.prev);
  const refusal = ascensionError({
    role: receipt.role,
    level: receipt.level,
    currentMaxLevel: prev.level,
    prevReceipt: prev,
  });
  assert.match(refusal, /I-3/);
});

test('AT-8: an L1 receipt exists after every transaction, with no code path consulted for permission', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });

  // Positive: N transactions -> N receipts, no exceptions.
  for (let i = 0; i < 7; i++) enroll(store, issuer);
  const receipts = store.db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE level = 1").get().n;
  const txs = store.db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
  assert.equal(receipts, 7);
  assert.equal(txs, 7);

  // Negative 1: an issuer passing a would-be escape hatch still gets a receipt —
  // no such option exists, and unknown options change nothing.
  const { makeHolder } = require('./helpers');
  const h = makeHolder(issuer);
  store.recordTransaction({
    issuer, holder: h.binding, role: 'participant', offering: 'algebra2@v3',
    amountCents: 24900, occurredAt: T0,
    skipReceipt: true, suppressReceipt: true, issueReceipt: false, // ignored: no discretionary path
  });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM receipts WHERE level = 1').get().n, 8);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 8);

  // Negative 2: the only INSERT into transactions in the entire implementation
  // lives inside recordTransaction, so there is no function through which a
  // transaction can be recorded without the atomic receipt insert.
  const srcDir = path.join(__dirname, '..', '..', 'src');
  const hits = [];
  for (const file of walk(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    if (/INSERT INTO transactions/i.test(text)) hits.push(path.basename(file));
  }
  assert.deepEqual(hits, ['store.js']);
  const storeSrc = fs.readFileSync(path.join(srcDir, 'v02', 'store.js'), 'utf8');
  const insideRecordTransaction = storeSrc.split('recordTransaction(')[1].split('issueAttestation(')[0];
  assert.match(insideRecordTransaction, /INSERT INTO transactions/);
  assert.equal(storeSrc.match(/INSERT INTO transactions/g).length, 1);
});

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function flipHexChar(hex) {
  const c = hex[0] === '0' ? '1' : '0';
  return c + hex.slice(1);
}
