'use strict';

// Serverless entry for the AudienceScore pilot read API. Reuses the same
// Streamable-HTTP MCP transport and v0.2 pilot score/evidence provider as the
// standalone server, so hosted and local behavior stay identical.

const { buildServer } = require('../src/mcp-http-server');
const { handleMcp } = require('../src/mcp-streamable');

// One provider per warm instance. Set AUDIENCESCORE_PILOT_RENDERING_PRIVATE_KEY_PEM
// in hosted deployments so score signatures are stable and publicly pinnable.
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
