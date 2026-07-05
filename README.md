# AudienceScore

**The open rating system where every review is proven — scores no one can buy.**

[![CI](https://github.com/audiencescore/audiencescore/actions/workflows/ci.yml/badge.svg)](https://github.com/audiencescore/audiencescore/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/code-Apache--2.0-blue.svg)](LICENSE)
[![Spec: CC BY 4.0](https://img.shields.io/badge/spec-CC%20BY%204.0-lightgrey.svg)](LICENSE-CC-BY-4.0)
[![Data: ODbL](https://img.shields.io/badge/data-ODbL-lightgrey.svg)](data-commons/LICENSE-ODbL)

AudienceScore is an open protocol for reviews gated by cryptographic proof of
participation. A provider signs a receipt when a real transaction or verified
participation happens; that receipt is the only thing that can unlock a review;
published scores are deterministic, recomputable renderings over the raw review
ledger. No receipt, no review. No exceptions, no purchased placement.

Today's review systems fail in one of two ways: anyone can review anything
(astroturf, review farms, extortion), or a platform quietly decides what counts
(unaccountable moderation, pay-to-play). AudienceScore replaces both with math:
standing to speak costs a real transaction with — or verified time spent on —
the thing being reviewed, and every published score can be recomputed by anyone
from public data.

## Status

**Spec v0.2.0 is released; pilot is live.** See [`spec/`](spec/) for the
normative document and the adversarial review that shaped it, and
[DRIFT.md](DRIFT.md) for how v0.1 reality was reconciled with it. Two gates
remain open before production/non-pilot issuance:

1. **Independent cryptographic review** of the receipt scheme — self-reviewed
   crypto is how protocols die, and this repository does not satisfy that gate.
2. **Per-vertical legal review** before any regulated-vertical profile
   (finance, healthcare) ships. Verticals are profiles, never forks; the first
   profile (education) will follow the protocol, not modify it.

The hosted API is a **pilot deployment, pre-cryptographic-audit**. Pilot
receipts, signed events, and score manifests carry `env: "pilot"` in the signed
body. The pilot ledger may be reset and receipts re-issued after the audit. If
you build agents, review-integrity tooling, or commerce infrastructure, your
critique of the spec is exactly what this stage is for — open an issue.

## Pilot Is Live

- **Remote MCP (connect an agent by URL):** `https://mcp.audiencescore.org/mcp` —
  Streamable HTTP, no account or API key, read-only `get_score` and
  `get_score_evidence` over v0.2 rendering manifests.
- Hosted read API: `https://mcp.audiencescore.org/v0/scores/{offering}` and
  `/evidence` on the same host. Issuer/write API deployments run the pilot
  server from `reference-impl/src/pilot/server.js` and must configure their own
  public base URL.
- Issuer setup: [docs/pilot/ISSUER-QUICKSTART.md](docs/pilot/ISSUER-QUICKSTART.md)
- Leave a review: [docs/pilot/LEAVE-A-REVIEW.md](docs/pilot/LEAVE-A-REVIEW.md)
- Read scores: [docs/pilot/READ-SCORES.md](docs/pilot/READ-SCORES.md)
- Copy to LLM: [docs/pilot/COPY-TO-LLM.md](docs/pilot/COPY-TO-LLM.md)

This is not production. It is the first live pilot for a configured issuer.

## Quickstart (60 seconds)

Requires Node.js 18+ (Node 24+ for the v0.2 store and acceptance suite). The
demo has no dependencies to install:

```sh
git clone https://github.com/audiencescore/audiencescore.git
cd audiencescore
node reference-impl/demo.js
```

To run the full v0.2a acceptance suite (AT-1..AT-25, one pinned dependency):

```sh
cd reference-impl && npm ci && npm test
```

## How it works

1. **Issuers attest.** When value moves or participation happens, the provider
   (co-attested by payment rails or platforms where available) automatically
   signs an Ed25519 receipt binding a pseudonymous holder to a versioned
   offering. Issuance is never discretionary: if the transaction event fires,
   the receipt exists.
2. **Holders review.** A receipt unlocks exactly one review of exactly that
   offering-version. Roles matter: payers can rate value; participants can rate
   everything, including declared components (instructor, curriculum,
   platform…).
3. **The protocol renders.** Scores are versioned pure functions over the raw
   ledger — recomputable byte-for-byte by anyone. Entities (instructors,
   institutions, curricula) are never reviewed directly; their scores are
   derived from every offering they ever appeared in, forever. New offering IDs
   never reset history.

For the superseded v0.1 agent-flow walkthrough — how a complaint to your
assistant becomes a signed, receipt-gated verdict without a form ever
existing — see [How a review actually happens](docs/how-a-review-happens.md).

## The attestation ladder

L1 TRANSACTED (value moved) → L2 ENGAGED (verified use) → L3 COMPLETED
(finished or kept) → L4 OUTCOME (verified external result). Levels are
independent: free offerings enter at L2+, labeled *verified participant* rather
than *verified purchaser*. Standing only ascends. Refunds and withdrawals never
revoke standing — a verified-refund one-star is signal, not noise. Every
published score discloses its level mix, role mix, and completion rate, and
always publishes both an all-verified view and a completer view.

## Protocol invariants (health-checked)

No orphan reviews or receipts. Receipt issuance reconciles against attested
transaction volume. Standing never descends. Every score recomputes
byte-identical from raw data. The ledger is append-only at the storage layer.
Facet scores only against declared components. Nothing publishes below a
k-anonymity threshold of distinct receipts. Each invariant is wired into an
automated health check, and the acceptance suite seeds a violation of each one
to prove its alarm fires.

## Privacy

Holders are pseudonymous with per-issuer derived keys — issuers cannot collude
to build cross-provider participation graphs, and no holder→offering directory
exists anywhere in the protocol. Participation itself is often sensitive; the
protocol is designed so reviewing never requires disclosing that you enrolled.

## Conformance

[`conformance/`](conformance/) contains signed test vectors and a reference
verifier. An implementation is conformant only if it accepts every valid
vector, rejects every invalid one, and reproduces canonical serialization
byte-for-byte. The acceptance criteria live in
[`tests/ACCEPTANCE-TESTS.md`](tests/ACCEPTANCE-TESTS.md); every numbered test
exists as an executable test in CI.

## Repository layout

| Path | Contents | License |
|---|---|---|
| [`/spec`](spec/) | Protocol spec v0.2a and its adversarial review | CC BY 4.0 |
| [`/protocol`](protocol/) | Pilot OpenAPI plus superseded v0.1 wire specifications | CC BY 4.0 |
| [`/score-spec`](score-spec/) | Rendering v1 score math plus superseded v0.1 math | CC BY 4.0 |
| [`/conformance`](conformance/) | Signed test vectors and the reference verifier | CC BY 4.0 |
| [`/tests`](tests/) | The acceptance-test register (AT-1..AT-25) | CC BY 4.0 |
| [`/reference-impl`](reference-impl/) | Node.js reference implementation + MCP server | Apache-2.0 |
| [`/data-commons`](data-commons/) | Open-data licensing and mirror tooling | ODbL |
| [`/docs`](docs/) | Rendered documentation, including pilot instructions | CC BY 4.0 |

## Licensing, deliberately

Three artifacts, three licenses: **code** under [Apache-2.0](LICENSE) (the
explicit patent grant matters for protocol work), **specifications** under
[CC BY 4.0](LICENSE-CC-BY-4.0), and the future **event data commons** under
[ODbL](data-commons/LICENSE-ODbL) so mirrors must share improvements back.

## What is open, what is not

Everything that computes a score is open, forever: the event schema, the
signing rules, the append-only log, every admitted event, the score function,
and the moderation log. The one exception is a small set of operator-side
anti-fraud admission checks, which are run as a service and never shipped —
published here as cryptographic commitments and revealed on retirement.
[GOVERNANCE.md](GOVERNANCE.md) is the constitution that fixes that boundary
and the accountability machinery around it.

## Contributing

Read [`spec/SPEC-v0.2a.md`](spec/SPEC-v0.2a.md) before proposing changes.
Anything touching receipts, invariants, or renderings requires a spec change
first — code never leads spec in this repository. Spec changes start with an
RFC issue; code changes need tests and a DCO sign-off. See
[CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
