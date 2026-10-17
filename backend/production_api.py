"""Production tracking for precast panels.

Every panel mark on a Job (see panels_api.py) becomes one or more physical
*units* (P01-1, P01-2 …). Each unit moves through the yard on its own:

    planned → cast → stripped → in_yard → loaded → delivered → installed

and carries a QR code, a pour log, a yard location, an erection sequence
number, defects and photos. On top of that sit casting beds + a casting
schedule, yard management, truck loads with delivery dockets, and a
production dashboard.

Permissions (new "production" module, see server.py):
    production.view        see everything here
    production.edit        beds, schedule, yard locations, loads, erection order
    production.transition  change a unit's status (scan page, mark cast …)

Wired in at the bottom of server.py: `import production_api`.
"""
from __future__ import annotations

import re
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field

import panel_geometry as geo
import server as S

router = APIRouter(prefix="/api")

UNIT_STATUS_ORDER = ["planned", "cast", "stripped", "in_yard", "loaded", "delivered", "installed"]
UNIT_STATUS_LABEL = {
    "planned": "Planned", "cast": "Cast", "stripped": "Stripped", "in_yard": "In yard",
    "loaded": "Loaded", "delivered": "Delivered", "installed": "Installed", "rejected": "Rejected",
}
LOAD_STATUS_ORDER = ["planned", "loaded", "delivered"]
PHOTO_EXT = {"jpg", "jpeg", "png", "webp", "heic", "heif"}
PHOTO_DIR = S.UPLOAD_DIR / "units"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)
GAP_MM = 300.0  # working gap between panels on a bed when checking capacity


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class PourLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    supplier: str = Field("", max_length=120)
    docket_no: str = Field("", max_length=60)
    batch_no: str = Field("", max_length=60)
    concrete_grade: str = Field("", max_length=40)
    slump_mm: Optional[float] = Field(None, ge=0, le=400)
    cylinder_ids: str = Field("", max_length=200)
    poured_m3: Optional[float] = Field(None, ge=0)
    temperature_c: Optional[float] = None
    notes: str = Field("", max_length=1000)


class Transition(BaseModel):
    model_config = ConfigDict(extra="ignore")
    to: str
    note: str = Field("", max_length=1000)
    at: Optional[str] = None               # ISO datetime or YYYY-MM-DD; default now
    pour: Optional[PourLog] = None         # with to=cast
    yard_location: Optional[str] = Field(None, max_length=60)   # with to=in_yard


class Revert(BaseModel):
    note: str = Field(..., min_length=3, max_length=1000)


class Reject(BaseModel):
    reason: str = Field(..., min_length=3, max_length=1000)


class PlanInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    planned_cast_date: Optional[str] = None   # YYYY-MM-DD or null to unschedule
    bed_id: Optional[str] = None


class UnitPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    yard_location: Optional[str] = Field(None, max_length=60)
    erection_seq: Optional[int] = Field(None, ge=0, le=99999)
    notes: Optional[str] = Field(None, max_length=2000)


class ErectionOrder(BaseModel):
    items: List[Dict[str, Any]]   # [{unit_id, erection_seq}]


class DefectInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    description: str = Field(..., min_length=2, max_length=1000)
    severity: Literal["minor", "major", "reject"] = "minor"


class DefectPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    status: Optional[Literal["open", "repaired", "accepted"]] = None
    repair_notes: Optional[str] = Field(None, max_length=1000)


class BedInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(..., min_length=1, max_length=60)
    length_mm: float = Field(..., gt=0, le=200000)
    width_mm: float = Field(..., gt=0, le=20000)
    active: bool = True
    sort_order: int = 0
    notes: str = Field("", max_length=500)


class LoadInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    delivery_date: Optional[str] = None
    vehicle_id: Optional[str] = None
    driver: str = Field("", max_length=120)
    site_contact: str = Field("", max_length=200)
    delivery_address: str = Field("", max_length=300)
    notes: str = Field("", max_length=2000)
    unit_ids: Optional[List[str]] = None


class LoadTransition(BaseModel):
    to: Literal["loaded", "delivered"]
    at: Optional[str] = None
    note: str = Field("", max_length=1000)


class ProductionSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    app_url: str = Field("", max_length=300)
    label_layout: Literal["a4_8", "a4_2"] = "a4_8"
    yard_locations: List[str] = Field(default_factory=list, max_length=500)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _now() -> str:
    return S.now_iso()


def _parse_when(at: Optional[str]) -> str:
    if not at:
        return _now()
    s = at.strip()
    try:
        if len(s) == 10:
            d = date.fromisoformat(s)
            now = S.now_utc()
            if d == now.date():
                return now.isoformat()          # "today" keeps the real time of day
            return datetime(d.year, d.month, d.day, 12, 0, tzinfo=timezone.utc).isoformat()
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD or an ISO date-time")


def _valid_day(s: Optional[str]) -> Optional[str]:
    if s in (None, ""):
        return None
    try:
        return date.fromisoformat(str(s)[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD")


def _label(mark: str, unit_no: int, quantity: int) -> str:
    return mark if quantity <= 1 else f"{mark}-{unit_no}"


def _dims(panel: dict) -> Dict[str, Any]:
    c = panel.get("calc") or {}
    return {
        "width_mm": c.get("width_mm"), "height_mm": c.get("height_mm"),
        "thickness_mm": panel.get("thickness_mm"), "weight_kg": c.get("total_weight_kg"),
        "volume_m3": c.get("volume_m3"), "net_area_m2": c.get("net_area_m2"),
    }


def _sort_key(u: dict):
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r"(\d+)", u.get("label") or "")]


async def _unit_or_404(uid: str) -> dict:
    u = await S.db.panel_units.find_one({"id": uid, "deleted_at": None}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="Panel unit not found")
    return u


async def _job_editable(job_id: str) -> dict:
    job = await S.db.jobs.find_one({"id": job_id}, {"_id": 0})
    if not job or job.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Cancelled jobs cannot be modified")
    return job


def _next_status(cur: str) -> Optional[str]:
    if cur not in UNIT_STATUS_ORDER:
        return None
    i = UNIT_STATUS_ORDER.index(cur)
    return UNIT_STATUS_ORDER[i + 1] if i + 1 < len(UNIT_STATUS_ORDER) else None


def _decorate(u: dict) -> dict:
    u["status_label"] = UNIT_STATUS_LABEL.get(u.get("status"), u.get("status"))
    u["next_status"] = _next_status(u.get("status"))
    u["open_defects"] = sum(1 for d in (u.get("defects") or []) if d.get("status") == "open")
    return u


# ---------------------------------------------------------------------------
# Unit sync — called by panels_api whenever a panel is created / changed / deleted
# ---------------------------------------------------------------------------
async def sync_units_for_panel(panel: dict) -> List[dict]:
    """Make the unit list match the panel's quantity and details. Never deletes a
    unit that has progressed past 'planned' (raises instead)."""
    qty = max(1, int(panel.get("quantity") or 1))
    existing = await S.db.panel_units.find({"panel_id": panel["id"], "deleted_at": None}, {"_id": 0}).to_list(2000)
    existing.sort(key=lambda u: u.get("unit_no", 0))
    if len(existing) > qty:
        extras = existing[qty:]
        if any(u.get("status") != "planned" for u in extras):
            raise HTTPException(status_code=400, detail=(
                f"Can't reduce quantity to {qty}: units beyond that number have already been cast. "
                "Reject or revert them first."))
        await S.db.panel_units.update_many({"id": {"$in": [u["id"] for u in extras]}},
                                           {"$set": {"deleted_at": _now()}})
        existing = existing[:qty]
    dims = _dims(panel)
    now = _now()
    for u in existing:
        upd = {"mark": panel["mark"], "label": _label(panel["mark"], u["unit_no"], qty),
               "job_number": panel.get("job_number"), "dims": dims, "updated_at": now}
        await S.db.panel_units.update_one({"id": u["id"]}, {"$set": upd})
    new_docs = []
    for n in range(len(existing) + 1, qty + 1):
        new_docs.append({
            "id": str(uuid.uuid4()), "qr_token": secrets.token_urlsafe(12),
            "job_id": panel["job_id"], "job_number": panel.get("job_number"),
            "panel_id": panel["id"], "mark": panel["mark"], "unit_no": n,
            "label": _label(panel["mark"], n, qty), "dims": dims,
            "status": "planned", "status_history": [],
            "planned_cast_date": None, "bed_id": None,
            "cast_at": None, "stripped_at": None, "in_yard_at": None, "loaded_at": None,
            "delivered_at": None, "installed_at": None,
            "pour": None, "yard_location": "", "load_id": None, "erection_seq": None,
            "defects": [], "photos": [], "notes": "",
            "created_at": now, "updated_at": now, "deleted_at": None,
        })
    if new_docs:
        await S.db.panel_units.insert_many([dict(d) for d in new_docs])
    return existing + new_docs


async def delete_units_for_panel(panel_id: str, force: bool = False):
    units = await S.db.panel_units.find({"panel_id": panel_id, "deleted_at": None}, {"_id": 0, "status": 1}).to_list(2000)
    if not force and any(u.get("status") not in ("planned", "rejected") for u in units):
        raise HTTPException(status_code=400, detail="This panel has units that are already cast. Reject them first, or keep the panel.")
    await S.db.panel_units.update_many({"panel_id": panel_id, "deleted_at": None}, {"$set": {"deleted_at": _now()}})


async def units_summary_for_panels(panel_ids: List[str]) -> Dict[str, Dict[str, int]]:
    """{panel_id: {status: count}} for the Job page."""
    out: Dict[str, Dict[str, int]] = {}
    async for u in S.db.panel_units.find({"panel_id": {"$in": panel_ids}, "deleted_at": None},
                                         {"_id": 0, "panel_id": 1, "status": 1}):
        out.setdefault(u["panel_id"], {})
        out[u["panel_id"]][u["status"]] = out[u["panel_id"]].get(u["status"], 0) + 1
    return out


# ---------------------------------------------------------------------------
# Units — read
# ---------------------------------------------------------------------------
async def _enrich_units(units: List[dict]) -> List[dict]:
    bed_ids = {u.get("bed_id") for u in units if u.get("bed_id")}
    load_ids = {u.get("load_id") for u in units if u.get("load_id")}
    beds = {b["id"]: b for b in await S.db.beds.find({"id": {"$in": list(bed_ids)}}, {"_id": 0}).to_list(500)} if bed_ids else {}
    loads = {l["id"]: l for l in await S.db.loads.find({"id": {"$in": list(load_ids)}}, {"_id": 0, "id": 1, "docket_number": 1, "delivery_date": 1, "status": 1}).to_list(500)} if load_ids else {}
    for u in units:
        u["bed_name"] = (beds.get(u.get("bed_id")) or {}).get("name")
        l = loads.get(u.get("load_id"))
        u["load"] = {"id": l["id"], "docket_number": l.get("docket_number"), "delivery_date": l.get("delivery_date"), "status": l.get("status")} if l else None
        _decorate(u)
    return units


@router.get("/panels/{pid}/units")
async def list_panel_units(pid: str, _u: dict = Depends(S.require_permission("jobs.view"))):
    panel = await S.db.panels.find_one({"id": pid, "deleted_at": None}, {"_id": 0})
    if not panel:
        raise HTTPException(status_code=404, detail="Panel not found")
    units = await S.db.panel_units.find({"panel_id": pid, "deleted_at": None}, {"_id": 0}).to_list(2000)
    if not units:
        units = await sync_units_for_panel(panel)
    units.sort(key=lambda u: u.get("unit_no", 0))
    return {"items": await _enrich_units(units)}


@router.get("/jobs/{jid}/units")
async def list_job_units(jid: str, _u: dict = Depends(S.require_permission("jobs.view"))):
    units = await S.db.panel_units.find({"job_id": jid, "deleted_at": None}, {"_id": 0}).to_list(5000)
    units.sort(key=_sort_key)
    counts: Dict[str, int] = {}
    for u in units:
        counts[u["status"]] = counts.get(u["status"], 0) + 1
    return {"items": await _enrich_units(units), "counts": counts, "total": len(units)}


@router.get("/units/{uid}")
async def get_unit(uid: str, _u: dict = Depends(S.require_permission("jobs.view"))):
    u = await _unit_or_404(uid)
    return await _unit_detail(u)


async def _unit_detail(u: dict) -> dict:
    (await _enrich_units([u]))
    panel = await S.db.panels.find_one({"id": u["panel_id"]}, {"_id": 0, "description": 1, "concrete_grade": 1, "finish": 1, "lifting": 1, "revision": 1, "quantity": 1})
    job = await S.db.jobs.find_one({"id": u["job_id"]}, {"_id": 0, "job_number": 1, "customer_id": 1, "project_id": 1, "status": 1})
    customer = await S.db.customers.find_one({"id": (job or {}).get("customer_id")}, {"_id": 0, "company_name": 1}) if job else None
    project = await S.db.projects.find_one({"id": (job or {}).get("project_id")}, {"_id": 0, "project_name": 1}) if job and job.get("project_id") else None
    cache: Dict[str, Any] = {}
    for h in u.get("status_history") or []:
        h["by_user"] = await S._resolve_user_lite(h.get("by_user_id"), cache)
    u["panel"] = panel or {}
    u["panel"]["lifting_status"] = "recorded" if (panel or {}).get("lifting", {}) and (panel or {}).get("lifting", {}).get("lifters") else "missing"
    u["job"] = {**(job or {}), "customer_name": (customer or {}).get("company_name", ""), "project_name": (project or {}).get("project_name", "")}
    for p in u.get("photos") or []:
        p["url"] = f"/api/production/photos/{p['id']}"
    return u


@router.get("/scan/{token}")
async def scan_unit(token: str, _u: dict = Depends(S.require_permission("jobs.view"))):
    u = await S.db.panel_units.find_one({"qr_token": token, "deleted_at": None}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="No panel matches this QR code")
    return await _unit_detail(u)


# ---------------------------------------------------------------------------
# Units — status changes
# ---------------------------------------------------------------------------
async def _apply_transition(u: dict, to: str, user: dict, note: str = "", at: Optional[str] = None,
                            extra: Optional[dict] = None, source: str = "manual") -> dict:
    cur = u["status"]
    if cur == "rejected":
        raise HTTPException(status_code=400, detail="This unit was rejected. Revert the rejection first.")
    if to not in UNIT_STATUS_ORDER:
        raise HTTPException(status_code=400, detail="Unknown status")
    if UNIT_STATUS_ORDER.index(to) <= UNIT_STATUS_ORDER.index(cur):
        raise HTTPException(status_code=400, detail=f"Unit is already '{UNIT_STATUS_LABEL[cur]}'. Use 'Undo last step' to go back.")
    when = _parse_when(at)
    upd: Dict[str, Any] = {"status": to, "updated_at": _now(), f"{to}_at": when}
    if extra:
        upd.update(extra)
    entry = {"from": cur, "to": to, "at": when, "by_user_id": user.get("id"), "note": note or "", "source": source}
    skipped = UNIT_STATUS_ORDER[UNIT_STATUS_ORDER.index(cur) + 1: UNIT_STATUS_ORDER.index(to)]
    if skipped:
        entry["skipped"] = skipped
    await S.db.panel_units.update_one({"id": u["id"]}, {"$set": upd, "$push": {"status_history": entry}})
    await S.record_audit(user, "unit_status_changed", "panel_unit", u["id"], u.get("label") or u["id"],
                         changes={"status": {"from": cur, "to": to}}, metadata={"note": note, "source": source})
    return await _unit_or_404(u["id"])


@router.post("/units/{uid}/transition")
async def transition_unit(uid: str, payload: Transition, user: dict = Depends(S.require_permission("production.transition"))):
    u = await _unit_or_404(uid)
    await _job_editable(u["job_id"])
    extra: Dict[str, Any] = {}
    if payload.to == "cast" and payload.pour is not None:
        extra["pour"] = payload.pour.model_dump()
    if payload.to == "in_yard":
        loc = (payload.yard_location if payload.yard_location is not None else u.get("yard_location") or "").strip()
        extra["yard_location"] = loc
    if payload.to in ("loaded", "delivered") and u.get("load_id"):
        pass  # load-driven transitions keep the load; manual ones just record the status
    nu = await _apply_transition(u, payload.to, user, payload.note, payload.at, extra)
    return await _unit_detail(nu)


@router.post("/units/{uid}/revert")
async def revert_unit(uid: str, payload: Revert, user: dict = Depends(S.require_permission("production.transition"))):
    """Undo the last status step (e.g. marked cast by mistake)."""
    u = await _unit_or_404(uid)
    await _job_editable(u["job_id"])
    hist = u.get("status_history") or []
    if not hist:
        raise HTTPException(status_code=400, detail="Nothing to undo")
    last = hist[-1]
    prev = last.get("from") or "planned"
    upd = {"status": prev, "updated_at": _now()}
    if u["status"] in UNIT_STATUS_ORDER:
        upd[f"{u['status']}_at"] = None
    if u["status"] == "cast":
        upd["pour"] = None
    if u["status"] == "rejected":
        upd["rejected_reason"] = None
    await S.db.panel_units.update_one({"id": uid}, {
        "$set": upd,
        "$push": {"status_history": {"from": u["status"], "to": prev, "at": _now(), "by_user_id": user.get("id"),
                                     "note": payload.note, "source": "revert"}}})
    await S.record_audit(user, "unit_status_reverted", "panel_unit", uid, u.get("label") or uid,
                         changes={"status": {"from": u["status"], "to": prev}}, metadata={"note": payload.note})
    return await _unit_detail(await _unit_or_404(uid))


@router.post("/units/{uid}/reject")
async def reject_unit(uid: str, payload: Reject, user: dict = Depends(S.require_permission("production.transition"))):
    u = await _unit_or_404(uid)
    await _job_editable(u["job_id"])
    if u["status"] in ("delivered", "installed"):
        raise HTTPException(status_code=400, detail="Delivered or installed units can't be rejected here — record a defect instead")
    if u.get("load_id"):
        await S.db.loads.update_one({"id": u["load_id"]}, {"$pull": {"unit_ids": uid}})
    await S.db.panel_units.update_one({"id": uid}, {
        "$set": {"status": "rejected", "rejected_at": _now(), "rejected_reason": payload.reason, "load_id": None, "updated_at": _now()},
        "$push": {"status_history": {"from": u["status"], "to": "rejected", "at": _now(), "by_user_id": user.get("id"),
                                     "note": payload.reason, "source": "reject"}}})
    await S.record_audit(user, "unit_rejected", "panel_unit", uid, u.get("label") or uid, metadata={"reason": payload.reason})
    return await _unit_detail(await _unit_or_404(uid))


@router.patch("/units/{uid}")
async def patch_unit(uid: str, payload: UnitPatch, user: dict = Depends(S.require_permission("production.edit"))):
    u = await _unit_or_404(uid)
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if "yard_location" in upd and upd["yard_location"] is not None:
        upd["yard_location"] = upd["yard_location"].strip()
    upd["updated_at"] = _now()
    await S.db.panel_units.update_one({"id": uid}, {"$set": upd})
    return await _unit_detail(await _unit_or_404(uid))


@router.patch("/units/{uid}/plan")
async def plan_unit(uid: str, payload: PlanInput, user: dict = Depends(S.require_permission("production.edit"))):
    u = await _unit_or_404(uid)
    await _job_editable(u["job_id"])
    if u["status"] != "planned":
        raise HTTPException(status_code=400, detail=f"{u['label']} is already {UNIT_STATUS_LABEL[u['status']].lower()} — the casting schedule only covers planned units")
    upd: Dict[str, Any] = {"updated_at": _now()}
    if "planned_cast_date" in payload.model_fields_set:
        upd["planned_cast_date"] = _valid_day(payload.planned_cast_date)
    if "bed_id" in payload.model_fields_set:
        if payload.bed_id:
            if not await S.db.beds.find_one({"id": payload.bed_id, "deleted_at": None}, {"_id": 1}):
                raise HTTPException(status_code=400, detail="Unknown casting bed")
        upd["bed_id"] = payload.bed_id or None
    await S.db.panel_units.update_one({"id": uid}, {"$set": upd})
    return await _unit_detail(await _unit_or_404(uid))


@router.post("/jobs/{jid}/erection-order")
async def set_erection_order(jid: str, payload: ErectionOrder, user: dict = Depends(S.require_permission("production.edit"))):
    await _job_editable(jid)
    n = 0
    for it in payload.items:
        uid = it.get("unit_id"); seq = it.get("erection_seq")
        if not uid:
            continue
        try:
            seq = None if seq in (None, "") else int(seq)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Erection sequence must be a whole number")
        r = await S.db.panel_units.update_one({"id": uid, "job_id": jid, "deleted_at": None},
                                              {"$set": {"erection_seq": seq, "updated_at": _now()}})
        n += r.modified_count
    await S.record_audit(user, "erection_order_set", "job", jid, jid, metadata={"updated": n})
    return {"updated": n}


# ---------------------------------------------------------------------------
# Defects + photos
# ---------------------------------------------------------------------------
@router.post("/units/{uid}/defects", status_code=201)
async def add_defect(uid: str, payload: DefectInput, user: dict = Depends(S.require_permission("production.transition"))):
    u = await _unit_or_404(uid)
    d = {"id": str(uuid.uuid4()), "description": payload.description.strip(), "severity": payload.severity,
         "status": "open", "created_at": _now(), "by_user_id": user.get("id"), "by_name": user.get("name") or user.get("email"),
         "repaired_at": None, "repair_notes": ""}
    await S.db.panel_units.update_one({"id": uid}, {"$push": {"defects": d}, "$set": {"updated_at": _now()}})
    await S.record_audit(user, "unit_defect_added", "panel_unit", uid, u.get("label") or uid, metadata={"severity": payload.severity})
    return await _unit_detail(await _unit_or_404(uid))


@router.patch("/units/{uid}/defects/{did}")
async def patch_defect(uid: str, did: str, payload: DefectPatch, user: dict = Depends(S.require_permission("production.transition"))):
    u = await _unit_or_404(uid)
    defects = u.get("defects") or []
    for d in defects:
        if d["id"] == did:
            if payload.status is not None:
                d["status"] = payload.status
                if payload.status == "repaired":
                    d["repaired_at"] = _now(); d["repaired_by"] = user.get("name") or user.get("email")
            if payload.repair_notes is not None:
                d["repair_notes"] = payload.repair_notes
            break
    else:
        raise HTTPException(status_code=404, detail="Defect not found")
    await S.db.panel_units.update_one({"id": uid}, {"$set": {"defects": defects, "updated_at": _now()}})
    return await _unit_detail(await _unit_or_404(uid))


@router.post("/units/{uid}/photos", status_code=201)
async def upload_unit_photo(uid: str, file: UploadFile = File(...), caption: str = Form(""),
                            user: dict = Depends(S.require_permission("production.transition"))):
    u = await _unit_or_404(uid)
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in PHOTO_EXT:
        raise HTTPException(status_code=400, detail="Please upload a JPG, PNG or WEBP photo")
    content = await file.read()
    if len(content) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Photo is larger than 12 MB")
    pid = str(uuid.uuid4())
    (PHOTO_DIR / f"{pid}.{ext}").write_bytes(content)
    meta = {"id": pid, "ext": ext, "filename": file.filename, "caption": caption[:200], "at": _now(),
            "by_user_id": user.get("id"), "by_name": user.get("name") or user.get("email"), "status_at_time": u["status"]}
    await S.db.panel_units.update_one({"id": uid}, {"$push": {"photos": meta}, "$set": {"updated_at": _now()}})
    return await _unit_detail(await _unit_or_404(uid))


@router.get("/production/photos/{pid}")
async def get_unit_photo(pid: str):
    """Photos are addressed by an unguessable id so <img> tags can load them."""
    if not re.fullmatch(r"[0-9a-f-]{36}", pid):
        raise HTTPException(status_code=404, detail="Not found")
    u = await S.db.panel_units.find_one({"photos.id": pid}, {"_id": 0, "photos": 1})
    p = next((x for x in (u or {}).get("photos") or [] if x.get("id") == pid), None)
    if not p:
        raise HTTPException(status_code=404, detail="Photo not found")
    path = PHOTO_DIR / f"{pid}.{p['ext']}"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Photo file missing")
    from fastapi.responses import FileResponse
    return FileResponse(str(path))


# ---------------------------------------------------------------------------
# Beds + settings
# ---------------------------------------------------------------------------
@router.get("/production/beds")
async def list_beds(_u: dict = Depends(S.require_permission("production.view")), include_inactive: bool = False):
    q: Dict[str, Any] = {"deleted_at": None}
    if not include_inactive:
        q["active"] = True
    beds = await S.db.beds.find(q, {"_id": 0}).to_list(200)
    beds.sort(key=lambda b: (b.get("sort_order", 0), b.get("name", "")))
    return {"items": beds}


@router.post("/production/beds", status_code=201)
async def create_bed(payload: BedInput, user: dict = Depends(S.require_permission("production.edit"))):
    doc = {**payload.model_dump(), "id": str(uuid.uuid4()), "created_at": _now(), "updated_at": _now(), "deleted_at": None}
    await S.db.beds.insert_one(dict(doc))
    await S.record_audit(user, "bed_created", "bed", doc["id"], doc["name"])
    return doc


@router.patch("/production/beds/{bid}")
async def update_bed(bid: str, payload: BedInput, user: dict = Depends(S.require_permission("production.edit"))):
    if not await S.db.beds.find_one({"id": bid, "deleted_at": None}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Bed not found")
    await S.db.beds.update_one({"id": bid}, {"$set": {**payload.model_dump(), "updated_at": _now()}})
    return await S.db.beds.find_one({"id": bid}, {"_id": 0})


@router.delete("/production/beds/{bid}")
async def delete_bed(bid: str, user: dict = Depends(S.require_permission("production.edit"))):
    b = await S.db.beds.find_one({"id": bid, "deleted_at": None}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Bed not found")
    await S.db.beds.update_one({"id": bid}, {"$set": {"deleted_at": _now(), "active": False}})
    await S.db.panel_units.update_many({"bed_id": bid, "status": "planned"}, {"$set": {"bed_id": None}})
    await S.record_audit(user, "bed_deleted", "bed", bid, b.get("name", bid))
    return {"ok": True}


async def _load_prod_settings() -> dict:
    doc = await S.db.settings.find_one({"key": "production"}, {"_id": 0, "key": 0}) or {}
    return {"app_url": doc.get("app_url") or "", "label_layout": doc.get("label_layout") or "a4_8",
            "yard_locations": doc.get("yard_locations") or []}


@router.get("/settings/production")
async def get_prod_settings(_u: dict = Depends(S.require_permission("production.view"))):
    return await _load_prod_settings()


@router.put("/settings/production")
async def put_prod_settings(payload: ProductionSettings, user: dict = Depends(S.require_permission("company.edit"))):
    new = payload.model_dump()
    new["app_url"] = new["app_url"].strip().rstrip("/")
    new["yard_locations"] = [s.strip() for s in new["yard_locations"] if s and s.strip()][:500]
    await S.db.settings.update_one({"key": "production"}, {"$set": {**new, "updated_at": _now()}}, upsert=True)
    await S.record_audit(user, "settings_changed", "company_settings", "production", "Production settings")
    return await _load_prod_settings()


# ---------------------------------------------------------------------------
# Casting schedule
# ---------------------------------------------------------------------------
@router.get("/production/schedule")
async def get_schedule(date_from: str = Query(..., alias="from"), date_to: str = Query(..., alias="to"),
                       _u: dict = Depends(S.require_permission("production.view"))):
    f, t = _valid_day(date_from), _valid_day(date_to)
    if not f or not t or t < f:
        raise HTTPException(status_code=400, detail="Give a valid from/to date range")
    beds = (await list_beds(_u, include_inactive=False))["items"]
    scheduled = await S.db.panel_units.find(
        {"deleted_at": None, "planned_cast_date": {"$gte": f, "$lte": t},
         "status": {"$in": ["planned", "cast", "stripped", "in_yard", "loaded", "delivered", "installed"]}},
        {"_id": 0}).to_list(5000)
    # units cast in the range without a planned date still belong on the board
    cast_in_range = await S.db.panel_units.find(
        {"deleted_at": None, "planned_cast_date": None, "cast_at": {"$gte": f, "$lte": t + "T23:59:59"}}, {"_id": 0}).to_list(5000)
    for u in cast_in_range:
        u["planned_cast_date"] = u["cast_at"][:10]
        u["_unplanned_cast"] = True
    items = await _enrich_units(scheduled + cast_in_range)
    # unscheduled: planned units with no date, on live jobs
    live_jobs = {j["id"]: j for j in await S.db.jobs.find({"deleted_at": None, "status": {"$nin": ["cancelled", "completed"]}},
                                                          {"_id": 0, "id": 1, "job_number": 1, "scheduled_production_date": 1, "customer_id": 1}).to_list(2000)}
    unscheduled = await S.db.panel_units.find({"deleted_at": None, "status": "planned", "planned_cast_date": None,
                                               "job_id": {"$in": list(live_jobs)}}, {"_id": 0}).to_list(5000)
    unscheduled.sort(key=lambda u: (u.get("job_number") or "", _sort_key(u)))
    overdue = await S.db.panel_units.find({"deleted_at": None, "status": "planned", "planned_cast_date": {"$lt": f},
                                           "job_id": {"$in": list(live_jobs)}}, {"_id": 0}).to_list(5000)
    # capacity per bed per day
    usage: Dict[str, Dict[str, float]] = {}
    for u in items:
        if u.get("bed_id") and u.get("planned_cast_date"):
            w = float((u.get("dims") or {}).get("width_mm") or 0) + GAP_MM
            usage.setdefault(u["bed_id"], {})
            usage[u["bed_id"]][u["planned_cast_date"]] = usage[u["bed_id"]].get(u["planned_cast_date"], 0) + w
    return {"from": f, "to": t, "beds": beds, "items": items,
            "unscheduled": await _enrich_units(unscheduled), "overdue": await _enrich_units(overdue),
            "usage_mm": usage, "gap_mm": GAP_MM}


# ---------------------------------------------------------------------------
# Yard
# ---------------------------------------------------------------------------
@router.get("/production/yard")
async def get_yard(search: Optional[str] = None, _u: dict = Depends(S.require_permission("production.view"))):
    q: Dict[str, Any] = {"deleted_at": None, "status": {"$in": ["stripped", "in_yard", "loaded"]}}
    units = await S.db.panel_units.find(q, {"_id": 0}).to_list(10000)
    if search:
        s = search.strip().lower()
        units = [u for u in units if s in (u.get("label") or "").lower() or s in (u.get("job_number") or "").lower()
                 or s in (u.get("yard_location") or "").lower()]
    units = await _enrich_units(units)
    job_ids = {u["job_id"] for u in units}
    jobs = {j["id"]: j for j in await S.db.jobs.find({"id": {"$in": list(job_ids)}}, {"_id": 0, "id": 1, "job_number": 1, "customer_id": 1, "project_id": 1}).to_list(2000)}
    projects = {p["id"]: p for p in await S.db.projects.find({"id": {"$in": [j.get("project_id") for j in jobs.values() if j.get("project_id")]}}, {"_id": 0, "id": 1, "project_name": 1}).to_list(2000)}
    now = S.now_utc()
    for u in units:
        j = jobs.get(u["job_id"]) or {}
        u["project_name"] = (projects.get(j.get("project_id")) or {}).get("project_name", "")
        since = u.get("in_yard_at") or u.get("stripped_at") or u.get("cast_at")
        try:
            u["days_in_yard"] = (now - datetime.fromisoformat(since)).days if since else None
        except ValueError:
            u["days_in_yard"] = None
    units.sort(key=lambda u: ((u.get("yard_location") or "~"), u.get("job_number") or "", _sort_key(u)))
    locations: Dict[str, int] = {}
    for u in units:
        if u["status"] == "in_yard":
            locations[u.get("yard_location") or ""] = locations.get(u.get("yard_location") or "", 0) + 1
    settings = await _load_prod_settings()
    return {"items": units, "locations": locations, "known_locations": settings["yard_locations"],
            "total_in_yard": sum(1 for u in units if u["status"] == "in_yard"),
            "total_weight_kg": round(sum(float((u.get("dims") or {}).get("weight_kg") or 0) for u in units if u["status"] == "in_yard"), 1)}


# ---------------------------------------------------------------------------
# Loads (deliveries)
# ---------------------------------------------------------------------------
async def _load_or_404(lid: str) -> dict:
    l = await S.db.loads.find_one({"id": lid, "deleted_at": None}, {"_id": 0})
    if not l:
        raise HTTPException(status_code=404, detail="Load not found")
    return l


async def _load_detail(l: dict) -> dict:
    units = await S.db.panel_units.find({"id": {"$in": l.get("unit_ids") or []}, "deleted_at": None}, {"_id": 0}).to_list(2000)
    order = {uid: i for i, uid in enumerate(l.get("unit_ids") or [])}
    units.sort(key=lambda u: order.get(u["id"], 9999))
    units = await _enrich_units(units)
    total = sum(float((u.get("dims") or {}).get("weight_kg") or 0) for u in units)
    vehicle = await S.db.vehicles.find_one({"id": l.get("vehicle_id")}, {"_id": 0}) if l.get("vehicle_id") else None
    cap = float((vehicle or {}).get("capacity_tonnes") or 0) * 1000
    job = await S.db.jobs.find_one({"id": l["job_id"]}, {"_id": 0, "job_number": 1, "customer_id": 1, "project_id": 1})
    customer = await S.db.customers.find_one({"id": (job or {}).get("customer_id")}, {"_id": 0}) if job else None
    project = await S.db.projects.find_one({"id": (job or {}).get("project_id")}, {"_id": 0}) if job and job.get("project_id") else None
    l["units"] = units
    l["unit_count"] = len(units)
    l["total_weight_kg"] = round(total, 1)
    l["vehicle"] = vehicle
    l["capacity_kg"] = cap or None
    l["over_capacity"] = bool(cap and total > cap)
    l["customer_name"] = (customer or {}).get("company_name", "")
    l["project_name"] = (project or {}).get("project_name", "")
    l["site_address"] = l.get("delivery_address") or _site_address(customer, project)
    return l


def _site_address(customer: Optional[dict], project: Optional[dict]) -> str:
    for src in (project or {}, customer or {}):
        for key in ("site_address", "address"):
            a = src.get(key)
            if isinstance(a, dict):
                parts = [a.get("street"), a.get("suburb"), a.get("state"), a.get("postcode")]
                s = " ".join(str(p) for p in parts if p)
                if s.strip():
                    return s
            elif isinstance(a, str) and a.strip():
                return a
    return ""


@router.get("/production/loads")
async def list_loads(job_id: Optional[str] = None, status: Optional[str] = None, upcoming_days: Optional[int] = None,
                     _u: dict = Depends(S.require_permission("production.view"))):
    q: Dict[str, Any] = {"deleted_at": None}
    if job_id:
        q["job_id"] = job_id
    if status:
        q["status"] = status
    if upcoming_days is not None:
        today = date.today().isoformat()
        q["$or"] = [{"delivery_date": {"$gte": today, "$lte": (date.today() + timedelta(days=upcoming_days)).isoformat()}},
                    {"status": {"$ne": "delivered"}}]
    loads = await S.db.loads.find(q, {"_id": 0}).to_list(2000)
    loads.sort(key=lambda l: (l.get("delivery_date") or "9999", l.get("docket_number") or ""))
    out = []
    for l in loads:
        units = await S.db.panel_units.find({"id": {"$in": l.get("unit_ids") or []}, "deleted_at": None}, {"_id": 0, "dims": 1, "label": 1}).to_list(2000)
        l["unit_count"] = len(units)
        l["total_weight_kg"] = round(sum(float((u.get("dims") or {}).get("weight_kg") or 0) for u in units), 1)
        l["unit_labels"] = [u["label"] for u in units][:12]
        out.append(l)
    return {"items": out}


@router.post("/jobs/{jid}/loads", status_code=201)
async def create_load(jid: str, payload: LoadInput, user: dict = Depends(S.require_permission("production.edit"))):
    job = await _job_editable(jid)
    n = await S.db.loads.count_documents({"job_id": jid}) + 1
    doc = {"id": str(uuid.uuid4()), "job_id": jid, "job_number": job.get("job_number"),
           "load_no": n, "docket_number": f"{job.get('job_number')}-L{n:02d}",
           "delivery_date": _valid_day(payload.delivery_date), "vehicle_id": payload.vehicle_id or None,
           "driver": payload.driver.strip(), "site_contact": payload.site_contact.strip(),
           "delivery_address": payload.delivery_address.strip(), "notes": payload.notes.strip(),
           "unit_ids": [], "status": "planned", "status_history": [], "loaded_at": None, "delivered_at": None,
           "created_at": _now(), "created_by": user.get("id"), "updated_at": _now(), "deleted_at": None}
    await S.db.loads.insert_one(dict(doc))
    if payload.unit_ids:
        await _set_load_units(doc, payload.unit_ids)
        doc = await _load_or_404(doc["id"])
    await S.record_audit(user, "load_created", "load", doc["id"], doc["docket_number"], metadata={"job_id": jid})
    return await _load_detail(doc)


async def _set_load_units(load: dict, unit_ids: List[str]):
    if load.get("status") != "planned":
        raise HTTPException(status_code=400, detail="Only planned loads can be changed")
    ids = list(dict.fromkeys(unit_ids))
    units = await S.db.panel_units.find({"id": {"$in": ids}, "deleted_at": None}, {"_id": 0}).to_list(2000)
    found = {u["id"]: u for u in units}
    for uid in ids:
        u = found.get(uid)
        if not u:
            raise HTTPException(status_code=400, detail="One of the panels no longer exists")
        if u["job_id"] != load["job_id"]:
            raise HTTPException(status_code=400, detail=f"{u['label']} belongs to another job")
        if u.get("load_id") and u["load_id"] != load["id"]:
            raise HTTPException(status_code=409, detail=f"{u['label']} is already on another load")
        if u["status"] in ("loaded", "delivered", "installed", "rejected"):
            raise HTTPException(status_code=400, detail=f"{u['label']} is {UNIT_STATUS_LABEL[u['status']].lower()} and can't be added")
    old = set(load.get("unit_ids") or [])
    new = set(ids)
    if old - new:
        await S.db.panel_units.update_many({"id": {"$in": list(old - new)}}, {"$set": {"load_id": None, "updated_at": _now()}})
    if new:
        await S.db.panel_units.update_many({"id": {"$in": list(new)}}, {"$set": {"load_id": load["id"], "updated_at": _now()}})
    await S.db.loads.update_one({"id": load["id"]}, {"$set": {"unit_ids": ids, "updated_at": _now()}})


@router.get("/loads/{lid}")
async def get_load(lid: str, _u: dict = Depends(S.require_permission("production.view"))):
    l = await _load_or_404(lid)
    cache: Dict[str, Any] = {}
    for h in l.get("status_history") or []:
        h["by_user"] = await S._resolve_user_lite(h.get("by_user_id"), cache)
    return await _load_detail(l)


@router.get("/jobs/{jid}/loadable-units")
async def loadable_units(jid: str, _u: dict = Depends(S.require_permission("production.view"))):
    """Units that could go on a load: stripped or in the yard, not on another load."""
    units = await S.db.panel_units.find({"job_id": jid, "deleted_at": None, "load_id": None,
                                         "status": {"$in": ["cast", "stripped", "in_yard"]}}, {"_id": 0}).to_list(5000)
    units.sort(key=lambda u: (-(u.get("erection_seq") or 0) if u.get("erection_seq") else 0, _sort_key(u)))
    return {"items": await _enrich_units(units)}


@router.patch("/loads/{lid}")
async def update_load(lid: str, payload: LoadInput, user: dict = Depends(S.require_permission("production.edit"))):
    l = await _load_or_404(lid)
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if k != "unit_ids"}
    if "delivery_date" in upd:
        upd["delivery_date"] = _valid_day(upd["delivery_date"])
    if "vehicle_id" in upd:
        upd["vehicle_id"] = upd["vehicle_id"] or None
    for k in ("driver", "site_contact", "delivery_address", "notes"):
        if k in upd and upd[k] is not None:
            upd[k] = upd[k].strip()
    if upd:
        upd["updated_at"] = _now()
        await S.db.loads.update_one({"id": lid}, {"$set": upd})
    if payload.unit_ids is not None:
        await _set_load_units(l, payload.unit_ids)
    return await _load_detail(await _load_or_404(lid))


@router.post("/loads/{lid}/transition")
async def transition_load(lid: str, payload: LoadTransition, user: dict = Depends(S.require_permission("production.transition"))):
    l = await _load_or_404(lid)
    cur = l["status"]
    if LOAD_STATUS_ORDER.index(payload.to) <= LOAD_STATUS_ORDER.index(cur):
        raise HTTPException(status_code=400, detail=f"Load is already {cur}")
    if not l.get("unit_ids"):
        raise HTTPException(status_code=400, detail="Add panels to the load first")
    when = _parse_when(payload.at)
    units = await S.db.panel_units.find({"id": {"$in": l["unit_ids"]}, "deleted_at": None}, {"_id": 0}).to_list(2000)
    for u in units:
        if u["status"] == "rejected":
            raise HTTPException(status_code=400, detail=f"{u['label']} was rejected — remove it from the load")
        if UNIT_STATUS_ORDER.index(payload.to) > UNIT_STATUS_ORDER.index(u["status"]):
            await _apply_transition(u, payload.to, user, f"Load {l['docket_number']}", when, source="load")
    await S.db.loads.update_one({"id": lid}, {
        "$set": {"status": payload.to, f"{payload.to}_at": when, "updated_at": _now()},
        "$push": {"status_history": {"from": cur, "to": payload.to, "at": when, "by_user_id": user.get("id"), "note": payload.note}}})
    await S.record_audit(user, "load_status_changed", "load", lid, l["docket_number"], changes={"status": {"from": cur, "to": payload.to}})
    return await get_load(lid, user)


@router.delete("/loads/{lid}")
async def delete_load(lid: str, user: dict = Depends(S.require_permission("production.edit"))):
    l = await _load_or_404(lid)
    if l["status"] != "planned":
        raise HTTPException(status_code=400, detail="Only planned loads can be deleted")
    await S.db.panel_units.update_many({"load_id": lid}, {"$set": {"load_id": None}})
    await S.db.loads.update_one({"id": lid}, {"$set": {"deleted_at": _now()}})
    await S.record_audit(user, "load_deleted", "load", lid, l["docket_number"])
    return {"ok": True}


# ---------------------------------------------------------------------------
# QR labels + delivery docket PDFs
# ---------------------------------------------------------------------------
def _qr_svg(url: str, scale: int = 4) -> str:
    import segno
    return segno.make(url, error="m").svg_inline(scale=scale, dark="#1F2A33", border=1)


async def _app_url(request: Request) -> str:
    s = await _load_prod_settings()
    if s["app_url"]:
        return s["app_url"]
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


async def _labels_pdf(units: List[dict], base_url: str, layout: str) -> bytes:
    from weasyprint import HTML
    company = await S._load_company_settings()
    job_ids = {u["job_id"] for u in units}
    jobs = {j["id"]: j for j in await S.db.jobs.find({"id": {"$in": list(job_ids)}}, {"_id": 0, "id": 1, "job_number": 1, "project_id": 1, "customer_id": 1}).to_list(2000)}
    projects = {p["id"]: p for p in await S.db.projects.find({"id": {"$in": [j.get("project_id") for j in jobs.values() if j.get("project_id")]}}, {"_id": 0, "id": 1, "project_name": 1}).to_list(2000)}
    customers = {c["id"]: c for c in await S.db.customers.find({"id": {"$in": [j.get("customer_id") for j in jobs.values()]}}, {"_id": 0, "id": 1, "company_name": 1}).to_list(2000)}
    panels = {p["id"]: p for p in await S.db.panels.find({"id": {"$in": list({u["panel_id"] for u in units})}}, {"_id": 0, "id": 1, "description": 1, "thickness_mm": 1, "concrete_grade": 1}).to_list(5000)}
    labels = []
    for u in units:
        j = jobs.get(u["job_id"]) or {}
        d = u.get("dims") or {}
        labels.append({
            "unit": u, "qr": _qr_svg(f"{base_url}/scan/{u['qr_token']}", scale=3),
            "job_number": j.get("job_number", ""), "project": (projects.get(j.get("project_id")) or {}).get("project_name", ""),
            "customer": (customers.get(j.get("customer_id")) or {}).get("company_name", ""),
            "description": (panels.get(u["panel_id"]) or {}).get("description", ""),
            "size": f"{geo._fmt(float(d.get('width_mm') or 0))} × {geo._fmt(float(d.get('height_mm') or 0))} × {geo._fmt(float(d.get('thickness_mm') or 0))}",
            "mass": f"{float(d.get('weight_kg') or 0)/1000:.2f} t",
            "cast": (u.get("cast_at") or "")[:10],
        })
    html = S._get_jinja_env().get_template("panel_labels.html").render(labels=labels, company=company, layout=layout,
                                                                      generated_at=S._fmt_generated_at())
    return HTML(string=html, base_url=str(S.ROOT_DIR)).write_pdf()


@router.get("/jobs/{jid}/units/labels.pdf")
async def job_labels_pdf(jid: str, request: Request, ids: Optional[str] = None, layout: Optional[str] = None,
                         user: dict = Depends(S.require_permission("jobs.view"))):
    job = await S.db.jobs.find_one({"id": jid, "deleted_at": None}, {"_id": 0, "job_number": 1})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    units = await S.db.panel_units.find({"job_id": jid, "deleted_at": None, "status": {"$ne": "rejected"}}, {"_id": 0}).to_list(5000)
    if ids:
        wanted = {i.strip() for i in ids.split(",") if i.strip()}
        units = [u for u in units if u["id"] in wanted or u["panel_id"] in wanted]
    units.sort(key=_sort_key)
    if not units:
        raise HTTPException(status_code=400, detail="No panels to label")
    settings = await _load_prod_settings()
    pdf = await _labels_pdf(units, await _app_url(request), layout or settings["label_layout"])
    fname = f"qr_labels_{S._safe_filename(job.get('job_number') or jid)}.pdf"
    await S.record_audit(user, "qr_labels_exported", "job", jid, job.get("job_number") or jid, metadata={"count": len(units)})
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{fname}"'})


@router.get("/units/{uid}/qr.svg")
async def unit_qr_svg(uid: str, request: Request, _u: dict = Depends(S.require_permission("jobs.view"))):
    u = await _unit_or_404(uid)
    svg = _qr_svg(f"{await _app_url(request)}/scan/{u['qr_token']}", scale=6)
    return Response(content=svg, media_type="image/svg+xml")


@router.get("/loads/{lid}/docket.pdf")
async def load_docket_pdf(lid: str, user: dict = Depends(S.require_permission("production.view"))):
    from weasyprint import HTML
    l = await _load_detail(await _load_or_404(lid))
    company = await S._load_company_settings()
    for u in l["units"]:
        d = u.get("dims") or {}
        u["size"] = f"{geo._fmt(float(d.get('width_mm') or 0))} × {geo._fmt(float(d.get('height_mm') or 0))} × {geo._fmt(float(d.get('thickness_mm') or 0))}"
        u["mass_t"] = f"{float(d.get('weight_kg') or 0)/1000:.2f}"
    html = S._get_jinja_env().get_template("delivery_docket.html").render(load=l, company=company, generated_at=S._fmt_generated_at())
    pdf = HTML(string=html, base_url=str(S.ROOT_DIR)).write_pdf()
    fname = f"delivery_docket_{S._safe_filename(l['docket_number'])}.pdf"
    await S.record_audit(user, "delivery_docket_exported", "load", lid, l["docket_number"])
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{fname}"'})


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@router.get("/production/summary")
async def production_summary(_u: dict = Depends(S.require_permission("production.view"))):
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    month_start = today.replace(day=1)
    live_jobs = [j["id"] for j in await S.db.jobs.find({"deleted_at": None, "status": {"$nin": ["cancelled", "completed"]}}, {"_id": 0, "id": 1}).to_list(5000)]
    units = await S.db.panel_units.find({"deleted_at": None, "job_id": {"$in": live_jobs}}, {"_id": 0}).to_list(20000)
    counts = {s: 0 for s in UNIT_STATUS_ORDER + ["rejected"]}
    for u in units:
        counts[u["status"]] = counts.get(u["status"], 0) + 1

    def vol(u):
        return float((u.get("dims") or {}).get("volume_m3") or 0)

    def in_range(ts: Optional[str], a: date, b: date) -> bool:
        return bool(ts) and a.isoformat() <= ts[:10] <= b.isoformat()

    cast_week = [u for u in units if in_range(u.get("cast_at"), week_start, week_end)]
    cast_month = [u for u in units if in_range(u.get("cast_at"), month_start, today)]
    planned_week = [u for u in units if u.get("planned_cast_date") and week_start.isoformat() <= u["planned_cast_date"] <= week_end.isoformat()]
    overdue = [u for u in units if u["status"] == "planned" and u.get("planned_cast_date") and u["planned_cast_date"] < today.isoformat()]
    yard = [u for u in units if u["status"] == "in_yard"]
    loads = await S.db.loads.find({"deleted_at": None, "status": {"$ne": "delivered"}}, {"_id": 0}).to_list(2000)
    loads_week = [l for l in loads if l.get("delivery_date") and week_start.isoformat() <= l["delivery_date"] <= week_end.isoformat()]
    open_defects = sum(1 for u in units for d in (u.get("defects") or []) if d.get("status") == "open")
    # per-day cast volume for the last 14 days
    days = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        ds = d.isoformat()
        days.append({"date": ds, "cast": sum(1 for u in units if (u.get("cast_at") or "")[:10] == ds),
                     "m3": round(sum(vol(u) for u in units if (u.get("cast_at") or "")[:10] == ds), 2),
                     "planned": sum(1 for u in units if u.get("planned_cast_date") == ds and u["status"] == "planned")})
    return {
        "counts": counts, "total_units": len(units), "live_jobs": len(live_jobs),
        "cast_this_week": len(cast_week), "m3_this_week": round(sum(vol(u) for u in cast_week), 2),
        "cast_this_month": len(cast_month), "m3_this_month": round(sum(vol(u) for u in cast_month), 2),
        "planned_this_week": len(planned_week), "overdue_planned": len(overdue),
        "in_yard": len(yard), "yard_weight_t": round(sum(float((u.get("dims") or {}).get("weight_kg") or 0) for u in yard) / 1000, 1),
        "loads_open": len(loads), "loads_this_week": len(loads_week), "open_defects": open_defects,
        "days": days, "week_start": week_start.isoformat(), "week_end": week_end.isoformat(),
    }


S.app.include_router(router)
