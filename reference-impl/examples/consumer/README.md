# Consumer example — rank tools by verified AudienceScore

A drop-in helper an agent developer adds to their agent to **rank candidate
tools by their verified AudienceScore before selecting one**. This is the
demand-side, read-only path from [taster mode](../../../docs/taster-mode.md),
turned into a module you actually wire in — not just a demo you watch.

- [`audiencescore-select.js`](./audiencescore-select.js) — the reusable helper.
- [`example.js`](./example.js) — a runnable end-to-end demonstration.

```sh
node reference-impl/examples/consumer/example.js
```

## What the helper does

```js
const { rankTools, selectTool } = require('./audiencescore-select');

// Each candidate names a tool and the offering-version whose score to consult.
const ranked = await rankTools([
  { tool: 'summarizer-a', offering: 'summarizer-a@v1' },
  { tool: 'summarizer-b', offering: 'summarizer-b@v1' },
]);
// -> best-first, each entry: { tool, offering, score, verified, published,
//                              sampleSize, usable, reason }

const best = await selectTool(candidates); // convenience: the top-ranked tool
```

For each candidate it fetches the signed score rendering from the read API,
**verifies the Ed25519 signature with the same `verifyPayload` a production
consumer runs** (reused from [`reference-impl/src/crypto.js`](../../src/crypto.js)),
and only then lets the score influence the ranking. The hosted read pattern is
the one documented in [`docs/index.md`](../../../docs/index.md):
`GET https://mcp.audiencescore.org/v0/scores/<offering>` returns
`{ manifest, signer, sig }`, and the published key set lives at
`https://audiencescore.org/.well-known/audiencescore-keys.json`.

## Verify, don't trust

Trusting the server is never required, so this helper never does. Three rules
are enforced, and each is shown failing-closed in `example.js`:

1. **Bad signature is discarded.** A manifest edited after signing fails
   `verifyPayload` and cannot rank. (`example.js` tampers a 4.6 into a 5.0 and
   watches it get rejected.)
2. **Stranger keys are pinned out.** With `pinToKeySet: true` (the default), a
   signature that verifies but whose signer is not in the published key set is
   still discarded — otherwise anyone could self-sign a glowing score.
3. **No number below the floor.** Below the k-anonymity floor the rendering is
   `published: false` with no score; the helper treats that as "no usable
   score", never a fabricated one, and by default does **not** punish a tool for
   simply lacking reviews (`preferScored`).

## Options (policy is yours)

| option | default | meaning |
| --- | --- | --- |
| `host` | `https://mcp.audiencescore.org` | read API host |
| `pinToKeySet` | `true` | fetch and enforce the published key set |
| `trustedKeys` | `null` | pin to an explicit key set instead of fetching |
| `minSampleSize` | `0` | ignore scores backed by fewer than N reviews |
| `preferScored` | `true` | tools with a usable score sort ahead of those without (stable) |
| `requireScore` | `false` | strict: drop candidates that have no usable verified score |
| `fetchImpl` | `globalThis.fetch` | inject a fetch (tests / offline) |

The helper never throws on a down endpoint or a bad payload — an unreachable
score host degrades that candidate to "no usable score", it does not crash the
ranking.

## What this is NOT

- **Not a write path.** It issues no receipt, submits no review, and rewards no
  one for rating. Rewarding submission is buying scores (spec §10; threat model
  T-2); this stays strictly on the read side, the only side with unlimited safe
  upside.
- **Not a "proof-of-use" tier.** Querying a score consumes an attestation, it
  does not earn one. Invocation-as-attestation is a separate, unresolved v0.3
  design question.
- **Not a certification.** Same `env: "pilot"`, pre-crypto-audit posture as the
  rest of the repository. It demonstrates the shape of the value; the crypto
  scheme is still gated on independent review before any receipt signs a real
  transaction.

## Offline fidelity

`example.js` signs its own demo manifests with a locally generated Ed25519 key
using the protocol's own crypto, so the signatures it verifies are **genuine**,
not stubbed — the read/verify path is exercised for real with no network. It
then probes the live pilot host once and reports whatever it finds, failing
soft if the host is unreachable.
