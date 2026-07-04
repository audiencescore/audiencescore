'use strict';

// The invariant health-check register (spec §6): seven invariants, each
// wired into one automated check that returns violations as plain data.
// These run against STORAGE, not against the API — they exist to catch bad
// state however it arrived, including state the API would have refused
// (AT-18, AT-20, AT-21).

const { canonicalize } = require('../crypto');
const { APPEND_ONLY_TABLES } = require('./store');
const { renderOffering, renderEntity, PARAMS } = require('./rendering');

/** Run every invariant check. Returns [] when healthy. */
function healthCheck(store) {
  return [
    ...checkI1NoOrphans(store),
    ...checkI2Reconciliation(store),
    ...checkI3Monotonicity(store),
    ...checkI4RenderingIntegrity(store),
    ...checkI5AppendOnly(store),
    ...checkI6FacetValidity(store),
    ...checkI7KAnonymity(store),
    ...checkIssuerBinding(store),
  ];
}

const violation = (invariant, message, detail) => ({ invariant, message, detail });

/** I-1: every review resolves to a receipt; every receipt to an offering-version. */
function checkI1NoOrphans(store) {
  const out = [];
  const orphanReviews = store.db.prepare(
    'SELECT r.review_id, r.receipt_id FROM reviews r LEFT JOIN receipts rc ON rc.receipt_id = r.receipt_id WHERE rc.receipt_id IS NULL',
  ).all();
  for (const row of orphanReviews) {
    out.push(violation('I-1', 'review references a receipt that does not exist', { review_id: row.review_id, receipt_id: row.receipt_id }));
  }
  const orphanReceipts = store.db.prepare(
    `SELECT rc.receipt_id, rc.offering FROM receipts rc
      LEFT JOIN offerings o ON (o.offering_id || '@' || o.version) = rc.offering
     WHERE o.offering_id IS NULL`,
  ).all();
  for (const row of orphanReceipts) {
    out.push(violation('I-1', 'receipt references an offering-version that does not exist', { receipt_id: row.receipt_id, offering: row.offering }));
  }
  return out;
}

/** I-2: per issuer per offering, L1 receipts reconcile against transactions.
 *  This is the protocol's "balance sheet nets to zero" (AT-20). */
function checkI2Reconciliation(store) {
  const pairs = store.db.prepare(
    `SELECT issuer, offering FROM transactions
      UNION SELECT issuer, offering FROM receipts WHERE level = 1
      ORDER BY issuer, offering`,
  ).all();
  const receiptCount = store.db.prepare('SELECT COUNT(*) AS n FROM receipts WHERE level = 1 AND issuer = ? AND offering = ?');
  const txCount = store.db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE issuer = ? AND offering = ?');
  const out = [];
  for (const row of pairs) {
    const receipts = receiptCount.get(row.issuer, row.offering).n;
    const transactions = txCount.get(row.issuer, row.offering).n;
    const gap = receipts - transactions;
    if (gap !== 0) {
      out.push(violation('I-2', `L1 receipts do not reconcile against transactions (gap of ${gap})`, {
        issuer: row.issuer, offering: row.offering, l1_receipts: receipts, transactions, gap,
      }));
    }
  }
  return out;
}

/** I-3: standing never descends within a (holder, offering-version, role) chain. */
function checkI3Monotonicity(store) {
  const out = [];
  const receipts = store.db.prepare('SELECT receipt_id, holder, role, offering, level, prev FROM receipts ORDER BY receipt_id').all();
  const byId = new Map(receipts.map((r) => [r.receipt_id, r]));
  for (const r of receipts) {
    if (r.prev === null) continue;
    const prev = byId.get(r.prev);
    if (!prev) {
      out.push(violation('I-3', 'receipt chains to a prev receipt that does not exist', { receipt_id: r.receipt_id, prev: r.prev }));
      continue;
    }
    if (prev.holder !== r.holder || prev.offering !== r.offering || prev.role !== r.role) {
      out.push(violation('I-3', 'receipt chains across a different standing', { receipt_id: r.receipt_id, prev: r.prev }));
    }
    if (r.level <= prev.level) {
      out.push(violation('I-3', `standing descended: L${prev.level} -> L${r.level}`, {
        receipt_id: r.receipt_id, prev: r.prev, holder: r.holder, offering: r.offering, role: r.role,
      }));
    }
  }
  return out;
}

/** I-4: every published manifest recomputes byte-identical from raw data
 *  plus the named rendering version. */
function checkI4RenderingIntegrity(store) {
  const out = [];
  for (const pub of store.listPublications()) {
    let recomputed;
    try {
      const [kind, id] = splitSubject(pub.subject);
      if (kind === 'offering') {
        recomputed = renderOffering(store.renderingInput(id, pub.window_end));
      } else if (kind === 'entity') {
        recomputed = renderEntity(store.entityRenderingInput(id, pub.window_end));
      } else {
        out.push(violation('I-4', 'publication has an unrecognized subject', { pub_id: pub.pub_id, subject: pub.subject }));
        continue;
      }
    } catch (err) {
      out.push(violation('I-4', `publication no longer recomputes: ${err.message}`, { pub_id: pub.pub_id, subject: pub.subject }));
      continue;
    }
    if (canonicalize(recomputed) !== pub.manifest) {
      out.push(violation('I-4', 'published manifest is not byte-identical to its recomputation', {
        pub_id: pub.pub_id, subject: pub.subject, window_end: pub.window_end,
      }));
    }
  }
  return out;
}

function splitSubject(subject) {
  const i = subject.indexOf(':');
  return [subject.slice(0, i), subject.slice(i + 1)];
}

/** I-5: the append-only triggers must exist in the storage engine for every
 *  ledger table. If someone dropped one, the physical guarantee is gone. */
function checkI5AppendOnly(store) {
  const out = [];
  const triggers = new Set(
    store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((t) => t.name),
  );
  for (const table of APPEND_ONLY_TABLES) {
    for (const suffix of ['no_update', 'no_delete']) {
      const name = `${table}_${suffix}`;
      if (!triggers.has(name)) {
        out.push(violation('I-5', `append-only trigger missing from the storage layer: ${name}`, { table, trigger: name }));
      }
    }
  }
  return out;
}

/** I-6: facet scores exist only against declared components, from
 *  participant receipts only. */
function checkI6FacetValidity(store) {
  const out = [];
  const rows = store.db.prepare(
    `SELECT r.review_id, r.facets, r.role_at_post, r.offering, o.components
       FROM reviews r
       LEFT JOIN offerings o ON (o.offering_id || '@' || o.version) = r.offering`,
  ).all();
  for (const row of rows) {
    const facetKeys = Object.keys(JSON.parse(row.facets));
    if (facetKeys.length === 0) continue;
    if (row.role_at_post === 'payer') {
      out.push(violation('I-6', 'payer-role review carries facet scores', { review_id: row.review_id }));
      continue;
    }
    const declared = new Set(row.components ? Object.values(JSON.parse(row.components)) : []);
    for (const key of facetKeys) {
      if (!declared.has(key)) {
        out.push(violation('I-6', `facet names an undeclared component: ${key}`, { review_id: row.review_id, facet: key, offering: row.offering }));
      }
    }
  }
  return out;
}

/** I-7: nothing publishes below the k-anonymity floor. */
function checkI7KAnonymity(store) {
  const out = [];
  for (const pub of store.listPublications()) {
    let manifest;
    try {
      manifest = JSON.parse(pub.manifest);
    } catch {
      out.push(violation('I-7', 'publication manifest is not valid JSON', { pub_id: pub.pub_id }));
      continue;
    }
    if (manifest.published === true && manifest.distinct_receipts < PARAMS.K_ANONYMITY) {
      out.push(violation('I-7', `published below the k-anonymity floor (${manifest.distinct_receipts} < ${PARAMS.K_ANONYMITY})`, {
        pub_id: pub.pub_id, subject: pub.subject,
      }));
    }
  }
  return out;
}

/**
 * Issuer binding (addresses the v0.2a audit's MAJOR finding; strengthens T-1).
 * Every stored receipt must be signed by the DECLARED issuer of the offering
 * it points at — otherwise a stranger's validly-signed receipt (from their own
 * key, against someone else's offering) could pollute that offering's score.
 * The API now refuses this at issuance and admission; this check catches any
 * such receipt that reached storage another way, so a polluted ledger alarms
 * instead of scoring silently. Proposed as invariant I-8 for the next spec
 * revision (see DRIFT.md D-12).
 */
function checkIssuerBinding(store) {
  const rows = store.db.prepare(
    `SELECT rc.receipt_id, rc.issuer AS receipt_issuer, rc.offering, o.issuer AS declared_issuer
       FROM receipts rc
       JOIN offerings o ON (o.offering_id || '@' || o.version) = rc.offering
      WHERE rc.issuer != o.issuer`,
  ).all();
  return rows.map((row) => violation('issuer-binding',
    'receipt was not signed by the offering\'s declared issuer', {
      receipt_id: row.receipt_id, offering: row.offering,
      receipt_issuer: row.receipt_issuer, declared_issuer: row.declared_issuer,
    }));
}

module.exports = { healthCheck };
