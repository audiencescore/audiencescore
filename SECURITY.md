# Security Policy

The Audience Score is trust infrastructure; security reports are treated as
first-class contributions.

## Reporting a vulnerability

Please **do not** open a public issue for anything exploitable. Instead use
GitHub's private vulnerability reporting on this repository
(*Security → Report a vulnerability*), which reaches the maintainers
privately. You should receive an acknowledgment within 72 hours.

We follow coordinated disclosure: we'll work with you on a fix and a
disclosure timeline (default 90 days), and credit you in the advisory
unless you prefer otherwise.

## Scope

**In scope**

- The protocol and score specifications (`/protocol`, `/score-spec`) —
  including design-level attacks: signature or chain-verification bypasses,
  review-right double-mint/double-spend, score manipulation within the
  published math, manifest forgery.
- The reference implementation (`/reference-impl`).
- Admission integrity in the abstract: if you can describe an attack class
  the public admission checks cannot express a defense against, we want the
  report even though sealed-detector internals live outside this repository
  (see [GOVERNANCE.md](GOVERNANCE.md)).

**Out of scope**

- Denial-of-service against demo tooling, and issues requiring a
  compromised operating system or stolen private keys.

## Live pilot scope

AudienceScore has a hosted pilot read surface (`mcp.audiencescore.org`) and
operator-deployable pilot write/issuer code in `reference-impl/src/pilot/`.
There is no production deployment and no live review data. Reports against the
spec, reference implementation, hosted read surface, and pilot write paths are
valuable — earlier is cheaper.

## Known hardening notes (v0.2a reference implementation)

The v0.2a implementation is a demonstrator, not production software. Two
enforcement boundaries are worth naming explicitly, both raised by
independent review:

- **Issuer binding.** A receipt only counts if it was signed by the
  offering's **declared** issuer (the provider of record). The reference
  implementation enforces this at issuance, at review admission, and via a
  health-check detector; see DRIFT.md D-12. This closes an audit finding where
  a stranger's own-key receipt against another party's offering could
  otherwise blend into that offering's score. A production deployment must
  keep this binding in whatever write path it exposes — it is load-bearing.
- **Append-only at the database role.** The store enforces append-only with
  storage-engine triggers; SQLite has no user/role system, so a production
  deployment on a server database must additionally run the application under
  a role with no UPDATE/DELETE grants (DRIFT.md D-4).

## Pilot rendering key (pinned)

Every public read host serves manifests signed by one pilot rendering key,
held only by the pilot server. Verify a response's `signer` against the
published key set at
`https://audiencescore.org/.well-known/audiencescore-keys.json` — do not trust
the embedded key alone. Current pilot rendering key fingerprint (SHA-256 of
the `signer` string):

```
d5bbe47ae8c9f6878cdb526ef5b9c1012ac262f01c2cdeef1674eba888ab23d7
```

`GET /health` on any public host returns the live `signer`,
`signer_fingerprint`, and serving `git_sha`; a scheduled cross-host probe
fails publicly if hosts ever diverge. The pilot ledger may be reset and this
key rotated after the independent cryptographic review; rotations update the
published key set and this fingerprint in the same commit.

Neither the demonstrator nor this spec substitutes for the two standing
release gates: an independent cryptographic review of the receipt scheme, and
a per-vertical legal review, both required before any receipt signs a real
transaction.
