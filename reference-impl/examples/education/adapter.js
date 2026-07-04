'use strict';

// ============================================================================
// DEMONSTRATOR — NOT PRODUCTION, NOT A LIVE INTEGRATION.
// ============================================================================
//
// Same posture as reference-impl/demo.js: this is illustrative code that shows
// HOW an education issuer (a course platform, bootcamp, or ESA marketplace)
// would map its own native events onto the AudienceScore v0.2 protocol. It is
// deliberately generic — it does not integrate with any real LMS, payment
// processor, or marketplace, and it must not be pointed at real learner data
// as-is. It exists so a sales/design conversation has something concrete to
// stand on, and so the real adapter (built WITH the first anchor issuer,
// against that issuer's real event stream) has a shape to start from.
//
// What it demonstrates: the attestation ladder (spec §3) is populated by the
// issuer's ordinary operational events. Nothing new is asked of the issuer
// except "sign the receipt that already corresponds to something you already
// recorded."
//
//   native event (generic webhook)          -> protocol primitive
//   ---------------------------------------- -> ------------------------------
//   payment.succeeded (paid offering)        -> L1 TRANSACTED, payer role
//   enrollment.created (paid offering)       -> L1 TRANSACTED, participant role
//   enrollment.created (free offering)       -> no L1 (no value moved); the
//                                               participant enters at L2 on
//                                               verified progress (spec §3, F2)
//   lms.progress, pct >= L2 threshold        -> L2 ENGAGED, participant role
//   lms.completed                            -> L3 COMPLETED, participant role
//
// Receipt signing, the append-only store, monotonic standing, issuer binding,
// and every invariant are the REAL v0.2 modules — this file only routes events
// to them. The one thing it stubs is holder identity; see resolveHolderBinding.

const { blake3 } = require('@noble/hashes/blake3.js');
const { deriveHolderKeyPair, holderBinding } = require('../../src/v02/holder');
const { verifyReceipt } = require('../../src/v02/receipts');

/** The generic webhook event types this demonstrator understands. A real
 *  adapter maps its own provider's event names onto these. */
const EVENT = Object.freeze({
  PAYMENT: 'payment.succeeded',
  ENROLLMENT: 'enrollment.created',
  PROGRESS: 'lms.progress',
  COMPLETION: 'lms.completed',
});

// ---------------------------------------------------------------------------
// Holder identity — the ONE genuinely stubbed piece.
//
// In the real protocol (spec §7) a holder controls a root secret that never
// leaves the holder's own agent; the pseudonymous binding is
// blake3(derived_holder_pubkey || issuer_salt), where the per-issuer derived
// key makes two issuers unable to correlate the same person. The ISSUER never
// learns the root and therefore cannot build a cross-provider enrollment graph.
//
// A demonstrator has no holder agents, only an issuer replaying webhooks. So
// the default resolver below derives a *demo* root deterministically from the
// native learner reference. This reproduces the intended unlinkability
// mechanism (per-issuer derived key + salt) so the example is faithful — but it
// trades away the real privacy property, because here the issuer is doing the
// derivation. A production adapter MUST NOT derive holder roots issuer-side;
// it receives an already-pseudonymous binding produced by the holder's agent.
// This is called out loudly on purpose.
// ---------------------------------------------------------------------------

function makeDemoHolderResolver(demoSecret = 'DEMO-ONLY-not-a-real-holder-root') {
  return function resolveHolderBinding(nativeSubjectRef, issuer) {
    const root = blake3(Buffer.concat([Buffer.from(demoSecret), Buffer.from(String(nativeSubjectRef))]));
    const derived = deriveHolderKeyPair(root, issuer.publicHex);
    return holderBinding(derived.publicHex, issuer.salt);
  };
}

class EducationIssuerAdapter {
  /**
   * @param {object}   opts
   * @param {import('../../src/v02/store').Store} opts.store  the real v0.2 store
   * @param {object}   opts.issuer      { privateKey, publicHex, salt } — the provider of record
   * @param {object[]} opts.offerings   catalog entries to declare (see registerOfferings)
   * @param {number}   [opts.l2ProgressThreshold=60]  default % progress that earns L2
   * @param {Function} [opts.resolveHolderBinding]     (nativeSubjectRef, issuer) => 64-hex binding
   */
  constructor({ store, issuer, offerings = [], l2ProgressThreshold = 60, resolveHolderBinding }) {
    if (!store || !issuer) throw new Error('adapter needs a store and an issuer');
    this.store = store;
    this.issuer = issuer;
    this.defaultL2Threshold = l2ProgressThreshold;
    this.resolveHolderBinding = resolveHolderBinding ?? makeDemoHolderResolver();
    this.offerings = new Map(); // "id@version" -> { priceCents, l2Threshold }
    this._offeringSpecs = offerings;
  }

  /** Declare the issuer's catalog onto the protocol (spec §5 offerings). Each
   *  entry: { offeringId, version, components, priceCents, attestationCriteria,
   *  declaredAt, l2Threshold? }. Idempotent per (id, version) within a run. */
  registerOfferings() {
    for (const spec of this._offeringSpecs) {
      this.store.declareOffering({
        offeringId: spec.offeringId,
        version: spec.version,
        issuerPublicHex: this.issuer.publicHex,
        components: spec.components,
        priceCents: spec.priceCents,
        attestationCriteria: spec.attestationCriteria ?? {},
        declaredAt: spec.declaredAt,
      });
      this.offerings.set(`${spec.offeringId}@${spec.version}`, {
        priceCents: spec.priceCents,
        l2Threshold: spec.l2Threshold ?? this.defaultL2Threshold,
      });
    }
    return this;
  }

  /**
   * Route one native webhook event to the protocol. Returns a plain-English
   * outcome instead of throwing, because a real webhook stream is retried and
   * can arrive out of order — a duplicate or premature event is a no-op, not a
   * crash. (A production adapter should ALSO dedupe by the provider's event id;
   * that bookkeeping is out of scope for a demonstrator.)
   *
   * @returns {{status:'issued'|'noop'|'refused', level?:number, role?:string,
   *            receipt?:object, reason?:string}}
   */
  handle(event) {
    try {
      switch (event.type) {
        case EVENT.PAYMENT:
          return this.#transacted(event, event.role ?? 'payer', 'paid');
        case EVENT.ENROLLMENT:
          return this.#enroll(event);
        case EVENT.PROGRESS:
          return this.#progress(event);
        case EVENT.COMPLETION:
          return this.#attest(event, 3, 'completed');
        default:
          return { status: 'noop', reason: `unmapped event type: ${event.type}` };
      }
    } catch (err) {
      return { status: 'refused', reason: err.message };
    }
  }

  // ---- private routers ------------------------------------------------------

  #offering(event) {
    const ref = `${event.offering.id}@${event.offering.version}`;
    const meta = this.offerings.get(ref);
    if (!meta) throw new Error(`unknown offering ${ref}: declare it before routing its events`);
    return { ref, meta };
  }

  #binding(event) {
    return this.resolveHolderBinding(event.subject, this.issuer);
  }

  /** payment.succeeded -> L1 TRANSACTED (payer by default). */
  #transacted(event, role, eventName) {
    const { ref, meta } = this.#offering(event);
    if (meta.priceCents === 0) {
      return { status: 'noop', reason: `free offering ${ref}: no value moved, so no L1 (spec §3)` };
    }
    const { receipt } = this.store.recordTransaction({
      issuer: this.issuer,
      holder: this.#binding(event),
      role,
      offering: ref,
      amountCents: event.amount_cents ?? meta.priceCents,
      occurredAt: event.occurred_at,
    });
    return { status: 'issued', level: 1, role, receipt, event: eventName };
  }

  /** enrollment.created -> L1 participant on paid offerings; on free offerings
   *  there is no purchase to attest, so the participant waits for L2 progress. */
  #enroll(event) {
    const { ref, meta } = this.#offering(event);
    if (meta.priceCents === 0) {
      return { status: 'noop', reason: `free offering ${ref}: participant enters at L2 on verified progress, not at enrollment` };
    }
    return this.#transacted(event, 'participant', 'enrolled');
  }

  /** lms.progress -> L2 ENGAGED once past the declared threshold. */
  #progress(event) {
    const { ref, meta } = this.#offering(event);
    const pct = Number(event.progress_pct);
    if (!Number.isFinite(pct) || pct < meta.l2Threshold) {
      return { status: 'noop', reason: `progress ${event.progress_pct}% below L2 threshold ${meta.l2Threshold}% for ${ref}` };
    }
    return this.#attest(event, 2, 'participated');
  }

  /** Issue an L2/L3 participant attestation; monotonic standing is enforced by
   *  the store, so an out-of-order or duplicate ascension is reported as a
   *  no-op rather than an error. */
  #attest(event, level, eventName) {
    const { ref } = this.#offering(event);
    try {
      const { receipt } = this.store.issueAttestation({
        issuer: this.issuer,
        holder: this.#binding(event),
        role: 'participant',
        offering: ref,
        level,
        event: eventName,
        issuedAt: event.occurred_at,
      });
      return { status: 'issued', level, role: 'participant', receipt, event: eventName };
    } catch (err) {
      // "standing only ascends" and "already stands at Lx" are expected for
      // replayed / out-of-order webhooks — not failures.
      return { status: 'noop', reason: err.message };
    }
  }
}

module.exports = { EducationIssuerAdapter, makeDemoHolderResolver, EVENT, verifyReceipt };
