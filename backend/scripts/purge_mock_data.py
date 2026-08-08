"""Phase 11.7.4 — one-off cleanup of pre-Simpro seed / mock / demo data.
Backs up each affected collection to /app/backend/backups/pre-purge-<ts>.json
before hard-deleting.

Usage (server-side, one-off):
    python3 /app/backend/scripts/purge_mock_data.py --confirm
"""
import os, sys, json, uuid, asyncio, argparse
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

def _load_env():
    e = {}
    for line in open("/app/backend/.env"):
        line = line.strip()
        if not line or line.startswith("#"): continue
        k, _, v = line.partition("=")
        e[k] = v.strip().strip('"').strip("'")
    return e

MOCK_QUERY = {
    "$or": [
        {"source": {"$regex": "^MOCKED_"}},
        {"email":  {"$regex": r"@(example\.com|demo\.paneltec|test\.local)$", "$options": "i"}},
        {"notes":  {"$regex": r"\[(SEED|MOCK|DEMO)\]", "$options": "i"}},
        {"is_seed": True},
        {"id":     {"$regex": r"^(mock|demo)-"}},
    ]
}

SWEEP_COLLECTIONS = [
    "customers", "projects", "quotes", "jobs", "invoices",
    "employees", "vehicles", "compliance_forms",
]

async def main(confirm: bool):
    env = _load_env()
    c = AsyncIOMotorClient(env["MONGO_URL"])
    db = c[env["DB_NAME"]]
    ts = datetime.now(timezone.utc).isoformat().replace(":", "-")
    backup_dir = "/app/backend/backups"
    os.makedirs(backup_dir, exist_ok=True)
    backup_file = f"{backup_dir}/pre-purge-{ts}.json"

    plan = {}
    backups = {}
    for coll in SWEEP_COLLECTIONS:
        docs = await db[coll].find(MOCK_QUERY).to_list(None)
        plan[coll] = len(docs)
        backups[coll] = docs

    # compliance_form_templates: AI drafts + mock only (never system templates)
    tpl_query = {"$and": [
        {"$or": [
            {"status": "ai_draft"},
            {"source": {"$regex": "^MOCKED_"}},
            {"notes": {"$regex": r"\[(SEED|MOCK|DEMO)\]", "$options": "i"}},
        ]},
        {"is_system": {"$ne": True}},
    ]}
    tpl_docs = await db.compliance_form_templates.find(tpl_query).to_list(None)
    plan["compliance_form_templates"] = len(tpl_docs)
    backups["compliance_form_templates"] = tpl_docs

    total = sum(plan.values())
    print(f"Purge plan (total: {total} docs)")
    for k, n in plan.items():
        print(f"  {k:32s} {n}")

    if total == 0:
        print("Nothing to purge — already clean.")
        return

    # Serialize backups (drop _id which is ObjectId)
    for k in backups:
        for d in backups[k]:
            d.pop("_id", None)
    with open(backup_file, "w") as f:
        json.dump({"timestamp": ts, "counts": plan, "docs": backups}, f, default=str, indent=2)
    size = os.path.getsize(backup_file)
    print(f"Backup written: {backup_file} ({size:,} bytes)")

    if not confirm:
        print("Dry run — pass --confirm to execute.")
        return

    results = {}
    for coll in SWEEP_COLLECTIONS:
        r = await db[coll].delete_many(MOCK_QUERY)
        results[coll] = r.deleted_count
    r_tpl = await db.compliance_form_templates.delete_many(tpl_query)
    results["compliance_form_templates"] = r_tpl.deleted_count

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.audit_events.insert_one({
        "id": str(uuid.uuid4()), "timestamp": now_iso,
        "actor_user_id": "system-cleanup", "actor_name": "System Cleanup", "actor_email": "system",
        "action": "system_purge_mock_data", "entity_type": "system",
        "entity_id": None, "entity_label": f"{sum(results.values())} docs",
        "changes": None,
        "metadata": {"counts": results, "backup_file": backup_file,
                      "reason": "user-directed hard-delete of pre-Simpro mock data",
                      "timestamp": now_iso},
    })
    print(f"\nPurged. Backup: {backup_file}")
    print("Per-collection deleted counts:")
    for k, n in results.items():
        print(f"  {k:32s} {n}")

    print("\nRemaining counts:")
    for coll in SWEEP_COLLECTIONS + ["compliance_form_templates"]:
        left = await db[coll].count_documents({})
        print(f"  {coll:32s} {left}")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--confirm", action="store_true")
    a = p.parse_args()
    asyncio.run(main(a.confirm))
