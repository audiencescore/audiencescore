'use strict';

// Serverless entry for the AudienceScore MCP read API (Streamable HTTP). Reuses
// the same transport and score provider as the standalone server, so the wire
// behavior is identical whether run locally or hosted. Read-only, pilot-labeled.

const { buildServer } = require('../src/mcp-http-server');
const { handleMcp } = require('../src/mcp-streamable');

// One provider per warm instance; the demonstrator rendering key is ephemeral
// per cold start (a production deployment publishes a stable key via governance).
const server = buildServer();

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = async (req, res) => {
  const raw = req.method === 'POST' ? await readRawBody(req) : '';
  const out = handleMcp(req.method, req.headers, raw, server);
  res.writeHead(out.status, out.headers);
  res.end(out.body);
};
