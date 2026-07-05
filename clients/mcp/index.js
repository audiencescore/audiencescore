#!/usr/bin/env node
'use strict';

// Stdio↔HTTP bridge for the AudienceScore MCP: exposes the hosted read API to
// clients that speak MCP over stdio. Every JSON-RPC message is forwarded to the
// remote Streamable-HTTP endpoint and the response is returned. Zero
// dependencies; the endpoint is overridable with AUDIENCESCORE_MCP_URL.

const readline = require('node:readline');

const ENDPOINT = process.env.AUDIENCESCORE_MCP_URL || 'https://mcp.audiencescore.org/mcp';

async function forward(message) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(message),
  });
  if (res.status === 202) return null; // notification acknowledged, no body
  return res.json();
}

function write(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
  }
  try {
    const response = await forward(message);
    if (response) write(response);
  } catch (err) {
    if (message.id !== undefined) {
      write({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: `bridge error: ${err.message}` } });
    }
  }
});
