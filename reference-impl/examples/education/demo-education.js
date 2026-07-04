#!/usr/bin/env node
'use strict';

// ============================================================================
// DEMONSTRATOR — NOT PRODUCTION, NOT A LIVE INTEGRATION.
// ============================================================================
//
// Worked example for examples/education/adapter.js: replay a generic stream of
// LMS + payment webhooks through the education adapter and watch the
// attestation ladder fill in, then post receipt-gated reviews and render the
// score. Every protocol operation here is the real v0.2 code; only the webhook
// payloads and the holder identities are synthetic (see adapter.js).
//
// Run: node reference-impl/examples/education/demo-education.js

const { generateKeyPair } = require('../../src/v02/signing');
const { generateSalt } = require('../../src/v02/holder');
const { Store } = require('../../src/v02/store');
const { renderOffering } = require('../../src/v02/rendering');
const { healthCheck } = require('../../src/v02/invariants');
const { EducationIssuerAdapter, EVENT, verifyReceipt } = require('./adapter');

function step(title) { console.log(`\n=== ${title} ===`); }

// Fixed clock so the example is deterministic (the rendering itself is a pure,
// clockless function; only these input timestamps are pinned).
const T0 = '2026-07-04T12:00:00Z';
const WINDOW = '2026-07-05T00:00:00Z';
const PAID = { id: 'algebra2', version: 'v3' };
const FREE = { id: 'freecourse', version: 'v1' };
const PAID_REF = `${PAID.id}@${PAID.version}`;

step('1. Issuer identity (the education provider of record)');
const issuer = { ...generateKeyPair(), salt: generateSalt() };
console.log(`issuer key: ed25519:${issuer.publicHex.slice(0, 24)}…`);

step('2. Declare the issuer catalog onto the protocol');
const store = new Store();
const adapter = new EducationIssuerAdapter({
  store,
  issuer,
  l2ProgressThreshold: 60,
  offerings: [
    {
      offeringId: PAID.id, version: PAID.version,
      components: { instructor: 'ent_chen', curriculum: 'ent_alg2', platform: 'ent_lms' },
      priceCents: 24900,
      attestationCriteria: { l2: 'progress >= 60%', l3: 'final project accepted' },
      declaredAt: T0,
    },
    {
      offeringId: FREE.id, version: FREE.version,
      components: { curriculum: 'ent_freecurr' },
      priceCents: 0,
      attestationCriteria: { l2: 'completed 5 modules' },
      declaredAt: T0,
    },
  ],
}).registerOfferings();
console.log(`declared: ${PAID_REF} (paid, $249.00) and ${FREE.id}@${FREE.version} (free)`);

// --- Build a synthetic but realistic webhook stream --------------------------
// 12 learners enroll in the paid course; 10 pass the L2 progress threshold; 7
// finish (L3). A couple of parents pay (payer role). Plus deliberate edge
// cases: a below-threshold progress ping, an out-of-order completion, and a
// free-course enrollment — each should be handled without crashing.
const events = [];
for (let i = 1; i <= 12; i++) {
  const subject = `learner-${String(i).padStart(2, '0')}`;
  events.push({ type: EVENT.ENROLLMENT, subject, offering: PAID, occurred_at: T0 });
  if (i <= 10) events.push({ type: EVENT.PROGRESS, subject, offering: PAID, progress_pct: 72, occurred_at: T0 });
  if (i <= 7) events.push({ type: EVENT.COMPLETION, subject, offering: PAID, occurred_at: T0 });
}
// Two parents pay for their child's seat (payer role, L1 value-for-money).
events.push({ type: EVENT.PAYMENT, subject: 'parent-A', role: 'payer', offering: PAID, amount_cents: 24900, occurred_at: T0 });
events.push({ type: EVENT.PAYMENT, subject: 'parent-B', role: 'payer', offering: PAID, amount_cents: 24900, occurred_at: T0 });
// Edge cases that must be absorbed as no-ops, not errors:
events.push({ type: EVENT.PROGRESS, subject: 'learner-11', offering: PAID, progress_pct: 20, occurred_at: T0 }); // below threshold
events.push({ type: EVENT.COMPLETION, subject: 'learner-12', offering: PAID, occurred_at: T0 }); // L1 -> L3 jump (allowed: levels independent)
events.push({ type: EVENT.ENROLLMENT, subject: 'freebie-1', offering: FREE, occurred_at: T0 }); // free: no L1

step('3. Replay the webhook stream through the adapter');
const issued = []; // { subject, role, receipt, level }
const tally = { issued: 0, noop: 0, refused: 0 };
for (const ev of events) {
  const out = adapter.handle(ev);
  tally[out.status]++;
  if (out.status === 'issued') {
    issued.push({ subject: ev.subject, role: out.role, receipt: out.receipt, level: out.level });
  }
}
console.log(`events: ${events.length} | issued: ${tally.issued} receipts | no-op: ${tally.noop} | refused: ${tally.refused}`);
console.log('sample mappings:');
console.log(`  enrollment.created (paid)  -> L1 participant`);
console.log(`  lms.progress 72% (>=60)    -> L2 participant`);
console.log(`  lms.completed              -> L3 participant`);
console.log(`  payment.succeeded          -> L1 payer`);
console.log(`  lms.progress 20% (<60)     -> no-op`);
console.log(`  enrollment.created (free)  -> no-op (no value moved; L2 on progress)`);

step('4. Every issued receipt verifies against the issuer signature');
const allVerify = issued.every((r) => verifyReceipt(r.receipt));
console.log(`issued receipts: ${issued.length}, all signatures verify: ${allVerify}`);
if (!allVerify) { console.error('DEMONSTRATOR FAILED: a receipt did not verify'); process.exit(1); }

step('5. Downstream: holders post receipt-gated reviews (illustration only)');
// The adapter's job ends at issuing receipts. Reviews are holder-side; here we
// simulate them so the example shows the whole loop. One review per standing.
const latestByHolder = new Map(); // holder binding -> highest-level receipt
for (const r of issued) {
  const prev = latestByHolder.get(r.receipt.holder);
  if (!prev || r.receipt.level > prev.level) latestByHolder.set(r.receipt.holder, r);
}
let reviewCount = 0;
let idx = 0;
for (const { receipt, role } of latestByHolder.values()) {
  idx++;
  const overall = idx % 4 === 0 ? 2 : 5; // a realistic minority of low scores
  const facets = role === 'participant'
    ? { ent_chen: overall, ent_alg2: overall === 5 ? 4 : 2 } // participants may rate declared components
    : {};                                                     // payers rate value only (no facets)
  store.submitReview({ receiptId: receipt.receipt_id, offering: PAID_REF, overall, facets, text: null, postedAt: T0 });
  reviewCount++;
}
console.log(`reviews admitted: ${reviewCount} (one per standing; payers value-only, participants may rate components)`);

step('6. Render the score (deterministic, dual-view, k-anonymity gated)');
const rendered = renderOffering(store.renderingInput(PAID_REF, WINDOW));
console.log(JSON.stringify({
  subject: rendered.subject,
  published: rendered.published,
  distinct_receipts: rendered.distinct_receipts,
  k_anonymity_floor: rendered.k_anonymity_floor,
  standing_class: rendered.standing_class,
  views: rendered.views,
  completion_rate: rendered.completion_rate,
  sample_mix: rendered.sample_mix,
}, null, 2));

step('7. Invariant health check over the whole ledger');
const violations = healthCheck(store); // returns [] when every invariant holds
console.log(`invariant violations: ${violations.length} (expected 0)`);
if (violations.length > 0) {
  console.error(`DEMONSTRATOR FAILED: ${JSON.stringify(violations, null, 2)}`);
  process.exit(1);
}

console.log('\nDEMONSTRATOR complete: webhooks -> signed receipts on the ladder -> ' +
  'receipt-gated reviews -> deterministic score. Illustrative only; the real ' +
  'adapter is built with the first anchor issuer against real events.');
