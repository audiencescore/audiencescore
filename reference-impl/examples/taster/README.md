# Taster example — the "decide" taste

Runnable demonstrator for [taster mode](../../../docs/taster-mode.md): an agent
choosing between two candidate tools, with the choice flipping once it consults
an AudienceScore rendering.

```sh
node reference-impl/examples/taster/select-tool.js
```

It reads signed score manifests, verifies them the way any consumer would
(trusting the server is never required), and lets the score change the pick.
When the pilot read host is reachable it fetches and verifies a **live** signed
manifest; offline it falls back to clearly-labeled illustrative fixtures so the
decision logic is always demonstrable.

It is strictly a **read-side** demonstrator: it never issues a receipt, never
submits a review, and never rewards anyone for rating. Reading a score signs
nothing, so there is no gate to clear and no Sybil surface — which is exactly
why it is the demand-side on-ramp and safe to run wide open. Same
`env: "pilot"`, pre-audit posture as the rest of the repository.
