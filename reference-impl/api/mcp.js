'use strict';

// Serverless entry for the AudienceScore hosted read API.
//
// Proxy mode (hosted default): when AUDIENCESCORE_UPSTREAM_BASE_URL is set,
// every request is forwarded to the pilot server that owns the ledger and the
// rendering key, so all public hosts serve the same data signed by the same
// key. Fail-closed on upstream outage — no locally fabricated fallback.
//
// Standalone mode (local dev / other operators): with no upstream configured,
// serve the in-process demo provider. Its ledger is per-instance and empty;
// set AUDIENCESCORE_PILOT_RENDERING_PRIVATE_KEY_PEM for a stable signature.

const { buildServer, createRequestListener, createProxyListener } = require('../src/mcp-http-server');

const upstream = process.env.AUDIENCESCORE_UPSTREAM_BASE_URL;
const listener = upstream
  ? createProxyListener(upstream)
  : createRequestListener(buildServer());

module.exports = async (req, res) => {
  await listener(req, res);
};
