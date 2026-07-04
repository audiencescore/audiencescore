'use strict';

// Group E — Hygiene (AT-25): the fixed-seed conformance keys are test
// vectors only. This scan asserts the seed bytes, the vector public keys,
// and the vector salt appear nowhere in the repository outside conformance/
// and the test directories.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadVectors } = require('./helpers');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SKIP_DIRS = new Set(['.git', 'node_modules']);
// The only places test key material is allowed to exist:
const ALLOWED = [
  path.join(REPO_ROOT, 'conformance') + path.sep,
  path.join(REPO_ROOT, 'reference-impl', 'test') + path.sep,
  path.join(REPO_ROOT, 'tests') + path.sep,
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test('AT-25: no conformance seed, test key, or test salt appears outside conformance/ and tests', () => {
  const V = loadVectors();
  const forbidden = [
    ...Object.values(V.keys), // the five fixed-seed public keys
    V.meta.salt_hex, // the test salt
    // The seed byte patterns gen_vectors.py uses (bytes([b]) * 32, hex).
    ...[0x01, 0x02, 0x03, 0x10, 0x11].map((b) => b.toString(16).padStart(2, '0').repeat(32)),
  ];

  const offenders = [];
  for (const file of walk(REPO_ROOT)) {
    if (ALLOWED.some((prefix) => file.startsWith(prefix))) continue;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // binary
    }
    const lower = text.toLowerCase();
    for (const needle of forbidden) {
      if (lower.includes(needle)) {
        offenders.push(`${path.relative(REPO_ROOT, file)} contains ${needle.slice(0, 12)}…`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'test key material leaked outside conformance/ and tests');
});

test('AT-25 companion: production key generation goes through the CSPRNG, never fixed seeds', () => {
  const signingSrc = fs.readFileSync(path.join(REPO_ROOT, 'reference-impl', 'src', 'v02', 'signing.js'), 'utf8');
  assert.match(signingSrc, /generateKeyPairSync\('ed25519'\)/, 'key generation must use node:crypto CSPRNG');
  const holderSrc = fs.readFileSync(path.join(REPO_ROOT, 'reference-impl', 'src', 'v02', 'holder.js'), 'utf8');
  assert.match(holderSrc, /crypto\.randomBytes\(32\)/, 'root secrets and salts must come from the CSPRNG');
});
