# AudienceScore Documentation

AudienceScore is an open protocol for review scores gated by cryptographic
proof of a real transaction or verified participation. A signed receipt unlocks
one review for one versioned offering, and every published score is a signed,
recomputable rendering over the ledger.

## Status

Live pilot deployment, pre-cryptographic-audit, not production. The pilot
ledger may be reset and receipts may be re-issued after audit.

Open gates before non-pilot issuance:

1. Independent cryptographic review of the receipt and rendering-signature
   scheme.
2. Per-vertical legal review before any regulated profile ships.

## Connect MCP

Remote MCP URL:

```text
https://mcp.audiencescore.org/mcp
```

Tools: `get_score` and `get_score_evidence`.

## Read and Verify

Read a signed pilot score manifest:

```sh
curl -sS https://mcp.audiencescore.org/v0/scores/field-elevate-demo%40v1
```

Verify the score signature against the published key set:

```sh
node - <<'NODE'
const { verifyPayload } = require('./reference-impl/src/crypto');
const scoreUrl = 'https://mcp.audiencescore.org/v0/scores/field-elevate-demo%40v1';
const keysUrl = 'https://audiencescore.org/.well-known/audiencescore-keys.json';

(async () => {
  const signed = await fetch(scoreUrl).then((r) => r.json());
  const keys = await fetch(keysUrl).then((r) => r.json());
  const publishedKeys = new Set((keys.keys || []).map((k) => k.key));
  const inKeySet = publishedKeys.has(signed.signer);
  const valid = verifyPayload(signed.signer, signed.manifest, signed.sig);
  console.log(JSON.stringify({ published: signed.manifest.published, inKeySet, valid }, null, 2));
  if (!inKeySet || !valid) process.exit(1);
})();
NODE
```

## Run Locally

```sh
git clone https://github.com/audiencescore/audiencescore.git
cd audiencescore
npm install --prefix reference-impl
npm test --prefix reference-impl
node reference-impl/demo.js
```

## Pilot Docs

- [Issuer quickstart](pilot/ISSUER-QUICKSTART.md)
- [Leave a review](pilot/LEAVE-A-REVIEW.md)
- [Read scores](pilot/READ-SCORES.md)
- [Copy to LLM](pilot/COPY-TO-LLM.md)
- [Pilot deployment runbook](pilot/DEPLOYMENT.md)
- [Pilot API OpenAPI](https://github.com/audiencescore/audiencescore/blob/main/protocol/openapi.json)

## Spec and Governance

- [Spec v0.2a](https://github.com/audiencescore/audiencescore/blob/main/spec/SPEC-v0.2a.md)
- [Rendering v1](https://github.com/audiencescore/audiencescore/blob/main/score-spec/rendering-v1.md)
- [Conformance vectors and verifier](https://github.com/audiencescore/audiencescore/tree/main/conformance)
- [Acceptance tests](https://github.com/audiencescore/audiencescore/blob/main/tests/ACCEPTANCE-TESTS.md)
- [Event specification v0.1, retained](https://github.com/audiencescore/audiencescore/blob/main/protocol/event-spec.md)
- [Receipt specification v0.1, retained](https://github.com/audiencescore/audiencescore/blob/main/protocol/receipt-spec.md)
- [Score specification v0.1, retained](https://github.com/audiencescore/audiencescore/blob/main/score-spec/score-spec-v0.1.md)
- [Governance](https://github.com/audiencescore/audiencescore/blob/main/GOVERNANCE.md)
- [Reference implementation](https://github.com/audiencescore/audiencescore/blob/main/reference-impl/README.md)
- [Prior art and related systems](prior-art.md)
- [Contributing](https://github.com/audiencescore/audiencescore/blob/main/CONTRIBUTING.md)
