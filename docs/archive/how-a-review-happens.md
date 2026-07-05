# How a review actually happens

> **ARCHIVED 2026-07-05:** superseded by
> [spec v0.2a](https://github.com/audiencescore/audiencescore/blob/main/spec/SPEC-v0.2a.md)
> and the current pilot docs in
> [docs/pilot/](https://github.com/audiencescore/audiencescore/tree/main/docs/pilot).
> Kept for history; do not follow.

There is no form. Nobody sits down to "write a review" in this protocol — no
star box, no text field, no "rate your experience" email. **The form is dead.
The agent is the input mechanism.**

> **Status (v0.1, superseded):** this page describes the intended v0.1 flow.
> The normative protocol is now
> [spec v0.2a](https://github.com/audiencescore/audiencescore/blob/main/spec/SPEC-v0.2a.md).
> The reference implementation today verifies vendor-signed receipts and
> renders scores; DKIM-email, card-link, and agentic-mandate proof adapters,
> and the public moderation events referenced below, are specified but not yet
> built. They are marked *(planned)* where they appear.

Here is the actual flow, end to end:

1. **You complain to your agent.** "The car wash left my car still dirty."
   That one honest sentence, to the assistant you already talk to, is the
   entire human action.

2. **The agent finds the proof it already holds.** It does not ask you for a
   receipt. It verifies the DKIM-signed purchase confirmation already sitting
   in your mailbox — the email the vendor's own mail server cryptographically
   signed when you paid *(planned adapter)*. **A receipt is never paper.** It
   is any cryptographic proof the agent already holds: a DKIM-signed email
   *(planned)*, an agentic-commerce payment mandate *(planned)*, or a
   vendor-signed receipt (built today)
   ([receipt-spec](https://github.com/audiencescore/audiencescore/blob/main/protocol/receipt-spec.md)).

3. **It computes the transaction nullifier.** A deterministic value derived
   from that one transaction. The nullifier is what guarantees a single real
   purchase can mint exactly one verdict, ever — spend it once and it is spent.

4. **It builds, signs, and submits the verdict event.** *Would you use them
   again: no.* The agent signs the verdict and appends it to the hash-chained
   log
   ([event-spec](https://github.com/audiencescore/audiencescore/blob/main/protocol/event-spec.md)).

5. **Admission checks run.** Deterministic checks (proof valid, nullifier
   unspent, duplicate detection) and the operator's sealed anti-fraud tripwires
   ([governance](https://github.com/audiencescore/audiencescore/blob/main/GOVERNANCE.md))
   decide whether the verdict enters the scored set. In v0.1 these run in the
   operator's admission pipeline; publishing each decision as a public, signed
   moderation event — so mirrors can audit admission themselves — is *(planned)*
   ([receipt-spec §4](https://github.com/audiencescore/audiencescore/blob/main/protocol/receipt-spec.md#4-admission-checks)).

6. **The score re-renders.** The vendor's audience score is a deterministic
   function over the log
   ([score-spec v0.1](https://github.com/audiencescore/audiencescore/blob/main/score-spec/score-spec-v0.1.md),
   superseded by
   [rendering v1](https://github.com/audiencescore/audiencescore/blob/main/score-spec/rendering-v1.md));
   the new verdict shifts it, and anyone can recompute the result to the
   decimal.

The pre-LLM reason for review forms — machines couldn't read prose — is gone.
The agent extracts the structure (which vendor, which verdict, which proof)
from a sentence plus a signature. The form was always a workaround for that
gap, and the gap has closed.

## FAQ

**Can't an AI just forge a receipt?**

You can fake the pixels; you can't fake the key. A fabricated proof — a
screenshotted email, an invented order number, a doctored PDF — fails
signature verification: the DKIM signature, the payment mandate, or the
vendor key simply does not validate, so the verdict never mints. And even a
*real* proof is worth exactly one verdict: the transaction nullifier is
designed so each genuine purchase is spendable once and only once, so a real
receipt can't be replayed into a flood of reviews. (In v0.1 that single-use
rule is enforced at admission, not yet reconstructible from the public log
alone; making it independently verifiable is
[planned](https://github.com/audiencescore/audiencescore/blob/main/protocol/receipt-spec.md#4-admission-checks).)

**What about two businesses with the same name?**

They are different identifiers, so they are different score entities — a
verdict never binds to a name. It binds to a *typed vendor identifier*: a
DNS-verified vendor key, a platform merchant id read from the proof, or a hash
of name-plus-address (see the
[Vendor identity section of the event spec](https://github.com/audiencescore/audiencescore/blob/main/protocol/event-spec.md#5-vendor-identity)).
"Joe's Plumbing" in Denver and "Joe's Plumbing" in Miami resolve to different
identifiers and carry entirely separate scores. Collision is impossible by
construction; the only way two identifiers ever become one entity is a
cryptographically proven merge, recorded as a public signed event.
