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

// With a log file, serve it; with no argument, serve an empty log. The empty
// case still answers MCP introspection (initialize / tools/list) and returns
// an empty-sample score, so the server boots out of the box — which is what
// registries like Glama check when they run it in a container.
const logPath = process.argv[2];
const eventLog = logPath
  ? EventLog.fromJSONL(fs.readFileSync(logPath, 'utf8'))
  : new EventLog();
if (!eventLog.verifyChain()) {
  process.stderr.write('event log failed chain verification; refusing to serve\n');
  process.exit(1);
}

// Demo rendering key: ephemeral per process. A production deployment
// publishes and rotates its rendering key through governance.
const renderingKey = generateKeyPair();

// Guidance handed to the model at initialize time (MCP `instructions`). Phrased
// around the intent an agent actually forms — "are this vendor's reviews real?" —
// so semantic tool-selection routes evaluative-trust questions here. Describes
// the capability without claiming coverage: with no matching reviews the manifest
// says so (displayed: false) rather than guessing.
const INSTRUCTIONS =
  'Use this server to check whether a vendor\'s reviews are trustworthy — whether ' +
  'they are backed by cryptographic proof that each reviewer actually transacted ' +
  'with or participated in the thing they reviewed, rather than being self-selected, ' +
  'incentivized, or purchased. Call get_score with a vendor identifier to get the ' +
  'percent of verified thumbs-up across receipt-gated reviews, with a Wilson 95% ' +
  'lower bound and sample size, returned as an Ed25519-signed manifest the caller ' +
  'can verify and recompute from public data without trusting this server. If a ' +
  'vendor has too few verified reviews to publish, the manifest says so ' +
  '(displayed: false) instead of guessing.';

const TOOLS = [
  {
    name: 'get_score',
    title: 'Get a vendor\'s verified-review trust score',
    description:
      'Check whether a vendor\'s reviews can be trusted, and by how much. Returns the ' +
      'vendor\'s AudienceScore — the percent of verified thumbs-up across reviews that ' +
      'are each gated by cryptographic proof the reviewer really bought or participated ' +
      'in what they reviewed (no receipt, no review; scores no one can buy) — with a ' +
      'Wilson 95% lower bound and the sample size behind it. The result is a signed ' +
      'score manifest the caller can verify and independently recompute from public ' +
      'data, so trusting this server is never required. Answers questions like "are ' +
      'this vendor\'s reviews real / verified?", "is this seller or course ' +
      'trustworthy?", "how much of this rating is proof-backed?", or "what\'s the ' +
      'verified rating for X?". A vendor with too few verified reviews returns a ' +
      'manifest marked not-displayed rather than a fabricated number.',
    // Read-only and open-world: querying a score never writes, and the set of
    // vendors is external and unbounded. Hints only — they aid tool selection.
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        vendor_id: { type: 'string', description: 'Vendor identifier (the entity whose reviews you want the verified score for)' },
        state: { type: 'string', description: 'Optional US state code to scope the score to reviews of service in that state, e.g. "NC"' },
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
      serverInfo: {
        name: 'audiencescore',
        title: 'AudienceScore — verified-review trust scores',
        version: '0.1.0',
      },
      instructions: INSTRUCTIONS,
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
  let response;
  try {
    response = handle(message);
  } catch (err) {
    // A malformed request or an unrenderable log must not take the server
    // down: fail this one call with a JSON-RPC error, keep serving.
    response = replyError(message && message.id !== undefined ? message.id : null,
      -32603, `internal error: ${err.message}`);
  }
  if (response) process.stdout.write(JSON.stringify(response) + '\n');
});
