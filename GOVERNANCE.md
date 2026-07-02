# Governance

This document is the constitution of the Audience Score repository. It fixes
the boundary between what is guaranteed open forever and what may be sealed,
and the accountability machinery that governs the sealed part. Publishing the
secrecy rules is itself part of the trust design: you should not have to
trust the operators' intentions, only verify their commitments.

## 1. Two integrity domains

**Score integrity — open forever, constitutionally.** The following are
public and will never be closed, narrowed, or made proprietary:

- the event schema and signing rules (`/protocol`),
- the append-only, hash-chained event log and every admitted event,
- the versioned score function (`/score-spec`) and every parameter in it,
- the moderation log: every flag, quarantine, and admission decision, as
  signed public events.

Anyone may mirror the full repository and recompute every score to the
decimal. Nothing sealed ever touches the score math. There is no ranking to
sell: a score is a deterministic function over public signed events, so paid
placement is not a policy we promise to avoid — it is an operation the
system cannot express.

**Admission integrity — may contain sealed components.** Fraud detection is
adversarial: publishing a detector teaches counterfeiters how to defeat it.
The detectors that decide whether a *submitted* attestation is flagged or
quarantined *before* it enters the scored set may therefore be operated
without publishing their internals. Some admission checks are public
(documented deterrents such as receipt validity, velocity limits, and
duplicate detection — the reference implementation contains only these);
a small set may be sealed.

A sealed detector can do exactly one visible thing: emit a public, signed
flag event. What stays hidden is *why* it fired — never *that* it fired.

## 2. Accountable secrecy: commit, reference, reveal, audit

Sealed components are governed by a commitment scheme:

1. **Commit on activation.** The day a sealed detector version goes live,
   its cryptographic commitment — the SHA-256 hash of the exact code,
   model weights, and thresholds — is published as a signed event in the
   repository. The secret is locked in public without being shown.
2. **Reference on every fire.** Every flag or quarantine is a public signed
   event carrying the detector-version hash that produced it. The moderation
   log is fully public; only detector internals are dark.
3. **Reveal on retirement.** When a detector version rotates out, it is
   disclosed after a cooling window. Anyone can verify the reveal matches
   the original commitment and re-run every historical decision — proof
   that rules were never changed retroactively or applied selectively.
4. **Audit in the gap.** Between commit and reveal, an independent auditor
   under NDA may verify live detectors against their commitments and test
   for bias (for example, that no vendor category or region is selectively
   targeted). The auditor's signed attestation is published; the detector
   is not.

Standing constraints on the sealed layer:

- No sealed detector runs uncommitted.
- Sealed logic never touches score computation.
- No sealed check may be load-bearing alone; the system must survive full
  disclosure of any single detector.
- Sealed detectors are operated server-side and never ship in any
  repository, release, or artifact.

## 3. Amendment rules

- The "open forever" list in §1 may be extended, never narrowed.
- The sealed zone is limited to admission detectors and may not be widened
  to any other component by any future decision of any maintainer,
  operator, or governing body.
- Changes to this document follow the RFC process in
  [CONTRIBUTING.md](CONTRIBUTING.md) and require explicit maintainer
  approval, recorded in the pull request history.

## 4. Maintainers and trajectory

The project is currently maintained by its founding team under the
`audiencescore` GitHub organization. The intended trajectory, as the
protocol matures and gains independent implementations and mirrors, is
stewardship by a neutral foundation — the path already walked by other
open trust infrastructure (content-provenance and agentic-payment
standards that began vendor-hosted and were donated to standards bodies).
Until then, this constitution binds the current maintainers.
