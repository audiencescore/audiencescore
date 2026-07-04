# Issuer Quickstart

AudienceScore pilot deployment, pre-cryptographic-audit. The independent
cryptographic review and per-vertical legal review gates remain open. The pilot
ledger may be reset and receipts re-issued after the audit.

Target time: under 30 minutes with the Stripe adapter.

## What You Need

- A Stripe account that can add checkout or invoice metadata.
- A contact email for receiving pilot setup output.
- The offering name and price.
- The entities/components the offering should credit, such as service,
  instructor, curriculum, location, or product line.

Do not send AudienceScore private keys, Stripe secrets, customer lists, or
customer emails through GitHub.

## Step 1: Register Your Issuer

The pilot operator runs this on the VPS:

```sh
node reference-impl/src/pilot/admin.js create-issuer \
  --issuer-id field-elevate-pilot \
  --name "Field Elevate Pilot" \
  --stripe-account acct_REPLACE_AT_DEPLOY \
  --email-from pilot@audiencescore.org
```

The command prints:

- issuer id
- issuer public key
- Stripe webhook URL
- Stripe metadata keys to add

The private key stays on the VPS only.

## Step 2: Register One Offering

```sh
node reference-impl/src/pilot/admin.js add-offering \
  --issuer-id field-elevate-pilot \
  --offering-id field-elevate-demo \
  --version v1 \
  --name "Field Elevate Pilot Offering" \
  --price-cents 10000 \
  --component service=ent_field_elevate_service \
  --criteria-json '{"l2":"service delivered"}'
```

The offering reference is:

```text
field-elevate-demo@v1
```

That exact value goes into Stripe metadata.

## Step 3: Add Stripe Metadata

For each Checkout Session or invoice that should issue a pilot receipt, include:

```text
audiencescore_issuer_id=field-elevate-pilot
audiencescore_offering=field-elevate-demo@v1
audiencescore_role=participant
```

Use `payer` only when the person paying should rate value-for-money but not
delivery facets.

## Step 4: Configure The Webhook

In Stripe test mode, add an endpoint:

```text
https://api.audiencescore.org/v0/stripe/webhook
```

Events:

```text
checkout.session.completed
invoice.paid
```

The webhook signing secret goes into the VPS environment only:

```sh
AUDIENCESCORE_STRIPE_WEBHOOK_SECRETS_JSON='{"field-elevate-pilot":"REPLACE_WITH_STRIPE_WEBHOOK_SECRET_ON_VPS"}'
```

## Step 5: What The Customer Gets

When Stripe sends a configured event, the pilot automatically issues an L1
TRANSACTED receipt. The customer receives an email with:

- the signed receipt JSON attached
- a one-click review URL
- a note that this is a pilot deployment, pre-cryptographic-audit

If SMTP is not configured, the same email is written to the VPS pilot outbox as
an `.eml` file for testing.

## Manual Invoice Issuance

For invoice-based businesses without Stripe events, the pilot operator runs:

```sh
node reference-impl/src/pilot/admin.js issue-manual \
  --issuer-id field-elevate-pilot \
  --offering field-elevate-demo@v1 \
  --amount-cents 10000 \
  --external-ref invoice-123 \
  --customer-email CUSTOMER_EMAIL_GOES_HERE
```

Manual issuance must correspond 1:1 to a real transaction. The reconciliation
invariant still applies.

## Merchant Checklist

1. Confirm the issuer id and offering ref.
2. Add the three Stripe metadata fields.
3. Add the Stripe webhook endpoint in test mode.
4. Run one test checkout or paid invoice.
5. Confirm the customer receives a pilot receipt email or an `.eml` appears in
   the pilot outbox.
6. Submit one pilot review from the claim URL.
7. Read the signed score manifest.
