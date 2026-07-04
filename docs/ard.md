# Agent discovery via ARD (`ai-catalog.json`)

This repository ships an [Agentic Resource Discovery
(ARD)](https://agenticresourcediscovery.org) capability manifest describing the
AudienceScore MCP server, so that ARD-aware agent registries can find and index
it by crawling the domain. ARD (Apache-2.0, announced June 2026) uses
domain ownership as the basis of identity: a provider publishes a static
`ai-catalog.json` at a well-known path on its own domain, and registries crawl
it — no per-registry submission required.

The manifest lives in the repo at
[`.well-known/ai-catalog.json`](.well-known/ai-catalog.json) and is validated
against the official [ARD JSON Schema](https://github.com/ards-project/ard-spec/blob/main/spec/schemas/ai-catalog.schema.json)
(draft 2020-12).

## Where it must be served

ARD requires the manifest at exactly this URL:

```
https://audiencescore.org/.well-known/ai-catalog.json
```

GitHub Pages publishes only the `docs/` folder (see the docs-link CI check), so
the file is stored at `docs/.well-known/ai-catalog.json` — which maps to the
required URL once the domain points at Pages.

## Deploy steps — these belong to the project owner, not to CI

The manifest is a **planted flag**: committing it here does nothing until the
domain is wired up. None of the following are done, and none should be
automated in this repo — they are deploy/DNS actions for the owner:

1. **Point `audiencescore.org` at this repository's GitHub Pages** (Pages
   custom domain + the DNS records GitHub specifies + a `CNAME`). Until then the
   well-known URL does not resolve.

2. **Make Pages actually publish the `.well-known/` dot-folder.** GitHub Pages'
   default Jekyll build **excludes files and folders that start with a dot**, so
   `docs/.well-known/` will be dropped unless you opt it back in. Two ways, pick
   one:
   - add a Jekyll `docs/_config.yml` containing `include: [".well-known"]`
     (recommended — keeps the existing Markdown-to-HTML rendering of the other
     docs pages), **or**
   - add an empty `docs/.nojekyll` file (disables Jekyll entirely — simpler, but
     then the `.md` docs pages are served raw instead of rendered).

   This is left as an owner decision because it changes how the whole site
   builds; it is not a code change and is not covered by the reference tests.

3. **(Optional, to make the entry fully resolvable) serve the referenced MCP
   server card.** The catalog entry's `url` points at
   `https://audiencescore.org/.well-known/mcp/server-card.json`. The reference
   MCP server today speaks JSON-RPC 2.0 over **stdio** and is not hosted, so no
   server card and no HTTP endpoint exist yet. An ARD crawler will find the
   catalog entry but get a 404 for the card until one is published — acceptable
   at flag-planting stage, and a natural companion to any future hosted
   deployment. The source of truth remains the open-source server in
   [`reference-impl/src/mcp-server.js`](https://github.com/audiencescore/audiencescore/blob/main/reference-impl/src/mcp-server.js).

## Honest status

- **No live data.** The `metadata.hasLiveData` field is `false` on purpose. The
  server answers `get_score`, but with no receipts recorded a real vendor
  returns a not-displayed manifest. Listing the capability is a discovery
  flag, not a claim of coverage.
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
