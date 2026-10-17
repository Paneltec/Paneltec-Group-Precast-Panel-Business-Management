"""Panels register + shop drawings.

One record per panel mark on a Job, holding its shape (outline + openings),
calculated area / volume / weight / centre of gravity, the lifting record from
the structural engineer, and shop-drawing output (single or batch PDF).

Wired in at the bottom of server.py:  `import panels_api` registers the routes.

Permissions reuse the Jobs module (jobs.view / jobs.edit) so existing roles
work without changes. The shop-drawing template uses company.view / company.edit.

SAFETY: this module never calculates lifter positions, lifting loads, bracing or
reinforcement. Lifting information is recorded exactly as supplied by the
engineer and every drawing states that.
"""
from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field

import panel_geometry as geo
import server as S

router = APIRouter(prefix="/api")

MAX_DXF_BYTES = 15 * 1024 * 1024
REINFORCEMENT_KEYS = ("none", "light", "standard", "heavy", "prestressed")

LIFTING_DISCLAIMER = (
    "Lifter positions, types and capacities are recorded as specified by the structural "
    "engineer named on this drawing. This drawing is not a lifting design and must not be "
    "used for lifting unless the engineer's design is attached."
)
LIFTING_MISSING = "LIFTING DESIGN NOT YET RECEIVED FROM ENGINEER — DO NOT LIFT"

DEFAULT_SHOP_DRAWING = {
    "title": "PANEL SHOP DRAWING",
    "paper": "A3",
    "drawn_by": "",
    "checked_by": "",
    "general_notes": (
        "1. All dimensions in millimetres. Do not scale.\n"
        "2. Concrete grade {{concrete_grade}}. Panel thickness {{thickness_mm}} mm.\n"
        "3. Estimated panel mass {{weight_t}} t (concrete + reinforcement allowance).\n"
        "4. Verify all openings and cast-ins against the architectural drawings before casting."
    ),
    "footer_note": "",
    "show_dimensions": True,
    "show_cog": True,
    "show_lifters": True,
    "show_opening_schedule": True,
    "show_weights": True,
    "show_qr": True,
}
PLACEHOLDERS = ["mark", "job_number", "project", "customer", "thickness_mm", "concrete_grade",
                "weight_t", "weight_kg", "volume_m3", "area_m2", "width_mm", "height_mm",
                "revision", "date"]


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class Lifter(BaseModel):
    model_config = ConfigDict(extra="ignore")
    label: str = Field("", max_length=20)
    type: Literal["edge", "face"] = "face"
    x_mm: float
    y_mm: float
    capacity_t: Optional[float] = Field(None, ge=0)
    product: str = Field("", max_length=120)


class LiftingRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    engineer_name: str = Field("", max_length=120)
    engineer_company: str = Field("", max_length=120)
    reference: str = Field("", max_length=120)       # engineer's drawing / certificate no.
    design_date: Optional[str] = None                 # YYYY-MM-DD
    notes: str = Field("", max_length=2000)
    lifters: List[Lifter] = Field(default_factory=list, max_length=40)


class PanelInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    mark: str = Field(..., min_length=1, max_length=30)
    description: str = Field("", max_length=300)
    quantity: int = Field(1, ge=1, le=999)
    thickness_mm: float = Field(..., gt=0, le=2000)
    concrete_grade: str = Field("", max_length=40)
    reinforcement_key: str = "standard"
    finish: str = Field("", max_length=80)
    revision: str = Field("A", max_length=10)
    outline: List[List[float]] = Field(..., min_length=3, max_length=2000)
    openings: List[List[List[float]]] = Field(default_factory=list, max_length=200)
    source: Literal["manual", "dxf", "job_line"] = "manual"
    source_file: str = Field("", max_length=200)


class PanelPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    mark: Optional[str] = Field(None, min_length=1, max_length=30)
    description: Optional[str] = Field(None, max_length=300)
    quantity: Optional[int] = Field(None, ge=1, le=999)
    thickness_mm: Optional[float] = Field(None, gt=0, le=2000)
    concrete_grade: Optional[str] = Field(None, max_length=40)
    reinforcement_key: Optional[str] = None
    finish: Optional[str] = Field(None, max_length=80)
    revision: Optional[str] = Field(None, max_length=10)
    outline: Optional[List[List[float]]] = Field(None, min_length=3, max_length=2000)
    openings: Optional[List[List[List[float]]]] = Field(None, max_length=200)


class PreviewInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    thickness_mm: float = Field(..., gt=0, le=2000)
    reinforcement_key: str = "standard"
    outline: List[List[float]] = Field(..., min_length=3, max_length=2000)
    openings: List[List[List[float]]] = Field(default_factory=list, max_length=200)
    lifters: List[Lifter] = Field(default_factory=list)
    mark: str = ""


class BulkInput(BaseModel):
    panels: List[PanelInput] = Field(..., min_length=1, max_length=500)


class ShopDrawingSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str = Field("PANEL SHOP DRAWING", max_length=80)
    paper: Literal["A3", "A4"] = "A3"
    drawn_by: str = Field("", max_length=80)
    checked_by: str = Field("", max_length=80)
    general_notes: str = Field("", max_length=4000)
    footer_note: str = Field("", max_length=300)
    show_dimensions: bool = True
    show_cog: bool = True
    show_lifters: bool = True
    show_opening_schedule: bool = True
    show_weights: bool = True
    show_qr: bool = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _densities(reinforcement_key: str) -> Dict[str, float]:
    pricing = await S.db.settings.find_one({"key": "pricing"}, {"_id": 0}) or {}
    concrete = float(pricing.get("concrete_density") or S.DEFAULT_PRICING["concrete_density"])
    rd = pricing.get("reinforcement_densities") or S.DEFAULT_PRICING["reinforcement_densities"]
    if reinforcement_key not in REINFORCEMENT_KEYS:
        raise HTTPException(status_code=400, detail=f"Reinforcement must be one of: {', '.join(REINFORCEMENT_KEYS)}")
    steel = 0.0 if reinforcement_key == "none" else float(rd.get(reinforcement_key) or 0)
    return {"concrete": concrete, "steel": steel}


async def _calc(outline, openings, thickness_mm, reinforcement_key) -> Dict[str, Any]:
    d = await _densities(reinforcement_key)
    try:
        return geo.calculate(outline, openings, thickness_mm, d["concrete"], d["steel"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _lifter_warnings(outline, lifters: List[dict]) -> List[str]:
    out = []
    poly = geo.clean_polygon(outline)
    for i, lf in enumerate(lifters or [], start=1):
        if not geo.point_in_polygon((float(lf["x_mm"]), float(lf["y_mm"])), poly):
            out.append(f"{lf.get('label') or 'L' + str(i)} is outside the panel outline — check the position")
    return out


def _lifting_status(lifting: Optional[dict]) -> str:
    if not lifting or not lifting.get("lifters"):
        return "missing"
    if not (lifting.get("engineer_name") and lifting.get("reference")):
        return "incomplete"
    return "recorded"


def _decorate(p: dict) -> dict:
    p["lifting_status"] = _lifting_status(p.get("lifting"))
    return p


async def _job_or_404(jid: str) -> dict:
    job = await S.db.jobs.find_one({"id": jid}, {"_id": 0})
    if not job or job.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Job not found")
    return job


async def _editable_job(jid: str) -> dict:
    job = await _job_or_404(jid)
    if job.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Cancelled jobs cannot be modified")
    return job


async def _panel_or_404(pid: str) -> dict:
    p = await S.db.panels.find_one({"id": pid, "deleted_at": None}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Panel not found")
    return p


async def _ensure_unique_mark(job_id: str, mark: str, exclude_id: Optional[str] = None):
    q: Dict[str, Any] = {"job_id": job_id, "deleted_at": None,
                         "mark": re.compile(f"^{re.escape(mark.strip())}$", re.IGNORECASE)}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    if await S.db.panels.find_one(q, {"_id": 1}):
        raise HTTPException(status_code=409, detail=f"Panel mark '{mark.strip()}' is already used on this job")


async def _build_panel_doc(job: dict, data: PanelInput, user: dict) -> dict:
    calc = await _calc(data.outline, data.openings, data.thickness_mm, data.reinforcement_key)
    o, ops = geo.validate_geometry(data.outline, data.openings)
    now = S.now_iso()
    return {
        "id": str(uuid.uuid4()), "job_id": job["id"], "job_number": job.get("job_number"),
        "mark": data.mark.strip(), "description": data.description.strip(),
        "quantity": data.quantity, "thickness_mm": data.thickness_mm,
        "concrete_grade": data.concrete_grade.strip(), "reinforcement_key": data.reinforcement_key,
        "finish": data.finish.strip(), "revision": (data.revision or "A").strip() or "A",
        "outline": [[x, y] for x, y in o], "openings": [[[x, y] for x, y in op] for op in ops],
        "calc": calc, "lifting": None,
        "source": data.source, "source_file": data.source_file,
        "created_at": now, "updated_at": now, "created_by": user.get("id"), "deleted_at": None,
    }


def _totals(items: List[dict]) -> Dict[str, Any]:
    t = {"marks": len(items), "panels": 0, "net_area_m2": 0.0, "volume_m3": 0.0, "weight_kg": 0.0,
         "heaviest_kg": 0.0, "heaviest_mark": "", "lifting_missing": 0}
    for p in items:
        q = int(p.get("quantity") or 1); c = p.get("calc") or {}
        t["panels"] += q
        t["net_area_m2"] += q * float(c.get("net_area_m2") or 0)
        t["volume_m3"] += q * float(c.get("volume_m3") or 0)
        t["weight_kg"] += q * float(c.get("total_weight_kg") or 0)
        if float(c.get("total_weight_kg") or 0) > t["heaviest_kg"]:
            t["heaviest_kg"] = float(c.get("total_weight_kg") or 0); t["heaviest_mark"] = p.get("mark", "")
        if _lifting_status(p.get("lifting")) != "recorded":
            t["lifting_missing"] += 1
    for k in ("net_area_m2", "volume_m3"):
        t[k] = round(t[k], 3)
    t["weight_kg"] = round(t["weight_kg"], 1)
    t["weight_t"] = round(t["weight_kg"] / 1000.0, 2)
    return t


def _mark_sort_key(m: str):
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r"(\d+)", m or "")]


async def _list_panels(jid: str) -> List[dict]:
    items = await S.db.panels.find({"job_id": jid, "deleted_at": None}, {"_id": 0}).to_list(2000)
    items.sort(key=lambda p: _mark_sort_key(p.get("mark", "")))
    return [_decorate(p) for p in items]


# ---------------------------------------------------------------------------
# Register CRUD
# ---------------------------------------------------------------------------
@router.get("/jobs/{jid}/panels")
async def list_job_panels(jid: str, _u: dict = Depends(S.require_permission("jobs.view"))):
    await _job_or_404(jid)
    items = await _list_panels(jid)
    import production_api as P
    summary = await P.units_summary_for_panels([p["id"] for p in items])
    for p in items:
        p["unit_status_counts"] = summary.get(p["id"], {})
    return {"items": items, "totals": _totals(items)}


@router.post("/jobs/{jid}/panels", status_code=201)
async def create_panel(jid: str, payload: PanelInput, user: dict = Depends(S.require_permission("jobs.edit"))):
    job = await _editable_job(jid)
    await _ensure_unique_mark(jid, payload.mark)
    doc = await _build_panel_doc(job, payload, user)
    await S.db.panels.insert_one(dict(doc))
    import production_api as P
    await P.sync_units_for_panel(doc)
    await S.record_audit(user, "panel_created", "panel", doc["id"], f"{job.get('job_number')} {doc['mark']}",
                         metadata={"job_id": jid, "source": doc["source"]})
    return _decorate(doc)


@router.post("/jobs/{jid}/panels/bulk", status_code=201)
async def create_panels_bulk(jid: str, payload: BulkInput, user: dict = Depends(S.require_permission("jobs.edit"))):
    """Create many panels at once (DXF import). All-or-nothing: if any panel is
    invalid or its mark is taken, nothing is saved."""
    job = await _editable_job(jid)
    marks = [p.mark.strip().lower() for p in payload.panels]
    dupes = sorted({m for m in marks if marks.count(m) > 1})
    if dupes:
        raise HTTPException(status_code=409, detail=f"Duplicate marks in import: {', '.join(dupes)}")
    docs = []
    for p in payload.panels:
        await _ensure_unique_mark(jid, p.mark)
        try:
            docs.append(await _build_panel_doc(job, p, user))
        except HTTPException as e:
            raise HTTPException(status_code=e.status_code, detail=f"Panel {p.mark}: {e.detail}")
    await S.db.panels.insert_many([dict(d) for d in docs])
    import production_api as P
    for d in docs:
        await P.sync_units_for_panel(d)
    await S.record_audit(user, "panels_imported", "job", jid, job.get("job_number") or jid,
                         metadata={"count": len(docs), "source_file": payload.panels[0].source_file})
    return {"created": len(docs), "items": [_decorate(d) for d in docs]}


@router.post("/jobs/{jid}/panels/from-job-lines", status_code=201)
async def create_panels_from_job_lines(jid: str, user: dict = Depends(S.require_permission("jobs.edit"))):
    """Start the register from the job's quoted panel lines: one rectangular
    panel per line (quantity carried over). Openings on quotes are an area
    only, so they are noted in the description to be drawn in afterwards."""
    job = await _editable_job(jid)
    existing = await S.db.panels.count_documents({"job_id": jid, "deleted_at": None})
    if existing:
        raise HTTPException(status_code=400, detail="This job already has panels. Add more with 'Add panel' or 'Import DXF'.")
    lines = [l for l in (job.get("line_items") or []) if (l.get("line_type") or "panel") == "panel"
             and l.get("length_m") and l.get("height_m") and l.get("thickness_mm")]
    if not lines:
        raise HTTPException(status_code=400, detail="This job has no panel lines with sizes to copy")
    docs = []
    for n, l in enumerate(lines, start=1):
        desc = (l.get("description") or l.get("panel_type_label") or "").strip()
        if float(l.get("openings_m2_per_panel") or 0) > 0:
            desc = (desc + f" — quoted with {l['openings_m2_per_panel']} m² of openings: draw them in").strip(" —")
        rk = l.get("reinforcement_key") or "standard"
        data = PanelInput(
            mark=f"P{n:02d}", description=desc[:300], quantity=int(l.get("quantity") or 1),
            thickness_mm=float(l["thickness_mm"]), concrete_grade=l.get("concrete_grade") or "",
            reinforcement_key=rk if rk in REINFORCEMENT_KEYS else "standard",
            finish=l.get("finish_label") or "",
            outline=[list(p) for p in geo.rectangle(0, 0, float(l["length_m"]) * 1000, float(l["height_m"]) * 1000)],
            source="job_line",
        )
        docs.append(await _build_panel_doc(job, data, user))
    await S.db.panels.insert_many([dict(d) for d in docs])
    import production_api as P
    for d in docs:
        await P.sync_units_for_panel(d)
    await S.record_audit(user, "panels_created_from_job", "job", jid, job.get("job_number") or jid,
                         metadata={"count": len(docs)})
    return {"created": len(docs)}


@router.get("/panels/{pid}")
async def get_panel(pid: str, _u: dict = Depends(S.require_permission("jobs.view"))):
    p = await _panel_or_404(pid)
    p["warnings"] = _lifter_warnings(p["outline"], (p.get("lifting") or {}).get("lifters") or [])
    return _decorate(p)


@router.patch("/panels/{pid}")
async def update_panel(pid: str, payload: PanelPatch, user: dict = Depends(S.require_permission("jobs.edit"))):
    p = await _panel_or_404(pid)
    await _editable_job(p["job_id"])
    upd = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "mark" in upd:
        upd["mark"] = upd["mark"].strip()
        await _ensure_unique_mark(p["job_id"], upd["mark"], exclude_id=pid)
    merged = {**p, **upd}
    if any(k in upd for k in ("outline", "openings", "thickness_mm", "reinforcement_key")):
        merged["calc"] = await _calc(merged["outline"], merged["openings"], merged["thickness_mm"],
                                     merged["reinforcement_key"])
        o, ops = geo.validate_geometry(merged["outline"], merged["openings"])
        upd["outline"] = [[x, y] for x, y in o]
        upd["openings"] = [[[x, y] for x, y in op] for op in ops]
        upd["calc"] = merged["calc"]
    upd["updated_at"] = S.now_iso()
    changes = {k: {"from": p.get(k), "to": v} for k, v in upd.items()
               if k not in ("outline", "openings", "calc", "updated_at") and p.get(k) != v}
    if "outline" in upd or "openings" in upd:
        changes["geometry"] = {"from": "previous shape", "to": "new shape"}
    import production_api as P
    await P.sync_units_for_panel({**merged, **upd})   # refuses if cast units would be dropped
    await S.db.panels.update_one({"id": pid}, {"$set": upd})
    await S.record_audit(user, "panel_updated", "panel", pid, f"{p.get('job_number')} {merged['mark']}", changes=changes)
    return await get_panel(pid, user)


@router.put("/panels/{pid}/lifting")
async def set_panel_lifting(pid: str, payload: LiftingRecord, user: dict = Depends(S.require_permission("jobs.edit"))):
    """Record the engineer's lifting design for this panel (positions as supplied — never calculated here)."""
    p = await _panel_or_404(pid)
    await _editable_job(p["job_id"])
    rec = payload.model_dump()
    for i, lf in enumerate(rec["lifters"], start=1):
        lf["label"] = (lf.get("label") or "").strip() or f"L{i}"
    rec["recorded_by"] = user.get("id")
    rec["recorded_by_name"] = user.get("name") or user.get("email")
    rec["recorded_at"] = S.now_iso()
    await S.db.panels.update_one({"id": pid}, {"$set": {"lifting": rec, "updated_at": S.now_iso()}})
    await S.record_audit(user, "panel_lifting_recorded", "panel", pid, f"{p.get('job_number')} {p['mark']}",
                         metadata={"engineer": rec["engineer_name"], "reference": rec["reference"],
                                   "lifters": len(rec["lifters"])})
    return await get_panel(pid, user)


@router.delete("/panels/{pid}")
async def delete_panel(pid: str, user: dict = Depends(S.require_permission("jobs.edit"))):
    p = await _panel_or_404(pid)
    await _editable_job(p["job_id"])
    import production_api as P
    await P.delete_units_for_panel(pid)
    await S.db.panels.update_one({"id": pid}, {"$set": {"deleted_at": S.now_iso(), "deleted_by": user.get("id")}})
    await S.record_audit(user, "panel_deleted", "panel", pid, f"{p.get('job_number')} {p['mark']}")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Live preview + DXF
# ---------------------------------------------------------------------------
@router.post("/panels/preview")
async def preview_panel(payload: PreviewInput, _u: dict = Depends(S.require_permission("jobs.view"))):
    calc = await _calc(payload.outline, payload.openings, payload.thickness_mm, payload.reinforcement_key)
    lifters = [l.model_dump() for l in payload.lifters]
    svg = geo.render_svg(payload.outline, payload.openings, calc, lifters, width_px=900, height_px=520)
    return {"calc": calc, "svg": svg, "warnings": _lifter_warnings(payload.outline, lifters)}


@router.post("/panels/dxf-preview")
async def dxf_preview(file: UploadFile = File(...), thickness_mm: float = Query(150, gt=0, le=2000),
                      reinforcement_key: str = Query("standard"),
                      _u: dict = Depends(S.require_permission("jobs.edit"))):
    """Read a DXF and show what would be imported. Nothing is saved."""
    data = await file.read(MAX_DXF_BYTES + 1)
    if len(data) > MAX_DXF_BYTES:
        raise HTTPException(status_code=413, detail="DXF is larger than 15 MB")
    try:
        res = geo.parse_dxf(data, file.filename or "upload.dxf")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    d = await _densities(reinforcement_key)
    for p in res["panels"]:
        p["calc"] = geo.calculate(p["outline"], p["openings"], thickness_mm, d["concrete"], d["steel"]) if p["valid"] else None
        p["svg"] = geo.render_svg(p["outline"], p["openings"], p["calc"], None, width_px=360, height_px=220,
                                  show_dimensions=False, show_cog=False)
    return res


@router.get("/jobs/{jid}/panels/export.dxf")
async def export_job_dxf(jid: str, user: dict = Depends(S.require_permission("jobs.view"))):
    job = await _job_or_404(jid)
    items = await _list_panels(jid)
    if not items:
        raise HTTPException(status_code=400, detail="No panels to export")
    data = geo.export_dxf(items)
    fname = f"paneltec_panels_{S._safe_filename(job.get('job_number') or jid)}.dxf"
    return Response(content=data, media_type="application/dxf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ---------------------------------------------------------------------------
# Shop drawing template + PDFs
# ---------------------------------------------------------------------------
async def _load_shop_settings() -> Dict[str, Any]:
    doc = await S.db.settings.find_one({"key": "shop_drawing"}, {"_id": 0, "key": 0}) or {}
    return {**DEFAULT_SHOP_DRAWING, **{k: v for k, v in doc.items() if k in DEFAULT_SHOP_DRAWING}}


@router.get("/settings/shop-drawing")
async def get_shop_settings(_u: dict = Depends(S.require_permission("company.view"))):
    return {**(await _load_shop_settings()), "placeholders": PLACEHOLDERS,
            "lifting_disclaimer": LIFTING_DISCLAIMER}


@router.put("/settings/shop-drawing")
async def put_shop_settings(payload: ShopDrawingSettings, user: dict = Depends(S.require_permission("company.edit"))):
    before = await _load_shop_settings()
    new = payload.model_dump()
    await S.db.settings.update_one({"key": "shop_drawing"},
                                   {"$set": {**new, "updated_at": S.now_iso()}}, upsert=True)
    diff = {k: {"from": before.get(k), "to": v} for k, v in new.items() if before.get(k) != v}
    if diff:
        await S.record_audit(user, "settings_changed", "company_settings", "shop_drawing", "Shop drawing template", changes=diff)
    return await get_shop_settings(user)


def _fill(text: str, values: Dict[str, Any]) -> str:
    """Replace {{name}} placeholders. Plain substitution — user text is never run as a template."""
    return re.sub(r"\{\{\s*([a-z_]+)\s*\}\}",
                  lambda m: str(values.get(m.group(1), m.group(0))), text or "")


async def _context_for_job(job: dict) -> Dict[str, Any]:
    customer = await S.db.customers.find_one({"id": job.get("customer_id")}, {"_id": 0, "company_name": 1}) or {}
    project = None
    if job.get("project_id"):
        project = await S.db.projects.find_one({"id": job["project_id"]}, {"_id": 0, "project_name": 1})
    return {"customer": customer.get("company_name") or "", "project": (project or {}).get("project_name") or ""}


def _sheet_for(panel: dict, job: dict, ctx: Dict[str, Any], tpl: Dict[str, Any], app_url: str = "") -> Dict[str, Any]:
    calc = panel.get("calc") or {}
    qr = ""
    if tpl.get("show_qr") and app_url and panel.get("id") and panel.get("id") != "sample":
        import production_api as P
        qr = P._qr_svg(f"{app_url}/panels/{panel['id']}", scale=2)
    lifting = panel.get("lifting") or {}
    a3 = tpl["paper"] == "A3"
    svg = geo.render_svg(panel["outline"], panel["openings"], calc, lifting.get("lifters") or [],
                         width_px=1000 if a3 else 760, height_px=560 if a3 else 430,
                         show_dimensions=tpl["show_dimensions"], show_cog=tpl["show_cog"],
                         show_lifters=tpl["show_lifters"])
    values = {
        "mark": panel.get("mark", ""), "job_number": job.get("job_number", ""),
        "project": ctx["project"], "customer": ctx["customer"],
        "thickness_mm": geo._fmt(float(panel.get("thickness_mm") or 0)),
        "concrete_grade": panel.get("concrete_grade") or "—",
        "weight_t": f"{float(calc.get('total_weight_t') or 0):.2f}",
        "weight_kg": f"{float(calc.get('total_weight_kg') or 0):,.0f}",
        "volume_m3": f"{float(calc.get('volume_m3') or 0):.3f}",
        "area_m2": f"{float(calc.get('net_area_m2') or 0):.2f}",
        "width_mm": geo._fmt(float(calc.get("width_mm") or 0)),
        "height_mm": geo._fmt(float(calc.get("height_mm") or 0)),
        "revision": panel.get("revision") or "A",
        "date": S.now_utc().strftime("%d/%m/%Y"),
    }
    openings = []
    for i, op in enumerate(panel.get("openings") or [], start=1):
        x0, y0, x1, y1 = geo.bbox(geo.clean_polygon(op))
        openings.append({"n": i, "x": geo._fmt(x0), "y": geo._fmt(y0), "w": geo._fmt(x1 - x0), "h": geo._fmt(y1 - y0),
                         "shape": "Rect." if len(op) == 4 else ("Round" if len(op) > 16 else "Shaped")})
    return {
        "panel": panel, "calc": calc, "svg": svg, "v": values, "qr": qr,
        "notes": _fill(tpl["general_notes"], values), "footer_note": _fill(tpl["footer_note"], values),
        "openings": openings, "lifting": lifting, "lifting_status": _lifting_status(lifting),
        "lifter_warnings": _lifter_warnings(panel["outline"], lifting.get("lifters") or []),
    }


async def _render_pdf(job: dict, panels: List[dict], tpl: Dict[str, Any], app_url: str = "") -> bytes:
    from weasyprint import HTML
    ctx = await _context_for_job(job)
    company = await S._load_company_settings()
    sheets = [_sheet_for(p, job, ctx, tpl, app_url) for p in panels]
    html = S._get_jinja_env().get_template("panel_shop_drawing.html").render(
        sheets=sheets, job=job, ctx=ctx, tpl=tpl, company=company,
        disclaimer=LIFTING_DISCLAIMER, missing=LIFTING_MISSING,
        generated_at=S._fmt_generated_at(), total=len(sheets),
    )
    return HTML(string=html, base_url=str(S.ROOT_DIR)).write_pdf()


@router.get("/panels/{pid}/shop-drawing.pdf")
async def panel_shop_drawing(pid: str, request: Request, user: dict = Depends(S.require_permission("jobs.view"))):
    import production_api as P
    p = _decorate(await _panel_or_404(pid))
    job = await _job_or_404(p["job_id"])
    pdf = await _render_pdf(job, [p], await _load_shop_settings(), await P._app_url(request))
    fname = f"shop_drawing_{S._safe_filename(job.get('job_number') or '')}_{S._safe_filename(p['mark'])}_rev{S._safe_filename(p.get('revision') or 'A')}.pdf"
    await S.record_audit(user, "shop_drawing_exported", "panel", pid, f"{job.get('job_number')} {p['mark']}",
                         metadata={"filename": fname})
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{fname}"'})


@router.get("/jobs/{jid}/panels/shop-drawings.pdf")
async def job_shop_drawings(jid: str, request: Request, ids: Optional[str] = Query(None, description="Comma-separated panel ids; all when omitted"),
                            user: dict = Depends(S.require_permission("jobs.view"))):
    import production_api as P
    job = await _job_or_404(jid)
    panels = await _list_panels(jid)
    if ids:
        wanted = {i.strip() for i in ids.split(",") if i.strip()}
        panels = [p for p in panels if p["id"] in wanted]
    if not panels:
        raise HTTPException(status_code=400, detail="No panels to export")
    pdf = await _render_pdf(job, panels, await _load_shop_settings(), await P._app_url(request))
    fname = f"shop_drawings_{S._safe_filename(job.get('job_number') or jid)}_{len(panels)}_panels.pdf"
    await S.record_audit(user, "shop_drawings_batch_exported", "job", jid, job.get("job_number") or jid,
                         metadata={"count": len(panels), "filename": fname})
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{fname}"'})


@router.post("/settings/shop-drawing/preview.pdf")
async def shop_settings_preview(payload: ShopDrawingSettings, _u: dict = Depends(S.require_permission("company.view"))):
    """Render a sample sheet with unsaved template settings."""
    outline = geo.rectangle(0, 0, 6000, 3200)
    openings =[geo.rectangle(900, 1000, 1500, 1200), geo.rectangle(3700, 900, 1200, 1500)]
    calc = geo.calculate(outline, openings, 150, 2500, 45)
    sample = {"id": "sample", "mark": "P01", "description": "Sample panel", "quantity": 1, "thickness_mm": 150,
              "concrete_grade": "40 MPa", "revision": "A", "finish": "Off-form",
              "outline": [list(p) for p in outline], "openings": [[list(p) for p in o] for o in openings],
              "calc": calc,
              "lifting": {"engineer_name": "Sample Engineer", "engineer_company": "Sample Consulting",
                          "reference": "SAMPLE-001", "design_date": S.now_utc().strftime("%Y-%m-%d"), "notes": "",
                          "lifters": [{"label": "L1", "type": "edge", "x_mm": 1500, "y_mm": 3200, "capacity_t": 5, "product": "Sample"},
                                      {"label": "L2", "type": "edge", "x_mm": 4500, "y_mm": 3200, "capacity_t": 5, "product": "Sample"}]}}
    job = {"job_number": "J-SAMPLE", "customer_id": None, "project_id": None}
    pdf = await _render_pdf(job, [_decorate(sample)], {**DEFAULT_SHOP_DRAWING, **payload.model_dump()})
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'inline; filename="shop_drawing_sample.pdf"'})


S.app.include_router(router)
