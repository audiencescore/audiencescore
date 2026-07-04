#!/usr/bin/env python3
"""Reference verifier for AudienceScore v0.2a conformance vectors. Exit 0 iff all expectations hold."""
import json, sys
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError

V = json.load(open("vectors.json"))
fails = []

def canon(receipt):
    p = {k: v for k, v in receipt.items() if k not in ("sig", "coattest")}
    return json.dumps(p, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def sig_ok(receipt):
    pub = bytes.fromhex(receipt["issuer"].split(":", 1)[1])
    try:
        VerifyKey(pub).verify(canon(receipt), bytes.fromhex(receipt["sig"]))
        return True
    except BadSignatureError:
        return False

def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        fails.append(name)

rmap = {}
for item in V["receipts"]:
    r = item["receipt"]; rmap[r["receipt_id"]] = r
    ok = sig_ok(r)
    if item["expect"] == "sig_valid":
        check(f"receipt:{item['name']}", ok, "signature should verify")
        if r.get("coattest"):
            co = bytes.fromhex(r["coattest"][0].split(":", 1)[1])
            try:
                VerifyKey(bytes.fromhex(V["keys"]["platform"])).verify(canon(r), co); co_ok = True
            except BadSignatureError:
                co_ok = False
            check(f"receipt:{item['name']}:coattest", co_ok, "platform co-signature should verify")
    elif item["expect"] == "sig_invalid":
        check(f"receipt:{item['name']}", not ok, "signature should be rejected")
    elif item["expect"] == "violates:I-3":
        prev = rmap.get(r.get("prev"))
        detected = prev is not None and r["level"] <= prev["level"]
        check(f"receipt:{item['name']}", detected, "descension must be flagged")

for item in V["receipts"]:  # chain sanity for valid ascensions
    r = item["receipt"]
    if item["expect"] == "sig_valid" and r.get("prev"):
        prev = rmap.get(r["prev"])
        ok = prev and r["level"] > prev["level"] and r["holder"] == prev["holder"] and r["offering"] == prev["offering"]
        check(f"chain:{item['name']}", bool(ok), "legal ascension expected")

offs = V["offerings"]
for item in V["reviews"]:
    rv = item["review"]; rc = rmap.get(rv["receipt_id"])
    if item["expect"] == "violates:I-1":
        check(f"review:{item['name']}", rc is None, "orphan must be detected"); continue
    if rc is None:
        check(f"review:{item['name']}", False, "receipt should exist"); continue
    comps = set(offs[rc["offering"]]["components"].values())
    facets = set(rv.get("facets", {}).keys())
    if item["expect"] == "valid":
        check(f"review:{item['name']}", facets <= comps and rc["role"] == "participant")
    elif item["expect"] == "violates:I-6":
        check(f"review:{item['name']}", not facets <= comps, "undeclared facet must be flagged")
    elif item["expect"] == "violates:I-6-role":
        check(f"review:{item['name']}", rc["role"] == "payer" and len(facets) > 0, "payer facets must be flagged")

rec = V["reconciliation"]
check(f"reconciliation:{rec['name']}", rec["l1_receipts_issued"] > rec["declared_transactions"], "I-2 gap must be flagged")

print("-" * 50)
if fails:
    print(f"RESULT: FAIL ({len(fails)} expectation(s) not met)"); sys.exit(1)
print("RESULT: ALL CONFORMANCE EXPECTATIONS MET"); sys.exit(0)
