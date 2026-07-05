# Read Scores

AudienceScore pilot deployment, pre-cryptographic-audit. The independent
cryptographic review and per-vertical legal review gates remain open. The pilot
ledger may be reset and receipts re-issued after the audit.

Reading scores requires no account or API key.

## Curl

```sh
curl -s "https://api.audiencescore.org/v0/scores/field-elevate-demo%40v1"
```

The response is a signed manifest:

```json
{
  "manifest": {
    "env": "pilot",
    "rendering_version": "audiencescore/rendering@1",
    "subject": "offering:field-elevate-demo@v1",
    "published": false,
    "distinct_receipts": 1,
    "k_anonymity_floor": 10
  },
  "signer": "<base64url Ed25519 public key>",
  "sig": "<base64url signature>"
}
```

Scores below the k-anonymity floor return `published: false` and null score
fields. That is expected for a tiny pilot.

## Recompute

Fetch the de-identified evidence:

```sh
curl -s "https://api.audiencescore.org/v0/scores/field-elevate-demo%40v1/evidence"
```

The evidence omits customer identity and holder bindings. It contains enough
review, standing, and issuance data to recompute rendering v1 for the same
`window_end`.

## Verify

1. Canonicalize `manifest` as sorted-key JSON with no whitespace.
2. Verify `sig` over those bytes with `signer` as an Ed25519 SPKI public key.
3. Recompute rendering v1 from `/evidence`.
4. Confirm the canonical recomputed manifest matches the signed manifest.

For Node clients, the reference helper is:

```js
const { verifyPayload } = require('./reference-impl/src/crypto');
const ok = verifyPayload(signed.signer, signed.manifest, signed.sig);
```

## Remote MCP

The pilot exposes a remote HTTP JSON-RPC endpoint for the `get_score` tool:

```sh
curl -s -X POST "https://api.audiencescore.org/mcp" \
  -H "content-type: application/json" \
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_score",
      "arguments": { "offering": "field-elevate-demo@v1" }
    }
  }'
```

The tool returns the same signed pilot manifest as the REST endpoint.
