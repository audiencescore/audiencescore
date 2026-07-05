'use strict';

// Multi-tenant ingestion + cross-source de-duplication.
// The load-bearing invariant: one real sale reported by many partners yields
// exactly ONE receipt, ONE review-right, ONE delivery — and the duplicate
// reports become corroborations that strengthen it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PilotRuntime } = require('../../src/pilot/runtime');
const { createServer } = require('../../src/pilot/server');
const { verifyCoattestation } = require('../../src/v02/signing');
const { loadPartnerKey } = require('../../src/pilot/keyring');
const { signPartnerRequest } = require('../../src/pilot/partner-auth');

function tempConfig(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-ingest-'));
  return {
    dataDir: dir, keysDir: path.join(dir, 'keys'), dbPath: path.join(dir, 'pilot.sqlite'),
    outboxDir: path.join(dir, 'outbox'), backupDir: path.join(dir, 'backups'),
    publicBaseUrl: 'http://127.0.0.1:0', emailMode: 'file', ...extra,
  };
}

function setup(runtime) {
  runtime.createIssuer({ issuerId: 'acme', name: 'Acme Co' });
  runtime.addOffering({
    issuerId: 'acme', offeringId: 'widget', version: 'v1', name: 'Widget',
    priceCents: 4900, components: { service: 'ent_acme' }, attestationCriteria: {},
  });
}

const outboxCount = (r) => (fs.existsSync(r.config.outboxDir) ? fs.readdirSync(r.config.outboxDir).length : 0);
const count = (r, sql, ...a) => r.store.db.prepare(sql).get(...a).c;

function signedPartnerHeaders(runtime, partnerId, method, pathName, body, nonce = `nonce-${Date.now()}-${Math.random()}`) {
  const timestamp = new Date().toISOString();
  const request = { method, path: pathName, body, timestamp, nonce };
  return {
    'content-type': 'application/json',
    'x-as-partner-id': partnerId,
    'x-as-timestamp': timestamp,
    'x-as-nonce': nonce,
    'x-as-signature': signPartnerRequest(loadPartnerKey(runtime.config.keysDir, partnerId).privateKey, request),
  };
}

test('same rail transaction from two partners → one receipt, one corroboration, one review-right, one delivery', async () => {
  const runtime = new PilotRuntime(tempConfig());
  setup(runtime);
  runtime.createPartner({ partnerId: 'stripe-rail', name: 'Stripe', kind: 'rail' });
  runtime.createPartner({ partnerId: 'quickbooks', name: 'QuickBooks', kind: 'platform' });
  runtime.linkIssuer({ partnerId: 'stripe-rail', issuerId: 'acme' });
  runtime.linkIssuer({ partnerId: 'quickbooks', issuerId: 'acme' });

  const event = {
    issuerId: 'acme', offering: 'widget@v1', amountCents: 4900, currency: 'usd',
    rail: 'stripe', processorTxnId: 'pi_ABC123', occurredAt: '2026-07-04T15:00:00Z',
    customerEmail: 'buyer@example.test', kind: 'transaction',
  };

  const first = await runtime.ingestTransaction(event, { partner: runtime.getPartner('stripe-rail') });
  assert.equal(first.status, 'minted');

  // QuickBooks reports the SAME sale (carries the same Stripe id downstream).
  const second = await runtime.ingestTransaction(event, { partner: runtime.getPartner('quickbooks') });
  assert.equal(second.status, 'corroborated');
  assert.equal(second.receipt.receipt_id, first.receipt.receipt_id, 'same receipt, not a new one');

  // A third report from the merchant's own system, same sale.
  const merchant = runtime.createPartner({ partnerId: 'acme-app', name: 'Acme App', kind: 'merchant' });
  runtime.linkIssuer({ partnerId: 'acme-app', issuerId: 'acme' });
  const third = await runtime.ingestTransaction(event, { partner: runtime.getPartner('acme-app') });
  assert.equal(third.status, 'corroborated');

  assert.equal(count(runtime, 'SELECT count(*) c FROM receipts WHERE offering = ?', 'widget@v1'), 1, 'exactly one receipt');
  assert.equal(count(runtime, 'SELECT count(*) c FROM transactions'), 1, 'exactly one ledger transaction');
  assert.equal(count(runtime, 'SELECT count(*) c FROM pilot_txn_registry'), 1, 'one canonical transaction');
  assert.equal(count(runtime, 'SELECT count(*) c FROM pilot_corroborations'), 2, 'two corroborations');
  assert.equal(outboxCount(runtime), 1, 'the review link is delivered exactly once');

  // One review-right: the first review succeeds, a reuse is refused.
  const review = { overall: 5, facets: {}, text: 'great' };
  const r1 = runtime.submitReviewWithReceipt({ receipt: first.receipt, review });
  assert.equal(r1.reviewClass, 'verified_purchaser');
  assert.throws(() => runtime.submitReviewWithReceipt({ receipt: first.receipt, review }), /already/);
  assert.equal(count(runtime, 'SELECT count(*) c FROM reviews'), 1, 'one real transaction yields at most one review');
  const signed = runtime.signedScore('widget@v1', new Date().toISOString());
  assert.equal(signed.manifest.sample_mix.attestation_sources.coattested, 1, 'later corroborations feed signed rendering evidence');
  const evidence = runtime.renderingEvidence('widget@v1', new Date().toISOString());
  assert.equal(evidence.reviews[0].corroboration_count, 2);

  runtime.close();
});

test('corroboration signatures verify against the corroborating partner keys', async () => {
  const runtime = new PilotRuntime(tempConfig());
  setup(runtime);
  runtime.createPartner({ partnerId: 'stripe-rail', name: 'Stripe', kind: 'rail' });
  const qbo = runtime.createPartner({ partnerId: 'quickbooks', name: 'QuickBooks', kind: 'platform' });
  runtime.linkIssuer({ partnerId: 'stripe-rail', issuerId: 'acme' });
  runtime.linkIssuer({ partnerId: 'quickbooks', issuerId: 'acme' });
  const event = { issuerId: 'acme', offering: 'widget@v1', amountCents: 4900, currency: 'usd', rail: 'stripe', processorTxnId: 'pi_SIG', occurredAt: '2026-07-04T15:00:00Z', kind: 'transaction' };
  const minted = await runtime.ingestTransaction(event, { partner: runtime.getPartner('stripe-rail') });
  await runtime.ingestTransaction(event, { partner: runtime.getPartner('quickbooks') });

  const receipt = runtime.getStoredReceipt(minted.receipt.receipt_id);
  const row = runtime.store.db.prepare('SELECT * FROM pilot_corroborations WHERE source_partner_id = ?').get('quickbooks');
  assert.ok(row.coattest, 'corroboration carries a signature');
  assert.equal(verifyCoattestation(receipt, row.coattest, qbo.publicHex), true, 'signature verifies against QuickBooks key');
  assert.equal(verifyCoattestation(receipt, row.coattest, '00'.repeat(32)), false, 'a wrong key fails closed');
  runtime.close();
});

test('platform covers a merchant via connectedAccountRef, and delivery still fires once when the email arrives late', async () => {
  const runtime = new PilotRuntime(tempConfig());
  setup(runtime);
  runtime.createPartner({ partnerId: 'platform-x', name: 'Platform X', kind: 'platform' });
  runtime.linkIssuer({ partnerId: 'platform-x', issuerId: 'acme', connectedAccountRef: 'acct_777' });

  // Minter resolves the issuer from the connected account and has NO email yet.
  const mint = await runtime.ingestTransaction(
    { connectedAccountRef: 'acct_777', offering: 'widget@v1', amountCents: 4900, currency: 'usd', rail: 'stripe', processorTxnId: 'pi_LATE', occurredAt: '2026-07-04T16:00:00Z', kind: 'transaction' },
    { partner: runtime.getPartner('platform-x') },
  );
  assert.equal(mint.status, 'minted');
  assert.equal(outboxCount(runtime), 0, 'nothing delivered yet — no contact');

  // A later source resolves to the same sale and DOES carry the email.
  const corr = await runtime.ingestTransaction(
    { issuerId: 'acme', offering: 'widget@v1', amountCents: 4900, currency: 'usd', rail: 'stripe', processorTxnId: 'pi_LATE', occurredAt: '2026-07-04T16:00:00Z', customerEmail: 'late@example.test', kind: 'transaction' },
    { partner: runtime.getPartner('platform-x') },
  );
  assert.equal(corr.status, 'corroborated');
  assert.equal(corr.receipt.receipt_id, mint.receipt.receipt_id);
  assert.equal(outboxCount(runtime), 1, 'delivered once, by the source that had the email');
  runtime.close();
});

test('a partner cannot issue for an issuer it is not linked to', async () => {
  const runtime = new PilotRuntime(tempConfig());
  setup(runtime);
  runtime.createPartner({ partnerId: 'stranger', name: 'Stranger', kind: 'platform' });
  await assert.rejects(
    () => runtime.ingestTransaction(
      { issuerId: 'acme', offering: 'widget@v1', amountCents: 4900, currency: 'usd', rail: 'stripe', processorTxnId: 'pi_X', occurredAt: '2026-07-04T15:00:00Z', kind: 'transaction' },
      { partner: runtime.getPartner('stranger') },
    ),
    /not authorized/,
  );
  runtime.close();
});

test('a refund posts a reversal corroboration, never a receipt', async () => {
  const runtime = new PilotRuntime(tempConfig());
  setup(runtime);
  runtime.createPartner({ partnerId: 'stripe-rail', name: 'Stripe', kind: 'rail' });
  runtime.linkIssuer({ partnerId: 'stripe-rail', issuerId: 'acme' });
  const base = { issuerId: 'acme', offering: 'widget@v1', amountCents: 4900, currency: 'usd', rail: 'stripe', processorTxnId: 'pi_REF', occurredAt: '2026-07-04T15:00:00Z' };
  await runtime.ingestTransaction({ ...base, kind: 'transaction' }, { partner: runtime.getPartner('stripe-rail') });
  const reversal = await runtime.ingestTransaction({ ...base, kind: 'reversal' }, { partner: runtime.getPartner('stripe-rail') });
  assert.equal(reversal.status, 'reversed');
  assert.equal(count(runtime, 'SELECT count(*) c FROM receipts WHERE offering = ?', 'widget@v1'), 1, 'reversal added no receipt');
  assert.equal(count(runtime, "SELECT count(*) c FROM pilot_corroborations WHERE kind = 'reversed'"), 1);
  runtime.close();
});

test('ingestion refuses a non-positive amount (an L1 receipt requires value to have moved)', async () => {
  const runtime = new PilotRuntime(tempConfig());
  setup(runtime);
  runtime.createPartner({ partnerId: 'plat', name: 'Platform', kind: 'platform' });
  runtime.linkIssuer({ partnerId: 'plat', issuerId: 'acme' });
  await assert.rejects(
    () => runtime.ingestTransaction(
      { issuerId: 'acme', offering: 'widget@v1', amountCents: 0, currency: 'usd', rail: 'stripe', processorTxnId: 'pi_ZERO', occurredAt: '2026-07-04T15:00:00Z', kind: 'transaction' },
      { partner: runtime.getPartner('plat') },
    ),
    /positive integer/,
  );
  runtime.close();
});

test('same rail id with conflicting immutable facts is quarantined, not corroborated', async () => {
  const runtime = new PilotRuntime(tempConfig());
  runtime.createIssuer({ issuerId: 'school', name: 'School' });
  runtime.addOffering({ issuerId: 'school', offeringId: 'math', version: 'v1', name: 'Math', priceCents: 5000, components: { course: 'math' } });
  runtime.addOffering({ issuerId: 'school', offeringId: 'science', version: 'v1', name: 'Science', priceCents: 25000, components: { course: 'science' } });
  runtime.createPartner({ partnerId: 'platform', name: 'Platform' });
  runtime.linkIssuer({ partnerId: 'platform', issuerId: 'school' });
  const partner = runtime.getPartner('platform');
  const base = { issuerId: 'school', rail: 'stripe', processorTxnId: 'pi_same', currency: 'usd', customerEmail: 'student@example.test', kind: 'transaction' };
  const first = await runtime.ingestTransaction({ ...base, offering: 'math@v1', amountCents: 5000, occurredAt: '2026-07-04T15:00:00Z' }, { partner });
  const second = await runtime.ingestTransaction({ ...base, offering: 'science@v1', amountCents: 25000, occurredAt: '2026-07-04T15:01:00Z' }, { partner });
  assert.equal(first.status, 'minted');
  assert.equal(second.status, 'conflict');
  assert.equal(count(runtime, 'SELECT count(*) c FROM receipts'), 1);
  assert.equal(count(runtime, 'SELECT count(*) c FROM pilot_corroborations'), 0);
  assert.equal(count(runtime, 'SELECT count(*) c FROM pilot_txn_conflicts'), 1);
  runtime.close();
});

test('surrogate no-rail repeat and hour-boundary near-match are ambiguous, not silent merge or duplicate mint', async () => {
  const runtime = new PilotRuntime(tempConfig());
  setup(runtime);
  runtime.createPartner({ partnerId: 'pos', name: 'POS' });
  runtime.linkIssuer({ partnerId: 'pos', issuerId: 'acme' });
  const partner = runtime.getPartner('pos');
  const base = { issuerId: 'acme', offering: 'widget@v1', amountCents: 4900, currency: 'usd', customerEmail: 'buyer@example.test', kind: 'transaction' };
  const first = await runtime.ingestTransaction({ ...base, occurredAt: '2026-07-04T15:10:00Z' }, { partner });
  const sameBucket = await runtime.ingestTransaction({ ...base, occurredAt: '2026-07-04T15:50:00Z' }, { partner });
  const nextBucket = await runtime.ingestTransaction({ ...base, occurredAt: '2026-07-04T16:00:01Z' }, { partner });
  assert.equal(first.status, 'minted');
  assert.equal(sameBucket.status, 'ambiguous');
  assert.equal(nextBucket.status, 'ambiguous');
  assert.equal(count(runtime, 'SELECT count(*) c FROM receipts'), 1);
  assert.equal(count(runtime, 'SELECT count(*) c FROM pilot_txn_conflicts'), 2);
  runtime.close();
});

test('an unsigned Stripe webhook is refused before anything is written', async () => {
  const runtime = new PilotRuntime(tempConfig({ stripeWebhookSecrets: { acme: 'whsec_x' } }));
  setup(runtime);
  const raw = JSON.stringify({ id: 'evt_forge', type: 'foo.bar' });
  await assert.rejects(() => runtime.handleStripeWebhook(raw, undefined), /signature/i);
  assert.equal(count(runtime, 'SELECT count(*) c FROM pilot_webhook_events'), 0, 'no bookkeeping row from an unsigned body');
  runtime.close();
});

test('the /v1/transactions endpoint authenticates the partner and mints', async () => {
  const runtime = new PilotRuntime(tempConfig());
  setup(runtime);
  const p = runtime.createPartner({ partnerId: 'api-partner', name: 'API Partner', kind: 'platform' });
  runtime.linkIssuer({ partnerId: 'api-partner', issuerId: 'acme' });
  const server = createServer(runtime);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ issuerId: 'acme', offering: 'widget@v1', amountCents: 4900, currency: 'usd', rail: 'stripe', processorTxnId: 'pi_API', occurredAt: '2026-07-04T15:00:00Z', kind: 'transaction' });
  try {
    const bad = await fetch(`${base}/v1/transactions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-as-partner-id': 'api-partner' }, body });
    assert.equal(bad.status, 401);
    const headers = signedPartnerHeaders(runtime, p.partnerId, 'POST', '/v1/transactions', body, 'nonce-api-1');
    const ok = await fetch(`${base}/v1/transactions`, { method: 'POST', headers, body });
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).status, 'minted');
    const replay = await fetch(`${base}/v1/transactions`, { method: 'POST', headers, body });
    assert.equal(replay.status, 401);
  } finally {
    server.close();
    runtime.close();
  }
});
