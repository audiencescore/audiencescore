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
      return res.end(JSON.stringify({
        ok: true,
        env: 'pilot',
        signer: server.runtime.renderingSigner(),
        signer_fingerprint: server.runtime.signerFingerprint(),
        git_sha: process.env.AUDIENCESCORE_GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
      }));
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

// Headers that must not be forwarded by a proxy (hop-by-hop), plus encoding
// headers: fetch transparently decompresses upstream bodies, so forwarding
// content-encoding/content-length with the decompressed bytes would corrupt
// the response. accept-encoding is dropped from requests for the same reason.
const NO_FORWARD = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
  'content-length', 'content-encoding', 'accept-encoding',
]);

// Thin reverse proxy to the pilot server that owns the ledger and the
// rendering key, so every hosted read serves origin truth signed by one key.
// Fail-closed: if the origin is unreachable, answer 502 with an honest error —
// never fall back to locally fabricated data. MCP responses in this
// implementation are complete JSON bodies (no SSE streams), so buffering the
// upstream body is lossless.
function createProxyListener(upstreamBaseUrl, { timeoutMs = 25000 } = {}) {
  const base = String(upstreamBaseUrl).replace(/\/+$/, '');
  return async (req, res) => {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined && !NO_FORWARD.has(key.toLowerCase())) headers[key] = value;
    }
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const upstream = await fetch(base + (req.url || '/'), {
        method: req.method,
        headers,
        body: body || undefined,
        signal: controller.signal,
        redirect: 'manual',
      });
      const outHeaders = {};
      upstream.headers.forEach((value, key) => {
        if (!NO_FORWARD.has(key)) outHeaders[key] = value;
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, outHeaders);
      res.end(buf);
    } catch {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream pilot server unreachable', env: 'pilot' }));
    } finally {
      clearTimeout(timer);
    }
  };
}

if (require.main === module) {
  const listener = createRequestListener(buildServer());
  const port = Number(process.env.PORT || 8080);
  http.createServer(listener).listen(port, () => {
    process.stderr.write(`AudienceScore MCP (Streamable HTTP) on ${port}/mcp\n`);
  });
}

module.exports = { buildServer, createRequestListener, createProxyListener };
