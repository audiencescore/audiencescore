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
 * Render the audience score for one vendor (optionally scoped to a state)
 * from verdict events. Returns the manifest body: score, sample size,
 * confidence bound, dimension sub-scores, locality, spec version, and the
 * provenance hash of the exact event set used.
 */
function renderScore(events, { vendorId, state = null, now }) {
  const nowMs = Date.parse(now);
  const selected = events.filter((e) => {
    if (e.type !== 'verdict') return false;
    if (e.body.vendor.id !== vendorId) return false;
    if (state && e.body.service_locality.state !== state) return false;
    return true;
  });

  let weightTotal = 0;
  let weightUp = 0;
  const dims = {};

  for (const e of selected) {
    const tier = PROOF_TIERS[e.body.receipt.tier];
    const ageDays = (nowMs - Date.parse(e.body.issued_at)) / 86_400_000;
    const w = (tier ? tier.weight : 0) * timeDecay(ageDays);
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

  const sampleSize = selected.length;
  const displayed = sampleSize >= MIN_SAMPLE;

  const dimensions = {};
  for (const [dim, d] of Object.entries(dims)) {
    dimensions[dim] = d.count >= MIN_DIMENSION_SAMPLE
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
      event_count: selected.length,
      event_set_hash: sha256Hex(canonicalize(selected.map((e) => e.id).sort())),
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
