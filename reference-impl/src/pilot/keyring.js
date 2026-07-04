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

function createIssuerKey(keysDir, issuerId) {
  ensureDir(path.join(keysDir, 'issuers'));
  const file = path.join(keysDir, 'issuers', `${issuerId}.private.pem`);
  if (fs.existsSync(file)) throw new Error(`issuer key already exists: ${issuerId}`);
  const pair = generateIssuerKeyPair();
  writePrivateKey(file, pair.privateKey);
  return { privateKey: pair.privateKey, publicHex: pair.publicHex, keyPath: file };
}

function loadIssuerKey(keysDir, issuerId) {
  const file = path.join(keysDir, 'issuers', `${issuerId}.private.pem`);
  if (!fs.existsSync(file)) throw new Error(`missing issuer key for ${issuerId}: ${file}`);
  const privateKey = loadPrivateKey(file);
  return { privateKey, publicHex: rawPublicHex(crypto.createPublicKey(privateKey)), keyPath: file };
}

module.exports = {
  ensureDir,
  loadOrCreatePayloadKey,
  createIssuerKey,
  loadIssuerKey,
};
