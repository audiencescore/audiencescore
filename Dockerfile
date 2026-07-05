# Minimal container for the AudienceScore pilot MCP read server.
#
# The server exposes MCP Streamable HTTP at /mcp plus REST score/evidence
# reads. It starts with a local demo ledger unless configured to proxy to the
# hosted pilot origin.
FROM node:24-alpine

WORKDIR /app
COPY reference-impl/ ./reference-impl/
RUN cd reference-impl && npm ci --omit=dev

EXPOSE 8080
CMD ["node", "reference-impl/src/mcp-http-server.js"]
