# Copy To LLM

Paste this into an AI agent or integration builder.

```text
AudienceScore pilot API

Status: pilot deployment, pre-cryptographic-audit. The independent
cryptographic review and per-vertical legal review gates remain open. The pilot
ledger may be reset and receipts re-issued after the audit. Do not call this
production.

Hosted read base URL: https://mcp.audiencescore.org

Issuer/write API base URL: set by the pilot operator when deploying
reference-impl/src/pilot/server.js. Do not assume api.audiencescore.org works
until DNS is configured.

Read a signed score manifest:
curl -s "https://mcp.audiencescore.org/v0/scores/{offering}"

Fetch de-identified evidence for recomputation:
curl -s "https://mcp.audiencescore.org/v0/scores/{offering}/evidence"

Submit a review with a signed receipt:
curl -s -X POST "{issuer_write_base_url}/v0/reviews" \
  -H "content-type: application/json" \
  --data '{
    "receipt": { "spec": "as/0.2a", "...": "signed receipt JSON" },
    "review": { "overall": 5, "facets": {}, "text": "optional" }
  }'

Remote MCP HTTP JSON-RPC:
curl -s -X POST "https://mcp.audiencescore.org/mcp" \
  -H "content-type: application/json" \
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_score",
      "arguments": { "offering": "{offering}" }
    }
  }'

Rules:
- Reading scores requires no auth.
- Every pilot receipt, signed event, and score manifest includes env="pilot" in
  the signed body.
- A receipt can submit one review for exactly its offering-version.
- Missing receipt, reused receipt, wrong declared issuer, or wrong offering must
  be rejected.
- Verify score manifests by checking sig over canonical manifest JSON with the
  returned signer key, then recompute from /evidence.
```

The hosted version is available at:

```text
https://github.com/audiencescore/audiencescore/blob/main/docs/pilot/COPY-TO-LLM.md
```
