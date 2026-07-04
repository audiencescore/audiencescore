'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('../v02/store');
const { uuidv7, verifyReceipt } = require('../v02/receipts');
const { canonicalReceiptString } = require('../v02/canonical');
const { canonicalize, signPayload, publicKeyToString, verifyPayload } = require('../crypto');
const { renderOffering } = require('../v02/rendering');
const { generateHolderRoot, generateSalt, deriveHolderKeyPair, holderBinding } = require('../v02/holder');
const { loadOrCreatePayloadKey, createIssuerKey, loadIssuerKey, ensureDir } = require('./keyring');
const { deliverReceiptEmail } = require('./email');
const { verifyStripeWebhook, eventToTransaction } = require('./stripe');

const PILOT_ENV = 'pilot';

const PILOT_SCHEMA = `
CREATE TABLE IF NOT EXISTS pilot_issuers (
  issuer_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public_hex TEXT NOT NULL UNIQUE,
  stripe_account TEXT,
  email_from TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_offerings (
  offering TEXT PRIMARY KEY,
  issuer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_delivery_claims (
  token_hash TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_receipt_deliveries (
  tx_id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  offering TEXT NOT NULL,
  delivery_mode TEXT NOT NULL,
  delivery_ref TEXT,
  external_ref TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  signer TEXT NOT NULL,
  sig TEXT NOT NULL,
  logged_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  issuer_id TEXT,
  status TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);
`;

function defaultConfig(overrides = {}) {
  const dataDir = overrides.dataDir || process.env.AUDIENCESCORE_DATA_DIR || path.join(process.cwd(), '.audiencescore-pilot');
  const keysDir = overrides.keysDir || process.env.AUDIENCESCORE_KEYS_DIR || path.join(dataDir, 'keys');
  return {
    env: PILOT_ENV,
    dataDir,
    keysDir,
    dbPath: overrides.dbPath || process.env.AUDIENCESCORE_DB_PATH || path.join(dataDir, 'pilot.sqlite'),
    outboxDir: overrides.outboxDir || process.env.AUDIENCESCORE_OUTBOX_DIR || path.join(dataDir, 'outbox'),
    backupDir: overrides.backupDir || process.env.AUDIENCESCORE_BACKUP_DIR || path.join(dataDir, 'backups'),
    publicBaseUrl: (overrides.publicBaseUrl || process.env.AUDIENCESCORE_PUBLIC_BASE_URL || 'http://localhost:8080').replace(/\/$/, ''),
    emailMode: overrides.emailMode || process.env.AUDIENCESCORE_EMAIL_MODE || 'file',
    emailFrom: overrides.emailFrom || process.env.AUDIENCESCORE_EMAIL_FROM || 'pilot@audiencescore.org',
    smtpHost: overrides.smtpHost || process.env.AUDIENCESCORE_SMTP_HOST,
    smtpPort: overrides.smtpPort || process.env.AUDIENCESCORE_SMTP_PORT,
    smtpSecure: overrides.smtpSecure ?? process.env.AUDIENCESCORE_SMTP_SECURE === 'true',
    smtpStartTls: overrides.smtpStartTls ?? process.env.AUDIENCESCORE_SMTP_STARTTLS !== 'false',
    smtpUser: overrides.smtpUser || process.env.AUDIENCESCORE_SMTP_USER,
    smtpPassword: overrides.smtpPassword || process.env.AUDIENCESCORE_SMTP_PASSWORD,
    stripeWebhookSecrets: overrides.stripeWebhookSecrets || parseJsonEnv(process.env.AUDIENCESCORE_STRIPE_WEBHOOK_SECRETS_JSON, {}),
    port: Number(overrides.port || process.env.PORT || 8080),
  };
}

function parseJsonEnv(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error(`invalid JSON environment value: ${err.message}`);
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function randomHolderBinding(issuerPublicHex) {
  const root = generateHolderRoot();
  const salt = generateSalt();
  const derived = deriveHolderKeyPair(root, issuerPublicHex);
  return holderBinding(derived.publicHex, salt);
}

function receiptFromStoredRow(row) {
  if (!row) return null;
  return {
    spec: row.spec,
    receipt_id: row.receipt_id,
    issuer: row.issuer,
    holder: row.holder,
    role: row.role,
    offering: row.offering,
    level: row.level,
    event: row.event,
    issued_at: row.issued_at,
    prev: row.prev,
    ...(row.env ? { env: row.env } : {}),
    coattest: JSON.parse(row.coattest),
    sig: row.sig,
  };
}

function stripHolderFromInput(input) {
  return {
    ...input,
    reviews: input.reviews.map(({ holder, ...review }) => review),
    standings: input.standings.map(({ holder, ...standing }) => standing),
  };
}

class PilotRuntime {
  constructor(config = {}) {
    this.config = defaultConfig(config);
    ensureDir(this.config.dataDir);
    ensureDir(this.config.keysDir);
    ensureDir(this.config.outboxDir);
    this.store = new Store(this.config.dbPath);
    this.store.db.exec(PILOT_SCHEMA);
    this.renderingKey = loadOrCreatePayloadKey(this.config.keysDir, 'pilot-rendering');
    this.eventKey = loadOrCreatePayloadKey(this.config.keysDir, 'pilot-events');
  }

  close() {
    this.store.close();
  }

  createIssuer({ issuerId, name, stripeAccount = null, emailFrom = null }) {
    if (!issuerId || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(issuerId)) {
      throw new Error('issuer_id must be lowercase letters, numbers, underscore, or hyphen');
    }
    const key = createIssuerKey(this.config.keysDir, issuerId);
    this.store.db.prepare(
      'INSERT INTO pilot_issuers (issuer_id, name, public_hex, stripe_account, email_from, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(issuerId, name, key.publicHex, stripeAccount, emailFrom, new Date().toISOString());
    this.signPilotEvent('issuer_registered', { issuer_id: issuerId, public_hex: key.publicHex });
    return { issuerId, name, publicHex: key.publicHex, keyPath: key.keyPath };
  }

  addOffering({ issuerId, offeringId, version, name, priceCents, components, attestationCriteria = {} }) {
    const issuer = this.getIssuer(issuerId);
    this.store.declareOffering({
      offeringId,
      version,
      issuerPublicHex: issuer.public_hex,
      components,
      priceCents,
      attestationCriteria,
      declaredAt: new Date().toISOString(),
    });
    const offering = `${offeringId}@${version}`;
    this.store.db.prepare(
      'INSERT INTO pilot_offerings (offering, issuer_id, name, active, created_at) VALUES (?, ?, ?, 1, ?)',
    ).run(offering, issuerId, name, new Date().toISOString());
    this.signPilotEvent('offering_declared', { issuer_id: issuerId, offering });
    return { offering, issuerId, name };
  }

  getIssuer(issuerId) {
    const row = this.store.db.prepare('SELECT * FROM pilot_issuers WHERE issuer_id = ?').get(issuerId);
    if (!row) throw new Error(`unknown pilot issuer: ${issuerId}`);
    return row;
  }

  getOffering(offering) {
    const row = this.store.db.prepare('SELECT * FROM pilot_offerings WHERE offering = ? AND active = 1').get(offering);
    if (!row) throw new Error(`unknown active pilot offering: ${offering}`);
    return row;
  }

  signPilotEvent(type, body) {
    const loggedAt = new Date().toISOString();
    const eventBody = { env: PILOT_ENV, event_id: uuidv7(), type, logged_at: loggedAt, ...body };
    const signed = {
      body: eventBody,
      signer: publicKeyToString(this.eventKey.publicKey),
      sig: signPayload(this.eventKey.privateKey, eventBody),
    };
    this.store.db.prepare(
      'INSERT INTO pilot_events (event_id, type, body, signer, sig, logged_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(eventBody.event_id, type, JSON.stringify(eventBody), signed.signer, signed.sig, loggedAt);
    return signed;
  }

  async issueReceipt({ issuerId, offering, role = 'participant', amountCents, txId, externalRef = null, customerEmail = null, occurredAt = null }) {
    const issuerMeta = this.getIssuer(issuerId);
    const offeringMeta = this.getOffering(offering);
    if (offeringMeta.issuer_id !== issuerId) throw new Error(`${offering} is not registered to ${issuerId}`);
    const issuerKey = loadIssuerKey(this.config.keysDir, issuerId);
    const holder = randomHolderBinding(issuerKey.publicHex);
    const { receipt } = this.store.recordTransaction({
      issuer: issuerKey,
      holder,
      role,
      offering,
      txId,
      amountCents,
      occurredAt: occurredAt ?? new Date().toISOString(),
      env: PILOT_ENV,
    });
    const token = randomToken();
    const tokenHash = sha256(token);
    const claimUrl = `${this.config.publicBaseUrl}/claim/${token}`;
    this.store.db.prepare(
      'INSERT INTO pilot_delivery_claims (token_hash, receipt_id, created_at) VALUES (?, ?, ?)',
    ).run(tokenHash, receipt.receipt_id, new Date().toISOString());

    let delivery = { mode: 'none', file: null };
    if (customerEmail) {
      delivery = await deliverReceiptEmail(
        { ...this.config, emailFrom: issuerMeta.email_from || this.config.emailFrom },
        { to: customerEmail, receipt, claimUrl },
      );
    }
    this.store.db.prepare(
      'INSERT INTO pilot_receipt_deliveries (tx_id, receipt_id, issuer_id, offering, delivery_mode, delivery_ref, external_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(txId, receipt.receipt_id, issuerId, offering, delivery.mode, delivery.file ?? null, externalRef, new Date().toISOString());
    const event = this.signPilotEvent('receipt_issued', {
      issuer_id: issuerId,
      offering,
      receipt_id: receipt.receipt_id,
      tx_id: txId,
      delivery_mode: delivery.mode,
    });
    return { receipt, claimUrl, delivery, event };
  }

  async handleStripeWebhook(rawBody, signatureHeader) {
    const event = JSON.parse(rawBody);
    if (!['checkout.session.completed', 'invoice.paid'].includes(event.type)) {
      this.recordWebhook(event, null, 'ignored');
      return { status: 'ignored', event_id: event.id, type: event.type };
    }
    const verifiedIssuerId = verifyStripeWebhook(rawBody, signatureHeader, this.config.stripeWebhookSecrets);
    const tx = eventToTransaction(event, verifiedIssuerId);
    if (tx.issuerId !== verifiedIssuerId) throw new Error('Stripe metadata issuer does not match verified webhook secret');
    const existing = this.store.db.prepare(
      'SELECT * FROM pilot_webhook_events WHERE provider = ? AND event_id = ?',
    ).get('stripe', event.id);
    if (existing) return { status: 'duplicate', event_id: event.id };
    const issued = await this.issueReceipt(tx);
    this.recordWebhook(event, tx.issuerId, 'issued');
    return { status: 'issued', event_id: event.id, receipt: issued.receipt, claim_url: issued.claimUrl };
  }

  recordWebhook(event, issuerId, status) {
    this.store.db.prepare(
      'INSERT OR IGNORE INTO pilot_webhook_events (provider, event_id, issuer_id, status, received_at) VALUES (?, ?, ?, ?, ?)',
    ).run('stripe', event.id ?? uuidv7(), issuerId, status, new Date().toISOString());
  }

  presentedReceiptMatchesLedger(receipt) {
    if (!receipt) throw new Error('receipt is required');
    if (receipt.env !== PILOT_ENV) throw new Error('pilot receipt must include env: "pilot"');
    if (!verifyReceipt(receipt)) throw new Error('receipt signature does not verify');
    const stored = this.getStoredReceipt(receipt.receipt_id);
    if (!stored) throw new Error('receipt was not issued by this pilot ledger');
    if (canonicalReceiptString(stored) !== canonicalReceiptString(receipt)) {
      throw new Error('presented receipt does not match the pilot ledger');
    }
    return stored;
  }

  submitReviewWithReceipt({ receipt, review }) {
    const stored = this.presentedReceiptMatchesLedger(receipt);
    const result = this.store.submitReview({
      receiptId: stored.receipt_id,
      offering: stored.offering,
      overall: review.overall,
      facets: review.facets ?? {},
      text: review.text ?? null,
      postedAt: review.posted_at ?? new Date().toISOString(),
      env: PILOT_ENV,
    });
    const event = this.signPilotEvent('review_submitted', {
      review_id: result.reviewId,
      receipt_id: stored.receipt_id,
      offering: stored.offering,
      review_class: result.reviewClass,
    });
    return { env: PILOT_ENV, ...result, event };
  }

  submitReviewWithClaim({ token, review }) {
    const tokenHash = sha256(token);
    const claim = this.store.db.prepare('SELECT * FROM pilot_delivery_claims WHERE token_hash = ?').get(tokenHash);
    if (!claim) throw new Error('unknown or expired claim token');
    const receipt = this.getStoredReceipt(claim.receipt_id);
    return this.submitReviewWithReceipt({ receipt, review });
  }

  getStoredReceipt(receiptId) {
    return receiptFromStoredRow(this.store.db.prepare('SELECT * FROM receipts WHERE receipt_id = ?').get(receiptId));
  }

  signedScore(offering, windowEnd = new Date().toISOString()) {
    this.getOffering(offering);
    const rendered = { env: PILOT_ENV, ...renderOffering(this.store.renderingInput(offering, windowEnd)) };
    return {
      manifest: rendered,
      signer: publicKeyToString(this.renderingKey.publicKey),
      sig: signPayload(this.renderingKey.privateKey, rendered),
    };
  }

  renderingEvidence(offering, windowEnd = new Date().toISOString()) {
    this.getOffering(offering);
    const input = stripHolderFromInput(this.store.renderingInput(offering, windowEnd));
    return { env: PILOT_ENV, ...input };
  }

  verifySignedScore(signed) {
    return verifyPayload(signed.signer, signed.manifest, signed.sig);
  }

  recomputeFromEvidence(evidence) {
    return { env: PILOT_ENV, ...renderOffering(evidence) };
  }

  listPublicReceipts() {
    return this.store.db.prepare(
      'SELECT receipt_id, spec, issuer, role, offering, level, event, issued_at, prev, env, coattest, sig FROM receipts ORDER BY receipt_id',
    ).all().map(receiptFromStoredRow);
  }

  backup() {
    ensureDir(this.config.backupDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(this.config.backupDir, `audiencescore-pilot-${stamp}.sqlite`);
    fs.copyFileSync(this.config.dbPath, file);
    return { file };
  }
}

module.exports = {
  PILOT_ENV,
  PilotRuntime,
  defaultConfig,
  randomHolderBinding,
};
