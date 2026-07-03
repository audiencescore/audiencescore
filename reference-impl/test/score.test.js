'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPair, publicKeyToString, verifyPayload } = require('../src/crypto');
const { createEvent, EventLog } = require('../src/events');
const {
  renderScore,
  signManifest,
  wilsonLowerBound,
  timeDecay,
  MIN_SAMPLE,
} = require('../src/score');

const NOW = '2026-07-02T00:00:00.000Z';

function buildLog({ ups, downs, vendorId = 'v1', state = 'CO', tier = 'vendor_receipt', issuedAt = NOW }) {
  const log = new EventLog();
  const add = (verdict, i) => {
    const reviewer = generateKeyPair();
    log.append(createEvent({
      type: 'verdict',
      prev: log.head(),
      privateKey: reviewer.privateKey,
      signerString: publicKeyToString(reviewer.publicKey),
      body: {
        verdict,
        dimensions: { on_time: verdict === 'up' },
        narrative: null,
        vendor: { id: vendorId, locality: { country: 'US', state } },
        service_locality: { state },
        receipt: { tier, right_id: `r-${verdict}-${i}`, proof_hash: `p-${verdict}-${i}` },
        issued_at: issuedAt,
      },
    }));
  };
  for (let i = 0; i < ups; i++) add('up', i);
  for (let i = 0; i < downs; i++) add('down', i);
  return log;
}

test('score is percent verified thumbs-up (uniform weights, no decay)', () => {
  const log = buildLog({ ups: 9, downs: 3 });
  const m = renderScore(log.events, { vendorId: 'v1', state: 'CO', now: NOW });
  assert.equal(m.sample_size, 12);
  assert.equal(m.displayed, true);
  assert.equal(m.score, 0.75);
  // Wilson lower bound at 95% for 9/12, rounded to 4 decimals
  assert.equal(m.wilson_lower_bound, Math.round(wilsonLowerBound(9, 12) * 10_000) / 10_000);
  assert.ok(m.wilson_lower_bound > 0.46 && m.wilson_lower_bound < 0.48);
});

test('no headline score below the sample floor', () => {
  const log = buildLog({ ups: MIN_SAMPLE - 1, downs: 0 });
  const m = renderScore(log.events, { vendorId: 'v1', state: 'CO', now: NOW });
  assert.equal(m.displayed, false);
  assert.equal(m.score, null);
  assert.equal(m.wilson_lower_bound, null);
});

test('state scoping filters events', () => {
  const log = buildLog({ ups: 12, downs: 0 });
  const other = renderScore(log.events, { vendorId: 'v1', state: 'WY', now: NOW });
  assert.equal(other.sample_size, 0);
  const national = renderScore(log.events, { vendorId: 'v1', now: NOW });
  assert.equal(national.sample_size, 12);
  assert.deepEqual(national.locality, { scope: 'national' });
});

test('weaker proof tiers weigh less', () => {
  const strong = buildLog({ ups: 10, downs: 10, tier: 'vendor_receipt' });
  const weak = buildLog({ ups: 10, downs: 10, tier: 'email_receipt' });
  const ms = renderScore(strong.events, { vendorId: 'v1', state: 'CO', now: NOW });
  const mw = renderScore(weak.events, { vendorId: 'v1', state: 'CO', now: NOW });
  assert.equal(ms.score, mw.score); // same proportion...
  assert.ok(mw.wilson_lower_bound < ms.wilson_lower_bound); // ...but less effective evidence
});

test('time decay halves weight at the half-life', () => {
  assert.equal(timeDecay(0), 1);
  assert.ok(Math.abs(timeDecay(730) - 0.5) < 1e-12);
});

test('provenance hash is order-independent and manifest signature verifies', () => {
  const log = buildLog({ ups: 9, downs: 3 });
  const m1 = renderScore(log.events, { vendorId: 'v1', state: 'CO', now: NOW });
  const m2 = renderScore([...log.events].reverse(), { vendorId: 'v1', state: 'CO', now: NOW });
  assert.equal(m1.provenance.event_set_hash, m2.provenance.event_set_hash);

  const key = generateKeyPair();
  const signed = signManifest(m1, key.privateKey, key.publicKey);
  assert.equal(verifyPayload(signed.signer, signed.manifest, signed.sig), true);
});

test('dimension sub-scores respect their own floor', () => {
  const log = buildLog({ ups: 12, downs: 0 });
  const m = renderScore(log.events, { vendorId: 'v1', state: 'CO', now: NOW });
  assert.equal(m.dimensions.on_time.displayed, true);
  assert.equal(m.dimensions.on_time.percent_positive, 1);

  const small = buildLog({ ups: 3, downs: 0 });
  const ms = renderScore(small.events, { vendorId: 'v1', state: 'CO', now: NOW });
  assert.equal(ms.dimensions.on_time.displayed, false);
});

// --- edge cases surfaced by the pre-launch review ---

function appendVerdict(log, { verdict, tier, i, vendorId = 'v1', state = 'CO', body }) {
  const r = generateKeyPair();
  log.append(createEvent({
    type: 'verdict',
    prev: log.head(),
    privateKey: r.privateKey,
    signerString: publicKeyToString(r.publicKey),
    body: body ?? {
      verdict,
      dimensions: {},
      narrative: null,
      vendor: { id: vendorId, locality: { country: 'US', state } },
      service_locality: { state },
      receipt: { tier, right_id: `r${i}`, proof_hash: `p${i}` },
      issued_at: NOW,
    },
  }));
}

test('unknown proof tiers carry no weight and never render a NaN score (M-1)', () => {
  const log = buildLog({ ups: 12, downs: 0, tier: 'not-a-real-tier' });
  const m = renderScore(log.events, { vendorId: 'v1', state: 'CO', now: NOW });
  assert.equal(m.sample_size, 0); // weightless verdicts don't count
  assert.equal(m.displayed, false);
  assert.equal(m.score, null); // must be null, never NaN
  assert.equal(m.wilson_lower_bound, null);
});

test('weightless verdicts cannot pad the display floor (M-4)', () => {
  const log = new EventLog();
  for (let i = 0; i < 20; i++) appendVerdict(log, { verdict: 'up', tier: 'not-a-real-tier', i });
  for (let i = 0; i < 3; i++) appendVerdict(log, { verdict: 'up', tier: 'vendor_receipt', i: 100 + i });
  const m = renderScore(log.events, { vendorId: 'v1', state: 'CO', now: NOW });
  assert.equal(m.sample_size, 3); // only attributable verdicts count
  assert.equal(m.displayed, false); // 3 < floor of 10, despite 23 total in scope
});

test('a signed-but-malformed verdict is skipped, never crashes rendering (M-2)', () => {
  const log = buildLog({ ups: 10, downs: 0 });
  appendVerdict(log, { body: { verdict: 'up' } }); // no vendor / receipt / issued_at
  assert.equal(log.verifyChain(), true); // validly signed and chains
  let m;
  assert.doesNotThrow(() => {
    m = renderScore(log.events, { vendorId: 'v1', state: 'CO', now: NOW });
  });
  assert.equal(m.sample_size, 10); // the malformed verdict is skipped
  assert.equal(m.displayed, true);
});

test('chain integrity does NOT enforce single-use — reused right_id still chains (documents the admission-layer boundary)', () => {
  const log = new EventLog();
  for (let i = 0; i < 12; i++) {
    appendVerdict(log, {
      verdict: 'up',
      body: {
        verdict: 'up',
        dimensions: {},
        narrative: null,
        vendor: { id: 'v1', locality: { country: 'US', state: 'CO' } },
        service_locality: { state: 'CO' },
        receipt: { tier: 'vendor_receipt', right_id: 'SHARED', proof_hash: 'SHARED' },
        issued_at: NOW,
      },
    });
  }
  // The chain verifies: single-use is enforced at admission, not by the log.
  // This is exactly what the receipt spec and docs now state plainly.
  assert.equal(log.verifyChain(), true);
});
