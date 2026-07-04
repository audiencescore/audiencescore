'use strict';

// Group C — Reviews and renderings (AT-14 .. AT-17; spec §5, findings F4, F6).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalize } = require('../../src/crypto');
const { renderOffering, PARAMS } = require('../../src/v02/rendering');
const { makeIssuer, makeStore, enroll, T0, WINDOW } = require('./helpers');

/** Enroll n participants, optionally ascend them to L3, and post reviews. */
function seedReviews(store, issuer, { count, overall, toLevel = 1, text = null, offering = 'algebra2@v3' }) {
  for (let i = 0; i < count; i++) {
    let { holder, receipt } = enroll(store, issuer, { offering });
    for (let level = 2; level <= toLevel; level++) {
      receipt = store.issueAttestation({
        issuer, holder: holder.binding, role: 'participant', offering, level, issuedAt: T0,
      }).receipt;
    }
    store.submitReview({ receiptId: receipt.receipt_id, offering, overall, text, postedAt: T0 });
  }
}

test('AT-14 (I-4): rendering the same raw reviews twice yields byte-identical output, and the renderer is clockless', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  seedReviews(store, issuer, { count: 8, overall: 5, toLevel: 3 });
  seedReviews(store, issuer, { count: 4, overall: 2 });

  const first = canonicalize(renderOffering(store.renderingInput('algebra2@v3', WINDOW)));
  const second = canonicalize(renderOffering(store.renderingInput('algebra2@v3', WINDOW)));
  assert.equal(first, second, 'two renderings of the same inputs must be byte-identical');

  // Purity, statically: the rendering module reads no clock, no randomness,
  // no network, no filesystem — "different days" cannot change its output.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'v02', 'rendering.js'), 'utf8');
  for (const forbidden of ['Date.now', 'new Date', 'Math.random', "require('node:fs", "require('node:http", "require('node:crypto"]) {
    assert.equal(src.includes(forbidden), false, `rendering.js must not use ${forbidden}`);
  }
});

test('AT-15 (F6): dropouts at 1★ and completers at 5★ produce different dual views, both published, with completion rate disclosed', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  seedReviews(store, issuer, { count: 8, overall: 5, toLevel: 3 }); // completers love it
  seedReviews(store, issuer, { count: 6, overall: 1 });             // dropouts hated it

  const rendered = renderOffering(store.renderingInput('algebra2@v3', WINDOW));
  assert.equal(rendered.published, true);
  assert.ok(rendered.views.all_verified.score !== null, 'all-verified view must publish');
  assert.ok(rendered.views.completers.score !== null, 'completer view must publish');
  assert.notEqual(rendered.views.all_verified.score, rendered.views.completers.score,
    'the two views must differ for this fixture');
  assert.ok(rendered.views.all_verified.score < rendered.views.completers.score,
    'dropout signal must pull the all-verified view down');
  assert.equal(rendered.completion_rate, Math.round((8 / 14) * 10_000) / 10_000);
  assert.equal(rendered.views.completers.sample_size, 8);
  assert.equal(rendered.views.all_verified.sample_size, 14);
});

test('AT-16 (I-7): no score renders below k receipts; at k it renders; text stays suppressed below the floor', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  seedReviews(store, issuer, { count: PARAMS.K_ANONYMITY - 1, overall: 4, text: 'identifiable prose' });

  const below = renderOffering(store.renderingInput('algebra2@v3', WINDOW));
  assert.equal(below.published, false);
  assert.equal(below.views.all_verified.score, null);
  assert.equal(below.review_texts, null, 'text must be suppressed below the floor');
  assert.equal(below.distinct_receipts, PARAMS.K_ANONYMITY - 1, 'reviews still count toward the eventual score');

  seedReviews(store, issuer, { count: 1, overall: 4, text: 'the kth voice' });
  const at = renderOffering(store.renderingInput('algebra2@v3', WINDOW));
  assert.equal(at.published, true);
  assert.equal(at.views.all_verified.score, 4);
  assert.equal(at.review_texts.length, PARAMS.K_ANONYMITY);
});

test('AT-17 (I-6): a facet score naming an undeclared entity is rejected', () => {
  const issuer = makeIssuer();
  const store = makeStore({ issuer });
  const { receipt } = enroll(store, issuer);

  assert.throws(
    () => store.submitReview({
      receiptId: receipt.receipt_id, offering: 'algebra2@v3',
      overall: 3, facets: { ent_notdeclared: 2 }, postedAt: T0,
    }),
    /not a declared component/,
  );

  // The declared components are fine.
  const ok = store.submitReview({
    receiptId: receipt.receipt_id, offering: 'algebra2@v3',
    overall: 5, facets: { ent_chen: 5, ent_alg2: 4 }, postedAt: T0,
  });
  assert.ok(ok.reviewId);
});

test('review vectors: the conformance review expectations hold against the store', () => {
  // Drives the reviews section of conformance/vectors.json through the real
  // admission path: valid admitted, orphan refused (I-1), undeclared facet
  // refused (I-6), payer facets refused (I-6-role).
  const issuer = makeIssuer();
  const store = makeStore({ issuer });

  const participant = enroll(store, issuer);
  let receipt = participant.receipt;
  for (const level of [2, 3]) {
    receipt = store.issueAttestation({
      issuer, holder: participant.holder.binding, role: 'participant',
      offering: 'algebra2@v3', level, issuedAt: T0,
    }).receipt;
  }
  const payer = enroll(store, issuer, { role: 'payer' });

  // valid_review_with_facets
  const ok = store.submitReview({
    receiptId: receipt.receipt_id, offering: 'algebra2@v3',
    overall: 5, facets: { ent_chen: 5, ent_alg2: 4 }, text: 'Rigorous and fair.', postedAt: T0,
  });
  assert.ok(ok.reviewId);

  // orphan_review -> violates:I-1
  assert.throws(
    () => store.submitReview({ receiptId: 'as-test-rcpt-MISSING', offering: 'algebra2@v3', overall: 1, postedAt: T0 }),
    /no receipt, no review/,
  );

  // facet_on_undeclared_component -> violates:I-6 (fresh holder; one voice per standing)
  const second = enroll(store, issuer);
  assert.throws(
    () => store.submitReview({
      receiptId: second.receipt.receipt_id, offering: 'algebra2@v3',
      overall: 3, facets: { ent_notdeclared: 2 }, postedAt: T0,
    }),
    /I-6/,
  );

  // payer_with_facets -> violates:I-6-role
  assert.throws(
    () => store.submitReview({
      receiptId: payer.receipt.receipt_id, offering: 'algebra2@v3',
      overall: 4, facets: { ent_chen: 4 }, postedAt: T0,
    }),
    /payers rate value-for-money only/,
  );
});
