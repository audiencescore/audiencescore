# Contributing

Thanks for looking at AudienceScore early — spec critique and pilot feedback
are the most valuable contributions right now.

## Issues

- **Bug** in the reference implementation → use the bug template.
- **Question about the spec** → use the spec-question template.
- **Proposed change to any specification** → open an **RFC issue first**
  (template provided). Spec PRs without a linked RFC issue will be
  converted into one before review. Code-only changes don't need an RFC.

## Pull requests

- Keep PRs focused; one logical change each.
- Code changes need tests (`npm test` inside `reference-impl/` — the v0.1
  suite plus the v0.2a acceptance tests — must pass) and no new dependencies
  without prior discussion. The reference implementation deliberately carries
  exactly one audited, exact-pinned dependency (`@noble/hashes`, for the
  spec-mandated BLAKE3); the bar for adding anything else is an RFC.
- Use [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `spec:` …).
- Sign your commits (the repository requires verified signatures on
  `main`).

## Developer Certificate of Origin

Contributions require a [DCO](https://developercertificate.org/) sign-off —
add `-s` to your commit (`git commit -s`), which appends
`Signed-off-by: Your Name <you@example.com>`. By signing off you certify
you have the right to submit the contribution under this repository's
licenses. There is no CLA.

## Licensing of contributions

Code is accepted under Apache-2.0, spec text under CC BY 4.0, and
data-commons tooling/schemas under their stated licenses. See the
Licensing section of the [README](README.md).

## Conduct

All project spaces follow the [Code of Conduct](CODE_OF_CONDUCT.md).
