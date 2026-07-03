# Minimal container for the AudienceScore reference MCP server.
#
# The server is a zero-dependency Node.js stdio server speaking MCP
# (JSON-RPC 2.0 over stdin/stdout). With no argument it serves an empty
# event log and still answers introspection (initialize / tools/list) and
# get_score, so `docker run` boots a working server out of the box — which
# is what MCP registries execute to verify a server starts and responds.
#
# To serve a real event log, mount it and pass the path:
#   docker run -i -v "$PWD/events.jsonl:/data/events.jsonl" IMAGE /data/events.jsonl
FROM node:22-alpine

WORKDIR /app
COPY reference-impl/ ./reference-impl/

ENTRYPOINT ["node", "reference-impl/src/mcp-server.js"]
