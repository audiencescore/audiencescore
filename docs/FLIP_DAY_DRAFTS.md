# Flip-Day Drafts (staged — publish nothing until Dusty says "flip")

Everything in this file is **draft copy staged for launch day**. None of it
has been applied to the organization or made public. On flip day these are
copy-paste ready.

## Org description (one line, ≤160 chars)

Primary:

> Open, attestation-gated reputation protocol — one verified receipt, one binary verdict, scores anyone can recompute and no one can buy.

Shorter alternate (for the tighter avatar-adjacent slot):

> Reviews you can't fake: one verified receipt, one thumb, open recomputable scores.

*Apply on flip day via:* `gh api -X PATCH /orgs/audiencescore -f description='…' -f blog='https://audiencescore.org'` (blog/URL only once the site is live).

## Org avatar

`docs/assets/avatar-AS.png` (512×512). **Do not upload until approved.** Flip-day
upload is a browser step (Org → Settings → Profile → upload picture); GitHub
has no stable REST endpoint for org avatars.

## Pinned repo & topics

Pin `audiencescore/audiencescore` on the org profile; topics already set
(reputation, attestation, verifiable-credentials, mcp, open-data,
agentic-commerce, reviews).

## Org README

Drafted in the private `audiencescore/.github` repo at `profile/README.md`.
It renders on the org's public page only once that `.github` repo is made
public — so it stays invisible until flip day by simply keeping the repo
private now.

## Reminder — the order of leverage on flip day

1. Merge any pending fix PRs; `gh repo edit audiencescore/audiencescore --visibility public`.
2. Branch protection (PR + 1 review + CI + signed commits, no force push).
3. Confirm secret scanning + push protection auto-enabled; enable Pages from `/docs`; enable private vulnerability reporting; confirm first-time-contributor workflow approval.
4. Apply org description; upload avatar; make `.github` public; pin repo.
5. Publish npm + PyPI placeholders for **both** `audiencescore` and `audience-score` (both were free as of 2026-07-02); grab social handles.
6. Only then, and only on Dusty's word: MCP directories → Show HN → blog.
