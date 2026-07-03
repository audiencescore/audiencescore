#!/usr/bin/env node
'use strict';

// End-to-end demo: verified receipt -> single-use review right -> signed
// verdict event on a hash-chained log -> deterministic score rendering ->
// MCP query returning a signed score manifest, verified client-side.
//
// Run: node reference-impl/demo.js

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  generateKeyPair,
  publicKeyToString,
  verifyPayload,
} = require('./src/crypto');
const { createEvent, EventLog } = require('./src/events');
const { issueVendorReceipt, RightsRegistry } = require('./src/receipts');
const { renderScore } = require('./src/score');

function step(title) {
  console.log(`\n=== ${title} ===`);
}

const VENDOR_ID = 'sparkle-car-wash';
const STATE = 'CO';

step('1. Keys');
const vendor = generateKeyPair();
const vendorKey = publicKeyToString(vendor.publicKey);
console.log(`vendor ${VENDOR_ID} key: ${vendorKey.slice(0, 24)}…`);

step('2. Vendor issues signed receipts (one per real transaction)');
const receipts = [];
for (let i = 1; i <= 12; i++) {
  receipts.push(
    issueVendorReceipt({
      vendorPrivateKey: vendor.privateKey,
      vendorPublicString: vendorKey,
      vendorId: VENDOR_ID,
      txId: `tx-${String(i).padStart(3, '0')}`,
      amountCents: 2500,
      currency: 'USD',
      issuedAt: new Date(Date.now() - i * 86_400_000).toISOString(),
      locality: { country: 'US', state: STATE },
    }),
  );
}
console.log(`issued ${receipts.length} receipts`);

step('3. Review rights: one per receipt, single-use');
const registry = new RightsRegistry();
const rights = receipts.map((r) => registry.mint(r, vendorKey));
console.log(`minted ${rights.length} review rights`);
try {
  registry.mint(receipts[0], vendorKey);
} catch (err) {
  console.log(`duplicate mint rejected: ${err.message}`);
}

step('4. Signed verdicts on the hash-chained log');
const log = new EventLog();
rights.forEach((right, i) => {
  const reviewer = generateKeyPair();
  registry.spend(right.right_id);
  const verdict = i < 9 ? 'up' : 'down'; // 9 up, 3 down
  const event = createEvent({
    type: 'verdict',
    prev: log.head(),
    privateKey: reviewer.privateKey,
    signerString: publicKeyToString(reviewer.publicKey),
    body: {
      verdict,
      dimensions: { quality: verdict === 'up', on_time: true, price: null, service: null },
      narrative: null,
      vendor: { id: VENDOR_ID, locality: { country: 'US', state: STATE } },
      service_locality: { state: STATE },
      receipt: { tier: right.tier, right_id: right.right_id, proof_hash: right.proof_hash },
      issued_at: new Date().toISOString(),
    },
  });
  log.append(event);
});
console.log(`log: ${log.events.length} verdict events, chain verified: ${log.verifyChain()}`);
try {
  registry.spend(rights[0].right_id);
} catch (err) {
  console.log(`double-spend rejected: ${err.message}`);
}

step('5. Tamper evidence');
const tampered = EventLog.fromJSONL(log.toJSONL());
// Flip a verdict to its opposite, so this is always a real mutation.
const victim = tampered.events[4].body;
victim.verdict = victim.verdict === 'up' ? 'down' : 'up';
const stillValid = tampered.verifyChain();
console.log(`flipped one verdict in a copy; chain verified: ${stillValid} (expected false)`);
if (stillValid) {
  console.error('TAMPER CHECK FAILED: a mutated log still verified');
  process.exit(1);
}

step('6. Deterministic score rendering');
const manifest = renderScore(log.events, {
  vendorId: VENDOR_ID,
  state: STATE,
  now: new Date().toISOString(),
});
console.log(JSON.stringify(manifest, null, 2));

step('7. Query over MCP and verify the signed manifest');
const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audiencescore-')), 'events.jsonl');
fs.writeFileSync(logFile, log.toJSONL());

const server = spawn(process.execPath, [path.join(__dirname, 'src', 'mcp-server.js'), logFile], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

const requests = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'demo-client', version: '0.1.0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_score', arguments: { vendor_id: VENDOR_ID, state: STATE } } },
];
for (const req of requests) server.stdin.write(JSON.stringify(req) + '\n');
server.stdin.end();

let buffer = '';
server.stdout.on('data', (chunk) => (buffer += chunk));
server.on('close', () => {
  const responses = buffer.trim().split('\n').map((l) => JSON.parse(l));
  const init = responses.find((r) => r.id === 1);
  console.log(`server: ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);
  const tools = responses.find((r) => r.id === 2);
  console.log(`tools: ${tools.result.tools.map((t) => t.name).join(', ')}`);
  const call = responses.find((r) => r.id === 3);
  const signed = call.result.structuredContent;
  const valid = verifyPayload(signed.signer, signed.manifest, signed.sig);
  console.log(`score for ${VENDOR_ID} (${STATE}): ${signed.manifest.score} ` +
    `(wilson lower bound ${signed.manifest.wilson_lower_bound}, n=${signed.manifest.sample_size})`);
  console.log(`manifest signature verified: ${valid}`);
  fs.rmSync(path.dirname(logFile), { recursive: true, force: true });
  if (!valid) process.exit(1);
  console.log('\nDemo complete: receipt in -> verdict signed -> score rendered -> score queried over MCP.');
});
