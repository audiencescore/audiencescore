# audiencescore-mcp

Connect any MCP client to [AudienceScore](https://github.com/audiencescore/audiencescore) — verified-review trust scores where every review is gated by cryptographic proof the reviewer actually bought or participated in what they reviewed. One read-only tool, `get_score`, returning an Ed25519-signed manifest the caller can verify and recompute from public data.

Two ways to connect.

## Remote (recommended)

Add the hosted server by URL — no install:

```
https://audiencescore-mcp.vercel.app/mcp
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

`get_score(vendor_id[, state])` → a signed score manifest: percent verified thumbs-up, Wilson 95% lower bound, sample size, and a provenance hash of the exact events used. A vendor with too few verified reviews returns `displayed: false` rather than a fabricated number.

Pilot deployment, pre-cryptographic-audit. The pilot ledger may be reset and receipts re-issued after the audit.
