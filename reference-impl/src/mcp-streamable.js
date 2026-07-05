'use strict';

// MCP Streamable HTTP transport (spec 2025-06-18), the wire format stock MCP
// clients speak when you add a server by URL. Transport-agnostic: it takes the
// HTTP method, headers, and raw body and returns { status, headers, body }, so
// the same core drives a Node http server and a serverless function.
//
// The server is stateless and read-only (one get_score tool), so a session id
// is issued for clients that expect one but no per-session state is kept. GET
// (server→client streaming) is declined with 405 because nothing is pushed.

const crypto = require('node:crypto');

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOLS = new Set([PROTOCOL_VERSION, '2025-03-26', '2024-11-05']);

function jsonrpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonrpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// A request carries a JSON-RPC method the server answers; a notification/response
// does not and gets a bare 202 under the spec.
function isRequest(message) {
  return message && message.method !== undefined && message.id !== undefined;
}

function dispatch(message, server) {
  const { id, method, params } = message;
  switch (method) {
    case 'initialize':
      return jsonrpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.has(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: server.serverInfo,
        instructions: server.instructions,
      });
    case 'ping':
      return jsonrpcResult(id, {});
    case 'tools/list':
      return jsonrpcResult(id, { tools: server.tools });
    case 'tools/call': {
      const tool = server.tools.find((t) => t.name === params?.name);
      if (!tool) return jsonrpcError(id, -32602, `unknown tool: ${params?.name}`);
      try {
        const structured = server.callTool(params.name, params.arguments ?? {});
        return jsonrpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured,
          isError: false,
        });
      } catch (err) {
        return jsonrpcResult(id, { content: [{ type: 'text', text: err.message }], isError: true });
      }
    }
    default:
      return jsonrpcError(id, -32601, `method not found: ${method}`);
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,mcp-session-id,mcp-protocol-version,accept',
  'access-control-expose-headers': 'mcp-session-id',
};

/**
 * Handle one MCP HTTP request. `server` supplies { serverInfo, instructions,
 * tools, callTool(name, args) -> structuredContent }.
 */
function handleMcp(method, headers, rawBody, server) {
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));

  if (method === 'OPTIONS') return { status: 204, headers: { ...CORS }, body: '' };
  if (method === 'GET') {
    // No server-initiated stream: decline SSE per spec, keep the endpoint honest.
    return { status: 405, headers: { ...CORS, allow: 'POST, DELETE, OPTIONS' }, body: JSON.stringify(jsonrpcError(null, -32000, 'this server does not offer an event stream')) };
  }
  if (method === 'DELETE') return { status: 200, headers: { ...CORS }, body: '' };
  if (method !== 'POST') return { status: 405, headers: { ...CORS, allow: 'POST, DELETE, OPTIONS' }, body: '' };

  let message;
  try {
    message = JSON.parse(rawBody || '');
  } catch {
    return { status: 400, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(jsonrpcError(null, -32700, 'parse error')) };
  }

  // Notifications and responses (no id) are acknowledged with 202 and no body.
  if (Array.isArray(message) ? !message.some(isRequest) : !isRequest(message)) {
    return { status: 202, headers: { ...CORS }, body: '' };
  }

  const respond = (payload, extraHeaders = {}) => ({
    status: 200,
    headers: { 'content-type': 'application/json', ...CORS, ...extraHeaders },
    body: JSON.stringify(payload),
  });

  if (Array.isArray(message)) {
    return respond(message.filter(isRequest).map((m) => dispatch(m, server)));
  }
  // A fresh session id on initialize; clients that track it will echo it back.
  const extra = message.method === 'initialize' ? { 'mcp-session-id': crypto.randomUUID() } : {};
  return respond(dispatch(message, server), extra);
}

module.exports = { handleMcp, PROTOCOL_VERSION };
