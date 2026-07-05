'use strict';

// Standalone Streamable-HTTP MCP server for the AudienceScore pilot read API.
// Runs as a Node server and exports a (req, res) listener a serverless host can
// mount. Read-only get_score / get_score_evidence, pilot-labeled.

const http = require('node:http');
const { URL } = require('node:url');
const { handleMcp } = require('./mcp-streamable');
const { PilotRuntime } = require('./pilot/runtime');
const { mcpServer } = require('./pilot/mcp');

function ensureHostedDemoOffering(runtime) {
  const issuerId = 'field-elevate-pilot';
  const offering = 'field-elevate-demo@v1';
  const issuer = runtime.store.db.prepare('SELECT issuer_id FROM pilot_issuers WHERE issuer_id = ?').get(issuerId);
  if (!issuer) runtime.createIssuer({ issuerId, name: 'Field Elevate Pilot' });
  try {
    runtime.getOffering(offering);
  } catch {
    runtime.addOffering({
      issuerId,
      offeringId: 'field-elevate-demo',
      version: 'v1',
      name: 'Field Elevate Demo',
      priceCents: 10000,
      components: { service: 'ent_field_elevate_demo' },
      attestationCriteria: {},
    });
  }
}

function buildServer(runtime = null) {
  const ownsRuntime = runtime === null;
  if (ownsRuntime) runtime = new PilotRuntime();
  if (ownsRuntime) ensureHostedDemoOffering(runtime);
  const server = mcpServer(runtime);
  server.runtime = runtime;
  return server;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createRequestListener(server = buildServer()) {
  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, env: 'pilot' }));
    }
    if (req.method === 'GET' && path.startsWith('/v0/scores/')) {
      try {
        const parts = path.split('/').filter(Boolean);
        const offering = decodeURIComponent(parts[2] || '');
        const windowEnd = url.searchParams.get('window_end') ?? undefined;
        const body = parts[3] === 'evidence'
          ? server.runtime.renderingEvidence(offering, windowEnd)
          : server.runtime.signedScore(offering, windowEnd);
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(body));
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message, env: 'pilot' }));
      }
    }
    if (path !== '/mcp' && path !== '/') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'not found' }));
    }
    const rawBody = req.method === 'POST' ? await readBody(req) : '';
    const out = handleMcp(req.method, req.headers, rawBody, server);
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  };
}

if (require.main === module) {
  const listener = createRequestListener(buildServer());
  const port = Number(process.env.PORT || 8080);
  http.createServer(listener).listen(port, () => {
    process.stderr.write(`AudienceScore MCP (Streamable HTTP) on ${port}/mcp\n`);
  });
}

module.exports = { buildServer, createRequestListener };
