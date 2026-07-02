#!/usr/bin/env node
'use strict';

// A minimal Model Context Protocol server exposing the score renderer as a
// queryable tool. Speaks JSON-RPC 2.0 over stdio (newline-delimited), with
// no dependencies, so any MCP-capable agent can query a score and verify
// the signature on the returned manifest without trusting this process.
//
// Usage: node src/mcp-server.js <event-log.jsonl>

const fs = require('node:fs');
const readline = require('node:readline');
const { generateKeyPair } = require('./crypto');
const { EventLog } = require('./events');
const { renderScore, signManifest } = require('./score');

const PROTOCOL_VERSION = '2025-06-18';

const logPath = process.argv[2];
if (!logPath) {
  process.stderr.write('usage: mcp-server.js <event-log.jsonl>\n');
  process.exit(1);
}
const eventLog = EventLog.fromJSONL(fs.readFileSync(logPath, 'utf8'));
if (!eventLog.verifyChain()) {
  process.stderr.write('event log failed chain verification; refusing to serve\n');
  process.exit(1);
}

// Demo rendering key: ephemeral per process. A production deployment
// publishes and rotates its rendering key through governance.
const renderingKey = generateKeyPair();

const TOOLS = [
  {
    name: 'get_score',
    description:
      'Get the audience score for a vendor: percent verified thumbs-up over ' +
      'attestation-gated verdicts, with a Wilson lower bound and sample size. ' +
      'Returns a signed score manifest that the caller can verify.',
    inputSchema: {
      type: 'object',
      properties: {
        vendor_id: { type: 'string', description: 'Vendor identifier' },
        state: { type: 'string', description: 'Optional US state code to scope the score, e.g. "NC"' },
      },
      required: ['vendor_id'],
    },
  },
];

function handle(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'audiencescore', version: '0.1.0' },
    });
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'tools/call') {
    if (params.name !== 'get_score') {
      return replyError(id, -32602, `unknown tool: ${params.name}`);
    }
    const { vendor_id: vendorId, state = null } = params.arguments ?? {};
    const manifest = renderScore(eventLog.events, {
      vendorId,
      state,
      now: new Date().toISOString(),
    });
    const signed = signManifest(manifest, renderingKey.privateKey, renderingKey.publicKey);
    return reply(id, {
      content: [{ type: 'text', text: JSON.stringify(signed, null, 2) }],
      structuredContent: signed,
    });
  }
  if (id !== undefined) return replyError(id, -32601, `method not found: ${method}`);
  return null;
}

function reply(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function replyError(id, code, msg) {
  return { jsonrpc: '2.0', id, error: { code, message: msg } };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(JSON.stringify(replyError(null, -32700, 'parse error')) + '\n');
    return;
  }
  const response = handle(message);
  if (response) process.stdout.write(JSON.stringify(response) + '\n');
});
