'use strict';

// Shared fixtures for the v0.2a acceptance tests. Test identities are
// generated fresh per run with the CSPRNG — the fixed-seed conformance keys
// live in conformance/ only (AT-25).

const path = require('node:path');
const fs = require('node:fs');
const { generateKeyPair } = require('../../src/v02/signing');
const { generateHolderRoot, generateSalt, deriveHolderKeyPair, holderBinding } = require('../../src/v02/holder');
const { Store } = require('../../src/v02/store');

const CONFORMANCE_DIR = path.join(__dirname, '..', '..', '..', 'conformance');

function loadVectors() {
  return JSON.parse(fs.readFileSync(path.join(CONFORMANCE_DIR, 'vectors.json'), 'utf8'));
}

function loadCanonicalFixture() {
  return JSON.parse(fs.readFileSync(path.join(CONFORMANCE_DIR, 'canonical_bytes.json'), 'utf8'));
}

/** A fresh issuer identity: signing key pair plus a binding salt. */
function makeIssuer() {
  const { privateKey, publicHex } = generateKeyPair();
  return { privateKey, publicHex, salt: generateSalt() };
}

/** A fresh holder bound to one issuer (per-issuer derived key, spec §7). */
function makeHolder(issuer) {
  const root = generateHolderRoot();
  return bindHolder(root, issuer);
}

function bindHolder(root, issuer) {
  const derived = deriveHolderKeyPair(root, issuer.publicHex);
  return { root, binding: holderBinding(derived.publicHex, issuer.salt) };
}

const T0 = '2026-07-04T12:00:00Z';
const WINDOW = '2026-07-05T00:00:00Z';

/** A store with one paid offering and one free offering declared. */
function makeStore({ issuer }) {
  const store = new Store();
  store.declareOffering({
    offeringId: 'algebra2',
    version: 'v3',
    issuerPublicHex: issuer.publicHex,
    components: { instructor: 'ent_chen', curriculum: 'ent_alg2', platform: 'ent_outschool' },
    priceCents: 24900,
    attestationCriteria: { l2: 'progress >= 60%', l3: 'final project accepted' },
    declaredAt: T0,
  });
  store.declareOffering({
    offeringId: 'freecourse',
    version: 'v1',
    issuerPublicHex: issuer.publicHex,
    components: { curriculum: 'ent_freecurr' },
    priceCents: 0,
    attestationCriteria: { l2: 'completed 5 modules' },
    declaredAt: T0,
  });
  return store;
}

/** Enroll a fresh participant: transaction -> automatic L1 receipt. */
function enroll(store, issuer, { offering = 'algebra2@v3', role = 'participant', at = T0 } = {}) {
  const holder = makeHolder(issuer);
  const { receipt } = store.recordTransaction({
    issuer,
    holder: holder.binding,
    role,
    offering,
    amountCents: 24900,
    occurredAt: at,
  });
  return { holder, receipt };
}

module.exports = {
  CONFORMANCE_DIR,
  T0,
  WINDOW,
  loadVectors,
  loadCanonicalFixture,
  makeIssuer,
  makeHolder,
  bindHolder,
  makeStore,
  enroll,
};
