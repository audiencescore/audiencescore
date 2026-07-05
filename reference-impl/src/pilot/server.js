#!/usr/bin/env node
'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { PilotRuntime, defaultConfig } = require('./runtime');
const { handleMcp } = require('../mcp-streamable');

const MCP_INSTRUCTIONS =
  'AudienceScore pilot deployment, pre-cryptographic-audit. Use get_score to fetch an Ed25519-signed pilot rendering manifest for an offering-version. Responses are pilot-labeled and may be reset/re-issued after cryptographic audit.';

const TOOL = {
  name: 'get_score',
  title: 'Get an AudienceScore pilot score',
  description: 'Returns a signed pilot rendering v1 manifest for an offering-version. No auth required. The manifest includes env="pilot" in the signed body.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      offering: { type: 'string', description: 'Offering-version, for example field-elevate-demo@v1' },
      window_end: { type: 'string', description: 'Optional RFC3339 rendering window end' },
    },
    required: ['offering'],
  },
};

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,stripe-signature',
  });
  res.end(payload);
}

function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

function text(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// The pilot's MCP provider for the Streamable-HTTP transport: the offering-based
// get_score backed by the live ledger.
function mcpServer(runtime) {
  return {
    serverInfo: { name: 'audiencescore-pilot', title: 'AudienceScore Pilot', version: '0.2.0-pilot' },
    instructions: MCP_INSTRUCTIONS,
    tools: [TOOL],
    callTool(name, args) {
      if (name !== 'get_score') throw new Error(`unknown tool: ${name}`);
      return runtime.signedScore(args.offering, args.window_end);
    },
  };
}

function copyToLlm(runtime) {
  const base = runtime.config.publicBaseUrl;
  return [
    '# AudienceScore Pilot API - Copy To LLM',
    '',
    'AudienceScore is in pilot deployment, pre-cryptographic-audit. The pilot ledger may be reset and receipts re-issued after the audit. Treat every receipt, event, and score as pilot-labeled.',
    '',
    'Base URL:',
    base,
    '',
    'Read a signed score manifest:',
    `curl -s "${base}/v0/scores/{offering}"`,
    '',
    'Submit a review with a signed receipt:',
    `curl -s -X POST "${base}/v0/reviews" \\`,
    '  -H "content-type: application/json" \\',
    "  --data '{\"receipt\":{...signed receipt JSON...},\"review\":{\"overall\":5,\"facets\":{},\"text\":\"optional\"}}'",
    '',
    'Remote MCP HTTP JSON-RPC:',
    `curl -s -X POST "${base}/mcp" \\`,
    '  -H "content-type: application/json" \\',
    "  --data '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"get_score\",\"arguments\":{\"offering\":\"{offering}\"}}}'",
    '',
    'Verify a score manifest by canonicalizing manifest JSON with sorted keys and verifying sig with signer. The signed manifest body contains env="pilot".',
  ].join('\n');
}

function claimPage(token) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AudienceScore Pilot Review</title></head>
<body>
<h1>AudienceScore Pilot Review</h1>
<p><strong>Pilot deployment, pre-cryptographic-audit.</strong> The pilot ledger may be reset and receipts re-issued after the audit.</p>
<form method="post" action="/v0/claims/${encodeURIComponent(token)}/reviews">
  <label>Overall score, 1-5<br><input name="overall" type="number" min="1" max="5" required></label><br><br>
  <label>Optional review text<br><textarea name="text" rows="6" cols="60"></textarea></label><br><br>
  <button type="submit">Submit pilot review</button>
</form>
</body>
</html>`;
}

function parseForm(body) {
  const params = new URLSearchParams(body);
  return {
    overall: Number(params.get('overall')),
    text: params.get('text') || null,
    facets: {},
  };
}

function createServer(runtime = new PilotRuntime()) {
  async function handler(req, res) {
    try {
      if (req.method === 'OPTIONS') return json(res, 204, {});
      const url = new URL(req.url, runtime.config.publicBaseUrl);
      const parts = url.pathname.split('/').filter(Boolean);

      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, { ok: true, env: 'pilot' });
      }
      if (req.method === 'GET' && url.pathname === '/docs/copy-to-llm') {
        return text(res, 200, copyToLlm(runtime));
      }
      if (req.method === 'GET' && parts[0] === 'claim' && parts[1]) {
        return html(res, 200, claimPage(parts[1]));
      }
      if (req.method === 'GET' && parts[0] === 'v0' && parts[1] === 'scores' && parts[2] && !parts[3]) {
        return json(res, 200, runtime.signedScore(decodeURIComponent(parts[2]), url.searchParams.get('window_end') ?? undefined));
      }
      if (req.method === 'GET' && parts[0] === 'v0' && parts[1] === 'scores' && parts[2] && parts[3] === 'evidence') {
        return json(res, 200, runtime.renderingEvidence(decodeURIComponent(parts[2]), url.searchParams.get('window_end') ?? undefined));
      }
      if (req.method === 'POST' && url.pathname === '/v0/reviews') {
        const body = JSON.parse(await readBody(req));
        return json(res, 201, runtime.submitReviewWithReceipt(body));
      }
      if (req.method === 'POST' && parts[0] === 'v0' && parts[1] === 'claims' && parts[2] && parts[3] === 'reviews') {
        const raw = await readBody(req);
        const ctype = req.headers['content-type'] || '';
        const review = ctype.includes('application/json') ? JSON.parse(raw).review : parseForm(raw);
        return json(res, 201, runtime.submitReviewWithClaim({ token: parts[2], review }));
      }
      if (req.method === 'POST' && url.pathname === '/v0/stripe/webhook') {
        const raw = await readBody(req);
        return json(res, 200, await runtime.handleStripeWebhook(raw, req.headers['stripe-signature']));
      }
      if (req.method === 'POST' && url.pathname === '/v1/square/webhook') {
        const raw = await readBody(req);
        return json(res, 200, await runtime.handleSquareWebhook(raw, req.headers['x-square-hmacsha256-signature']));
      }
      if (req.method === 'POST' && url.pathname === '/v1/quickbooks/webhook') {
        const raw = await readBody(req);
        return json(res, 200, await runtime.handleQuickBooksWebhook(raw, req.headers['intuit-signature']));
      }
      if (req.method === 'POST' && url.pathname === '/v1/partners/provision') {
        let partner;
        try {
          partner = runtime.authenticatePartner(req.headers['x-as-partner-id'], req.headers['x-as-partner-secret']);
        } catch {
          return json(res, 401, { error: 'partner authentication failed', env: 'pilot' });
        }
        const body = JSON.parse(await readBody(req));
        return json(res, 200, runtime.provisionMerchants(partner.partner_id, body.merchants ?? []));
      }
      // Platform / protocol / merchant direct ingestion. One rail for every
      // partner; the dedup layer decides mint-vs-corroborate. Auth is a
      // per-partner shared secret for the pilot; production uses signed
      // requests or mTLS.
      if (req.method === 'POST' && url.pathname === '/v1/transactions') {
        let partner;
        try {
          partner = runtime.authenticatePartner(req.headers['x-as-partner-id'], req.headers['x-as-partner-secret']);
        } catch {
          return json(res, 401, { error: 'partner authentication failed', env: 'pilot' });
        }
        const body = JSON.parse(await readBody(req));
        const result = await runtime.ingestTransaction(body, { partner });
        return json(res, result.status === 'minted' ? 201 : 200, result);
      }
      if (url.pathname === '/mcp') {
        const raw = req.method === 'POST' ? await readBody(req) : '';
        const out = handleMcp(req.method, req.headers, raw, mcpServer(runtime));
        res.writeHead(out.status, out.headers);
        return res.end(out.body);
      }
      return json(res, 404, { error: 'not found', env: 'pilot' });
    } catch (err) {
      const msg = err.message || 'error';
      // Client errors carry an actionable message; anything unrecognized is a
      // 500 and returns a generic body so internals never leak to the caller.
      if (/already/.test(msg)) return json(res, 409, { error: msg, env: 'pilot' });
      if (/not authorized/.test(msg)) return json(res, 403, { error: msg, env: 'pilot' });
      if (/receipt|issuer|offering|signature|token|required|missing|invalid|metadata|partner|amount|authoriz|unknown|resolve/.test(msg)) {
        return json(res, 400, { error: msg, env: 'pilot' });
      }
      return json(res, 500, { error: 'internal error', env: 'pilot' });
    }
  }

  return http.createServer(handler);
}

if (require.main === module) {
  const runtime = new PilotRuntime(defaultConfig());
  const server = createServer(runtime);
  server.listen(runtime.config.port, () => {
    process.stderr.write(`AudienceScore pilot API listening on ${runtime.config.port}\n`);
  });
}

module.exports = { createServer, copyToLlm };
