'use strict';

const crypto = require('node:crypto');
const { publicKeyFromHex } = require('../v02/signing');

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

function sha256hex(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

function canonicalPartnerRequest({ method, path, body, timestamp, nonce }) {
  return [
    String(method || '').toUpperCase(),
    String(path || ''),
    String(timestamp || ''),
    String(nonce || ''),
    sha256hex(body || ''),
  ].join('\n');
}

function signatureHex(signature) {
  const raw = String(signature || '').trim();
  return raw.startsWith('ed25519:') ? raw.slice('ed25519:'.length) : raw;
}

function signPartnerRequest(privateKey, request) {
  return crypto.sign(null, Buffer.from(canonicalPartnerRequest(request), 'utf8'), privateKey).toString('hex');
}

function verifyPartnerRequest(partner, request, { now = Date.now(), toleranceMs = DEFAULT_TOLERANCE_MS } = {}) {
  if (!partner) throw new Error('partner authentication failed');
  const { timestamp, nonce, signature } = request;
  if (!timestamp || !nonce || !signature) throw new Error('partner request signature headers are required');
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(String(nonce))) throw new Error('partner nonce is malformed');
  const ts = Date.parse(timestamp);
  if (Number.isNaN(ts)) throw new Error('partner timestamp must be RFC3339');
  if (Math.abs(now - ts) > toleranceMs) throw new Error('partner request timestamp is outside the replay window');
  const sig = signatureHex(signature);
  if (!/^[0-9a-f]{128}$/.test(sig)) throw new Error('partner request signature is malformed');
  const ok = crypto.verify(
    null,
    Buffer.from(canonicalPartnerRequest(request), 'utf8'),
    publicKeyFromHex(partner.public_hex),
    Buffer.from(sig, 'hex'),
  );
  if (!ok) throw new Error('partner request signature verification failed');
  return true;
}

module.exports = {
  DEFAULT_TOLERANCE_MS,
  canonicalPartnerRequest,
  signPartnerRequest,
  verifyPartnerRequest,
};
