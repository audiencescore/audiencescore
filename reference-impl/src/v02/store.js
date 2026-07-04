'use strict';

// The v0.2 store: SQLite via node:sqlite (built into Node ≥ 23.4, no npm
// package), with append-only enforcement INSIDE the storage engine.
//
// Every ledger table carries BEFORE UPDATE / BEFORE DELETE triggers that
// abort the statement, so mutation is refused by SQLite itself even for raw
// SQL through the application's connection — not avoided by code convention
// (I-5, AT-19). SQLite has no user/role system; a production deployment on a
// server database must additionally run the application under a role with no
// UPDATE/DELETE grants. The I-5 health check alarms if these triggers are
// ever missing.
//
// Issuance rule (spec §4, T-4, AT-8): recording a transaction and issuing its
// L1 receipt are ONE atomic storage operation with no discretionary path —
// there is no API, flag, or code path through which an issuer can record a
// transaction and skip the receipt. This module contains the only INSERT
// into the transactions table.
//
// Privacy floor (spec §7, AT-24): no public method takes a holder binding
// and returns what that holder participated in. Holder bindings are used
// internally only to enforce standing rules; there is no holder→offering
// directory, query, or export.

const { DatabaseSync } = require('node:sqlite');
const {
  RECEIPT_SPEC,
  ROLES,
  PAYER_MAX_LEVEL,
  uuidv7,
  buildReceipt,
  verifyReceipt,
  ascensionError,
} = require('./receipts');
const { canonicalize } = require('../crypto');

const APPEND_ONLY_TABLES = ['offerings', 'transactions', 'receipts', 'reviews', 'protocol_events', 'publications'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS offerings (
  offering_id TEXT NOT NULL,
  version TEXT NOT NULL,
  issuer TEXT NOT NULL,
  components TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  attestation_criteria TEXT NOT NULL,
  declared_at TEXT NOT NULL,
  PRIMARY KEY (offering_id, version)
);
CREATE TABLE IF NOT EXISTS transactions (
  tx_id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  offering TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS receipts (
  receipt_id TEXT PRIMARY KEY,
  spec TEXT NOT NULL,
  issuer TEXT NOT NULL,
  holder TEXT NOT NULL,
  role TEXT NOT NULL,
  offering TEXT NOT NULL,
  level INTEGER NOT NULL,
  event TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  prev TEXT,
  coattest TEXT NOT NULL,
  sig TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  review_id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL,
  offering TEXT NOT NULL,
  overall INTEGER NOT NULL,
  facets TEXT NOT NULL,
  text TEXT,
  role_at_post TEXT NOT NULL,
  level_at_post INTEGER NOT NULL,
  review_class TEXT NOT NULL,
  posted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS protocol_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  logged_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publications (
  pub_id TEXT PRIMARY KEY,
  rendering_version TEXT NOT NULL,
  subject TEXT NOT NULL,
  window_end TEXT NOT NULL,
  manifest TEXT NOT NULL
);
`;

function appendOnlyTriggers() {
  return APPEND_ONLY_TABLES.map((table) => `
CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, 'append-only: UPDATE forbidden on ${table} (I-5)'); END;
CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, 'append-only: DELETE forbidden on ${table} (I-5)'); END;`).join('\n');
}

class Store {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.db.exec(appendOnlyTriggers());
  }

  close() {
    this.db.close();
  }

  // ---- catalog -------------------------------------------------------------

  /** Declare an offering-version: its component entities, price, and the
   *  PUBLISHED criteria under which L2/L3 attestations issue (T-7). */
  declareOffering({ offeringId, version, issuerPublicHex, components, priceCents, attestationCriteria, declaredAt }) {
    if (!Number.isInteger(priceCents) || priceCents < 0) throw new Error('price_cents must be a non-negative integer');
    if (!components || typeof components !== 'object' || Object.keys(components).length === 0) {
      throw new Error('an offering must declare at least one component entity');
    }
    this.db.prepare(
      'INSERT INTO offerings (offering_id, version, issuer, components, price_cents, attestation_criteria, declared_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(offeringId, version, `ed25519:${issuerPublicHex}`, JSON.stringify(components), priceCents,
      JSON.stringify(attestationCriteria ?? {}), declaredAt ?? new Date().toISOString());
    return { offering: `${offeringId}@${version}` };
  }

  /** Retiring an offering is an EVENT, never a mutation. Entity history
   *  survives retirement forever (T-8, AT-22). */
  retireOffering({ offeringId, version, reason, loggedAt }) {
    this.#offeringRow(`${offeringId}@${version}`); // throws if unknown
    return this.#logEvent('offering_retired', { offering: `${offeringId}@${version}`, reason: reason ?? null }, loggedAt);
  }

  // ---- issuance ------------------------------------------------------------

  /**
   * Record a transaction. The L1 receipt issues automatically inside the same
   * storage transaction — issuers get no say (spec §4: "never at issuer
   * discretion"). Free offerings never take this path: no value moved means
   * no L1; participants enter free offerings at L2 via issueAttestation.
   */
  recordTransaction({ issuer, holder, role, offering, txId, amountCents, occurredAt, coattesterPrivateKeys = [] }) {
    const offeringRow = this.#offeringRow(offering);
    this.#assertDeclaredIssuer(offeringRow, issuer.publicHex);
    if (offeringRow.price_cents === 0) {
      throw new Error('free offerings issue no L1: no value moved (spec §3, F2); attest participation at L2 instead');
    }
    if (!ROLES.includes(role)) throw new Error(`role must be one of: ${ROLES.join(', ')}`);
    const when = occurredAt ?? new Date().toISOString();
    const receipt = buildReceipt({
      issuerPrivateKey: issuer.privateKey,
      issuerPublicHex: issuer.publicHex,
      holder,
      role,
      offering,
      level: 1,
      event: role === 'payer' ? 'paid' : 'enrolled',
      issuedAt: when,
      prev: null,
      coattesterPrivateKeys,
    });
    this.db.exec('BEGIN');
    try {
      this.db.prepare(
        'INSERT INTO transactions (tx_id, issuer, offering, amount_cents, occurred_at) VALUES (?, ?, ?, ?, ?)',
      ).run(txId ?? uuidv7(), `ed25519:${issuer.publicHex}`, offering, amountCents, when);
      this.#insertReceipt(receipt);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { receipt };
  }

  /**
   * Issue an L2/L3/L4 attestation per the offering's PUBLISHED criteria.
   * Standing is monotonic per (holder, offering-version, role) and payers
   * cap at L1; ascensions chain to the prior receipt (spec §3, I-3, F1).
   */
  issueAttestation({ issuer, holder, role, offering, level, event, issuedAt, coattesterPrivateKeys = [] }) {
    const offeringRow = this.#offeringRow(offering);
    this.#assertDeclaredIssuer(offeringRow, issuer.publicHex);
    if (!Number.isInteger(level) || level < 2 || level > 4) {
      throw new Error('attestations are L2-L4; L1 issues only from recordTransaction');
    }
    const chain = this.#chainState(holder, offering, role);
    const refusal = ascensionError({ role, level, currentMaxLevel: chain.maxLevel, prevReceipt: chain.latest });
    if (refusal) throw new Error(refusal);
    const receipt = buildReceipt({
      issuerPrivateKey: issuer.privateKey,
      issuerPublicHex: issuer.publicHex,
      holder,
      role,
      offering,
      level,
      event: event ?? { 2: 'participated', 3: 'completed', 4: 'outcome_verified' }[level],
      issuedAt: issuedAt ?? new Date().toISOString(),
      prev: chain.latest ? chain.latest.receipt_id : null,
      coattesterPrivateKeys,
    });
    this.#insertReceipt(receipt);
    return { receipt };
  }

  /** A holder formally requests an attestation they believe they earned (T-7). */
  requestAttestation({ holder, offering, level, loggedAt }) {
    return this.#logEvent('attestation_requested', { holder, offering, level }, loggedAt);
  }

  /** Issuer refusal of a holder's request is a LOGGED PROTOCOL EVENT (AT-13),
   *  immutable and surfaced in the issuer's public issuance stats. */
  refuseAttestation({ issuerPublicHex, holder, offering, level, reason, loggedAt }) {
    this.#offeringRow(offering);
    return this.#logEvent('attestation_refused', {
      issuer: `ed25519:${issuerPublicHex}`, holder, offering, level, reason: reason ?? null,
    }, loggedAt);
  }

  // ---- reviews ---------------------------------------------------------------

  /**
   * Admit a review. Gate: a valid receipt for exactly the target
   * offering-version (AT-12, I-1); one review per (holder, offering-version,
   * role) standing (later receipts in the chain annotate it — they never
   * mint a second voice); payers rate value only — no facets (AT-10, I-6);
   * facets only against declared components (AT-17, I-6).
   */
  submitReview({ receiptId, offering, overall, facets = {}, text = null, postedAt }) {
    const receipt = this.#receiptRow(receiptId);
    if (!receipt) throw new Error('no receipt, no review (I-1)');
    if (!verifyReceipt(this.#receiptFromRow(receipt))) {
      throw new Error('receipt signature does not verify');
    }
    if (offering !== receipt.offering) {
      throw new Error(`receipt is for ${receipt.offering}, not ${offering}: reviews bind to the exact offering-version (AT-12)`);
    }
    // Issuer binding (defense-in-depth against the audit's MAJOR finding): a
    // receipt only gates a review if it was signed by the offering's DECLARED
    // issuer. A validly-signed receipt from a stranger's own key — recorded
    // against someone else's offering — must never blend into that offering's
    // score. Enforced at issuance too; re-checked here so a receipt that
    // somehow reached storage with the wrong issuer still cannot gate.
    const bindingRow = this.#offeringRow(offering);
    if (receipt.issuer !== bindingRow.issuer) {
      throw new Error(`receipt issuer is not the declared issuer of ${offering}: only the provider of record can gate its reviews (issuer binding)`);
    }
    if (!Number.isInteger(overall) || overall < 1 || overall > 5) {
      throw new Error('overall must be an integer 1-5 (see DRIFT.md D-6)');
    }
    const facetKeys = Object.keys(facets);
    if (receipt.role === 'payer' && facetKeys.length > 0) {
      throw new Error('payers rate value-for-money only: overall score, no facets (F1, I-6)');
    }
    const offeringRow = this.#offeringRow(offering);
    const declared = new Set(Object.values(JSON.parse(offeringRow.components)));
    for (const key of facetKeys) {
      if (!declared.has(key)) throw new Error(`facet "${key}" is not a declared component of ${offering} (I-6)`);
      const v = facets[key];
      if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error('facet scores must be integers 1-5');
    }
    const existing = this.db.prepare(
      `SELECT r2.review_id FROM reviews r2
        JOIN receipts rc ON rc.receipt_id = r2.receipt_id
       WHERE rc.holder = ? AND rc.offering = ? AND rc.role = ?`,
    ).get(receipt.holder, receipt.offering, receipt.role);
    if (existing) {
      throw new Error('this standing already reviewed this offering-version; edits are new events (I-5)');
    }
    const reviewClass = offeringRow.price_cents === 0 ? 'verified_participant' : 'verified_purchaser';
    const reviewId = uuidv7();
    this.db.prepare(
      `INSERT INTO reviews (review_id, receipt_id, offering, overall, facets, text, role_at_post, level_at_post, review_class, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(reviewId, receiptId, offering, overall, JSON.stringify(facets), text,
      receipt.role, receipt.level, reviewClass, postedAt ?? new Date().toISOString());
    return { reviewId, reviewClass };
  }

  /** Edits never touch the stored review: they are appended protocol events (I-5). */
  appendReviewEdit({ reviewId, overall, text, loggedAt }) {
    const row = this.db.prepare('SELECT review_id FROM reviews WHERE review_id = ?').get(reviewId);
    if (!row) throw new Error('unknown review');
    if (overall !== undefined && (!Number.isInteger(overall) || overall < 1 || overall > 5)) {
      throw new Error('overall must be an integer 1-5');
    }
    return this.#logEvent('review_edited', { review_id: reviewId, overall: overall ?? null, text: text ?? null }, loggedAt);
  }

  // ---- rendering inputs (read-only snapshots; the rendering itself is a
  // ---- pure function in rendering.js) ---------------------------------------

  /**
   * Everything rendering v1 needs for one offering-version, as plain data,
   * bounded by an explicit window end so any published score recomputes
   * byte-identical later (I-4). Deterministically ordered.
   */
  renderingInput(offering, windowEnd) {
    const offeringRow = this.#offeringRow(offering);
    const reviews = this.db.prepare(
      `SELECT r.review_id, r.receipt_id, r.overall, r.facets, r.text, r.role_at_post, r.level_at_post,
              r.review_class, r.posted_at, rc.holder, rc.coattest
         FROM reviews r JOIN receipts rc ON rc.receipt_id = r.receipt_id
        WHERE r.offering = ? AND r.posted_at <= ? ORDER BY r.review_id`,
    ).all(offering, windowEnd);
    const chains = this.db.prepare(
      `SELECT holder, role, MAX(level) AS max_level,
              MAX(CASE WHEN coattest != '[]' THEN 1 ELSE 0 END) AS coattested
         FROM receipts WHERE offering = ? AND issued_at <= ?
        GROUP BY holder, role ORDER BY holder, role`,
    ).all(offering, windowEnd);
    const chainKey = (holder, role) => `${holder}|${role}`;
    const chainMap = new Map(chains.map((c) => [chainKey(c.holder, c.role), c]));
    return {
      offering: {
        offering: `${offeringRow.offering_id}@${offeringRow.version}`,
        issuer: offeringRow.issuer,
        components: JSON.parse(offeringRow.components),
        price_cents: offeringRow.price_cents,
      },
      reviews: reviews.map((r) => {
        const chain = chainMap.get(chainKey(r.holder, r.role_at_post));
        return {
          review_id: r.review_id,
          overall: r.overall,
          facets: JSON.parse(r.facets),
          text: r.text,
          role: r.role_at_post,
          level_at_post: r.level_at_post,
          chain_max_level: chain ? chain.max_level : r.level_at_post,
          coattested: chain ? chain.coattested === 1 : false,
          review_class: r.review_class,
        };
      }),
      standings: chains.map((c) => ({ role: c.role, max_level: c.max_level, coattested: c.coattested === 1 })),
      issuance: this.issuerIssuanceStats(),
      window_end: windowEnd,
    };
  }

  /**
   * Everything rendering v1 needs for one ENTITY: every offering-version that
   * ever declared it as a component — including retired offerings. History
   * is permanent by construction (T-8, AT-22).
   */
  entityRenderingInput(entityId, windowEnd) {
    const offerings = this.db.prepare(
      'SELECT offering_id, version, components FROM offerings ORDER BY offering_id, version',
    ).all().filter((o) => Object.values(JSON.parse(o.components)).includes(entityId));
    const retired = new Set(
      this.db.prepare("SELECT payload FROM protocol_events WHERE type = 'offering_retired' AND logged_at <= ?")
        .all(windowEnd).map((e) => JSON.parse(e.payload).offering),
    );
    return {
      entity: entityId,
      window_end: windowEnd,
      offerings: offerings.map((o) => {
        const ref = `${o.offering_id}@${o.version}`;
        return { ...this.renderingInput(ref, windowEnd), retired: retired.has(ref) };
      }),
    };
  }

  /**
   * Public per-issuer attestation-issuance stats (T-7): enrollments,
   * completion attestations, refusals. Renderings disclose anomalies
   * against cohort norms (AT-23). Keyed by issuer — never by holder.
   */
  issuerIssuanceStats() {
    const rows = this.db.prepare(
      `SELECT issuer, offering,
              COUNT(DISTINCT CASE WHEN level = 1 THEN holder || '|' || role END) AS l1_standings,
              COUNT(DISTINCT CASE WHEN level = 1 AND role = 'participant' THEN holder END) AS enrolled_participants,
              COUNT(DISTINCT CASE WHEN level >= 2 AND role = 'participant' THEN holder END) AS engaged,
              COUNT(DISTINCT CASE WHEN level >= 3 AND role = 'participant' THEN holder END) AS completed
         FROM receipts GROUP BY issuer, offering ORDER BY issuer, offering`,
    ).all();
    const refusals = this.db.prepare(
      "SELECT payload FROM protocol_events WHERE type = 'attestation_refused' ORDER BY seq",
    ).all().map((r) => JSON.parse(r.payload));
    return rows.map((row) => ({
      issuer: row.issuer,
      offering: row.offering,
      l1_standings: row.l1_standings,
      enrolled_participants: row.enrolled_participants,
      engaged: row.engaged,
      completed: row.completed,
      refusals: refusals.filter((f) => f.issuer === row.issuer && f.offering === row.offering).length,
    }));
  }

  /** Publish a rendering: the canonical manifest is stored append-only so
   *  I-4 can recompute it byte-identical forever. */
  publish(rendered) {
    const manifest = canonicalize(rendered);
    const pubId = uuidv7();
    this.db.prepare(
      'INSERT INTO publications (pub_id, rendering_version, subject, window_end, manifest) VALUES (?, ?, ?, ?, ?)',
    ).run(pubId, rendered.rendering_version, rendered.subject, rendered.window_end, manifest);
    return { pubId };
  }

  listPublications() {
    return this.db.prepare('SELECT * FROM publications ORDER BY pub_id').all();
  }

  // ---- private helpers -------------------------------------------------------

  #offeringRow(offering) {
    const [offeringId, version] = String(offering).split('@');
    const row = this.db.prepare('SELECT * FROM offerings WHERE offering_id = ? AND version = ?').get(offeringId, version);
    if (!row) throw new Error(`unknown offering-version: ${offering}`);
    return row;
  }

  /** Only the offering's declared issuer (the provider of record, spec §2)
   *  may mint receipts against it. Blocks a stranger from recording a fake
   *  transaction on someone else's offering and reviewing it. */
  #assertDeclaredIssuer(offeringRow, actingPublicHex) {
    if (offeringRow.issuer !== `ed25519:${actingPublicHex}`) {
      throw new Error(`only ${offeringRow.offering_id}@${offeringRow.version}'s declared issuer may mint receipts against it (issuer binding)`);
    }
  }

  #receiptRow(receiptId) {
    return this.db.prepare('SELECT * FROM receipts WHERE receipt_id = ?').get(receiptId);
  }

  #receiptFromRow(row) {
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
      sig: row.sig,
      coattest: JSON.parse(row.coattest),
    };
  }

  #chainState(holder, offering, role) {
    const rows = this.db.prepare(
      'SELECT * FROM receipts WHERE holder = ? AND offering = ? AND role = ? ORDER BY level',
    ).all(holder, offering, role);
    if (rows.length === 0) return { maxLevel: null, latest: null };
    return { maxLevel: rows[rows.length - 1].level, latest: rows[rows.length - 1] };
  }

  #insertReceipt(receipt) {
    this.db.prepare(
      `INSERT INTO receipts (receipt_id, spec, issuer, holder, role, offering, level, event, issued_at, prev, coattest, sig)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(receipt.receipt_id, receipt.spec, receipt.issuer, receipt.holder, receipt.role, receipt.offering,
      receipt.level, receipt.event, receipt.issued_at, receipt.prev, JSON.stringify(receipt.coattest), receipt.sig);
  }

  #logEvent(type, payload, loggedAt) {
    this.db.prepare('INSERT INTO protocol_events (type, payload, logged_at) VALUES (?, ?, ?)')
      .run(type, JSON.stringify(payload), loggedAt ?? new Date().toISOString());
    const seq = this.db.prepare('SELECT MAX(seq) AS seq FROM protocol_events').get().seq;
    return { seq, type };
  }
}

module.exports = { Store, APPEND_ONLY_TABLES, RECEIPT_SPEC };
