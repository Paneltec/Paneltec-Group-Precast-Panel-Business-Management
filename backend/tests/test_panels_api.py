"""API tests for the Panels register + shop drawings.

Runs against an in-memory MongoDB (mongomock-motor) — no server or real DB needed.
    cd backend && pip install mongomock-motor && python -m pytest tests/test_panels_api.py -q
"""
import io
import os
import sys
import uuid

import pytest

pytest.importorskip("mongomock_motor")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "paneltec_test")
os.environ.setdefault("JWT_SECRET", "test-secret-" + "x" * 40)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio  # noqa: E402

from pypdf import PdfReader  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

import panel_geometry as g  # noqa: E402
import server as S  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def env():
    S.db = AsyncMongoMockClient()["paneltec_test_" + uuid.uuid4().hex[:6]]
    db = S.db
    admin_id, viewer_id, job_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())

    async def seed():
        await db.users.insert_one({"id": admin_id, "email": "a@x.au", "name": "Admin", "is_active": True,
                                   "is_super_admin": True, "permissions": {}})
        await db.users.insert_one({"id": viewer_id, "email": "v@x.au", "name": "Viewer", "is_active": True,
                                   "permissions": {"jobs.view": True}})
        await db.settings.insert_one({"key": "pricing", **S.DEFAULT_PRICING})
        await db.customers.insert_one({"id": "c1", "company_name": "Harbour Construction"})
        await db.jobs.insert_one({
            "id": job_id, "job_number": "J-2026-0007", "customer_id": "c1", "project_id": None,
            "status": "scheduled", "deleted_at": None,
            "line_items": [
                {"line_type": "panel", "description": "Wall", "length_m": 6, "height_m": 3, "thickness_mm": 150,
                 "quantity": 4, "concrete_grade": "40 MPa", "reinforcement_key": "standard", "openings_m2_per_panel": 1.2},
                {"line_type": "stock", "description": "Ferrules", "quantity": 20},
            ]})
    _run(seed())
    client = TestClient(S.app)
    hdr = lambda uid: {"Authorization": "Bearer " + S.create_access_token(uid, "x@x.au")}  # noqa: E731
    return {"c": client, "admin": hdr(admin_id), "viewer": hdr(viewer_id), "job": job_id, "db": db}


def _panel(mark="P01", **kw):
    body = {"mark": mark, "thickness_mm": 150, "concrete_grade": "40 MPa", "reinforcement_key": "standard",
            "outline": [list(p) for p in g.rectangle(0, 0, 6000, 3000)],
            "openings": [[list(p) for p in g.rectangle(1000, 1000, 1000, 1000)]]}
    body.update(kw)
    return body


def test_create_list_and_totals(env):
    c, a, j = env["c"], env["admin"], env["job"]
    r = c.post(f"/api/jobs/{j}/panels", json=_panel(quantity=2), headers=a)
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["calc"]["net_area_m2"] == 17.0
    # 17 m2 x 0.15 = 2.55 m3 x (2500 + 45) = 6489.75 kg
    assert p["calc"]["total_weight_kg"] == pytest.approx(6489.8, abs=0.1)
    assert p["lifting_status"] == "missing"
    r = c.get(f"/api/jobs/{j}/panels", headers=a)
    t = r.json()["totals"]
    assert t["marks"] == 1 and t["panels"] == 2
    assert t["weight_kg"] == pytest.approx(2 * 6489.75, abs=0.2)
    assert t["lifting_missing"] == 1


def test_duplicate_mark_rejected_case_insensitive(env):
    c, a, j = env["c"], env["admin"], env["job"]
    assert c.post(f"/api/jobs/{j}/panels", json=_panel("P01"), headers=a).status_code == 201
    r = c.post(f"/api/jobs/{j}/panels", json=_panel("p01"), headers=a)
    assert r.status_code == 409


def test_bad_geometry_is_friendly_400(env):
    c, a, j = env["c"], env["admin"], env["job"]
    r = c.post(f"/api/jobs/{j}/panels", headers=a,
               json=_panel(openings=[[list(p) for p in g.rectangle(5500, 100, 1000, 1000)]]))
    assert r.status_code == 400 and "outside" in r.json()["detail"]


def test_viewer_cannot_edit(env):
    c, v, j = env["c"], env["viewer"], env["job"]
    assert c.get(f"/api/jobs/{j}/panels", headers=v).status_code == 200
    assert c.post(f"/api/jobs/{j}/panels", json=_panel(), headers=v).status_code == 403


def test_update_recalculates_and_lifting_record(env):
    c, a, j = env["c"], env["admin"], env["job"]
    pid = c.post(f"/api/jobs/{j}/panels", json=_panel(), headers=a).json()["id"]
    r = c.patch(f"/api/panels/{pid}", json={"thickness_mm": 200, "openings": []}, headers=a)
    assert r.status_code == 200, r.text
    assert r.json()["calc"]["volume_m3"] == pytest.approx(3.6)
    lifting = {"engineer_name": "J Smith", "engineer_company": "Smith Eng", "reference": "SE-123-P01",
               "lifters": [{"type": "edge", "x_mm": 1500, "y_mm": 3000, "capacity_t": 5},
                           {"type": "face", "x_mm": 9000, "y_mm": 1000}]}
    r = c.put(f"/api/panels/{pid}/lifting", json=lifting, headers=a)
    body = r.json()
    assert r.status_code == 200
    assert body["lifting_status"] == "recorded"
    assert [l["label"] for l in body["lifting"]["lifters"]] == ["L1", "L2"]
    assert any("outside the panel" in w for w in body["warnings"])


def test_from_job_lines(env):
    c, a, j = env["c"], env["admin"], env["job"]
    r = c.post(f"/api/jobs/{j}/panels/from-job-lines", headers=a)
    assert r.status_code == 201 and r.json()["created"] == 1   # stock line skipped
    items = c.get(f"/api/jobs/{j}/panels", headers=a).json()["items"]
    assert items[0]["quantity"] == 4 and items[0]["calc"]["width_mm"] == 6000
    assert "draw them in" in items[0]["description"]
    # second time is refused so nothing is doubled up
    assert c.post(f"/api/jobs/{j}/panels/from-job-lines", headers=a).status_code == 400


def test_dxf_preview_then_bulk_import(env):
    import ezdxf
    c, a, j = env["c"], env["admin"], env["job"]
    doc = ezdxf.new("R2010"); doc.header["$INSUNITS"] = 4; msp = doc.modelspace()
    msp.add_lwpolyline(g.rectangle(0, 0, 4000, 3000), close=True)
    msp.add_lwpolyline(g.rectangle(500, 500, 800, 800), close=True)
    msp.add_text("W1", height=100).set_placement((2500, 2000))
    msp.add_lwpolyline(g.rectangle(6000, 0, 3000, 3000), close=True)
    msp.add_text("W2", height=100).set_placement((7500, 1500))
    buf = io.StringIO(); doc.write(buf)
    r = c.post("/api/panels/dxf-preview?thickness_mm=180", headers=a,
               files={"file": ("panels.dxf", buf.getvalue().encode(), "application/dxf")})
    assert r.status_code == 200, r.text
    found = r.json()["panels"]
    assert [p["mark"] for p in found] == ["W1", "W2"]
    assert found[0]["calc"]["thickness_mm"] == 180 and found[0]["svg"].startswith("<svg")
    payload = {"panels": [{"mark": p["mark"], "thickness_mm": 180, "outline": p["outline"],
                           "openings": p["openings"], "source": "dxf", "source_file": "panels.dxf"} for p in found]}
    r = c.post(f"/api/jobs/{j}/panels/bulk", json=payload, headers=a)
    assert r.status_code == 201 and r.json()["created"] == 2
    # importing again clashes on marks and saves nothing
    r = c.post(f"/api/jobs/{j}/panels/bulk", json=payload, headers=a)
    assert r.status_code == 409
    assert len(c.get(f"/api/jobs/{j}/panels", headers=a).json()["items"]) == 2


def test_bad_dxf_upload(env):
    c, a = env["c"], env["admin"]
    r = c.post("/api/panels/dxf-preview", headers=a, files={"file": ("x.dxf", b"nope", "application/dxf")})
    assert r.status_code == 400


def test_preview_endpoint(env):
    c, a = env["c"], env["admin"]
    r = c.post("/api/panels/preview", headers=a, json={
        "thickness_mm": 150, "outline": [list(p) for p in g.rectangle(0, 0, 6000, 3000)], "openings": []})
    assert r.status_code == 200 and r.json()["svg"].startswith("<svg")


def test_pdfs_single_batch_and_template(env):
    c, a, j = env["c"], env["admin"], env["job"]
    ids = [c.post(f"/api/jobs/{j}/panels", json=_panel(m), headers=a).json()["id"] for m in ("P01", "P02", "P03")]
    c.put(f"/api/panels/{ids[0]}/lifting", headers=a, json={
        "engineer_name": "J Smith", "reference": "SE-1",
        "lifters": [{"type": "edge", "x_mm": 1500, "y_mm": 3000, "capacity_t": 5}]})
    r = c.get(f"/api/panels/{ids[0]}/shop-drawing.pdf", headers=a)
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    assert "J-2026-0007_P01_revA" in r.headers["content-disposition"]
    r = c.get(f"/api/jobs/{j}/panels/shop-drawings.pdf", headers=a)
    assert r.status_code == 200 and len(PdfReader(io.BytesIO(r.content)).pages) == 3   # one sheet per panel
    r = c.get(f"/api/jobs/{j}/panels/shop-drawings.pdf?ids={ids[1]},{ids[2]}", headers=a)
    assert r.status_code == 200 and "_2_panels" in r.headers["content-disposition"]
    # template settings round-trip + preview
    r = c.put("/api/settings/shop-drawing", headers=a, json={"title": "CUSTOM", "paper": "A4", "drawn_by": "SB",
                                                               "general_notes": "Mark {{mark}} weighs {{weight_t}} t"})
    assert r.status_code == 200 and r.json()["paper"] == "A4"
    assert c.post("/api/settings/shop-drawing/preview.pdf", headers=a, json=r.json()).content[:4] == b"%PDF"
    assert c.get(f"/api/jobs/{j}/panels/export.dxf", headers=a).status_code == 200


def test_template_placeholders_do_not_execute():
    import panels_api as P
    assert P._fill("{{mark}} {{ weight_t }} {{unknown}} {% raw %}", {"mark": "P1", "weight_t": "6.5"}) \
        == "P1 6.5 {{unknown}} {% raw %}"


def test_delete_is_soft_and_cancelled_job_locked(env):
    c, a, j, db = env["c"], env["admin"], env["job"], env["db"]
    pid = c.post(f"/api/jobs/{j}/panels", json=_panel(), headers=a).json()["id"]
    assert c.delete(f"/api/panels/{pid}", headers=a).status_code == 200
    assert c.get(f"/api/panels/{pid}", headers=a).status_code == 404
    # the mark is free again
    assert c.post(f"/api/jobs/{j}/panels", json=_panel(), headers=a).status_code == 201
    _run(db.jobs.update_one({"id": j}, {"$set": {"status": "cancelled"}}))
    assert c.post(f"/api/jobs/{j}/panels", json=_panel("P09"), headers=a).status_code == 400


def test_elevation_split_preview_and_create(env):
    c, a, j = env["c"], env["admin"], env["job"]
    wall = {"outline": [[0, 0], [12000, 0], [12000, 3000], [6000, 4200], [0, 3000]],
            "openings": [[list(p) for p in g.rectangle(1000, 800, 1500, 1200)], [list(p) for p in g.rectangle(5500, 0, 1200, 2400)]],
            "cuts": [4000, 6000, 8000], "thickness_mm": 175, "mark_prefix": "S-", "start_no": 1}
    r = c.post(f"/api/jobs/{j}/panels/elevation-preview", json=wall, headers=a)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [p["mark"] for p in body["panels"]] == ["S-01", "S-02", "S-03", "S-04"]
    assert [p["width_mm"] for p in body["panels"]] == [4000, 2000, 2000, 4000]
    assert body["panels"][1]["split_openings"] == [2] and any("cut by a joint" in w for w in body["warnings"])
    assert all(p["valid"] for p in body["panels"])
    # create them through the normal bulk endpoint
    payload = {"panels": [{"mark": p["mark"], "thickness_mm": 175, "outline": p["outline"], "openings": p["openings"], "source": "elevation"} for p in body["panels"]]}
    assert c.post(f"/api/jobs/{j}/panels/bulk", json=payload, headers=a).status_code == 201
    r = c.post(f"/api/jobs/{j}/panels/elevation-preview", json=wall, headers=a).json()
    assert all(p["mark_taken"] for p in r["panels"])
