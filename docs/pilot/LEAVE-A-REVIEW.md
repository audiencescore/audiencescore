# Leave A Review

AudienceScore pilot deployment, pre-cryptographic-audit. The independent
cryptographic review and per-vertical legal review gates remain open. The pilot
ledger may be reset and receipts re-issued after the audit.

## You Got A Receipt Email

Your email has two important pieces:

- a signed receipt JSON attachment
- a review link

The receipt is your proof that a real transaction happened. Keep it. A receipt
can submit one review for that exact offering-version.

## Easiest Path

1. Open the review link in the email.
2. Enter an overall score from 1 to 5.
3. Add optional review text.
4. Submit.

The pilot will reject duplicate reviews from the same receipt.

## Agent Path

Your AI agent can submit directly:

```sh
curl -s -X POST "{issuer_write_base_url}/v0/reviews" \
  -H "content-type: application/json" \
  --data @review.json
```

`review.json`:

```json
{
  "receipt": {
    "spec": "as/0.2a",
    "receipt_id": "uuidv7",
    "issuer": "ed25519:<issuer-public-key>",
    "holder": "<pseudonymous-holder-binding>",
    "role": "participant",
    "offering": "field-elevate-demo@v1",
    "level": 1,
    "event": "enrolled",
    "issued_at": "2026-07-04T12:00:00.000Z",
    "prev": null,
    "env": "pilot",
    "coattest": [],
    "sig": "<issuer-signature>"
  },
  "review": {
    "overall": 5,
    "facets": {},
    "text": "Optional review text."
  }
}
```

The server verifies the receipt signature, confirms the receipt was issued by
the pilot ledger, and spends the standing. The response includes a signed pilot
event.

## What Agents Need To Know

- Hosted read base URL: `https://mcp.audiencescore.org`
- Issuer/write base URL: configured by the pilot operator when deploying
  `reference-impl/src/pilot/server.js`
- Submit review: `POST /v0/reviews`
- Read score: `GET /v0/scores/{offering}`
- Copy-to-LLM brief: `GET /docs/copy-to-llm`
- Every pilot receipt and signed event has `env: "pilot"` in the signed body.

## Common Failures

- No receipt: rejected.
- Same receipt used twice: rejected.
- Receipt signed by a key that is not the offering's declared issuer: rejected.
- Receipt for one offering-version used on another: rejected.
