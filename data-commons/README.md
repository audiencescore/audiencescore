# Data Commons

The event data published by a live deployment of this protocol — admitted
verdict events, moderation events, detector commitments and reveals — forms
an open data commons under the [Open Database License
(ODbL)](LICENSE-ODbL): anyone may copy, query, and build on the full
dataset, and anyone redistributing an adapted database must share it alike
and keep attribution.

**Status: no live dataset exists yet.** The superseded v0.1 spec predates
any production deployment; the normative protocol is now
[spec v0.2a](../spec/SPEC-v0.2a.md). This directory currently holds the
licensing terms and the mirroring design ([mirroring.md](mirroring.md));
mirror tooling lands here as the first deployment goes live.

The commons is what makes the no-pay-to-play guarantee enforceable rather
than promised: because any party can mirror every event and recompute every
score with the published spec, a silently biased operator is detectable by
construction.
