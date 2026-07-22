# Taster mode — let an agent sample the score before it commits

Taster mode is the zero-friction on-ramp for the demand side: a way for any
agent (or the developer wiring one) to *feel what an AudienceScore rendering
does to a tool-selection decision* in under a minute, with no account, no key,
and nothing signed. It is the adoption movement's first surface — because the
one metric that is safe to maximize without limit is **query volume from
distinct agents**, and the fastest way to grow queries is to make the first one
trivial and the value obvious.

The taster asks nothing of the agent that it wouldn't already do: it reads a
signed score, verifies it, and lets the score change a choice. Reading a score
signs nothing, so the taster clears no gate — no crypto audit, no legal review,
no Sybil surface. That is exactly why it can ship now and run wide open.

## The three tastes

Each stage is self-contained; an agent can stop after any one and still have
gotten value.

1. **Discover** — the agent finds the server the way an agent should: the ARD
   `ai-catalog.json` capability manifest (`docs/ard.md`) and `llms.txt` already
   describe the MCP server and the read tools. No submission, no signup; a
   registry crawl or a single fetch is the whole discovery step.

2. **Query** — one call returns a signed rendering v1 manifest:

   ```sh
   curl -sS https://mcp.audiencescore.org/v0/scores/field-elevate-demo%40v1
   ```

   or over MCP, the read-only `get_score` tool. Below the k-anonymity floor the
   manifest returns `published: false` rather than a fabricated number — the
   taster shows honesty as a feature, not a gap.

3. **Decide** — the payoff taste: the agent uses the score to pick between two
   candidate tools and can *see* the choice flip. This is the "connotation" of a
   score made concrete — not a number in the abstract, but a number that means
   *choose this one*. The runnable demonstrator lives at
   [`reference-impl/examples/taster/select-tool.js`](../reference-impl/examples/taster/select-tool.js).

## Verify, don't trust

Trusting the server is never required and the taster makes that a first-class
step, not fine print. Every manifest is Ed25519-signed; the same three lines
that verify a production score verify a taster score:

```sh
node - <<'NODE'
const { verifyPayload } = require('./reference-impl/src/crypto');
(async () => {
  const scoreUrl = 'https://mcp.audiencescore.org/v0/scores/field-elevate-demo%40v1';
  const keysUrl = 'https://audiencescore.org/.well-known/audiencescore-keys.json';
  const signed = await fetch(scoreUrl).then((r) => r.json());
  const keys = await fetch(keysUrl).then((r) => r.json());
  const inKeySet = new Set((keys.keys || []).map((k) => k.key)).has(signed.signer);
  const valid = verifyPayload(signed.signer, signed.manifest, signed.sig);
  console.log(JSON.stringify({ published: signed.manifest.published, inKeySet, valid }, null, 2));
})();
NODE
```

## What the taster is NOT

- It is **not** a write path. The taster never issues a receipt, never submits a
  review, and never rewards the agent for anything. Rewarding submission is
  buying scores (spec §10, threat model T-2); the taster stays strictly on the
  read side, which is the only side with unlimited safe upside.
- It is **not** a "proof-of-use" tier. An agent invoking the read API is not
  earning an attestation; it is consuming one. Invocation-as-attestation is a
  separate, unresolved v0.3 design question (see
  `.claude/agents/orchestrator-ceo.md`, guardrail 4).
- It carries the same `env: "pilot"` posture as everything else pre-audit. The
  taster demonstrates the shape of the value; it is not a certification.

## Why this is the movement's first brick

You do not grow AudienceScore by recruiting a supply of raters — that is the
Sybil surface. You grow it by growing a *demand* of consumers, and letting
verified supply fall out of real usage as exhaust. The taster is the cheapest
possible first query for a consumer. Every agent that runs it once and sees a
tool choice improve is one more independent agent in the only number that
matters.
