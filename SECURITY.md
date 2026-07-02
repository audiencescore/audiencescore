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

## No live deployment yet

Spec v0.1 has no production deployment and no live data. Reports against
the spec and reference implementation are still valuable — earlier is
cheaper.
