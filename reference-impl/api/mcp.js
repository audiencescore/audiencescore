'use strict';

// Serverless entry for the AudienceScore pilot read API. Reuses the same
// Streamable-HTTP MCP transport and v0.2 pilot score/evidence provider as the
// standalone server, so hosted and local behavior stay identical.

const { buildServer, createRequestListener } = require('../src/mcp-http-server');

// One provider per warm instance. Set AUDIENCESCORE_PILOT_RENDERING_PRIVATE_KEY_PEM
// in hosted deployments so score signatures are stable and publicly pinnable.
const server = buildServer();
const listener = createRequestListener(server);

module.exports = async (req, res) => {
  await listener(req, res);
};
