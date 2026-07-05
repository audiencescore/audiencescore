#!/usr/bin/env node
'use strict';

// End-to-end pilot demo: receipt issued by the v0.2 pilot runtime -> review
// admitted through the HTTP API -> score rendered -> score queried over MCP.
//
// Run: node reference-impl/demo.js

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { canonicalize } = require('./src/crypto');
const { PilotRuntime } = require('./src/pilot/runtime');
const { createServer } = require('./src/pilot/server');

const ISSUER_ID = 'demo-pilot';
const OFFERING = 'demo-workflow@v1';
const WINDOW_END = '2026-07-05T00:00:00Z';

function step(title) {
  console.log(`\n=== ${title} ===`);
}

function tempConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiencescore-pilot-demo-'));
  return {
    dataDir: dir,
    keysDir: path.join(dir, 'keys'),
    dbPath: path.join(dir, 'pilot.sqlite'),
    outboxDir: path.join(dir, 'outbox'),
    backupDir: path.join(dir, 'backups'),
    publicBaseUrl: 'http://127.0.0.1:0',
    emailMode: 'file',
  };
}

function listen(runtime) {
  const server = createServer(runtime);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function mcpCall(base, message) {
  return jsonFetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(message),
  });
}

async function main() {
  const runtime = new PilotRuntime(tempConfig());
  let server;
  try {
    step('1. Pilot issuer and offering');
    const issuer = runtime.createIssuer({ issuerId: ISSUER_ID, name: 'Demo Pilot Issuer' });
    runtime.addOffering({
      issuerId: ISSUER_ID,
      offeringId: 'demo-workflow',
      version: 'v1',
      name: 'Demo Workflow',
      priceCents: 10000,
      components: { service: 'ent_demo_workflow' },
      attestationCriteria: { l2: 'workflow completed' },
    });
    console.log(`issuer ${ISSUER_ID} key: ed25519:${issuer.publicHex.slice(0, 16)}...`);
    console.log(`offering: ${OFFERING}`);

    const listening = await listen(runtime);
    server = listening.server;
    const { base } = listening;

    step('2. Receipts issued by the pilot ledger');
    const receipts = [];
    for (let i = 1; i <= 12; i++) {
      const issued = await runtime.issueReceipt({
        issuerId: ISSUER_ID,
        offering: OFFERING,
        role: 'participant',
        amountCents: 10000,
        externalRef: `demo-tx-${String(i).padStart(3, '0')}`,
        occurredAt: `2026-07-04T12:${String(i).padStart(2, '0')}:00Z`,
      });
      receipts.push(issued.receipt);
    }
    console.log(`issued ${receipts.length} pilot receipts`);

    step('3. Reviews admitted through /v0/reviews');
    for (const [i, receipt] of receipts.entries()) {
      const overall = i < 9 ? 5 : 2;
      const admitted = await jsonFetch(`${base}/v0/reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          receipt,
          review: {
            overall,
            facets: { ent_demo_workflow: overall },
            text: null,
            posted_at: `2026-07-04T13:${String(i + 1).padStart(2, '0')}:00Z`,
          },
        }),
      });
      if (admitted.env !== 'pilot') throw new Error('review response was not pilot-labeled');
    }
    console.log(`admitted ${receipts.length} reviews`);

    try {
      await jsonFetch(`${base}/v0/reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ receipt: receipts[0], review: { overall: 4 } }),
      });
      throw new Error('duplicate review was admitted');
    } catch (err) {
      if (!/409/.test(err.message)) throw err;
      console.log('duplicate receipt reuse rejected');
    }

    step('4. Signed score rendered through REST');
    const signed = await jsonFetch(`${base}/v0/scores/${encodeURIComponent(OFFERING)}?window_end=${encodeURIComponent(WINDOW_END)}`);
    if (!runtime.verifySignedScore(signed)) throw new Error('REST score signature did not verify');
    console.log(`published: ${signed.manifest.published}`);
    console.log(`all-verified score: ${signed.manifest.views.all_verified.score}`);
    console.log('REST score signature verified');

    const evidence = await jsonFetch(`${base}/v0/scores/${encodeURIComponent(OFFERING)}/evidence?window_end=${encodeURIComponent(WINDOW_END)}`);
    const recomputed = runtime.recomputeFromEvidence(evidence);
    if (canonicalize(recomputed) !== canonicalize(signed.manifest)) {
      throw new Error('evidence did not recompute to the signed manifest');
    }
    console.log('evidence recomputes to the signed manifest');

    step('5. Query over MCP and verify the signed manifest');
    const init = await mcpCall(base, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'demo-client', version: '0.2.0' } },
    });
    console.log(`server: ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);

    const tools = await mcpCall(base, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    console.log(`tools: ${tools.result.tools.map((t) => t.name).join(', ')}`);

    const call = await mcpCall(base, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_score', arguments: { offering: OFFERING, window_end: WINDOW_END } },
    });
    const mcpSigned = call.result.structuredContent;
    if (!runtime.verifySignedScore(mcpSigned)) throw new Error('MCP score signature did not verify');
    console.log(`MCP score for ${OFFERING}: ${mcpSigned.manifest.views.all_verified.score}`);
    console.log('MCP manifest signature verified');

    console.log('\nDemo complete: receipt in -> review admitted -> score rendered -> queried over MCP.');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    runtime.close();
    fs.rmSync(runtime.config.dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
