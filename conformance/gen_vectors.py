#!/usr/bin/env python3
"""Generate AudienceScore v0.2a conformance vectors. TEST KEYS ONLY - fixed seeds."""
import json
from nacl.signing import SigningKey
import blake3

SALT = b"as-test-salt-DO-NOT-USE-IN-PROD"

def canon(receipt: dict) -> bytes:
    p = {k: v for k, v in receipt.items() if k not in ("sig", "coattest")}
    return json.dumps(p, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def keypair(seed_byte):
    sk = SigningKey(bytes([seed_byte]) * 32)
    return sk, sk.verify_key.encode().hex()

issuer_sk, issuer_pub = keypair(0x01)
wrong_sk, wrong_pub = keypair(0x02)
platform_sk, platform_pub = keypair(0x03)
h1_sk, h1_pub = keypair(0x10)   # participant
h2_sk, h2_pub = keypair(0x11)   # payer

def bind(pub_hex):
    return blake3.blake3(bytes.fromhex(pub_hex) + SALT).hexdigest()

offerings = {
    "algebra2@v3": {"components": {"instructor": "ent_chen", "curriculum": "ent_alg2", "platform": "ent_outschool"}, "price_cents": 24900},
    "widget@v1": {"components": {"product": "ent_widget"}, "price_cents": 1299},
    "freecourse@v1": {"components": {"curriculum": "ent_freecurr"}, "price_cents": 0},
}

def make(rid, holder_pub, role, offering, level, event, prev=None, coattested=False, signer=issuer_sk, claim_pub=None):
    r = {"spec": "as/0.2a", "receipt_id": rid, "issuer": "ed25519:" + (claim_pub or issuer_pub),
         "holder": bind(holder_pub), "role": role, "offering": offering, "level": level,
         "event": event, "issued_at": "2026-07-04T12:00:00Z", "prev": prev}
    c = canon(r)
    r["sig"] = signer.sign(c).signature.hex()
    r["coattest"] = ["ed25519:" + platform_sk.sign(c).signature.hex()] if coattested else []
    return r

receipts = []
r1 = make("as-test-rcpt-001", h1_pub, "participant", "algebra2@v3", 1, "enrolled", coattested=True)
receipts.append({"name": "valid_l1_participant_coattested", "expect": "sig_valid", "receipt": r1})
r2 = make("as-test-rcpt-002", h2_pub, "payer", "algebra2@v3", 1, "paid")
receipts.append({"name": "valid_l1_payer", "expect": "sig_valid", "receipt": r2})
r3 = make("as-test-rcpt-003", h1_pub, "participant", "freecourse@v1", 2, "participated")
receipts.append({"name": "valid_l2_free_offering_no_l1", "expect": "sig_valid", "receipt": r3})
r4 = make("as-test-rcpt-004", h1_pub, "participant", "algebra2@v3", 2, "participated", prev="as-test-rcpt-001")
receipts.append({"name": "chain_l1_to_l2", "expect": "sig_valid", "receipt": r4})
r5 = make("as-test-rcpt-005", h1_pub, "participant", "algebra2@v3", 3, "completed", prev="as-test-rcpt-004")
receipts.append({"name": "chain_l2_to_l3", "expect": "sig_valid", "receipt": r5})
r6 = dict(r1); r6["receipt_id"] = "as-test-rcpt-006"; r6["level"] = 3  # tamper AFTER copying sig
receipts.append({"name": "tampered_level_after_signing", "expect": "sig_invalid", "receipt": r6})
r7 = make("as-test-rcpt-007", h1_pub, "participant", "widget@v1", 1, "purchased", signer=wrong_sk, claim_pub=issuer_pub)
receipts.append({"name": "wrong_key_claims_issuer", "expect": "sig_invalid", "receipt": r7})
r8 = make("as-test-rcpt-008", h1_pub, "participant", "algebra2@v3", 2, "participated", prev="as-test-rcpt-005")
receipts.append({"name": "descending_chain_l3_to_l2", "expect": "violates:I-3", "receipt": r8})

reviews = [
    {"name": "valid_review_with_facets", "expect": "valid",
     "review": {"receipt_id": "as-test-rcpt-005", "overall": 5, "facets": {"ent_chen": 5, "ent_alg2": 4}, "text": "Rigorous and fair."}},
    {"name": "orphan_review", "expect": "violates:I-1",
     "review": {"receipt_id": "as-test-rcpt-MISSING", "overall": 1, "facets": {}, "text": "ghost"}},
    {"name": "facet_on_undeclared_component", "expect": "violates:I-6",
     "review": {"receipt_id": "as-test-rcpt-001", "overall": 3, "facets": {"ent_notdeclared": 2}, "text": ""}},
    {"name": "payer_with_facets", "expect": "violates:I-6-role",
     "review": {"receipt_id": "as-test-rcpt-002", "overall": 4, "facets": {"ent_chen": 4}, "text": ""}},
]

vectors = {
    "meta": {"spec": "as/0.2a", "warning": "TEST VECTORS. Fixed-seed keys. NEVER use in production.",
             "canonicalization": "JSON sorted keys, separators ',' ':', UTF-8, exclude 'sig' and 'coattest'",
             "holder_binding": "blake3(holder_pubkey_bytes || salt)", "salt_hex": SALT.hex()},
    "keys": {"issuer": issuer_pub, "wrong_issuer": wrong_pub, "platform": platform_pub,
             "holder_participant": h1_pub, "holder_payer": h2_pub},
    "offerings": offerings,
    "receipts": receipts,
    "reviews": reviews,
    "reconciliation": {"name": "issuance_exceeds_transactions", "expect": "violates:I-2",
                       "issuer": issuer_pub, "offering": "algebra2@v3",
                       "declared_transactions": 100, "l1_receipts_issued": 103},
}
with open("vectors.json", "w") as f:
    json.dump(vectors, f, indent=1)
print(f"wrote vectors.json: {len(receipts)} receipts, {len(reviews)} reviews, 1 reconciliation case")
