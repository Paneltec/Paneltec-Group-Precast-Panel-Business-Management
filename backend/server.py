from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import uuid
import logging
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Literal, Any, Dict

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict, field_validator


# ---------------------------------------------------------------------------
# Config & DB
# ---------------------------------------------------------------------------
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = 'HS256'
JWT_EXPIRES_HOURS = int(os.environ.get('JWT_EXPIRES_HOURS', '12'))

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(
    title="Paneltec Group API",
    description="Precast Panel Business Management",
    version="3.0.0",
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)
api_router = APIRouter(prefix="/api")
bearer_scheme = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("paneltec")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_utc() -> datetime: return datetime.now(timezone.utc)
def now_iso() -> str: return now_utc().isoformat()
def hash_password(p: str) -> str: return bcrypt.hashpw(p.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
def verify_password(plain: str, hashed: str) -> bool:
    try: return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception: return False

def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "type": "access",
               "iat": now_utc(), "exp": now_utc() + timedelta(hours=JWT_EXPIRES_HOURS)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def user_to_public(u: dict) -> dict:
    return {
        "id": u["id"], "email": u["email"], "name": u.get("name", ""),
        "is_super_admin": bool(u.get("is_super_admin", False)),
        "permissions": u.get("permissions", {}) or {},
        "role_label": u.get("role_label", ""),
        "is_active": u.get("is_active", True),
        "must_change_password": bool(u.get("must_change_password", False)),
        "last_login_at": u.get("last_login_at"),
        "deleted_at": u.get("deleted_at"),
        "deleted_by_user_id": u.get("deleted_by_user_id"),
        "created_at": u.get("created_at"),
        "updated_at": u.get("updated_at"),
        # legacy compat
        "role": "admin" if u.get("is_super_admin") else "staff",
    }

def _round2(x: float) -> float: return round(x + 1e-9, 2)

AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"]

def normalise_abn(raw: Optional[str]) -> Optional[str]:
    if raw is None: return None
    digits = re.sub(r"\s+", "", str(raw))
    if not digits: return None
    if not re.fullmatch(r"\d{11}", digits):
        raise HTTPException(status_code=400, detail="ABN must be 11 digits (spaces allowed).")
    return digits


# ---------------------------------------------------------------------------
# Permission catalogue (Phase 5)
# ---------------------------------------------------------------------------
PERMISSION_MODULES = [
    {"key": "customers", "label": "Customers", "permissions": ["customers.view", "customers.create", "customers.edit", "customers.delete"]},
    {"key": "projects",  "label": "Projects",  "permissions": ["projects.view", "projects.create", "projects.edit", "projects.delete"]},
    {"key": "quotes",    "label": "Quotes",    "permissions": ["quotes.view", "quotes.create", "quotes.edit", "quotes.send", "quotes.mark_decision", "quotes.revise"]},
    {"key": "jobs",      "label": "Jobs",      "permissions": ["jobs.view", "jobs.edit", "jobs.transition", "jobs.cancel"]},
    {"key": "invoices",  "label": "Invoices",  "permissions": ["invoices.view", "invoices.create", "invoices.issue", "invoices.mark_paid", "invoices.push_xero"]},
    {"key": "vehicles",  "label": "Vehicles",  "permissions": ["vehicles.view"]},
    {"key": "employees", "label": "Employees", "permissions": ["employees.view"]},
    {"key": "pricing",   "label": "Pricing",   "permissions": ["pricing.view", "pricing.edit"]},
    {"key": "company",   "label": "Company",   "permissions": ["company.view", "company.edit"]},
    {"key": "integrations","label":"Integrations","permissions": ["integrations.view", "integrations.edit"]},
    {"key": "users",     "label": "Users",     "permissions": ["users.view", "users.manage"]},
]
ALL_PERMISSIONS: List[str] = [p for m in PERMISSION_MODULES for p in m["permissions"]]
# These permissions are reserved for super-admins. Non-super-admins cannot hold them.
ELEVATED_PERMISSIONS = {"users.manage", "integrations.edit", "pricing.edit", "company.edit"}

PERMISSION_PRESETS = {
    "estimator": {
        "label": "Estimator / Sales",
        "permissions": [
            "customers.view","customers.create","customers.edit","customers.delete",
            "projects.view","projects.create","projects.edit","projects.delete",
            "quotes.view","quotes.create","quotes.edit","quotes.send","quotes.mark_decision","quotes.revise",
            "jobs.view","invoices.view","vehicles.view","employees.view",
        ],
    },
    "production": {
        "label": "Production",
        "permissions": [
            "customers.view","projects.view","quotes.view",
            "jobs.view","jobs.edit","jobs.transition","jobs.cancel",
            "invoices.view","vehicles.view","employees.view",
        ],
    },
    "accounts": {
        "label": "Accounts",
        "permissions": [
            "customers.view","projects.view","quotes.view","jobs.view",
            "invoices.view","invoices.create","invoices.issue","invoices.mark_paid","invoices.push_xero",
            "company.view",
        ],
    },
    "readonly": {
        "label": "Read-only",
        "permissions": [p for p in ALL_PERMISSIONS if p.endswith(".view")],
    },
}


def normalise_permissions(perms: Optional[Dict[str, bool]]) -> Dict[str, bool]:
    """Strip unknown keys, coerce to bool, drop falsy entries."""
    if not perms: return {}
    out = {}
    for k in ALL_PERMISSIONS:
        if perms.get(k): out[k] = True
    return out


# ---------------------------------------------------------------------------
# Auth dependencies
# ---------------------------------------------------------------------------
async def _get_current_user_raw(request: Request, creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)) -> dict:
    token: Optional[str] = None
    if creds and creds.scheme.lower() == "bearer": token = creds.credentials
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "): token = auth[7:]
    if not token: raise HTTPException(status_code=401, detail="Not authenticated")
    try: payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError: raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError: raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "access": raise HTTPException(status_code=401, detail="Invalid token type")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user or not user.get("is_active", True) or user.get("deleted_at"):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user

async def get_current_user(user: dict = Depends(_get_current_user_raw)) -> dict:
    """Same as raw, but enforces must_change_password gate. Used by ALL business endpoints."""
    if user.get("must_change_password"):
        raise HTTPException(status_code=403, detail={"code": "password_change_required",
                                                      "message": "You must change your password before continuing."})
    return user

def has_permission(user: dict, perm: str) -> bool:
    if user.get("is_super_admin"): return True
    return bool((user.get("permissions") or {}).get(perm))

def require_permission(perm: str):
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        if not has_permission(user, perm):
            raise HTTPException(status_code=403, detail=f"Permission required: {perm}")
        return user
    _dep.__name__ = f"require_permission_{perm.replace('.', '_')}"
    return _dep

async def require_super_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Super admin access required")
    return user

# Legacy alias — maps to super admin (kept so any unmigrated reference still works).
require_admin = require_super_admin


# ---------------------------------------------------------------------------
# Models — Auth / Users
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    email: EmailStr; password: str
class LoginResponse(BaseModel):
    access_token: str; token_type: str = "bearer"; user: dict
class ChangePasswordRequest(BaseModel):
    current_password: str; new_password: str = Field(min_length=8)
class UserCreate(BaseModel):
    email: EmailStr; password: str = Field(min_length=8); name: str = Field(min_length=1)
    role_label: str = ""
    is_super_admin: bool = False
    permissions: Dict[str, bool] = Field(default_factory=dict)
    must_change_password: bool = True
    # legacy compat — if provided, "admin" → super admin + admin label
    role: Optional[Literal["admin", "staff"]] = None
class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = None
    role_label: Optional[str] = None
    is_super_admin: Optional[bool] = None
    permissions: Optional[Dict[str, bool]] = None
    is_active: Optional[bool] = None
    must_change_password: Optional[bool] = None
    email: Optional[EmailStr] = None
class UserSelfUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = Field(default=None, min_length=8)
class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8)
    must_change_password: bool = True


# ---------------------------------------------------------------------------
# Models — Pricing / Calculator
# ---------------------------------------------------------------------------
class PanelTypePricing(BaseModel):
    key: str; label: str; thickness_mm: int
    material_per_m2: float; manufacturing_per_m2: float; transport_install_per_m2: float
class ReinforcementDensities(BaseModel):
    light: float; standard: float; heavy: float; prestressed: float
class FinishMultiplier(BaseModel):
    key: str; label: str; multiplier: float
class PricingSettings(BaseModel):
    concrete_density: float = 2500.0; gst_rate: float = 10.0
    reinforcement_densities: ReinforcementDensities; panel_types: List[PanelTypePricing]
    thickness_options_mm: List[int]; concrete_grades: List[str]; finishes: List[FinishMultiplier]
class CalculateRequest(BaseModel):
    panel_type_key: str; length_m: float = Field(gt=0); height_m: float = Field(gt=0)
    thickness_mm: int = Field(gt=0); concrete_grade: str; quantity: int = Field(ge=1)
    reinforcement_type: Literal["light", "standard", "heavy", "prestressed"]
    openings_m2: float = Field(ge=0); finish_key: str


# ---------------------------------------------------------------------------
# Models — Address / Customer / Project / Quote
# ---------------------------------------------------------------------------
class Address(BaseModel):
    model_config = ConfigDict(extra="forbid")
    street: str = ""; suburb: str = ""; state: str = ""; postcode: str = ""
    @field_validator("state")
    @classmethod
    def _state_valid(cls, v: str) -> str:
        if v and v not in AU_STATES: raise ValueError(f"State must be one of: {', '.join(AU_STATES)}")
        return v
    @field_validator("postcode")
    @classmethod
    def _postcode_valid(cls, v: str) -> str:
        if v and not re.fullmatch(r"\d{4}", v): raise ValueError("Postcode must be 4 digits")
        return v

class CustomerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    company_name: str = Field(min_length=1); abn: Optional[str] = None
    contact_name: str = ""; contact_email: EmailStr; contact_phone: str = ""
    billing_address: Address = Field(default_factory=Address)
    site_address: Address = Field(default_factory=Address)
    site_same_as_billing: bool = True; account_terms: str = "30 days"; notes: str = ""

class CustomerUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    company_name: Optional[str] = None; abn: Optional[str] = None
    contact_name: Optional[str] = None; contact_email: Optional[EmailStr] = None; contact_phone: Optional[str] = None
    billing_address: Optional[Address] = None; site_address: Optional[Address] = None
    site_same_as_billing: Optional[bool] = None; account_terms: Optional[str] = None
    notes: Optional[str] = None; active: Optional[bool] = None

class ProjectCreate(BaseModel):
    customer_id: str; project_name: str = Field(min_length=1)
    site_address: Optional[Address] = None; description: str = ""
    status: Literal["planning","quoted","won","lost","completed"] = "planning"
class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_name: Optional[str] = None; site_address: Optional[Address] = None
    description: Optional[str] = None
    status: Optional[Literal["planning","quoted","won","lost","completed"]] = None

class QuoteCreate(BaseModel):
    customer_id: str; project_id: Optional[str] = None
    valid_until: Optional[str] = None; notes_to_customer: str = ""; internal_notes: str = ""
class QuoteUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    customer_id: Optional[str] = None; project_id: Optional[str] = None
    valid_until: Optional[str] = None; notes_to_customer: Optional[str] = None; internal_notes: Optional[str] = None
class QuoteLineInput(BaseModel):
    description: str = ""; panel_type_key: str
    length_m: float = Field(gt=0); height_m: float = Field(gt=0)
    thickness_mm: int = Field(gt=0); concrete_grade: str; quantity: int = Field(ge=1)
    reinforcement_type: Literal["light","standard","heavy","prestressed"]
    openings_m2: float = Field(ge=0); finish_key: str


# ---------------------------------------------------------------------------
# Models — Company Settings / Jobs / Invoices
# ---------------------------------------------------------------------------
class CompanySettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    business_name: str = "Paneltec Group Pty Ltd"
    abn: str = ""; acn: str = ""
    address_street: str = ""; address_suburb: str = ""; address_state: str = ""; address_postcode: str = ""
    phone: str = ""; email: str = ""; website: str = ""
    bank_name: str = ""; bsb: str = ""; account_number: str = ""; account_name: str = ""
    default_payment_terms_days: int = 30
    invoice_footer_note: str = "Thank you for your business"

    @field_validator("address_state")
    @classmethod
    def _state_valid(cls, v: str) -> str:
        if v and v not in AU_STATES: raise ValueError(f"State must be one of: {', '.join(AU_STATES)}")
        return v
    @field_validator("bsb")
    @classmethod
    def _bsb_valid(cls, v: str) -> str:
        if v and not re.fullmatch(r"\d{3}-?\d{3}", v): raise ValueError("BSB must be 6 digits (XXX-XXX or XXXXXX)")
        return v

JOB_STATUS_ORDER = ["scheduled","in_production","ready_for_delivery","delivered","installed","completed"]
JobStatus = Literal["scheduled","in_production","ready_for_delivery","delivered","installed","completed","cancelled"]

class JobUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scheduled_production_date: Optional[str] = None
    scheduled_delivery_date: Optional[str] = None
    assigned_vehicle_id: Optional[str] = None
    assigned_employee_ids: Optional[List[str]] = None
    production_notes: Optional[str] = None
    delivery_notes: Optional[str] = None

class JobTransition(BaseModel):
    to: Literal["in_production","ready_for_delivery","delivered","installed","completed","cancelled"]
    note: str = ""
class JobCancel(BaseModel):
    reason: str = Field(min_length=1)

class InvoiceCreate(BaseModel):
    job_id: str
class InvoiceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    notes_to_customer: Optional[str] = None
    internal_notes: Optional[str] = None
class InvoiceMarkPaid(BaseModel):
    paid_amount: float = Field(ge=0); payment_reference: str = ""; paid_at: Optional[str] = None

class EmailSentLog(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject: str = ""
    recipient: str = ""

class IntegrationM365(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: str = ""; client_id: str = ""; client_secret: str = ""
    sender_mailbox: str = ""; enabled: bool = False
class IntegrationSimpro(BaseModel):
    model_config = ConfigDict(extra="forbid")
    build_name: str = ""; client_id: str = ""; client_secret: str = ""
    api_base_url: str = ""; enabled: bool = False
class IntegrationNavixy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    api_key: str = ""; api_base_url: str = "https://api.navixy.com/v2"
    account_id: str = ""; enabled: bool = False
class IntegrationXero(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: str = ""; client_secret: str = ""; tenant_id: str = ""
    redirect_uri: str = ""; enabled: bool = False
class IntegrationSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    m365: IntegrationM365 = Field(default_factory=IntegrationM365)
    simpro: IntegrationSimpro = Field(default_factory=IntegrationSimpro)
    navixy: IntegrationNavixy = Field(default_factory=IntegrationNavixy)
    xero: IntegrationXero = Field(default_factory=IntegrationXero)

class SendQuoteOverride(BaseModel):
    """Optional overrides for the (mocked) email send."""
    recipient: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None


# ---------------------------------------------------------------------------
# Calculator core
# ---------------------------------------------------------------------------
REINFORCEMENT_LABELS = [
    {"key":"light","label":"Light (mesh)"}, {"key":"standard","label":"Standard (mesh + bars)"},
    {"key":"heavy","label":"Heavy (rebar cage)"}, {"key":"prestressed","label":"Prestressed tendons"},
]
def _reinforcement_label(key: str) -> str:
    return next((r["label"] for r in REINFORCEMENT_LABELS if r["key"] == key), key)

def compute_calculation(payload: CalculateRequest, pricing: Dict[str, Any]) -> Dict[str, Any]:
    panel = next((p for p in pricing["panel_types"] if p["key"] == payload.panel_type_key), None)
    if not panel: raise HTTPException(status_code=400, detail="Unknown panel type")
    finish = next((f for f in pricing["finishes"] if f["key"] == payload.finish_key), None)
    if not finish: raise HTTPException(status_code=400, detail="Unknown finish")
    if payload.thickness_mm not in pricing["thickness_options_mm"]:
        raise HTTPException(status_code=400, detail="Invalid thickness option")
    if payload.concrete_grade not in pricing["concrete_grades"]:
        raise HTTPException(status_code=400, detail="Invalid concrete grade")
    face_area = payload.length_m * payload.height_m
    if payload.openings_m2 >= face_area:
        raise HTTPException(status_code=400, detail="Openings area must be less than panel face area")
    net_area = face_area - payload.openings_m2
    thickness_m = payload.thickness_mm / 1000.0
    volume_per_panel = net_area * thickness_m
    rein_density = float(pricing["reinforcement_densities"][payload.reinforcement_type])
    concrete_density = float(pricing["concrete_density"])
    concrete_weight = volume_per_panel * concrete_density
    steel_weight = volume_per_panel * rein_density
    total_weight_per_panel = concrete_weight + steel_weight
    qty = payload.quantity
    total_volume = volume_per_panel * qty
    total_weight_kg = total_weight_per_panel * qty
    base_cost_m2 = float(panel["material_per_m2"]) + float(panel["manufacturing_per_m2"]) + float(panel["transport_install_per_m2"])
    multiplier = float(finish["multiplier"])
    cost_per_m2 = base_cost_m2 * multiplier
    subtotal_per_panel = net_area * cost_per_m2
    subtotal_all = subtotal_per_panel * qty
    material_cost = net_area * float(panel["material_per_m2"]) * qty
    manufacturing_cost = net_area * float(panel["manufacturing_per_m2"]) * qty
    transport_install_cost = net_area * float(panel["transport_install_per_m2"]) * qty
    finish_premium = subtotal_all - (material_cost + manufacturing_cost + transport_install_cost)
    gst_rate = float(pricing["gst_rate"]) / 100.0
    gst = subtotal_all * gst_rate
    total_inc_gst = subtotal_all + gst
    return {
        "inputs": payload.model_dump(), "panel_type": panel, "finish": finish,
        "per_panel": {
            "face_area_m2": _round2(face_area), "net_area_m2": _round2(net_area),
            "volume_m3": round(volume_per_panel, 4), "concrete_weight_kg": _round2(concrete_weight),
            "steel_weight_kg": _round2(steel_weight), "total_weight_kg": _round2(total_weight_per_panel),
        },
        "totals": {
            "quantity": qty, "total_volume_m3": round(total_volume, 4),
            "total_weight_kg": _round2(total_weight_kg), "total_weight_tonnes": round(total_weight_kg/1000.0, 3),
            "cost_per_m2": _round2(cost_per_m2), "base_cost_per_m2": _round2(base_cost_m2),
            "finish_multiplier": multiplier,
        },
        "cost_breakdown": {
            "material": _round2(material_cost), "manufacturing": _round2(manufacturing_cost),
            "transport_install": _round2(transport_install_cost), "finish_premium": _round2(finish_premium),
            "subtotal": _round2(subtotal_all), "gst_rate_pct": pricing["gst_rate"],
            "gst": _round2(gst), "total_inc_gst": _round2(total_inc_gst),
        },
    }

def build_quote_line(payload: QuoteLineInput, pricing: Dict[str, Any]) -> Dict[str, Any]:
    calc_req = CalculateRequest(**payload.model_dump(exclude={"description"}))
    result = compute_calculation(calc_req, pricing)
    return {
        "id": str(uuid.uuid4()), "description": payload.description.strip(),
        "panel_type_key": result["panel_type"]["key"], "panel_type_label": result["panel_type"]["label"],
        "length_m": payload.length_m, "height_m": payload.height_m, "thickness_mm": payload.thickness_mm,
        "concrete_grade": payload.concrete_grade, "quantity": payload.quantity,
        "openings_m2_per_panel": payload.openings_m2,
        "reinforcement_key": payload.reinforcement_type, "reinforcement_label": _reinforcement_label(payload.reinforcement_type),
        "finish_key": result["finish"]["key"], "finish_label": result["finish"]["label"],
        "face_area_m2": result["per_panel"]["face_area_m2"], "net_face_area_m2": result["per_panel"]["net_area_m2"],
        "volume_per_panel_m3": result["per_panel"]["volume_m3"],
        "concrete_weight_per_panel_kg": result["per_panel"]["concrete_weight_kg"],
        "steel_weight_per_panel_kg": result["per_panel"]["steel_weight_kg"],
        "total_weight_per_panel_kg": result["per_panel"]["total_weight_kg"],
        "total_volume_m3": result["totals"]["total_volume_m3"],
        "total_weight_kg": result["totals"]["total_weight_kg"],
        "cost_per_m2": result["totals"]["cost_per_m2"],
        "subtotal_aud": result["cost_breakdown"]["subtotal"],
        "gst_aud": result["cost_breakdown"]["gst"],
        "total_aud": result["cost_breakdown"]["total_inc_gst"],
        "gst_rate_pct": result["cost_breakdown"]["gst_rate_pct"],
    }

def recompute_totals(lines: List[Dict[str, Any]]) -> Dict[str, float]:
    return {
        "subtotal": _round2(sum(float(l["subtotal_aud"]) for l in lines)),
        "gst": _round2(sum(float(l["gst_aud"]) for l in lines)),
        "total": _round2(sum(float(l["total_aud"]) for l in lines)),
        "total_volume_m3": round(sum(float(l["total_volume_m3"]) for l in lines), 4),
        "total_weight_kg": _round2(sum(float(l["total_weight_kg"]) for l in lines)),
        "total_weight_tonnes": round(sum(float(l["total_weight_kg"]) for l in lines)/1000.0, 3),
    }


# ---------------------------------------------------------------------------
# Sequence counters
# ---------------------------------------------------------------------------
async def _next_seq(prefix: str) -> str:
    year = now_utc().year
    key = f"{prefix}_seq_{year}"
    doc = await db.counters.find_one_and_update(
        {"key": key}, {"$inc": {"value": 1}}, upsert=True, return_document=True)
    if doc is None: doc = await db.counters.find_one({"key": key})
    seq = int(doc["value"]) if doc and "value" in doc else 1
    return f"{prefix.upper()}-{year}-{seq:04d}"

async def next_quote_number() -> str: return await _next_seq("Q")
async def next_job_number() -> str: return await _next_seq("J")
async def next_invoice_number() -> str: return await _next_seq("INV")


# ---------------------------------------------------------------------------
# Defaults & mocked stubs
# ---------------------------------------------------------------------------
DEFAULT_PRICING = {
    "concrete_density": 2500.0, "gst_rate": 10.0,
    "reinforcement_densities": {"light":25.0,"standard":45.0,"heavy":70.0,"prestressed":100.0},
    "panel_types": [
        {"key":"wall_standard","label":"Wall Standard (150mm)","thickness_mm":150,
         "material_per_m2":97.0,"manufacturing_per_m2":112.0,"transport_install_per_m2":75.0},
        {"key":"wall_load_bearing","label":"Wall Load-Bearing (200mm)","thickness_mm":200,
         "material_per_m2":127.0,"manufacturing_per_m2":135.0,"transport_install_per_m2":92.0},
        {"key":"floor_slab","label":"Floor Slab (250mm)","thickness_mm":250,
         "material_per_m2":152.0,"manufacturing_per_m2":147.0,"transport_install_per_m2":105.0},
        {"key":"hollow_core","label":"Hollow Core (200mm)","thickness_mm":200,
         "material_per_m2":110.0,"manufacturing_per_m2":122.0,"transport_install_per_m2":85.0},
        {"key":"architectural_facade","label":"Architectural Facade","thickness_mm":150,
         "material_per_m2":185.0,"manufacturing_per_m2":230.0,"transport_install_per_m2":115.0},
        {"key":"prestressed","label":"Prestressed","thickness_mm":200,
         "material_per_m2":160.0,"manufacturing_per_m2":175.0,"transport_install_per_m2":110.0},
    ],
    "thickness_options_mm": [100, 150, 200, 250, 300],
    "concrete_grades": ["C25/30","C30/37","C35/45","C40/50","C50/60"],
    "finishes": [
        {"key":"smooth","label":"Smooth (Troweled)","multiplier":1.00},
        {"key":"exposed_aggregate","label":"Exposed Aggregate","multiplier":1.15},
        {"key":"acid_etched","label":"Acid-Etched","multiplier":1.20},
        {"key":"sandblasted","label":"Sandblasted","multiplier":1.18},
        {"key":"patterned","label":"Patterned/Embedded","multiplier":1.30},
    ],
}

DEFAULT_COMPANY = {
    "business_name": "Paneltec Group Pty Ltd",
    "abn": "00 000 000 000", "acn": "",
    "address_street": "Unit 4, Industrial Park",
    "address_suburb": "Smithfield", "address_state": "NSW", "address_postcode": "2164",
    "phone": "1300 PANELTEC", "email": "accounts@paneltec.com.au", "website": "www.paneltec.com.au",
    "bank_name": "", "bsb": "", "account_number": "", "account_name": "",
    "default_payment_terms_days": 30,
    "invoice_footer_note": "Thank you for your business. Please quote the invoice number on EFT payments.",
}

DEFAULT_INTEGRATIONS = {
    "m365": {"tenant_id":"","client_id":"","client_secret":"","sender_mailbox":"","enabled":False},
    "simpro": {"build_name":"","client_id":"","client_secret":"","api_base_url":"","enabled":False},
    "navixy": {"api_key":"","api_base_url":"https://api.navixy.com/v2","account_id":"","enabled":False},
    "xero": {"client_id":"","client_secret":"","tenant_id":"","redirect_uri":"","enabled":False},
}

SECRET_FIELDS = {
    "m365": {"client_secret"},
    "simpro": {"client_secret"},
    "navixy": {"api_key"},
    "xero": {"client_secret"},
}
MASK_PREFIX = "••••••••"

def _mask_secret(value: str) -> str:
    if not value: return ""
    tail = value[-4:] if len(value) >= 4 else value
    return f"{MASK_PREFIX}{tail}"

def _is_masked(value: str) -> bool:
    return isinstance(value, str) and value.startswith(MASK_PREFIX)

def _mask_integrations(doc: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for ikey, fields in SECRET_FIELDS.items():
        section = dict(doc.get(ikey, DEFAULT_INTEGRATIONS[ikey]))
        for f in fields:
            if section.get(f):
                section[f] = _mask_secret(section[f])
        out[ikey] = section
    # carry meta
    if "updated_at" in doc: out["updated_at"] = doc["updated_at"]
    return out

MOCK_VEHICLES = [
    {"id":"V-001","name":"Hino 700 Series","rego":"PT-001","capacity_tonnes":25,"status":"available","source":"MOCKED_NAVIXY"},
    {"id":"V-002","name":"Volvo FH16","rego":"PT-002","capacity_tonnes":30,"status":"on_delivery","source":"MOCKED_NAVIXY"},
    {"id":"V-003","name":"Kenworth T610","rego":"PT-003","capacity_tonnes":28,"status":"available","source":"MOCKED_NAVIXY"},
    {"id":"V-004","name":"Isuzu Giga","rego":"PT-004","capacity_tonnes":20,"status":"maintenance","source":"MOCKED_NAVIXY"},
    {"id":"V-005","name":"Mercedes Actros","rego":"PT-005","capacity_tonnes":32,"status":"available","source":"MOCKED_NAVIXY"},
]
MOCK_EMPLOYEES = [
    {"id":"E-001","name":"James Mitchell","role":"Foreman","department":"production","email":"james@paneltec.com.au","phone":"0411 111 111","active":True,"source":"MOCKED_SIMPRO"},
    {"id":"E-002","name":"Sarah Chen","role":"Production","department":"production","email":"sarah@paneltec.com.au","phone":"0411 222 222","active":True,"source":"MOCKED_SIMPRO"},
    {"id":"E-003","name":"David Nguyen","role":"Production","department":"production","email":"david@paneltec.com.au","phone":"0411 333 333","active":True,"source":"MOCKED_SIMPRO"},
    {"id":"E-004","name":"Mark O'Brien","role":"Driver","department":"transport","email":"mark@paneltec.com.au","phone":"0411 444 444","active":True,"source":"MOCKED_SIMPRO"},
    {"id":"E-005","name":"Tony Russo","role":"Driver","department":"transport","email":"tony@paneltec.com.au","phone":"0411 555 555","active":True,"source":"MOCKED_SIMPRO"},
    {"id":"E-006","name":"Liam Walsh","role":"Install Lead","department":"install","email":"liam@paneltec.com.au","phone":"0411 666 666","active":True,"source":"MOCKED_SIMPRO"},
]
_VEHICLE_IDS = {v["id"] for v in MOCK_VEHICLES}
_EMPLOYEE_IDS = {e["id"] for e in MOCK_EMPLOYEES}


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------
async def seed_database():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.customers.create_index("id", unique=True)
    await db.projects.create_index("id", unique=True)
    await db.quotes.create_index("id", unique=True)
    await db.quotes.create_index("quote_number", unique=True)
    await db.quotes.create_index("magic_link_token")
    await db.jobs.create_index("id", unique=True)
    await db.jobs.create_index("job_number", unique=True)
    await db.invoices.create_index("id", unique=True)
    await db.invoices.create_index("invoice_number", unique=True)
    await db.counters.create_index("key", unique=True)

    seed_users = [
        {"email": os.environ.get("SEED_ADMIN_EMAIL","admin@paneltec.com.au"),
         "password": os.environ.get("SEED_ADMIN_PASSWORD","Paneltec2026!"),
         "name": "Paneltec Admin", "is_super_admin": True, "role_label": "Administrator",
         "permissions": {}},
        {"email": os.environ.get("SEED_STAFF_EMAIL","staff@paneltec.com.au"),
         "password": os.environ.get("SEED_STAFF_PASSWORD","Staff2026!"),
         "name": "Paneltec Estimator", "is_super_admin": False, "role_label": "Estimator",
         "permissions": {p: True for p in PERMISSION_PRESETS["estimator"]["permissions"]}},
        {"email": os.environ.get("SEED_PROD_EMAIL","production@paneltec.com.au"),
         "password": os.environ.get("SEED_PROD_PASSWORD","Prod2026!"),
         "name": "Paneltec Production", "is_super_admin": False, "role_label": "Production",
         "permissions": {p: True for p in PERMISSION_PRESETS["production"]["permissions"]}},
    ]
    for s in seed_users:
        existing = await db.users.find_one({"email": s["email"]})
        if existing is None:
            await db.users.insert_one({
                "id": str(uuid.uuid4()), "email": s["email"],
                "password_hash": hash_password(s["password"]), "name": s["name"],
                "role": "admin" if s["is_super_admin"] else "staff",
                "is_super_admin": s["is_super_admin"],
                "role_label": s["role_label"],
                "permissions": s["permissions"],
                "must_change_password": False,
                "last_login_at": None,
                "is_active": True,
                "created_at": now_iso(), "updated_at": now_iso(),
                "created_by_user_id": "system", "updated_by_user_id": "system",
            })
            logger.info(f"Seeded user: {s['email']} ({s['role_label']})")
        else:
            # Phase 5 migration: backfill new fields on existing docs (idempotent).
            updates = {}
            if "is_super_admin" not in existing:
                updates["is_super_admin"] = (existing.get("role") == "admin")
            if "permissions" not in existing:
                updates["permissions"] = {} if updates.get("is_super_admin", existing.get("is_super_admin")) \
                    else {p: True for p in PERMISSION_PRESETS["estimator"]["permissions"]}
            if "role_label" not in existing:
                updates["role_label"] = "Administrator" if existing.get("role") == "admin" else "Estimator"
            if "must_change_password" not in existing:
                updates["must_change_password"] = False
            if "last_login_at" not in existing:
                updates["last_login_at"] = None
            # Re-align seeded users' permissions with the CURRENT preset (idempotent reset for seed accounts).
            updates["permissions"] = {} if s["is_super_admin"] else dict(s["permissions"])
            if updates:
                updates["updated_at"] = now_iso()
                await db.users.update_one({"id": existing["id"]}, {"$set": updates})
                logger.info(f"Migrated user {s['email']}: {list(updates.keys())}")
            # also keep seeded password aligned with env (so tests stay green)
            if not verify_password(s["password"], existing["password_hash"]):
                await db.users.update_one({"email": s["email"]},
                    {"$set": {"password_hash": hash_password(s["password"]), "is_active": True,
                              "must_change_password": False}})

    # Phase 5: migrate any OTHER existing users (e.g. created via the old UI) to the new schema.
    async for u in db.users.find({"$or": [{"is_super_admin": {"$exists": False}}, {"permissions": {"$exists": False}}]}, {"_id": 0}):
        updates = {}
        if "is_super_admin" not in u: updates["is_super_admin"] = (u.get("role") == "admin")
        if "permissions" not in u:
            updates["permissions"] = {} if updates.get("is_super_admin", u.get("is_super_admin")) \
                else {p: True for p in PERMISSION_PRESETS["estimator"]["permissions"]}
        if "role_label" not in u:
            updates["role_label"] = "Administrator" if updates.get("is_super_admin", u.get("is_super_admin")) else "Estimator"
        if "must_change_password" not in u: updates["must_change_password"] = False
        if "last_login_at" not in u: updates["last_login_at"] = None
        if updates:
            updates["updated_at"] = now_iso()
            await db.users.update_one({"id": u["id"]}, {"$set": updates})

    if await db.settings.find_one({"key": "pricing"}) is None:
        await db.settings.insert_one({"key":"pricing", **DEFAULT_PRICING, "updated_at": now_iso()})
        logger.info("Seeded pricing")
    if await db.settings.find_one({"key": "company"}) is None:
        await db.settings.insert_one({"key":"company", **DEFAULT_COMPANY, "updated_at": now_iso()})
        logger.info("Seeded company settings")
    if await db.settings.find_one({"key": "integrations"}) is None:
        await db.settings.insert_one({"key":"integrations", **DEFAULT_INTEGRATIONS, "updated_at": now_iso()})
        logger.info("Seeded integration settings (empty templates)")

    if await db.customers.count_documents({}) == 0:
        await _seed_phase2()

    # Phase 3 demo: auto-progress one accepted-flow if no jobs yet exist
    if await db.jobs.count_documents({}) == 0:
        await _seed_phase3_demo()


async def _seed_phase2():
    admin = await db.users.find_one({"role":"admin"}, {"_id":0, "id":1})
    admin_id = admin["id"] if admin else "system"
    customers_seed = [
        {"company_name":"Harbour Construction Pty Ltd","abn":"53004085616",
         "contact_name":"Sarah Mitchell","contact_email":"sarah@harbourconstruction.com.au",
         "contact_phone":"02 9555 1234",
         "billing_address":{"street":"Level 8, 45 Pyrmont St","suburb":"Pyrmont","state":"NSW","postcode":"2009"},
         "site_address":{"street":"Lot 12 Foreshore Dr","suburb":"Barangaroo","state":"NSW","postcode":"2000"},
         "site_same_as_billing":False,"account_terms":"30 days","notes":"Long-term partner."},
        {"company_name":"Western Precast Solutions","abn":"27123456789",
         "contact_name":"James Wilson","contact_email":"james@westernprecast.com.au","contact_phone":"08 9444 7700",
         "billing_address":{"street":"22 Kewdale Rd","suburb":"Welshpool","state":"WA","postcode":"6106"},
         "site_address":{"street":"22 Kewdale Rd","suburb":"Welshpool","state":"WA","postcode":"6106"},
         "site_same_as_billing":True,"account_terms":"14 days","notes":""},
        {"company_name":"Metro Build Group","abn":"78900112233",
         "contact_name":"Linh Nguyen","contact_email":"linh@metrobuild.com.au","contact_phone":"03 9620 3300",
         "billing_address":{"street":"188 Spencer St","suburb":"Docklands","state":"VIC","postcode":"3008"},
         "site_address":{"street":"188 Spencer St","suburb":"Docklands","state":"VIC","postcode":"3008"},
         "site_same_as_billing":True,"account_terms":"30 days","notes":"Tower retrofit programme."},
    ]
    cust_docs = [{"id":str(uuid.uuid4()),"active":True,"created_at":now_iso(),"updated_at":now_iso(),**c}
                 for c in customers_seed]
    await db.customers.insert_many(cust_docs)
    projects_seed = [
        {"customer_id":cust_docs[0]["id"],"project_name":"Barangaroo Tower B — Façade",
         "site_address":cust_docs[0]["site_address"],
         "description":"External architectural facade panels, levels 1-12.","status":"quoted"},
        {"customer_id":cust_docs[1]["id"],"project_name":"Welshpool Warehouse 4",
         "site_address":cust_docs[1]["site_address"],
         "description":"Tilt-up walls + hollow core mezzanine.","status":"planning"},
    ]
    proj_docs = [{"id":str(uuid.uuid4()),"created_at":now_iso(),"updated_at":now_iso(),**p} for p in projects_seed]
    await db.projects.insert_many(proj_docs)
    pricing = await db.settings.find_one({"key":"pricing"}, {"_id":0,"key":0})
    def _line(pk, l, h, t, g, q, r, o, f, d):
        return build_quote_line(QuoteLineInput(description=d, panel_type_key=pk, length_m=l, height_m=h,
            thickness_mm=t, concrete_grade=g, quantity=q, reinforcement_type=r, openings_m2=o, finish_key=f), pricing)
    draft_lines = [
        _line("wall_load_bearing",8,3.5,200,"C30/37",16,"heavy",0,"smooth","Tilt-up perimeter walls"),
        _line("hollow_core",7,1.2,200,"C30/37",24,"standard",0,"smooth","Mezzanine floor slabs"),
    ]
    dt = recompute_totals(draft_lines)
    draft_q = {"id":str(uuid.uuid4()),"quote_number":await next_quote_number(),
        "customer_id":cust_docs[1]["id"],"project_id":proj_docs[1]["id"],"status":"draft",
        "valid_until":(now_utc()+timedelta(days=30)).date().isoformat(),"line_items":draft_lines,
        "notes_to_customer":"Preliminary pricing for Welshpool Warehouse 4.","internal_notes":"Confirm crane access.",
        "subtotal":dt["subtotal"],"gst":dt["gst"],"total":dt["total"],
        "total_volume_m3":dt["total_volume_m3"],"total_weight_tonnes":dt["total_weight_tonnes"],
        "created_by":admin_id,"created_at":now_iso(),"updated_at":now_iso(),
        "sent_at":None,"accepted_at":None,"rejected_at":None,
        "magic_link_token":None,"magic_link_decision_at":None,"magic_link_decision_ip":None,
        "view_count":0,"first_viewed_at":None,"last_viewed_at":None,"last_viewed_by_ip":None,
        "revised_from_quote_id":None,"revised_to_quote_id":None,
        "last_send_attempt_at":None}
    sent_lines = [
        _line("architectural_facade",6,3.2,150,"C35/45",48,"standard",1.8,"exposed_aggregate","Levels 1-6 north elevation"),
        _line("architectural_facade",6,3.2,150,"C35/45",48,"standard",1.8,"exposed_aggregate","Levels 7-12 north elevation"),
        _line("wall_standard",5,3,150,"C30/37",24,"standard",0,"smooth","Internal core walls"),
    ]
    st = recompute_totals(sent_lines)
    sent_q = {"id":str(uuid.uuid4()),"quote_number":await next_quote_number(),
        "customer_id":cust_docs[0]["id"],"project_id":proj_docs[0]["id"],"status":"sent",
        "valid_until":(now_utc()+timedelta(days=30)).date().isoformat(),"line_items":sent_lines,
        "notes_to_customer":"Thanks for the opportunity. Pricing valid 30 days.",
        "internal_notes":"Customer asked about acid-etched alternative.",
        "subtotal":st["subtotal"],"gst":st["gst"],"total":st["total"],
        "total_volume_m3":st["total_volume_m3"],"total_weight_tonnes":st["total_weight_tonnes"],
        "created_by":admin_id,"created_at":now_iso(),"updated_at":now_iso(),
        "sent_at":now_iso(),"accepted_at":None,"rejected_at":None,
        "magic_link_token":str(uuid.uuid4()),"magic_link_decision_at":None,"magic_link_decision_ip":None,
        "view_count":0,"first_viewed_at":None,"last_viewed_at":None,"last_viewed_by_ip":None,
        "revised_from_quote_id":None,"revised_to_quote_id":None,
        "last_send_attempt_at":now_iso()}
    await db.quotes.insert_many([draft_q, sent_q])
    logger.info(f"Seeded Phase 2: 3 customers, 2 projects, 2 quotes")
    logger.info(f"Sample magic link: /q/{sent_q['magic_link_token']}")


async def _seed_phase3_demo():
    """Auto-progress one quote → accepted → job → delivered → issued invoice for demo."""
    sent_q = await db.quotes.find_one({"status":"sent"}, {"_id":0})
    if not sent_q: return
    admin = await db.users.find_one({"role":"admin"}, {"_id":0,"id":1})
    admin_id = admin["id"] if admin else "system"

    # 1. Accept the quote (creates job)
    await db.quotes.update_one({"id": sent_q["id"]},
        {"$set":{"status":"accepted","accepted_at":now_iso(),"updated_at":now_iso()}})
    job = await _create_job_from_quote(sent_q["id"], admin_id)
    if not job: return

    # 2. Progress job: scheduled → in_production → ready_for_delivery → delivered
    for tgt in ["in_production","ready_for_delivery","delivered"]:
        await _transition_job_internal(job["id"], tgt, "Seed: demo progression", admin_id)

    # 3. Generate invoice (issued)
    job_doc = await db.jobs.find_one({"id":job["id"]}, {"_id":0})
    inv = await _create_invoice_from_job(job_doc, admin_id)
    if inv:
        await db.invoices.update_one({"id":inv["id"]},
            {"$set":{"status":"issued","updated_at":now_iso()}})
        logger.info(f"Seeded Phase 3 demo: quote {sent_q['quote_number']} → job {job['job_number']} → invoice {inv['invoice_number']}")


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@api_router.post("/auth/login", response_model=LoginResponse)
async def auth_login(payload: LoginRequest):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email}, {"_id":0})
    if not user or user.get("deleted_at"):
        # generic 401 for missing or soft-deleted so we don't leak existence
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account deactivated. Contact administrator.")
    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": now_iso()}})
    user["last_login_at"] = now_iso()
    return LoginResponse(access_token=create_access_token(user["id"], user["email"]),
                         user=user_to_public(user))

@api_router.post("/auth/logout")
async def auth_logout(_user: dict = Depends(_get_current_user_raw)): return {"ok": True}

@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(_get_current_user_raw)): return user_to_public(user)

@api_router.post("/auth/change-password")
async def auth_change_password(payload: ChangePasswordRequest, user: dict = Depends(_get_current_user_raw)):
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    await db.users.update_one({"id":user["id"]},
        {"$set":{"password_hash":hash_password(payload.new_password),
                 "must_change_password": False, "updated_at": now_iso()}})
    return {"ok": True}

@api_router.get("/permissions/catalogue")
async def permissions_catalogue(_user: dict = Depends(_get_current_user_raw)):
    return {
        "modules": PERMISSION_MODULES,
        "all_permissions": ALL_PERMISSIONS,
        "elevated_permissions": sorted(ELEVATED_PERMISSIONS),
        "presets": [{"key": k, **v} for k, v in PERMISSION_PRESETS.items()],
    }


# ---------------------------------------------------------------------------
# Users (super admin only for create/update; users.view for list)
# ---------------------------------------------------------------------------
async def _count_active_super_admins(exclude_id: Optional[str] = None) -> int:
    q: Dict[str, Any] = {"is_super_admin": True, "is_active": True, "deleted_at": {"$in": [None]}}
    if exclude_id: q["id"] = {"$ne": exclude_id}
    return await db.users.count_documents(q)

async def _count_user_references(user_id: str) -> Dict[str, int]:
    """Count all historical references to user_id across the DB."""
    # Note: quotes/jobs/invoices use field name `created_by` (not `created_by_user_id`).
    return {
        "quotes_created":         await db.quotes.count_documents({"created_by": user_id}),
        "jobs_modified":          await db.jobs.count_documents({"status_history.by_user_id": user_id}),
        "invoices_created":       await db.invoices.count_documents({"created_by": user_id}),
        "customers_created":      await db.customers.count_documents({"$or":[{"created_by_user_id": user_id},{"updated_by_user_id": user_id}]}),
        "projects_created":       await db.projects.count_documents({"$or":[{"created_by_user_id": user_id},{"updated_by_user_id": user_id}]}),
        "user_records_referenced":await db.users.count_documents({"$or":[
            {"created_by_user_id": user_id, "id": {"$ne": user_id}},
            {"updated_by_user_id": user_id, "id": {"$ne": user_id}},
            {"deleted_by_user_id": user_id, "id": {"$ne": user_id}},
        ]}),
    }

def _validate_permissions_payload(perms: Dict[str, bool], is_super_admin: bool) -> Dict[str, bool]:
    clean = normalise_permissions(perms)
    if not is_super_admin:
        held_elevated = ELEVATED_PERMISSIONS.intersection({k for k, v in clean.items() if v})
        if held_elevated:
            raise HTTPException(status_code=400,
                detail=f"Elevated permissions are reserved for super admins: {', '.join(sorted(held_elevated))}")
    return clean

@api_router.get("/users")
async def list_users(_u: dict = Depends(require_permission("users.view")), status: str = Query("active")):
    q: Dict[str, Any] = {}
    s = (status or "active").lower()
    if s == "active":      q = {"is_active": True, "deleted_at": {"$in": [None]}}
    elif s == "inactive":  q = {"is_active": False, "deleted_at": {"$in": [None]}}
    elif s == "deleted":   q = {"deleted_at": {"$ne": None}}
    elif s == "all":       q = {}
    else: raise HTTPException(status_code=400, detail="status must be one of active|inactive|deleted|all")
    docs = await db.users.find(q, {"_id":0,"password_hash":0}).sort("created_at", -1).to_list(500)
    return docs

@api_router.get("/users/{user_id}/references")
async def get_user_references(user_id: str, _admin: dict = Depends(require_super_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id":0, "id":1, "email":1, "name":1})
    if not target: raise HTTPException(status_code=404, detail="User not found")
    refs = await _count_user_references(user_id)
    return {"user_id": user_id, "email": target["email"], "name": target["name"],
            "references": refs, "total": sum(refs.values())}

@api_router.patch("/users/me")
async def update_me(payload: UserSelfUpdate, user: dict = Depends(get_current_user)):
    updates: Dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip()
    if payload.new_password is not None:
        if not payload.current_password:
            raise HTTPException(status_code=400, detail="Current password is required to set a new password")
        if not verify_password(payload.current_password, user["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        updates["password_hash"] = hash_password(payload.new_password)
        updates["must_change_password"] = False
    if not updates: raise HTTPException(status_code=400, detail="No fields to update")
    updates["updated_at"] = now_iso()
    updates["updated_by_user_id"] = user["id"]
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id":0, "password_hash":0})
    return user_to_public(fresh)

@api_router.post("/users", status_code=201)
async def create_user(payload: UserCreate, admin: dict = Depends(require_super_admin)):
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="User with this email already exists")
    # Legacy "role" shim: if caller still sends role="admin", treat as super_admin.
    is_super = bool(payload.is_super_admin) or (payload.role == "admin")
    perms = _validate_permissions_payload(payload.permissions, is_super)
    role_label = payload.role_label.strip() or ("Administrator" if is_super else "Staff")
    doc = {
        "id": str(uuid.uuid4()), "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name.strip(),
        "role": "admin" if is_super else "staff",  # legacy field for one release
        "is_super_admin": is_super,
        "role_label": role_label,
        "permissions": perms,
        "must_change_password": bool(payload.must_change_password),
        "last_login_at": None,
        "is_active": True,
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by_user_id": admin["id"], "updated_by_user_id": admin["id"],
    }
    await db.users.insert_one(doc)
    return user_to_public(doc)

@api_router.patch("/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdate, admin: dict = Depends(require_super_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id":0})
    if not target: raise HTTPException(status_code=404, detail="User not found")

    updates: Dict[str, Any] = {}
    if payload.name is not None: updates["name"] = payload.name.strip()
    if payload.role_label is not None: updates["role_label"] = payload.role_label.strip()
    if payload.email is not None:
        new_email = payload.email.lower().strip()
        if new_email != target["email"] and await db.users.find_one({"email": new_email, "id": {"$ne": user_id}}):
            raise HTTPException(status_code=409, detail="Another user already uses this email")
        updates["email"] = new_email

    new_super = target.get("is_super_admin", False)
    if payload.is_super_admin is not None:
        new_super = payload.is_super_admin
        # last-admin safety: cannot demote the only active super admin
        if target.get("is_super_admin") and not new_super:
            if await _count_active_super_admins(exclude_id=user_id) == 0:
                raise HTTPException(status_code=400, detail="At least one active super admin is required")
        if user_id == admin["id"] and not new_super:
            raise HTTPException(status_code=400, detail="You cannot remove your own super admin flag")
        updates["is_super_admin"] = new_super
        # keep legacy "role" in sync
        updates["role"] = "admin" if new_super else "staff"

    if payload.permissions is not None:
        updates["permissions"] = _validate_permissions_payload(payload.permissions, new_super)

    if payload.must_change_password is not None:
        updates["must_change_password"] = bool(payload.must_change_password)

    if payload.is_active is not None:
        new_active = bool(payload.is_active)
        if user_id == admin["id"] and not new_active:
            raise HTTPException(status_code=400, detail="You cannot deactivate yourself")
        if target.get("is_super_admin") and not new_active:
            if await _count_active_super_admins(exclude_id=user_id) == 0:
                raise HTTPException(status_code=400, detail="At least one active super admin is required")
        updates["is_active"] = new_active

    if not updates: raise HTTPException(status_code=400, detail="No fields to update")
    updates["updated_at"] = now_iso()
    updates["updated_by_user_id"] = admin["id"]
    await db.users.update_one({"id": user_id}, {"$set": updates})
    fresh = await db.users.find_one({"id": user_id}, {"_id":0, "password_hash":0})
    return user_to_public(fresh)

@api_router.post("/users/{user_id}/reset-password")
async def reset_user_password(user_id: str, payload: ResetPasswordRequest,
                              admin: dict = Depends(require_super_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id":0, "id":1, "email":1})
    if not target: raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one({"id": user_id}, {"$set": {
        "password_hash": hash_password(payload.new_password),
        "must_change_password": bool(payload.must_change_password),
        "updated_at": now_iso(),
        "updated_by_user_id": admin["id"],
    }})
    return {"ok": True, "email": target["email"], "new_password": payload.new_password,
            "must_change_password": bool(payload.must_change_password)}

@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, permanent: bool = Query(False),
                       actor: dict = Depends(require_permission("users.manage"))):
    target = await db.users.find_one({"id": user_id}, {"_id":0})
    if not target: raise HTTPException(status_code=404, detail="User not found")

    # Safety: cannot delete yourself
    if user_id == actor["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete yourself")
    # Safety: only super admins can delete other super admins
    if target.get("is_super_admin") and not actor.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Only super admins can delete super admins")
    # Safety: only super admins can hard-delete (anyone)
    if permanent and not actor.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Only super admins can permanently delete users")
    # Safety: last active super admin
    if target.get("is_super_admin") and not target.get("deleted_at") and target.get("is_active", True):
        if await _count_active_super_admins(exclude_id=user_id) == 0:
            raise HTTPException(status_code=400, detail="At least one active super admin is required")

    if permanent:
        refs = await _count_user_references(user_id)
        if sum(refs.values()) > 0:
            raise HTTPException(status_code=400, detail={
                "message": "Cannot permanently delete — user has historical references",
                "references": refs,
                "suggestion": "Use soft delete instead",
            })
        await db.users.delete_one({"id": user_id})
        return {"permanently_deleted": True, "email": target["email"]}

    # Soft delete
    if target.get("deleted_at"):
        raise HTTPException(status_code=400, detail="User is already deleted")
    await db.users.update_one({"id": user_id}, {"$set": {
        "deleted_at": now_iso(),
        "deleted_by_user_id": actor["id"],
        "is_active": False,
        "updated_at": now_iso(),
        "updated_by_user_id": actor["id"],
    }})
    return {"soft_deleted": True, "email": target["email"]}

@api_router.post("/users/{user_id}/restore")
async def restore_user(user_id: str, actor: dict = Depends(require_permission("users.manage"))):
    target = await db.users.find_one({"id": user_id}, {"_id":0})
    if not target: raise HTTPException(status_code=404, detail="User not found")
    if not target.get("deleted_at"):
        raise HTTPException(status_code=400, detail="User is not deleted")
    if target.get("is_super_admin") and not actor.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Only super admins can restore super admins")
    # Ensure no email collision with an active user (very rare but possible if email was reused)
    collision = await db.users.find_one({"email": target["email"], "deleted_at": {"$in": [None]},
                                          "id": {"$ne": user_id}})
    if collision:
        raise HTTPException(status_code=409, detail="Another active user now uses that email")
    await db.users.update_one({"id": user_id}, {"$set": {
        "deleted_at": None, "deleted_by_user_id": None, "is_active": True,
        "updated_at": now_iso(), "updated_by_user_id": actor["id"],
    }})
    fresh = await db.users.find_one({"id": user_id}, {"_id":0, "password_hash":0})
    return user_to_public(fresh)


# ---------------------------------------------------------------------------
# Settings — Pricing (admin)
# ---------------------------------------------------------------------------
@api_router.get("/settings/pricing")
async def get_pricing(_u: dict = Depends(require_permission("pricing.view"))):
    doc = await db.settings.find_one({"key":"pricing"}, {"_id":0,"key":0})
    if not doc: raise HTTPException(status_code=404, detail="Pricing not initialized")
    return doc

@api_router.put("/settings/pricing")
async def update_pricing(payload: PricingSettings, _u: dict = Depends(require_permission("pricing.edit"))):
    data = payload.model_dump(); data["updated_at"] = now_iso()
    await db.settings.update_one({"key":"pricing"}, {"$set":data}, upsert=True)
    return await db.settings.find_one({"key":"pricing"}, {"_id":0,"key":0})


# ---------------------------------------------------------------------------
# Settings — Company (company.view to read, company.edit to update)
# ---------------------------------------------------------------------------
@api_router.get("/settings/company")
async def get_company(_u: dict = Depends(require_permission("company.view"))):
    doc = await db.settings.find_one({"key":"company"}, {"_id":0,"key":0})
    if not doc: raise HTTPException(status_code=404, detail="Company settings not initialized")
    return doc

@api_router.put("/settings/company")
async def update_company(payload: CompanySettings, _u: dict = Depends(require_permission("company.edit"))):
    data = payload.model_dump()
    if data.get("abn"): data["abn"] = normalise_abn(data["abn"])
    data["updated_at"] = now_iso()
    await db.settings.update_one({"key":"company"}, {"$set":data}, upsert=True)
    return await db.settings.find_one({"key":"company"}, {"_id":0,"key":0})


# ---------------------------------------------------------------------------
# Calculator endpoints
# ---------------------------------------------------------------------------
@api_router.get("/calculator/options")
async def calculator_options(_user: dict = Depends(get_current_user)):
    pricing = await db.settings.find_one({"key":"pricing"}, {"_id":0,"key":0})
    if not pricing: raise HTTPException(status_code=500, detail="Pricing not initialized")
    return {
        "panel_types":[{"key":p["key"],"label":p["label"],"thickness_mm":p["thickness_mm"]} for p in pricing["panel_types"]],
        "thickness_options_mm": pricing["thickness_options_mm"],
        "concrete_grades": pricing["concrete_grades"],
        "finishes":[{"key":f["key"],"label":f["label"]} for f in pricing["finishes"]],
        "reinforcement_types": REINFORCEMENT_LABELS,
    }

@api_router.post("/calculator/calculate")
async def calculator_calculate(payload: CalculateRequest, _user: dict = Depends(get_current_user)):
    pricing = await db.settings.find_one({"key":"pricing"}, {"_id":0,"key":0})
    if not pricing: raise HTTPException(status_code=500, detail="Pricing not initialized")
    return compute_calculation(payload, pricing)


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------
@api_router.get("/customers")
async def list_customers(_user: dict = Depends(require_permission("customers.view")), search: Optional[str] = Query(None),
                          active: str = Query("true"), page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200)):
    query: Dict[str, Any] = {}
    al = (active or "").lower()
    if al == "true": query["active"] = True
    elif al == "false": query["active"] = False
    elif al == "all": pass
    else: raise HTTPException(status_code=400, detail="active must be 'true', 'false', or 'all'")
    if search:
        rx = re.compile(re.escape(search), re.IGNORECASE)
        query["$or"] = [{"company_name":rx},{"contact_name":rx},{"abn":rx},{"contact_email":rx}]
    total = await db.customers.count_documents(query)
    items = await db.customers.find(query, {"_id":0}).sort("created_at",-1).skip((page-1)*page_size).limit(page_size).to_list(page_size)
    return {"items":items,"total":total,"page":page,"page_size":page_size}

@api_router.post("/customers", status_code=201)
async def create_customer(payload: CustomerCreate, _user: dict = Depends(require_permission("customers.create"))):
    data = payload.model_dump()
    data["abn"] = normalise_abn(data.get("abn"))
    if data["site_same_as_billing"]: data["site_address"] = data["billing_address"]
    doc = {"id":str(uuid.uuid4()),"active":True,"created_at":now_iso(),"updated_at":now_iso(),**data}
    await db.customers.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.get("/customers/{cid}")
async def get_customer(cid: str, _user: dict = Depends(require_permission("customers.view"))):
    doc = await db.customers.find_one({"id":cid}, {"_id":0})
    if not doc: raise HTTPException(status_code=404, detail="Customer not found")
    return doc

@api_router.patch("/customers/{cid}")
async def update_customer(cid: str, payload: CustomerUpdate, _user: dict = Depends(require_permission("customers.edit"))):
    updates = {k:v for k,v in payload.model_dump(exclude_unset=True).items()}
    if "abn" in updates: updates["abn"] = normalise_abn(updates["abn"])
    if updates.get("site_same_as_billing"):
        billing = updates.get("billing_address")
        if billing is None:
            existing = await db.customers.find_one({"id":cid}, {"_id":0,"billing_address":1})
            if existing: billing = existing.get("billing_address")
        if billing: updates["site_address"] = billing
    updates["updated_at"] = now_iso()
    r = await db.customers.update_one({"id":cid}, {"$set":updates})
    if r.matched_count == 0: raise HTTPException(status_code=404, detail="Customer not found")
    return await db.customers.find_one({"id":cid}, {"_id":0})

@api_router.delete("/customers/{cid}")
async def delete_customer(cid: str, _user: dict = Depends(require_permission("customers.delete"))):
    linked = (await db.projects.find_one({"customer_id":cid}) is not None or
              await db.quotes.find_one({"customer_id":cid}) is not None)
    if linked:
        await db.customers.update_one({"id":cid}, {"$set":{"active":False,"updated_at":now_iso()}})
        return {"ok":True,"soft_deleted":True,"reason":"Customer has linked projects or quotes"}
    r = await db.customers.delete_one({"id":cid})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Customer not found")
    return {"ok":True,"soft_deleted":False}

@api_router.get("/customers/{cid}/projects")
async def list_customer_projects(cid: str, _user: dict = Depends(require_permission("customers.view"))):
    if not await db.customers.find_one({"id":cid}, {"_id":0,"id":1}):
        raise HTTPException(status_code=404, detail="Customer not found")
    return await db.projects.find({"customer_id":cid}, {"_id":0}).sort("created_at",-1).to_list(500)


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
@api_router.get("/projects")
async def list_projects(_user: dict = Depends(require_permission("projects.view")), customer_id: Optional[str] = None,
                         status_filter: Optional[str] = Query(None, alias="status")):
    q: Dict[str, Any] = {}
    if customer_id: q["customer_id"] = customer_id
    if status_filter: q["status"] = status_filter
    return await db.projects.find(q, {"_id":0}).sort("created_at",-1).to_list(500)

@api_router.post("/projects", status_code=201)
async def create_project(payload: ProjectCreate, _user: dict = Depends(require_permission("projects.create"))):
    cust = await db.customers.find_one({"id":payload.customer_id}, {"_id":0,"site_address":1})
    if not cust: raise HTTPException(status_code=400, detail="Customer not found")
    data = payload.model_dump()
    if data.get("site_address") is None: data["site_address"] = cust.get("site_address")
    doc = {"id":str(uuid.uuid4()),"created_at":now_iso(),"updated_at":now_iso(),**data}
    await db.projects.insert_one(doc); doc.pop("_id", None); return doc

@api_router.get("/projects/{pid}")
async def get_project(pid: str, _user: dict = Depends(require_permission("projects.view"))):
    doc = await db.projects.find_one({"id":pid}, {"_id":0})
    if not doc: raise HTTPException(status_code=404, detail="Project not found")
    return doc

@api_router.patch("/projects/{pid}")
async def update_project(pid: str, payload: ProjectUpdate, _user: dict = Depends(require_permission("projects.edit"))):
    updates = {k:v for k,v in payload.model_dump(exclude_unset=True).items()}
    updates["updated_at"] = now_iso()
    r = await db.projects.update_one({"id":pid}, {"$set":updates})
    if r.matched_count == 0: raise HTTPException(status_code=404, detail="Project not found")
    return await db.projects.find_one({"id":pid}, {"_id":0})


# ---------------------------------------------------------------------------
# Quotes
# ---------------------------------------------------------------------------
async def _get_quote_or_404(qid: str) -> dict:
    doc = await db.quotes.find_one({"id":qid}, {"_id":0})
    if not doc: raise HTTPException(status_code=404, detail="Quote not found")
    return doc

def _public_quote(doc: dict, customer: Optional[dict]) -> dict:
    return {
        "quote_number": doc["quote_number"], "status": doc["status"], "valid_until": doc["valid_until"],
        "customer":{"company_name":customer["company_name"]} if customer else None,
        "line_items":[{"description":l.get("description",""),"panel_type_label":l["panel_type_label"],
            "length_m":l["length_m"],"height_m":l["height_m"],"thickness_mm":l["thickness_mm"],
            "quantity":l["quantity"],"finish_label":l["finish_label"],"total_aud":l["total_aud"]} for l in doc.get("line_items",[])],
        "subtotal":doc["subtotal"],"gst":doc["gst"],"total":doc["total"],
        "notes_to_customer":doc.get("notes_to_customer",""),
        "sent_at":doc.get("sent_at"),"accepted_at":doc.get("accepted_at"),"rejected_at":doc.get("rejected_at"),
    }

@api_router.get("/quotes")
async def list_quotes(_user: dict = Depends(require_permission("quotes.view")),
                       status_filter: Optional[str] = Query(None, alias="status"),
                       customer_id: Optional[str] = None, search: Optional[str] = Query(None),
                       page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200)):
    q: Dict[str, Any] = {}
    if status_filter: q["status"] = status_filter
    if customer_id: q["customer_id"] = customer_id
    if search:
        q["quote_number"] = re.compile(re.escape(search), re.IGNORECASE)
    total = await db.quotes.count_documents(q)
    docs = await db.quotes.find(q, {"_id":0}).sort("created_at",-1).skip((page-1)*page_size).limit(page_size).to_list(page_size)
    cust_ids = list({d["customer_id"] for d in docs})
    customers = await db.customers.find({"id":{"$in":cust_ids}}, {"_id":0,"id":1,"company_name":1}).to_list(500)
    name_by_id = {c["id"]:c["company_name"] for c in customers}
    for d in docs: d["customer_company_name"] = name_by_id.get(d["customer_id"],"")
    return {"items":docs,"total":total,"page":page,"page_size":page_size}

@api_router.post("/quotes", status_code=201)
async def create_quote(payload: QuoteCreate, user: dict = Depends(require_permission("quotes.create"))):
    cust = await db.customers.find_one({"id":payload.customer_id}, {"_id":0,"id":1})
    if not cust: raise HTTPException(status_code=400, detail="Customer not found")
    if payload.project_id:
        proj = await db.projects.find_one({"id":payload.project_id}, {"_id":0,"customer_id":1})
        if not proj or proj["customer_id"] != payload.customer_id:
            raise HTTPException(status_code=400, detail="Project does not belong to this customer")
    valid_until = payload.valid_until or (now_utc()+timedelta(days=30)).date().isoformat()
    doc = {"id":str(uuid.uuid4()),"quote_number":await next_quote_number(),
        "customer_id":payload.customer_id,"project_id":payload.project_id,"status":"draft",
        "valid_until":valid_until,"line_items":[],
        "notes_to_customer":payload.notes_to_customer,"internal_notes":payload.internal_notes,
        "subtotal":0.0,"gst":0.0,"total":0.0,"total_volume_m3":0.0,"total_weight_tonnes":0.0,
        "created_by":user["id"],"created_at":now_iso(),"updated_at":now_iso(),
        "sent_at":None,"accepted_at":None,"rejected_at":None,
        "magic_link_token":None,"magic_link_decision_at":None,"magic_link_decision_ip":None,
        "view_count":0,"first_viewed_at":None,"last_viewed_at":None,"last_viewed_by_ip":None,
        "revised_from_quote_id":None,"revised_to_quote_id":None,"last_send_attempt_at":None}
    await db.quotes.insert_one(doc); doc.pop("_id",None); return doc

@api_router.get("/quotes/{qid}")
async def get_quote(qid: str, _user: dict = Depends(require_permission("quotes.view"))):
    return await _get_quote_or_404(qid)

@api_router.patch("/quotes/{qid}")
async def update_quote(qid: str, payload: QuoteUpdate, _user: dict = Depends(require_permission("quotes.edit"))):
    quote = await _get_quote_or_404(qid)
    if quote["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only draft quotes can be edited. Use Revise to clone.")
    updates = {k:v for k,v in payload.model_dump(exclude_unset=True).items()}
    if "customer_id" in updates and updates["customer_id"]:
        if not await db.customers.find_one({"id":updates["customer_id"]}, {"_id":0,"id":1}):
            raise HTTPException(status_code=400, detail="Customer not found")
    if "project_id" in updates and updates["project_id"]:
        proj = await db.projects.find_one({"id":updates["project_id"]}, {"_id":0,"customer_id":1})
        cid = updates.get("customer_id", quote["customer_id"])
        if not proj or proj["customer_id"] != cid:
            raise HTTPException(status_code=400, detail="Project does not belong to this customer")
    updates["updated_at"] = now_iso()
    await db.quotes.update_one({"id":qid}, {"$set":updates})
    return await _get_quote_or_404(qid)

async def _require_draft(qid: str) -> dict:
    q = await _get_quote_or_404(qid)
    if q["status"] != "draft": raise HTTPException(status_code=400, detail="Only draft quotes can be modified")
    return q

@api_router.post("/quotes/{qid}/lines", status_code=201)
async def add_quote_line(qid: str, payload: QuoteLineInput, _user: dict = Depends(require_permission("quotes.edit"))):
    await _require_draft(qid)
    pricing = await db.settings.find_one({"key":"pricing"}, {"_id":0,"key":0})
    line = build_quote_line(payload, pricing)
    quote = await db.quotes.find_one({"id":qid}, {"_id":0,"line_items":1})
    lines = quote.get("line_items", []) + [line]
    t = recompute_totals(lines)
    await db.quotes.update_one({"id":qid}, {"$set":{"line_items":lines, **{k:t[k] for k in t}, "updated_at":now_iso()}})
    return {"line":line, "totals":t}

@api_router.patch("/quotes/{qid}/lines/{line_id}")
async def update_quote_line(qid: str, line_id: str, payload: QuoteLineInput, _user: dict = Depends(require_permission("quotes.edit"))):
    await _require_draft(qid)
    pricing = await db.settings.find_one({"key":"pricing"}, {"_id":0,"key":0})
    new_line = build_quote_line(payload, pricing); new_line["id"] = line_id
    quote = await db.quotes.find_one({"id":qid}, {"_id":0,"line_items":1})
    lines = quote.get("line_items", [])
    for i,l in enumerate(lines):
        if l["id"] == line_id: lines[i] = new_line; break
    else: raise HTTPException(status_code=404, detail="Line not found")
    t = recompute_totals(lines)
    await db.quotes.update_one({"id":qid}, {"$set":{"line_items":lines, **{k:t[k] for k in t}, "updated_at":now_iso()}})
    return {"line":new_line, "totals":t}

@api_router.delete("/quotes/{qid}/lines/{line_id}")
async def delete_quote_line(qid: str, line_id: str, _user: dict = Depends(require_permission("quotes.edit"))):
    await _require_draft(qid)
    quote = await db.quotes.find_one({"id":qid}, {"_id":0,"line_items":1})
    new_lines = [l for l in quote.get("line_items",[]) if l["id"] != line_id]
    if len(new_lines) == len(quote.get("line_items",[])):
        raise HTTPException(status_code=404, detail="Line not found")
    t = recompute_totals(new_lines)
    await db.quotes.update_one({"id":qid}, {"$set":{"line_items":new_lines, **{k:t[k] for k in t}, "updated_at":now_iso()}})
    return {"ok":True, "totals":t}


def _email_preview_for_quote(quote: dict, customer: dict, company: dict, magic_url: str,
                              override: Optional[SendQuoteOverride] = None) -> Dict[str, str]:
    recipient = (override.recipient if override and override.recipient else customer.get("contact_email", ""))
    subject = (override.subject if override and override.subject
               else f"Quote {quote['quote_number']} from {company.get('business_name','Paneltec Group')}")
    if override and override.body:
        body = override.body
    else:
        body = (
            f"Hi {customer.get('contact_name') or customer.get('company_name','team')},\n\n"
            f"Please find your quote {quote['quote_number']} from {company.get('business_name','Paneltec Group')}.\n\n"
            f"Total: AUD ${quote['total']:,.2f} (inc GST)\n"
            f"Valid until: {quote['valid_until']}\n\n"
            f"You can review and approve the quote securely here — no login required:\n{magic_url}\n\n"
            f"If you have any questions, just reply to this email.\n\n"
            f"Kind regards,\n{company.get('business_name','Paneltec Group')}\n"
            f"{company.get('phone','')}"
        )
    return {"to": recipient, "subject": subject, "body": body}


@api_router.post("/quotes/{qid}/send")
async def send_quote(qid: str, payload: Optional[SendQuoteOverride] = None,
                      request: Request = None, _user: dict = Depends(require_permission("quotes.send"))):
    q = await _get_quote_or_404(qid)
    if not q.get("line_items"):
        raise HTTPException(status_code=400, detail="Cannot send a quote with no line items")
    token = q.get("magic_link_token") or str(uuid.uuid4())
    sent_at = q.get("sent_at") or now_iso()
    await db.quotes.update_one({"id":qid},
        {"$set":{"status":"sent","magic_link_token":token,"sent_at":sent_at,
                 "last_send_attempt_at":now_iso(),"updated_at":now_iso()}})
    customer = await db.customers.find_one({"id":q["customer_id"]}, {"_id":0})
    company = await db.settings.find_one({"key":"company"}, {"_id":0,"key":0}) or {}
    q2 = await db.quotes.find_one({"id":qid}, {"_id":0})
    base = str(request.base_url).rstrip("/") if request else ""
    # Strip /api if present (the base_url contains the path); use frontend origin
    base = re.sub(r"/api$", "", base)
    magic_url = f"{base}/q/{token}" if base else f"/q/{token}"
    return {
        "ok": True, "magic_link_token": token, "public_url": f"/q/{token}",
        "magic_link_url": magic_url, "email_status": "MOCKED",
        "email_preview": _email_preview_for_quote(q2, customer or {}, company, magic_url, payload),
    }


@api_router.post("/quotes/{qid}/revise", status_code=201)
async def revise_quote(qid: str, user: dict = Depends(require_permission("quotes.revise"))):
    src = await _get_quote_or_404(qid)
    if src["status"] == "draft":
        raise HTTPException(status_code=400, detail="Source is already a draft — edit it directly")
    # Deep copy line items with new ids
    new_lines = []
    for l in src.get("line_items", []):
        nl = dict(l); nl["id"] = str(uuid.uuid4()); new_lines.append(nl)
    new_id = str(uuid.uuid4())
    new_number = await next_quote_number()
    t = recompute_totals(new_lines)
    doc = {"id":new_id, "quote_number":new_number,
        "customer_id":src["customer_id"], "project_id":src.get("project_id"),
        "status":"draft", "valid_until":(now_utc()+timedelta(days=30)).date().isoformat(),
        "line_items":new_lines,
        "notes_to_customer":src.get("notes_to_customer",""),"internal_notes":src.get("internal_notes",""),
        **{k:t[k] for k in t},
        "created_by":user["id"],"created_at":now_iso(),"updated_at":now_iso(),
        "sent_at":None,"accepted_at":None,"rejected_at":None,
        "magic_link_token":None,"magic_link_decision_at":None,"magic_link_decision_ip":None,
        "view_count":0,"first_viewed_at":None,"last_viewed_at":None,"last_viewed_by_ip":None,
        "revised_from_quote_id":src["id"], "revised_to_quote_id":None,
        "last_send_attempt_at":None}
    await db.quotes.insert_one(doc)
    await db.quotes.update_one({"id":src["id"]}, {"$set":{"revised_to_quote_id":new_id, "updated_at":now_iso()}})
    doc.pop("_id", None)
    return doc


# ---- Auto-create job hook ----
async def _create_job_from_quote(quote_id: str, by_user_id: str) -> Optional[dict]:
    q = await db.quotes.find_one({"id":quote_id}, {"_id":0})
    if not q: return None
    # Idempotent: if a job already exists for this quote, skip
    existing = await db.jobs.find_one({"quote_id":quote_id}, {"_id":0})
    if existing: return existing
    new_lines = []
    for l in q.get("line_items", []):
        nl = dict(l); nl["id"] = str(uuid.uuid4()); new_lines.append(nl)
    t = recompute_totals(new_lines)
    doc = {"id":str(uuid.uuid4()), "job_number":await next_job_number(),
        "quote_id":q["id"], "quote_number":q["quote_number"],
        "customer_id":q["customer_id"], "project_id":q.get("project_id"),
        "status":"scheduled",
        "line_items":new_lines, **{k:t[k] for k in t},
        "scheduled_production_date":None, "scheduled_delivery_date":None,
        "assigned_vehicle_id":None, "assigned_employee_ids":[],
        "production_notes":"", "delivery_notes":"",
        "status_history":[{"from":None,"to":"scheduled","at":now_iso(),"by_user_id":by_user_id,
                          "note":"Auto-created from accepted quote"}],
        "cancellation_reason":None,
        "created_from_quote_at":now_iso(), "updated_at":now_iso()}
    await db.jobs.insert_one(doc); doc.pop("_id",None)
    logger.info(f"Auto-created job {doc['job_number']} from quote {q['quote_number']}")
    return doc


@api_router.post("/quotes/{qid}/mark-accepted")
async def mark_accepted(qid: str, user: dict = Depends(require_permission("quotes.mark_decision"))):
    q = await _get_quote_or_404(qid)
    if q["status"] != "accepted":
        await db.quotes.update_one({"id":qid},
            {"$set":{"status":"accepted","accepted_at":now_iso(),"updated_at":now_iso()}})
    await _create_job_from_quote(qid, user["id"])
    return await _get_quote_or_404(qid)

@api_router.post("/quotes/{qid}/mark-rejected")
async def mark_rejected(qid: str, _user: dict = Depends(require_permission("quotes.mark_decision"))):
    await _get_quote_or_404(qid)
    await db.quotes.update_one({"id":qid},
        {"$set":{"status":"rejected","rejected_at":now_iso(),"updated_at":now_iso()}})
    return await _get_quote_or_404(qid)


# ---------------------------------------------------------------------------
# Public quote — view tracking & decisions
# ---------------------------------------------------------------------------
def _is_expired(valid_until: str) -> bool:
    try: return date.fromisoformat(valid_until) < now_utc().date()
    except Exception: return False

def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for","")
    if fwd: return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""

_BOT_RX = re.compile(r"bot|crawl|spider|preview", re.IGNORECASE)

async def _record_view(doc: dict, request: Request):
    if doc["status"] != "sent": return
    ua = request.headers.get("user-agent","")
    if _BOT_RX.search(ua): return
    ip = _client_ip(request)
    last_ip = doc.get("last_viewed_by_ip")
    last_at = doc.get("last_viewed_at")
    if ip and last_ip == ip and last_at:
        try:
            last_dt = datetime.fromisoformat(last_at)
            if (now_utc() - last_dt).total_seconds() < 60: return
        except Exception: pass
    update: Dict[str, Any] = {"$inc":{"view_count":1},
        "$set":{"last_viewed_at":now_iso(), "last_viewed_by_ip":ip}}
    if not doc.get("first_viewed_at"):
        update["$set"]["first_viewed_at"] = now_iso()
    await db.quotes.update_one({"id":doc["id"]}, update)


@api_router.get("/public/quotes/by-token/{token}")
async def public_get_quote(token: str, request: Request):
    doc = await db.quotes.find_one({"magic_link_token":token}, {"_id":0})
    if not doc: raise HTTPException(status_code=404, detail="Quote not found")
    customer = await db.customers.find_one({"id":doc["customer_id"]}, {"_id":0,"company_name":1})
    if doc["status"] == "sent" and _is_expired(doc["valid_until"]):
        await db.quotes.update_one({"id":doc["id"]}, {"$set":{"status":"expired","updated_at":now_iso()}})
        doc["status"] = "expired"
    else:
        await _record_view(doc, request)
    return _public_quote(doc, customer)


async def _public_decision(token: str, decision: Literal["accepted","rejected"], request: Request):
    doc = await db.quotes.find_one({"magic_link_token":token}, {"_id":0})
    if not doc: raise HTTPException(status_code=404, detail="Quote not found")
    if doc["status"] in ("accepted","rejected"):
        raise HTTPException(status_code=409, detail=f"Quote already {doc['status']}")
    if doc["status"] == "expired" or _is_expired(doc["valid_until"]):
        raise HTTPException(status_code=409, detail="Quote has expired")
    if doc["status"] != "sent":
        raise HTTPException(status_code=409, detail=f"Quote cannot be {decision} from status '{doc['status']}'")
    ts = now_iso()
    field = "accepted_at" if decision == "accepted" else "rejected_at"
    await db.quotes.update_one({"id":doc["id"]},
        {"$set":{"status":decision,field:ts,"magic_link_decision_at":ts,
                 "magic_link_decision_ip":_client_ip(request),"updated_at":ts}})
    if decision == "accepted":
        await _create_job_from_quote(doc["id"], by_user_id="public-magic-link")
    customer = await db.customers.find_one({"id":doc["customer_id"]}, {"_id":0,"company_name":1})
    return _public_quote(await db.quotes.find_one({"id":doc["id"]}, {"_id":0}), customer)

@api_router.post("/public/quotes/by-token/{token}/accept")
async def public_accept(token: str, request: Request): return await _public_decision(token, "accepted", request)

@api_router.post("/public/quotes/by-token/{token}/reject")
async def public_reject(token: str, request: Request): return await _public_decision(token, "rejected", request)


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------
async def _get_job_or_404(jid: str) -> dict:
    doc = await db.jobs.find_one({"id":jid}, {"_id":0})
    if not doc: raise HTTPException(status_code=404, detail="Job not found")
    return doc

async def _transition_job_internal(jid: str, to: str, note: str, by_user_id: str) -> dict:
    job = await _get_job_or_404(jid)
    cur = job["status"]
    if cur == "cancelled":
        raise HTTPException(status_code=400, detail="Cancelled jobs cannot be re-opened")
    if to == "cancelled":
        pass  # allowed from any non-cancelled
    elif to == cur:
        raise HTTPException(status_code=400, detail=f"Job is already '{cur}'")
    elif cur not in JOB_STATUS_ORDER or to not in JOB_STATUS_ORDER:
        raise HTTPException(status_code=400, detail="Invalid status")
    else:
        # Linear: 'to' must be the immediate next step in JOB_STATUS_ORDER
        cur_i = JOB_STATUS_ORDER.index(cur)
        to_i = JOB_STATUS_ORDER.index(to)
        if to_i != cur_i + 1:
            raise HTTPException(status_code=400,
                detail=f"Cannot jump status: {cur} → {to}. Must go in order: {' → '.join(JOB_STATUS_ORDER)}")
    history_entry = {"from":cur, "to":to, "at":now_iso(), "by_user_id":by_user_id, "note":note}
    await db.jobs.update_one({"id":jid},
        {"$set":{"status":to,"updated_at":now_iso()},
         "$push":{"status_history":history_entry}})
    return await _get_job_or_404(jid)

@api_router.get("/jobs")
async def list_jobs(_user: dict = Depends(require_permission("jobs.view")),
                     status_filter: Optional[str] = Query(None, alias="status"),
                     customer_id: Optional[str] = None, search: Optional[str] = Query(None),
                     page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200)):
    q: Dict[str, Any] = {}
    if status_filter: q["status"] = status_filter
    if customer_id: q["customer_id"] = customer_id
    if search: q["job_number"] = re.compile(re.escape(search), re.IGNORECASE)
    total = await db.jobs.count_documents(q)
    docs = await db.jobs.find(q, {"_id":0}).sort("created_from_quote_at",-1).skip((page-1)*page_size).limit(page_size).to_list(page_size)
    cust_ids = list({d["customer_id"] for d in docs})
    customers = await db.customers.find({"id":{"$in":cust_ids}}, {"_id":0,"id":1,"company_name":1}).to_list(500)
    name_by_id = {c["id"]:c["company_name"] for c in customers}
    for d in docs: d["customer_company_name"] = name_by_id.get(d["customer_id"],"")
    return {"items":docs, "total":total, "page":page, "page_size":page_size}

@api_router.get("/jobs/{jid}")
async def get_job(jid: str, _user: dict = Depends(require_permission("jobs.view"))):
    return await _get_job_or_404(jid)

@api_router.patch("/jobs/{jid}")
async def update_job(jid: str, payload: JobUpdate, _user: dict = Depends(require_permission("jobs.edit"))):
    job = await _get_job_or_404(jid)
    if job["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Cancelled jobs cannot be modified")
    updates = {k:v for k,v in payload.model_dump(exclude_unset=True).items()}
    if "assigned_vehicle_id" in updates and updates["assigned_vehicle_id"]:
        if updates["assigned_vehicle_id"] not in _VEHICLE_IDS:
            raise HTTPException(status_code=400, detail="Unknown vehicle id")
    if "assigned_employee_ids" in updates and updates["assigned_employee_ids"]:
        for eid in updates["assigned_employee_ids"]:
            if eid not in _EMPLOYEE_IDS:
                raise HTTPException(status_code=400, detail=f"Unknown employee id: {eid}")
    updates["updated_at"] = now_iso()
    await db.jobs.update_one({"id":jid}, {"$set":updates})
    return await _get_job_or_404(jid)

@api_router.post("/jobs/{jid}/transition")
async def transition_job(jid: str, payload: JobTransition, user: dict = Depends(require_permission("jobs.transition"))):
    return await _transition_job_internal(jid, payload.to, payload.note, user["id"])

@api_router.post("/jobs/{jid}/cancel")
async def cancel_job(jid: str, payload: JobCancel, user: dict = Depends(require_permission("jobs.cancel"))):
    job = await _get_job_or_404(jid)
    if job["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Job is already cancelled")
    history_entry = {"from":job["status"], "to":"cancelled", "at":now_iso(),
                     "by_user_id":user["id"], "note":payload.reason}
    await db.jobs.update_one({"id":jid},
        {"$set":{"status":"cancelled","cancellation_reason":payload.reason,"updated_at":now_iso()},
         "$push":{"status_history":history_entry}})
    return await _get_job_or_404(jid)


# ---------------------------------------------------------------------------
# Vehicles + Employees (mocked)
# ---------------------------------------------------------------------------
@api_router.get("/vehicles")
async def list_vehicles(_user: dict = Depends(require_permission("vehicles.view"))):
    return {"items": MOCK_VEHICLES, "source": "MOCKED_NAVIXY",
            "note": "MOCKED — real fleet integration coming in Phase 4 (Navixy)"}

@api_router.get("/employees")
async def list_employees(_user: dict = Depends(require_permission("employees.view"))):
    return {"items": MOCK_EMPLOYEES, "source": "MOCKED_SIMPRO",
            "note": "MOCKED — real HR integration coming in Phase 4 (Simpro)"}


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------
async def _get_invoice_or_404(iid: str) -> dict:
    doc = await db.invoices.find_one({"id":iid}, {"_id":0})
    if not doc: raise HTTPException(status_code=404, detail="Invoice not found")
    return doc

async def _create_invoice_from_job(job: dict, by_user_id: str) -> Optional[dict]:
    """Internal: copy lines from job, compute totals, save."""
    # Check: job must be delivered or later
    if job["status"] not in ("delivered","installed","completed"):
        return None
    company = await db.settings.find_one({"key":"company"}, {"_id":0,"key":0}) or {}
    terms = int(company.get("default_payment_terms_days", 30))
    new_lines = []
    for l in job.get("line_items", []):
        nl = dict(l); nl["id"] = str(uuid.uuid4()); new_lines.append(nl)
    t = recompute_totals(new_lines)
    issue_date = now_utc().date().isoformat()
    due_date = (now_utc().date() + timedelta(days=terms)).isoformat()
    doc = {"id":str(uuid.uuid4()), "invoice_number":await next_invoice_number(),
        "job_id":job["id"], "job_number":job.get("job_number"),
        "quote_id":job["quote_id"], "quote_number":job.get("quote_number"),
        "customer_id":job["customer_id"], "project_id":job.get("project_id"),
        "status":"draft", "line_items":new_lines, **{k:t[k] for k in t},
        "issue_date":issue_date, "due_date":due_date,
        "paid_at":None, "paid_amount":0.0, "payment_reference":"",
        "xero_push_status":"not_pushed", "xero_invoice_id":None,
        "notes_to_customer":"", "internal_notes":"",
        "created_by":by_user_id, "created_at":now_iso(), "updated_at":now_iso()}
    await db.invoices.insert_one(doc); doc.pop("_id",None)
    return doc

@api_router.get("/invoices")
async def list_invoices(_user: dict = Depends(require_permission("invoices.view")),
                         status_filter: Optional[str] = Query(None, alias="status"),
                         customer_id: Optional[str] = None, search: Optional[str] = Query(None),
                         page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200)):
    q: Dict[str, Any] = {}
    if status_filter: q["status"] = status_filter
    if customer_id: q["customer_id"] = customer_id
    if search: q["invoice_number"] = re.compile(re.escape(search), re.IGNORECASE)
    total = await db.invoices.count_documents(q)
    docs = await db.invoices.find(q, {"_id":0}).sort("created_at",-1).skip((page-1)*page_size).limit(page_size).to_list(page_size)
    cust_ids = list({d["customer_id"] for d in docs})
    customers = await db.customers.find({"id":{"$in":cust_ids}}, {"_id":0,"id":1,"company_name":1}).to_list(500)
    name_by_id = {c["id"]:c["company_name"] for c in customers}
    for d in docs: d["customer_company_name"] = name_by_id.get(d["customer_id"],"")
    return {"items":docs, "total":total, "page":page, "page_size":page_size}

@api_router.post("/invoices", status_code=201)
async def create_invoice(payload: InvoiceCreate, user: dict = Depends(require_permission("invoices.create"))):
    job = await db.jobs.find_one({"id":payload.job_id}, {"_id":0})
    if not job: raise HTTPException(status_code=400, detail="Job not found")
    if job["status"] not in ("delivered","installed","completed"):
        raise HTTPException(status_code=400, detail="Cannot invoice — job is not yet delivered")
    if await db.invoices.find_one({"job_id":payload.job_id}):
        raise HTTPException(status_code=409, detail="Invoice already exists for this job")
    inv = await _create_invoice_from_job(job, user["id"])
    if not inv: raise HTTPException(status_code=400, detail="Could not create invoice")
    return inv

@api_router.get("/invoices/{iid}")
async def get_invoice(iid: str, _user: dict = Depends(require_permission("invoices.view"))):
    return await _get_invoice_or_404(iid)

@api_router.patch("/invoices/{iid}")
async def update_invoice(iid: str, payload: InvoiceUpdate, _user: dict = Depends(require_permission("invoices.create"))):
    inv = await _get_invoice_or_404(iid)
    if inv["status"] in ("paid","cancelled"):
        raise HTTPException(status_code=400, detail=f"Invoice is {inv['status']} — cannot edit")
    updates = {k:v for k,v in payload.model_dump(exclude_unset=True).items()}
    updates["updated_at"] = now_iso()
    await db.invoices.update_one({"id":iid}, {"$set":updates})
    return await _get_invoice_or_404(iid)

@api_router.post("/invoices/{iid}/issue")
async def issue_invoice(iid: str, _user: dict = Depends(require_permission("invoices.issue"))):
    inv = await _get_invoice_or_404(iid)
    if inv["status"] != "draft":
        raise HTTPException(status_code=400, detail=f"Cannot issue from status '{inv['status']}'")
    upd = {"status":"issued", "updated_at":now_iso()}
    if not inv.get("issue_date"): upd["issue_date"] = now_utc().date().isoformat()
    await db.invoices.update_one({"id":iid}, {"$set":upd})
    return await _get_invoice_or_404(iid)

@api_router.post("/invoices/{iid}/mark-paid")
async def mark_paid(iid: str, payload: InvoiceMarkPaid, _user: dict = Depends(require_permission("invoices.mark_paid"))):
    inv = await _get_invoice_or_404(iid)
    if inv["status"] not in ("issued",):
        raise HTTPException(status_code=400, detail=f"Cannot mark paid from status '{inv['status']}'. Issue first.")
    await db.invoices.update_one({"id":iid},
        {"$set":{"status":"paid","paid_at":payload.paid_at or now_iso(),
                 "paid_amount":payload.paid_amount,"payment_reference":payload.payment_reference,
                 "updated_at":now_iso()}})
    return await _get_invoice_or_404(iid)

@api_router.post("/invoices/{iid}/push-to-xero")
async def push_to_xero(iid: str, _user: dict = Depends(require_permission("invoices.push_xero"))):
    inv = await _get_invoice_or_404(iid)
    mock_xero_id = f"MOCK-{uuid.uuid4()}"
    await db.invoices.update_one({"id":iid},
        {"$set":{"xero_push_status":"MOCKED_PUSHED","xero_invoice_id":mock_xero_id,"updated_at":now_iso()}})
    return {"status":"MOCKED_PUSHED","xero_invoice_id":mock_xero_id,
            "note":"MOCKED — real Xero push coming in Phase 4. Invoice unchanged in Xero."}


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@api_router.get("/dashboard/kpis")
async def dashboard_kpis(_user: dict = Depends(get_current_user)):
    now = now_utc()
    start_of_month = datetime(now.year, now.month, 1, tzinfo=timezone.utc).isoformat()
    quotes_draft = await db.quotes.count_documents({"status":"draft"})
    quotes_sent = await db.quotes.count_documents({"status":"sent"})
    quotes_accepted = await db.quotes.count_documents({"status":"accepted"})
    customers_active = await db.customers.count_documents({"active":True})

    quoted_this_month = 0.0
    async for d in db.quotes.aggregate([{"$match":{"created_at":{"$gte":start_of_month}}},
                                         {"$group":{"_id":None,"sum":{"$sum":"$total"}}}]):
        quoted_this_month = float(d.get("sum") or 0.0)
    accepted_this_month = 0.0
    async for d in db.quotes.aggregate([{"$match":{"accepted_at":{"$gte":start_of_month}}},
                                         {"$group":{"_id":None,"sum":{"$sum":"$total"}}}]):
        accepted_this_month = float(d.get("sum") or 0.0)

    # Jobs
    jobs_by_status: Dict[str, int] = {}
    for s in JOB_STATUS_ORDER + ["cancelled"]:
        jobs_by_status[s] = await db.jobs.count_documents({"status":s})
    jobs_active = sum(jobs_by_status[s] for s in JOB_STATUS_ORDER if s != "completed")

    # Invoices
    invoices_draft = await db.invoices.count_documents({"status":"draft"})
    invoices_issued = await db.invoices.count_documents({"status":"issued"})
    invoices_paid = await db.invoices.count_documents({"status":"paid"})

    outstanding = 0.0
    async for d in db.invoices.aggregate([{"$match":{"status":{"$in":["issued","overdue"]}}},
                                            {"$group":{"_id":None,"sum":{"$sum":{"$subtract":["$total","$paid_amount"]}}}}]):
        outstanding = float(d.get("sum") or 0.0)
    paid_this_month = 0.0
    async for d in db.invoices.aggregate([{"$match":{"paid_at":{"$gte":start_of_month}}},
                                            {"$group":{"_id":None,"sum":{"$sum":"$paid_amount"}}}]):
        paid_this_month = float(d.get("sum") or 0.0)

    recent_q = await db.quotes.find({}, {"_id":0}).sort("created_at",-1).limit(5).to_list(5)
    recent_j = await db.jobs.find({}, {"_id":0}).sort("created_from_quote_at",-1).limit(5).to_list(5)
    cust_ids = list({r["customer_id"] for r in recent_q} | {r["customer_id"] for r in recent_j})
    customers = await db.customers.find({"id":{"$in":cust_ids}}, {"_id":0,"id":1,"company_name":1}).to_list(500)
    name_by_id = {c["id"]:c["company_name"] for c in customers}
    recent_quotes = [{"id":r["id"],"quote_number":r["quote_number"],"status":r["status"],
                      "total":r["total"],"created_at":r["created_at"],
                      "customer_company_name":name_by_id.get(r["customer_id"],"")} for r in recent_q]
    recent_jobs = [{"id":r["id"],"job_number":r["job_number"],"status":r["status"],
                    "total":r["total"],"created_from_quote_at":r["created_from_quote_at"],
                    "customer_company_name":name_by_id.get(r["customer_id"],"")} for r in recent_j]
    return {
        "quotes_draft":quotes_draft,"quotes_sent":quotes_sent,"quotes_accepted":quotes_accepted,
        "customers_active":customers_active,
        "quoted_this_month_aud":_round2(quoted_this_month),
        "accepted_this_month_aud":_round2(accepted_this_month),
        "jobs_by_status":jobs_by_status, "jobs_active":jobs_active,
        "invoices_draft":invoices_draft, "invoices_issued":invoices_issued, "invoices_paid":invoices_paid,
        "outstanding_aud":_round2(outstanding), "paid_this_month_aud":_round2(paid_this_month),
        "recent_quotes":recent_quotes, "recent_jobs":recent_jobs,
    }


# ---------------------------------------------------------------------------
# Integration Settings (admin) + email-sent recording
# ---------------------------------------------------------------------------
@api_router.get("/settings/integrations")
async def get_integrations(_u: dict = Depends(require_permission("integrations.view"))):
    doc = await db.settings.find_one({"key":"integrations"}, {"_id":0,"key":0})
    if not doc:
        doc = dict(DEFAULT_INTEGRATIONS)
    return _mask_integrations(doc)

@api_router.put("/settings/integrations")
async def update_integrations(payload: IntegrationSettings, _u: dict = Depends(require_permission("integrations.edit"))):
    existing = await db.settings.find_one({"key":"integrations"}, {"_id":0,"key":0}) or {}
    incoming = payload.model_dump()
    # Preserve stored secrets if the client returned a masked value
    for ikey, fields in SECRET_FIELDS.items():
        cur_section = existing.get(ikey, {}) or {}
        new_section = incoming.get(ikey, {}) or {}
        for f in fields:
            if _is_masked(new_section.get(f, "")):
                new_section[f] = cur_section.get(f, "")
        incoming[ikey] = new_section
    incoming["updated_at"] = now_iso()
    await db.settings.update_one({"key":"integrations"}, {"$set": incoming}, upsert=True)
    saved = await db.settings.find_one({"key":"integrations"}, {"_id":0,"key":0})
    return _mask_integrations(saved)

@api_router.post("/settings/integrations/{integration}/test")
async def test_integration(integration: str, _u: dict = Depends(require_permission("integrations.edit"))):
    if integration not in ("m365","simpro","navixy","xero"):
        raise HTTPException(status_code=400, detail="Unknown integration")
    return {"status":"MOCKED",
        "integration": integration,
        "message": f"Real {integration} API connection coming in Phase 4 Part 2. Credentials saved successfully."}


# Universal email-sent recording
async def _record_email_sent(collection, entity_id: str, subject: str, recipient: str, user_id: str):
    r = await collection.update_one({"id": entity_id},
        {"$set":{"last_email_sent_at": now_iso(), "last_email_subject": subject,
                 "last_email_recipient": recipient, "last_email_sent_by_user_id": user_id,
                 "updated_at": now_iso()}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Entity not found")
    return await collection.find_one({"id": entity_id}, {"_id":0})

@api_router.post("/customers/{cid}/email-sent")
async def customer_email_sent(cid: str, payload: EmailSentLog, user: dict = Depends(get_current_user)):
    return await _record_email_sent(db.customers, cid, payload.subject, payload.recipient, user["id"])

@api_router.post("/projects/{pid}/email-sent")
async def project_email_sent(pid: str, payload: EmailSentLog, user: dict = Depends(get_current_user)):
    return await _record_email_sent(db.projects, pid, payload.subject, payload.recipient, user["id"])

@api_router.post("/jobs/{jid}/email-sent")
async def job_email_sent(jid: str, payload: EmailSentLog, user: dict = Depends(get_current_user)):
    return await _record_email_sent(db.jobs, jid, payload.subject, payload.recipient, user["id"])

@api_router.post("/invoices/{iid}/email-sent")
async def invoice_email_sent(iid: str, payload: EmailSentLog, user: dict = Depends(get_current_user)):
    return await _record_email_sent(db.invoices, iid, payload.subject, payload.recipient, user["id"])


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@api_router.get("/")
async def root(): return {"app":"Paneltec Group API","status":"ok","version":"3.0.0"}
@api_router.get("/health")
async def health(): return {"status":"ok","time":now_iso()}


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------
app.include_router(api_router)
app.add_middleware(CORSMiddleware,
    allow_credentials=True, allow_origins=os.environ.get('CORS_ORIGINS','*').split(','),
    allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
async def on_startup():
    try: await seed_database()
    except Exception as e: logger.exception(f"Seeding failed: {e}")

@app.on_event("shutdown")
async def on_shutdown(): client.close()
