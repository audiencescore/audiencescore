'use strict';

// Square and QuickBooks connectors as producers of the ingestion spine, and
// bulk merchant provisioning (the "connect once, cover every merchant" step).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PilotRuntime } = require('../../src/pilot/runtime');
const { signSquareFixture } = require('../../src/pilot/square');
const { signQuickBooksFixture } = require('../../src/pilot/quickbooks');

const SQUARE_KEY = 'sq_sig_key_test';
const SQUARE_URL = 'https://api.audiencescore.test/v1/square/webhook';
const QBO_TOKEN = 'qbo_verifier_test';

function tempConfig(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-conn-'));
  return {
    dataDir: dir, keysDir: path.join(dir, 'keys'), dbPath: path.join(dir, 'pilot.sqlite'),
    outboxDir: path.join(dir, 'outbox'), backupDir: path.join(dir, 'backups'),
    publicBaseUrl: 'http://127.0.0.1:0', emailMode: 'file', ...extra,
  };
}

const count = (r, sql, ...a) => r.store.db.prepare(sql).get(...a).c;

function squareEvent(overrides = {}) {
  return {
    merchant_id: 'ML_MERCHANT_1', type: 'payment.updated', event_id: overrides.event_id ?? 'sq_evt_1',
    data: { object: { payment: {
      id: overrides.paymentId ?? 'sqpmt_1',
      amount_money: { amount: 4900, currency: 'USD' },
      status: overrides.status ?? 'COMPLETED',
      buyer_email_address: 'sqbuyer@example.test',
      created_at: '2026-07-04T18:00:00Z',
      ...(overrides.refunded ? { refunded_money: { amount: 4900, currency: 'USD' } } : {}),
    } } },
  };
}

test('provisioning + Square webhook: one platform call covers a merchant, then its sale mints', async () => {
  const runtime = new PilotRuntime(tempConfig({ squareSignatureKey: SQUARE_KEY, squareNotificationUrl: SQUARE_URL }));
  runtime.createPartner({ partnerId: 'square', name: 'Square', kind: 'rail' });
  runtime.provisionMerchants('square', [{ issuerId: 'salon', name: 'Downtown Salon', connectedAccountRef: 'ML_MERCHANT_1' }]);
  runtime.addOffering({ issuerId: 'salon', offeringId: 'haircut', version: 'v1', name: 'Haircut', priceCents: 4900, components: { service: 'ent_salon' }, attestationCriteria: {} });

  const raw = JSON.stringify(squareEvent());
  const res = await runtime.handleSquareWebhook(raw, signSquareFixture(raw, SQUARE_KEY, SQUARE_URL));
  assert.equal(res.status, 'minted');
  assert.equal(count(runtime, 'SELECT count(*) c FROM receipts WHERE offering = ?', 'haircut@v1'), 1);
  assert.equal(fs.readdirSync(runtime.config.outboxDir).length, 1, 'the review link went to the Square buyer email');
  runtime.close();
});

test('Square webhook rejects a bad signature and ignores unrelated events; a refund is a reversal', async () => {
  const runtime = new PilotRuntime(tempConfig({ squareSignatureKey: SQUARE_KEY, squareNotificationUrl: SQUARE_URL }));
  runtime.createPartner({ partnerId: 'square', name: 'Square', kind: 'rail' });
  runtime.provisionMerchants('square', [{ issuerId: 'salon', name: 'Salon', connectedAccountRef: 'ML_MERCHANT_1' }]);
  runtime.addOffering({ issuerId: 'salon', offeringId: 'haircut', version: 'v1', name: 'Haircut', priceCents: 4900, components: { service: 'ent_salon' }, attestationCriteria: {} });

  const raw = JSON.stringify(squareEvent());
  await assert.rejects(() => runtime.handleSquareWebhook(raw, 'not-the-signature'), /signature verification failed/);

  const refundRaw = JSON.stringify(squareEvent({ event_id: 'sq_evt_2', status: 'REFUNDED', refunded: true }));
  await runtime.handleSquareWebhook(JSON.stringify(squareEvent({ event_id: 'sq_evt_0' })), signSquareFixture(JSON.stringify(squareEvent({ event_id: 'sq_evt_0' })), SQUARE_KEY, SQUARE_URL));
  const refund = await runtime.handleSquareWebhook(refundRaw, signSquareFixture(refundRaw, SQUARE_KEY, SQUARE_URL));
  assert.equal(refund.status, 'reversed');
  assert.equal(count(runtime, "SELECT count(*) c FROM pilot_corroborations WHERE kind = 'reversed'"), 1);
  runtime.close();
});

test('QuickBooks webhook: signature verified, entity enriched via the injected API, then minted', async () => {
  const runtime = new PilotRuntime(tempConfig({
    quickbooksVerifierToken: QBO_TOKEN,
    quickbooksEnrich: async (realmId, entityId) => ({
      amountCents: 25000, currency: 'USD', customerEmail: 'client@example.test',
      occurredAt: '2026-07-04T18:00:00Z', processorTxnId: entityId, connectedAccountRef: realmId,
    }),
  }));
  runtime.createPartner({ partnerId: 'quickbooks', name: 'QuickBooks', kind: 'platform' });
  runtime.provisionMerchants('quickbooks', [{ issuerId: 'consultant', name: 'Consultant LLC', connectedAccountRef: 'realm_1' }]);
  runtime.addOffering({ issuerId: 'consultant', offeringId: 'advisory', version: 'v1', name: 'Advisory', priceCents: 25000, components: { service: 'ent_consultant' }, attestationCriteria: {} });

  const payload = { eventNotifications: [{ realmId: 'realm_1', dataChangeEvent: { entities: [{ name: 'Payment', id: 'pmt_9', operation: 'Create', lastUpdated: '2026-07-04T18:00:00Z' }] } }] };
  const raw = JSON.stringify(payload);
  const res = await runtime.handleQuickBooksWebhook(raw, signQuickBooksFixture(raw, QBO_TOKEN));
  assert.equal(res.status, 'processed');
  assert.equal(res.count, 1);
  assert.equal(count(runtime, 'SELECT count(*) c FROM receipts WHERE offering = ?', 'advisory@v1'), 1);
  await assert.rejects(() => runtime.handleQuickBooksWebhook(raw, 'bad'), /signature verification failed/);
  runtime.close();
});

test('a Stripe sale and its QuickBooks record carrying the same processor id de-duplicate across connectors', async () => {
  // The cross-source case: QBO's payment references the originating Stripe id,
  // so both resolve to one canonical key — one receipt, one corroboration.
  const stripeId = 'pi_SHARED_1';
  const runtime = new PilotRuntime(tempConfig({
    stripeWebhookSecrets: { shop: 'whsec_shop' },
    quickbooksVerifierToken: QBO_TOKEN,
    quickbooksEnrich: async () => ({ amountCents: 4900, currency: 'USD', customerEmail: 'buyer@example.test', occurredAt: '2026-07-04T18:00:00Z', rail: 'stripe', processorTxnId: stripeId, connectedAccountRef: 'realm_shop' }),
  }));
  runtime.createIssuer({ issuerId: 'shop', name: 'Shop' });
  runtime.addOffering({ issuerId: 'shop', offeringId: 'thing', version: 'v1', name: 'Thing', priceCents: 4900, components: { service: 'ent_shop' }, attestationCriteria: {} });
  runtime.createPartner({ partnerId: 'quickbooks', name: 'QuickBooks', kind: 'platform' });
  runtime.linkIssuer({ partnerId: 'quickbooks', issuerId: 'shop', connectedAccountRef: 'realm_shop' });

  // Stripe mints (rail:stripe:pi_SHARED_1).
  const { signStripeFixture } = require('../../src/pilot/stripe');
  const stripeEvt = { id: 'evt_s1', type: 'checkout.session.completed', data: { object: { id: stripeId, amount_total: 4900, created: 1783188000, customer_details: { email: 'buyer@example.test' }, metadata: { audiencescore_issuer_id: 'shop', audiencescore_offering: 'thing@v1', audiencescore_role: 'participant' } } } };
  const sraw = JSON.stringify(stripeEvt);
  await runtime.handleStripeWebhook(sraw, signStripeFixture(sraw, 'whsec_shop', 1783188000));

  // QuickBooks reports the same payment id → corroborates, not re-mints.
  const qraw = JSON.stringify({ eventNotifications: [{ realmId: 'realm_shop', dataChangeEvent: { entities: [{ name: 'Payment', id: 'qbo_pmt', operation: 'Create' }] } }] });
  await runtime.handleQuickBooksWebhook(qraw, signQuickBooksFixture(qraw, QBO_TOKEN));

  assert.equal(count(runtime, 'SELECT count(*) c FROM receipts WHERE offering = ?', 'thing@v1'), 1, 'one receipt across two connectors');
  assert.equal(count(runtime, 'SELECT count(*) c FROM pilot_corroborations'), 1, 'the QuickBooks report corroborated the Stripe receipt');
  runtime.close();
});
