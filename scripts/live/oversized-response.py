#!/usr/bin/env python3
"""Owner-operated live check: an applied change whose response is too large.

Creates one disposable Reminder list, adds one Reminder with the helper's
response limit lowered to 1 KiB (SHERPA_APPLE_RESPONSE_LIMIT_BYTES), and checks
that the command answers `partial` with `protocol.result_too_large` and
`retry: never`, that `sherpa operations list` journals the same outcome, and
that the Reminder reads back. It deletes the list in every case and prints
only statuses and codes.

    SHERPA_LIVE_CONFIRM=CREATE_DISPOSABLE_REMINDER_LIST_ON_THIS_MAC \
      python3 -I scripts/live/oversized-response.py "$(command -v sherpa)"
"""
import json, os, subprocess, sys, uuid

if os.environ.get("SHERPA_LIVE_CONFIRM") != "CREATE_DISPOSABLE_REMINDER_LIST_ON_THIS_MAC" or len(sys.argv) != 2:
    sys.exit(__doc__)
sherpa = sys.argv[1]
base_env = {k: v for k, v in os.environ.items() if k != "SHERPA_APPLE_BIN"}

def call(capability, effect, evidence, payload, limit=None):
    rid = "live-" + uuid.uuid4().hex[:12]
    env = dict(base_env)
    if limit: env["SHERPA_APPLE_RESPONSE_LIMIT_BYTES"] = str(limit)
    req = {"kind": "request", "protocol_version": "2.0.0", "application_contract": "sherpa.planner.v2",
           "request_id": rid, "operation_id": rid, "capability": capability,
           "payload": {"schema": f"sherpa.planner.{capability}.request.v2", **payload},
           "deadline_ms": 60000, "idempotency_key": rid,
           "policy": {"effect": effect, "required_evidence": evidence, "artifact_directory": None}}
    p = subprocess.run([sherpa, "planner", "request"], input=json.dumps(req).encode(), capture_output=True, env=env)
    return rid, p.returncode, p.stdout, json.loads(p.stdout.decode().splitlines()[-1])

title = f"Sherpa oversized-response check {uuid.uuid4()}"
_, code, _, r = call("reminder.collection.create", "mutation", "native_readback", {"title": title})
print("collection.create", code, r["status"])
collection = r["result"]["reminder_collection"]["native_locator"]
ok = True
try:
    item_title = "oversized " + uuid.uuid4().hex[:8]
    rid, code, raw, r = call("reminder.create", "mutation", "native_readback",
                             {"title": item_title, "collection_native_locator": collection, "notes": "x" * 2000}, limit=1024)
    print("reminder.create(limit=1024)", "exit", code, "bytes", len(raw), "status", r["status"],
          "effect", r["effect"], "evidence", r.get("evidence"), "error", r.get("error"), "result" in r and r["result"] is not None)
    ok &= code == 0 and r["status"] == "partial" and r["effect"]["state"] == "applied" \
        and r["error"] == {"code": "protocol.result_too_large", "retry": "never"} and len(raw) <= 1025
    ops = json.loads(subprocess.run([sherpa, "operations", "list", "--limit", "20"], capture_output=True, env=base_env).stdout)
    rows = ops if isinstance(ops, list) else ops.get("operations", ops)
    mine = [o for o in rows if rid in json.dumps(o)]
    print("journal", json.dumps(mine)[:400])
    ok &= len(mine) == 1 and "partial" in json.dumps(mine) and "protocol.result_too_large" in json.dumps(mine)
    _, code, _, r = call("reminder.list", "read", "none", {"collection_native_locator": collection, "limit": 10})
    titles = [x.get("title") for x in r["result"]["reminders"]]
    print("readback", code, r["status"], "count", len(titles), "created_present", item_title in titles)
    ok &= item_title in titles
finally:
    _, code, _, r = call("reminder.collection.delete", "mutation", "native_absence_readback", {"collection_native_locator": collection})
    print("collection.delete", code, r["status"], r.get("result", {}).get("deleted"))
print("RESULT", "pass" if ok else "fail")
sys.exit(0 if ok else 1)
