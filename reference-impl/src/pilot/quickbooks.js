'use strict';

// QuickBooks Online connector: a producer for the ingestion spine.
//
// Intuit signs each webhook with HMAC-SHA256 over the raw body using the
// endpoint's verifier token, base64, in the intuit-signature header. Unlike
// Stripe/Square, a QBO webhook carries only entity ids (realmId + Payment id),
// not amounts or emails — so the handler enriches each notification through the
// QBO API before ingesting. That enrichment is injected (a real API call in
// production, a stub in tests), keeping this module a pure verify-and-parse.

const crypto = require('node:crypto');

function timingSafeEqualB64(a, b) {
  const aa = Buffer.from(String(a), 'base64');
  const bb = Buffer.from(String(b), 'base64');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

/** Verify a QuickBooks webhook signature. Returns true, or throws on mismatch. */
function verifyQuickBooksWebhook(rawBody, signatureHeader, verifierToken) {
  if (!verifierToken) throw new Error('QuickBooks webhook needs a verifier token');
  const expected = crypto.createHmac('sha256', verifierToken).update(rawBody).digest('base64');
  if (!signatureHeader || !timingSafeEqualB64(signatureHeader, expected)) {
    throw new Error('QuickBooks webhook signature verification failed');
  }
  return true;
}

/** Test helper: the signature Intuit would send for a body + verifier token. */
function signQuickBooksFixture(rawBody, verifierToken) {
  return crypto.createHmac('sha256', verifierToken).update(rawBody).digest('base64');
}

/**
 * Parse an Intuit event payload into the paid-Payment notifications worth
 * enriching: created or updated Payment entities, each identified by its
 * company (realmId) and entity id.
 */
function paymentNotifications(payload) {
  const out = [];
  for (const notification of payload?.eventNotifications ?? []) {
    const realmId = notification.realmId;
    for (const entity of notification.dataChangeEvent?.entities ?? []) {
      if (entity.name !== 'Payment') continue;
      if (!['Create', 'Update'].includes(entity.operation)) continue;
      out.push({ realmId, entityId: entity.id, operation: entity.operation, lastUpdated: entity.lastUpdated ?? null });
    }
  }
  return out;
}

module.exports = { verifyQuickBooksWebhook, signQuickBooksFixture, paymentNotifications };
