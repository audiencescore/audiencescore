# Agent discovery via ARD (`ai-catalog.json`)

This repository ships an [Agentic Resource Discovery
(ARD)](https://agenticresourcediscovery.org) capability manifest describing the
AudienceScore MCP server, so that ARD-aware agent registries can find and index
it by crawling the domain. ARD (Apache-2.0, announced June 2026) uses
domain ownership as the basis of identity: a provider publishes a static
`ai-catalog.json` at a well-known path on its own domain, and registries crawl
it — no per-registry submission required.

The manifest copy in this repository lives at
[`docs/.well-known/ai-catalog.json`](.well-known/ai-catalog.json) and is
validated against the official [ARD JSON Schema](https://github.com/ards-project/ard-spec/blob/main/spec/schemas/ai-catalog.schema.json)
(draft 2020-12).

## Where it must be served

ARD requires the manifest at exactly this URL:

```
https://audiencescore.org/.well-known/ai-catalog.json
```

GitHub Pages publishes the repository's `docs/` folder (see the docs-link CI
check), so this repository stores the file at
`docs/.well-known/ai-catalog.json`. The public apex domain currently serves its
well-known files from the website deployment, so keep this repo copy and the
apex copy in sync until the project chooses a single publishing source.

## Deployment status

The manifest is not deployed by the reference implementation tests. DNS,
website hosting, and dot-folder publishing are operational concerns:

1. **Serve `audiencescore.org/.well-known/ai-catalog.json` from the active
   website host.** As of 2026-07-05, the URL resolves, but the active website
   deployment has its own copy of the well-known files. Treat the single-source
   ownership decision as unresolved; do not assume editing this repo file alone
   updates the apex URL.

2. **Make Pages actually publish the `.well-known/` dot-folder.** GitHub Pages'
   default Jekyll build **excludes files and folders that start with a dot**, so
   `docs/.well-known/` will be dropped unless you opt it back in. Two ways, pick
   one:
   - add a Jekyll `docs/_config.yml` containing `include: [".well-known"]`
     (recommended — keeps the existing Markdown-to-HTML rendering of the other
     docs pages), **or**
   - add an empty `docs/.nojekyll` file (disables Jekyll entirely — simpler, but
     then the `.md` docs pages are served raw instead of rendered).

   This remains an owner decision because it changes how the whole docs site
   builds; it is not a runtime code change and is not covered by the reference
   tests.

3. **Serve the referenced MCP server card.** The catalog entry's `url` points at
   `https://audiencescore.org/.well-known/mcp/server-card.json`, which is stored
   in this repo at `docs/.well-known/mcp/server-card.json`. The hosted read
   endpoint is Streamable HTTP at `https://mcp.audiencescore.org/mcp`; the source
   of truth remains the open-source server in
   [`reference-impl/src/mcp-http-server.js`](https://github.com/audiencescore/audiencescore/blob/main/reference-impl/src/mcp-http-server.js).

## Honest status

- **Pilot data is resettable.** The server answers `get_score` and
  `get_score_evidence` for pilot-labeled data. Offerings below the k-anonymity
  floor return `published:false`; listing the capability is a discovery flag,
  not a production coverage claim.
- **ARD was pre-production in mid-2026.** Expect little or no crawler traffic
  yet; this is planting the flag so discovery lands the day the ecosystem and
  live data both exist.

## Validate the manifest

Using the spec's recommended validator:

```sh
npx ajv-cli validate \
  -s https://raw.githubusercontent.com/ards-project/ard-spec/main/spec/schemas/ai-catalog.schema.json \
  -d docs/.well-known/ai-catalog.json --spec=draft2020 -c ajv-formats
```
