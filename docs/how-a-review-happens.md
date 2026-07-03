# How a review actually happens

There is no form. Nobody sits down to "write a review" in this protocol — no
star box, no text field, no "rate your experience" email. **The form is dead.
The agent is the input mechanism.**

Here is the actual flow, end to end:

1. **You complain to your agent.** "The car wash left my car still dirty."
   That one honest sentence, to the assistant you already talk to, is the
   entire human action.

2. **The agent finds the proof it already holds.** It does not ask you for a
   receipt. It verifies the DKIM-signed purchase confirmation already sitting
   in your mailbox — the email the vendor's own mail server cryptographically
   signed when you paid. **A receipt is never paper.** It is any cryptographic
   proof the agent already holds: a DKIM-signed email, an agentic-commerce
   payment mandate, or a vendor-signed receipt
   ([receipt-spec](https://github.com/audiencescore/audiencescore/blob/main/protocol/receipt-spec.md)).

3. **It computes the transaction nullifier.** A deterministic value derived
   from that one transaction. The nullifier is what guarantees a single real
   purchase can mint exactly one verdict, ever — spend it once and it is spent.

4. **It builds, signs, and submits the verdict event.** *Would you use them
   again: no.* The agent signs the verdict and appends it to the hash-chained
   log
   ([event-spec](https://github.com/audiencescore/audiencescore/blob/main/protocol/event-spec.md)).

5. **Admission checks run.** Public checks (proof valid, nullifier unspent,
   duplicate detection) and the operator's sealed anti-fraud tripwires
   ([governance](https://github.com/audiencescore/audiencescore/blob/main/GOVERNANCE.md))
   decide whether the verdict enters the scored set — and every decision is
   itself a public, signed event.

6. **The score re-renders.** The vendor's audience score is a deterministic
   function over the log
   ([score-spec](https://github.com/audiencescore/audiencescore/blob/main/score-spec/score-spec-v0.1.md));
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
*real* proof is worth exactly one verdict: the transaction nullifier makes
each genuine purchase spendable once and only once, so a real receipt can
never be replayed into a flood of reviews.
