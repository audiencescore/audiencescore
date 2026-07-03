'use strict';

// The score renderer: a versioned, deterministic function over verdict
// events. Anyone holding the event log can recompute every number here and
// must get the same result. The math is normative in
// /score-spec/score-spec-v0.1.md; this file implements it.

const { canonicalize, sha256Hex, signPayload, publicKeyToString } = require('./crypto');
const { PROOF_TIERS } = require('./receipts');

const SPEC_VERSION = 'audiencescore/score-spec@0.1';

// Spec v0.1 parameters (normative values live in the spec document).
const Z = 1.96; // 95% confidence
const MIN_SAMPLE = 10; // no headline score displayed below this many verdicts
const MIN_DIMENSION_SAMPLE = 10; // same floor for dimension sub-scores
const HALF_LIFE_DAYS = 730; // time-decay half-life: 24 months

/** Wilson score interval lower bound for a weighted proportion. */
function wilsonLowerBound(positive, total) {
  if (total <= 0) return 0;
  const p = positive / total;
  const z2 = Z * Z;
  const denom = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = Z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return Math.max(0, (center - margin) / denom);
}

/** Decay weight for an event of the given age. */
function timeDecay(ageDays) {
  return Math.pow(0.5, Math.max(0, ageDays) / HALF_LIFE_DAYS);
}

/**
 * A well-formed verdict for this vendor (and state, if scoped). Returns false
 * for anything malformed rather than throwing: a signed-but-garbage event in a
 * hostile log must be skipped, not allowed to crash recomputation.
 */
function isScopedVerdict(e, vendorId, state) {
  if (!e || e.type !== 'verdict') return false;
  const b = e.body;
  if (!b || typeof b !== 'object') return false;
  if (b.verdict !== 'up' && b.verdict !== 'down') return false;
  if (!b.vendor || b.vendor.id !== vendorId) return false;
  if (!b.receipt || typeof b.receipt.tier !== 'string') return false;
  if (typeof b.issued_at !== 'string' || Number.isNaN(Date.parse(b.issued_at))) return false;
  if (state && (!b.service_locality || b.service_locality.state !== state)) return false;
  return true;
}

/**
 * Render the audience score for one vendor (optionally scoped to a state)
 * from verdict events. Returns the manifest body: score, sample size,
 * confidence bound, dimension sub-scores, locality, spec version, and the
 * provenance hash of the exact event set used.
 */
function renderScore(events, { vendorId, state = null, now }) {
  const nowMs = Date.parse(now);
  // In-scope, well-formed verdicts for this vendor. Malformed bodies are
  // skipped, never thrown on — a hostile log must not crash recomputation.
  const inScope = events.filter((e) => isScopedVerdict(e, vendorId, state));

  // Only verdicts backed by a known proof tier carry weight and count toward
  // the sample; weightless verdicts (unknown/absent tier) cannot pad the floor.
  const scored = inScope.filter((e) => PROOF_TIERS[e.body.receipt.tier] !== undefined);

  let weightTotal = 0;
  let weightUp = 0;
  const dims = {};

  for (const e of scored) {
    const tier = PROOF_TIERS[e.body.receipt.tier];
    const ageDays = (nowMs - Date.parse(e.body.issued_at)) / 86_400_000;
    const w = tier.weight * timeDecay(ageDays);
    weightTotal += w;
    if (e.body.verdict === 'up') weightUp += w;

    for (const [dim, value] of Object.entries(e.body.dimensions ?? {})) {
      if (value === null || value === undefined) continue;
      dims[dim] ??= { total: 0, positive: 0, count: 0 };
      dims[dim].total += w;
      dims[dim].count += 1;
      if (value === true) dims[dim].positive += w;
    }
  }

  const sampleSize = scored.length;
  const displayed = sampleSize >= MIN_SAMPLE && weightTotal > 0;

  const dimensions = {};
  for (const [dim, d] of Object.entries(dims)) {
    dimensions[dim] = (d.count >= MIN_DIMENSION_SAMPLE && d.total > 0)
      ? {
          displayed: true,
          percent_positive: round4(d.positive / d.total),
          sample_size: d.count,
        }
      : { displayed: false, sample_size: d.count };
  }

  return {
    spec_version: SPEC_VERSION,
    vendor_id: vendorId,
    locality: state ? { state } : { scope: 'national' },
    sample_size: sampleSize,
    displayed,
    score: displayed ? round4(weightUp / weightTotal) : null,
    wilson_lower_bound: displayed ? round4(wilsonLowerBound(weightUp, weightTotal)) : null,
    dimensions,
    computed_at: now,
    provenance: {
      event_count: scored.length,
      event_set_hash: sha256Hex(canonicalize(scored.map((e) => e.id).sort())),
    },
  };
}

/** Sign a manifest with the repository's rendering key. */
function signManifest(manifest, privateKey, publicKey) {
  const signer = publicKeyToString(publicKey);
  const sig = signPayload(privateKey, manifest);
  return { manifest, signer, sig };
}

function round4(x) {
  return Math.round(x * 10_000) / 10_000;
}

module.exports = {
  SPEC_VERSION,
  MIN_SAMPLE,
  HALF_LIFE_DAYS,
  wilsonLowerBound,
  timeDecay,
  renderScore,
  signManifest,
};
