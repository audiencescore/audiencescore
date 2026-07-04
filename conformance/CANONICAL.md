# Canonical Serialization (normative)

Every receipt signature signs the CANONICAL FORM of the receipt payload:

1. Take the receipt object WITHOUT the "sig" field.
2. Also exclude the "coattest" field - issuer and co-attesters sign identical bytes.
   Serialize as JSON: keys sorted lexicographically, separators "," and ":"
   (no whitespace), UTF-8 encoding, no floating-point values (levels are integers).
3. Sign the resulting bytes with the issuer's Ed25519 key. Signature is lowercase hex.
4. Co-attestations sign the same canonical bytes with their own keys.

Holder binding (normative): holder = blake3(derived_holder_pubkey || salt), lowercase hex.
Per-issuer key derivation prevents cross-issuer correlation (spec section 7).

Vector notes: the test vectors use fixed, human-readable IDs and timestamps for
determinism. Production MUST use uuidv7 receipt IDs and real RFC3339 timestamps.
The keypairs in vectors.json are generated from fixed seeds. THEY ARE TEST KEYS.
NEVER use them, or this pattern of seed generation, in production.
