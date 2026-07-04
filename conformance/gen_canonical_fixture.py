#!/usr/bin/env python3
"""Emit the reference canonical bytes for every vector receipt (AT-4 fixture).

Writes canonical_bytes.json mapping receipt_id -> the exact canonical string the
reference verifier signs/verifies (sig and coattest excluded, keys sorted,
"," ":" separators, UTF-8). The Node implementation's canonical form must match
these bytes exactly. Run with --check to verify the committed fixture instead
of rewriting it (CI does this, so the fixture can never drift from the
reference).
"""
import json
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "canonical_bytes.json")


def canon(receipt):
    p = {k: v for k, v in receipt.items() if k not in ("sig", "coattest")}
    return json.dumps(p, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


with open(os.path.join(HERE, "vectors.json")) as f:
    V = json.load(f)

fixture = {item["receipt"]["receipt_id"]: canon(item["receipt"]) for item in V["receipts"]}

if "--check" in sys.argv:
    with open(FIXTURE) as f:
        committed = json.load(f)
    if committed != fixture:
        print("canonical_bytes.json does not match the reference canonicalization")
        sys.exit(1)
    print(f"canonical fixture verified: {len(fixture)} receipts")
    sys.exit(0)

with open(FIXTURE, "w") as f:
    json.dump(fixture, f, indent=1, ensure_ascii=False)
print(f"wrote canonical_bytes.json: {len(fixture)} receipts")
