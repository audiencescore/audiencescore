'use strict';

// Square connector: a producer for the ingestion spine (runtime.ingestTransaction).
// Square signs each webhook with HMAC-SHA256 over (notificationUrl + rawBody),
// base64, in the x-square-hmacsha256-signature header. A payment.updated event
// carries the amount and, when present, the buyer's email — enough to both
// prove the sale and deliver the review link. The merchant is resolved to one
// of our issuers by its Square merchant_id (a connected-account ref).

const crypto = require('node:crypto');

function timingSafeEqualB64(a, b) {
  const aa = Buffer.from(String(a), 'base64');
  const bb = Buffer.from(String(b), 'base64');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

/** Verify a Square webhook signature. Returns true, or throws on mismatch. */
function verifySquareWebhook(rawBody, signatureHeader, signatureKey, notificationUrl) {
  if (!signatureKey || !notificationUrl) throw new Error('Square webhook needs a signature key and notification URL');
  const expected = crypto.createHmac('sha256', signatureKey).update(notificationUrl + rawBody).digest('base64');
  if (!signatureHeader || !timingSafeEqualB64(signatureHeader, expected)) {
    throw new Error('Square webhook signature verification failed');
  }
  return true;
}

/** Test helper: the signature Square would send for a body + config. */
function signSquareFixture(rawBody, signatureKey, notificationUrl) {
  return crypto.createHmac('sha256', signatureKey).update(notificationUrl + rawBody).digest('base64');
}

/**
 * Normalize a Square payment.updated event into an ingestion event. A COMPLETED
 * payment is a transaction; a refund is a reversal. The issuer is resolved
 * downstream from connectedAccountRef (the Square merchant_id).
 */
function eventToTransaction(event) {
  if (event?.type !== 'payment.updated') return null;
  const payment = event?.data?.object?.payment;
  if (!payment) throw new Error('Square payment.updated event missing data.object.payment');
  const money = payment.amount_money ?? {};
  const amountCents = Number(money.amount ?? 0);
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error('Square payment missing an integer amount');
  const refunded = payment.status === 'REFUNDED' || (payment.refunded_money?.amount ?? 0) > 0;
  return {
    connectedAccountRef: event.merchant_id,
    rail: 'square',
    processorTxnId: payment.id,
    amountCents,
    currency: money.currency ?? 'USD',
    customerEmail: payment.buyer_email_address ?? null,
    occurredAt: payment.created_at ?? null,
    kind: refunded ? 'reversal' : 'transaction',
  };
}

module.exports = { verifySquareWebhook, signSquareFixture, eventToTransaction };
