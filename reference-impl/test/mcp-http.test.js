'use strict';

// The Streamable-HTTP MCP transport: the wire format a stock client speaks when
// it adds the server by URL.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { handleMcp } = require('../src/mcp-streamable');
const { createRequestListener } = require('../src/mcp-http-server');
const { PilotRuntime } = require('../src/pilot/runtime');
const { mcpServer } = require('../src/pilot/mcp');

function runtime() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-mcp-'));
  const r = new PilotRuntime({
    dataDir: dir,
    keysDir: path.join(dir, 'keys'),
    dbPath: path.join(dir, 'pilot.sqlite'),
    outboxDir: path.join(dir, 'outbox'),
    allowedOrigins: ['https://audiencescore.org'],
  });
  r.createIssuer({ issuerId: 'field-elevate-pilot', name: 'Field Elevate Pilot' });
  r.addOffering({ issuerId: 'field-elevate-pilot', offeringId: 'field-elevate-demo', version: 'v1', name: 'Demo', priceCents: 10000, components: { service: 'ent_demo' } });
  return r;
}

const server = () => mcpServer(runtime());
const post = (body, headers = {}) => handleMcp('POST', { 'content-type': 'application/json', ...headers }, JSON.stringify(body), server());

test('initialize issues a session id and negotiates the protocol version', () => {
  const out = post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(out.status, 200);
  assert.match(out.headers['mcp-session-id'], /[0-9a-f-]{36}/);
  const r = JSON.parse(out.body).result;
  assert.equal(r.protocolVersion, '2025-06-18');
  assert.equal(r.serverInfo.name, 'audiencescore-pilot');
  assert.ok(r.instructions.length > 0);
});

test('an unsupported requested protocol falls back to the server default', () => {
  const r = JSON.parse(post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }).body).result;
  assert.equal(r.protocolVersion, '2025-06-18');
});

test('notifications are acknowledged with 202 and no body', () => {
  const out = post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(out.status, 202);
  assert.equal(out.body, '');
});

test('tools/list exposes score and evidence tools, requiring offering', () => {
  const tools = JSON.parse(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).body).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['get_score', 'get_score_evidence']);
  assert.deepEqual(tools[0].inputSchema.required, ['offering']);
});

test('tools/call get_score returns a signed, pilot-labeled manifest', () => {
  const sc = JSON.parse(post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_score', arguments: { offering: 'field-elevate-demo@v1' } } }).body).result.structuredContent;
  assert.equal(sc.manifest.env, 'pilot');
  assert.equal(sc.manifest.rendering_version, 'audiencescore/rendering@1');
  assert.ok(sc.sig, 'manifest is signed');
});

test('tools/call get_score_evidence returns de-identified rendering input', () => {
  const ev = JSON.parse(post({ jsonrpc: '2.0', id: 33, method: 'tools/call', params: { name: 'get_score_evidence', arguments: { offering: 'field-elevate-demo@v1' } } }).body).result.structuredContent;
  assert.equal(ev.env, 'pilot');
  assert.equal(ev.offering.offering, 'field-elevate-demo@v1');
});

test('an unknown tool is a tool-level error, not a transport failure', () => {
  const out = post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(out.status, 200);
  assert.ok(JSON.parse(out.body).error);
});

test('GET declines streaming with 405 and OPTIONS preflights with 204', () => {
  assert.equal(handleMcp('GET', {}, '', server()).status, 405);
  assert.equal(handleMcp('OPTIONS', {}, '', server()).status, 204);
});

test('invalid protocol headers and disallowed origins are rejected', () => {
  assert.equal(post({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, { 'mcp-protocol-version': '2099-01-01' }).status, 400);
  assert.equal(post({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { origin: 'https://attacker.example' }).status, 403);
  const ok = post({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, { origin: 'https://audiencescore.org' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['access-control-allow-origin'], 'https://audiencescore.org');
  const local = post({ jsonrpc: '2.0', id: 8, method: 'tools/list' }, { origin: 'http://localhost:5173' });
  assert.equal(local.status, 200);
  assert.equal(local.headers['access-control-allow-origin'], 'http://localhost:5173');
});

test('malformed JSON is a JSON-RPC parse error', () => {
  const out = handleMcp('POST', { 'content-type': 'application/json' }, '{bad', server());
  assert.equal(out.status, 400);
  assert.equal(JSON.parse(out.body).error.code, -32700);
});

test('standalone read listener serves v0.2 REST score and evidence routes', async () => {
  const provider = server();
  const app = http.createServer(createRequestListener(provider));
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const health = await fetch(`${base}/health`).then((r) => r.json());
    assert.equal(health.ok, true);
    const score = await fetch(`${base}/v0/scores/field-elevate-demo%40v1`).then((r) => r.json());
    assert.equal(score.manifest.env, 'pilot');
    assert.equal(score.manifest.rendering_version, 'audiencescore/rendering@1');
    const evidence = await fetch(`${base}/v0/scores/field-elevate-demo%40v1/evidence`).then((r) => r.json());
    assert.equal(evidence.env, 'pilot');
    assert.equal(evidence.offering.offering, 'field-elevate-demo@v1');
  } finally {
    app.close();
    provider.runtime.close();
  }
});

test('proxy listener forwards requests to the upstream and returns its response', async () => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body: raw, headers: req.headers });
      res.writeHead(201, {
        'content-type': 'application/json',
        'mcp-session-id': 'session-from-upstream',
        'connection': 'keep-alive',
      });
      res.end(JSON.stringify({ from: 'upstream' }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const { createProxyListener } = require('../src/mcp-http-server');
  const proxy = http.createServer(createProxyListener(`http://127.0.0.1:${upstream.address().port}`));
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${proxy.address().port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': 'client-session',
        'origin': 'https://audiencescore.org',
        'proxy-authorization': 'Basic not-for-upstream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('mcp-session-id'), 'session-from-upstream');
    assert.deepEqual(await res.json(), { from: 'upstream' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].url, '/mcp');
    assert.equal(JSON.parse(seen[0].body).method, 'tools/list');
    assert.equal(seen[0].headers['mcp-session-id'], 'client-session');
    assert.equal(seen[0].headers.origin, 'https://audiencescore.org');
    assert.equal(seen[0].headers['proxy-authorization'], undefined);
  } finally {
    proxy.close();
    upstream.close();
  }
});

test('proxy listener passes GET reads through with query strings intact', async () => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ url: req.url }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const { createProxyListener } = require('../src/mcp-http-server');
  const proxy = http.createServer(createProxyListener(`http://127.0.0.1:${upstream.address().port}/`));
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const out = await fetch(`http://127.0.0.1:${proxy.address().port}/v0/scores/x%40v1?window_end=2026-01-01`).then((r) => r.json());
    assert.equal(out.url, '/v0/scores/x%40v1?window_end=2026-01-01');
  } finally {
    proxy.close();
    upstream.close();
  }
});

test('proxy listener fails closed with 502 when the upstream is unreachable — never fabricates data', async () => {
  const dead = http.createServer(() => {});
  await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
  const port = dead.address().port;
  await new Promise((resolve) => dead.close(resolve));
  const { createProxyListener } = require('../src/mcp-http-server');
  const proxy = http.createServer(createProxyListener(`http://127.0.0.1:${port}`));
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${proxy.address().port}/v0/scores/x%40v1`);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, 'upstream pilot server unreachable');
    assert.equal(body.env, 'pilot');
  } finally {
    proxy.close();
  }
});
