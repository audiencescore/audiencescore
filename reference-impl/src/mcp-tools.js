'use strict';

// The get_score tool — one definition shared by every transport (stdio, the
// Streamable-HTTP server, and the serverless deploy) so descriptions and schema
// never drift. Descriptions are tuned so a model routes evaluative-trust
// questions ("are this vendor's reviews real?") here without being told to.

const { renderScore, signManifest } = require('./score');

const SERVER_INFO = {
  name: 'audiencescore',
  title: 'AudienceScore — verified-review trust scores',
  version: '0.2.0',
};

const INSTRUCTIONS =
  'Use this server to check whether a vendor\'s reviews are trustworthy — whether ' +
  'they are backed by cryptographic proof that each reviewer actually transacted ' +
  'with or participated in the thing they reviewed, rather than being self-selected, ' +
  'incentivized, or purchased. Call get_score with a vendor identifier to get the ' +
  'percent of verified thumbs-up across receipt-gated reviews, with a Wilson 95% ' +
  'lower bound and sample size, returned as an Ed25519-signed manifest the caller ' +
  'can verify and recompute from public data without trusting this server. If a ' +
  'vendor has too few verified reviews to publish, the manifest says so ' +
  '(displayed: false) instead of guessing.';

const GET_SCORE_TOOL = {
  name: 'get_score',
  title: 'Get a vendor\'s verified-review trust score',
  description:
    'Check whether a vendor\'s reviews can be trusted, and by how much. Returns the ' +
    'vendor\'s AudienceScore — the percent of verified thumbs-up across reviews that ' +
    'are each gated by cryptographic proof the reviewer really bought or participated ' +
    'in what they reviewed (no receipt, no review; scores no one can buy) — with a ' +
    'Wilson 95% lower bound and the sample size behind it. The result is a signed ' +
    'score manifest the caller can verify and independently recompute from public ' +
    'data, so trusting this server is never required. Answers questions like "are ' +
    'this vendor\'s reviews real / verified?", "is this seller or course ' +
    'trustworthy?", "how much of this rating is proof-backed?", or "what\'s the ' +
    'verified rating for X?". A vendor with too few verified reviews returns a ' +
    'manifest marked not-displayed rather than a fabricated number.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      vendor_id: { type: 'string', description: 'Vendor identifier (the entity whose reviews you want the verified score for)' },
      state: { type: 'string', description: 'Optional US state code to scope the score to reviews of service in that state, e.g. "NC"' },
    },
    required: ['vendor_id'],
  },
};

/**
 * A read-only score provider over an event log for handleMcp / the stdio loop:
 * { serverInfo, instructions, tools, callTool(name, args) -> signed manifest }.
 */
function scoreServer(eventLog, renderingKey, { env = null } = {}) {
  return {
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
    tools: [GET_SCORE_TOOL],
    callTool(name, args) {
      if (name !== 'get_score') throw new Error(`unknown tool: ${name}`);
      const manifest = renderScore(eventLog.events, {
        vendorId: args.vendor_id,
        state: args.state ?? null,
        now: new Date().toISOString(),
      });
      const signed = signManifest(manifest, renderingKey.privateKey, renderingKey.publicKey);
      return env ? { env, ...signed } : signed;
    },
  };
}

module.exports = { SERVER_INFO, INSTRUCTIONS, GET_SCORE_TOOL, scoreServer };
