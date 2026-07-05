'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('../v02/store');
const { uuidv7, verifyReceipt } = require('../v02/receipts');
const { canonicalReceiptString } = require('../v02/canonical');
const { signPayload, publicKeyToString, verifyPayload } = require('../crypto');
const { coattestReceipt } = require('../v02/signing');
const { renderOffering } = require('../v02/rendering');
const { generateHolderRoot, generateSalt, deriveHolderKeyPair, holderBinding } = require('../v02/holder');
const { loadOrCreatePayloadKey, createIssuerKey, loadIssuerKey, createPartnerKey, loadPartnerKey, ensureDir } = require('./keyring');
const { canonicalTxnKey } = require('./canonical-txn');
const { deliverReceiptEmail } = require('./email');
const { verifyStripeWebhook, eventToTransaction } = require('./stripe');
const { verifySquareWebhook, eventToTransaction: squareEventToTransaction } = require('./square');
const { verifyQuickBooksWebhook, paymentNotifications } = require('./quickbooks');

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
CREATE TABLE IF NOT EXISTS pilot_partners (
  partner_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  public_hex TEXT NOT NULL UNIQUE,
  auth_hash TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_partner_issuer_links (
  partner_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  connected_account_ref TEXT,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (partner_id, issuer_id)
);
CREATE TABLE IF NOT EXISTS pilot_txn_registry (
  tx_canonical_key TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  offering TEXT NOT NULL,
  minted_by TEXT NOT NULL,
  basis TEXT NOT NULL,
  first_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_corroborations (
  corroboration_id TEXT PRIMARY KEY,
  tx_canonical_key TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  source_partner_id TEXT NOT NULL,
  source_txn_ref TEXT,
  amount_cents INTEGER,
  kind TEXT NOT NULL,
  coattest TEXT,
  logged_at TEXT NOT NULL
);
-- A delivery lock, not a record: holding a row means "the review link for this
-- transaction is sent or in flight." The authoritative delivery lives in
-- pilot_receipt_deliveries. Rows are released on send failure so a later report
-- can retry, so this table is intentionally NOT append-only.
CREATE TABLE IF NOT EXISTS pilot_txn_deliveries (
  tx_canonical_key TEXT PRIMARY KEY,
  locked_at TEXT NOT NULL
);
-- One connected-account ref per partner, so a webhook's merchant id resolves to
-- exactly one issuer. (Multiple NULL refs are allowed for manually linked issuers.)
CREATE UNIQUE INDEX IF NOT EXISTS pilot_link_account_unique
  ON pilot_partner_issuer_links (partner_id, connected_account_ref);
-- Evidence and the signed event log are append-only: the dedup anchor, its
-- corroborations, and every signed pilot event can never be rewritten (mirrors
-- the ledger's I-5 immutability).
CREATE TRIGGER IF NOT EXISTS pilot_txn_registry_no_update BEFORE UPDATE ON pilot_txn_registry
BEGIN SELECT RAISE(ABORT, 'append-only: UPDATE forbidden on pilot_txn_registry'); END;
CREATE TRIGGER IF NOT EXISTS pilot_txn_registry_no_delete BEFORE DELETE ON pilot_txn_registry
BEGIN SELECT RAISE(ABORT, 'append-only: DELETE forbidden on pilot_txn_registry'); END;
CREATE TRIGGER IF NOT EXISTS pilot_corroborations_no_update BEFORE UPDATE ON pilot_corroborations
BEGIN SELECT RAISE(ABORT, 'append-only: UPDATE forbidden on pilot_corroborations'); END;
CREATE TRIGGER IF NOT EXISTS pilot_corroborations_no_delete BEFORE DELETE ON pilot_corroborations
BEGIN SELECT RAISE(ABORT, 'append-only: DELETE forbidden on pilot_corroborations'); END;
CREATE TRIGGER IF NOT EXISTS pilot_events_no_update BEFORE UPDATE ON pilot_events
BEGIN SELECT RAISE(ABORT, 'append-only: UPDATE forbidden on pilot_events'); END;
CREATE TRIGGER IF NOT EXISTS pilot_events_no_delete BEFORE DELETE ON pilot_events
BEGIN SELECT RAISE(ABORT, 'append-only: DELETE forbidden on pilot_events'); END;
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
    squareSignatureKey: overrides.squareSignatureKey || process.env.AUDIENCESCORE_SQUARE_SIGNATURE_KEY,
    squareNotificationUrl: overrides.squareNotificationUrl || process.env.AUDIENCESCORE_SQUARE_NOTIFICATION_URL,
    squarePartnerId: overrides.squarePartnerId || process.env.AUDIENCESCORE_SQUARE_PARTNER_ID || 'square',
    quickbooksVerifierToken: overrides.quickbooksVerifierToken || process.env.AUDIENCESCORE_QUICKBOOKS_VERIFIER_TOKEN,
    quickbooksPartnerId: overrides.quickbooksPartnerId || process.env.AUDIENCESCORE_QUICKBOOKS_PARTNER_ID || 'quickbooks',
    quickbooksEnrich: overrides.quickbooksEnrich || null,
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

// renderingInput carries each holder binding for internal standing math; the
// public /evidence endpoint must not, so strip it before returning (spec §7,
// the no-holder-directory rule). Rendered output never depends on holder, so a
// recompute from stripped evidence still matches the signed manifest.
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

  // ---- partners (platforms / protocols / marketplaces / merchants) ---------

  createPartner({ partnerId, name, kind = 'platform', scopes = ['issue', 'corroborate'] }) {
    if (!partnerId || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(partnerId)) {
      throw new Error('partner_id must be lowercase letters, numbers, underscore, or hyphen');
    }
    const key = createPartnerKey(this.config.keysDir, partnerId);
    const secret = randomToken();
    this.store.db.prepare(
      'INSERT INTO pilot_partners (partner_id, name, kind, public_hex, auth_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(partnerId, name, kind, key.publicHex, sha256(secret), JSON.stringify(scopes), new Date().toISOString());
    this.signPilotEvent('partner_registered', { partner_id: partnerId, kind, public_hex: key.publicHex });
    return { partnerId, name, kind, publicHex: key.publicHex, secret, scopes };
  }

  getPartner(partnerId) {
    const row = this.store.db.prepare('SELECT * FROM pilot_partners WHERE partner_id = ?').get(partnerId);
    if (!row) throw new Error(`unknown partner: ${partnerId}`);
    return row;
  }

  // Link a partner to one of our issuers, optionally keyed by the partner's
  // connected-account ref. A partner may link many issuers.
  linkIssuer({ partnerId, issuerId, connectedAccountRef = null }) {
    this.getPartner(partnerId);
    this.getIssuer(issuerId);
    this.store.db.prepare(
      'INSERT OR IGNORE INTO pilot_partner_issuer_links (partner_id, issuer_id, connected_account_ref, linked_at) VALUES (?, ?, ?, ?)',
    ).run(partnerId, issuerId, connectedAccountRef, new Date().toISOString());
    this.signPilotEvent('partner_issuer_linked', { partner_id: partnerId, issuer_id: issuerId, connected_account_ref: connectedAccountRef });
    return { partnerId, issuerId, connectedAccountRef };
  }

  authenticatePartner(partnerId, secret) {
    const row = this.getPartner(partnerId);
    const a = Buffer.from(sha256(String(secret ?? '')), 'hex');
    const b = Buffer.from(row.auth_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('partner authentication failed');
    return row;
  }

  resolveIssuerId(partner, event) {
    if (event.issuerId) return event.issuerId;
    if (event.connectedAccountRef) {
      const link = this.store.db.prepare(
        'SELECT issuer_id FROM pilot_partner_issuer_links WHERE partner_id = ? AND connected_account_ref = ?',
      ).get(partner.partner_id, event.connectedAccountRef);
      if (link) return link.issuer_id;
    }
    throw new Error('cannot resolve issuer: provide issuerId or a linked connectedAccountRef');
  }

  assertPartnerMayIssue(partner, issuerId) {
    if (!partner) return; // trusted internal / manual path
    const scopes = JSON.parse(partner.scopes);
    if (scopes.includes('issue_any')) return;
    const link = this.store.db.prepare(
      'SELECT 1 FROM pilot_partner_issuer_links WHERE partner_id = ? AND issuer_id = ?',
    ).get(partner.partner_id, issuerId);
    if (!link) throw new Error(`partner ${partner.partner_id} is not authorized to issue for ${issuerId}`);
  }

  // ---- ingestion spine: one path for every source --------------------------

  mintReceipt({ issuerId, offering, role, amountCents, txId, occurredAt }) {
    const issuerMeta = this.getIssuer(issuerId);
    const offeringMeta = this.getOffering(offering);
    if (offeringMeta.issuer_id !== issuerId) throw new Error(`${offering} is not registered to ${issuerId}`);
    const issuerKey = loadIssuerKey(this.config.keysDir, issuerId);
    const holder = randomHolderBinding(issuerKey.publicHex);
    const { receipt } = this.store.recordTransaction({
      issuer: issuerKey, holder, role, offering, txId, amountCents,
      occurredAt: occurredAt ?? new Date().toISOString(), env: PILOT_ENV,
    });
    return { receipt, issuerMeta };
  }

  createClaim(receiptId) {
    const token = randomToken();
    this.store.db.prepare(
      'INSERT INTO pilot_delivery_claims (token_hash, receipt_id, created_at) VALUES (?, ?, ?)',
    ).run(sha256(token), receiptId, new Date().toISOString());
    return { token, claimUrl: `${this.config.publicBaseUrl}/claim/${token}` };
  }

  // Deliver the review link at most once per canonical transaction, no matter
  // how many sources report it or which one carries the customer's contact.
  async deliverOnce(canonicalKey, { issuerMeta, issuerId, offering, receipt, claimUrl, customerEmail, externalRef = null }) {
    if (!customerEmail) return { mode: 'none', file: null };
    const lock = this.store.db.prepare(
      'INSERT OR IGNORE INTO pilot_txn_deliveries (tx_canonical_key, locked_at) VALUES (?, ?)',
    ).run(canonicalKey, new Date().toISOString());
    if (lock.changes === 0) return { mode: 'already_delivered', file: null };
    try {
      const delivery = await deliverReceiptEmail(
        { ...this.config, emailFrom: issuerMeta.email_from || this.config.emailFrom },
        { to: customerEmail, receipt, claimUrl },
      );
      this.store.db.prepare(
        'INSERT INTO pilot_receipt_deliveries (tx_id, receipt_id, issuer_id, offering, delivery_mode, delivery_ref, external_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(canonicalKey, receipt.receipt_id, issuerId, offering, delivery.mode, delivery.file ?? null, externalRef, new Date().toISOString());
      return delivery;
    } catch (err) {
      // Delivery is best-effort: release the lock so a later report of the same
      // sale can retry, and never fail ingestion because an email send failed.
      this.store.db.prepare('DELETE FROM pilot_txn_deliveries WHERE tx_canonical_key = ?').run(canonicalKey);
      return { mode: 'deferred', error: err.message };
    }
  }

  /**
   * The one path every transaction takes — manual, Stripe, or a platform
   * POSTing to /v1/transactions. Computes the canonical key, then MINTS (first
   * source wins the single review-right) or CORROBORATES (later sources
   * strengthen the same receipt; never a second one).
   */
  async ingestTransaction(event, { partner = null } = {}) {
    const issuerId = partner ? this.resolveIssuerId(partner, event) : event.issuerId;
    this.assertPartnerMayIssue(partner, issuerId);
    const offering = event.offering;
    this.getOffering(offering);
    const role = event.role || 'participant';
    const amountCents = Number(event.amountCents);
    if (event.kind !== 'reversal' && (!Number.isInteger(amountCents) || amountCents <= 0)) {
      throw new Error('amountCents must be a positive integer: an L1 receipt requires value to have moved');
    }
    const occurredAt = event.occurredAt || new Date().toISOString();
    const customerEmail = event.customerEmail || null;
    const { key: canonicalKey, basis } = canonicalTxnKey({
      issuerId, rail: event.rail, processorTxnId: event.processorTxnId,
      amountCents, currency: event.currency, occurredAt, customerContact: customerEmail,
    });
    const sourceId = partner ? partner.partner_id : 'manual';
    const existing = this.store.db.prepare(
      'SELECT * FROM pilot_txn_registry WHERE tx_canonical_key = ?',
    ).get(canonicalKey);

    if (event.kind === 'reversal') {
      if (!existing) return { status: 'reversal_no_match', canonicalKey };
      return this.corroborate({ existing, canonicalKey, partner, sourceId, event, kind: 'reversed', issuerId, offering, customerEmail: null });
    }
    if (existing) {
      return this.corroborate({ existing, canonicalKey, partner, sourceId, event, kind: 'corroborates', issuerId, offering, customerEmail });
    }

    const { receipt, issuerMeta } = this.mintReceipt({ issuerId, offering, role, amountCents, txId: canonicalKey, occurredAt });
    this.store.db.prepare(
      'INSERT INTO pilot_txn_registry (tx_canonical_key, receipt_id, issuer_id, offering, minted_by, basis, first_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(canonicalKey, receipt.receipt_id, issuerId, offering, sourceId, basis, new Date().toISOString());
    const { claimUrl } = this.createClaim(receipt.receipt_id);
    const delivery = await this.deliverOnce(canonicalKey, { issuerMeta, issuerId, offering, receipt, claimUrl, customerEmail, externalRef: event.processorTxnId || null });
    const evt = this.signPilotEvent('receipt_issued', {
      issuer_id: issuerId, offering, receipt_id: receipt.receipt_id,
      tx_canonical_key: canonicalKey, minted_by: sourceId, basis, delivery_mode: delivery.mode,
    });
    return { status: 'minted', receipt, claimUrl, canonicalKey, basis, delivery, event: evt };
  }

  async corroborate({ existing, canonicalKey, partner, sourceId, event, kind, issuerId, offering, customerEmail }) {
    const receipt = this.getStoredReceipt(existing.receipt_id);
    // A corroboration is a partner signature over the SAME canonical receipt
    // bytes the issuer signed — verifiable later against the partner's key.
    const coattest = partner ? coattestReceipt(receipt, loadPartnerKey(this.config.keysDir, partner.partner_id).privateKey) : null;
    this.store.db.prepare(
      'INSERT INTO pilot_corroborations (corroboration_id, tx_canonical_key, receipt_id, source_partner_id, source_txn_ref, amount_cents, kind, coattest, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(uuidv7(), canonicalKey, receipt.receipt_id, sourceId, event.processorTxnId || null,
      event.amountCents != null ? Number(event.amountCents) : null, kind, coattest, new Date().toISOString());
    let delivery = { mode: 'none', file: null };
    if (kind === 'corroborates' && customerEmail) {
      const issuerMeta = this.getIssuer(issuerId);
      const { claimUrl } = this.createClaim(receipt.receipt_id);
      delivery = await this.deliverOnce(canonicalKey, { issuerMeta, issuerId, offering, receipt, claimUrl, customerEmail, externalRef: event.processorTxnId || null });
    }
    const evt = this.signPilotEvent('transaction_corroborated', {
      tx_canonical_key: canonicalKey, receipt_id: receipt.receipt_id, source: sourceId, kind,
    });
    return { status: kind === 'reversed' ? 'reversed' : 'corroborated', receipt, canonicalKey, delivery, event: evt };
  }

  // Manual issuance is ingest through a trusted internal source: rail "manual"
  // plus the external reference forms a stable canonical key, so a re-submitted
  // invoice de-duplicates like any other source.
  async issueReceipt({ issuerId, offering, role = 'participant', amountCents, txId = null, externalRef = null, customerEmail = null, occurredAt = null }) {
    const res = await this.ingestTransaction({
      issuerId, offering, role, amountCents,
      rail: 'manual', processorTxnId: externalRef || txId,
      currency: 'usd', occurredAt, customerEmail, kind: 'transaction',
    }, { partner: null });
    return { receipt: res.receipt, claimUrl: res.claimUrl, delivery: res.delivery, event: res.event, status: res.status, canonicalKey: res.canonicalKey };
  }

  async handleStripeWebhook(rawBody, signatureHeader) {
    // Verify the signature before parsing, filtering, or writing anything —
    // an unsigned body must never touch the database (no bookkeeping row, no
    // event-id reservation that could pre-empt a later legitimate event).
    const verifiedIssuerId = verifyStripeWebhook(rawBody, signatureHeader, this.config.stripeWebhookSecrets);
    const event = JSON.parse(rawBody);
    if (!['checkout.session.completed', 'invoice.paid'].includes(event.type)) {
      return { status: 'ignored', event_id: event.id, type: event.type };
    }
    const tx = eventToTransaction(event, verifiedIssuerId);
    if (tx.issuerId !== verifiedIssuerId) throw new Error('Stripe metadata issuer does not match verified webhook secret');
    if (this.webhookSeen('stripe', event.id)) return { status: 'duplicate', event_id: event.id };
    const res = await this.ingestTransaction({
      issuerId: tx.issuerId, offering: tx.offering, role: tx.role, amountCents: tx.amountCents,
      rail: 'stripe', processorTxnId: tx.externalRef, currency: 'usd',
      occurredAt: tx.occurredAt, customerEmail: tx.customerEmail, kind: 'transaction',
    }, { partner: null });
    this.recordWebhookEvent('stripe', event.id, tx.issuerId, res.status);
    return { status: res.status === 'minted' ? 'issued' : res.status, event_id: event.id, receipt: res.receipt, claim_url: res.claimUrl };
  }

  recordWebhookEvent(provider, eventId, issuerId, status) {
    this.store.db.prepare(
      'INSERT OR IGNORE INTO pilot_webhook_events (provider, event_id, issuer_id, status, received_at) VALUES (?, ?, ?, ?, ?)',
    ).run(provider, eventId ?? uuidv7(), issuerId, status, new Date().toISOString());
  }

  webhookSeen(provider, eventId) {
    if (!eventId) return false;
    return !!this.store.db.prepare('SELECT 1 FROM pilot_webhook_events WHERE provider = ? AND event_id = ?').get(provider, eventId);
  }

  // ---- platform onboarding + POS/accounting connectors ---------------------

  // Provision a platform's merchants in one call: create each issuer if new and
  // link it to the partner. The platform's OAuth callback passes its roster.
  provisionMerchants(partnerId, merchants) {
    this.getPartner(partnerId);
    const provisioned = merchants.map((m) => {
      const exists = this.store.db.prepare('SELECT 1 FROM pilot_issuers WHERE issuer_id = ?').get(m.issuerId);
      if (!exists) this.createIssuer({ issuerId: m.issuerId, name: m.name, emailFrom: m.emailFrom ?? null });
      this.linkIssuer({ partnerId, issuerId: m.issuerId, connectedAccountRef: m.connectedAccountRef ?? null });
      return { issuerId: m.issuerId, created: !exists, connectedAccountRef: m.connectedAccountRef ?? null };
    });
    this.signPilotEvent('merchants_provisioned', { partner_id: partnerId, count: provisioned.length });
    return { partnerId, provisioned };
  }

  // The Square merchant_id (or QBO realmId) that a webhook carries maps to a
  // connected-account ref; the offering is the merchant's single active one.
  // Multi-offering merchants need an explicit product→offering map (future).
  resolveDefaultOffering(issuerId) {
    const rows = this.store.db.prepare('SELECT offering FROM pilot_offerings WHERE issuer_id = ? AND active = 1').all(issuerId);
    if (rows.length === 1) return rows[0].offering;
    if (rows.length === 0) throw new Error(`issuer ${issuerId} has no active offering`);
    throw new Error(`issuer ${issuerId} has ${rows.length} active offerings; the connector must map the sale to one`);
  }

  async handleSquareWebhook(rawBody, signatureHeader) {
    verifySquareWebhook(rawBody, signatureHeader, this.config.squareSignatureKey, this.config.squareNotificationUrl);
    const event = JSON.parse(rawBody);
    if (this.webhookSeen('square', event.event_id)) return { status: 'duplicate', event_id: event.event_id };
    const normalized = squareEventToTransaction(event);
    if (!normalized) {
      this.recordWebhookEvent('square', event.event_id, null, 'ignored');
      return { status: 'ignored', event_id: event.event_id, type: event.type };
    }
    const partner = this.getPartner(this.config.squarePartnerId);
    const issuerId = this.resolveIssuerId(partner, normalized);
    const offering = this.resolveDefaultOffering(issuerId);
    const res = await this.ingestTransaction({ ...normalized, issuerId, offering }, { partner });
    this.recordWebhookEvent('square', event.event_id, issuerId, res.status);
    return { status: res.status, event_id: event.event_id, receipt: res.receipt, claim_url: res.claimUrl };
  }

  async handleQuickBooksWebhook(rawBody, signatureHeader) {
    verifyQuickBooksWebhook(rawBody, signatureHeader, this.config.quickbooksVerifierToken);
    if (typeof this.config.quickbooksEnrich !== 'function') throw new Error('QuickBooks enrichment is not configured');
    const partner = this.getPartner(this.config.quickbooksPartnerId);
    const results = [];
    for (const note of paymentNotifications(JSON.parse(rawBody))) {
      // QBO webhooks have no delivery id; dedup on the entity change itself so a
      // retry does not re-enrich (an API call) or append another corroboration.
      const noteId = `${note.realmId}:${note.entityId}:${note.lastUpdated ?? ''}`;
      if (this.webhookSeen('quickbooks', noteId)) continue;
      const enriched = await this.config.quickbooksEnrich(note.realmId, note.entityId);
      // Use the deepest known rail identity: when QuickBooks records that the
      // payment cleared through Stripe/Square, that originating id (not the QBO
      // entity id) is what lets this report collapse onto the same canonical
      // transaction the payment rail already minted.
      const normalized = {
        rail: enriched.rail || 'quickbooks',
        processorTxnId: enriched.processorTxnId || note.entityId,
        connectedAccountRef: enriched.connectedAccountRef || note.realmId,
        amountCents: enriched.amountCents,
        currency: enriched.currency || 'USD',
        customerEmail: enriched.customerEmail || null,
        occurredAt: enriched.occurredAt || null,
        kind: enriched.kind || 'transaction',
      };
      const issuerId = this.resolveIssuerId(partner, normalized);
      const offering = enriched.offering || this.resolveDefaultOffering(issuerId);
      const res = await this.ingestTransaction({ ...normalized, issuerId, offering }, { partner });
      this.recordWebhookEvent('quickbooks', noteId, issuerId, res.status);
      results.push(res);
    }
    return { status: 'processed', count: results.length };
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
