'use strict';

// Regression test for the v0.2a independent-audit MAJOR finding:
// "A stranger can quietly pollute someone else's public score."
//
// The auditor, using a freshly generated key, recorded a fake one-cent sale
// against someone else's offering, obtained a validly-signed L1 receipt, and
// posted a 1-star review that blended into that offering's score (5.0 -> 4.69)
// with no alarm. Root cause: receipts were checked for a valid signature but
// never for being signed by the offering's DECLARED issuer.
//
// The fix binds receipts to the declared issuer at three layers: issuance
// (recordTransaction / issueAttestation), review admission (submitReview), and
// a health-check detector for anything that reached storage another way. This
// test reproduces the attack and asserts every layer now refuses it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { healthCheck } = require('../../src/v02/invariants');
const { renderOffering } = require('../../src/v02/rendering');
const { makeIssuer, makeHolder, makeStore, enroll, T0, WINDOW } = require('./helpers');

test('the attack is blocked at issuance: a stranger cannot record a transaction against another issuer\'s offering', () => {
  const provider = makeIssuer();      // declared issuer of algebra2@v3
  const attacker = makeIssuer();      // a stranger with their own fresh key
  const store = makeStore({ issuer: provider });
  const victimHolder = makeHolder(attacker);

  assert.throws(
    () => store.recordTransaction({
      issuer: attacker, holder: victimHolder.binding, role: 'participant',
      offering: 'algebra2@v3', amountCents: 1, occurredAt: T0,
    }),
    /issuer binding/,
    'a stranger recording a fake sale against someone else\'s offering must be refused',
  );

  // And the ledger stays clean: no transaction, no receipt.
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, 0);
});

test('the attack is blocked at issuance for attestations too', () => {
  const provider = makeIssuer();
  const attacker = makeIssuer();
  const store = makeStore({ issuer: provider });
  const holder = makeHolder(attacker);

  assert.throws(
    () => store.issueAttestation({
      issuer: attacker, holder: holder.binding, role: 'participant',
      offering: 'freecourse@v1', level: 2, issuedAt: T0,
    }),
    /issuer binding/,
  );
});

test('the attack is blocked at review admission: a wrong-issuer receipt cannot gate a review even if it reached storage', () => {
  const provider = makeIssuer();
  const attacker = makeIssuer();
  const store = makeStore({ issuer: provider });

  // Simulate a wrong-issuer receipt that bypassed the issuance guard by
  // building it directly with the attacker's key and inserting it raw. It is
  // validly SIGNED (by the attacker), so the old signature-only check passed.
  const { buildReceipt } = require('../../src/v02/receipts');
  const holder = makeHolder(attacker);
  const forged = buildReceipt({
    issuerPrivateKey: attacker.privateKey, issuerPublicHex: attacker.publicHex,
    holder: holder.binding, role: 'participant', offering: 'algebra2@v3',
    level: 1, event: 'enrolled', issuedAt: T0, prev: null, receiptId: 'forged-1',
  });
  const { verifyReceipt } = require('../../src/v02/receipts');
  assert.equal(verifyReceipt(forged), true, 'the forged receipt is validly signed by the attacker');
  store.db.prepare(
    `INSERT INTO receipts (receipt_id, spec, issuer, holder, role, offering, level, event, issued_at, prev, coattest, sig)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
  ).run(forged.receipt_id, forged.spec, forged.issuer, forged.holder, forged.role, forged.offering,
    forged.level, forged.event, forged.issued_at, forged.prev, forged.sig);

  assert.throws(
    () => store.submitReview({ receiptId: 'forged-1', offering: 'algebra2@v3', overall: 1, postedAt: T0 }),
    /not the declared issuer/,
    'a receipt not signed by the declared issuer must not gate a review',
  );
});

test('the health check alarms on a wrong-issuer receipt sitting in storage (the "no alarm noticed" gap)', () => {
  const provider = makeIssuer();
  const attacker = makeIssuer();
  const store = makeStore({ issuer: provider });

  const { buildReceipt } = require('../../src/v02/receipts');
  const holder = makeHolder(attacker);
  const forged = buildReceipt({
    issuerPrivateKey: attacker.privateKey, issuerPublicHex: attacker.publicHex,
    holder: holder.binding, role: 'participant', offering: 'algebra2@v3',
    level: 1, event: 'enrolled', issuedAt: T0, prev: null, receiptId: 'forged-2',
  });
  store.db.prepare(
    `INSERT INTO receipts (receipt_id, spec, issuer, holder, role, offering, level, event, issued_at, prev, coattest, sig)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
  ).run(forged.receipt_id, forged.spec, forged.issuer, forged.holder, forged.role, forged.offering,
    forged.level, forged.event, forged.issued_at, forged.prev, forged.sig);

  const alarms = healthCheck(store).filter((v) => v.invariant === 'issuer-binding');
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].detail.receipt_id, 'forged-2');
  assert.equal(alarms[0].detail.receipt_issuer, `ed25519:${attacker.publicHex}`);
  assert.equal(alarms[0].detail.declared_issuer, `ed25519:${provider.publicHex}`);
});

test('the legitimate provider is unaffected: a real score forms and stays clean', () => {
  const provider = makeIssuer();
  const store = makeStore({ issuer: provider });
  for (let i = 0; i < 10; i++) {
    const { receipt } = enroll(store, provider);
    store.submitReview({ receiptId: receipt.receipt_id, offering: 'algebra2@v3', overall: 5, postedAt: T0 });
  }
  const rendered = renderOffering(store.renderingInput('algebra2@v3', WINDOW));
  assert.equal(rendered.published, true);
  assert.equal(rendered.views.all_verified.score, 5);
  assert.deepEqual(healthCheck(store), []);
});
