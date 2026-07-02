'use strict';

// The append-only, hash-chained event log. Events are the only state in the
// system; everything published (including scores) is a deterministic
// rendering over this log. See /protocol/event-spec.md.

const {
  canonicalize,
  sha256Hex,
  signPayload,
  verifyPayload,
} = require('./crypto');

const EVENT_SPEC = 'audience-score/event@0.1';
const GENESIS = '0'.repeat(64);

/**
 * Build and sign a verdict event.
 *
 * The signature covers { spec, type, prev, body, signer }, so an event is
 * bound to its position in the chain: replaying it elsewhere breaks
 * verification.
 */
function createEvent({ type, body, prev, privateKey, signerString }) {
  const core = {
    spec: EVENT_SPEC,
    type,
    prev,
    body,
    signer: signerString,
  };
  const sig = signPayload(privateKey, core);
  const id = sha256Hex(canonicalize(core));
  return { ...core, id, sig };
}

/** Hash of a full event (including id and sig) — the chain link value. */
function eventHash(event) {
  return sha256Hex(canonicalize(event));
}

/** Verify one event's signature. */
function verifyEvent(event) {
  const { id, sig, ...core } = event;
  if (sha256Hex(canonicalize(core)) !== id) return false;
  return verifyPayload(event.signer, core, sig);
}

/** An in-memory append-only log with hash chaining. */
class EventLog {
  constructor() {
    this.events = [];
  }

  /** Hash of the latest event, or the genesis value for an empty log. */
  head() {
    if (this.events.length === 0) return GENESIS;
    return eventHash(this.events[this.events.length - 1]);
  }

  /** Append an event. Rejects events that don't chain or don't verify. */
  append(event) {
    if (event.prev !== this.head()) {
      throw new Error(`event does not chain: expected prev=${this.head()}`);
    }
    if (!verifyEvent(event)) {
      throw new Error('event signature verification failed');
    }
    this.events.push(event);
    return event;
  }

  /**
   * Verify the whole chain: every signature valid, every prev pointer
   * matching the hash of the preceding event.
   */
  verifyChain() {
    let prev = GENESIS;
    for (const event of this.events) {
      if (event.prev !== prev) return false;
      if (!verifyEvent(event)) return false;
      prev = eventHash(event);
    }
    return true;
  }

  toJSONL() {
    return this.events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  }

  static fromJSONL(text) {
    const log = new EventLog();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      log.append(JSON.parse(line));
    }
    return log;
  }
}

module.exports = { EVENT_SPEC, GENESIS, createEvent, eventHash, verifyEvent, EventLog };
