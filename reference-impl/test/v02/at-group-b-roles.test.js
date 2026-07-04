'use strict';

// Group B — Roles, free offerings, versioning (AT-9 .. AT-13; findings F1, F2, F7).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderOffering } = require('../../src/v02/rendering');
const { makeIssuer, makeHolder, makeStore, enroll, T0, WINDOW } = require('./helpers');

test('AT-9: payer and participant receipts coexist; the payer cannot ascend past L1', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });

  const participant = enroll(store, issuer, { role: 'participant' });
  const payer = enroll(store, issuer, { role: 'payer' });
  assert.equal(participant.receipt.role, 'participant');
  assert.equal(payer.receipt.role, 'payer');
  assert.equal(participant.receipt.level, 1);
  assert.equal(payer.receipt.level, 1);

  // Participant ascends fine…
  const l2 = store.issueAttestation({
    issuer, holder: participant.holder.binding, role: 'participant',
    offering: 'algebra2@v3', level: 2, issuedAt: T0,
  });
  assert.equal(l2.receipt.level, 2);

  // …the payer does not.
  assert.throws(
    () => store.issueAttestation({
      issuer, holder: payer.holder.binding, role: 'payer',
      offering: 'algebra2@v3', level: 2, issuedAt: T0,
    }),
    /payer standing caps at L1/,
  );
});

test('AT-10: a payer-role review with facet scores is rejected; overall only', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  const payer = enroll(store, issuer, { role: 'payer' });

  assert.throws(
    () => store.submitReview({
      receiptId: payer.receipt.receipt_id, offering: 'algebra2@v3',
      overall: 4, facets: { ent_chen: 4 }, postedAt: T0,
    }),
    /payers rate value-for-money only/,
  );

  const ok = store.submitReview({
    receiptId: payer.receipt.receipt_id, offering: 'algebra2@v3', overall: 4, postedAt: T0,
  });
  assert.ok(ok.reviewId);
});

test('AT-11: a free offering issues no L1; an L2 receipt gates a review classed verified participant', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  const holder = makeHolder(issuer);

  // No L1 path exists for a free offering: no value moved.
  assert.throws(
    () => store.recordTransaction({
      issuer, holder: holder.binding, role: 'participant',
      offering: 'freecourse@v1', amountCents: 0, occurredAt: T0,
    }),
    /free offerings issue no L1/,
  );

  // Entry at L2, where standing costs verified time (F2).
  const { receipt } = store.issueAttestation({
    issuer, holder: holder.binding, role: 'participant',
    offering: 'freecourse@v1', level: 2, issuedAt: T0,
  });
  assert.equal(receipt.level, 2);
  assert.equal(receipt.prev, null);

  const review = store.submitReview({
    receiptId: receipt.receipt_id, offering: 'freecourse@v1', overall: 5, postedAt: T0,
  });
  assert.equal(review.reviewClass, 'verified_participant');
  const stored = store.db.prepare('SELECT review_class FROM reviews WHERE review_id = ?').get(review.reviewId);
  assert.equal(stored.review_class, 'verified_participant');

  // The rendering discloses the class and the absent purchase gate.
  const rendered = renderOffering(store.renderingInput('freecourse@v1', WINDOW));
  assert.equal(rendered.standing_class, 'verified_participant');
  assert.equal(rendered.purchase_gate, false);
});

test('AT-12: a receipt for offering@v1 cannot gate a review attached to offering@v2', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  store.declareOffering({
    offeringId: 'algebra2', version: 'v4', issuerPublicHex: issuer.publicHex,
    components: { instructor: 'ent_chen', curriculum: 'ent_alg2_v4' },
    priceCents: 27900, attestationCriteria: {}, declaredAt: T0,
  });

  const { receipt } = enroll(store, issuer, { offering: 'algebra2@v3' });
  assert.throws(
    () => store.submitReview({
      receiptId: receipt.receipt_id, offering: 'algebra2@v4', overall: 3, postedAt: T0,
    }),
    /reviews bind to the exact offering-version/,
  );
});

test('AT-13: an issuer refusal of an attestation request is an immutable logged event, visible in public issuance stats', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  const { holder } = enroll(store, issuer);

  store.requestAttestation({ holder: holder.binding, offering: 'algebra2@v3', level: 3, loggedAt: T0 });
  const { seq } = store.refuseAttestation({
    issuerPublicHex: issuer.publicHex, holder: holder.binding,
    offering: 'algebra2@v3', level: 3, reason: 'final project not submitted', loggedAt: T0,
  });

  // Immutable: the storage layer refuses mutation of the logged event.
  assert.throws(
    () => store.db.prepare("UPDATE protocol_events SET payload = '{}' WHERE seq = ?").run(seq),
    /append-only/,
  );
  assert.throws(
    () => store.db.prepare('DELETE FROM protocol_events WHERE seq = ?').run(seq),
    /append-only/,
  );

  // Retrievable in the issuer's public issuance stats (T-7).
  const stats = store.issuerIssuanceStats().find(
    (s) => s.issuer === `ed25519:${issuer.publicHex}` && s.offering === 'algebra2@v3',
  );
  assert.ok(stats, 'issuer stats row must exist');
  assert.equal(stats.refusals, 1);
});
