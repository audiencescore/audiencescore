# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[SemVer](https://semver.org/) (0.x: anything may change).

## [Unreleased]

### Fixed

- The hosted read API is now a thin fail-closed reverse proxy to the pilot
  server (set `AUDIENCESCORE_UPSTREAM_BASE_URL`), so every public host serves
  the same ledger signed by the same rendering key; with the origin down it
  answers 502 rather than fabricating data (DRIFT D-13).
- `/health` now exposes the rendering signer, its SHA-256 fingerprint, and the
  serving commit, and a scheduled cross-host probe fails if public hosts ever
  diverge in key, code, or signed content.

- Pilot ingestion now quarantines canonical-key conflicts and no-rail surrogate
  ambiguities instead of silently corroborating or minting.
- Partner `/v1/transactions` writes now require signed, timestamped, nonce-bound
  Ed25519 requests; replayed nonces are refused.
- Stripe, Square, and QuickBooks webhook handlers reject stale signed events.
- Streamable HTTP MCP now serves the v0.2 pilot read surface (`get_score` and
  `get_score_evidence`), validates Origin/protocol headers, and exposes REST
  score/evidence reads through the same runtime.
- Public docs and discovery metadata now describe the v0.2 offering-based pilot
  read API instead of the superseded v0.1 vendor-score demo.

## [0.2.0] — 2026-07-04

Protocol spec v0.2 rev A, implemented. A strict generalization of v0.1
(single level, single role, atomic unversioned offering is now the degenerate
case). **Releasing the spec text does not close the release gates:** two
gates remain open before any receipt signs a real transaction — independent
cryptographic review of the receipt scheme, and per-vertical legal review —
see the README Status section. No live data is being collected.

### Added

- **Spec v0.2a** (`/spec`): the attestation ladder (L1 TRANSACTED → L4
  OUTCOME, levels independent), payer/participant roles, versioned composite
  offerings, the as/0.2a signed receipt schema, seven protocol invariants,
  and the threat model — plus the adversarial review (F1–F10) that shaped it.
- **Conformance suite** (`/conformance`): Ed25519-signed test vectors
  (fixed-seed TEST keys only), a Python reference verifier, byte-level
  canonical serialization rules, and a canonical-bytes fixture CI cross-checks
  against the reference.
- **Acceptance tests** (`/tests` + `reference-impl/test/v02`): AT-1..AT-25,
  every one an executable test — receipt cryptography against the vectors,
  roles and free-offering entry, version binding, rendering determinism and
  dual views, k-anonymity gating, a seeded violation of every invariant
  proving its alarm fires, and a repository scan for test-key hygiene.
- **v0.2 reference implementation** (`reference-impl/src/v02`): receipt
  signing behind one swappable interface, BLAKE3 per-issuer holder bindings,
  a SQLite store with append-only enforcement inside the storage engine,
  automatic non-discretionary L1 issuance, the attestation-request/refusal
  event flow, rendering v1 (`score-spec/rendering-v1.md`), and the I-1..I-7
  health-check register.
- **DRIFT.md**: the plain-English register of every difference between v0.1
  reality and spec v0.2a, and how each was resolved.
- **Agent discovery surface**: ARD `ai-catalog.json` describing the MCP
  server, sharpened MCP server/tool discovery metadata, `glama.json`, and a
  Dockerfile for registry introspection.
- **Education issuer adapter demonstrator** and the draft education profile.

### Fixed

- **Receipts are bound to the offering's declared issuer** (independent
  audit's MAJOR finding): a receipt signed by any key other than the
  offering's declared issuer no longer verifies.
- Pre-launch adversarial-review remediations (H-1/H-2/H-3 and mediums).

### Changed

- README replaced with the v0.2 framing (transaction *or verified
  participation*; open release gates stated).
- CI: Node 24 (for `node:sqlite`), npm lockfile install, the v0.2 acceptance
  suite, and the Python conformance verifier.
- The reference implementation now carries exactly one runtime dependency,
  the audited `@noble/hashes` (BLAKE3), pinned exact with a committed
  lockfile.
- Governance: no-CLA, open score math, and forkability are non-amendable.
- All v0.1 documents now carry superseded notices pointing to spec v0.2a;
  they are retained verbatim for reproducibility.

## [0.1.0] — 2026-07-02

First public draft.

### Added

- **Protocol v0.1**: signed, hash-chained event envelope; `verdict` event
  type (binary verdict, optional dimension chips, optional narrative);
  receipt spec with four proof tiers and single-use review rights.
- **Score spec v0.1**: percent verified thumbs-up with proof-tier weights,
  24-month half-life time decay, Wilson 95% lower bound, display floors,
  signed score manifests with provenance hashes.
- **Reference implementation** (Node.js 18+, zero dependencies): crypto,
  event log, rights registry, score renderer, minimal MCP server exposing
  `get_score`, end-to-end demo, test suite.
- **Governance**: the open-forever / sealed-admission boundary and the
  commit–reveal–audit accountability machinery, published as the project
  constitution.
- Community files: contributing guide (RFC process, DCO), security policy,
  code of conduct, issue/PR templates, CI, Dependabot.
