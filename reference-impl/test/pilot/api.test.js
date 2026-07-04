'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canonicalize } = require('../../src/crypto');
const { PilotRuntime } = require('../../src/pilot/runtime');
const { createServer } = require('../../src/pilot/server');
const { signStripeFixture } = require('../../src/pilot/stripe');
const { generateKeyPair } = require('../../src/v02/signing');
const { buildReceipt } = require('../../src/v02/receipts');
const { randomHolderBinding } = require('../../src/pilot/runtime');

const FIXED_WINDOW = '2026-07-05T00:00:00Z';

function tempConfig(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-pilot-'));
  return {
    dataDir: dir,
    keysDir: path.join(dir, 'keys'),
    dbPath: path.join(dir, 'pilot.sqlite'),
    outboxDir: path.join(dir, 'outbox'),
    backupDir: path.join(dir, 'backups'),
    publicBaseUrl: 'http://127.0.0.1:0',
    emailMode: 'file',
    ...extra,
  };
}

function setup(runtime) {
  runtime.createIssuer({ issuerId: 'field-elevate-pilot', name: 'Field Elevate Pilot' });
  runtime.addOffering({
    issuerId: 'field-elevate-pilot',
    offeringId: 'field-elevate-demo',
    version: 'v1',
    name: 'Field Elevate Pilot Offering',
    priceCents: 10000,
    components: { service: 'ent_field_elevate_service' },
    attestationCriteria: { l2: 'service delivered' },
  });
}

async function listen(runtime) {
  const server = createServer(runtime);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json();
  return { res, body };
}

test('pilot manual issuance, review submission, signed score, and abuse cases', async (t) => {
  const runtime = new PilotRuntime(tempConfig());
  setup(runtime);
  const { server, base } = await listen(runtime);
  t.after(() => {
    server.close();
    runtime.close();
  });

  const issued = await runtime.issueReceipt({
    issuerId: 'field-elevate-pilot',
    offering: 'field-elevate-demo@v1',
    amountCents: 10000,
    txId: 'manual:inv_001',
    externalRef: 'inv_001',
    customerEmail: 'customer@example.test',
    occurredAt: '2026-07-04T12:00:00Z',
  });
  assert.equal(issued.receipt.env, 'pilot');
  assert.equal(fs.readdirSync(runtime.config.outboxDir).length, 1, 'delivery email is written to pilot outbox');

  const submitted = await jsonFetch(`${base}/v0/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ receipt: issued.receipt, review: { overall: 5, text: 'Pilot worked.' } }),
  });
  assert.equal(submitted.res.status, 201);
  assert.equal(submitted.body.env, 'pilot');
  assert.equal(submitted.body.event.body.env, 'pilot');

  const reuse = await jsonFetch(`${base}/v0/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ receipt: issued.receipt, review: { overall: 4 } }),
  });
  assert.equal(reuse.res.status, 409);

  const noReceipt = await jsonFetch(`${base}/v0/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ review: { overall: 5 } }),
  });
  assert.equal(noReceipt.res.status, 400);

  const signed = await jsonFetch(`${base}/v0/scores/field-elevate-demo%40v1?window_end=${encodeURIComponent(FIXED_WINDOW)}`);
  assert.equal(signed.res.status, 200);
  assert.equal(signed.body.manifest.env, 'pilot');
  assert.equal(runtime.verifySignedScore(signed.body), true);

  const evidence = await jsonFetch(`${base}/v0/scores/field-elevate-demo%40v1/evidence?window_end=${encodeURIComponent(FIXED_WINDOW)}`);
  assert.equal(evidence.res.status, 200);
  const recomputed = runtime.recomputeFromEvidence(evidence.body);
  assert.equal(canonicalize(recomputed), canonicalize(signed.body.manifest));

  const copy = await fetch(`${base}/docs/copy-to-llm`).then((r) => r.text());
  assert.match(copy, /Copy To LLM/);
  assert.match(copy, /\/v0\/reviews/);
});

test('pilot Stripe test webhook issues an L1 receipt once', async () => {
  const secret = 'whsec_test_fixture';
  const runtime = new PilotRuntime(tempConfig({
    stripeWebhookSecrets: { 'field-elevate-pilot': secret },
  }));
  setup(runtime);
  const { server, base } = await listen(runtime);
  try {
    const event = {
      id: 'evt_test_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_001',
          amount_total: 10000,
          created: 1783180800,
          customer_details: { email: 'stripe-customer@example.test' },
          metadata: {
            audiencescore_issuer_id: 'field-elevate-pilot',
            audiencescore_offering: 'field-elevate-demo@v1',
            audiencescore_role: 'participant',
          },
        },
      },
    };
    const raw = JSON.stringify(event);
    const first = await jsonFetch(`${base}/v0/stripe/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signStripeFixture(raw, secret, 1783180800) },
      body: raw,
    });
    assert.equal(first.res.status, 200);
    assert.equal(first.body.status, 'issued');
    assert.equal(first.body.receipt.env, 'pilot');
    assert.equal(first.body.receipt.level, 1);

    const duplicate = await jsonFetch(`${base}/v0/stripe/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signStripeFixture(raw, secret, 1783180800) },
      body: raw,
    });
    assert.equal(duplicate.res.status, 200);
    assert.equal(duplicate.body.status, 'duplicate');
  } finally {
    server.close();
    runtime.close();
  }
});

test('pilot review endpoint rejects a stored receipt signed by a non-declared issuer', async () => {
  const runtime = new PilotRuntime(tempConfig());
  setup(runtime);
  const { server, base } = await listen(runtime);
  try {
    const wrong = generateKeyPair();
    const receipt = buildReceipt({
      issuerPrivateKey: wrong.privateKey,
      issuerPublicHex: wrong.publicHex,
      holder: randomHolderBinding(wrong.publicHex),
      role: 'participant',
      offering: 'field-elevate-demo@v1',
      level: 1,
      event: 'paid',
      issuedAt: '2026-07-04T12:00:00Z',
      env: 'pilot',
    });
    runtime.store.db.prepare(
      `INSERT INTO receipts (receipt_id, spec, issuer, holder, role, offering, level, event, issued_at, prev, env, coattest, sig)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(receipt.receipt_id, receipt.spec, receipt.issuer, receipt.holder, receipt.role, receipt.offering,
      receipt.level, receipt.event, receipt.issued_at, receipt.prev, receipt.env, JSON.stringify(receipt.coattest), receipt.sig);

    const res = await jsonFetch(`${base}/v0/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ receipt, review: { overall: 5 } }),
    });
    assert.equal(res.res.status, 400);
    assert.match(res.body.error, /declared issuer/);
  } finally {
    server.close();
    runtime.close();
  }
});
