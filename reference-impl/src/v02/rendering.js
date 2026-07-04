'use strict';

// Rendering v1 (spec §5): a versioned, deterministic PURE function from
// (raw reviews snapshot, rendering version, window) to published scores.
// Normative parameters: score-spec/rendering-v1.md.
//
// Purity is load-bearing (I-4, AT-14): this module reads no clock, no
// randomness, no network, no filesystem — the window boundary is an explicit
// input. Rendering the same snapshot twice, any day, yields byte-identical
// output.
//
// Two views ship in every rendering (F6): level-weighting is never allowed
// to become survivorship laundering, so the all-verified view and the
// completer view publish side by side with the completion rate disclosed.
// Nothing publishes below the k-anonymity floor (I-7, F4): review text stays
// suppressed below k while still counting toward the eventual score.

const RENDERING_VERSION = 'audiencescore/rendering@1';

// Normative rendering-v1 parameters (see score-spec/rendering-v1.md).
const PARAMS = Object.freeze({
  K_ANONYMITY: 10,
  COMPLETER_LEVEL: 3,
  LEVEL_WEIGHT: Object.freeze({ 1: 1.0, 2: 1.25, 3: 1.5, 4: 2.0 }),
  ROLE_WEIGHT: Object.freeze({ participant: 1.0, payer: 0.5 }),
  ANOMALY_RATIO: 0.5,
});

function round4(x) {
  return Math.round(x * 10_000) / 10_000;
}

function reviewWeight(review) {
  return PARAMS.LEVEL_WEIGHT[review.chain_max_level] * PARAMS.ROLE_WEIGHT[review.role];
}

/** Weighted mean of overall scores for one set of reviews. */
function view(reviews) {
  let weight = 0;
  let sum = 0;
  for (const r of reviews) {
    const w = reviewWeight(r);
    weight += w;
    sum += w * r.overall;
  }
  return {
    sample_size: reviews.length,
    score: weight > 0 ? round4(sum / weight) : null,
  };
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const k = String(keyFn(item));
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Per-issuer completion-attestation rates and cohort anomaly flags (T-7, AT-23). */
function issuanceDisclosure(issuance, issuer) {
  const byIssuer = new Map();
  for (const row of issuance) {
    const agg = byIssuer.get(row.issuer) ?? { enrolled: 0, engaged: 0, completed: 0, refusals: 0 };
    agg.enrolled += row.enrolled_participants;
    agg.engaged += row.engaged;
    agg.completed += row.completed;
    agg.refusals += row.refusals;
    byIssuer.set(row.issuer, agg);
  }
  const rateOf = (a) => {
    const base = a.enrolled > 0 ? a.enrolled : a.engaged;
    return base > 0 ? a.completed / base : null;
  };
  const cohortRates = [...byIssuer.values()].map(rateOf).filter((r) => r !== null);
  const cohortMedian = median(cohortRates);
  const mine = byIssuer.get(issuer) ?? { enrolled: 0, engaged: 0, completed: 0, refusals: 0 };
  const myRate = rateOf(mine);
  return {
    completion_attestation_rate: myRate === null ? null : round4(myRate),
    cohort_median_rate: cohortMedian === null ? null : round4(cohortMedian),
    anomalously_low: myRate !== null && cohortMedian !== null && myRate < PARAMS.ANOMALY_RATIO * cohortMedian,
    refusals_logged: mine.refusals,
  };
}

/**
 * Render one offering-version. Input is the plain-data snapshot from
 * Store#renderingInput — nothing else.
 */
function renderOffering(input) {
  const { offering, reviews, standings, issuance, window_end: windowEnd } = input;
  const distinctReceipts = reviews.length; // one review per standing chain, by admission rule
  const published = distinctReceipts >= PARAMS.K_ANONYMITY;

  const completers = reviews.filter((r) => r.chain_max_level >= PARAMS.COMPLETER_LEVEL);
  const participantStandings = standings.filter((s) => s.role === 'participant');
  const completedStandings = participantStandings.filter((s) => s.max_level >= PARAMS.COMPLETER_LEVEL);

  // Facet scores per declared component entity, participant reviews only (I-6).
  const facets = {};
  for (const entity of Object.values(offering.components).sort()) {
    const scores = reviews.flatMap((r) => (entity in r.facets ? [{ ...r, overall: r.facets[entity] }] : []));
    facets[entity] = view(scores);
  }

  const freeOffering = offering.price_cents === 0;
  return {
    rendering_version: RENDERING_VERSION,
    subject: `offering:${offering.offering}`,
    window_end: windowEnd,
    published,
    distinct_receipts: distinctReceipts,
    k_anonymity_floor: PARAMS.K_ANONYMITY,
    // Standing class disclosure (F2): free offerings have no purchase gate
    // and the score says so out loud.
    purchase_gate: !freeOffering,
    standing_class: freeOffering ? 'verified_participant' : 'verified_purchaser',
    views: published
      ? { all_verified: view(reviews), completers: view(completers) }
      : { all_verified: { sample_size: distinctReceipts, score: null }, completers: { sample_size: completers.length, score: null } },
    completion_rate: participantStandings.length > 0
      ? round4(completedStandings.length / participantStandings.length)
      : null,
    sample_mix: {
      by_level: countBy(reviews, (r) => r.chain_max_level),
      by_role: countBy(reviews, (r) => r.role),
      by_class: countBy(reviews, (r) => r.review_class),
      attestation_sources: {
        coattested: reviews.filter((r) => r.coattested).length,
        issuer_solo: reviews.filter((r) => !r.coattested).length,
      },
    },
    facets: published ? facets : null,
    // Text is suppressed below the floor even though the underlying reviews
    // keep counting toward the eventual score (I-7, AT-16).
    review_texts: published
      ? reviews.filter((r) => typeof r.text === 'string' && r.text.length > 0).map((r) => r.text)
      : null,
    issuer_disclosures: issuanceDisclosure(issuance, offering.issuer),
    cross_version: false,
  };
}

/**
 * Render one entity across every offering-version that ever declared it —
 * including retired ones (T-8, AT-22): facet scores naming the entity plus
 * decomposed overall scores, weighted down by 1/#components.
 */
function renderEntity(input) {
  const contributions = [];
  let distinctReceipts = 0;
  const perOffering = [];
  for (const o of input.offerings) {
    const componentCount = Object.keys(o.offering.components).length;
    let used = 0;
    for (const r of o.reviews) {
      if (input.entity in r.facets) {
        contributions.push({ ...r, overall: r.facets[input.entity], share: 1 });
        used++;
      } else if (Object.values(o.offering.components).includes(input.entity)) {
        contributions.push({ ...r, share: 1 / componentCount });
        used++;
      }
    }
    distinctReceipts += used;
    perOffering.push({ offering: o.offering.offering, retired: o.retired, reviews_used: used });
  }
  const published = distinctReceipts >= PARAMS.K_ANONYMITY;
  let weight = 0;
  let sum = 0;
  for (const c of contributions) {
    const w = reviewWeight(c) * c.share;
    weight += w;
    sum += w * c.overall;
  }
  return {
    rendering_version: RENDERING_VERSION,
    subject: `entity:${input.entity}`,
    window_end: input.window_end,
    published,
    distinct_receipts: distinctReceipts,
    k_anonymity_floor: PARAMS.K_ANONYMITY,
    score: published && weight > 0 ? round4(sum / weight) : null,
    offerings: perOffering,
    cross_version: false,
  };
}

/**
 * Cross-version rollup for one offering id. Renderings are version-scoped by
 * default (F7); a rollup exists only as this explicitly-disclosed form, with
 * the per-version breakdown attached.
 */
function renderCrossVersion(inputs) {
  if (inputs.length === 0) throw new Error('cross-version rollup needs at least one version input');
  const offeringId = inputs[0].offering.offering.split('@')[0];
  const versions = inputs.map((i) => renderOffering(i));
  const allReviews = inputs.flatMap((i) => i.reviews);
  const distinctReceipts = allReviews.length;
  const published = distinctReceipts >= PARAMS.K_ANONYMITY;
  return {
    rendering_version: RENDERING_VERSION,
    subject: `offering-all-versions:${offeringId}`,
    window_end: inputs[0].window_end,
    published,
    distinct_receipts: distinctReceipts,
    k_anonymity_floor: PARAMS.K_ANONYMITY,
    cross_version: true, // disclosed, never silent (F7)
    rollup: published ? view(allReviews) : { sample_size: distinctReceipts, score: null },
    per_version: versions.map((v) => ({
      subject: v.subject,
      published: v.published,
      views: v.views,
      distinct_receipts: v.distinct_receipts,
    })),
  };
}

module.exports = { RENDERING_VERSION, PARAMS, renderOffering, renderEntity, renderCrossVersion, round4 };
