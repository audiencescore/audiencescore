'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

function sanitizeHeader(value) {
  return String(value ?? '').replace(/[\r\n]/g, ' ').trim();
}

function mimeMessage({ from, to, subject, text, attachmentName, attachmentJson }) {
  const boundary = `as-pilot-${crypto.randomBytes(12).toString('hex')}`;
  const attachment = Buffer.from(JSON.stringify(attachmentJson, null, 2), 'utf8').toString('base64');
  return [
    `From: ${sanitizeHeader(from)}`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${sanitizeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
    `--${boundary}`,
    `Content-Type: application/json; name="${sanitizeHeader(attachmentName)}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${sanitizeHeader(attachmentName)}"`,
    '',
    attachment.replace(/(.{76})/g, '$1\n'),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

function writeOutbox(outboxDir, message) {
  fs.mkdirSync(outboxDir, { recursive: true, mode: 0o700 });
  const file = path.join(outboxDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}.eml`);
  fs.writeFileSync(file, message, { mode: 0o600 });
  return { mode: 'file', file };
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) return;
      const last = lines[lines.length - 1];
      if (/^\d{3} /.test(last)) {
        socket.off('data', onData);
        const code = Number(last.slice(0, 3));
        if (code >= 400) reject(new Error(`SMTP error ${code}: ${lines.join(' | ')}`));
        else resolve(lines.join('\n'));
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

async function smtpCommand(socket, command) {
  socket.write(`${command}\r\n`);
  return readResponse(socket);
}

async function sendSmtp(config, message, { from, to }) {
  const port = Number(config.smtpPort ?? 587);
  let socket = config.smtpSecure
    ? tls.connect({ host: config.smtpHost, port, servername: config.smtpHost })
    : net.connect({ host: config.smtpHost, port });
  await readResponse(socket);
  await smtpCommand(socket, `EHLO ${config.smtpHelo ?? 'audiencescore-pilot.local'}`);
  if (!config.smtpSecure && config.smtpStartTls !== false) {
    await smtpCommand(socket, 'STARTTLS');
    socket = tls.connect({ socket, servername: config.smtpHost });
    await smtpCommand(socket, `EHLO ${config.smtpHelo ?? 'audiencescore-pilot.local'}`);
  }
  if (config.smtpUser || config.smtpPassword) {
    const auth = Buffer.from(`\0${config.smtpUser ?? ''}\0${config.smtpPassword ?? ''}`).toString('base64');
    await smtpCommand(socket, `AUTH PLAIN ${auth}`);
  }
  await smtpCommand(socket, `MAIL FROM:<${from}>`);
  await smtpCommand(socket, `RCPT TO:<${to}>`);
  await smtpCommand(socket, 'DATA');
  socket.write(message.replace(/\r?\n\./g, '\r\n..') + '\r\n.\r\n');
  await readResponse(socket);
  await smtpCommand(socket, 'QUIT').catch(() => null);
  socket.end();
  return { mode: 'smtp' };
}

async function deliverReceiptEmail(config, { to, receipt, claimUrl }) {
  const from = config.emailFrom || 'pilot@audiencescore.org';
  const subject = 'Your AudienceScore pilot receipt';
  const text = [
    'AudienceScore pilot deployment, pre-cryptographic-audit.',
    'The pilot ledger may be reset and receipts re-issued after the audit.',
    '',
    'Your signed receipt JSON is attached. Keep it; it is what lets you or your AI agent submit one review for this transaction.',
    '',
    `Review link: ${claimUrl}`,
    '',
    'Agent builders can use POST /v0/reviews with the attached receipt JSON.',
  ].join('\n');
  const message = mimeMessage({
    from,
    to,
    subject,
    text,
    attachmentName: `audiencescore-receipt-${receipt.receipt_id}.json`,
    attachmentJson: receipt,
  });
  if (config.emailMode === 'smtp') {
    return sendSmtp(config, message, { from, to });
  }
  return writeOutbox(config.outboxDir, message);
}

module.exports = { deliverReceiptEmail, mimeMessage };
