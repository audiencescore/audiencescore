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
   mirror can prove an origin dishonest by recomputation.

## Trust boundary

Everything above is open, forever, by constitution. The only closed
component in the whole design is a set of operator-side *admission*
detectors (anti-fraud checks on incoming submissions), which never touch
score math, act only through public signed flag events, and are governed by
commit-and-reveal accountability — see [GOVERNANCE.md](https://github.com/audiencescore/audiencescore/blob/main/GOVERNANCE.md).
