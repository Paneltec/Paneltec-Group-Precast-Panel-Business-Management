"""API tests for production tracking (units, schedule, yard, loads, labels, dashboard).

    cd backend && python -m pytest tests/test_production_api.py -q
"""
import io
import os
import sys
import uuid
from datetime import date, timedelta

import pytest

pytest.importorskip("mongomock_motor")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "paneltec_test")
os.environ.setdefault("JWT_SECRET", "test-secret-" + "x" * 40)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402
from pypdf import PdfReader  # noqa: E402

import panel_geometry as g  # noqa: E402
import server as S  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def env():
    S.db = AsyncMongoMockClient()["paneltec_test_" + uuid.uuid4().hex[:6]]
    db = S.db
    admin_id, yard_id, job_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())

    async def seed():
        await db.users.insert_one({"id": admin_id, "email": "a@x.au", "name": "Admin", "is_active": True, "is_super_admin": True, "permissions": {}})
        await db.users.insert_one({"id": yard_id, "email": "y@x.au", "name": "Yard", "is_active": True,
                                   "permissions": {"jobs.view": True, "production.view": True, "production.transition": True}})
        await db.settings.insert_one({"key": "pricing", **S.DEFAULT_PRICING})
        await db.customers.insert_one({"id": "c1", "company_name": "Harbour Construction"})
        await db.vehicles.insert_one({"id": "v1", "vehicle_code": "V-001", "make_model": "Kenworth T410", "rego": "ABC123", "capacity_tonnes": 20, "is_active": True})
        await db.jobs.insert_one({"id": job_id, "job_number": "J-2026-0007", "customer_id": "c1", "project_id": None,
                                  "status": "scheduled", "deleted_at": None, "line_items": []})
    _run(seed())
    client = TestClient(S.app)
    hdr = lambda uid: {"Authorization": "Bearer " + S.create_access_token(uid, "x@x.au")}  # noqa: E731
    return {"c": client, "admin": hdr(admin_id), "yard": hdr(yard_id), "job": job_id, "db": db}


def _panel(mark="P01", qty=1, w=6000, h=3000):
    return {"mark": mark, "quantity": qty, "thickness_mm": 150, "concrete_grade": "40 MPa", "reinforcement_key": "standard",
            "outline": [list(p) for p in g.rectangle(0, 0, w, h)], "openings": []}


def _mk(env, mark="P01", qty=1, **kw):
    r = env["c"].post(f"/api/jobs/{env['job']}/panels", json=_panel(mark, qty, **kw), headers=env["admin"])
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_units_follow_quantity_and_labels(env):
    c, a = env["c"], env["admin"]
    pid = _mk(env, "P01", 3)
    units = c.get(f"/api/panels/{pid}/units", headers=a).json()["items"]
    assert [u["label"] for u in units] == ["P01-1", "P01-2", "P01-3"]
    assert all(u["status"] == "planned" and u["qr_token"] for u in units)
    # quantity down to 1 → label becomes bare mark, extras removed
    assert c.patch(f"/api/panels/{pid}", json={"quantity": 1}, headers=a).status_code == 200
    units = c.get(f"/api/panels/{pid}/units", headers=a).json()["items"]
    assert [u["label"] for u in units] == ["P01"]
    # mark rename flows through
    c.patch(f"/api/panels/{pid}", json={"mark": "W-01", "quantity": 2}, headers=a)
    units = c.get(f"/api/panels/{pid}/units", headers=a).json()["items"]
    assert [u["label"] for u in units] == ["W-01-1", "W-01-2"]
    assert units[0]["dims"]["weight_kg"] > 0


def test_status_flow_with_pour_log_and_undo(env):
    c, a, y = env["c"], env["admin"], env["yard"]
    pid = _mk(env, "P01", 1)
    uid = c.get(f"/api/panels/{pid}/units", headers=a).json()["items"][0]["id"]
    r = c.post(f"/api/units/{uid}/transition", headers=y, json={
        "to": "cast", "at": "2026-10-16", "pour": {"supplier": "Boral", "docket_no": "D-1", "slump_mm": 90, "cylinder_ids": "C1,C2"}})
    assert r.status_code == 200, r.text
    u = r.json()
    assert u["status"] == "cast" and u["cast_at"].startswith("2026-10-16") and u["pour"]["supplier"] == "Boral"
    assert u["next_status"] == "stripped"
    # can't go backwards via transition
    assert c.post(f"/api/units/{uid}/transition", headers=y, json={"to": "planned"}).status_code == 400
    # forward jump records skipped steps
    r = c.post(f"/api/units/{uid}/transition", headers=y, json={"to": "in_yard", "yard_location": "Bay 3"})
    assert r.status_code == 200 and r.json()["yard_location"] == "Bay 3"
    assert r.json()["status_history"][-1]["skipped"] == ["stripped"]
    # undo
    r = c.post(f"/api/units/{uid}/revert", headers=y, json={"note": "scanned wrong panel"})
    assert r.status_code == 200 and r.json()["status"] == "cast" and r.json()["in_yard_at"] is None
    # viewer without production.transition is refused
    assert c.post(f"/api/units/{uid}/transition", headers={"Authorization": "Bearer x"}, json={"to": "stripped"}).status_code == 401


def test_cannot_reduce_quantity_below_cast_units(env):
    c, a = env["c"], env["admin"]
    pid = _mk(env, "P01", 2)
    units = c.get(f"/api/panels/{pid}/units", headers=a).json()["items"]
    c.post(f"/api/units/{units[1]['id']}/transition", headers=a, json={"to": "cast"})
    r = c.patch(f"/api/panels/{pid}", json={"quantity": 1}, headers=a)
    assert r.status_code == 400 and "already been cast" in r.json()["detail"]
    assert c.delete(f"/api/panels/{pid}", headers=a).status_code == 400


def test_scan_token_and_reject(env):
    c, a = env["c"], env["admin"]
    pid = _mk(env, "P01", 1)
    u = c.get(f"/api/panels/{pid}/units", headers=a).json()["items"][0]
    r = c.get(f"/api/scan/{u['qr_token']}", headers=a)
    assert r.status_code == 200 and r.json()["label"] == "P01" and r.json()["job"]["customer_name"] == "Harbour Construction"
    assert c.get("/api/scan/nope", headers=a).status_code == 404
    r = c.post(f"/api/units/{u['id']}/reject", headers=a, json={"reason": "Honeycombing on face"})
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert c.post(f"/api/units/{u['id']}/transition", headers=a, json={"to": "cast"}).status_code == 400
    # labels skip rejected units
    assert c.get(f"/api/jobs/{env['job']}/units/labels.pdf", headers=a).status_code == 400


def test_beds_schedule_and_capacity(env):
    c, a = env["c"], env["admin"]
    bed = c.post("/api/production/beds", headers=a, json={"name": "Bed 1", "length_mm": 12000, "width_mm": 3600}).json()
    pid = _mk(env, "P01", 3, w=5000)
    units = c.get(f"/api/panels/{pid}/units", headers=a).json()["items"]
    day = date.today().isoformat()
    for u in units:
        r = c.patch(f"/api/units/{u['id']}/plan", headers=a, json={"planned_cast_date": day, "bed_id": bed["id"]})
        assert r.status_code == 200, r.text
    r = c.get(f"/api/production/schedule?from={day}&to={day}", headers=a)
    assert r.status_code == 200
    sch = r.json()
    assert len(sch["items"]) == 3 and sch["unscheduled"] == []
    assert sch["usage_mm"][bed["id"]][day] == pytest.approx(3 * (5000 + 300))   # over the 12 m bed → UI warns
    # cast one; it can no longer be re-planned
    c.post(f"/api/units/{units[0]['id']}/transition", headers=a, json={"to": "cast"})
    assert c.patch(f"/api/units/{units[0]['id']}/plan", headers=a, json={"planned_cast_date": None}).status_code == 400
    # deleting the bed unassigns planned units
    assert c.delete(f"/api/production/beds/{bed['id']}", headers=a).status_code == 200
    assert c.get(f"/api/units/{units[1]['id']}", headers=a).json()["bed_id"] is None


def test_yard_and_erection_order(env):
    c, a = env["c"], env["admin"]
    pid = _mk(env, "P01", 2)
    units = c.get(f"/api/panels/{pid}/units", headers=a).json()["items"]
    for u, loc in zip(units, ["Bay A", "Bay B"]):
        c.post(f"/api/units/{u['id']}/transition", headers=a, json={"to": "in_yard", "yard_location": loc})
    r = c.get("/api/production/yard", headers=a).json()
    assert r["total_in_yard"] == 2 and r["locations"] == {"Bay A": 1, "Bay B": 1}
    assert c.get("/api/production/yard?search=bay b", headers=a).json()["items"][0]["label"] == "P01-2"
    r = c.post(f"/api/jobs/{env['job']}/erection-order", headers=a,
               json={"items": [{"unit_id": units[0]["id"], "erection_seq": 2}, {"unit_id": units[1]["id"], "erection_seq": 1}]})
    assert r.json()["updated"] == 2
    assert c.patch(f"/api/units/{units[0]['id']}", headers=a, json={"yard_location": "Bay C"}).json()["yard_location"] == "Bay C"


def test_loads_capacity_docket_and_delivery(env):
    c, a = env["c"], env["admin"]
    pid = _mk(env, "P01", 4)   # 6000 x 3000 x 150 ≈ 6.9 t each → 4 = 27.5 t
    units = c.get(f"/api/panels/{pid}/units", headers=a).json()["items"]
    for u in units:
        c.post(f"/api/units/{u['id']}/transition", headers=a, json={"to": "in_yard", "yard_location": "Bay 1"})
    r = c.post(f"/api/jobs/{env['job']}/loads", headers=a, json={"delivery_date": "2026-10-20", "vehicle_id": "v1",
                                                               "unit_ids": [u["id"] for u in units]})
    assert r.status_code == 201, r.text
    load = r.json()
    assert load["docket_number"] == "J-2026-0007-L01" and load["unit_count"] == 4
    assert load["over_capacity"] is True and load["total_weight_kg"] > 20000
    # the same unit can't be on two loads
    r2 = c.post(f"/api/jobs/{env['job']}/loads", headers=a, json={"unit_ids": [units[0]["id"]]})
    assert r2.status_code == 409
    # keep two units → within the 20 t capacity
    r = c.patch(f"/api/loads/{load['id']}", headers=a, json={"unit_ids": [u["id"] for u in units[:2]]})
    assert r.status_code == 200 and r.json()["over_capacity"] is False
    assert c.get(f"/api/units/{units[3]['id']}", headers=a).json()["load_id"] is None
    assert {u["id"] for u in c.get(f"/api/jobs/{env['job']}/loadable-units", headers=a).json()["items"]} == {units[2]["id"], units[3]["id"]}
    # docket PDF
    r = c.get(f"/api/loads/{load['id']}/docket.pdf", headers=a)
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    # loaded → delivered moves the units too
    r = c.post(f"/api/loads/{load['id']}/transition", headers=a, json={"to": "loaded"})
    assert r.status_code == 200 and r.json()["status"] == "loaded"
    assert c.get(f"/api/units/{units[0]['id']}", headers=a).json()["status"] == "loaded"
    r = c.post(f"/api/loads/{load['id']}/transition", headers=a, json={"to": "delivered", "at": "2026-10-21"})
    assert r.json()["units"][0]["status"] == "delivered"
    assert c.delete(f"/api/loads/{load['id']}", headers=a).status_code == 400   # not planned any more
    assert c.get(f"/api/production/loads?job_id={env['job']}", headers=a).json()["items"][0]["unit_count"] == 2


def test_labels_pdf_qr_and_shop_drawing_qr(env):
    c, a = env["c"], env["admin"]
    pid = _mk(env, "P01", 9)
    r = c.get(f"/api/jobs/{env['job']}/units/labels.pdf", headers=a)
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    assert len(PdfReader(io.BytesIO(r.content)).pages) == 2   # 8 per A4 sheet
    r = c.get(f"/api/jobs/{env['job']}/units/labels.pdf?layout=a4_2&ids={pid}", headers=a)
    assert len(PdfReader(io.BytesIO(r.content)).pages) == 5
    uid = c.get(f"/api/panels/{pid}/units", headers=a).json()["items"][0]["id"]
    r = c.get(f"/api/units/{uid}/qr.svg", headers=a)
    assert r.status_code == 200 and b"<svg" in r.content
    # app_url setting is used in QR links
    assert c.put("/api/settings/production", headers=a, json={"app_url": "http://192.168.15.165:3960/", "yard_locations": ["Bay 1", " ", "Bay 2"]}).json()["app_url"] == "http://192.168.15.165:3960"
    assert c.get("/api/settings/production", headers=a).json()["yard_locations"] == ["Bay 1", "Bay 2"]
    # shop drawing still renders with the QR block
    assert c.get(f"/api/panels/{pid}/shop-drawing.pdf", headers=a).content[:4] == b"%PDF"


def test_defects_photos_and_summary(env):
    c, a, y = env["c"], env["admin"], env["yard"]
    pid = _mk(env, "P01", 2)
    units = c.get(f"/api/panels/{pid}/units", headers=a).json()["items"]
    uid = units[0]["id"]
    r = c.post(f"/api/units/{uid}/defects", headers=y, json={"description": "Chipped corner", "severity": "minor"})
    assert r.status_code == 201 and r.json()["open_defects"] == 1
    did = r.json()["defects"][0]["id"]
    r = c.patch(f"/api/units/{uid}/defects/{did}", headers=y, json={"status": "repaired", "repair_notes": "Patched"})
    assert r.json()["open_defects"] == 0 and r.json()["defects"][0]["repaired_at"]
    # photo upload + unauthenticated fetch by id
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    r = c.post(f"/api/units/{uid}/photos", headers=y, files={"file": ("p.png", png, "image/png")}, data={"caption": "Face"})
    assert r.status_code == 201
    photo = r.json()["photos"][0]
    assert c.get(photo["url"]).status_code == 200
    assert c.post(f"/api/units/{uid}/photos", headers=y, files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 400
    # dashboard
    c.post(f"/api/units/{uid}/transition", headers=a, json={"to": "cast"})
    s = c.get("/api/production/summary", headers=a).json()
    assert s["counts"]["cast"] == 1 and s["counts"]["planned"] == 1 and s["cast_this_week"] == 1
    assert s["m3_this_week"] == pytest.approx(2.7) and len(s["days"]) == 14


def test_job_units_overview_and_panel_counts(env):
    c, a = env["c"], env["admin"]
    _mk(env, "P01", 2); _mk(env, "P02", 1)
    r = c.get(f"/api/jobs/{env['job']}/units", headers=a).json()
    assert r["total"] == 3 and r["counts"] == {"planned": 3}
    panels = c.get(f"/api/jobs/{env['job']}/panels", headers=a).json()["items"]
    assert panels[0]["unit_status_counts"] == {"planned": 2}


def test_tracking_link_public_page(env):
    c, a = env["c"], env["admin"]
    pid = _mk(env, "S-01", 2)
    units = c.get(f"/api/panels/{pid}/units", headers=a).json()["items"]
    c.post(f"/api/units/{units[0]['id']}/transition", headers=a, json={"to": "delivered"})
    assert c.get(f"/api/jobs/{env['job']}/tracking-link", headers=a).json()["enabled"] is False
    r = c.post(f"/api/jobs/{env['job']}/tracking-link", headers=a)
    assert r.status_code == 200 and r.json()["enabled"] and "/track/" in r.json()["url"]
    token = r.json()["url"].rsplit("/", 1)[-1]
    # same token on repeat
    assert c.post(f"/api/jobs/{env['job']}/tracking-link", headers=a).json()["url"].endswith(token)
    pub = c.get(f"/api/public/track/{token}")   # no auth
    assert pub.status_code == 200
    body = pub.json()
    assert body["job_number"] == "J-2026-0007" and body["customer"] == "Harbour Construction"
    assert body["total_panels"] == 2 and body["delivered_or_installed"] == 1 and body["progress_pct"] == 50
    assert {p["stage"] for p in body["panels"]} == {"Scheduled", "Delivered"}
    assert "yard_location" not in body["panels"][0] and "pour" not in body["panels"][0]
    assert c.delete(f"/api/jobs/{env['job']}/tracking-link", headers=a).json()["enabled"] is False
    assert c.get(f"/api/public/track/{token}").status_code == 404
    assert c.get("/api/public/track/short").status_code == 404
