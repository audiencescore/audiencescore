'use strict';

// Group D — Invariant alarms (AT-18 .. AT-24). Each test SEEDS the bad state
// deliberately — usually with raw SQL through the application's own database
// connection, exactly the access an attacker-with-the-app would have — and
// passes only if the system detects or refuses it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { healthCheck } = require('../../src/v02/invariants');
const { renderOffering, renderEntity, PARAMS } = require('../../src/v02/rendering');
const { Store } = require('../../src/v02/store');
const { makeIssuer, makeHolder, bindHolder, makeStore, enroll, T0, WINDOW } = require('./helpers');
const { generateHolderRoot } = require('../../src/v02/holder');

function seedReviews(store, issuer, { count, overall, toLevel = 1, offering = 'algebra2@v3' }) {
  for (let i = 0; i < count; i++) {
    let { holder, receipt } = enroll(store, issuer, { offering });
    for (let level = 2; level <= toLevel; level++) {
      receipt = store.issueAttestation({
        issuer, holder: holder.binding, role: 'participant', offering, level, issuedAt: T0,
      }).receipt;
    }
    store.submitReview({ receiptId: receipt.receipt_id, offering, overall, postedAt: T0 });
  }
}

test('a healthy store raises no alarms', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  seedReviews(store, issuer, { count: 10, overall: 4, toLevel: 3 });
  assert.deepEqual(healthCheck(store), []);
});

test('AT-18 (I-1): a seeded orphan review fires the orphan alarm', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  // The API refuses orphans, so seed one straight into storage.
  store.db.prepare(
    `INSERT INTO reviews (review_id, receipt_id, offering, overall, facets, text, role_at_post, level_at_post, review_class, posted_at)
     VALUES ('rev-ghost', 'rcpt-MISSING', 'algebra2@v3', 1, '{}', 'ghost', 'participant', 1, 'verified_purchaser', ?)`,
  ).run(T0);

  const alarms = healthCheck(store).filter((v) => v.invariant === 'I-1');
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].detail.receipt_id, 'rcpt-MISSING');
});

test('AT-19 (I-5): UPDATE and DELETE on reviews and receipts are refused by the storage layer itself', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  const { receipt } = enroll(store, issuer);
  const { reviewId } = store.submitReview({
    receiptId: receipt.receipt_id, offering: 'algebra2@v3', overall: 2, text: 'meh', postedAt: T0,
  });

  // Raw SQL through the application's own connection — refused by SQLite triggers.
  assert.throws(() => store.db.prepare('UPDATE reviews SET overall = 5 WHERE review_id = ?').run(reviewId), /append-only/);
  assert.throws(() => store.db.prepare('DELETE FROM reviews WHERE review_id = ?').run(reviewId), /append-only/);
  assert.throws(() => store.db.prepare('UPDATE receipts SET level = 4 WHERE receipt_id = ?').run(receipt.receipt_id), /append-only/);
  assert.throws(() => store.db.prepare('DELETE FROM receipts WHERE receipt_id = ?').run(receipt.receipt_id), /append-only/);

  // Nothing changed.
  assert.equal(store.db.prepare('SELECT overall FROM reviews WHERE review_id = ?').get(reviewId).overall, 2);
  assert.equal(store.db.prepare('SELECT level FROM receipts WHERE receipt_id = ?').get(receipt.receipt_id).level, 1);

  // Edits succeed only as new versioned events.
  const edit = store.appendReviewEdit({ reviewId, overall: 3, text: 'better on reflection', loggedAt: T0 });
  assert.equal(edit.type, 'review_edited');
  const row = store.db.prepare("SELECT payload FROM protocol_events WHERE type = 'review_edited'").get();
  assert.equal(JSON.parse(row.payload).review_id, reviewId);

  // And if the physical guarantee is ever removed, I-5 alarms.
  store.db.exec('DROP TRIGGER reviews_no_update');
  const alarms = healthCheck(store).filter((v) => v.invariant === 'I-5');
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].detail.trigger, 'reviews_no_update');
});

test('AT-20 (I-2): 100 transactions with 103 L1 receipts raises a reconciliation alert naming issuer, offering, and gap', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  for (let i = 0; i < 100; i++) enroll(store, issuer);

  // Seed 3 excess L1 receipts straight into storage (a shill-minting issuer, T-1).
  const insert = store.db.prepare(
    `INSERT INTO receipts (receipt_id, spec, issuer, holder, role, offering, level, event, issued_at, prev, coattest, sig)
     VALUES (?, 'as/0.2a', ?, ?, 'participant', 'algebra2@v3', 1, 'enrolled', ?, NULL, '[]', ?)`,
  );
  for (let i = 0; i < 3; i++) {
    insert.run(`shill-${i}`, `ed25519:${issuer.publicHex}`, 'f'.repeat(64), T0, 'ab'.repeat(64));
  }

  const alarms = healthCheck(store).filter((v) => v.invariant === 'I-2');
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].detail.issuer, `ed25519:${issuer.publicHex}`);
  assert.equal(alarms[0].detail.offering, 'algebra2@v3');
  assert.equal(alarms[0].detail.gap, 3);
  assert.equal(alarms[0].detail.l1_receipts, 103);
  assert.equal(alarms[0].detail.transactions, 100);
});

test('AT-21 (I-3): a descending standing chain seeded directly in storage fires the monotonicity alarm', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  const { holder, receipt } = enroll(store, issuer);
  const l3 = store.issueAttestation({
    issuer, holder: holder.binding, role: 'participant', offering: 'algebra2@v3', level: 3, issuedAt: T0,
  }).receipt;

  // The API refuses descension (AT-7); seed it past the API.
  store.db.prepare(
    `INSERT INTO receipts (receipt_id, spec, issuer, holder, role, offering, level, event, issued_at, prev, coattest, sig)
     VALUES ('descend-1', 'as/0.2a', ?, ?, 'participant', 'algebra2@v3', 2, 'participated', ?, ?, '[]', ?)`,
  ).run(`ed25519:${issuer.publicHex}`, holder.binding, T0, l3.receipt_id, 'cd'.repeat(64));

  const alarms = healthCheck(store).filter((v) => v.invariant === 'I-3');
  assert.equal(alarms.length, 1);
  assert.match(alarms[0].message, /descended/);
  assert.equal(alarms[0].detail.receipt_id, 'descend-1');
  void receipt;
});

test('AT-22 (T-8): retiring an offering and minting a successor never orphans the instructor entity history', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  seedReviews(store, issuer, { count: 10, overall: 2, toLevel: 3 }); // bad record on algebra2@v3 (ent_chen)

  store.retireOffering({ offeringId: 'algebra2', version: 'v3', reason: 'relaunch attempt', loggedAt: T0 });
  store.declareOffering({
    offeringId: 'algebra2-fresh-start', version: 'v1', issuerPublicHex: issuer.publicHex,
    components: { instructor: 'ent_chen', curriculum: 'ent_alg2_new' },
    priceCents: 24900, attestationCriteria: {}, declaredAt: T0,
  });
  seedReviews(store, issuer, { count: 10, overall: 5, toLevel: 3, offering: 'algebra2-fresh-start@v1' });

  const rendered = renderEntity(store.entityRenderingInput('ent_chen', WINDOW));
  const retired = rendered.offerings.find((o) => o.offering === 'algebra2@v3');
  assert.ok(retired, 'the retired offering must still appear in the entity rendering');
  assert.equal(retired.retired, true);
  assert.equal(retired.reviews_used, 10, 'the retired offering reviews still count');
  assert.equal(rendered.distinct_receipts, 20);
  // The bad history holds the score below a clean-slate 5.
  assert.ok(rendered.score < 4.5, `score ${rendered.score} must reflect the retired offering's record`);
});

test('AT-23 (T-7): anomalously low completion-attestation issuance is disclosed in the rendering', () => {
  const generous = makeIssuer();
  const stingy = makeIssuer();
  const store = new Store();
  for (const [issuer, name] of [[generous, 'course-a'], [stingy, 'course-b']]) {
    store.declareOffering({
      offeringId: name, version: 'v1', issuerPublicHex: issuer.publicHex,
      components: { instructor: `ent_${name}` }, priceCents: 10000,
      attestationCriteria: { l3: 'finish everything' }, declaredAt: T0,
    });
  }
  // Identical enrollment (12 each). The generous issuer attests completion for
  // 10; the stingy one — who expects bad reviews — attests 1.
  for (const [issuer, offering, completions] of [[generous, 'course-a@v1', 10], [stingy, 'course-b@v1', 1]]) {
    for (let i = 0; i < 12; i++) {
      const { holder, receipt } = enroll(store, issuer, { offering });
      let r = receipt;
      if (i < completions) {
        r = store.issueAttestation({ issuer, holder: holder.binding, role: 'participant', offering, level: 3, issuedAt: T0 }).receipt;
      }
      store.submitReview({ receiptId: r.receipt_id, offering, overall: 4, postedAt: T0 });
    }
  }

  const stingyRendering = renderOffering(store.renderingInput('course-b@v1', WINDOW));
  assert.equal(stingyRendering.issuer_disclosures.anomalously_low, true);
  const generousRendering = renderOffering(store.renderingInput('course-a@v1', WINDOW));
  assert.equal(generousRendering.issuer_disclosures.anomalously_low, false);
  assert.ok(stingyRendering.issuer_disclosures.completion_attestation_rate <
    stingyRendering.issuer_disclosures.cohort_median_rate * PARAMS.ANOMALY_RATIO);
});

test('AT-24: no holder→offering directory exists, and one person yields unlinkable bindings across issuers', () => {
  const issuerA = makeIssuer();
  const issuerB = makeIssuer();

  // Fixture: the SAME person derives different keys — and therefore different
  // bindings — for two issuers (spec §7, F8).
  const root = generateHolderRoot();
  const atA = bindHolder(root, issuerA);
  const atB = bindHolder(root, issuerB);
  assert.notEqual(atA.binding, atB.binding, 'colluding issuers must not be able to join on holder bindings');
  // …and stable within one issuer.
  assert.equal(bindHolder(root, issuerA).binding, atA.binding);

  // The store's public API is a closed allowlist, and none of it is keyed by
  // holder or returns a holder's participation history. A new method that
  // widens this surface fails the test until it is reviewed against §7.
  const publicApi = Object.getOwnPropertyNames(Store.prototype).filter((n) => n !== 'constructor').sort();
  assert.deepEqual(publicApi, [
    'appendReviewEdit',
    'close',
    'declareOffering',
    'entityRenderingInput',
    'issueAttestation',
    'issuerIssuanceStats',
    'listPublications',
    'publish',
    'recordTransaction',
    'refuseAttestation',
    'renderingInput',
    'requestAttestation',
    'retireOffering',
    'submitReview',
  ]);
  for (const name of publicApi) {
    assert.doesNotMatch(name, /holder|directory|history/i,
      'no public method may expose holder-keyed lookups');
  }

  // And no rendering output leaks holder bindings.
  const store = makeStore({ issuer: issuerA });
  seedReviews(store, issuerA, { count: 10, overall: 4, toLevel: 2 });
  const rendered = JSON.stringify(renderOffering(store.renderingInput('algebra2@v3', WINDOW)));
  const bindings = store.db.prepare('SELECT DISTINCT holder FROM receipts').all().map((r) => r.holder);
  for (const b of bindings) {
    assert.equal(rendered.includes(b), false, 'rendering output must not contain holder bindings');
  }
});

test('I-4 and I-7 alarms fire on seeded publication violations', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  seedReviews(store, issuer, { count: 10, overall: 4, toLevel: 2 });

  // Honest publication: healthy.
  store.publish(renderOffering(store.renderingInput('algebra2@v3', WINDOW)));
  assert.deepEqual(healthCheck(store), []);

  // I-4: a doctored manifest (score inflated after publication) is caught.
  const honest = renderOffering(store.renderingInput('algebra2@v3', WINDOW));
  const doctored = { ...honest, views: { ...honest.views, all_verified: { ...honest.views.all_verified, score: 5 } } };
  store.db.prepare(
    'INSERT INTO publications (pub_id, rendering_version, subject, window_end, manifest) VALUES (?, ?, ?, ?, ?)',
  ).run('pub-doctored', doctored.rendering_version, doctored.subject, doctored.window_end,
    require('../../src/crypto').canonicalize(doctored));
  const i4 = healthCheck(store).filter((v) => v.invariant === 'I-4');
  assert.equal(i4.length, 1);
  assert.equal(i4[0].detail.pub_id, 'pub-doctored');

  // I-7: a publication claiming published=true below the k floor is caught.
  const fake = { ...honest, published: true, distinct_receipts: PARAMS.K_ANONYMITY - 7 };
  store.db.prepare(
    'INSERT INTO publications (pub_id, rendering_version, subject, window_end, manifest) VALUES (?, ?, ?, ?, ?)',
  ).run('pub-under-k', fake.rendering_version, fake.subject, fake.window_end,
    require('../../src/crypto').canonicalize(fake));
  const i7 = healthCheck(store).filter((v) => v.invariant === 'I-7');
  assert.equal(i7.length, 1);
  assert.equal(i7[0].detail.pub_id, 'pub-under-k');
});

test('I-6 alarm fires on seeded facet violations in storage', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  const { receipt } = enroll(store, issuer);
  // Seed straight into storage what the API refuses (AT-17): an undeclared facet.
  store.db.prepare(
    `INSERT INTO reviews (review_id, receipt_id, offering, overall, facets, text, role_at_post, level_at_post, review_class, posted_at)
     VALUES ('rev-bad-facet', ?, 'algebra2@v3', 3, '{"ent_notdeclared": 2}', NULL, 'participant', 1, 'verified_purchaser', ?)`,
  ).run(receipt.receipt_id, T0);
  const payer = enroll(store, issuer, { role: 'payer' });
  store.db.prepare(
    `INSERT INTO reviews (review_id, receipt_id, offering, overall, facets, text, role_at_post, level_at_post, review_class, posted_at)
     VALUES ('rev-payer-facet', ?, 'algebra2@v3', 4, '{"ent_chen": 4}', NULL, 'payer', 1, 'verified_purchaser', ?)`,
  ).run(payer.receipt.receipt_id, T0);

  const alarms = healthCheck(store).filter((v) => v.invariant === 'I-6');
  assert.equal(alarms.length, 2);
  assert.ok(alarms.some((a) => a.detail.review_id === 'rev-bad-facet'));
  assert.ok(alarms.some((a) => a.detail.review_id === 'rev-payer-facet'));
});
