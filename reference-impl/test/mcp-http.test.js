'use strict';

// The Streamable-HTTP MCP transport: the wire format a stock client speaks when
// it adds the server by URL.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPair } = require('../src/crypto');
const { EventLog } = require('../src/events');
const { scoreServer } = require('../src/mcp-tools');
const { handleMcp } = require('../src/mcp-streamable');

const server = () => scoreServer(new EventLog(), generateKeyPair(), { env: 'pilot' });
const post = (body, headers = {}) => handleMcp('POST', { 'content-type': 'application/json', ...headers }, JSON.stringify(body), server());

test('initialize issues a session id and negotiates the protocol version', () => {
  const out = post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(out.status, 200);
  assert.match(out.headers['mcp-session-id'], /[0-9a-f-]{36}/);
  const r = JSON.parse(out.body).result;
  assert.equal(r.protocolVersion, '2025-06-18');
  assert.equal(r.serverInfo.name, 'audiencescore');
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

test('tools/list exposes exactly get_score, requiring vendor_id', () => {
  const tools = JSON.parse(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).body).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['get_score']);
  assert.deepEqual(tools[0].inputSchema.required, ['vendor_id']);
});

test('tools/call get_score returns a signed, pilot-labeled manifest', () => {
  const sc = JSON.parse(post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_score', arguments: { vendor_id: 'x' } } }).body).result.structuredContent;
  assert.equal(sc.env, 'pilot');
  assert.ok(sc.sig, 'manifest is signed');
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

test('malformed JSON is a JSON-RPC parse error', () => {
  const out = handleMcp('POST', { 'content-type': 'application/json' }, '{bad', server());
  assert.equal(out.status, 400);
  assert.equal(JSON.parse(out.body).error.code, -32700);
});
