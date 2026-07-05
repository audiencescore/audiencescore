'use strict';

// Standalone Streamable-HTTP MCP server for the AudienceScore read API. Runs as
// a Node server (`node src/mcp-http-server.js [event-log.jsonl]`) and exports a
// (req, res) listener a serverless host can mount. Read-only get_score,
// pilot-labeled, zero runtime dependencies.

const http = require('node:http');
const fs = require('node:fs');
const { generateKeyPair } = require('./crypto');
const { EventLog } = require('./events');
const { scoreServer } = require('./mcp-tools');
const { handleMcp } = require('./mcp-streamable');

const PILOT_ENV = 'pilot';

function buildServer(logPath = process.env.AUDIENCESCORE_EVENT_LOG) {
  const eventLog = logPath && fs.existsSync(logPath)
    ? EventLog.fromJSONL(fs.readFileSync(logPath, 'utf8'))
    : new EventLog();
  if (!eventLog.verifyChain()) throw new Error('event log failed chain verification; refusing to serve');
  // Ephemeral demonstrator key; a production deployment publishes and rotates
  // its rendering key through governance.
  const renderingKey = generateKeyPair();
  return scoreServer(eventLog, renderingKey, { env: PILOT_ENV });
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
    const path = (req.url || '/').split('?')[0];
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, env: PILOT_ENV }));
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
  const listener = createRequestListener(buildServer(process.argv[2]));
  const port = Number(process.env.PORT || 8080);
  http.createServer(listener).listen(port, () => {
    process.stderr.write(`AudienceScore MCP (Streamable HTTP) on ${port}/mcp\n`);
  });
}

module.exports = { buildServer, createRequestListener };
