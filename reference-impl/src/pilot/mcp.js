'use strict';

const MCP_INSTRUCTIONS =
  'AudienceScore pilot deployment, pre-cryptographic-audit. Use get_score to fetch an Ed25519-signed rendering v1 manifest for an offering-version, and get_score_evidence to fetch de-identified evidence for independent recomputation. Responses are pilot-labeled and may be reset/re-issued after cryptographic audit.';

const GET_SCORE_TOOL = {
  name: 'get_score',
  title: 'Get an AudienceScore pilot score',
  description: 'Returns a signed pilot rendering v1 manifest for an offering-version. The manifest includes env="pilot" in the signed body.',
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

const GET_SCORE_EVIDENCE_TOOL = {
  name: 'get_score_evidence',
  title: 'Get AudienceScore pilot score evidence',
  description: 'Returns de-identified rendering v1 input for an offering-version, enough to recompute the signed manifest for the same window_end.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: GET_SCORE_TOOL.inputSchema,
};

function mcpServer(runtime) {
  return {
    serverInfo: { name: 'audiencescore-pilot', title: 'AudienceScore Pilot', version: '0.2.0-pilot' },
    instructions: MCP_INSTRUCTIONS,
    tools: [GET_SCORE_TOOL, GET_SCORE_EVIDENCE_TOOL],
    allowedOrigins: runtime.config.allowedOrigins,
    runtime,
    callTool(name, args) {
      if (name === 'get_score') return runtime.signedScore(args.offering, args.window_end);
      if (name === 'get_score_evidence') return runtime.renderingEvidence(args.offering, args.window_end);
      throw new Error(`unknown tool: ${name}`);
    },
  };
}

module.exports = {
  MCP_INSTRUCTIONS,
  GET_SCORE_TOOL,
  GET_SCORE_EVIDENCE_TOOL,
  mcpServer,
};
