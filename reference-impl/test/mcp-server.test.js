'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

// Drive the MCP server over stdio with a list of JSON-RPC requests and collect
// the responses. No log-file argument: exercises the empty-log boot path that
// MCP registries (e.g. Glama) rely on to verify the server starts and responds.
function rpc(requests) {
  return new Promise((resolve, reject) => {
    const server = spawn(
      process.execPath,
      [path.join(__dirname, '..', 'src', 'mcp-server.js')],
      { stdio: ['pipe', 'pipe', 'inherit'] },
    );
    let buffer = '';
    server.stdout.on('data', (c) => (buffer += c));
    server.on('error', reject);
    server.on('close', () => {
      try {
        resolve(buffer.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
      } catch (err) {
        reject(err);
      }
    });
    for (const r of requests) server.stdin.write(JSON.stringify(r) + '\n');
    server.stdin.end();
  });
}

test('MCP server boots with no log argument and answers introspection + get_score', async () => {
  const res = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_score', arguments: { vendor_id: 'x' } } },
  ]);

  const init = res.find((r) => r.id === 1);
  assert.equal(init.result.serverInfo.name, 'audiencescore');

  const tools = res.find((r) => r.id === 2);
  assert.deepEqual(tools.result.tools.map((t) => t.name), ['get_score']);

  const call = res.find((r) => r.id === 3);
  // Empty log → below the sample floor, so the score is not displayed.
  assert.equal(call.result.structuredContent.manifest.displayed, false);
});
