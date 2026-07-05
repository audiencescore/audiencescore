'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { generateKeyPair: generatePayloadKeyPair } = require('../crypto');
const { generateKeyPair: generateIssuerKeyPair, rawPublicHex } = require('../v02/signing');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function writePrivateKey(file, privateKey) {
  fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}

function loadPrivateKey(file) {
  return crypto.createPrivateKey(fs.readFileSync(file));
}

function loadOrCreatePayloadKey(keysDir, name) {
  ensureDir(keysDir);
  const file = path.join(keysDir, `${name}.private.pem`);
  if (!fs.existsSync(file)) {
    const pair = generatePayloadKeyPair();
    writePrivateKey(file, pair.privateKey);
    return pair;
  }
  const privateKey = loadPrivateKey(file);
  return { privateKey, publicKey: crypto.createPublicKey(privateKey) };
}

// Keyed identities (issuers, partners) live under keysDir/<subdir>/. The
// backend is PEM-on-disk for the pilot; a production deployment swaps this
// module for a KMS/secure-enclave signer (Ed25519 → enclave path) behind the
// same create/load interface, with no change to callers.
function createSubjectKey(keysDir, subdir, id) {
  ensureDir(path.join(keysDir, subdir));
  const file = path.join(keysDir, subdir, `${id}.private.pem`);
  if (fs.existsSync(file)) throw new Error(`${subdir} key already exists: ${id}`);
  const pair = generateIssuerKeyPair();
  writePrivateKey(file, pair.privateKey);
  return { privateKey: pair.privateKey, publicHex: pair.publicHex, keyPath: file };
}

function loadSubjectKey(keysDir, subdir, id) {
  const file = path.join(keysDir, subdir, `${id}.private.pem`);
  if (!fs.existsSync(file)) throw new Error(`missing ${subdir} key for ${id}: ${file}`);
  const privateKey = loadPrivateKey(file);
  return { privateKey, publicHex: rawPublicHex(crypto.createPublicKey(privateKey)), keyPath: file };
}

const createIssuerKey = (keysDir, issuerId) => createSubjectKey(keysDir, 'issuers', issuerId);
const loadIssuerKey = (keysDir, issuerId) => loadSubjectKey(keysDir, 'issuers', issuerId);
const createPartnerKey = (keysDir, partnerId) => createSubjectKey(keysDir, 'partners', partnerId);
const loadPartnerKey = (keysDir, partnerId) => loadSubjectKey(keysDir, 'partners', partnerId);

module.exports = {
  ensureDir,
  loadOrCreatePayloadKey,
  createIssuerKey,
  loadIssuerKey,
  createPartnerKey,
  loadPartnerKey,
};
