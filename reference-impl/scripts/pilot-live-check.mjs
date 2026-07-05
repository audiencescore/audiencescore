#!/usr/bin/env node
// Live acceptance + security check for a DEPLOYED AudienceScore pilot.
//
// Unlike test/pilot/api.test.js (in-process objects), this drives the real
// HTTP surface of a running deployment — the check you run right after the
// pilot goes live on the server, and on a schedule after that.
//
// Two steps, because minting a receipt requires issuer-key (admin) access by
// design — there is deliberately no public "issue me a receipt" endpoint:
//
//   1. On the box, issue a throwaway test receipt:
//        node src/pilot/admin.js create-issuer --issuer-id smoke --name "Smoke Test"      # once
//        node src/pilot/admin.js add-offering  --issuer-id smoke --offering-id smoke --version v1 \
//             --name "Smoke" --price-cents 100 --component provider=smoke                 # once
//        node src/pilot/admin.js issue-manual  --issuer-id smoke --offering smoke@v1 \
//             --amount-cents 100 --external-ref smoke-$(date +%s) > /tmp/smoke-receipt.json
//   2. Run this against the public URL, passing that receipt:
//        BASE_URL=https://api.audiencescore.org node scripts/pilot-live-check.mjs \
//             --receipt /tmp/smoke-receipt.json --offering smoke@v1
//
// Each run consumes one receipt (single-use), so mint a fresh one per run.
// Exit code is non-zero if any check fails.

import { readFileSync } from 'node:fs';
import { verifyPayload, canonicalize } from '../src/crypto.js';
import { renderOffering } from '../src/v02/rendering.js';

const BASE = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) => (a.startsWith('--') ? [[a.slice(2), arr[i + 1]]] : [])),
);
const OFFERING = args.offering || 'smoke@v1';
const receipt = JSON.parse(readFileSync(args.receipt, 'utf8')).receipt ?? JSON.parse(readFileSync(args.receipt, 'utf8'));

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  ok ? pass++ : fail++;
}
const enc = (s) => encodeURIComponent(s);
async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

console.log(`AudienceScore pilot live check → ${BASE}  (offering ${OFFERING})\n`);

// --- liveness + honest pilot labelling ---
const health = await get('/health');
check('health is up and env=pilot', health.status === 200 && health.body.env === 'pilot');
const llm = await fetch(`${BASE}/docs/copy-to-llm`).then((r) => r.text());
check('copy-to-llm carries the pilot / pre-audit disclosure', /pilot/i.test(llm) && /audit/i.test(llm));

// --- signed score + independent recompute (the "trust no one" property) ---
// A correct verifier recomputes at the window_end the MANIFEST carries, not "now".
const signed = await get(`/v0/scores/${enc(OFFERING)}`);
check('score manifest is Ed25519-signed and verifies', verifyPayload(signed.body.signer, signed.body.manifest, signed.body.sig));
check('manifest is pilot-labelled', signed.body.manifest?.env === 'pilot');
const win = signed.body.manifest.window_end;
const reSigned = await get(`/v0/scores/${enc(OFFERING)}?window_end=${enc(win)}`);
const evidence = await get(`/v0/scores/${enc(OFFERING)}/evidence?window_end=${enc(win)}`);
const { env: _e, ...rawEvidence } = evidence.body;
const recomputed = { env: 'pilot', ...renderOffering(rawEvidence) };
check('score recomputes byte-identical from public evidence', canonicalize(recomputed) === canonicalize(reSigned.body.manifest));

// --- MCP agent read path ---
const mcp = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_score', arguments: { offering: OFFERING } } });
check('MCP get_score returns a structured, pilot-labelled manifest', mcp.body?.result?.structuredContent?.manifest?.env === 'pilot');

// --- write path: a valid receipt mints exactly one review ---
const good = await post('/v0/reviews', { receipt, review: { overall: 5, facets: {}, text: 'live-check' } });
check('valid receipt is accepted (201) and classed verified', good.status === 201 && /verified/i.test(good.body.reviewClass || good.body.review_class || ''));

// --- security: every one of these MUST be refused ---
const reuse = await post('/v0/reviews', { receipt, review: { overall: 1 } });
check('double-spend: reusing the same receipt is refused (409)', reuse.status === 409);
const none = await post('/v0/reviews', { review: { overall: 5 } });
check('no receipt is refused (400)', none.status === 400);
const badIssuer = await post('/v0/reviews', { receipt: { ...receipt, issuer: `ed25519:${'00'.repeat(32)}` }, review: { overall: 5 } });
check('tampered issuer breaks the signature and is refused (400)', badIssuer.status === 400);
const forged = await post('/v0/reviews', { receipt: { ...receipt, receipt_id: '019f0000-0000-7000-8000-000000000000' }, review: { overall: 5 } });
check('receipt_id never issued by this ledger is refused (400)', forged.status === 400);
const { env: _pe, ...noEnv } = receipt;
const stripped = await post('/v0/reviews', { receipt: noEnv, review: { overall: 5 } });
check('receipt with the pilot env marker stripped is refused (400)', stripped.status === 400);

console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
