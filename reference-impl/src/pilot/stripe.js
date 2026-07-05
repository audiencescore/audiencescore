'use strict';

const crypto = require('node:crypto');

function parseStripeSignature(header) {
  const out = {};
  for (const part of String(header ?? '').split(',')) {
    const [k, v] = part.split('=');
    if (!k || !v) continue;
    if (k === 'v1') out.v1 = [...(out.v1 ?? []), v];
    else out[k] = v;
  }
  return out;
}

function timingSafeHexEqual(a, b) {
  const aa = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

const DEFAULT_TOLERANCE_SECONDS = 300;

function verifyStripeWebhook(rawBody, header, secretsByIssuer, { now = Date.now(), toleranceSeconds = DEFAULT_TOLERANCE_SECONDS } = {}) {
  const parsed = parseStripeSignature(header);
  if (!parsed.t || !parsed.v1 || parsed.v1.length === 0) throw new Error('missing Stripe-Signature timestamp or v1 signature');
  const ts = Number(parsed.t);
  if (!Number.isInteger(ts)) throw new Error('Stripe-Signature timestamp is invalid');
  if (Math.abs(Math.floor(now / 1000) - ts) > toleranceSeconds) throw new Error('Stripe webhook timestamp is outside the replay window');
  const signed = `${parsed.t}.${rawBody}`;
  for (const [issuerId, secret] of Object.entries(secretsByIssuer)) {
    if (!secret) continue;
    const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
    if (parsed.v1.some((sig) => timingSafeHexEqual(sig, expected))) return issuerId;
  }
  throw new Error('Stripe webhook signature verification failed');
}

function signStripeFixture(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function eventToTransaction(event, fallbackIssuerId = null) {
  const object = event && event.data && event.data.object;
  if (!object) throw new Error('Stripe event missing data.object');
  const metadata = object.metadata ?? {};
  const issuerId = metadata.audiencescore_issuer_id || fallbackIssuerId;
  const offering = metadata.audiencescore_offering || metadata.offering;
  const role = metadata.audiencescore_role || 'participant';
  const amountCents = Number(object.amount_total ?? object.amount_paid ?? object.total ?? 0);
  const customerEmail = object.customer_details?.email || object.customer_email || object.customer?.email || object.billing_details?.email || null;
  const created = object.created ? new Date(Number(object.created) * 1000).toISOString() : new Date().toISOString();
  if (!issuerId) throw new Error('Stripe event missing audiencescore_issuer_id metadata');
  if (!offering) throw new Error('Stripe event missing audiencescore_offering metadata');
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error('Stripe event missing amount');
  return {
    issuerId,
    offering,
    role,
    amountCents,
    customerEmail,
    txId: `stripe:${object.id}`,
    externalRef: object.id,
    occurredAt: created,
  };
}

module.exports = { verifyStripeWebhook, signStripeFixture, eventToTransaction, DEFAULT_TOLERANCE_SECONDS };
