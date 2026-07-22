#!/usr/bin/env node
'use strict';

// ============================================================================
// TASTER DEMONSTRATOR — NOT PRODUCTION, NOT A LIVE INTEGRATION.
// ============================================================================
//
// The "decide" taste from docs/taster-mode.md: an agent choosing between two
// candidate tools, and the choice flipping once it consults an AudienceScore
// rendering. Reading a score signs nothing, so this whole flow clears no gate
// and has no Sybil surface — it is the demand-side on-ramp, safe to run wide
// open.
//
// It never issues a receipt, never submits a review, and never rewards anyone
// for rating. It stays strictly on the read side, which is the only side with
// unlimited safe upside (spec §10; threat model T-2).
//
// Run: node reference-impl/examples/taster/select-tool.js
//
// If the pilot read host is reachable it fetches and verifies a live signed
// manifest. Offline, it falls back to clearly-labeled illustrative fixtures so
// the decision logic is always demonstrable.

const path = require('node:path');

const SCORE_HOST = 'https://mcp.audiencescore.org';
const KEYS_URL = 'https://audiencescore.org/.well-known/audiencescore-keys.json';

// Two candidate tools an agent is choosing between for the same job.
const CANDIDATES = [
  { tool: 'tool-a', offering: 'field-elevate-demo@v1' },
  { tool: 'tool-b', offering: 'demo-workflow@v1' },
];

// Illustrative fixtures — the SHAPE the hosted API returns, used only when the
// live host is unreachable. Not signed; the offline path skips verification and
// says so, rather than faking a valid signature.
const FIXTURES = {
  'field-elevate-demo@v1': {
    manifest: { published: true, offering: 'field-elevate-demo@v1', env: 'pilot',
      views: { all_verified: { overall: 4.6, n: 22 }, completer: { overall: 4.7, n: 14 } } },
  },
  'demo-workflow@v1': {
    manifest: { published: true, offering: 'demo-workflow@v1', env: 'pilot',
      views: { all_verified: { overall: 3.1, n: 9 }, completer: { overall: 3.0, n: 5 } } },
  },
};

async function fetchSigned(offering) {
  const url = `${SCORE_HOST}/v0/scores/${encodeURIComponent(offering)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function verifyLive(signed) {
  // Same verification any consumer runs: trusting the server is never required.
  const { verifyPayload } = require(path.join(__dirname, '..', '..', 'src', 'crypto'));
  const keys = await fetch(KEYS_URL).then((r) => r.json());
  const inKeySet = new Set((keys.keys || []).map((k) => k.key)).has(signed.signer);
  const valid = verifyPayload(signed.signer, signed.manifest, signed.sig);
  return { inKeySet, valid };
}

async function scoreFor(offering) {
  try {
    const signed = await fetchSigned(offering);
    const { inKeySet, valid } = await verifyLive(signed);
    return { manifest: signed.manifest, verified: inKeySet && valid, source: 'live' };
  } catch (err) {
    return { manifest: FIXTURES[offering].manifest, verified: null, source: 'fixture' };
  }
}

function overall(m) {
  // The number the agent actually uses to choose; unpublished => not selectable.
  if (!m || m.published === false) return null;
  return m.views?.all_verified?.overall ?? null;
}

async function main() {
  console.log('AudienceScore taster — pick a tool, then let the score decide\n');

  // 1) The naive choice: no score consulted, first candidate wins by default.
  const naive = CANDIDATES[0];
  console.log(`Without a score, an agent picks by default order: ${naive.tool}`);

  // 2) The informed choice: consult the rendering for each candidate.
  const scored = [];
  for (const c of CANDIDATES) {
    const s = await scoreFor(c.offering);
    const o = overall(s.manifest);
    scored.push({ ...c, overall: o, verified: s.verified, source: s.source });
    const badge = s.source === 'live'
      ? (s.verified ? 'verified live' : 'live, UNVERIFIED — do not trust')
      : 'illustrative fixture (offline)';
    console.log(`  ${c.tool}  <-  ${c.offering}  score=${o ?? 'unpublished'}  [${badge}]`);
  }

  const selectable = scored.filter((s) => typeof s.overall === 'number');
  if (selectable.length === 0) {
    console.log('\nNo published score above the k-anonymity floor — the agent keeps its default.');
    return;
  }
  const best = selectable.sort((a, b) => b.overall - a.overall)[0];

  console.log(`\nWith the score, the agent picks: ${best.tool} (overall ${best.overall})`);
  if (best.tool !== naive.tool) {
    console.log('The choice flipped — that flip is what a queried score buys.');
  } else {
    console.log('Same pick this time, now backed by a signed, recomputable reason.');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
