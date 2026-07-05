#!/usr/bin/env node
'use strict';

const { PilotRuntime, defaultConfig } = require('./runtime');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

function requireArg(args, name) {
  if (!args[name]) throw new Error(`missing --${name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`);
  return args[name];
}

function parseComponents(values) {
  const out = {};
  const list = Array.isArray(values) ? values : values ? [values] : [];
  for (const item of list) {
    const [role, entity] = String(item).split('=');
    if (!role || !entity) throw new Error('--component must be role=entity_id');
    out[role] = entity;
  }
  return out;
}

function collectMulti(argv, flag) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1]) out.push(argv[i + 1]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const runtime = new PilotRuntime(defaultConfig());
  try {
    if (command === 'create-issuer') {
      const result = runtime.createIssuer({
        issuerId: requireArg(args, 'issuerId'),
        name: requireArg(args, 'name'),
        stripeAccount: args.stripeAccount ?? null,
        emailFrom: args.emailFrom ?? null,
      });
      console.log(JSON.stringify({
        ...result,
        webhook_url: `${runtime.config.publicBaseUrl}/v0/stripe/webhook`,
        stripe_metadata: {
          audiencescore_issuer_id: result.issuerId,
          audiencescore_offering: '<offering@version>',
          audiencescore_role: 'participant',
        },
      }, null, 2));
      return;
    }

    if (command === 'add-offering') {
      const components = parseComponents(collectMulti(process.argv.slice(2), '--component'));
      const result = runtime.addOffering({
        issuerId: requireArg(args, 'issuerId'),
        offeringId: requireArg(args, 'offeringId'),
        version: requireArg(args, 'version'),
        name: requireArg(args, 'name'),
        priceCents: Number(requireArg(args, 'priceCents')),
        components,
        attestationCriteria: args.criteriaJson ? JSON.parse(args.criteriaJson) : {},
      });
      console.log(JSON.stringify({
        ...result,
        score_url: `${runtime.config.publicBaseUrl}/v0/scores/${encodeURIComponent(result.offering)}`,
        evidence_url: `${runtime.config.publicBaseUrl}/v0/scores/${encodeURIComponent(result.offering)}/evidence`,
      }, null, 2));
      return;
    }

    if (command === 'create-partner') {
      const result = runtime.createPartner({
        partnerId: requireArg(args, 'partnerId'),
        name: requireArg(args, 'name'),
        kind: args.kind ?? 'platform',
        scopes: args.scopes ? String(args.scopes).split(',') : ['issue', 'corroborate'],
      });
      console.log(JSON.stringify({
        ...result,
        ingest_url: `${runtime.config.publicBaseUrl}/v1/transactions`,
        auth_headers: {
          'x-as-partner-id': result.partnerId,
          'x-as-timestamp': '<RFC3339 request time>',
          'x-as-nonce': '<unique nonce, never reused>',
          'x-as-signature': '<hex Ed25519 signature over METHOD, PATH, timestamp, nonce, sha256(body)>',
        },
      }, null, 2));
      return;
    }

    if (command === 'link-issuer') {
      const result = runtime.linkIssuer({
        partnerId: requireArg(args, 'partnerId'),
        issuerId: requireArg(args, 'issuerId'),
        connectedAccountRef: args.connectedAccountRef ?? null,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === 'provision-merchants') {
      const merchants = JSON.parse(requireArg(args, 'merchantsJson'));
      console.log(JSON.stringify(runtime.provisionMerchants(requireArg(args, 'partnerId'), merchants), null, 2));
      return;
    }

    if (command === 'issue-manual') {
      const result = await runtime.issueReceipt({
        issuerId: requireArg(args, 'issuerId'),
        offering: requireArg(args, 'offering'),
        role: args.role ?? 'participant',
        amountCents: Number(requireArg(args, 'amountCents')),
        txId: args.txId ?? `manual:${requireArg(args, 'externalRef')}`,
        externalRef: args.externalRef ?? null,
        customerEmail: args.customerEmail ?? null,
        occurredAt: args.occurredAt ?? new Date().toISOString(),
      });
      console.log(JSON.stringify({
        env: 'pilot',
        receipt: result.receipt,
        claim_url: result.claimUrl,
        delivery: result.delivery,
      }, null, 2));
      return;
    }

    if (command === 'backup') {
      console.log(JSON.stringify(runtime.backup(), null, 2));
      return;
    }

    if (command === 'copy-to-llm') {
      const { copyToLlm } = require('./server');
      console.log(copyToLlm(runtime));
      return;
    }

    throw new Error(`unknown command: ${command || '(none)'}`);
  } finally {
    runtime.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
