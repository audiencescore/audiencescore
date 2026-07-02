# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[SemVer](https://semver.org/) (0.x: anything may change).

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
