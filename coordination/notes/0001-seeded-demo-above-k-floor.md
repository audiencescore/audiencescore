---
id: 0001
from: orchestrator-ceo
to: any
topic: Should we seed a demo offering above the k-anonymity floor?
status: answered
created: 2026-07-22
---

Today the live pilot host returns `published: false` for the demo offering
because it is below the k-anonymity floor (I-7). That is the correct, honest
posture — the protocol refuses to fabricate a score below `k` distinct receipts.

But it means the very first thing a real adopter of the consumer helper
(`reference-impl/examples/consumer/audiencescore-select.js`) sees is "no usable
score," which undercuts the taster's whole "watch the choice flip" moment
against live data.

Question for whoever picks this up: is it worth standing up ONE demo offering
with enough genuine pilot receipts to clear the k-floor, purely so the read-path
demos return a real number against the live host? Constraints to respect in any
answer:

- It must be real pilot data carrying `env: "pilot"`, not fabricated reviews —
  seeding fake receipts to clear the floor is exactly the manufactured-usage
  line the CEO charter forbids. If we can't populate it honestly, the answer is
  "no, leave it below the floor and let the demos use offline fixtures."
- Does clearing the floor for a single demo offering leak anything about the
  small cohort behind it (the reason the floor exists)? If so, no.

Recommendation sought: honest-yes with a plan, or principled-no. Sign your answer.

## Answers
<!-- appended below; sign each: — <who>, <date> -->

**Principled-no.** Do not seed a demo offering to clear the k-floor. Leave the
live host honestly returning `published: false` and let the read-path demos run
on the offline fixtures they already carry.

The reasoning, in order of what actually decides it:

1. **The honest version of "yes" is unavailable, and the dishonest version is
   forbidden.** The floor is `K_ANONYMITY: 10`
   (`reference-impl/src/v02/rendering.js:22`); the live subject sits at
   `distinct_receipts: 1` (`docs/pilot/READ-SCORES.md`). Clearing it means
   *ten distinct, genuine* `env: "pilot"` receipts from ten independent
   reviewers who really used the offering. We do not have those. The only ways
   to conjure them — minting synthetic receipts, or a coordinated internal push
   whose purpose is to hit 10 rather than to record genuine independent use —
   are the manufactured-usage line the charter draws (and rewarding submission
   to get them is separately barred, spec §10 / T-2). If the ten do not already
   exist as a byproduct of real usage, there is no honest button to press.

2. **The demo does not actually need a live published number.** The "watch the
   choice flip" moment already runs on genuinely-signed data offline:
   `reference-impl/examples/consumer/example.js` signs its own manifests with a
   real locally-generated Ed25519 key using the protocol's own crypto, so the
   verify/rank path is exercised for real, not stubbed (see that dir's
   README, "Offline fidelity"). An adopter watching the choice flip is watching
   real signatures verify and real scores reorder tools. The live host is a
   secondary probe, not the payload.

3. **`published: false` is a feature to *show*, not a gap to paper over.** The
   most trust-building thing a first-time reader of the consumer helper can see
   is the protocol *refusing to fabricate a number* below the floor — that is
   the entire pitch ("verify, don't trust") demonstrated live against real data.
   Reframe the taster copy so the live probe presents `published: false` as the
   floor working as designed (the helper already degrades it to "no usable
   score" and does not punish the tool for it), rather than as an anticlimax.
   This is an in-repo doc/copy change I can own without any of the above risk.

4. **On the leak question you flagged:** it does not even get that far. If ten
   genuine distinct reviewers existed, k-anon would be satisfied by construction
   and nothing would leak — that is what `k=10` buys. The hazard is not "clear
   the floor and leak a small cohort"; it is "there is no genuine cohort to
   clear it with," which is why the answer is no on the prior ground.

The only honest route to a live published number is organic accumulation: when
some offering naturally reaches ≥10 genuine distinct `env: "pilot"` reviewers
as a byproduct of real usage, it clears the floor on its own and the live demos
light up for free. Do not force that timeline.

One thing for the **owner**, not me, to weigh: the offering currently wired into
the pilot host is a regulated-vertical (fund) subject, which independently trips
the per-vertical legal gate before it could ship as a public promoted profile.
So even if genuine volume arrived, that particular subject is a poor choice to
feature publicly. If the owner wants a live "watch it flip" surface someday, the
better target is a non-regulated synthetic offering accumulating genuine pilot
use — a supply/timeline call, not something to engineer this week.

— orchestrator-ceo, 2026-07-22
