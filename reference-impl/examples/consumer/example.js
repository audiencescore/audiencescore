#!/usr/bin/env node
'use strict';

// ============================================================================
// CONSUMER EXAMPLE — the drop-in tool-selector, run end to end.
// ============================================================================
//
// Shows an agent ranking candidate tools by their VERIFIED AudienceScore, using
// the reusable helper in ./audiencescore-select.js. Read-side only: it issues
// no receipt, submits no review, rewards no one for rating (spec §10; T-2).
// Same env:"pilot", pre-audit posture as the rest of the repo.
//
// Run: node reference-impl/examples/consumer/example.js
//
// To make verification REAL and runnable with no network, this example signs
// its own demo manifests with a locally generated Ed25519 key using the SAME
// crypto the protocol uses, and feeds them through an injected fetch. So the
// signatures you see verify are genuine — not stubbed — and you can watch the
// helper (a) rank by verified score, (b) reject a tampered manifest, (c) reject
// a valid signature from a stranger key once the key set is pinned, and (d)
// refuse to use a below-floor (published:false) rendering. Then it probes the
// real pilot host once, live, and reports whatever it finds.

const path = require('node:path');
const {
  generateKeyPair, publicKeyToString, signPayload,
} = require(path.join(__dirname, '..', '..', 'src', 'crypto'));
const {
  rankTools, evaluateSigned, DEFAULT_HOST,
} = require('./audiencescore-select');

// --- build genuinely-signed demo renderings (rendering v1 shape) -------------

const trusted = generateKeyPair();
const trustedSigner = publicKeyToString(trusted.publicKey);
const stranger = generateKeyPair();
const strangerSigner = publicKeyToString(stranger.publicKey);

// A rendering v1 manifest, matching src/v02/rendering.js: published gate,
// views.all_verified.{score,sample_size}. Not the hosted data — a local demo.
function manifest({ offering, published, score, n }) {
  return {
    env: 'pilot',
    rendering_version: 'rendering-v1',
    subject: `offering:${offering}`,
    window_end: '2026-07-01T00:00:00.000Z',
    published,
    distinct_receipts: n,
    k_anonymity_floor: 10,
    purchase_gate: true,
    standing_class: 'verified_purchaser',
    views: published
      ? { all_verified: { sample_size: n, score }, completers: { sample_size: n, score } }
      : { all_verified: { sample_size: n, score: null }, completers: { sample_size: 0, score: null } },
  };
}

function sign(key, signer, m) {
  return { manifest: m, signer, sig: signPayload(key.privateKey, m) };
}

// The demo score "database" the injected fetch serves.
const SIGNED = {
  // Two well-scored, verified offerings the agent is choosing between.
  'tool-strong@v1': sign(trusted, trustedSigner, manifest({ offering: 'tool-strong@v1', published: true, score: 4.6, n: 22 })),
  'tool-weak@v1': sign(trusted, trustedSigner, manifest({ offering: 'tool-weak@v1', published: true, score: 3.1, n: 14 })),
  // Below the k-anonymity floor: honest published:false, no number.
  'tool-newcomer@v1': sign(trusted, trustedSigner, manifest({ offering: 'tool-newcomer@v1', published: false, score: null, n: 4 })),
  // A stranger self-signs a glowing score with a key NOT in the published set.
  'tool-impostor@v1': sign(stranger, strangerSigner, manifest({ offering: 'tool-impostor@v1', published: true, score: 5.0, n: 99 })),
};

// A tampered copy of a good score: valid-looking, but the number was edited
// after signing, so the signature must fail.
const TAMPERED = (() => {
  const good = SIGNED['tool-strong@v1'];
  return { signer: good.signer, sig: good.sig, manifest: { ...good.manifest, views: { ...good.manifest.views, all_verified: { sample_size: 22, score: 5.0 } } } };
})();
SIGNED['tool-tampered@v1'] = TAMPERED;

// The published key set the consumer pins to: the trusted signer only.
const KEYS_BODY = { keys: [{ key: trustedSigner }] };

// Injected fetch: serves the local signed manifests + key set. No network.
function offlineFetch(url) {
  const u = String(url);
  if (u.endsWith('/audiencescore-keys.json') || u.includes('.well-known')) {
    return Promise.resolve({ ok: true, json: async () => KEYS_BODY });
  }
  const m = u.match(/\/v0\/scores\/([^/?]+)/);
  if (m) {
    const offering = decodeURIComponent(m[1]);
    const signed = SIGNED[offering];
    if (!signed) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => signed });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
}

// --- run ---------------------------------------------------------------------

async function main() {
  console.log('AudienceScore consumer example — rank candidate tools by verified score\n');

  // Sanity: the two building-block checks the helper is built on, shown out loud.
  const okEval = evaluateSigned(SIGNED['tool-strong@v1'], { trustedKeys: new Set([trustedSigner]) });
  const tamperEval = evaluateSigned(TAMPERED, { trustedKeys: new Set([trustedSigner]) });
  const strangerEval = evaluateSigned(SIGNED['tool-impostor@v1'], { trustedKeys: new Set([trustedSigner]) });
  console.log('verify checks (trusting the server is never required):');
  console.log(`  genuine signed score   -> verified=${okEval.verified}  (${okEval.reason})`);
  console.log(`  tampered after signing -> verified=${tamperEval.verified}  (${tamperEval.reason})`);
  console.log(`  stranger key, valid sig-> verified=${strangerEval.verified}  (${strangerEval.reason})`);

  if (okEval.verified !== true || tamperEval.verified !== false || strangerEval.verified !== false) {
    throw new Error('verify invariants failed — the helper is not enforcing the read/verify path');
  }

  // The agent's candidate set for one job. Naive default is input order (tool-weak).
  const candidates = [
    { tool: 'weak-tool', offering: 'tool-weak@v1' },
    { tool: 'strong-tool', offering: 'tool-strong@v1' },
    { tool: 'impostor-tool', offering: 'tool-impostor@v1' },
    { tool: 'newcomer-tool', offering: 'tool-newcomer@v1' },
  ];

  console.log(`\nWithout a score, an agent picks by default order: ${candidates[0].tool}`);

  const ranked = await rankTools(candidates, {
    fetchImpl: offlineFetch,
    pinToKeySet: true,      // fetch + enforce the published key set
    preferScored: true,     // tools with a usable verified score sort ahead
  });

  console.log('\nRanked by verified AudienceScore:');
  for (const r of ranked) {
    const badge = r.usable ? `score=${r.score} (n=${r.sampleSize}, verified)` : 'no usable score';
    console.log(`  ${r.tool.padEnd(14)} ${badge.padEnd(34)} ${r.reason}`);
  }

  const best = ranked[0];
  console.log(`\nWith the score, the agent picks: ${best.tool} (${best.usable ? 'score ' + best.score : 'no score'})`);
  if (best.tool !== candidates[0].tool) {
    console.log('The choice flipped — that flip is what a queried, verified score buys.');
  }
  console.log('Note: the impostor\'s 5.0 was signed by a key outside the published set, so it never ranked.');
  console.log('Note: the newcomer is below the k-anonymity floor — no fabricated number, so it is not preferred.');

  // Assert the demonstration actually demonstrates.
  if (best.tool !== 'strong-tool') throw new Error(`expected strong-tool to win, got ${best.tool}`);
  if (ranked.some((r) => r.tool === 'impostor-tool' && r.usable)) throw new Error('impostor score was used — pinning failed');

  // --- live probe (optional; no failure if the host is unreachable) ----------
  console.log(`\nProbing the real pilot read host once (${DEFAULT_HOST}) ...`);
  try {
    const live = await rankTools(
      [{ tool: 'field-elevate', offering: 'field-elevate-demo@v1' }],
      { host: DEFAULT_HOST, pinToKeySet: true },
    );
    const r = live[0];
    if (r && r.usable) {
      console.log(`  live: ${r.tool} score=${r.score} (n=${r.sampleSize}, verified against published key set)`);
    } else if (r) {
      console.log(`  live: reachable but not usable — ${r.reason}`);
    } else {
      console.log('  live: no result');
    }
  } catch (err) {
    console.log(`  live host not reachable from here (${err.message}); offline demo above is the proof of the path.`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
