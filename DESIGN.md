# AudienceScore Pilot Deployment Design

Status: pilot deployment, pre-cryptographic-audit. The independent
cryptographic review and per-vertical legal review gates remain open. The pilot
ledger may be reset and receipts re-issued after the audit.

This document describes the first hosted AudienceScore pilot: one small Node
HTTP service backed by the existing v0.2 SQLite reference store, deployed as a
new Docker container on the existing DigitalOcean VPS behind the existing Caddy
reverse proxy. It does not move storage to Postgres, does not modify Cary's
application container, and does not commit secrets, keys, or customer data.

## Pilot Markers

Every pilot artifact created by the hosted service carries `env: "pilot"`:

- Pilot receipts include `env` in the receipt payload before signing, so the
  marker is covered by the issuer's Ed25519 signature.
- Pilot review/protocol events are written as signed pilot events whose signed
  body includes `env`.
- Pilot score manifests include `env` in the signed manifest body.

Public docs and responses must say: pilot deployment, pre-cryptographic-audit;
the pilot ledger may be reset and receipts re-issued after the audit.

## Storage

The pilot reuses `reference-impl/src/v02/store.js` and its SQLite append-only
tables/triggers. Small pilot-only operational tables are added next to the
reference store:

- `pilot_issuers`: public issuer metadata and Stripe account mapping.
- `pilot_offerings`: merchant-facing offering names mapped to offering refs.
- `pilot_delivery_claims`: random claim tokens mapped to receipt IDs.
- `pilot_events`: signed pilot events for issuance, delivery, review, and
  webhook handling.
- `pilot_webhook_events`: Stripe event idempotency records.

Issuer private keys, rendering/event signing keys, Stripe webhook secrets, SMTP
credentials, and any `.env` files live only on the VPS under mounted data
directories. They are never committed. Receipt delivery email addresses are used
only to send email or write a local `.eml` pilot outbox file; plaintext customer
identity is not written to the ledger.

Nightly backup is a cronable admin command that copies the SQLite database to a
dated backup file under the mounted data directory. The deployment also supports
copying that dated file off-box later without changing application code.

## Public Read API

Unauthenticated read paths:

- `GET /health`
- `GET /v0/scores/{offering}` returns an Ed25519-signed pilot rendering v1
  manifest for an offering-version.
- `GET /v0/scores/{offering}/evidence` returns the de-identified rendering
  input needed to recompute the score. It omits holder identities and customer
  data; it is not a holder-to-offering directory.
- `POST /mcp` exposes the `get_score` tool over HTTP JSON-RPC for remote MCP
  clients. The tool returns the same signed manifest as the REST path.
- `GET /docs/copy-to-llm` serves a paste-ready integration brief for agent
  builders, including endpoint URLs, JSON shapes, and curl examples.

`protocol/openapi.json` is updated from the old v0.1 read-only draft to the
pilot reality.

## Write API

The agent-facing write path is:

- `POST /v0/reviews`

The request presents the signed pilot receipt JSON and the review payload. The
server verifies the receipt signature, confirms the presented receipt exactly
matches a receipt already issued in the pilot ledger, then calls
`Store#submitReview`. The reference store enforces no receipt/no review, exact
offering binding, declared-issuer binding, one review per standing, payer/facet
rules, and facet validity. The response includes a signed pilot event.

The email claim path is:

- `GET /claim/{token}` serves a small review form.
- `POST /v0/claims/{token}/reviews` redeems the claim token and submits through
  the same store admission path.

The claim path is for non-developers. The direct receipt-presenting API remains
the canonical agent path.

## Issuer Onboarding

An admin CLI creates pilot issuers and offerings:

- Generate an issuer Ed25519 keypair on the VPS and store the private key only
  in the mounted key directory.
- Register public issuer metadata and Stripe account mapping.
- Declare offerings in the v0.2 store with their declared issuer binding,
  components, price, and attestation criteria.
- Print the merchant-facing values: issuer id, issuer public key, offering ref,
  Stripe metadata keys, webhook URL, and receipt/review URLs.

Field Elevate's first issuer setup is configuration-only. Dusty supplies the
Stripe account choice and secrets at deploy time; adding or switching businesses
is config plus admin CLI, not code.

## Receipt Issuance

Stripe adapter:

- Receives `checkout.session.completed` and `invoice.paid`.
- Verifies Stripe's webhook signature using secrets from VPS environment only.
- Reads issuer/offering/role from configured metadata or issuer mapping.
- Atomically records the transaction through `Store#recordTransaction`, which
  issues the L1 TRANSACTED receipt in the same SQLite transaction.
- Delivers a pilot email with the signed receipt JSON attached and a claim/review
  URL. If SMTP is not configured, the same MIME email is written to a local
  pilot outbox for deployment testing.

Manual issuance:

- Admin CLI command records an invoice transaction and issues the L1 receipt
  through the same `Store#recordTransaction` path.
- I-2 still applies: manual issuance must correspond 1:1 to a real transaction.

For pilot delivery, holder bindings are pseudonymous random per-receipt bindings
generated by the service. Plaintext customer identity is not stored in the
ledger.

## Deployment

The pilot deploys as a new container:

- Host: existing DigitalOcean VPS.
- Hostname: `api.audiencescore.org`.
- Container: `audiencescore-pilot`, joined to the existing Docker network so
  Caddy can reverse-proxy it.
- Caddy: add a new site block only for `api.audiencescore.org`; snapshot the
  Caddyfile before editing. Do not modify the Cary bridge application container
  or route.
- DNS: GoDaddy-managed. If DNS cannot be edited from available credentials,
  verify by IP plus Host header and report the exact `A` record needed.

## Verification

Before reporting done:

- Issue one pilot receipt through a Stripe test-mode webhook fixture.
- Issue one pilot receipt through the manual CLI.
- Redeem one receipt through the public endpoint.
- Confirm public `get_score` returns an updated signed pilot manifest.
- Verify the manifest signature and recompute from public evidence.
- Confirm abuse failures: receipt reuse, wrong declared issuer, no receipt.
- Run the full acceptance suite and GitHub CI.
