'use strict';

// Guards the education adapter DEMONSTRATOR (reference-impl/examples/education)
// so it can't silently rot. Asserts the native-event -> attestation-ladder
// mapping and that everything it issues is a valid, verifiable receipt on the
// real v0.2 store. Not a conformance test — the demonstrator is illustrative.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPair } = require('../src/v02/signing');
const { generateSalt } = require('../src/v02/holder');
const { Store } = require('../src/v02/store');
const { renderOffering } = require('../src/v02/rendering');
const { healthCheck } = require('../src/v02/invariants');
const { EducationIssuerAdapter, EVENT, verifyReceipt } = require('../examples/education/adapter');

const T0 = '2026-07-04T12:00:00Z';
const WINDOW = '2026-07-05T00:00:00Z';
const PAID = { id: 'algebra2', version: 'v3' };
const FREE = { id: 'freecourse', version: 'v1' };

function makeAdapter() {
  const issuer = { ...generateKeyPair(), salt: generateSalt() };
  const store = new Store();
  const adapter = new EducationIssuerAdapter({
    store, issuer, l2ProgressThreshold: 60,
    offerings: [
      { offeringId: PAID.id, version: PAID.version, priceCents: 24900, declaredAt: T0,
        components: { instructor: 'ent_chen', curriculum: 'ent_alg2', platform: 'ent_lms' },
        attestationCriteria: { l2: 'progress >= 60%', l3: 'final project accepted' } },
      { offeringId: FREE.id, version: FREE.version, priceCents: 0, declaredAt: T0,
        components: { curriculum: 'ent_freecurr' }, attestationCriteria: { l2: 'completed 5 modules' } },
    ],
  }).registerOfferings();
  return { issuer, store, adapter };
}

test('payment.succeeded -> L1 payer; enrollment (paid) -> L1 participant', () => {
  const { adapter } = makeAdapter();
  const pay = adapter.handle({ type: EVENT.PAYMENT, subject: 'parent-A', offering: PAID, amount_cents: 24900, occurred_at: T0 });
  assert.equal(pay.status, 'issued');
  assert.equal(pay.level, 1);
  assert.equal(pay.role, 'payer');
  assert.ok(verifyReceipt(pay.receipt));

  const enr = adapter.handle({ type: EVENT.ENROLLMENT, subject: 'student-1', offering: PAID, occurred_at: T0 });
  assert.equal(enr.status, 'issued');
  assert.equal(enr.level, 1);
  assert.equal(enr.role, 'participant');
  assert.ok(verifyReceipt(enr.receipt));
});

test('lms.progress crosses the L2 threshold; below it is a no-op', () => {
  const { adapter } = makeAdapter();
  adapter.handle({ type: EVENT.ENROLLMENT, subject: 's', offering: PAID, occurred_at: T0 });

  const low = adapter.handle({ type: EVENT.PROGRESS, subject: 's', offering: PAID, progress_pct: 20, occurred_at: T0 });
  assert.equal(low.status, 'noop');

  const hi = adapter.handle({ type: EVENT.PROGRESS, subject: 's', offering: PAID, progress_pct: 72, occurred_at: T0 });
  assert.equal(hi.status, 'issued');
  assert.equal(hi.level, 2);
  assert.equal(hi.role, 'participant');
});

test('lms.completed -> L3; a replayed lower ascension is a no-op, not a crash', () => {
  const { adapter } = makeAdapter();
  adapter.handle({ type: EVENT.ENROLLMENT, subject: 's', offering: PAID, occurred_at: T0 });
  adapter.handle({ type: EVENT.PROGRESS, subject: 's', offering: PAID, progress_pct: 80, occurred_at: T0 });

  const done = adapter.handle({ type: EVENT.COMPLETION, subject: 's', offering: PAID, occurred_at: T0 });
  assert.equal(done.status, 'issued');
  assert.equal(done.level, 3);

  // Out-of-order progress after completion: standing only ascends -> no-op.
  const stale = adapter.handle({ type: EVENT.PROGRESS, subject: 's', offering: PAID, progress_pct: 65, occurred_at: T0 });
  assert.equal(stale.status, 'noop');
});

test('free offering issues no L1 at enrollment (participant enters at L2)', () => {
  const { adapter } = makeAdapter();
  const enr = adapter.handle({ type: EVENT.ENROLLMENT, subject: 'freebie', offering: FREE, occurred_at: T0 });
  assert.equal(enr.status, 'noop');

  const l2 = adapter.handle({ type: EVENT.PROGRESS, subject: 'freebie', offering: FREE, progress_pct: 90, occurred_at: T0 });
  assert.equal(l2.status, 'issued');
  assert.equal(l2.level, 2);
});

test('an unknown offering is refused, not crashed', () => {
  const { adapter } = makeAdapter();
  const out = adapter.handle({ type: EVENT.ENROLLMENT, subject: 'x', offering: { id: 'nope', version: 'v1' }, occurred_at: T0 });
  assert.equal(out.status, 'refused');
  assert.match(out.reason, /unknown offering/);
});

test('end to end: issued receipts gate reviews and render a clean, valid ledger', () => {
  const { store, adapter } = makeAdapter();
  // 12 enroll, 10 reach L2, 7 complete — enough distinct standings to publish.
  for (let i = 1; i <= 12; i++) {
    const subject = `learner-${i}`;
    adapter.handle({ type: EVENT.ENROLLMENT, subject, offering: PAID, occurred_at: T0 });
    if (i <= 10) adapter.handle({ type: EVENT.PROGRESS, subject, offering: PAID, progress_pct: 72, occurred_at: T0 });
    if (i <= 7) adapter.handle({ type: EVENT.COMPLETION, subject, offering: PAID, occurred_at: T0 });
  }
  // One review per participant standing, gated by the issued receipt.
  const ref = `${PAID.id}@${PAID.version}`;
  const holders = store.db.prepare("SELECT MIN(receipt_id) AS receipt_id FROM receipts WHERE role='participant' GROUP BY holder").all();
  let posted = 0;
  for (const { receipt_id } of holders) {
    store.submitReview({ receiptId: receipt_id, offering: ref, overall: 5, facets: { ent_chen: 5 }, postedAt: T0 });
    posted++;
  }
  assert.ok(posted >= 10, 'enough standings to cross the k-anonymity floor');

  const rendered = renderOffering(store.renderingInput(ref, WINDOW));
  assert.equal(rendered.published, true);
  assert.equal(rendered.standing_class, 'verified_purchaser');
  assert.ok(rendered.views.all_verified.score > 0);

  assert.deepEqual(healthCheck(store), [], 'the ledger the adapter produced must satisfy every invariant');
});
