# Architecture Overview

## The pipeline

```
proof of purchase ──verify──▶ review right ──spend──▶ signed verdict event
                                (single-use)                 │
                                                             ▼
   agents & humans ◀──signed manifest── score renderer ◀── append-only
   (MCP / mirrors)                      (versioned,        hash-chained
                                         deterministic)     event log
```

Four load-bearing decisions:

1. **Attestation-gated writes.** The only path to a verdict runs through a
   verified proof of transaction ([receipt-spec](https://github.com/audiencescore/audiencescore/blob/main/protocol/receipt-spec.md)).
   Fake reviews aren't detected downstream; they are priced out at the door —
   every fake costs a real transaction.

2. **Binary verdicts.** The required input is one thumb: would you use this
   vendor again. Outcomes are attestable; causes are theories. Optional
   binary dimension chips and free-text narrative add context, but prose
   never enters the math — modern readers (human or agent) can extract
   structure from narrative at read time, so nothing more is imposed at
   write time. Every additional required field costs participation, and
   sample size is what makes a score trustworthy.

3. **Events as the only state.** An append-only, hash-chained log of signed
   events ([event-spec](https://github.com/audiencescore/audiencescore/blob/main/protocol/event-spec.md)) is the single source of
   truth. Scores, sub-scores, and moderation outcomes are *renderings*:
   versioned, deterministic queries over the log, reproducible by any
   mirror. History cannot be silently edited — a mutation breaks the chain
   for anyone holding a copy.

4. **Verification without trust.** Score manifests are signed and carry the
   spec version plus a hash of the exact event set used
   ([score-spec §7](https://github.com/audiencescore/audiencescore/blob/main/score-spec/score-spec-v0.1.md#7-score-manifests)).
   The MCP read API returns these manifests, so a buying agent can verify a
   score end-to-end without trusting the server that computed it — and any
   mirror can prove an origin dishonest by recomputation. (The signature is
   only as good as its key: a production deployment publishes and pins a
   rendering key through governance; the reference server uses an ephemeral
   per-process key purely for the demo.)

## Trust boundary — what you verify vs. what you trust (v0.1)

Be exact about this, because the pitch is "verify, don't trust."

**Publicly verifiable from the log, by anyone:** chain integrity (no silent
edits) and score determinism (recompute every number bit-for-bit). These are
the load-bearing guarantees and they hold.

**Operator-attested in v0.1, not yet independently verifiable:** that each
admitted verdict was receipt-gated and single-use. The published log carries a
verdict's `right_id` and `proof_hash`, not the receipt, and chain verification
does not dedupe `right_id`; so "no receipt, no verdict" and "one right, one
verdict" are enforced by the operator's admission pipeline today, not
reconstructible from the log alone
([receipt-spec §4](https://github.com/audiencescore/audiencescore/blob/main/protocol/receipt-spec.md#4-admission-checks)).
Making that independently verifiable — admission/nullifier-spend events in the
log — is a planned revision.

**Sealed by design:** a set of operator-side anti-fraud *admission* detectors
(for attacks that survive the receipt gate). They never touch score math, act
only through public signed flag events, and are governed by commit-and-reveal
accountability — see [GOVERNANCE.md](https://github.com/audiencescore/audiencescore/blob/main/GOVERNANCE.md).
