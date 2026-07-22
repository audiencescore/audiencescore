'use strict';

// ============================================================================
// AudienceScore tool-selector — a drop-in consumer helper.
// ============================================================================
//
// Drop this module into an agent to rank candidate tools by their VERIFIED
// AudienceScore before choosing one. It is the demand-side, read-only path:
//
//   * It only READS signed score renderings and verifies their signatures.
//     Reading a score signs nothing, issues no receipt, submits no review, and
//     rewards no one for rating (spec §10; threat model T-2). There is no gate
//     to clear and no Sybil surface — which is exactly why it can run wide open.
//   * "Verify, don't trust." Every rendering is Ed25519-signed; a score is only
//     allowed to influence the ranking AFTER its signature verifies with the
//     SAME verifyPayload() a production consumer runs. An unverified score is
//     discarded, never used. Optionally pin to a published key set so a validly
//     self-signed stranger key cannot pass either.
//   * "Honest below the floor." Below the k-anonymity floor a rendering returns
//     published:false with no number; this helper treats that as "no usable
//     score" rather than inventing one, and — by default — does NOT punish a
//     tool merely for lacking reviews (see preferScored / requireScore).
//
// Posture: pilot, pre-crypto-audit, read-side only. Same env: "pilot" caveat as
// the rest of the repository — this demonstrates the shape of the value, it is
// not a certification.
//
// No network happens at import time and no network happens unless you call a
// function that needs it; `fetchImpl` is injectable so this is testable and
// runnable fully offline.

const path = require('node:path');

// The real verify primitive — identical bytes-and-signature path a production
// consumer uses. Reusing it (rather than re-implementing) is the point.
const { verifyPayload } = require(path.join(__dirname, '..', '..', 'src', 'crypto'));

const DEFAULT_HOST = 'https://mcp.audiencescore.org';
const DEFAULT_KEYS_URL = 'https://audiencescore.org/.well-known/audiencescore-keys.json';

/**
 * Pull the usable overall score out of a rendering v1 manifest.
 * Returns null when the offering is below the k-anonymity floor
 * (published !== true) or the view carries no numeric score — never a
 * fabricated number.
 * @param {object} manifest a rendering v1 manifest (the `manifest` field of a signed envelope)
 * @returns {number|null}
 */
function overallScore(manifest) {
  if (!manifest || manifest.published !== true) return null;
  // Rendering v1 shape: views.all_verified.score (see src/v02/rendering.js).
  const s = manifest?.views?.all_verified?.score;
  return typeof s === 'number' && Number.isFinite(s) ? s : null;
}

/** Sample size backing the all_verified view, or 0 if absent. */
function sampleSize(manifest) {
  const n = manifest?.views?.all_verified?.sample_size;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/**
 * Evaluate one signed score envelope { manifest, signer, sig } the way any
 * consumer must. Never throws — a malformed envelope is reported, not crashed.
 *
 * @param {object} signed  { manifest, signer, sig }
 * @param {object} [opts]
 * @param {Set<string>|null} [opts.trustedKeys]  if provided, the signer must be a member
 * @returns {{
 *   verified: boolean, inKeySet: boolean|null, published: boolean,
 *   score: number|null, sampleSize: number, manifest: object|null, reason: string
 * }}
 */
function evaluateSigned(signed, { trustedKeys = null } = {}) {
  const base = {
    verified: false, inKeySet: null, published: false,
    score: null, sampleSize: 0, manifest: null, reason: '',
  };
  if (!signed || typeof signed !== 'object' || !signed.manifest || !signed.signer || !signed.sig) {
    return { ...base, reason: 'malformed signed envelope (need manifest, signer, sig)' };
  }
  let valid = false;
  try {
    valid = verifyPayload(signed.signer, signed.manifest, signed.sig);
  } catch {
    valid = false;
  }
  const inKeySet = trustedKeys ? trustedKeys.has(signed.signer) : null;
  const trusted = valid && (trustedKeys ? inKeySet : true);
  const manifest = signed.manifest;
  const published = manifest.published === true;
  const score = trusted ? overallScore(manifest) : null;
  let reason;
  if (!valid) reason = 'signature did not verify — score discarded';
  else if (trustedKeys && !inKeySet) reason = 'signer not in trusted key set — score discarded';
  else if (!published) reason = 'below k-anonymity floor (published:false) — no usable score';
  else if (score === null) reason = 'verified but no numeric all_verified score';
  else reason = `verified score ${score} over n=${sampleSize(manifest)}`;
  return {
    verified: trusted,
    inKeySet,
    published,
    score,
    sampleSize: sampleSize(manifest),
    manifest,
    reason,
  };
}

/**
 * Fetch the published key set (for signer pinning). Returns a Set of key
 * strings. Never throws: on any failure it returns an empty set, and the caller
 * decides whether an empty set (i.e. pin nothing) is acceptable.
 * @param {object} [opts]
 * @param {string} [opts.keysUrl]
 * @param {Function} [opts.fetchImpl] a fetch-compatible function
 * @returns {Promise<Set<string>>}
 */
async function fetchTrustedKeys({ keysUrl = DEFAULT_KEYS_URL, fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(keysUrl);
    if (!res || !res.ok) return new Set();
    const body = await res.json();
    return new Set((body.keys || []).map((k) => k.key));
  } catch {
    return new Set();
  }
}

/**
 * Fetch one signed score envelope for an offering from the read API.
 * Returns the parsed { manifest, signer, sig } or null on any failure (never
 * throws — a down endpoint must not crash a ranking).
 * @param {string} offering  e.g. "field-elevate-demo@v1"
 * @param {object} [opts]
 * @param {string} [opts.host]
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<object|null>}
 */
async function fetchScore(offering, { host = DEFAULT_HOST, fetchImpl = globalThis.fetch } = {}) {
  const url = `${host.replace(/\/+$/, '')}/v0/scores/${encodeURIComponent(offering)}`;
  try {
    const res = await fetchImpl(url);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Rank candidate tools by verified AudienceScore. This is the helper an agent
 * actually calls at tool-selection time.
 *
 * @param {Array<{tool: string, offering: string}>} candidates
 *        each candidate names a tool and the offering-version whose score to consult
 * @param {object} [opts]
 * @param {string}   [opts.host]            read API host
 * @param {string}   [opts.keysUrl]         published key set URL (used when pinning)
 * @param {Function} [opts.fetchImpl]       injectable fetch (for tests/offline)
 * @param {Set<string>|string[]|null} [opts.trustedKeys]
 *        pin signers to this set. If null and `pinToKeySet` is true, the set is
 *        fetched from keysUrl. If null and `pinToKeySet` is false, no pinning
 *        (signature-valid is enough) — weaker, and labeled as such per result.
 * @param {boolean}  [opts.pinToKeySet=true] fetch+enforce the published key set when trustedKeys not given
 * @param {number}   [opts.minSampleSize=0]  ignore scores backed by fewer than this many reviews
 * @param {boolean}  [opts.preferScored=true]
 *        when true, tools with a usable verified score sort ahead of tools
 *        without one; tools without a score keep their input order among
 *        themselves (a stable tiebreak). When false, unscored tools are dropped.
 * @param {boolean}  [opts.requireScore=false]
 *        when true, candidates with no usable verified score are excluded from
 *        the result entirely (strict mode).
 * @returns {Promise<Array<{
 *   tool: string, offering: string, score: number|null, verified: boolean,
 *   published: boolean, sampleSize: number, usable: boolean, reason: string
 * }>>} ranked best-first
 */
async function rankTools(candidates, opts = {}) {
  const {
    host = DEFAULT_HOST,
    keysUrl = DEFAULT_KEYS_URL,
    fetchImpl = globalThis.fetch,
    trustedKeys = null,
    pinToKeySet = true,
    minSampleSize = 0,
    preferScored = true,
    requireScore = false,
  } = opts;

  let keySet = null;
  if (trustedKeys) {
    keySet = trustedKeys instanceof Set ? trustedKeys : new Set(trustedKeys);
  } else if (pinToKeySet) {
    keySet = await fetchTrustedKeys({ keysUrl, fetchImpl });
    // An empty published key set means we cannot pin; fall back to
    // signature-valid-only rather than silently rejecting every score. This is
    // surfaced per-result in `reason`.
    if (keySet.size === 0) keySet = null;
  }

  const evaluated = [];
  for (const c of candidates) {
    const signed = await fetchScore(c.offering, { host, fetchImpl });
    if (!signed) {
      evaluated.push({
        tool: c.tool, offering: c.offering, score: null, verified: false,
        published: false, sampleSize: 0, usable: false,
        reason: 'no signed score available (endpoint unreachable or 4xx)',
      });
      continue;
    }
    const ev = evaluateSigned(signed, { trustedKeys: keySet });
    const belowMin = ev.score !== null && ev.sampleSize < minSampleSize;
    const usable = ev.score !== null && !belowMin;
    evaluated.push({
      tool: c.tool,
      offering: c.offering,
      score: usable ? ev.score : null,
      verified: ev.verified,
      published: ev.published,
      sampleSize: ev.sampleSize,
      usable,
      reason: belowMin
        ? `verified score ${ev.score} but n=${ev.sampleSize} < minSampleSize ${minSampleSize} — not used`
        : ev.reason,
    });
  }

  const scored = evaluated.filter((e) => e.usable);
  const unscored = evaluated.filter((e) => !e.usable);
  scored.sort((a, b) => b.score - a.score); // best score first

  if (requireScore) return scored;
  if (!preferScored) {
    // Drop unscored entirely but do not reorder relative to scored.
    return scored;
  }
  // Scored first (by score), then unscored in their original input order.
  return [...scored, ...unscored];
}

/**
 * Convenience: the single best tool, or null if nothing is selectable under the
 * given policy. In strict mode (requireScore) this returns null when no
 * candidate has a usable verified score.
 * @returns {Promise<object|null>}
 */
async function selectTool(candidates, opts = {}) {
  const ranked = await rankTools(candidates, opts);
  return ranked.length > 0 ? ranked[0] : null;
}

module.exports = {
  overallScore,
  sampleSize,
  evaluateSigned,
  fetchTrustedKeys,
  fetchScore,
  rankTools,
  selectTool,
  DEFAULT_HOST,
  DEFAULT_KEYS_URL,
};
