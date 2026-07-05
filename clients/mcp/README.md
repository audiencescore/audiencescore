# audiencescore-mcp

Connect any MCP client to [AudienceScore](https://github.com/audiencescore/audiencescore) — verified-review trust scores where every review is gated by cryptographic proof the reviewer actually bought or participated in what they reviewed. The hosted pilot exposes read-only `get_score` and `get_score_evidence` tools returning v0.2 rendering data the caller can verify and recompute from public evidence.

Two ways to connect.

## Remote (recommended)

Add the hosted server by URL — no install:

```
https://mcp.audiencescore.org/mcp
```

Speaks MCP Streamable HTTP; no account or API key.

## Stdio (this package)

For clients that launch a local command:

```json
{
  "mcpServers": {
    "audiencescore": {
      "command": "npx",
      "args": ["-y", "audiencescore-mcp"]
    }
  }
}
```

The bridge forwards to the hosted endpoint. Override it with the `AUDIENCESCORE_MCP_URL` environment variable (e.g. to point at a self-hosted deployment).

## The tool

`get_score(offering[, window_end])` → a signed rendering v1 manifest with k-anonymity status, sample mix, dual views, and signer metadata.

`get_score_evidence(offering[, window_end])` → the de-identified rendering input needed to recompute that manifest. An offering below the k-anonymity floor returns `published: false` rather than a fabricated number.

Pilot deployment, pre-cryptographic-audit. The pilot ledger may be reset and receipts re-issued after the audit.
