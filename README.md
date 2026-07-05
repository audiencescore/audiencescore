# AudienceScore

AudienceScore is an open protocol for review scores gated by cryptographic
proof of a real transaction or verified participation. A signed receipt unlocks
one review for one versioned offering, and every published score is a signed,
recomputable rendering over the ledger.

[![CI](https://github.com/audiencescore/audiencescore/actions/workflows/ci.yml/badge.svg)](https://github.com/audiencescore/audiencescore/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/code-Apache--2.0-blue.svg)](LICENSE)
[![Spec: CC BY 4.0](https://img.shields.io/badge/spec-CC%20BY%204.0-lightgrey.svg)](LICENSE-CC-BY-4.0)
[![Data: ODbL](https://img.shields.io/badge/data-ODbL-lightgrey.svg)](data-commons/LICENSE-ODbL)

## Status

AudienceScore is a live pilot deployment, pre-cryptographic-audit, not a
production issuance system. Pilot receipts, events, and score manifests carry
`env: "pilot"` in signed bodies; the pilot ledger may be reset and receipts may
be re-issued after audit.

Two gates remain open before non-pilot issuance:

1. Independent cryptographic review of the receipt and rendering-signature
   scheme.
2. Per-vertical legal review before any regulated profile ships.

## Connect MCP

Add this remote MCP server URL in any client that supports Streamable HTTP:

```text
https://mcp.audiencescore.org/mcp
```

No account or API key is required. The pilot server exposes read-only
`get_score` and `get_score_evidence` tools for v0.2 rendering manifests.

## Read a Score

Fetch a signed pilot score manifest with one curl:

```sh
curl -sS https://mcp.audiencescore.org/v0/scores/field-elevate-demo%40v1
```

Below the k-anonymity floor, the manifest returns `published: false` rather
than a fabricated score.

Verify that the manifest signature is valid and that its signer is in the
published key set:

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

Requires Node.js 24+.

```sh
git clone https://github.com/audiencescore/audiencescore.git
cd audiencescore
npm install --prefix reference-impl
npm test --prefix reference-impl
node reference-impl/demo.js
```

The demo proves the full current loop: receipt issued, review admitted, score
rendered, evidence recomputed, and score queried over MCP.

## Spec and Governance

- [Spec v0.2a](spec/SPEC-v0.2a.md): receipts, roles, attestation levels,
  versioned offerings, invariants, and threat model.
- [Rendering v1](score-spec/rendering-v1.md): current score math.
- [Conformance](conformance/): signed vectors, canonical bytes, and Python
  verifier.
- [Acceptance tests](tests/ACCEPTANCE-TESTS.md): AT-1 through AT-25, all
  executable in CI.
- [Pilot docs](docs/index.md): issuer, review, score-reading, and deployment
  runbooks.
- [Governance](GOVERNANCE.md): open score math, sealed-admission boundaries,
  and accountability rules.
- [DRIFT.md](DRIFT.md): the plain-English record of v0.1 to v0.2 drift
  decisions.

## Contribute

Protocol changes start with the spec. Anything touching receipts, invariants,
rendering math, or conformance vectors needs a spec/RFC discussion before code.
Implementation changes need tests, DCO sign-off, and passing CI.

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through
[SECURITY.md](SECURITY.md).
