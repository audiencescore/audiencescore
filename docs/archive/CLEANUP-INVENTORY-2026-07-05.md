# Cleanup Inventory — 2026-07-05

> **ARCHIVED 2026-07-05:** record of the one-time repository cleanup and
> archive inventory. Kept for history; do not follow as current product
> documentation.

Baseline before cleanup: `main` at
`a4d3be1cc56bb205358fcaf9fd717e967096eeb4`, clean worktree. The cleanup pass
used read-only inventory sweeps, then separated safe edits into PR A, archive
moves into PR B, and code removal into PR C only if a safe removal existed.

Validation observed during inventory:

- `cd reference-impl && npm test` passed: 98 tests, 98 pass, 0 fail.
- `node .github/scripts/check-links.js` passed.
- `python3 verify_vectors.py` passed all conformance expectations.
- `python3 gen_canonical_fixture.py --check` verified 8 receipts.
- `node reference-impl/demo.js` completed successfully.
- `api.audiencescore.org`, `mcp.audiencescore.org`, and
  `audiencescore-mcp.vercel.app` reported the same pilot signer fingerprint
  and the baseline `git_sha` before cleanup.

## Bucket Counts

| Bucket | Count | Action |
|---|---:|---|
| KEEP | 38 | Left current files and reachable code in place. |
| FIX | 10 | Corrected stale claims or links without runtime behavior changes. |
| ARCHIVE | 2 | Moved superseded narrative docs under `docs/archive/` with archive banners. |
| REMOVE | 0 | No safe removal met the proof bar. |
| ESCALATE | 25 | Left owner/spec/governance/v0.1/source-of-truth decisions untouched. |

## Document Truth Sweep

| Path | Claim or purpose | Verdict evidence | Bucket |
|---|---|---|---|
| `README.md` | Current public entrypoint: spec released, pilot live, not production. | Pilot endpoints and local test claims verified; link updated only for archived v0.1 walkthrough. | KEEP |
| `CHANGELOG.md` | Release history. | Historical `0.2.0` no-data line needed release-time wording because pilot data may now exist. | FIX |
| `CODE_OF_CONDUCT.md` | Contributor Covenant policy. | Linked policy/security paths reachable. | KEEP |
| `CONTRIBUTING.md` | Contribution and RFC process. | "Draft stage" wording stale after spec release; updated to early pilot feedback. | FIX |
| `DESIGN.md` | Pilot deployment design. | Current as design context; no runtime contract changed. | KEEP |
| `DRIFT.md` | v0.1-to-v0.2 drift register. | D-13 matched current one-ledger/one-key public-host design; no silent edits. | KEEP |
| `GOVERNANCE.md` | Open-forever and sealed-admission constitution. | Governance file; owner review required for any change. | ESCALATE |
| `SECURITY.md` | Vulnerability policy and pilot security posture. | "No live review data" was too broad; changed to no production review data and resettable pilot data. | FIX |
| `TRADEMARK.md` | Interim trademark notice. | Legal/governance file; owner review required. | ESCALATE |
| `docs/index.md` | Documentation landing page. | Links are current after archive redirects. | KEEP |
| `docs/architecture.md` | Superseded v0.1 architecture overview. | Clearly superseded and no longer current first-line docs. | ARCHIVE |
| `docs/how-a-review-happens.md` | Superseded v0.1 agent-flow walkthrough. | Clearly superseded and foregrounded planned v0.1 adapters. | ARCHIVE |
| `docs/ard.md` | ARD discovery status. | Apex well-known URL now resolves, but source ownership remains unresolved; current repo copy status corrected. | FIX |
| `docs/assets/README.md` | Brand asset inventory. | Listed assets exist. | KEEP |
| `docs/education-profile-DRAFT.md` | Non-normative education profile draft. | Draft/profile/legal-gated status is intentional; owner decision needed before promoting. | ESCALATE |
| `docs/prior-art.md` | Dated prior-art comparison. | External source pages fetched 200; live counters still matched dated text during inventory. | KEEP |
| `docs/pilot/COPY-TO-LLM.md` | Paste-ready pilot integration brief. | `api.audiencescore.org/docs/copy-to-llm` returned 200; host split wording corrected. | FIX |
| `docs/pilot/ISSUER-QUICKSTART.md` | Issuer setup and operator commands. | Referenced admin CLI exists; write commands not run during cleanup. | KEEP |
| `docs/pilot/LEAVE-A-REVIEW.md` | Review submission instructions. | Endpoint behavior covered by passing pilot tests; write examples not run. | KEEP |
| `docs/pilot/READ-SCORES.md` | Read API and verification instructions. | REST/MCP reads verified; response below k-anonymity returns `published:false`. | KEEP |
| `docs/pilot/MULTI-TENANT-AND-DEDUP-DESIGN.md` | Multi-tenant/dedup design and build order. | "Next pilot build" was stale after PRs #17-#20; status updated to implemented spine plus deployment work. | FIX |
| `docs/llms.txt` | Repo LLM-facing integration brief. | Link to archived architecture updated with PR B. | FIX |
| `docs/.well-known/ai-catalog.json` | Repo ARD manifest copy. | Repo copy updated for resettable pilot data; apex-source decision remains separate. | FIX |
| `docs/.well-known/mcp/server-card.json` | Repo MCP server-card copy. | "No verified reviews yet" note removed; resettable pilot data wording used. | FIX |
| `score-spec/README.md` | Score spec index. | Current index points to rendering v1 and retained v0.1 math. | KEEP |
| `score-spec/rendering-v1.md` | Current rendering math. | Spec/math semantics; changes require owner/spec process. | ESCALATE |
| `score-spec/score-spec-v0.1.md` | Superseded v0.1 score math retained for reproducibility. | Already marked superseded; moving spec/math was not safe in this pass. | ESCALATE |
| `spec/SPEC-v0.2a.md` | Protocol spec v0.2 rev A. | Spec status wording requires owner/spec process. | ESCALATE |
| `spec/ADVERSARIAL-REVIEW.md` | Findings register behind spec rev A. | Spec-adjacent review register; no cleanup edit. | ESCALATE |
| `tests/ACCEPTANCE-TESTS.md` | AT-1..AT-25 register. | Every AT is executable in CI; conformance/test semantics require escalation for changes. | ESCALATE |
| `reference-impl/examples/education/README.md` | Education demonstrator README. | Demo ran successfully; draft/no-live-integration wording is intentional. | KEEP |
| `clients/mcp/README.md` | npm MCP client README. | Remote MCP endpoint works; package metadata exists. | KEEP |
| `server.json` | MCP registry metadata. | JSON parses; remote MCP endpoint advertised here works. | KEEP |

## Code Reachability Sweep

| Path | Claim or purpose | Verdict evidence | Bucket |
|---|---|---|---|
| `.github/scripts/check-links.js` | Docs link checker. | Called directly by CI. | KEEP |
| `clients/mcp/index.js` | npm stdio bridge to hosted MCP. | Package bin and registry metadata reference it. | KEEP |
| `conformance/gen_canonical_fixture.py` | Canonical fixture generator/checker. | CI runs `--check`; conformance semantics. | ESCALATE |
| `conformance/gen_vectors.py` | v0.2a conformance vector generator. | Generates normative vectors; no removal without conformance decision. | ESCALATE |
| `conformance/verify_vectors.py` | Python reference verifier. | CI runs it; conformance semantics. | ESCALATE |
| `reference-impl/api/mcp.js` | Vercel serverless read API entry. | `reference-impl/vercel.json` routes here. | KEEP |
| `reference-impl/demo.js` | v0.1 end-to-end demo. | Package script and CI run it; v0.1 removal is escalated by rule. | ESCALATE |
| `reference-impl/scripts/pilot-live-check.mjs` | Manual deployed-pilot verifier. | No CI caller, but live verification utility; no safe removal. | ESCALATE |
| `reference-impl/src/crypto.js` | Shared signing/canonical/hash helpers. | Imported by pilot, v0.2, v0.1 demo, and tests. | KEEP |
| `reference-impl/src/events.js` | v0.1 event log. | Demo/tests/stdin MCP use it; v0.1 path. | ESCALATE |
| `reference-impl/src/mcp-http-server.js` | HTTP/REST/MCP listener builder. | Vercel API and tests import it. | KEEP |
| `reference-impl/src/mcp-server.js` | v0.1 stdio MCP server. | Dockerfile, demo, and tests spawn it; v0.1 path. | ESCALATE |
| `reference-impl/src/mcp-streamable.js` | Streamable HTTP JSON-RPC handler. | Imported by HTTP and pilot servers; tested. | KEEP |
| `reference-impl/src/mcp-tools.js` | v0.1 MCP helper. | Static search found zero inbound references, but it is a v0.1 helper. | ESCALATE |
| `reference-impl/src/receipts.js` | v0.1 receipt/right registry. | Demo, score code, and tests use it; v0.1 path. | ESCALATE |
| `reference-impl/src/score.js` | v0.1 score renderer/signing. | Demo, stdio MCP, and tests use it; v0.1 path. | ESCALATE |
| `reference-impl/src/pilot/admin.js` | Pilot operator/admin CLI. | Package script, backup cron example, and issuer docs use it. | KEEP |
| `reference-impl/src/pilot/canonical-txn.js` | Pilot transaction dedupe keying. | Runtime imports it; ingest tests cover it. | KEEP |
| `reference-impl/src/pilot/email.js` | Pilot receipt email/outbox delivery. | Runtime imports it; API tests cover delivery. | KEEP |
| `reference-impl/src/pilot/keyring.js` | Pilot key creation/loading. | Runtime and tests import it. | KEEP |
| `reference-impl/src/pilot/mcp.js` | Pilot MCP tool definitions. | HTTP and pilot servers import it; tested. | KEEP |
| `reference-impl/src/pilot/partner-auth.js` | Partner request signing/verification. | Runtime imports it; pilot tests cover it. | KEEP |
| `reference-impl/src/pilot/quickbooks.js` | QuickBooks webhook adapter. | Runtime imports it; connector tests cover it. | KEEP |
| `reference-impl/src/pilot/runtime.js` | Pilot SQLite/runtime core. | Admin/server/HTTP paths import it; heavily tested. | KEEP |
| `reference-impl/src/pilot/server.js` | Pilot HTTP API server. | Docker pilot CMD and package script run it; tests import it. | KEEP |
| `reference-impl/src/pilot/square.js` | Square webhook adapter. | Runtime imports it; connector tests cover it. | KEEP |
| `reference-impl/src/pilot/stripe.js` | Stripe webhook adapter. | Runtime and pilot tests use it. | KEEP |
| `reference-impl/src/v02/canonical.js` | v0.2 receipt canonical bytes. | Runtime, signing, and tests use it. | KEEP |
| `reference-impl/src/v02/holder.js` | v0.2 holder privacy/binding helpers. | Runtime, examples, and tests use it. | KEEP |
| `reference-impl/src/v02/invariants.js` | v0.2 invariant health checks. | Tests/examples depend on it; protocol semantics. | ESCALATE |
| `reference-impl/src/v02/receipts.js` | v0.2 receipt build/verify rules. | Runtime, store, and tests use it. | KEEP |
| `reference-impl/src/v02/rendering.js` | v0.2 rendering/score math. | Runtime, live verifier, and tests use it. | KEEP |
| `reference-impl/src/v02/signing.js` | v0.2 Ed25519 signing. | Runtime/keyring/holder/receipts use it; tested. | KEEP |
| `reference-impl/src/v02/store.js` | v0.2 append-only SQLite store. | Runtime and v0.2 tests use it. | KEEP |

## Duplicate Source-of-Truth Sweep

| Pair | Claim or purpose | Consumed copy and evidence | Bucket |
|---|---|---|---|
| `docs/.well-known/ai-catalog.json` vs website `.well-known/ai-catalog.json` | ARD catalog for the apex domain. | Public crawlers consume `https://audiencescore.org/.well-known/ai-catalog.json`, served from the website deployment copy during inventory. | ESCALATE |
| `docs/.well-known/mcp/server-card.json` vs website `.well-known/mcp/server-card.json` | MCP server card. | Public crawlers consume the website deployment copy; local repo copy now describes the current HTTP source path. | ESCALATE |
| `docs/llms.txt` vs website `llms.txt` | LLM-facing public summary. | Public crawlers consume the website deployment copy; repo copy is retained for GitHub/docs readers. | ESCALATE |
| `README.md` vs website home page | Public positioning and pilot status. | Both are intentionally public-facing; repo copy is for GitHub, website copy for humans/search/social. | KEEP |
| `SECURITY.md`/`docs/pilot/READ-SCORES.md` vs website key set | Pilot rendering key fingerprint and machine key set. | Human docs and machine-readable key set are valid parallel surfaces. | KEEP |
| `server.json` vs website server card | MCP registry/server metadata. | Registry metadata and public discovery card are intentionally parallel but must not drift. | ESCALATE |
| `docs/pilot/COPY-TO-LLM.md` vs runtime `/docs/copy-to-llm` | Paste-ready pilot brief. | Runtime endpoint on `api.audiencescore.org` returns host-specific copy; repo markdown now clarifies read/write hosts. | FIX |
| `docs/ard.md` vs website deployment README | Well-known deployment explanation. | Human docs disagreed about live apex ownership; repo doc now records the unresolved source decision. | ESCALATE |

## Remove Decision

No file met the REMOVE bar. The only proven zero-inbound source file was
`reference-impl/src/mcp-tools.js`, but it belongs to the v0.1 implementation
family. The cleanup rule requires owner review for v0.1 removals, so PR C was
skipped instead of deleting it.

## Escalate List

| Item | Recommendation | Risk |
|---|---|---|
| Apex `.well-known` source ownership | Choose one publishing source for ARD, server-card, key set, and `llms.txt`, then automate copying or generation. | Public discovery can drift from repo truth, recreating the D-13 class of split-view confusion. |
| `reference-impl/src/mcp-tools.js` | Decide whether the orphaned v0.1 helper is retained for historical reuse or removed in a dedicated v0.1 cleanup PR. | Silent removal could break an undocumented v0.1 consumer; silent retention keeps dead-looking code. |
| v0.1 spec/math file placement | Decide whether retained v0.1 specs stay in `protocol/` and `score-spec/` or move under `docs/archive/` in a spec-aware PR. | Moving spec-adjacent material may break historical links and reproducibility expectations. |
| Spec release wording in `spec/SPEC-v0.2a.md` | Resolve "DRAFT for sign-off" versus README "spec released" through the spec process. | Outside contributors may not know whether the spec is normative or still awaiting sign-off. |
| Rendering v1 status wording | Resolve "draft/current implementation" status through the spec process. | Changing score-math status casually can imply a normative scoring change. |
| Conformance generators and verifier | Keep under conformance governance; do not remove generators merely because CI only runs verifier/checker. | Removing vector tooling weakens future independent implementation work. |
| `reference-impl/scripts/pilot-live-check.mjs` | Decide whether to wire it into runbooks/CI or archive it as a manual verifier. | Unowned live-check scripts drift quickly and can create false confidence. |
| `GOVERNANCE.md` and `TRADEMARK.md` | Review only through owner/legal process. | Casual edits can alter project guarantees or trademark posture. |
| Security/live-data definition | Keep "production data" distinct from resettable pilot data across docs and site copy. | Ambiguous "live data" language can overstate pilot maturity or understate security scope. |
