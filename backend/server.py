from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import uuid
import logging
import httpx
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Literal, Any, Dict, Tuple

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Query, Response, Body
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

# Phase 4 Part 2 — Simpro integration client
from integrations.simpro_client import (
    SimproClient, SimproError, SimproAuthError,
    build_settings_from_doc as _build_simpro_settings,
    map_customer as _map_simpro_customer,
    map_employee as _map_simpro_employee,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_utc() -> datetime: return datetime.now(timezone.utc)
def now_iso() -> str: return now_utc().isoformat()
def hash_password(p: str) -> str: return bcrypt.hashpw(p.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
def verify_password(plain: str, hashed: str) -> bool:
    try: return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception: return False

# ---------------------------------------------------------------------------
# BI Tokens — separate identity ("BI bot") for read-only Power BI / Tableau / Excel
# ---------------------------------------------------------------------------
BI_TOKEN_PREFIX = "paneltec_bi_"
BI_TOKEN_MAX_ACTIVE = 20

def _bi_bot_user(token: dict) -> dict:
    return {
        "id": f"bi-bot-{token['id']}",
        "email": "bi-bot@paneltec.internal",
        "name": f"BI Bot ({token.get('name','')})",
        "is_super_admin": False,
        "permissions": {
            "customers.view": True, "quotes.view": True, "jobs.view": True,
            "invoices.view": True, "vehicles.view": True, "employees.view": True,
        },
        "_is_bi_bot": True,
        "_bi_token_id": token["id"],
        "is_active": True,
    }

async def _resolve_bi_token(raw: str, request: Request) -> Optional[dict]:
    """Return synthetic BI bot user if raw matches a non-revoked token else None."""
    if not raw or not raw.startswith(BI_TOKEN_PREFIX): return None
    # Iterate active (non-revoked) tokens; collection is small (cap 20 active).
    tokens = await db.bi_api_tokens.find({"revoked_at": None}, {"_id": 0}).to_list(200)
    raw_b = raw.encode("utf-8")
    for t in tokens:
        try:
            if bcrypt.checkpw(raw_b, t["token_hash"].encode("utf-8")):
                ip = (request.client.host if request.client else None) or request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or None
                await db.bi_api_tokens.update_one({"id": t["id"]},
                    {"$set": {"last_used_at": now_iso(), "last_used_ip": ip}})
                return _bi_bot_user(t)
        except Exception:
            continue
    return None


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
    {"key": "quotes",    "label": "Quotes",    "permissions": ["quotes.view", "quotes.create", "quotes.edit", "quotes.send", "quotes.mark_decision", "quotes.revise", "quotes.delete"]},
    {"key": "jobs",      "label": "Jobs",      "permissions": ["jobs.view", "jobs.edit", "jobs.transition", "jobs.cancel", "jobs.delete"]},
    {"key": "invoices",  "label": "Invoices",  "permissions": ["invoices.view", "invoices.create", "invoices.issue", "invoices.mark_paid", "invoices.push_xero", "invoices.delete"]},
    {"key": "vehicles",  "label": "Vehicles",  "permissions": ["vehicles.view", "vehicles.create", "vehicles.edit", "vehicles.delete"]},
    {"key": "employees", "label": "Employees", "permissions": ["employees.view", "employees.create", "employees.edit", "employees.delete"]},
    {"key": "pricing",   "label": "Pricing",   "permissions": ["pricing.view", "pricing.edit", "pricing.view_costs"]},
    {"key": "company",   "label": "Company",   "permissions": ["company.view", "company.edit"]},
    {"key": "integrations","label":"Integrations","permissions": ["integrations.view", "integrations.edit"]},
    {"key": "users",     "label": "Users",     "permissions": ["users.view", "users.manage"]},
    {"key": "audit",     "label": "Audit",     "permissions": ["audit.view"]},
    {"key": "forms",     "label": "Compliance Forms", "permissions": ["forms.view", "forms.create", "forms.edit", "forms.sign", "forms.delete", "forms.template_manage"]},
]
ALL_PERMISSIONS: List[str] = [p for m in PERMISSION_MODULES for p in m["permissions"]]
# These permissions are reserved for super-admins. Non-super-admins cannot hold them.
ELEVATED_PERMISSIONS = {"users.manage", "integrations.edit", "pricing.edit", "company.edit", "audit.view"}

PERMISSION_PRESETS = {
    "estimator": {
        "label": "Estimator / Sales",
        "permissions": [
            "customers.view","customers.create","customers.edit","customers.delete",
            "projects.view","projects.create","projects.edit","projects.delete",
            "quotes.view","quotes.create","quotes.edit","quotes.send","quotes.mark_decision","quotes.revise",
            "jobs.view","invoices.view","vehicles.view","employees.view","customers.delete","projects.delete","quotes.delete",
        ],
    },
    "production": {
        "label": "Production",
        "permissions": [
            "customers.view","projects.view","quotes.view",
            "jobs.view","jobs.edit","jobs.transition","jobs.cancel","jobs.delete",
            "invoices.view",
            "vehicles.view","vehicles.edit","vehicles.delete",
            "employees.view","employees.edit","employees.delete",
            "forms.view","forms.create","forms.edit","forms.delete",
        ],
    },
    "accounts": {
        "label": "Accounts",
        "permissions": [
            "customers.view","projects.view","quotes.view","jobs.view",
            "invoices.view","invoices.create","invoices.issue","invoices.mark_paid","invoices.push_xero","invoices.delete",
            "company.view","forms.view",
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
    # ---- BI token path (read-only bot identity) ----
    bi_raw = request.headers.get("X-BI-Token") or request.headers.get("x-bi-token")
    if bi_raw:
        bi_user = await _resolve_bi_token(bi_raw, request)
        if bi_user is None:
            raise HTTPException(status_code=401, detail="Invalid BI token")
        return bi_user
    # ---- Standard JWT path ----
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

# Permissions a BI bot identity may EVER have (hard ceiling). Anything else is denied.
BI_BOT_ALLOWED_PERMS = {"customers.view","quotes.view","jobs.view","invoices.view",
                       "vehicles.view","employees.view"}

def require_permission(perm: str):
    async def _dep(request: Request, user: dict = Depends(get_current_user)) -> dict:
        if user.get("_is_bi_bot"):
            # BI bots may only hit /api/reporting/v1/* — hard guard.
            if not request.url.path.startswith("/api/reporting/v1/"):
                raise HTTPException(status_code=403,
                                    detail="BI tokens may only access /api/reporting/v1/*")
            if perm not in BI_BOT_ALLOWED_PERMS:
                raise HTTPException(status_code=403,
                                    detail="BI tokens are read-only with view permissions only")
        if not has_permission(user, perm):
            raise HTTPException(status_code=403, detail=f"Permission required: {perm}")
        return user
    _dep.__name__ = f"require_permission_{perm.replace('.', '_')}"
    return _dep

async def require_super_admin(request: Request, user: dict = Depends(get_current_user)) -> dict:
    if user.get("_is_bi_bot"):
        raise HTTPException(status_code=403, detail="BI tokens may only access /api/reporting/v1/*")
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
    # Phase 7 — internal cost only (optional for backward compat on PUT bodies)
    manufacturing_labour_per_m2: float = 0.0
class ReinforcementDensities(BaseModel):
    light: float; standard: float; heavy: float; prestressed: float
class FinishMultiplier(BaseModel):
    key: str; label: str; multiplier: float
    # Phase 7 — internal cost only
    finishing_labour_per_m2: float = 0.0
class PricingSettings(BaseModel):
    concrete_density: float = 2500.0; gst_rate: float = 10.0
    reinforcement_densities: ReinforcementDensities; panel_types: List[PanelTypePricing]
    thickness_options_mm: List[int]; concrete_grades: List[str]; finishes: List[FinishMultiplier]
    # Phase 7 — internal cost inputs (optional in body; migration ensures defaults exist server-side)
    concrete_cost_per_m3: float = 180.0
    steel_cost_per_kg: float = 1.50
    transport_cost_per_m2: float = 25.0
    overhead_pct: float = 12.0
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
    force: bool = False
    force_reason: str = ""
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
    model_config = ConfigDict(extra="ignore")
    tenant_id: str = ""; client_id: str = ""; client_secret: str = ""
    sender_mailbox: str = ""; enabled: bool = False
class IntegrationSimpro(BaseModel):
    model_config = ConfigDict(extra="ignore")
    # Legacy OAuth 2.0 client-credentials fields (kept for backwards compat)
    build_name: str = ""; client_id: str = ""; client_secret: str = ""
    api_base_url: str = ""; enabled: bool = False
    # Phase 4 Part 2 — sync tracking (set by sync workers)
    last_sync_at: Optional[str] = None
    last_sync_status: Optional[Literal["ok","error"]] = None
    last_sync_error: Optional[str] = None
    last_sync_customers_count: int = 0
    last_sync_employees_count: int = 0
    last_test_at: Optional[str] = None
    last_test_status: Optional[Literal["ok","error","mocked"]] = None
    # Phase 11.7 — full Simpro settings mockup (personal-access-token flow)
    url: str = ""                                             # e.g. https://paneltec.simprosuite.com/
    company_ids: List[int] = Field(default_factory=lambda: [2, 3])
    api_token: str = ""
    whitelist_source_companies: List[int] = Field(default_factory=list)
    staff_custom_field: str = ""
    staff_field_value: str = ""
    position_filter: List[str] = Field(default_factory=list)
    sync_interval_minutes: int = 60
    auto_sync_enabled: bool = True
    completed_jobs_history_days: int = 30
class IntegrationNavixy(BaseModel):
    model_config = ConfigDict(extra="ignore")
    api_key: str = ""; api_base_url: str = "https://api.navixy.com/v2"
    account_id: str = ""; enabled: bool = False
class IntegrationXero(BaseModel):
    model_config = ConfigDict(extra="ignore")
    client_id: str = ""; client_secret: str = ""; tenant_id: str = ""
    redirect_uri: str = ""; enabled: bool = False
class IntegrationSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")   # tolerate root-level echo-back (e.g. `updated_at`)
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
    # Phase 7 — internal cost computation (always computed; stripped at endpoint per permission)
    mfg_labour_rate = float(panel.get("manufacturing_labour_per_m2") or 0.0)
    fin_labour_rate = float(finish.get("finishing_labour_per_m2") or 0.0)
    transport_rate = float(pricing.get("transport_cost_per_m2") or 0.0)
    overhead_pct = float(pricing.get("overhead_pct") or 0.0)
    concrete_cost_rate = float(pricing.get("concrete_cost_per_m3") or 0.0)
    steel_cost_rate = float(pricing.get("steel_cost_per_kg") or 0.0)
    total_steel_kg = steel_weight * qty
    net_area_total = net_area * qty
    cost_concrete = total_volume * concrete_cost_rate
    cost_steel = total_steel_kg * steel_cost_rate
    cost_mfg_labour = net_area_total * mfg_labour_rate
    cost_fin_labour = net_area_total * fin_labour_rate
    cost_transport = net_area_total * transport_rate
    cost_subtotal = cost_concrete + cost_steel + cost_mfg_labour + cost_fin_labour + cost_transport
    cost_overhead = cost_subtotal * (overhead_pct / 100.0)
    cost_total = cost_subtotal + cost_overhead
    margin_aud = subtotal_all - cost_total
    margin_pct = (margin_aud / subtotal_all * 100.0) if subtotal_all > 0 else 0.0
    internal_cost_breakdown = {
        "concrete_cost_aud": _round2(cost_concrete),
        "steel_cost_aud": _round2(cost_steel),
        "manufacturing_labour_aud": _round2(cost_mfg_labour),
        "finishing_labour_aud": _round2(cost_fin_labour),
        "transport_cost_aud": _round2(cost_transport),
        "subtotal_cost_aud": _round2(cost_subtotal),
        "overhead_aud": _round2(cost_overhead),
        "overhead_pct": overhead_pct,
        "total_cost_aud": _round2(cost_total),
        "margin_aud": _round2(margin_aud),
        "margin_pct": round(margin_pct, 1),
    }
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
        # Phase 7 — internal-only block; the endpoint strips this for users without pricing.view_costs
        "internal_cost_breakdown": internal_cost_breakdown,
    }

def build_quote_line(payload: QuoteLineInput, pricing: Dict[str, Any]) -> Dict[str, Any]:
    calc_req = CalculateRequest(**payload.model_dump(exclude={"description"}))
    result = compute_calculation(calc_req, pricing)
    icb = result.get("internal_cost_breakdown") or {}
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
        # Phase 7 — frozen internal cost snapshot. Stripped on read for users without pricing.view_costs.
        "cost_concrete_aud": icb.get("concrete_cost_aud", 0.0),
        "cost_steel_aud": icb.get("steel_cost_aud", 0.0),
        "cost_manufacturing_labour_aud": icb.get("manufacturing_labour_aud", 0.0),
        "cost_finishing_labour_aud": icb.get("finishing_labour_aud", 0.0),
        "cost_transport_aud": icb.get("transport_cost_aud", 0.0),
        "cost_overhead_aud": icb.get("overhead_aud", 0.0),
        "total_cost_aud": icb.get("total_cost_aud", 0.0),
        "margin_aud": icb.get("margin_aud", 0.0),
        "margin_pct": icb.get("margin_pct", 0.0),
    }

def recompute_totals(lines: List[Dict[str, Any]]) -> Dict[str, float]:
    sell_subtotal = _round2(sum(float(l["subtotal_aud"]) for l in lines))
    total_cost = _round2(sum(float(l.get("total_cost_aud") or 0.0) for l in lines))
    margin = _round2(sell_subtotal - total_cost)
    margin_pct = round((margin / sell_subtotal * 100.0), 1) if sell_subtotal > 0 else 0.0
    return {
        "subtotal": sell_subtotal,
        "gst": _round2(sum(float(l["gst_aud"]) for l in lines)),
        "total": _round2(sum(float(l["total_aud"]) for l in lines)),
        "total_volume_m3": round(sum(float(l["total_volume_m3"]) for l in lines), 4),
        "total_weight_kg": _round2(sum(float(l["total_weight_kg"]) for l in lines)),
        "total_weight_tonnes": round(sum(float(l["total_weight_kg"]) for l in lines)/1000.0, 3),
        # Phase 7 — quote-level cost/margin rollup (stored on the doc; stripped on read per perm)
        "total_cost_aud": total_cost,
        "margin_aud": margin,
        "margin_pct": margin_pct,
    }


# Phase 7 — keys to scrub from quote responses when caller lacks pricing.view_costs
_QUOTE_COST_KEYS_TOPLEVEL = {"total_cost_aud", "margin_aud", "margin_pct"}
_QUOTE_LINE_COST_KEYS = {
    "cost_concrete_aud", "cost_steel_aud", "cost_manufacturing_labour_aud",
    "cost_finishing_labour_aud", "cost_transport_aud", "cost_overhead_aud",
    "total_cost_aud", "margin_aud", "margin_pct",
}

def _strip_internal_costs_from_quote(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Remove every internal cost/margin key from a quote doc + its line_items in-place."""
    if not doc: return doc
    for k in _QUOTE_COST_KEYS_TOPLEVEL: doc.pop(k, None)
    for line in (doc.get("line_items") or []):
        for k in _QUOTE_LINE_COST_KEYS: line.pop(k, None)
    return doc


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
         "material_per_m2":97.0,"manufacturing_per_m2":112.0,"transport_install_per_m2":75.0,
         "manufacturing_labour_per_m2":35.0},
        {"key":"wall_load_bearing","label":"Wall Load-Bearing (200mm)","thickness_mm":200,
         "material_per_m2":127.0,"manufacturing_per_m2":135.0,"transport_install_per_m2":92.0,
         "manufacturing_labour_per_m2":42.0},
        {"key":"floor_slab","label":"Floor Slab (250mm)","thickness_mm":250,
         "material_per_m2":152.0,"manufacturing_per_m2":147.0,"transport_install_per_m2":105.0,
         "manufacturing_labour_per_m2":40.0},
        {"key":"hollow_core","label":"Hollow Core (200mm)","thickness_mm":200,
         "material_per_m2":110.0,"manufacturing_per_m2":122.0,"transport_install_per_m2":85.0,
         "manufacturing_labour_per_m2":32.0},
        {"key":"architectural_facade","label":"Architectural Facade","thickness_mm":150,
         "material_per_m2":185.0,"manufacturing_per_m2":230.0,"transport_install_per_m2":115.0,
         "manufacturing_labour_per_m2":65.0},
        {"key":"prestressed","label":"Prestressed","thickness_mm":200,
         "material_per_m2":160.0,"manufacturing_per_m2":175.0,"transport_install_per_m2":110.0,
         "manufacturing_labour_per_m2":55.0},
    ],
    "thickness_options_mm": [100, 150, 200, 250, 300],
    "concrete_grades": ["C25/30","C30/37","C35/45","C40/50","C50/60"],
    "finishes": [
        {"key":"smooth","label":"Smooth (Troweled)","multiplier":1.00,"finishing_labour_per_m2":5.0},
        {"key":"exposed_aggregate","label":"Exposed Aggregate","multiplier":1.15,"finishing_labour_per_m2":18.0},
        {"key":"acid_etched","label":"Acid-Etched","multiplier":1.20,"finishing_labour_per_m2":20.0},
        {"key":"sandblasted","label":"Sandblasted","multiplier":1.18,"finishing_labour_per_m2":15.0},
        {"key":"patterned","label":"Patterned/Embedded","multiplier":1.30,"finishing_labour_per_m2":25.0},
    ],
    # Phase 7 — internal cost inputs (never customer-facing)
    "concrete_cost_per_m3": 180.0,
    "steel_cost_per_kg": 1.50,
    "transport_cost_per_m2": 25.0,
    "overhead_pct": 12.0,
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
    "simpro": {"build_name":"","client_id":"","client_secret":"","api_base_url":"","enabled":False,
                "last_sync_at":None,"last_sync_status":None,"last_sync_error":None,
                "last_sync_customers_count":0,"last_sync_employees_count":0,
                "last_test_at":None,"last_test_status":None,
                # Phase 11.7 defaults matching the mockup
                "url":"https://paneltec.simprosuite.com/",
                "company_ids":[2, 3], "api_token":"",
                "whitelist_source_companies":[2, 3],
                "staff_custom_field":"Interactive Scheduler Status",
                "staff_field_value":"Assign This User To The White Board",
                "position_filter":["Construction Worker L1","Construction Worker","Construction Worker L2","Construction Worker L3","Construction Worker CW2"],
                "sync_interval_minutes":60,
                "auto_sync_enabled":True,
                "completed_jobs_history_days":30},
    "navixy": {"api_key":"","api_base_url":"https://api.navixy.com/v2","account_id":"","enabled":False},
    "xero": {"client_id":"","client_secret":"","tenant_id":"","redirect_uri":"","enabled":False},
}

SECRET_FIELDS = {
    "m365": {"client_secret"},
    "simpro": {"client_secret", "api_token"},
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
        # Ensure the Phase 4 Part 2 Simpro tracking fields survive round-trips
        # even if the stored doc predates them.
        if ikey == "simpro":
            for k, default in [("last_sync_at", None), ("last_sync_status", None),
                               ("last_sync_error", None),
                               ("last_sync_customers_count", 0),
                               ("last_sync_employees_count", 0),
                               ("last_test_at", None), ("last_test_status", None)]:
                section.setdefault(k, default)
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

    # ---------------------------------------------------------------------
    # Blocker #1 — Seed credential hygiene
    # In prod (SEED_MODE=prod), refuse to seed if the operator hasn't
    # explicitly set SEED_*_PASSWORD env vars. Never fall back to the
    # publicly-known defaults on a production DB.
    # ---------------------------------------------------------------------
    seed_mode = (os.environ.get("SEED_MODE") or "").lower().strip()
    prod_seed = seed_mode == "prod"
    default_pwds = {
        "SEED_ADMIN_PASSWORD": "Paneltec2026!",
        "SEED_STAFF_PASSWORD": "Staff2026!",
        "SEED_PROD_PASSWORD":  "Prod2026!",
    }
    if prod_seed:
        missing = [k for k in default_pwds if not os.environ.get(k)]
        if missing:
            logger.error("[seed] SEED_MODE=prod but %s env var(s) missing — refusing to seed default admin. Set them explicitly.",
                         ", ".join(missing))
            return

    def _pwd(env_key: str) -> str:
        v = os.environ.get(env_key)
        if v: return v
        if prod_seed:
            # Belt-and-braces — should already have exited above
            raise RuntimeError(f"[seed] {env_key} required in SEED_MODE=prod")
        return default_pwds[env_key]

    seed_users = [
        {"email": os.environ.get("SEED_ADMIN_EMAIL","admin@paneltec.com.au"),
         "password": _pwd("SEED_ADMIN_PASSWORD"),
         "name": "Paneltec Admin", "is_super_admin": True, "role_label": "Administrator",
         "permissions": {}},
        {"email": os.environ.get("SEED_STAFF_EMAIL","staff@paneltec.com.au"),
         "password": _pwd("SEED_STAFF_PASSWORD"),
         "name": "Paneltec Estimator", "is_super_admin": False, "role_label": "Estimator",
         "permissions": {p: True for p in PERMISSION_PRESETS["estimator"]["permissions"]}},
        {"email": os.environ.get("SEED_PROD_EMAIL","production@paneltec.com.au"),
         "password": _pwd("SEED_PROD_PASSWORD"),
         "name": "Paneltec Production", "is_super_admin": False, "role_label": "Production",
         "permissions": {p: True for p in PERMISSION_PRESETS["production"]["permissions"]}},
    ]
    # Belt-and-braces: warn loudly if a default password is still in use on the
    # existing hash (regardless of SEED_MODE).
    for s in seed_users:
        existing = await db.users.find_one({"email": s["email"]}, {"_id":0})
        if existing and verify_password(default_pwds.get(f"SEED_{s['role_label'][:5].upper()}_PASSWORD", ""),
                                          existing.get("password_hash","")):
            logger.warning("[security] Default seed password is still in use for %s — rotate immediately.", s["email"])

    for s in seed_users:
        existing = await db.users.find_one({"email": s["email"]})
        if existing is None:
            # New insert — force change-on-first-login unless dev mode explicitly opts out
            force_change = True if prod_seed else (os.environ.get("SEED_FORCE_CHANGE_PASSWORD","true").lower() == "true")
            await db.users.insert_one({
                "id": str(uuid.uuid4()), "email": s["email"],
                "password_hash": hash_password(s["password"]), "name": s["name"],
                "role": "admin" if s["is_super_admin"] else "staff",
                "is_super_admin": s["is_super_admin"],
                "role_label": s["role_label"],
                "permissions": s["permissions"],
                "must_change_password": force_change,
                "last_login_at": None,
                "is_active": True,
                "created_at": now_iso(), "updated_at": now_iso(),
                "created_by_user_id": "system", "updated_by_user_id": "system",
            })
            logger.info(f"Seeded user: {s['email']} ({s['role_label']}) · force_change={force_change}")
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
            # also keep seeded password aligned with env (so tests stay green in dev).
            # In prod, we NEVER reset a password to match .env — the operator
            # rotates via the app and .env should not undo that.
            if (not prod_seed) and (not verify_password(s["password"], existing["password_hash"])):
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
    else:
        # Phase 7 — backfill cost-input fields on existing pricing doc without overwriting any user edits
        existing = await db.settings.find_one({"key": "pricing"}, {"_id":0}) or {}
        patch: Dict[str, Any] = {}
        for k in ("concrete_cost_per_m3","steel_cost_per_kg","transport_cost_per_m2","overhead_pct"):
            if k not in existing: patch[k] = DEFAULT_PRICING[k]
        # panel_types: add manufacturing_labour_per_m2 if missing on any entry
        default_pt = {p["key"]: p for p in DEFAULT_PRICING["panel_types"]}
        existing_pts = existing.get("panel_types") or []
        pt_changed = False
        for pt in existing_pts:
            if "manufacturing_labour_per_m2" not in pt:
                pt["manufacturing_labour_per_m2"] = float((default_pt.get(pt.get("key"), {}) or {}).get("manufacturing_labour_per_m2", 0.0))
                pt_changed = True
        if pt_changed: patch["panel_types"] = existing_pts
        # finishes: add finishing_labour_per_m2 if missing
        default_fin = {f["key"]: f for f in DEFAULT_PRICING["finishes"]}
        existing_fins = existing.get("finishes") or []
        fin_changed = False
        for fin in existing_fins:
            if "finishing_labour_per_m2" not in fin:
                fin["finishing_labour_per_m2"] = float((default_fin.get(fin.get("key"), {}) or {}).get("finishing_labour_per_m2", 0.0))
                fin_changed = True
        if fin_changed: patch["finishes"] = existing_fins
        if patch:
            patch["updated_at"] = now_iso()
            await db.settings.update_one({"key": "pricing"}, {"$set": patch})
            logger.info(f"Backfilled pricing cost fields: {list(patch.keys())}")
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



    # Phase 6: seed vehicles + employees if empty, preserving previous MOCK ids
    if await db.vehicles.count_documents({}) == 0:
        mocks = [
            {"id":"v-001","vehicle_code":"V-001","make_model":"Kenworth K200 Prime Mover","rego":"BX12-AC","capacity_tonnes":42.0,"status":"available","notes":""},
            {"id":"v-002","vehicle_code":"V-002","make_model":"Volvo FH16 Tilt-tray","rego":"BX84-RT","capacity_tonnes":36.0,"status":"on_delivery","notes":""},
            {"id":"v-003","vehicle_code":"V-003","make_model":"Mercedes Actros Crane Truck","rego":"BX02-MK","capacity_tonnes":28.0,"status":"maintenance","notes":""},
            {"id":"v-004","vehicle_code":"V-004","make_model":"Hino 700 Series Flatbed","rego":"BX55-HQ","capacity_tonnes":24.0,"status":"available","notes":""},
            {"id":"v-005","vehicle_code":"V-005","make_model":"Scania R620 B-Double","rego":"BX91-SC","capacity_tonnes":48.0,"status":"available","notes":""},
        ]
        for v in mocks: v.update({"source":"MOCKED_NAVIXY","is_active":True,"deleted_at":None,
            "deleted_by_user_id":None,"created_at":now_iso(),"updated_at":now_iso(),
            "created_by_user_id":"system","updated_by_user_id":"system"})
        await db.vehicles.insert_many(mocks)
    if await db.employees.count_documents({}) == 0:
        mocks = [
            {"id":"e-001","name":"Mark Henderson","role":"Production Manager","email":"mark.h@paneltec.com.au","phone":"0411 222 333"},
            {"id":"e-002","name":"Sarah Chen","role":"Foreman","email":"sarah.c@paneltec.com.au","phone":"0412 333 444"},
            {"id":"e-003","name":"Daniel O'Brien","role":"Crane Operator","email":"daniel.o@paneltec.com.au","phone":"0413 444 555"},
            {"id":"e-004","name":"Priya Patel","role":"Estimator","email":"priya.p@paneltec.com.au","phone":"0414 555 666"},
            {"id":"e-005","name":"Liam Walsh","role":"Driver","email":"liam.w@paneltec.com.au","phone":"0415 666 777"},
            {"id":"e-006","name":"Aisha Mohamed","role":"Driver","email":"aisha.m@paneltec.com.au","phone":"0416 777 888"},
        ]
        for e in mocks: e.update({"notes":"","source":"MOCKED_SIMPRO","is_active":True,"deleted_at":None,
            "deleted_by_user_id":None,"created_at":now_iso(),"updated_at":now_iso(),
            "created_by_user_id":"system","updated_by_user_id":"system"})
        await db.employees.insert_many(mocks)
    # Phase 6: audit indexes
    try:
        await db.audit_events.create_index([("timestamp",-1)])
        await db.audit_events.create_index([("actor_user_id",1)])
        await db.audit_events.create_index([("entity_type",1),("entity_id",1)])
        await db.audit_events.create_index([("action",1)])
    except Exception as _e:
        logger.warning(f"audit index creation skipped: {_e}")
    # Phase 8 Pass 3: BI token indexes
    try:
        await db.bi_api_tokens.create_index([("revoked_at",1)])
        await db.bi_api_tokens.create_index([("created_at",-1)])
    except Exception as _e:
        logger.warning(f"bi_api_tokens index creation skipped: {_e}")
    # Phase 10: compliance forms indexes + seed
    try:
        await db.compliance_forms.create_index([("created_at",-1)])
        await db.compliance_forms.create_index([("form_type",1),("status",1)])
        await db.compliance_forms.create_index("job_id")
        await db.compliance_forms.create_index("form_number", unique=True)
    except Exception as _e:
        logger.warning(f"compliance_forms index creation skipped: {_e}")
    try:
        await _seed_compliance_forms()
    except Exception as _e:
        logger.warning(f"compliance_forms seed skipped: {_e}")
    # Phase 11 Pass 1: seed templates + backfill template refs on existing forms
    try:
        await db.compliance_form_templates.create_index("code", unique=True)
        await db.compliance_form_templates.create_index([("active",1),("is_system",-1)])
    except Exception as _e:
        logger.warning(f"compliance_form_templates index creation skipped: {_e}")
    try:
        await _seed_compliance_templates()
        await _backfill_form_template_refs()
    except Exception as _e:
        logger.warning(f"compliance_form_templates seed/backfill skipped: {_e}")

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
        await _transition_job_internal(job["id"], tgt, "Seed: demo progression", admin_id,
                                        enforce_holdpoints=False)

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


# ===========================================================================
# Phase 6 — Audit trail + soft-delete helpers
# ===========================================================================
AUDIT_ACTIONS = {"created","updated","soft_deleted","hard_deleted","restored","status_changed",
    "login_success","login_failed","login_rate_limited","password_changed","password_reset","permission_changed",
    "quote_sent","quote_viewed","quote_accepted","quote_rejected","quote_revised",
    "invoice_issued","invoice_paid","invoice_pushed_xero","email_sent","settings_changed",
    "audit_row_hidden","audit_row_unhidden","system_cleanup_mock_employees",
    "simpro_customer_sync","simpro_employee_sync"}
AUDIT_ENTITY_TYPES = {"customer","project","quote","job","invoice","vehicle","employee",
    "user","pricing_settings","company_settings","integration_settings","system","bi_api_token","compliance_form","audit_event","admin_settings"}
AUDIT_SECRET_KEYS = {"client_secret","api_key","password","password_hash"}

async def record_audit(actor: Optional[dict], action: str, entity_type: str,
                        entity_id: Optional[str], entity_label: str,
                        changes: Optional[dict] = None, metadata: Optional[dict] = None):
    try:
        # redact secret fields recursively (1-level shallow + nested sections)
        def _redact(obj):
            if not isinstance(obj, dict): return obj
            out = {}
            for k, v in obj.items():
                if k in AUDIT_SECRET_KEYS:
                    out[k] = {"from":"<redacted>","to":"<redacted>"} if isinstance(v, dict) else "<redacted>"
                elif isinstance(v, dict):
                    # nested diff form {from, to}
                    if set(v.keys()) == {"from","to"}:
                        if k in AUDIT_SECRET_KEYS:
                            out[k] = {"from":"<redacted>","to":"<redacted>"}
                        else: out[k] = v
                    else:
                        out[k] = _redact(v)
                else: out[k] = v
            return out
        actor_email = (actor or {}).get("email", "system")
        actor_name  = (actor or {}).get("name", "System")
        await db.audit_events.insert_one({
            "id": str(uuid.uuid4()), "timestamp": now_iso(),
            "actor_user_id": (actor or {}).get("id"),
            "actor_email": actor_email, "actor_name": actor_name,
            "action": action, "entity_type": entity_type,
            "entity_id": entity_id, "entity_label": entity_label,
            "changes": _redact(changes) if changes else None,
            "metadata": metadata or {},
        })
    except Exception as e:
        logger.error(f"record_audit failed: {e}")

def shallow_diff(before: dict, after: dict, keys: Optional[List[str]] = None) -> dict:
    out = {}
    keys = keys or list(set((before or {}).keys()) | set((after or {}).keys()))
    for k in keys:
        a, b = (before or {}).get(k), (after or {}).get(k)
        if a != b: out[k] = {"from": a, "to": b}
    return out

# Soft-delete helpers for non-user entities (consistent shape).
async def soft_delete_doc(coll, doc_id: str, actor: dict, label_field: str,
                           entity_type: str) -> dict:
    doc = await coll.find_one({"id": doc_id}, {"_id":0})
    if not doc: raise HTTPException(status_code=404, detail=f"{entity_type} not found")
    if doc.get("deleted_at"): raise HTTPException(status_code=400, detail=f"{entity_type} already deleted")
    await coll.update_one({"id": doc_id}, {"$set": {"deleted_at": now_iso(),
        "deleted_by_user_id": actor["id"], "updated_at": now_iso(), "updated_by_user_id": actor["id"]}})
    await record_audit(actor, "soft_deleted", entity_type, doc_id, str(doc.get(label_field, doc_id)))
    return {"soft_deleted": True}

async def restore_doc(coll, doc_id: str, actor: dict, label_field: str, entity_type: str) -> dict:
    doc = await coll.find_one({"id": doc_id}, {"_id":0})
    if not doc: raise HTTPException(status_code=404, detail=f"{entity_type} not found")
    if not doc.get("deleted_at"): raise HTTPException(status_code=400, detail=f"{entity_type} is not deleted")
    await coll.update_one({"id": doc_id}, {"$set": {"deleted_at": None, "deleted_by_user_id": None,
        "updated_at": now_iso(), "updated_by_user_id": actor["id"]}})
    fresh = await coll.find_one({"id": doc_id}, {"_id":0})
    await record_audit(actor, "restored", entity_type, doc_id, str(fresh.get(label_field, doc_id)))
    return fresh

def status_filter_q(status: str, *, has_is_active: bool = False) -> Dict[str, Any]:
    s = (status or "active").lower()
    if s == "active":
        q = {"deleted_at": {"$in": [None]}}
        if has_is_active: q["is_active"] = True
        return q
    if s == "inactive":
        if not has_is_active: raise HTTPException(status_code=400, detail="No inactive state for this entity")
        return {"is_active": False, "deleted_at": {"$in": [None]}}
    if s == "deleted": return {"deleted_at": {"$ne": None}}
    if s == "all":     return {}
    raise HTTPException(status_code=400, detail="status must be one of active|inactive|deleted|all")

# Reference counters per entity
async def refs_customer(cid: str) -> Dict[str,int]:
    return {
        "projects":  await db.projects.count_documents({"customer_id": cid}),
        "quotes":    await db.quotes.count_documents({"customer_id": cid}),
        "jobs":      await db.jobs.count_documents({"customer_id": cid}),
        "invoices":  await db.invoices.count_documents({"customer_id": cid}),
    }
async def refs_project(pid: str) -> Dict[str,int]:
    return {
        "quotes":   await db.quotes.count_documents({"project_id": pid}),
        "jobs":     await db.jobs.count_documents({"project_id": pid}),
        "invoices": await db.invoices.count_documents({"project_id": pid}),
    }
async def refs_quote(qid: str) -> Dict[str,int]:
    return {
        "jobs":           await db.jobs.count_documents({"quote_id": qid}),
        "revised_from":   await db.quotes.count_documents({"revised_from_quote_id": qid}),
    }
async def refs_job(jid: str) -> Dict[str,int]:
    return {"invoices": await db.invoices.count_documents({"job_id": jid})}
async def refs_invoice(iid: str) -> Dict[str,int]:
    inv = await db.invoices.find_one({"id": iid}, {"_id":0})
    if not inv: return {}
    blockers = {}
    status = inv.get("status","draft")
    if status not in ("draft","cancelled"): blockers["status_not_draft_or_cancelled"] = 1
    if (inv.get("paid_amount") or 0) > 0:  blockers["has_payment"] = 1
    if inv.get("xero_push_status") == "MOCKED_PUSHED": blockers["pushed_to_xero"] = 1
    return blockers
async def refs_vehicle(vid: str) -> Dict[str,int]:
    return {"job_assignments": await db.jobs.count_documents({"assigned_vehicle_id": vid})}
async def refs_employee(eid: str) -> Dict[str,int]:
    return {"job_assignments": await db.jobs.count_documents({"assigned_employee_ids": eid})}

REF_FN = {"customer": refs_customer, "project": refs_project, "quote": refs_quote,
          "job": refs_job, "invoice": refs_invoice, "vehicle": refs_vehicle, "employee": refs_employee}

async def hard_delete_with_refs(coll, doc_id: str, actor: dict, entity_type: str,
                                  label_field: str) -> dict:
    doc = await coll.find_one({"id": doc_id}, {"_id":0})
    if not doc: raise HTTPException(status_code=404, detail=f"{entity_type} not found")
    refs = await REF_FN[entity_type](doc_id)
    if sum(refs.values()) > 0:
        raise HTTPException(status_code=400, detail={
            "message": f"Cannot permanently delete — {entity_type} has historical references",
            "references": refs, "suggestion": "Use soft delete instead"})
    await coll.delete_one({"id": doc_id})
    await record_audit(actor, "hard_deleted", entity_type, doc_id, str(doc.get(label_field, doc_id)))
    return {"permanently_deleted": True}


# ===========================================================================
# Universal references + delete + restore endpoints (5 business entities)
# ===========================================================================
async def _generic_references(entity_type, eid, label_field, coll, _admin):
    doc = await coll.find_one({"id": eid}, {"_id":0})
    if not doc: raise HTTPException(status_code=404, detail=f"{entity_type} not found")
    refs = await REF_FN[entity_type](eid)
    return {"entity_id": eid, "entity_label": str(doc.get(label_field, eid)),
            "references": refs, "total": sum(refs.values())}

@api_router.get("/customers/{cid}/references")
async def customer_refs(cid: str, admin: dict = Depends(require_super_admin)):
    return await _generic_references("customer", cid, "company_name", db.customers, admin)
@api_router.get("/projects/{pid}/references")
async def project_refs(pid: str, admin: dict = Depends(require_super_admin)):
    return await _generic_references("project", pid, "project_name", db.projects, admin)
@api_router.get("/quotes/{qid}/references")
async def quote_refs(qid: str, admin: dict = Depends(require_super_admin)):
    return await _generic_references("quote", qid, "quote_number", db.quotes, admin)
@api_router.get("/jobs/{jid}/references")
async def job_refs(jid: str, admin: dict = Depends(require_super_admin)):
    return await _generic_references("job", jid, "job_number", db.jobs, admin)
@api_router.get("/invoices/{iid}/references")
async def invoice_refs(iid: str, admin: dict = Depends(require_super_admin)):
    return await _generic_references("invoice", iid, "invoice_number", db.invoices, admin)

@api_router.delete("/quotes/{qid}")
async def del_quote(qid: str, permanent: bool = Query(False), actor: dict = Depends(require_permission("quotes.delete"))):
    if permanent:
        if not actor.get("is_super_admin"): raise HTTPException(status_code=403, detail="Super admin required for permanent delete")
        return await hard_delete_with_refs(db.quotes, qid, actor, "quote", "quote_number")
    return await soft_delete_doc(db.quotes, qid, actor, "quote_number", "quote")

@api_router.post("/quotes/{qid}/restore")
async def rest_quote(qid: str, actor: dict = Depends(require_permission("quotes.delete"))):
    return await restore_doc(db.quotes, qid, actor, "quote_number", "quote")

@api_router.delete("/jobs/{jid}")
async def del_job(jid: str, permanent: bool = Query(False), actor: dict = Depends(require_permission("jobs.delete"))):
    if permanent:
        if not actor.get("is_super_admin"): raise HTTPException(status_code=403, detail="Super admin required for permanent delete")
        return await hard_delete_with_refs(db.jobs, jid, actor, "job", "job_number")
    return await soft_delete_doc(db.jobs, jid, actor, "job_number", "job")

@api_router.post("/jobs/{jid}/restore")
async def rest_job(jid: str, actor: dict = Depends(require_permission("jobs.delete"))):
    return await restore_doc(db.jobs, jid, actor, "job_number", "job")

@api_router.delete("/invoices/{iid}")
async def del_invoice(iid: str, permanent: bool = Query(False), actor: dict = Depends(require_permission("invoices.delete"))):
    if permanent:
        if not actor.get("is_super_admin"): raise HTTPException(status_code=403, detail="Super admin required for permanent delete")
        return await hard_delete_with_refs(db.invoices, iid, actor, "invoice", "invoice_number")
    return await soft_delete_doc(db.invoices, iid, actor, "invoice_number", "invoice")

@api_router.post("/invoices/{iid}/restore")
async def rest_invoice(iid: str, actor: dict = Depends(require_permission("invoices.delete"))):
    return await restore_doc(db.invoices, iid, actor, "invoice_number", "invoice")

@api_router.post("/customers/{cid}/restore")
async def rest_customer(cid: str, actor: dict = Depends(require_permission("customers.delete"))):
    return await restore_doc(db.customers, cid, actor, "company_name", "customer")

@api_router.post("/projects/{pid}/restore")
async def rest_project(pid: str, actor: dict = Depends(require_permission("projects.delete"))):
    return await restore_doc(db.projects, pid, actor, "project_name", "project")


# ===========================================================================
# Vehicles + Employees CRUD (DB-backed, Phase 6)
# ===========================================================================
class VehicleIn(BaseModel):
    make_model: str = Field(min_length=1); rego: str = ""
    capacity_tonnes: float = 0.0; status: str = "available"; notes: str = ""
    vehicle_code: Optional[str] = None
class EmployeeIn(BaseModel):
    name: str = Field(min_length=1); role: str = ""; email: str = ""; phone: str = ""; notes: str = ""

async def _next_vehicle_code() -> str:
    count = await db.vehicles.count_documents({})
    return f"V-{count+1:03d}"

@api_router.post("/vehicles", status_code=201)
async def create_vehicle(payload: VehicleIn, actor: dict = Depends(require_permission("vehicles.create"))):
    code = (payload.vehicle_code or "").strip()
    if code:
        if await db.vehicles.find_one({"vehicle_code": code}):
            raise HTTPException(status_code=400, detail=f"vehicle_code '{code}' already exists")
    else:
        code = await _next_vehicle_code()
    body = payload.model_dump(); body.pop("vehicle_code", None)
    doc = {**body, "id": str(uuid.uuid4()),
        "vehicle_code": code, "source": "MANUAL",
        "is_active": True, "deleted_at": None, "deleted_by_user_id": None,
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by_user_id": actor["id"], "updated_by_user_id": actor["id"]}
    await db.vehicles.insert_one(doc); doc.pop("_id", None)
    await record_audit(actor, "created", "vehicle", doc["id"], doc["vehicle_code"])
    return doc

@api_router.get("/vehicles/{vid}")
async def get_vehicle(vid: str, _u: dict = Depends(require_permission("vehicles.view"))):
    v = await db.vehicles.find_one({"id": vid}, {"_id":0})
    if not v: raise HTTPException(status_code=404, detail="Vehicle not found")
    return v

@api_router.patch("/vehicles/{vid}")
async def update_vehicle(vid: str, payload: VehicleIn, actor: dict = Depends(require_permission("vehicles.edit"))):
    cur = await db.vehicles.find_one({"id": vid}, {"_id":0})
    if not cur: raise HTTPException(status_code=404, detail="Vehicle not found")
    data = payload.model_dump()
    diff = shallow_diff(cur, data, list(data.keys()))
    data["updated_at"] = now_iso(); data["updated_by_user_id"] = actor["id"]
    await db.vehicles.update_one({"id": vid}, {"$set": data})
    if diff: await record_audit(actor, "updated", "vehicle", vid, cur.get("vehicle_code", vid), changes=diff)
    return await db.vehicles.find_one({"id": vid}, {"_id":0})

@api_router.delete("/vehicles/{vid}")
async def del_vehicle(vid: str, permanent: bool = Query(False), actor: dict = Depends(require_permission("vehicles.delete"))):
    if permanent:
        if not actor.get("is_super_admin"): raise HTTPException(status_code=403, detail="Super admin required for permanent delete")
        return await hard_delete_with_refs(db.vehicles, vid, actor, "vehicle", "vehicle_code")
    return await soft_delete_doc(db.vehicles, vid, actor, "vehicle_code", "vehicle")

@api_router.post("/vehicles/{vid}/restore")
async def rest_vehicle(vid: str, actor: dict = Depends(require_permission("vehicles.delete"))):
    return await restore_doc(db.vehicles, vid, actor, "vehicle_code", "vehicle")

@api_router.get("/vehicles/{vid}/references")
async def vehicle_refs_ep(vid: str, admin: dict = Depends(require_super_admin)):
    return await _generic_references("vehicle", vid, "vehicle_code", db.vehicles, admin)

@api_router.post("/employees", status_code=201)
async def create_employee(payload: EmployeeIn, actor: dict = Depends(require_permission("employees.create"))):
    doc = {**payload.model_dump(), "id": str(uuid.uuid4()), "source": "MANUAL",
        "is_active": True, "deleted_at": None, "deleted_by_user_id": None,
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by_user_id": actor["id"], "updated_by_user_id": actor["id"]}
    await db.employees.insert_one(doc); doc.pop("_id", None)
    await record_audit(actor, "created", "employee", doc["id"], doc["name"])
    return doc

@api_router.get("/employees/{eid}")
async def get_employee(eid: str, _u: dict = Depends(require_permission("employees.view"))):
    e = await db.employees.find_one({"id": eid}, {"_id":0})
    if not e: raise HTTPException(status_code=404, detail="Employee not found")
    return e

@api_router.patch("/employees/{eid}")
async def update_employee(eid: str, payload: EmployeeIn, actor: dict = Depends(require_permission("employees.edit"))):
    cur = await db.employees.find_one({"id": eid}, {"_id":0})
    if not cur: raise HTTPException(status_code=404, detail="Employee not found")
    data = payload.model_dump()
    diff = shallow_diff(cur, data, list(data.keys()))
    data["updated_at"] = now_iso(); data["updated_by_user_id"] = actor["id"]
    await db.employees.update_one({"id": eid}, {"$set": data})
    if diff: await record_audit(actor, "updated", "employee", eid, cur.get("name", eid), changes=diff)
    return await db.employees.find_one({"id": eid}, {"_id":0})

@api_router.delete("/employees/{eid}")
async def del_employee(eid: str, permanent: bool = Query(False), actor: dict = Depends(require_permission("employees.delete"))):
    if permanent:
        if not actor.get("is_super_admin"): raise HTTPException(status_code=403, detail="Super admin required for permanent delete")
        return await hard_delete_with_refs(db.employees, eid, actor, "employee", "name")
    result = await soft_delete_doc(db.employees, eid, actor, "name", "employee")
    # Phase 11.7.2 — flag Simpro-sourced employees as excluded so a future
    # sync doesn't resurrect them.
    await db.employees.update_one({"id": eid}, {"$set": {"excluded_from_sync": True}})
    return result

@api_router.post("/employees/{eid}/restore")
async def rest_employee(eid: str, actor: dict = Depends(require_permission("employees.delete"))):
    result = await restore_doc(db.employees, eid, actor, "name", "employee")
    # Restoring re-enables sync eligibility.
    await db.employees.update_one({"id": eid}, {"$set": {"excluded_from_sync": False}})
    return result

@api_router.get("/employees/{eid}/references")
async def employee_refs_ep(eid: str, admin: dict = Depends(require_super_admin)):
    return await _generic_references("employee", eid, "name", db.employees, admin)


# ===========================================================================
# Audit endpoints
# ===========================================================================
async def _resolve_user_lite(uid: Optional[str], cache: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return a small user reference for display: {id, name, email, is_deleted, exists}.
    Returns None when uid is None/empty/'system'. Returns {exists:False} for missing/hard-deleted users."""
    if not uid: return None
    if uid == "system":
        return {"id": "system", "name": "System", "email": "", "is_deleted": False, "exists": True}
    if uid in cache: return cache[uid]
    doc = await db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "name": 1, "email": 1, "deleted_at": 1})
    if not doc:
        out = {"id": uid, "name": None, "email": None, "is_deleted": True, "exists": False}
    else:
        out = {"id": doc["id"], "name": doc.get("name") or "", "email": doc.get("email") or "",
               "is_deleted": bool(doc.get("deleted_at")), "exists": True}
    cache[uid] = out
    return out

async def populate_user_refs(doc: Dict[str, Any], fields: List[str], cache: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """For each UUID-valued field on doc, attach `<field>_user`={id,name,email,is_deleted,exists}.
    Mutates and returns the doc."""
    if not doc: return doc
    cache = cache if cache is not None else {}
    for f in fields:
        uid = doc.get(f)
        doc[f"{f}_user"] = await _resolve_user_lite(uid, cache)
    return doc

# Default user-ref fields for each entity type
_USER_REF_FIELDS = {
    "quote":    ["created_by", "last_email_sent_by_user_id"],
    "job":      ["created_by", "cancelled_by"],
    "invoice":  ["created_by", "last_email_sent_by_user_id", "last_xero_push_by_user_id"],
    "customer": ["created_by_user_id", "updated_by_user_id", "deleted_by_user_id"],
    "project":  ["created_by_user_id", "updated_by_user_id", "deleted_by_user_id"],
}


@api_router.get("/audit")
async def list_audit(user: dict = Depends(require_permission("audit.view")),
                      date_from: Optional[str] = None, date_to: Optional[str] = None,
                      actor: Optional[str] = None, action: Optional[str] = None,
                      entity_type: Optional[str] = None, search: Optional[str] = None,
                      show_hidden: bool = Query(False),
                      page: int = Query(1, ge=1), per_page: int = Query(50, ge=1, le=200)):
    q: Dict[str, Any] = {}
    if date_from: q.setdefault("timestamp", {})["$gte"] = date_from
    if date_to:   q.setdefault("timestamp", {})["$lte"] = date_to
    if actor:        q["actor_user_id"] = {"$in": actor.split(",")}
    if action:       q["action"]        = {"$in": action.split(",")}
    if entity_type:  q["entity_type"]   = {"$in": entity_type.split(",")}
    if search:
        rx = {"$regex": re.escape(search), "$options": "i"}
        q["$or"] = [{"entity_label": rx},{"actor_email": rx},{"actor_name": rx}]
    # Blocker-hardening: hide "hidden_from_view" rows unless super admin flips the toggle.
    if show_hidden:
        if not user.get("is_super_admin"):
            raise HTTPException(status_code=403, detail="Only super admins can view hidden audit rows.")
    else:
        q["hidden_from_view"] = {"$ne": True}
    total = await db.audit_events.count_documents(q)
    skip = (page-1)*per_page
    items = await db.audit_events.find(q, {"_id":0}).sort("timestamp",-1).skip(skip).limit(per_page).to_list(per_page)
    return {"items": items, "total": total, "page": page, "per_page": per_page}

_META_AUDIT_ACTIONS = {"audit_row_hidden", "audit_row_unhidden"}

class AuditHidePayload(BaseModel):
    event_ids: List[str] = Field(min_length=1, max_length=500)

@api_router.post("/audit/hide")
async def audit_hide(payload: AuditHidePayload, user: dict = Depends(require_super_admin)):
    """Flag audit rows as hidden-from-view. Non-destructive — rows remain in
    the DB and are exportable. Each hidden row produces an immutable
    `audit_row_hidden` meta-event. Meta-events themselves cannot be hidden."""
    rows = await db.audit_events.find(
        {"id": {"$in": payload.event_ids}}, {"_id": 0}
    ).to_list(len(payload.event_ids))
    found_ids = {r["id"] for r in rows}
    missing = [i for i in payload.event_ids if i not in found_ids]
    if missing:
        raise HTTPException(status_code=404,
            detail=f"Audit event(s) not found: {', '.join(missing[:5])}{' …' if len(missing)>5 else ''}")
    meta_rows = [r for r in rows if r.get("action") in _META_AUDIT_ACTIONS]
    if meta_rows:
        raise HTTPException(status_code=400,
            detail=f"Refusing to hide meta-audit events (action={sorted({r['action'] for r in meta_rows})[0]}). Meta-audit is immutable.")
    ts = now_iso()
    await db.audit_events.update_many(
        {"id": {"$in": payload.event_ids}, "hidden_from_view": {"$ne": True}},
        {"$set": {"hidden_from_view": True, "hidden_at": ts, "hidden_by_user_id": user["id"]}}
    )
    # Write one meta-event per hidden row so the hiding action is itself audit-trailed.
    for r in rows:
        await record_audit(user, "audit_row_hidden", "audit_event", r["id"],
                            r.get("entity_label") or r.get("action") or r["id"],
                            metadata={"hidden_event_id": r["id"],
                                       "hidden_event_action": r.get("action"),
                                       "hidden_event_actor": r.get("actor_email"),
                                       "hidden_event_timestamp": r.get("timestamp")})
    return {"hidden": len(rows), "hidden_at": ts, "hidden_by_user_id": user["id"]}

@api_router.post("/audit/unhide")
async def audit_unhide(payload: AuditHidePayload, user: dict = Depends(require_super_admin)):
    """Reverse an earlier hide. Meta-events themselves cannot be un-hidden."""
    rows = await db.audit_events.find(
        {"id": {"$in": payload.event_ids}}, {"_id": 0}
    ).to_list(len(payload.event_ids))
    found_ids = {r["id"] for r in rows}
    missing = [i for i in payload.event_ids if i not in found_ids]
    if missing:
        raise HTTPException(status_code=404,
            detail=f"Audit event(s) not found: {', '.join(missing[:5])}{' …' if len(missing)>5 else ''}")
    meta_rows = [r for r in rows if r.get("action") in _META_AUDIT_ACTIONS]
    if meta_rows:
        raise HTTPException(status_code=400,
            detail=f"Refusing to un-hide meta-audit events (action={sorted({r['action'] for r in meta_rows})[0]}). Meta-audit is immutable.")
    await db.audit_events.update_many(
        {"id": {"$in": payload.event_ids}, "hidden_from_view": True},
        {"$unset": {"hidden_from_view": "", "hidden_at": "", "hidden_by_user_id": ""}}
    )
    for r in rows:
        await record_audit(user, "audit_row_unhidden", "audit_event", r["id"],
                            r.get("entity_label") or r.get("action") or r["id"],
                            metadata={"hidden_event_id": r["id"],
                                       "hidden_event_action": r.get("action"),
                                       "hidden_event_actor": r.get("actor_email"),
                                       "hidden_event_timestamp": r.get("timestamp")})
    return {"unhidden": len(rows)}

@api_router.get("/audit/recent")
async def audit_recent(_u: dict = Depends(require_permission("audit.view")),
                        limit: int = Query(10, ge=1, le=50)):
    """Convenience endpoint for the Dashboard Recent Activity widget.
    Returns the last N events plus a today-counts summary by action."""
    items = await db.audit_events.find({}, {"_id":0}).sort("timestamp",-1).limit(limit).to_list(limit)
    start_today = datetime(now_utc().year, now_utc().month, now_utc().day, tzinfo=timezone.utc).isoformat()
    summary_actions = ["quote_sent","quote_accepted","quote_rejected","invoice_issued","invoice_paid",
                       "invoice_pushed_xero","status_changed","login_success","created","soft_deleted","restored","email_sent"]
    today_summary: Dict[str, int] = {}
    for a in summary_actions:
        c = await db.audit_events.count_documents({"action": a, "timestamp": {"$gte": start_today}})
        if c > 0: today_summary[a] = c
    return {"items": items, "today_summary": today_summary, "today_start": start_today}

@api_router.get("/audit/export.csv")
async def export_audit(_u: dict = Depends(require_permission("audit.view")),
                        date_from: Optional[str] = None, date_to: Optional[str] = None,
                        actor: Optional[str] = None, action: Optional[str] = None,
                        entity_type: Optional[str] = None, search: Optional[str] = None):
    import csv, io, json as _json
    q: Dict[str, Any] = {}
    if date_from: q.setdefault("timestamp", {})["$gte"] = date_from
    if date_to:   q.setdefault("timestamp", {})["$lte"] = date_to
    if actor:        q["actor_user_id"] = {"$in": actor.split(",")}
    if action:       q["action"]        = {"$in": action.split(",")}
    if entity_type:  q["entity_type"]   = {"$in": entity_type.split(",")}
    if search:
        rx = {"$regex": re.escape(search), "$options": "i"}
        q["$or"] = [{"entity_label": rx},{"actor_email": rx},{"actor_name": rx}]
    items = await db.audit_events.find(q, {"_id":0}).sort("timestamp",-1).limit(10000).to_list(10000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["timestamp","actor_email","actor_name","action","entity_type","entity_id","entity_label","changes_json","metadata_json"])
    for e in items:
        w.writerow([e["timestamp"], e["actor_email"], e["actor_name"], e["action"],
                    e["entity_type"], e.get("entity_id",""), e.get("entity_label",""),
                    _json.dumps(e.get("changes") or {}, default=str),
                    _json.dumps(e.get("metadata") or {}, default=str)])
    return Response(content=buf.getvalue(), media_type="text/csv",
                     headers={"Content-Disposition": "attachment; filename=audit.csv"})

@api_router.get("/audit/{event_id}")
async def get_audit(event_id: str, _u: dict = Depends(require_permission("audit.view"))):
    e = await db.audit_events.find_one({"id": event_id}, {"_id":0})
    if not e: raise HTTPException(status_code=404, detail="Audit event not found")
    return e

# ---------------------------------------------------------------------------
# Login brute-force protection (Blocker #2)
# Sliding-window rate limiter, in-memory, per (ip, email_lowercased).
# Reset on 200 success. 5 fails / 15 min → HTTP 429.
# Additionally: 15-second cool-down per-IP on rapid successive attempts to slow
# scripted attackers before they hit the 5-fail threshold.
# ---------------------------------------------------------------------------
_LOGIN_MAX_FAILS = int(os.environ.get("LOGIN_MAX_FAILS", "5"))
_LOGIN_WINDOW_SEC = int(os.environ.get("LOGIN_WINDOW_SEC", "900"))         # 15 min
_LOGIN_IP_COOLDOWN_SEC = int(os.environ.get("LOGIN_IP_COOLDOWN_SEC", "15"))
_login_fails: Dict[Tuple[str, str], List[float]] = {}   # (ip,email) -> [ts,…]
_login_ip_last: Dict[str, float] = {}                   # ip -> last-attempt-ts

def _login_rate_check(ip: str, email: str) -> Dict[str, Any]:
    """Return {'ok': bool, 'detail': str, 'reason': str, 'attempts': int, 'cooldown': int, 'window_started_at': str|None}"""
    import time
    now = time.time()
    # Per-IP micro cool-down (slows scripts across many emails)
    last_ip = _login_ip_last.get(ip)
    if last_ip is not None:
        elapsed = now - last_ip
        if elapsed < _LOGIN_IP_COOLDOWN_SEC:
            wait = int(_LOGIN_IP_COOLDOWN_SEC - elapsed) + 1
            _login_ip_last[ip] = now
            return {"ok": False, "reason": "ip_cooldown", "attempts": 0, "cooldown": wait,
                    "window_started_at": None,
                    "detail": f"Please wait {wait} seconds before trying again."}
    _login_ip_last[ip] = now
    # Sliding-window per (ip,email)
    key = (ip, email)
    hits = _login_fails.get(key) or []
    cutoff = now - _LOGIN_WINDOW_SEC
    hits = [t for t in hits if t > cutoff]
    _login_fails[key] = hits
    if len(hits) >= _LOGIN_MAX_FAILS:
        oldest = hits[0]
        wait = int(_LOGIN_WINDOW_SEC - (now - oldest)) + 1
        wait_min = max(1, wait // 60)
        return {"ok": False, "reason": "too_many_fails", "attempts": len(hits),
                "cooldown": wait,
                "window_started_at": _iso_from_epoch(oldest),
                "detail": f"Too many failed sign-in attempts. Try again in {wait_min} minute{'s' if wait_min != 1 else ''}."}
    return {"ok": True, "reason": "", "attempts": len(hits), "cooldown": 0, "window_started_at": None, "detail": ""}

def _login_rate_record_fail(ip: str, email: str) -> None:
    import time
    _login_fails.setdefault((ip, email), []).append(time.time())

def _login_rate_reset(ip: str, email: str) -> None:
    _login_fails.pop((ip, email), None)

def _iso_from_epoch(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()

@api_router.post("/auth/login", response_model=LoginResponse)
async def auth_login(payload: LoginRequest, request: Request):
    email = payload.email.lower().strip()
    ip = (request.headers.get("x-forwarded-for") or request.client.host or "").split(",")[0].strip() or "unknown"
    # Sliding-window brute-force check (see _login_rate_check for policy).
    rl_check = _login_rate_check(ip, email)
    if not rl_check["ok"]:
        await record_audit(None, "login_rate_limited", "user", None, email,
            metadata={"ip": ip, "reason": rl_check["reason"],
                       "attempts_in_window": rl_check["attempts"],
                       "cooldown_seconds": rl_check["cooldown"],
                       "window_started_at": rl_check["window_started_at"]})
        raise HTTPException(status_code=429, detail=rl_check["detail"])
    user = await db.users.find_one({"email": email}, {"_id":0})
    if not user or user.get("deleted_at"):
        _login_rate_record_fail(ip, email)
        await record_audit(None, "login_failed", "user", None, email, metadata={"reason":"not_found_or_deleted", "ip": ip})
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("is_active", True):
        _login_rate_record_fail(ip, email)
        await record_audit(None, "login_failed", "user", user["id"], email, metadata={"reason":"deactivated", "ip": ip})
        raise HTTPException(status_code=401, detail="Account deactivated. Contact administrator.")
    if not verify_password(payload.password, user["password_hash"]):
        _login_rate_record_fail(ip, email)
        await record_audit(None, "login_failed", "user", user["id"], email, metadata={"reason":"wrong_password", "ip": ip})
        raise HTTPException(status_code=401, detail="Invalid email or password")
    # Successful login — reset counters
    _login_rate_reset(ip, email)
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": now_iso()}})
    user["last_login_at"] = now_iso()
    await record_audit(user, "login_success", "user", user["id"], user["email"], metadata={"ip": ip})
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
    await record_audit(user, "password_changed", "user", user["id"], user["email"])
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
    await record_audit(admin, "created", "user", doc["id"], doc["email"])
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
    perm_diff = {}
    if "permissions" in updates:
        before_perms = set(k for k, v in (target.get("permissions") or {}).items() if v)
        after_perms  = set(k for k, v in (updates.get("permissions") or {}).items() if v)
        added   = sorted(after_perms - before_perms)
        removed = sorted(before_perms - after_perms)
        if added or removed:
            perm_diff["permissions"] = {"added": added, "removed": removed}
    for sk in ("is_super_admin","role_label"):
        if sk in updates and (target.get(sk) != updates.get(sk)):
            perm_diff[sk] = {"from": target.get(sk), "to": updates.get(sk)}
    if perm_diff:
        await record_audit(admin, "permission_changed", "user", user_id, target["email"], changes=perm_diff)
    other_diff = shallow_diff(target, updates, [k for k in updates if k not in ("permissions","is_super_admin","role_label","updated_at","updated_by_user_id")])
    if other_diff:
        await record_audit(admin, "updated", "user", user_id, target["email"], changes=other_diff)
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
    await record_audit(admin, "password_reset", "user", user_id, target["email"])
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
        await record_audit(actor, "hard_deleted", "user", user_id, target["email"])
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
    await record_audit(actor, "soft_deleted", "user", user_id, target["email"])
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
async def update_pricing(payload: PricingSettings, actor: dict = Depends(require_permission("pricing.edit"))):
    before = await db.settings.find_one({"key":"pricing"}, {"_id":0,"key":0}) or {}
    data = payload.model_dump(); data["updated_at"] = now_iso()
    await db.settings.update_one({"key":"pricing"}, {"$set":data}, upsert=True)
    diff = shallow_diff(before, data)
    if diff: await record_audit(actor, "settings_changed", "pricing_settings", "pricing", "Pricing", changes=diff)
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
async def update_company(payload: CompanySettings, actor: dict = Depends(require_permission("company.edit"))):
    data = payload.model_dump()
    if data.get("abn"): data["abn"] = normalise_abn(data["abn"])
    before = await db.settings.find_one({"key":"company"}, {"_id":0,"key":0}) or {}
    data["updated_at"] = now_iso()
    await db.settings.update_one({"key":"company"}, {"$set":data}, upsert=True)
    diff = shallow_diff(before, data)
    if diff: await record_audit(actor, "settings_changed", "company_settings", "company", "Company", changes=diff)
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
async def calculator_calculate(payload: CalculateRequest, user: dict = Depends(get_current_user)):
    pricing = await db.settings.find_one({"key":"pricing"}, {"_id":0,"key":0})
    if not pricing: raise HTTPException(status_code=500, detail="Pricing not initialized")
    result = compute_calculation(payload, pricing)
    # Phase 7 zero-leak: strip internal_cost_breakdown unless caller has pricing.view_costs
    if not has_permission(user, "pricing.view_costs"):
        result.pop("internal_cost_breakdown", None)
    return result


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------
@api_router.get("/customers")
async def list_customers(_user: dict = Depends(require_permission("customers.view")), search: Optional[str] = Query(None),
                          active: str = Query("true"), status: str = Query("active"), page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200)):
    s = (status or "active").lower()
    al = (active or "").lower()
    query: Dict[str, Any] = {}
    if s == "active":      query["deleted_at"] = {"$in": [None]}
    elif s == "inactive":  query["deleted_at"] = {"$in": [None]}; query["active"] = False
    elif s == "deleted":   query["deleted_at"] = {"$ne": None}
    elif s == "all":       pass
    else: raise HTTPException(status_code=400, detail="status must be one of active|inactive|deleted|all")
    if s == "active":
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
    return await populate_user_refs(doc, _USER_REF_FIELDS["customer"])

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
async def delete_customer(cid: str, permanent: bool = Query(False), actor: dict = Depends(require_permission("customers.delete"))):
    if permanent:
        if not actor.get("is_super_admin"): raise HTTPException(status_code=403, detail="Super admin required for permanent delete")
        return await hard_delete_with_refs(db.customers, cid, actor, "customer", "company_name")
    return await soft_delete_doc(db.customers, cid, actor, "company_name", "customer")

@api_router.get("/customers/{cid}/projects")
async def list_customer_projects(cid: str, _user: dict = Depends(require_permission("customers.view"))):
    if not await db.customers.find_one({"id":cid}, {"_id":0,"id":1}):
        raise HTTPException(status_code=404, detail="Customer not found")
    return await db.projects.find({"customer_id":cid, "deleted_at": {"$in":[None]}}, {"_id":0}).sort("created_at",-1).to_list(500)


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
@api_router.get("/projects")
async def list_projects(_user: dict = Depends(require_permission("projects.view")), customer_id: Optional[str] = None,
                         status_filter: Optional[str] = Query(None, alias="status"),
                         lifecycle: str = Query("active")):
    s = (lifecycle or "active").lower()
    if s not in ("active","deleted","all"): raise HTTPException(status_code=400, detail="lifecycle must be one of active|deleted|all")
    q: Dict[str, Any] = {}
    if s == "active": q["deleted_at"] = {"$in":[None]}
    elif s == "deleted": q["deleted_at"] = {"$ne": None}
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
    return await populate_user_refs(doc, _USER_REF_FIELDS["project"])

@api_router.patch("/projects/{pid}")

@api_router.delete("/projects/{pid}")
async def delete_project(pid: str, permanent: bool = Query(False), actor: dict = Depends(require_permission("projects.delete"))):
    if permanent:
        if not actor.get("is_super_admin"): raise HTTPException(status_code=403, detail="Super admin required for permanent delete")
        return await hard_delete_with_refs(db.projects, pid, actor, "project", "project_name")
    return await soft_delete_doc(db.projects, pid, actor, "project_name", "project")

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
    # PHASE 7 ZERO-LEAK GUARANTEE — this is the public magic-link surface seen by customers.
    # We deliberately whitelist fields here and NEVER spread `doc`. No `cost_*`, `margin_*`,
    # `total_cost_aud`, `internal_cost_breakdown`, or any other internal field can leak.
    # If a new sell-side field is needed by the customer, add it explicitly to this dict.
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
async def list_quotes(user: dict = Depends(require_permission("quotes.view")),
                       status_filter: Optional[str] = Query(None, alias="status"),
                       customer_id: Optional[str] = None, search: Optional[str] = Query(None),
                       lifecycle: str = Query("active"),
                       page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200)):
    s = (lifecycle or "active").lower()
    if s not in ("active","deleted","all"): raise HTTPException(status_code=400, detail="lifecycle must be one of active|deleted|all")
    q: Dict[str, Any] = {}
    if s == "active": q["deleted_at"] = {"$in":[None]}
    elif s == "deleted": q["deleted_at"] = {"$ne": None}
    if status_filter: q["status"] = status_filter
    if customer_id: q["customer_id"] = customer_id
    if search:
        q["quote_number"] = re.compile(re.escape(search), re.IGNORECASE)
    total = await db.quotes.count_documents(q)
    docs = await db.quotes.find(q, {"_id":0}).sort("created_at",-1).skip((page-1)*page_size).limit(page_size).to_list(page_size)
    cust_ids = list({d["customer_id"] for d in docs})
    customers = await db.customers.find({"id":{"$in":cust_ids}}, {"_id":0,"id":1,"company_name":1}).to_list(500)
    name_by_id = {c["id"]:c["company_name"] for c in customers}
    can_see_costs = has_permission(user, "pricing.view_costs")
    for d in docs:
        d["customer_company_name"] = name_by_id.get(d["customer_id"],"")
        if not can_see_costs:
            _strip_internal_costs_from_quote(d)
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
async def get_quote(qid: str, user: dict = Depends(require_permission("quotes.view"))):
    q = await _get_quote_or_404(qid)
    await populate_user_refs(q, _USER_REF_FIELDS["quote"])
    # Phase 7 zero-leak: strip internal cost/margin fields unless caller has pricing.view_costs
    if not has_permission(user, "pricing.view_costs"):
        _strip_internal_costs_from_quote(q)
    return q

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
    await record_audit(_user, "quote_sent", "quote", qid, q.get("quote_number", qid))
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
    await record_audit(user, "quote_revised", "quote", new_id, new_number, metadata={"revised_from": src["quote_number"]})
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
        await record_audit(user, "quote_accepted", "quote", qid, q.get("quote_number", qid))
    await _create_job_from_quote(qid, user["id"])
    return await _get_quote_or_404(qid)

@api_router.post("/quotes/{qid}/mark-rejected")
async def mark_rejected(qid: str, _user: dict = Depends(require_permission("quotes.mark_decision"))):
    await _get_quote_or_404(qid)
    await db.quotes.update_one({"id":qid},
        {"$set":{"status":"rejected","rejected_at":now_iso(),"updated_at":now_iso()}})
    q2 = await _get_quote_or_404(qid)
    await record_audit(_user, "quote_rejected", "quote", qid, q2.get("quote_number", qid))
    return q2


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

# ---------------------------------------------------------------------------
# Phase 11 — Hold Points
# ---------------------------------------------------------------------------
# Each entry maps a target status → required signed compliance form_type.
# scope='job' means a single signed form for the job suffices.
# scope='per_panel' would require a signed form per panel (not enforced
# in Phase 11 because we don't have a per-panel registry yet; treat as job-level).
HOLD_POINT_RULES: List[Dict[str, str]] = [
    {"to": "ready_for_delivery", "form_type": "pre_pour",        "label": "Pre-Pour Checklist"},
    {"to": "delivered",          "form_type": "post_pour",       "label": "Post-Pour Checklist"},
    {"to": "installed",          "form_type": "compliance_cert", "label": "Manufacturer's Certificate of Compliance"},
]

async def _holdpoint_blockers(job_id: Optional[str], to_status: str) -> List[Dict[str, Any]]:
    """Return the list of missing-signed-form blockers for a transition.
    Empty list = no blocker. Each blocker has {form_type, label, found_status}."""
    if not job_id: return []  # un-attached jobs cannot be checked
    blockers: List[Dict[str, Any]] = []
    for rule in HOLD_POINT_RULES:
        if rule["to"] != to_status: continue
        # Find any signed form of that type for this job
        signed = await db.compliance_forms.find_one(
            {"job_id": job_id, "form_type": rule["form_type"],
             "status": "signed", "deleted_at": None},
            {"_id": 0, "id": 1, "form_number": 1, "status": 1})
        if signed: continue
        # Any draft/completed form exists?
        any_form = await db.compliance_forms.find_one(
            {"job_id": job_id, "form_type": rule["form_type"], "deleted_at": None},
            {"_id": 0, "status": 1, "form_number": 1})
        blockers.append({
            "form_type": rule["form_type"],
            "label": rule["label"],
            "found_status": any_form.get("status") if any_form else None,
            "found_form_number": any_form.get("form_number") if any_form else None,
        })
    return blockers


async def _transition_job_internal(jid: str, to: str, note: str, by_user_id: str,
                                    enforce_holdpoints: bool = True,
                                    force: bool = False, force_reason: str = "",
                                    is_super_admin: bool = False) -> dict:
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
    # Hold-point enforcement (Phase 11)
    holdpoint_override = False
    if enforce_holdpoints and to != "cancelled":
        blockers = await _holdpoint_blockers(jid, to)
        if blockers:
            if not force:
                raise HTTPException(status_code=400, detail={
                    "code": "hold_point_block",
                    "message": f"Cannot advance to '{to}' — required compliance form(s) not signed.",
                    "blockers": blockers,
                    "transition": {"from": cur, "to": to},
                })
            # force requested — only super admin may override
            if not is_super_admin:
                raise HTTPException(status_code=403, detail="Only super admins can override hold points")
            if not force_reason or len(force_reason.strip()) < 5:
                raise HTTPException(status_code=400, detail="force_reason (≥5 chars) is required when overriding a hold point")
            holdpoint_override = True
    history_entry = {"from":cur, "to":to, "at":now_iso(), "by_user_id":by_user_id, "note":note}
    if holdpoint_override:
        history_entry["holdpoint_override"] = True
        history_entry["force_reason"] = force_reason.strip()
    await db.jobs.update_one({"id":jid},
        {"$set":{"status":to,"updated_at":now_iso()},
         "$push":{"status_history":history_entry}})
    return await _get_job_or_404(jid)

@api_router.get("/jobs")
async def list_jobs(_user: dict = Depends(require_permission("jobs.view")),
                     status_filter: Optional[str] = Query(None, alias="status"),
                     customer_id: Optional[str] = None, search: Optional[str] = Query(None),
                     page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200),
                    lifecycle: str = Query("active")):
    q: Dict[str, Any] = {}
    s = (lifecycle or "active").lower()
    if s not in ("active","deleted","all"): raise HTTPException(status_code=400, detail="lifecycle must be one of active|deleted|all")
    if s == "active": q["deleted_at"] = {"$in":[None]}
    elif s == "deleted": q["deleted_at"] = {"$ne": None}
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
    job = await _get_job_or_404(jid)
    cache: Dict[str, Any] = {}
    await populate_user_refs(job, _USER_REF_FIELDS["job"], cache)
    # status_history entries each carry by_user_id → resolve to a small ref
    for h in (job.get("status_history") or []):
        h["by_user"] = await _resolve_user_lite(h.get("by_user_id"), cache)
    return job

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
    before = await _get_job_or_404(jid)
    result = await _transition_job_internal(
        jid, payload.to, payload.note, user["id"],
        enforce_holdpoints=True,
        force=payload.force, force_reason=payload.force_reason,
        is_super_admin=bool(user.get("is_super_admin")),
    )
    await record_audit(user, "status_changed", "job", jid, before.get("job_number", jid),
                       changes={"status":{"from":before["status"],"to":payload.to}},
                       metadata={"note": payload.note or ""})
    if payload.force and payload.to != "cancelled":
        await record_audit(user, "hold_point_override", "job", jid, before.get("job_number", jid),
                           metadata={"to": payload.to, "reason": payload.force_reason})
    return result

@api_router.get("/jobs/{jid}/holdpoints")
async def job_holdpoints(jid: str, to: Optional[str] = None,
                          user: dict = Depends(require_permission("jobs.view"))):
    """Preview hold-point blockers for the next (or specified) transition.
    Useful for surfacing the requirement before the user clicks Advance."""
    job = await _get_job_or_404(jid)
    cur = job["status"]
    if cur == "cancelled" or cur == "completed": return {"to": None, "blockers": []}
    if not to:
        if cur not in JOB_STATUS_ORDER: return {"to": None, "blockers": []}
        i = JOB_STATUS_ORDER.index(cur)
        if i + 1 >= len(JOB_STATUS_ORDER): return {"to": None, "blockers": []}
        to = JOB_STATUS_ORDER[i + 1]
    blockers = await _holdpoint_blockers(jid, to)
    return {"to": to, "blockers": blockers}

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
    await record_audit(user, "status_changed", "job", jid, job.get("job_number", jid), changes={"status":{"from":job["status"],"to":"cancelled"}}, metadata={"reason": payload.reason})
    return await _get_job_or_404(jid)


# Vehicles + Employees endpoints moved to Phase 6 CRUD block above.

@api_router.get("/vehicles")
async def list_vehicles(_u: dict = Depends(require_permission("vehicles.view")), status: str = Query("active")):
    q = status_filter_q(status, has_is_active=True)
    return await db.vehicles.find(q, {"_id":0}).sort("vehicle_code", 1).to_list(500)

@api_router.get("/employees")
async def list_employees(_u: dict = Depends(require_permission("employees.view")), status: str = Query("active")):
    q = status_filter_q(status, has_is_active=True)
    return await db.employees.find(q, {"_id":0}).sort("name", 1).to_list(500)


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
                         page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200),
                       lifecycle: str = Query("active"),
                       xero_push_status: str = Query("all")):
    q: Dict[str, Any] = {}
    s = (lifecycle or "active").lower()
    if s not in ("active","deleted","all"): raise HTTPException(status_code=400, detail="lifecycle must be one of active|deleted|all")
    if s == "active": q["deleted_at"] = {"$in":[None]}
    elif s == "deleted": q["deleted_at"] = {"$ne": None}
    xs = (xero_push_status or "all").lower()
    if xs not in ("all","pending","pushed"):
        raise HTTPException(status_code=400, detail="xero_push_status must be one of all|pending|pushed")
    if xs == "pending":
        q["status"] = "issued"
        q["xero_push_status"] = {"$nin": ["MOCKED_PUSHED", "PUSHED"]}
    elif xs == "pushed":
        q["xero_push_status"] = {"$in": ["MOCKED_PUSHED", "PUSHED"]}
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
    inv = await _get_invoice_or_404(iid)
    return await populate_user_refs(inv, _USER_REF_FIELDS["invoice"])

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
    await record_audit(_user, "invoice_issued", "invoice", iid, inv.get("invoice_number", iid))
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
    await record_audit(_user, "invoice_paid", "invoice", iid, inv.get("invoice_number", iid), metadata={"paid_amount": payload.paid_amount, "payment_reference": payload.payment_reference})
    return await _get_invoice_or_404(iid)

@api_router.post("/invoices/{iid}/push-to-xero")
async def push_to_xero(iid: str, _user: dict = Depends(require_permission("invoices.push_xero"))):
    inv = await _get_invoice_or_404(iid)
    mock_xero_id = f"MOCK-{uuid.uuid4()}"
    await db.invoices.update_one({"id":iid},
        {"$set":{"xero_push_status":"MOCKED_PUSHED","xero_invoice_id":mock_xero_id,
                 "last_xero_push_at": now_iso(), "last_xero_push_by_user_id": _user["id"],
                 "updated_at":now_iso()}})
    await record_audit(_user, "invoice_pushed_xero", "invoice", iid, inv.get("invoice_number", iid), metadata={"xero_invoice_id": mock_xero_id})
    return {"status":"MOCKED_PUSHED","xero_invoice_id":mock_xero_id,
            "note":"MOCKED — real Xero push coming in Phase 4. Invoice unchanged in Xero."}

class BatchPushRequest(BaseModel):
    invoice_ids: List[str]
    force: bool = False

@api_router.post("/invoices/batch-push-xero")
async def batch_push_xero(payload: BatchPushRequest, user: dict = Depends(require_permission("invoices.push_xero"))):
    results = []
    for iid in payload.invoice_ids:
        inv = await db.invoices.find_one({"id": iid}, {"_id":0})
        if not inv:
            results.append({"invoice_id": iid, "status":"ERROR","message":"Not found"}); continue
        if inv.get("deleted_at"):
            results.append({"invoice_id": iid, "invoice_number": inv.get("invoice_number"),
                            "status":"SKIPPED","message":"Soft-deleted"}); continue
        if inv.get("xero_push_status") == "MOCKED_PUSHED" and not payload.force:
            results.append({"invoice_id": iid, "invoice_number": inv.get("invoice_number"),
                            "status":"SKIPPED",
                            "message":f"Already pushed on {inv.get('last_xero_push_at') or inv.get('xero_pushed_at') or 'unknown'}"})
            continue
        mock_xero_id = f"MOCK-{uuid.uuid4()}"
        await db.invoices.update_one({"id": iid},
            {"$set":{"xero_push_status":"MOCKED_PUSHED","xero_invoice_id":mock_xero_id,
                     "last_xero_push_at": now_iso(), "last_xero_push_by_user_id": user["id"],
                     "updated_at": now_iso()}})
        await record_audit(user, "invoice_pushed_xero", "invoice", iid, inv.get("invoice_number", iid),
                            metadata={"xero_invoice_id": mock_xero_id, "batch": True})
        results.append({"invoice_id": iid, "invoice_number": inv.get("invoice_number"),
                        "status":"MOCKED_PUSHED", "xero_invoice_id": mock_xero_id})
    summary = {"pushed": sum(1 for r in results if r["status"]=="MOCKED_PUSHED"),
               "skipped": sum(1 for r in results if r["status"]=="SKIPPED"),
               "errored": sum(1 for r in results if r["status"]=="ERROR")}
    return {"results": results, "summary": summary}


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@api_router.get("/dashboard/kpis")
async def dashboard_kpis(_user: dict = Depends(get_current_user)):
    now = now_utc()
    start_of_month = datetime(now.year, now.month, 1, tzinfo=timezone.utc).isoformat()
    quotes_draft = await db.quotes.count_documents({"status":"draft", "deleted_at": {"$in": [None]}})
    quotes_sent = await db.quotes.count_documents({"status":"sent", "deleted_at": {"$in": [None]}})
    quotes_accepted = await db.quotes.count_documents({"status":"accepted", "deleted_at": {"$in": [None]}})
    customers_active = await db.customers.count_documents({"active":True, "deleted_at": {"$in": [None]}})

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
        jobs_by_status[s] = await db.jobs.count_documents({"status":s, "deleted_at": {"$in": [None]}})
    jobs_active = sum(jobs_by_status[s] for s in JOB_STATUS_ORDER if s != "completed")

    # Invoices
    invoices_draft = await db.invoices.count_documents({"status":"draft", "deleted_at": {"$in": [None]}})
    invoices_issued = await db.invoices.count_documents({"status":"issued", "deleted_at": {"$in": [None]}})
    invoices_paid = await db.invoices.count_documents({"status":"paid", "deleted_at": {"$in": [None]}})
    invoices_awaiting_xero_push = await db.invoices.count_documents({
        "status": "issued",
        "xero_push_status": {"$nin": ["MOCKED_PUSHED", "PUSHED"]},
        "deleted_at": {"$in": [None]},
    })

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
    out = {
        "quotes_draft":quotes_draft,"quotes_sent":quotes_sent,"quotes_accepted":quotes_accepted,
        "customers_active":customers_active,
        "quoted_this_month_aud":_round2(quoted_this_month),
        "accepted_this_month_aud":_round2(accepted_this_month),
        "jobs_by_status":jobs_by_status, "jobs_active":jobs_active,
        "invoices_draft":invoices_draft, "invoices_issued":invoices_issued, "invoices_paid":invoices_paid,
        "invoices_awaiting_xero_push": invoices_awaiting_xero_push,
        "outstanding_aud":_round2(outstanding), "paid_this_month_aud":_round2(paid_this_month),
        "recent_quotes":recent_quotes, "recent_jobs":recent_jobs,
    }
    # Phase 11 — Compliance health KPI
    # Signed-vs-required ratio over active (non-cancelled / non-deleted) jobs touched in last 30 days.
    if has_permission(_user, "forms.view"):
        try:
            window_start = (now - timedelta(days=30)).isoformat()
            active_jobs_q = {
                "deleted_at": {"$in": [None]},
                "status": {"$nin": ["cancelled"]},
                "$or": [{"updated_at": {"$gte": window_start}},
                        {"created_at": {"$gte": window_start}}],
            }
            ch_expected = 0; ch_satisfied = 0
            async for j in db.jobs.find(active_jobs_q, {"_id": 0, "id": 1, "status": 1}):
                try: cur_i = JOB_STATUS_ORDER.index(j.get("status"))
                except ValueError: continue
                for rule in HOLD_POINT_RULES:
                    to_i = JOB_STATUS_ORDER.index(rule["to"])
                    if cur_i < to_i: continue
                    ch_expected += 1
                    n = await db.compliance_forms.count_documents({
                        "job_id": j["id"], "form_type": rule["form_type"],
                        "status": "signed", "deleted_at": None})
                    if n > 0: ch_satisfied += 1
            if ch_expected == 0:
                ch_pct = 100.0
            else:
                ch_pct = round((ch_satisfied / ch_expected) * 100.0, 1)
            out["compliance_health_pct"] = ch_pct
            out["compliance_health_expected"] = ch_expected
            out["compliance_health_satisfied"] = ch_satisfied
        except Exception as _e:
            logger.warning(f"compliance_health KPI computation failed: {_e}")
    # Phase 7 — margin KPIs (only for users with pricing.view_costs)
    if has_permission(_user, "pricing.view_costs"):
        margin_total = 0.0
        margin_weighted_pct_num = 0.0  # sum(margin_pct * subtotal) / sum(subtotal)
        margin_weighted_pct_den = 0.0
        async for d in db.quotes.find(
            {"status": {"$in": ["sent", "accepted"]},
             "created_at": {"$gte": start_of_month},
             "deleted_at": {"$in": [None]}},
            {"_id":0, "margin_aud":1, "margin_pct":1, "subtotal":1}
        ):
            ma = float(d.get("margin_aud") or 0.0)
            margin_total += ma
            sub = float(d.get("subtotal") or 0.0)
            mp = float(d.get("margin_pct") or 0.0)
            if sub > 0:
                margin_weighted_pct_num += mp * sub
                margin_weighted_pct_den += sub
        avg_margin_pct = (margin_weighted_pct_num / margin_weighted_pct_den) if margin_weighted_pct_den > 0 else 0.0
        out["quoted_margin_this_month_aud"] = _round2(margin_total)
        out["quoted_margin_this_month_pct"] = round(avg_margin_pct, 1)
    return out


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
async def update_integrations(payload: IntegrationSettings, actor: dict = Depends(require_permission("integrations.edit"))):
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
    # build per-section diff; secrets auto-redacted by record_audit
    diff = {}
    for k in ("m365","simpro","navixy","xero"):
        sec_diff = shallow_diff(existing.get(k,{}) or {}, incoming.get(k,{}) or {})
        if sec_diff: diff[k] = sec_diff
    if diff: await record_audit(actor, "settings_changed", "integration_settings", "integrations", "Integrations", changes=diff)
    return _mask_integrations(saved)

@api_router.post("/settings/integrations/{integration}/test")
async def test_integration(integration: str, _u: dict = Depends(require_permission("integrations.edit"))):
    if integration not in ("m365","simpro","navixy","xero"):
        raise HTTPException(status_code=400, detail="Unknown integration")

    # Phase 4 Part 2 — Simpro gets a real connectivity probe when enabled.
    if integration == "simpro":
        doc = await db.settings.find_one({"key":"integrations"}, {"_id": 0}) or {}
        section = (doc.get("simpro") or {})
        enabled = bool(section.get("enabled"))
        settings = _build_simpro_settings(section) if enabled else None
        stamp = now_iso()
        if not enabled:
            await db.settings.update_one({"key":"integrations"},
                {"$set": {"simpro.last_test_at": stamp, "simpro.last_test_status": "mocked"}})
            return {"status": "MOCKED", "integration": "simpro",
                    "message": "Simpro is currently disabled. Toggle enabled + save credentials to run a live test."}
        if not settings:
            await db.settings.update_one({"key":"integrations"},
                {"$set": {"simpro.last_test_at": stamp, "simpro.last_test_status": "error"}})
            return {"status": "ERROR", "integration": "simpro",
                    "message": "Missing credentials — enter build_name, client_id and client_secret and save."}
        try:
            client = SimproClient(settings)
            probe = await client.test_connection()
        except Exception as e:
            logger.warning("Simpro test_connection crashed: %s", type(e).__name__)
            probe = {"ok": False, "message": f"Unexpected error ({type(e).__name__})"}
        await db.settings.update_one({"key":"integrations"},
            {"$set": {"simpro.last_test_at": stamp,
                      "simpro.last_test_status": "ok" if probe.get("ok") else "error"}})
        if probe.get("ok"):
            return {"status": "LIVE", "integration": "simpro",
                    "message": probe.get("message") or "Connection OK",
                    "tenant_name": probe.get("tenant_name")}
        return {"status": "ERROR", "integration": "simpro",
                "message": probe.get("message") or "Simpro connection failed"}

    return {"status":"MOCKED",
        "integration": integration,
        "message": f"Real {integration} API connection coming in a later phase. Credentials saved successfully."}


# ---------------------------------------------------------------------------
# Phase 11.7 — Simpro Personal-Access-Token endpoints (mockup form)
# ---------------------------------------------------------------------------
class SimproProbePayload(BaseModel):
    url: str = Field(min_length=1)
    api_token: str = Field(min_length=1)
    company_id: Optional[int] = None               # legacy single-value (kept for LIST modal)
    company_ids: Optional[List[int]] = None        # Phase 11.7.1 — multi-company probe

def _simpro_normalise_url(u: str) -> str:
    """Return the API root URL, e.g. https://paneltec.simprosuite.com/api/v1.0"""
    base = u.strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        base = f"https://{base}"
    if not base.endswith("/api/v1.0"):
        base = f"{base}/api/v1.0"
    return base

async def _simpro_probe_one(client: httpx.AsyncClient, api_root: str,
                             headers: Dict[str, str], cid: Optional[int]) -> Dict[str, Any]:
    endpoint = f"{api_root}/companies/{cid}/" if cid else f"{api_root}/companies/"
    try:
        r = await client.get(endpoint, headers=headers)
        if r.status_code == 401:
            return {"ok": False, "company_id": cid, "message": "Unauthorised — check the API token."}
        if r.status_code == 404 and cid:
            return {"ok": False, "company_id": cid, "message": f"Company {cid} not found."}
        if r.status_code >= 400:
            return {"ok": False, "company_id": cid,
                    "message": f"Simpro HTTP {r.status_code}: {(r.text or '')[:120]}"}
        data = r.json()
        if isinstance(data, dict):
            name = data.get("Name") or data.get("CompanyName") or f"Company {cid}"
            return {"ok": True, "company_id": cid, "company_name": name, "message": "OK"}
        return {"ok": True, "company_id": cid,
                "company_name": None, "message": f"{len(data)} companies visible"}
    except httpx.HTTPError as e:
        return {"ok": False, "company_id": cid, "message": f"Cannot reach Simpro ({type(e).__name__})."}

@api_router.post("/integrations/simpro/test-connection")
async def simpro_test_live(payload: SimproProbePayload,
                            actor: dict = Depends(require_permission("integrations.edit"))):
    """Live probe. If `company_ids` is present, probe every one of them and
    return a per-company result list; otherwise probe the legacy single
    `company_id` (or the untyped root)."""
    api_root = _simpro_normalise_url(payload.url)
    headers = {"Authorization": f"Bearer {payload.api_token}", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=15.0) as c:
        if payload.company_ids:
            results = []
            for cid in payload.company_ids:
                results.append(await _simpro_probe_one(c, api_root, headers, cid))
            all_ok = all(r["ok"] for r in results)
            return {"ok": all_ok,
                     "message": "All companies reachable." if all_ok else "One or more companies failed — see per-company results.",
                     "results": results}
        # Legacy single-probe path (used implicitly by test-modal LIST view)
        one = await _simpro_probe_one(c, api_root, headers, payload.company_id)
        return {"ok": one["ok"], "message": one["message"],
                 "company_name": one.get("company_name"),
                 "results": [one]}


@api_router.post("/integrations/simpro/companies")
async def simpro_list_companies(payload: SimproProbePayload,
                                 _actor: dict = Depends(require_permission("integrations.edit"))):
    """Fetch the full list of companies visible to this API token.
    Used by the LIST button in the Simpro settings form."""
    api_root = _simpro_normalise_url(payload.url)
    headers = {"Authorization": f"Bearer {payload.api_token}", "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.get(f"{api_root}/companies/", headers=headers)
        if r.status_code == 401:
            raise HTTPException(status_code=401, detail="Unauthorised — check the API token.")
        if r.status_code >= 400:
            raise HTTPException(status_code=502,
                detail=f"Simpro HTTP {r.status_code}: {(r.text or '')[:180]}")
        raw = r.json() if r.content else []
        items = []
        for c_ in raw:
            items.append({
                "id": c_.get("ID") or c_.get("Id") or c_.get("id"),
                "name": c_.get("Name") or c_.get("CompanyName") or "(unnamed)",
                "enabled": c_.get("Enabled", True),
            })
        return {"items": items, "count": len(items)}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Cannot reach Simpro ({type(e).__name__}).")


# =========================================================================
# Phase 4 Part 2 — Simpro sync workers
# =========================================================================
async def _load_simpro_settings_or_error():
    """Return (SimproSettings, section_dict) or raise HTTPException with a
    friendly message."""
    doc = await db.settings.find_one({"key":"integrations"}, {"_id": 0}) or {}
    section = doc.get("simpro") or {}
    if not section.get("enabled"):
        raise HTTPException(status_code=400, detail="Simpro is disabled — enable it in Settings → Integrations first.")
    settings = _build_simpro_settings(section)
    if not settings:
        raise HTTPException(status_code=400, detail="Missing Simpro credentials — enter build_name, client_id and client_secret.")
    return settings, section

def _simpro_target_company_ids(section: Dict[str, Any]) -> List[int]:
    """Phase 11.7.1 — union of primary company_ids + whitelist_source_companies,
    de-duplicated (whitelist entries that duplicate a primary are dropped
    silently on save; this call re-de-dupes at sync time as belt-and-braces)."""
    primary = [int(x) for x in (section.get("company_ids") or []) if str(x).strip()]
    wl = [int(x) for x in (section.get("whitelist_source_companies") or []) if str(x).strip()]
    seen: set = set(); out: List[int] = []
    for cid in primary + wl:
        if cid not in seen:
            seen.add(cid); out.append(cid)
    return out


@api_router.post("/integrations/simpro/sync-customers")
async def simpro_sync_customers(actor: dict = Depends(require_permission("integrations.edit"))):
    if not has_permission(actor, "customers.create"):
        raise HTTPException(status_code=403, detail="customers.create permission required to sync customers")
    settings, sec = await _load_simpro_settings_or_error()
    target_company_ids = _simpro_target_company_ids(sec)
    client = SimproClient(settings)
    created = updated = 0
    errors: List[Dict[str, str]] = []
    try:
        remote = await client.iter_all(client.list_customers)
    except SimproAuthError:
        await db.settings.update_one({"key":"integrations"},
            {"$set":{"simpro.last_sync_at": now_iso(), "simpro.last_sync_status": "error",
                     "simpro.last_sync_error": "Simpro authentication failed"}})
        raise HTTPException(status_code=502, detail="Simpro authentication failed — check client_id / client_secret.")
    except SimproError as e:
        await db.settings.update_one({"key":"integrations"},
            {"$set":{"simpro.last_sync_at": now_iso(), "simpro.last_sync_status": "error",
                     "simpro.last_sync_error": str(e)}})
        raise HTTPException(status_code=502, detail=f"Simpro API error: {e}")

    for raw in remote:
        try:
            mapped = _map_simpro_customer(raw)
            simpro_id = mapped["simpro_customer_id"]
            if not simpro_id or simpro_id == "None":
                errors.append({"simpro_id": "?", "reason": "Missing Simpro ID"}); continue
            existing = await db.customers.find_one({"simpro_customer_id": simpro_id}, {"_id":0,"id":1})
            if existing:
                mapped["updated_at"] = now_iso()
                mapped["updated_by_user_id"] = actor["id"]
                await db.customers.update_one({"id": existing["id"]}, {"$set": mapped})
                updated += 1
            else:
                doc = {**mapped,
                       "id": str(uuid.uuid4()),
                       "active": True,
                       "source": "SIMPRO",
                       "account_terms": "30 days",
                       "notes": "",
                       "created_at": now_iso(),
                       "updated_at": now_iso(),
                       "created_by_user_id": actor["id"],
                       "updated_by_user_id": actor["id"]}
                await db.customers.insert_one(doc)
                created += 1
        except Exception as e:  # per-record isolation
            errors.append({"simpro_id": str(raw.get("ID")), "reason": f"{type(e).__name__}: {e}"})

    total = created + updated
    await db.settings.update_one({"key":"integrations"},
        {"$set":{"simpro.last_sync_at": now_iso(), "simpro.last_sync_status": "ok",
                 "simpro.last_sync_error": None,
                 "simpro.last_sync_customers_count": total}})
    await record_audit(actor, "simpro_customer_sync", "integration_settings", "simpro", "Simpro",
                       metadata={"synced": total, "created": created, "updated": updated,
                                  "errors": len(errors), "company_ids": target_company_ids})
    return {"synced": total, "created": created, "updated": updated,
            "errors": errors, "fetched_from_simpro": len(remote),
            "company_ids": target_company_ids}


class SimproSyncEmployeesPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    company_ids: Optional[List[int]] = None
    simpro_employee_ids: Optional[List[str]] = None    # Phase 11.7.2 — filtered import from Import Modal


@api_router.post("/integrations/simpro/preview-employees")
async def simpro_preview_employees(payload: SimproSyncEmployeesPayload,
                                    actor: dict = Depends(require_permission("integrations.edit"))):
    """Return the Simpro employee roster (per selected company_ids) with a
    per-row `exists_in_paneltec` flag so the Import Modal can pre-tick just
    the new ones."""
    if not has_permission(actor, "employees.view"):
        raise HTTPException(status_code=403, detail="employees.view permission required")
    settings, sec = await _load_simpro_settings_or_error()
    client = SimproClient(settings)
    try:
        remote = await client.iter_all(client.list_employees)
    except SimproAuthError:
        raise HTTPException(status_code=502, detail="Simpro authentication failed — check client_id / client_secret.")
    except SimproError as e:
        raise HTTPException(status_code=502, detail=f"Simpro API error: {e}")
    known = {d["simpro_employee_id"]: True async for d in db.employees.find(
        {"simpro_employee_id": {"$ne": None}}, {"_id":0, "simpro_employee_id":1})}
    items: List[Dict[str, Any]] = []
    for raw in remote:
        m = _map_simpro_employee(raw)
        sid = m.get("simpro_employee_id")
        items.append({"simpro_employee_id": sid,
                       "name": m.get("name"), "email": m.get("email"),
                       "position": m.get("role") or "",
                       "company_id": (raw or {}).get("_source_company_id"),
                       "exists_in_paneltec": bool(known.get(sid))})
    # Filter to selected company_ids if provided
    if payload.company_ids:
        cids = set(payload.company_ids)
        items = [i for i in items if (i.get("company_id") in cids or i.get("company_id") is None)]
    new_count = sum(1 for i in items if not i["exists_in_paneltec"])
    return {"items": items, "count": len(items),
            "new_count": new_count, "existing_count": len(items) - new_count,
            "position_filter": sec.get("position_filter") or []}


@api_router.post("/integrations/simpro/sync-employees")
async def simpro_sync_employees(payload: Optional[SimproSyncEmployeesPayload] = None,
                                 actor: dict = Depends(require_permission("integrations.edit"))):
    if not has_permission(actor, "employees.create"):
        raise HTTPException(status_code=403, detail="employees.create permission required to sync employees")
    filter_ids: Optional[set] = None
    if payload and payload.simpro_employee_ids:
        filter_ids = {str(x) for x in payload.simpro_employee_ids}
    settings, sec = await _load_simpro_settings_or_error()
    target_company_ids = _simpro_target_company_ids(sec)
    client = SimproClient(settings)
    created = updated = 0
    errors: List[Dict[str, str]] = []
    try:
        remote = await client.iter_all(client.list_employees)
    except SimproAuthError:
        await db.settings.update_one({"key":"integrations"},
            {"$set":{"simpro.last_sync_at": now_iso(), "simpro.last_sync_status": "error",
                     "simpro.last_sync_error": "Simpro authentication failed"}})
        raise HTTPException(status_code=502, detail="Simpro authentication failed — check client_id / client_secret.")
    except SimproError as e:
        await db.settings.update_one({"key":"integrations"},
            {"$set":{"simpro.last_sync_at": now_iso(), "simpro.last_sync_status": "error",
                     "simpro.last_sync_error": str(e)}})
        raise HTTPException(status_code=502, detail=f"Simpro API error: {e}")

    for raw in remote:
        try:
            mapped = _map_simpro_employee(raw)
            simpro_id = mapped["simpro_employee_id"]
            if not simpro_id or simpro_id == "None":
                errors.append({"simpro_id": "?", "reason": "Missing Simpro ID"}); continue
            # Phase 11.7.2 — Import Modal filter: only import ticked IDs.
            if filter_ids is not None and simpro_id not in filter_ids:
                continue
            existing = await db.employees.find_one({"simpro_employee_id": simpro_id},
                                                    {"_id":0,"id":1,"excluded_from_sync":1})
            if existing and existing.get("excluded_from_sync"):
                # Deleted / excluded — skip. Sync worker will NOT resurrect the record.
                continue
            if existing:
                mapped["updated_at"] = now_iso()
                mapped["updated_by_user_id"] = actor["id"]
                await db.employees.update_one({"id": existing["id"]}, {"$set": mapped})
                updated += 1
            else:
                doc = {**mapped,
                       "id": str(uuid.uuid4()),
                       "source": "SIMPRO",
                       "is_active": True,
                       "deleted_at": None,
                       "deleted_by_user_id": None,
                       "created_at": now_iso(),
                       "updated_at": now_iso(),
                       "created_by_user_id": actor["id"],
                       "updated_by_user_id": actor["id"]}
                await db.employees.insert_one(doc)
                created += 1
        except Exception as e:
            errors.append({"simpro_id": str(raw.get("ID")), "reason": f"{type(e).__name__}: {e}"})

    total = created + updated
    await db.settings.update_one({"key":"integrations"},
        {"$set":{"simpro.last_sync_at": now_iso(), "simpro.last_sync_status": "ok",
                 "simpro.last_sync_error": None,
                 "simpro.last_sync_employees_count": total}})
    await record_audit(actor, "simpro_employee_sync", "integration_settings", "simpro", "Simpro",
                       metadata={"synced": total, "created": created, "updated": updated,
                                  "errors": len(errors), "company_ids": target_company_ids})
    return {"synced": total, "created": created, "updated": updated,
            "errors": errors, "fetched_from_simpro": len(remote),
            "company_ids": target_company_ids}


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


# ===========================================================================
# Phase 11.4 — Admin Settings (super-admin only)
# ===========================================================================
DEFAULT_ADMIN_SETTINGS = {
    "account": {
        "subscription_plan": "Self-hosted",
        "primary_contact_name": "",
        "primary_contact_email": "",
        "primary_contact_phone": "",
        "billing_email": "",
        "timezone": "Australia/Melbourne",
        "fiscal_year_start_month": 7,
        "backup_email": "",
    },
    "numbering": {
        "quote_prefix": "Q-", "invoice_prefix": "INV-", "job_prefix": "J-",
        "form_prefix_pre": "PRE-", "form_prefix_post": "POST-", "form_prefix_cert": "CERT-",
        "next_quote": 1, "next_invoice": 1, "next_job": 1,
    },
    "tax": {"gst_rate_pct": 10.0, "tax_code_label": "GST", "tax_inclusive": False},
    "email_templates": {
        "quote_sent":         {"subject":"Your quote from Paneltec Group", "body":"Hi {{customer_name}},\n\nPlease find your quote {{quote_number}} attached.\n\n{{quote_link}}\n\nRegards,\nPaneltec Group"},
        "invoice_sent":       {"subject":"Invoice {{invoice_number}} from Paneltec Group", "body":"Hi {{customer_name}},\n\nInvoice {{invoice_number}} for {{total}} is attached. Due {{due_date}}.\n\nRegards,\nPaneltec Group"},
        "compliance_signoff": {"subject":"Compliance form {{form_number}} — signed", "body":"The compliance form {{form_number}} for panel {{panel_id}} has been signed off."},
        "ncr_notification":   {"subject":"NCR raised: {{form_number}}", "body":"A non-conformance report has been raised on form {{form_number}}. Please review."},
    },
    "ai_providers": {
        "active_text_provider": None,  # one of: openai, anthropic, google
        "active_image_provider": None, # one of: openai, nano_banana
        "openai":     {"api_key":"", "enabled":False},
        "anthropic":  {"api_key":"", "enabled":False},
        "google":     {"api_key":"", "enabled":False},
        "nano_banana":{"api_key":"", "enabled":False},
    },
    "tavily": {"api_key": "", "enabled": False, "status": "NOT_CONFIGURED",
                "connected_at": None},
    "compliance_standards": [
        {"name": "AS 3600 (Concrete Structures)", "url": "https://www.standards.org.au/standards-catalogue/sa-snz/building/bd-002/as--3600-colon-2018"},
        {"name": "AS 3850.1 (Prefabricated concrete elements — General requirements)", "url": "https://www.standards.org.au"},
        {"name": "AS 3850.2 (Prefabricated concrete elements — Building construction)", "url": "https://www.standards.org.au"},
        {"name": "AS/NZS 4671 (Steel reinforcing materials)", "url": "https://www.standards.org.au"},
        {"name": "NCC 2022 Volume 1 (Class 2–9 buildings)", "url": "https://ncc.abcb.gov.au/"},
        {"name": "NCC 2022 Volume 2 (Class 1 & 10 buildings)", "url": "https://ncc.abcb.gov.au/"},
        {"name": "Tasmanian Building Act 2016", "url": "https://www.legislation.tas.gov.au/view/html/inforce/current/act-2016-011"},
        {"name": "Director's Determinations (Tasmania)", "url": "https://www.cbos.tas.gov.au/topics/technical-regulation/building/directors-determinations"},
        {"name": "WorkSafe Tasmania — Precast concrete handling", "url": "https://worksafe.tas.gov.au/"},
    ],
}
ADMIN_SETTING_TABS = set(DEFAULT_ADMIN_SETTINGS.keys())
ADMIN_SECRET_FIELDS = {
    "ai_providers": {"openai.api_key", "anthropic.api_key", "google.api_key", "nano_banana.api_key",
                      "google.oauth_refresh_token", "google.oauth_access_token"},
    "tavily": {"api_key"},
}


def _mask_admin_settings(doc: Dict[str, Any]) -> Dict[str, Any]:
    import copy
    out = copy.deepcopy(doc)
    for tab, paths in ADMIN_SECRET_FIELDS.items():
        section = out.get(tab)
        if not isinstance(section, dict): continue
        for p in paths:
            keys = p.split(".")
            node = section
            for k in keys[:-1]:
                node = node.get(k) if isinstance(node, dict) else None
                if node is None: break
            if isinstance(node, dict) and node.get(keys[-1]):
                node[keys[-1]] = _mask_secret(node[keys[-1]])
    return out


async def _load_admin_settings() -> Dict[str, Any]:
    doc = await db.settings.find_one({"key":"admin_settings"}, {"_id":0,"key":0}) or {}
    merged: Dict[str, Any] = {}
    for tab, defaults in DEFAULT_ADMIN_SETTINGS.items():
        cur = doc.get(tab)
        if isinstance(defaults, list):
            merged[tab] = cur if isinstance(cur, list) else defaults
        elif isinstance(defaults, dict):
            merged[tab] = {**defaults, **cur} if isinstance(cur, dict) else defaults
        else:
            merged[tab] = cur if cur is not None else defaults
    return merged


@api_router.get("/admin/settings")
async def admin_settings_get(user: dict = Depends(require_super_admin)):
    return _mask_admin_settings(await _load_admin_settings())


@api_router.put("/admin/settings/{tab}")
async def admin_settings_put(tab: str, payload: Any = Body(...),
                              user: dict = Depends(require_super_admin)):
    if tab not in ADMIN_SETTING_TABS:
        raise HTTPException(status_code=400, detail=f"Unknown settings tab '{tab}'")
    existing = await _load_admin_settings()
    # List-shaped tabs (e.g. compliance_standards) accept a raw list payload.
    if isinstance(DEFAULT_ADMIN_SETTINGS.get(tab), list):
        if not isinstance(payload, list):
            raise HTTPException(status_code=400, detail=f"Payload for '{tab}' must be a list")
        await db.settings.update_one(
            {"key":"admin_settings"},
            {"$set": {tab: payload, "updated_at": now_iso()}}, upsert=True)
        await record_audit(user, "settings_changed", "admin_settings", tab, tab,
                           metadata={"tab": tab, "count": len(payload)})
        return _mask_admin_settings(await _load_admin_settings())
    incoming = payload or {}
    # For secret fields, preserve stored value when client sent the masked placeholder
    for path in ADMIN_SECRET_FIELDS.get(tab, set()):
        keys = path.split(".")
        node_new = incoming; node_cur = existing.get(tab, {})
        for k in keys[:-1]:
            if not isinstance(node_new, dict): break
            node_new = node_new.get(k)
            node_cur = node_cur.get(k, {}) if isinstance(node_cur, dict) else {}
        if isinstance(node_new, dict) and _is_masked(node_new.get(keys[-1], "")):
            node_new[keys[-1]] = node_cur.get(keys[-1], "") if isinstance(node_cur, dict) else ""
    merged = {**existing.get(tab, {}), **incoming}
    await db.settings.update_one(
        {"key":"admin_settings"},
        {"$set": {tab: merged, "updated_at": now_iso()}}, upsert=True)
    await record_audit(user, "settings_changed", "admin_settings", tab, tab,
                       metadata={"tab": tab, "fields": list(incoming.keys())})
    return _mask_admin_settings(await _load_admin_settings())


@api_router.post("/admin/settings/ai_providers/test")
async def admin_settings_ai_test(payload: Dict[str, Any] = Body(...),
                                  user: dict = Depends(require_super_admin)):
    """Ping the given AI provider's models endpoint. Never LIVE-calls beyond a
    lightweight probe; API keys are pulled from the stored settings (or the
    payload if the caller wants to test a fresh value)."""
    prov = (payload or {}).get("provider")
    if prov not in ("openai","anthropic","google","nano_banana"):
        raise HTTPException(status_code=400, detail="Unknown AI provider")
    stored = (await _load_admin_settings()).get("ai_providers", {}).get(prov, {})
    api_key = payload.get("api_key") or stored.get("api_key") or ""
    if _is_masked(api_key): api_key = stored.get("api_key") or ""
    if not api_key:
        return {"status": "MOCKED", "provider": prov, "message": "No API key stored — save one first."}
    # Minimal validation only — real provider probes happen in the AI service
    # layer once we wire actual features (TODO: replace with real /v1/models GET).
    return {"status": "OK", "provider": prov, "message": "API key stored. Live probe deferred until AI features wired."}


# ---------- Phase 11.5 — AI provider Connect / Disconnect / OAuth ----------
AI_PROVIDERS = {"openai", "anthropic", "google", "nano_banana"}
GOOGLE_OAUTH_CLIENT_ID     = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
GOOGLE_OAUTH_REDIRECT_URI  = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI", "").strip()
GOOGLE_OAUTH_CONFIGURED    = bool(GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI)


async def _verify_openai(api_key: str) -> Dict[str, Any]:
    import httpx as _hx
    try:
        async with _hx.AsyncClient(timeout=15.0) as c:
            r = await c.get("https://api.openai.com/v1/models",
                             headers={"Authorization": f"Bearer {api_key}"})
        if r.status_code == 200:
            data = r.json() or {}
            n = len((data.get("data") or []))
            return {"ok": True, "status": "CONNECTED", "message": f"OpenAI OK — {n} models available"}
        return {"ok": False, "status": "ERROR", "message": f"OpenAI HTTP {r.status_code}"}
    except _hx.HTTPError as e:
        return {"ok": False, "status": "ERROR", "message": f"OpenAI unreachable ({type(e).__name__})"}


async def _verify_anthropic(api_key: str) -> Dict[str, Any]:
    import httpx as _hx
    try:
        async with _hx.AsyncClient(timeout=15.0) as c:
            r = await c.get("https://api.anthropic.com/v1/models",
                             headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"})
        if r.status_code == 200:
            data = r.json() or {}
            n = len((data.get("data") or []))
            return {"ok": True, "status": "CONNECTED", "message": f"Anthropic OK — {n} models available"}
        return {"ok": False, "status": "ERROR", "message": f"Anthropic HTTP {r.status_code}"}
    except _hx.HTTPError as e:
        return {"ok": False, "status": "ERROR", "message": f"Anthropic unreachable ({type(e).__name__})"}


async def _verify_google_key(api_key: str) -> Dict[str, Any]:
    import httpx as _hx
    try:
        async with _hx.AsyncClient(timeout=15.0) as c:
            r = await c.get(f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}")
        if r.status_code == 200:
            data = r.json() or {}
            n = len(data.get("models") or [])
            return {"ok": True, "status": "MANUAL", "message": f"Google OK — {n} models available (API-key manual mode)"}
        return {"ok": False, "status": "ERROR", "message": f"Google HTTP {r.status_code}"}
    except _hx.HTTPError as e:
        return {"ok": False, "status": "ERROR", "message": f"Google unreachable ({type(e).__name__})"}


async def _verify_nano_banana(api_key: str) -> Dict[str, Any]:
    # No public metadata endpoint. Best-effort: accept keys ≥ 20 chars as "stored".
    if len((api_key or "").strip()) < 20:
        return {"ok": False, "status": "ERROR", "message": "Nano Banana key looks too short"}
    return {"ok": True, "status": "CONNECTED", "message": "Nano Banana key stored (live probe not available)"}


VERIFIERS = {"openai": _verify_openai, "anthropic": _verify_anthropic,
              "google": _verify_google_key, "nano_banana": _verify_nano_banana}


@api_router.get("/admin/settings/ai_providers/oauth-status")
async def ai_oauth_status(user: dict = Depends(require_super_admin)):
    return {"google": {"oauth_configured": GOOGLE_OAUTH_CONFIGURED,
                        "client_id_prefix": (GOOGLE_OAUTH_CLIENT_ID[:12] + "…") if GOOGLE_OAUTH_CONFIGURED else None,
                        "redirect_uri": GOOGLE_OAUTH_REDIRECT_URI if GOOGLE_OAUTH_CONFIGURED else None}}


@api_router.post("/admin/settings/ai_providers/{provider}/connect")
async def ai_provider_connect(provider: str, payload: Dict[str, Any] = Body(...),
                                user: dict = Depends(require_super_admin)):
    if provider not in AI_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown AI provider")
    api_key = (payload.get("api_key") or "").strip()
    if _is_masked(api_key):
        stored = (await _load_admin_settings()).get("ai_providers", {}).get(provider, {})
        api_key = stored.get("api_key") or ""
    if not api_key:
        raise HTTPException(status_code=400, detail="api_key required")
    verify = await VERIFIERS[provider](api_key)
    if not verify.get("ok"):
        return {"status": verify.get("status","ERROR"), "provider": provider,
                "message": verify.get("message","Verification failed")}
    settings = await _load_admin_settings()
    ai = settings.get("ai_providers", {})
    ai[provider] = {**(ai.get(provider) or {}),
                     "api_key": api_key, "enabled": True,
                     "status": verify["status"],
                     "connected_at": now_iso(),
                     "connection_mode": "api_key"}
    # Phase 11.6.1 — auto-elect this provider as active if no active is set,
    # so users don't get stuck at the AI Standards Check prereq gate after
    # a successful connect.
    text_providers = {"openai", "anthropic", "google"}
    image_providers = {"openai", "nano_banana"}
    if provider in text_providers and not ai.get("active_text_provider"):
        ai["active_text_provider"] = provider
    if provider in image_providers and not ai.get("active_image_provider"):
        ai["active_image_provider"] = provider
    await db.settings.update_one({"key":"admin_settings"},
        {"$set": {"ai_providers": ai, "updated_at": now_iso()}}, upsert=True)
    await record_audit(user, "ai_provider_connected", "admin_settings", provider, provider,
                       metadata={"mode": "api_key", "status": verify["status"]})
    return {"status": verify["status"], "provider": provider, "message": verify.get("message","Connected")}


@api_router.post("/admin/settings/ai_providers/{provider}/disconnect")
async def ai_provider_disconnect(provider: str, user: dict = Depends(require_super_admin)):
    if provider not in AI_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown AI provider")
    settings = await _load_admin_settings()
    ai = settings.get("ai_providers", {})
    ai[provider] = {"api_key": "", "enabled": False, "status": "NOT_CONFIGURED",
                    "connected_at": None, "connection_mode": None,
                    "oauth_refresh_token": None, "oauth_access_token": None,
                    "oauth_email": None}
    if ai.get("active_text_provider") == provider: ai["active_text_provider"] = None
    if ai.get("active_image_provider") == provider: ai["active_image_provider"] = None
    await db.settings.update_one({"key":"admin_settings"},
        {"$set": {"ai_providers": ai, "updated_at": now_iso()}}, upsert=True)
    await record_audit(user, "ai_provider_disconnected", "admin_settings", provider, provider)
    return {"status": "NOT_CONFIGURED", "provider": provider}


@api_router.get("/admin/settings/ai_providers/oauth/google/start")
async def ai_google_oauth_start(user: dict = Depends(require_super_admin)):
    if not GOOGLE_OAUTH_CONFIGURED:
        raise HTTPException(status_code=400, detail="Google OAuth not configured — set GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REDIRECT_URI env vars.")
    import urllib.parse as _up
    params = {
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": GOOGLE_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile https://www.googleapis.com/auth/generative-language",
        "access_type": "offline",
        "prompt": "consent",
        "state": user["id"],
    }
    return {"authorize_url": f"https://accounts.google.com/o/oauth2/v2/auth?{_up.urlencode(params)}"}


@api_router.get("/admin/settings/ai_providers/oauth/google/callback")
async def ai_google_oauth_callback(code: str, state: Optional[str] = None):
    """Google OAuth2 authorization-code exchange. Called by Google after the user
    grants consent; must be reachable without a session (Google can't send our
    JWT). We validate `state` against the admin user IDs to prevent CSRF."""
    if not GOOGLE_OAUTH_CONFIGURED:
        raise HTTPException(status_code=400, detail="Google OAuth not configured")
    admin = await db.users.find_one({"id": state, "is_super_admin": True}, {"_id":0,"id":1,"email":1,"name":1})
    if not admin:
        raise HTTPException(status_code=403, detail="Invalid OAuth state")
    import urllib.parse as _up
    import httpx as _hx
    try:
        async with _hx.AsyncClient(timeout=15.0) as c:
            r = await c.post("https://oauth2.googleapis.com/token",
                              data={"code": code,
                                    "client_id": GOOGLE_OAUTH_CLIENT_ID,
                                    "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
                                    "redirect_uri": GOOGLE_OAUTH_REDIRECT_URI,
                                    "grant_type": "authorization_code"})
    except _hx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Google token exchange failed ({type(e).__name__})")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Google token endpoint returned {r.status_code}")
    body = r.json() or {}
    access_token = body.get("access_token")
    refresh_token = body.get("refresh_token")
    if not access_token:
        raise HTTPException(status_code=502, detail="Google response missing access_token")
    # Get user email
    try:
        import httpx as _hx
        async with _hx.AsyncClient(timeout=10.0) as c:
            u = await c.get("https://www.googleapis.com/oauth2/v2/userinfo",
                             headers={"Authorization": f"Bearer {access_token}"})
        email = (u.json() or {}).get("email") if u.status_code == 200 else None
    except Exception:
        email = None
    settings = await _load_admin_settings()
    ai = settings.get("ai_providers", {})
    ai["google"] = {**(ai.get("google") or {}),
                     "oauth_refresh_token": refresh_token,
                     "oauth_access_token": access_token,
                     "oauth_email": email,
                     "enabled": True, "status": "CONNECTED",
                     "connected_at": now_iso(),
                     "connection_mode": "oauth"}
    # Auto-elect active text provider if none is set (Phase 11.6.1)
    if not ai.get("active_text_provider"):
        ai["active_text_provider"] = "google"
    await db.settings.update_one({"key":"admin_settings"},
        {"$set": {"ai_providers": ai, "updated_at": now_iso()}}, upsert=True)
    await record_audit({"id": admin["id"], "email": admin.get("email"), "name": admin.get("name")},
                       "ai_provider_connected", "admin_settings", "google", "google",
                       metadata={"mode": "oauth", "google_email": email})
    from fastapi.responses import HTMLResponse
    return HTMLResponse(f"""
<!doctype html><html><body style="font-family:system-ui;padding:40px;text-align:center">
<h1 style="color:#1F2A33">✅ Google connected</h1>
<p style="color:#3A6B8C">Signed in as <strong>{email or 'Google account'}</strong>. You can close this window and return to Admin Settings.</p>
<script>setTimeout(() => window.close(), 1500);</script>
</body></html>""")


@api_router.get("/admin/export/json")
async def admin_export_json(user: dict = Depends(require_super_admin)):
    """Dump every business collection as a single JSON payload (streamed as a
    ZIP-inside-JSON is overkill for the current data volume; keep it simple)."""
    import json as _json
    from fastapi.responses import Response
    collections = ["customers","projects","quotes","jobs","invoices","vehicles",
                    "employees","compliance_forms","compliance_form_templates",
                    "users","audit_events","settings"]
    out: Dict[str, Any] = {"exported_at": now_iso(), "collections": {}}
    for c in collections:
        try:
            out["collections"][c] = await getattr(db, c).find({}, {"_id":0}).to_list(50000)
        except Exception as e:
            out["collections"][c] = {"__error__": str(e)}
    await record_audit(user, "admin_export", "admin_settings", "json", "Full JSON export",
                       metadata={"collections": collections})
    payload = _json.dumps(out, default=str).encode("utf-8")
    fname = f"paneltec_backup_{now_utc().strftime('%Y%m%d_%H%M%S')}.json"
    return Response(content=payload, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@api_router.get("/admin/export/csv-bundle")
async def admin_export_csv_bundle(user: dict = Depends(require_super_admin)):
    """Zip of one CSV per business collection."""
    import csv, io, zipfile
    from fastapi.responses import Response
    zbuf = io.BytesIO()
    collections = ["customers","projects","quotes","jobs","invoices","vehicles","employees","compliance_forms"]
    with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
        for c in collections:
            rows = await getattr(db, c).find({}, {"_id":0}).to_list(50000)
            if not rows:
                z.writestr(f"{c}.csv", "id\n")
                continue
            cols = sorted({k for r in rows for k in r.keys()})
            buf = io.StringIO(); w = csv.writer(buf); w.writerow(cols)
            for r in rows: w.writerow([r.get(k,"") for k in cols])
            z.writestr(f"{c}.csv", buf.getvalue())
    await record_audit(user, "admin_export", "admin_settings", "csv_bundle", "CSV bundle export",
                       metadata={"collections": collections})
    fname = f"paneltec_csv_bundle_{now_utc().strftime('%Y%m%d_%H%M%S')}.zip"
    return Response(content=zbuf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

# ===========================================================================
# Phase 8 Pass 1 — Reports backend (7 reports + CSV exports)
# ===========================================================================
REPORT_PERMS = {
    "customers": "customers.view", "quotes": "quotes.view", "jobs": "jobs.view",
    "invoices": "invoices.view", "vehicles": "vehicles.view", "employees": "employees.view",
    "projects": "projects.view",
    "margin": "pricing.view_costs",
    "compliance": "forms.view",
    "compliance-forms": "forms.view",
    "audit-trail": "audit.view",
}

def _date_range_iso(date_from: Optional[str], date_to: Optional[str], default_days: int = 90):
    today = now_utc()
    if date_from: df = date_from
    else: df = (today - timedelta(days=default_days)).date().isoformat()
    dt = date_to or today.date().isoformat()
    df_iso = df + "T00:00:00+00:00" if "T" not in df else df
    dt_iso = dt + "T23:59:59+00:00" if "T" not in dt else dt
    return df_iso, dt_iso

def _months_back(n: int):
    """Yields (year, month, label) tuples going back n months including current."""
    today = now_utc()
    out = []
    y, m = today.year, today.month
    for _ in range(n):
        out.append((y, m, f"{y}-{m:02d}"))
        m -= 1
        if m == 0: m = 12; y -= 1
    return list(reversed(out))

async def _report_customers(date_from, date_to, _filters):
    df, dt = _date_range_iso(date_from, date_to)
    state = (_filters or {}).get("state")
    active = (_filters or {}).get("active", "all")
    base: Dict[str, Any] = {"deleted_at": {"$in": [None]}}
    if state: base["billing_address.state"] = state
    if active == "active": base["active"] = True
    elif active == "inactive": base["active"] = False
    new_cnt = await db.customers.count_documents({**base, "created_at": {"$gte": df, "$lte": dt}})
    active_cnt = await db.customers.count_documents({"deleted_at": {"$in": [None]}, "active": True})
    # Top 10 by quoted value
    pipeline = [
        {"$match": {"deleted_at": {"$in": [None]}}},
        {"$group": {"_id": "$customer_id", "total_quoted": {"$sum": "$total"},
                    "total_accepted": {"$sum": {"$cond": [{"$eq": ["$status", "accepted"]}, "$total", 0]}},
                    "quotes_count": {"$sum": 1}}},
        {"$sort": {"total_quoted": -1}}, {"$limit": 10},
    ]
    top = await db.quotes.aggregate(pipeline).to_list(10)
    cids = [t["_id"] for t in top]
    cust_map = {c["id"]: c for c in await db.customers.find({"id": {"$in": cids}}, {"_id":0,"id":1,"company_name":1,"billing_address":1}).to_list(20)}
    top_rows = [{"customer": cust_map.get(t["_id"], {}).get("company_name", "(deleted)"),
                 "total_quoted": _round2(t["total_quoted"]), "quotes_count": t["quotes_count"]} for t in top]
    # New customers per month (last 12)
    months = _months_back(12)
    new_per_month = []
    for y, m, label in months:
        start = f"{y}-{m:02d}-01T00:00:00+00:00"
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        end = f"{ny}-{nm:02d}-01T00:00:00+00:00"
        n = await db.customers.count_documents({"created_at": {"$gte": start, "$lt": end}, "deleted_at": {"$in": [None]}})
        new_per_month.append({"month": label, "new_customers": n})
    # Table
    docs = await db.customers.find(base, {"_id":0}).sort("created_at", -1).limit(500).to_list(500)
    qcnt = await db.quotes.aggregate([{"$group":{"_id":"$customer_id","cnt":{"$sum":1},"accepted":{"$sum":{"$cond":[{"$eq":["$status","accepted"]},1,0]}}}}]).to_list(10000)
    qmap = {q["_id"]: q for q in qcnt}
    inv_aud = await db.invoices.aggregate([{"$group":{"_id":"$customer_id","total":{"$sum":"$total"}}}]).to_list(10000)
    imap = {i["_id"]: i["total"] for i in inv_aud}
    rows = []
    for c in docs:
        qx = qmap.get(c["id"], {})
        rows.append({"_id": c["id"], "_entity": "customers",
                     "company_name": c["company_name"], "state": (c.get("billing_address") or {}).get("state",""),
                     "total_quotes": qx.get("cnt", 0), "total_accepted": qx.get("accepted", 0),
                     "total_invoiced_aud": _round2(imap.get(c["id"], 0)),
                     "last_activity_at": c.get("updated_at") or c.get("created_at")})
    avg_qpc = (sum(r["total_quotes"] for r in rows) / len(rows)) if rows else 0
    top_rev = max((r["total_invoiced_aud"] for r in rows), default=0)
    return {"kpis": {"active_customers": active_cnt, "new_in_range": new_cnt,
                     "avg_quotes_per_customer": round(avg_qpc, 1), "top_customer_revenue_aud": top_rev},
            "charts": {"top_customers_by_quoted": top_rows, "new_customers_per_month": new_per_month},
            "table": {"columns":["company_name","state","total_quotes","total_accepted","total_invoiced_aud","last_activity_at"],
                      "rows": rows, "total": len(rows)}}

async def _report_quotes(date_from, date_to, _filters):
    df, dt = _date_range_iso(date_from, date_to)
    status = (_filters or {}).get("status")
    customer_id = (_filters or {}).get("customer_id")
    q: Dict[str, Any] = {"deleted_at": {"$in": [None]}, "created_at": {"$gte": df, "$lte": dt}}
    if status: q["status"] = {"$in": status.split(",")}
    if customer_id: q["customer_id"] = customer_id
    cnt_sent = await db.quotes.count_documents({**q, "status": {"$in": ["sent","accepted","rejected"]}})
    total_value = sum(d["total"] for d in await db.quotes.find(q, {"_id":0,"total":1}).to_list(100000))
    accepted_docs = await db.quotes.find({**q, "status": "accepted"}, {"_id":0,"sent_at":1,"accepted_at":1,"total":1}).to_list(100000)
    sent_docs = await db.quotes.find({**q, "status": {"$in": ["sent","accepted","rejected"]}}, {"_id":0,"status":1}).to_list(100000)
    win_rate = (sum(1 for s in sent_docs if s["status"]=="accepted") / len(sent_docs) * 100) if sent_docs else 0
    def days_between(a, b):
        try: return (datetime.fromisoformat(b.replace("Z","+00:00")) - datetime.fromisoformat(a.replace("Z","+00:00"))).days
        except Exception: return None
    avg_days = [days_between(d["sent_at"], d["accepted_at"]) for d in accepted_docs if d.get("sent_at") and d.get("accepted_at")]
    avg_days = [x for x in avg_days if x is not None]
    avg_days_to_accept = round(sum(avg_days)/len(avg_days), 1) if avg_days else 0
    # Charts
    months = _months_back(6)
    win_by_month = []
    for y, m, label in months:
        start = f"{y}-{m:02d}-01T00:00:00+00:00"
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        end = f"{ny}-{nm:02d}-01T00:00:00+00:00"
        mq = {"deleted_at": {"$in": [None]}, "created_at": {"$gte": start, "$lt": end}, "status": {"$in":["sent","accepted","rejected"]}}
        sent = await db.quotes.count_documents(mq)
        acc = await db.quotes.count_documents({**mq, "status": "accepted"})
        win_by_month.append({"month": label, "win_rate": round((acc/sent*100) if sent else 0, 1)})
    funnel = [{"stage": s, "count": await db.quotes.count_documents({"deleted_at": {"$in": [None]}, "status": s, "created_at": {"$gte": df, "$lte": dt}})}
              for s in ["draft","sent","accepted","rejected"]]
    value_by_month = []
    for y, m, label in months[-6:]:
        start = f"{y}-{m:02d}-01T00:00:00+00:00"
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        end = f"{ny}-{nm:02d}-01T00:00:00+00:00"
        row = {"month": label}
        for s in ["draft","sent","accepted","rejected"]:
            total = sum(d["total"] for d in await db.quotes.find({"deleted_at":{"$in":[None]},"created_at":{"$gte":start,"$lt":end},"status":s},{"_id":0,"total":1}).to_list(10000))
            row[s] = _round2(total)
        value_by_month.append(row)
    # Table
    docs = await db.quotes.find(q, {"_id":0}).sort("created_at", -1).limit(500).to_list(500)
    cmap = {c["id"]: c["company_name"] for c in await db.customers.find({"id":{"$in":[d["customer_id"] for d in docs]}}, {"_id":0,"id":1,"company_name":1}).to_list(2000)}
    rows = [{"_id": d["id"], "_entity": "quotes", "_status": d["status"],
             "quote_number": d["quote_number"], "customer": cmap.get(d["customer_id"], ""),
             "total_aud": _round2(d["total"]), "status": d["status"], "sent_at": d.get("sent_at",""),
             "accepted_at": d.get("accepted_at",""),
             "days_to_accept": days_between(d.get("sent_at",""), d.get("accepted_at","")) if d.get("accepted_at") and d.get("sent_at") else None} for d in docs]
    return {"kpis": {"quotes_sent": cnt_sent, "total_quoted_aud": _round2(total_value),
                     "win_rate_pct": round(win_rate, 1), "avg_days_to_accept": avg_days_to_accept},
            "charts": {"win_rate_trend": win_by_month, "funnel": funnel, "value_by_month_stacked": value_by_month},
            "table": {"columns":["quote_number","customer","total_aud","status","sent_at","accepted_at","days_to_accept"], "rows": rows, "total": len(rows)}}

async def _report_jobs(date_from, date_to, _filters):
    df, dt = _date_range_iso(date_from, date_to)
    q: Dict[str, Any] = {"deleted_at": {"$in": [None]}, "created_at": {"$gte": df, "$lte": dt}}
    if (_filters or {}).get("status"): q["status"] = {"$in": _filters["status"].split(",")}
    if (_filters or {}).get("customer_id"): q["customer_id"] = _filters["customer_id"]
    active_cnt = await db.jobs.count_documents({"deleted_at": {"$in":[None]}, "status": {"$nin":["completed","cancelled"]}})
    completed_in_range = await db.jobs.count_documents({**q, "status":"completed"})
    docs = await db.jobs.find(q, {"_id":0}).sort("created_from_quote_at", -1).limit(1000).to_list(1000)
    cmap = {c["id"]: c["company_name"] for c in await db.customers.find({"id":{"$in":[d["customer_id"] for d in docs]}}, {"_id":0,"id":1,"company_name":1}).to_list(2000)}
    def cycle_days(j):
        sh = j.get("status_history") or []
        sched = next((h["at"] for h in sh if h["to"] == "scheduled"), j.get("created_from_quote_at"))
        deliv = next((h["at"] for h in sh if h["to"] == "delivered"), None)
        if not sched or not deliv: return None
        try: return (datetime.fromisoformat(deliv.replace("Z","+00:00")) - datetime.fromisoformat(sched.replace("Z","+00:00"))).days
        except Exception: return None
    cycle = [cycle_days(j) for j in docs if j.get("status") in ("delivered","installed","completed")]
    cycle = [c for c in cycle if c is not None]
    avg_cycle = round(sum(cycle)/len(cycle), 1) if cycle else 0
    on_time = 0; on_time_total = 0
    for j in docs:
        sd = j.get("scheduled_delivery_date")
        ad = next((h["at"][:10] for h in (j.get("status_history") or []) if h["to"] == "delivered"), None)
        if sd and ad:
            on_time_total += 1
            if ad <= sd: on_time += 1
    on_time_pct = round((on_time/on_time_total*100) if on_time_total else 0, 1)
    # Charts
    by_status = []
    for s in ["scheduled","in_production","ready_for_delivery","delivered","installed","completed","cancelled"]:
        by_status.append({"status": s, "count": await db.jobs.count_documents({"deleted_at":{"$in":[None]},"status": s})})
    months = _months_back(6)
    completed_per_month = []
    for y, m, label in months:
        start = f"{y}-{m:02d}-01T00:00:00+00:00"
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        end = f"{ny}-{nm:02d}-01T00:00:00+00:00"
        c = await db.jobs.count_documents({"deleted_at":{"$in":[None]}, "status":"completed", "created_from_quote_at":{"$gte":start,"$lt":end}})
        completed_per_month.append({"month": label, "completed": c})
    buckets = {"0-7": 0, "8-14": 0, "15-30": 0, "31-60": 0, "60+": 0}
    for d in cycle:
        if d <= 7: buckets["0-7"] += 1
        elif d <= 14: buckets["8-14"] += 1
        elif d <= 30: buckets["15-30"] += 1
        elif d <= 60: buckets["31-60"] += 1
        else: buckets["60+"] += 1
    cycle_hist = [{"bucket": k, "count": v} for k, v in buckets.items()]
    rows = []
    for d in docs:
        ad = next((h["at"] for h in (d.get("status_history") or []) if h["to"] == "delivered"), None)
        rows.append({"_id": d["id"], "_entity": "jobs", "_status": d["status"],
                     "job_number": d["job_number"], "customer": cmap.get(d["customer_id"],""),
                     "status": d["status"], "scheduled_delivery_date": d.get("scheduled_delivery_date",""),
                     "actual_delivered_at": ad or "", "cycle_days": cycle_days(d) or ""})
    return {"kpis": {"active_jobs": active_cnt, "completed_in_range": completed_in_range,
                     "avg_cycle_days": avg_cycle, "on_time_delivery_pct": on_time_pct},
            "charts": {"by_status": by_status, "completed_per_month": completed_per_month, "cycle_histogram": cycle_hist},
            "table": {"columns":["job_number","customer","status","scheduled_delivery_date","actual_delivered_at","cycle_days"],"rows": rows,"total":len(rows)}}

async def _report_invoices(date_from, date_to, _filters):
    df, dt = _date_range_iso(date_from, date_to)
    q: Dict[str, Any] = {"deleted_at": {"$in":[None]}, "created_at": {"$gte": df, "$lte": dt}}
    if (_filters or {}).get("status"): q["status"] = {"$in": _filters["status"].split(",")}
    if (_filters or {}).get("customer_id"): q["customer_id"] = _filters["customer_id"]
    docs = await db.invoices.find(q, {"_id":0}).sort("created_at", -1).limit(2000).to_list(2000)
    today_iso = now_utc().date().isoformat()
    def days_overdue(d):
        due = d.get("due_date")
        if not due or d.get("status") == "paid": return 0
        try: return max(0, (datetime.fromisoformat(today_iso) - datetime.fromisoformat(due)).days)
        except Exception: return 0
    outstanding = sum(d["total"] for d in docs if d.get("status") in ("issued","overdue"))
    paid_in_range = sum(d["total"] for d in docs if d.get("status") == "paid")
    paid_days = []
    for d in docs:
        if d.get("status") == "paid" and d.get("issue_date") and d.get("paid_at"):
            try:
                pd_ = datetime.fromisoformat(d["paid_at"].replace("Z","+00:00")).date()
                id_ = datetime.fromisoformat(d["issue_date"]).date() if "T" not in d["issue_date"] else datetime.fromisoformat(d["issue_date"].replace("Z","+00:00")).date()
                paid_days.append((pd_ - id_).days)
            except Exception: pass
    avg_days_to_pay = round(sum(paid_days)/len(paid_days), 1) if paid_days else 0
    overdue_cnt = sum(1 for d in docs if days_overdue(d) > 0)
    # Aging buckets
    buckets = {"0-30":0,"31-60":0,"61-90":0,"90+":0}
    for d in docs:
        if d.get("status") not in ("issued","overdue"): continue
        ov = days_overdue(d)
        amt = d["total"]
        if ov <= 30: buckets["0-30"] += amt
        elif ov <= 60: buckets["31-60"] += amt
        elif ov <= 90: buckets["61-90"] += amt
        else: buckets["90+"] += amt
    aging = [{"bucket": k, "amount_aud": _round2(v)} for k, v in buckets.items()]
    months = _months_back(6)
    issued_vs_paid = []
    avg_dtp_trend = []
    for y, m, label in months:
        start = f"{y}-{m:02d}-01T00:00:00+00:00"
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        end = f"{ny}-{nm:02d}-01T00:00:00+00:00"
        iss = sum(x["total"] for x in await db.invoices.find({"deleted_at":{"$in":[None]},"status":{"$in":["issued","paid","overdue"]},"issue_date":{"$gte":start[:10],"$lt":end[:10]}}, {"_id":0,"total":1}).to_list(10000))
        pd_ = sum(x["total"] for x in await db.invoices.find({"deleted_at":{"$in":[None]},"status":"paid","paid_at":{"$gte":start,"$lt":end}}, {"_id":0,"total":1}).to_list(10000))
        issued_vs_paid.append({"month": label, "issued": _round2(iss), "paid": _round2(pd_)})
        m_paid_days = []
        for d2 in await db.invoices.find({"deleted_at":{"$in":[None]},"status":"paid","paid_at":{"$gte":start,"$lt":end}}, {"_id":0,"issue_date":1,"paid_at":1}).to_list(10000):
            try:
                pd2 = datetime.fromisoformat(d2["paid_at"].replace("Z","+00:00")).date()
                id2 = datetime.fromisoformat(d2["issue_date"]).date() if "T" not in d2["issue_date"] else datetime.fromisoformat(d2["issue_date"].replace("Z","+00:00")).date()
                m_paid_days.append((pd2 - id2).days)
            except Exception: pass
        avg_dtp_trend.append({"month": label, "avg_days": round(sum(m_paid_days)/len(m_paid_days),1) if m_paid_days else 0})
    cmap = {c["id"]: c["company_name"] for c in await db.customers.find({"id":{"$in":[d["customer_id"] for d in docs]}}, {"_id":0,"id":1,"company_name":1}).to_list(2000)}
    rows = [{"_id": d["id"], "_entity": "invoices", "_status": d["status"],
             "_xero_push_status": d.get("xero_push_status","not_pushed"),
             "invoice_number": d["invoice_number"], "customer": cmap.get(d["customer_id"],""),
             "total": _round2(d["total"]), "status": d["status"], "issue_date": d.get("issue_date",""),
             "due_date": d.get("due_date",""), "days_overdue": days_overdue(d),
             "xero_push_status": d.get("xero_push_status","not_pushed")} for d in docs]
    return {"kpis": {"total_outstanding_aud": _round2(outstanding), "paid_in_range_aud": _round2(paid_in_range),
                     "avg_days_to_pay": avg_days_to_pay, "overdue_count": overdue_cnt},
            "charts": {"aging_buckets": aging, "issued_vs_paid": issued_vs_paid, "avg_days_to_pay_trend": avg_dtp_trend},
            "table": {"columns":["invoice_number","customer","total","status","issue_date","due_date","days_overdue","xero_push_status"],
                      "rows": rows, "total": len(rows)}}

async def _report_vehicles(date_from, date_to, _filters):
    docs = await db.vehicles.find({"deleted_at": {"$in":[None]}}, {"_id":0}).to_list(1000)
    if (_filters or {}).get("status"):
        docs = [d for d in docs if d.get("status") == _filters["status"]]
    # Jobs assignments
    jobs = await db.jobs.find({"deleted_at": {"$in":[None]}, "assigned_vehicle_id":{"$ne":None}}, {"_id":0,"assigned_vehicle_id":1}).to_list(50000)
    counts: Dict[str,int] = {}
    for j in jobs: counts[j["assigned_vehicle_id"]] = counts.get(j["assigned_vehicle_id"], 0) + 1
    by_vehicle = []
    total_cap = 0
    rows = []
    for v in docs:
        total_cap += float(v.get("capacity_tonnes") or 0)
        c = counts.get(v["id"], 0)
        by_vehicle.append({"vehicle": v.get("vehicle_code") or v.get("name",""), "assignments": c})
        rows.append({"_id": v["id"], "_entity": "vehicles",
                     "vehicle_code": v.get("vehicle_code"), "rego": v.get("rego",""),
                     "make_model": v.get("make_model") or v.get("name",""),
                     "capacity_tonnes": v.get("capacity_tonnes"), "status": v.get("status"),
                     "total_jobs_assigned": c})
    by_vehicle.sort(key=lambda r: -r["assignments"])
    status_dist = {}
    for v in docs: status_dist[v.get("status","unknown")] = status_dist.get(v.get("status","unknown"), 0) + 1
    most_used = by_vehicle[0]["vehicle"] if by_vehicle else "—"
    active = sum(1 for v in docs if v.get("status") == "active")
    return {"kpis": {"total_vehicles": len(docs), "active_vehicles": active,
                     "total_capacity_tonnes": round(total_cap, 1), "most_used_vehicle": most_used},
            "charts": {"assignments_per_vehicle": by_vehicle, "status_distribution": [{"status":k,"count":v} for k,v in status_dist.items()]},
            "table": {"columns":["vehicle_code","rego","make_model","capacity_tonnes","status","total_jobs_assigned"],"rows":rows,"total":len(rows)}}

async def _report_employees(date_from, date_to, _filters):
    docs = await db.employees.find({"deleted_at": {"$in":[None]}}, {"_id":0}).to_list(2000)
    if (_filters or {}).get("active") in ("true","false"):
        flag = _filters["active"] == "true"
        docs = [d for d in docs if bool(d.get("is_active", True)) == flag]
    if (_filters or {}).get("role"):
        docs = [d for d in docs if d.get("role") == _filters["role"]]
    jobs = await db.jobs.find({"deleted_at":{"$in":[None]},"assigned_employee_ids":{"$ne":None}}, {"_id":0,"assigned_employee_ids":1,"created_from_quote_at":1}).to_list(50000)
    counts: Dict[str,int] = {}
    last_at: Dict[str,str] = {}
    for j in jobs:
        for eid in (j.get("assigned_employee_ids") or []):
            counts[eid] = counts.get(eid,0)+1
            at = j.get("created_from_quote_at","")
            if at > last_at.get(eid,""): last_at[eid] = at
    rows = []; by_emp = []; role_dist = {}
    total_asg = 0
    for e in docs:
        c = counts.get(e["id"], 0); total_asg += c
        rows.append({"_id": e["id"], "_entity": "employees",
                     "name": e.get("name"), "role": e.get("role"), "active": bool(e.get("is_active", True)),
                     "total_jobs_assigned": c, "last_assigned_at": last_at.get(e["id"],"")})
        by_emp.append({"employee": e.get("name",""), "assignments": c})
        role_dist[e.get("role","unknown")] = role_dist.get(e.get("role","unknown"),0)+1
    by_emp.sort(key=lambda r: -r["assignments"])
    most_active = by_emp[0]["employee"] if by_emp else "—"
    avg_per = round(total_asg/len(docs), 1) if docs else 0
    active = sum(1 for e in docs if e.get("is_active", True))
    return {"kpis":{"active_employees":active,"total_assignments":total_asg,
                    "avg_assignments_per_employee":avg_per,"most_active_employee":most_active},
            "charts":{"assignments_per_employee":by_emp,
                      "role_distribution":[{"role":k,"count":v} for k,v in role_dist.items()]},
            "table":{"columns":["name","role","active","total_jobs_assigned","last_assigned_at"],"rows":rows,"total":len(rows)}}

async def _report_margin(date_from, date_to, _filters):
    df, dt = _date_range_iso(date_from, date_to)
    panel_filter = (_filters or {}).get("panel_type_key")
    q: Dict[str, Any] = {"deleted_at": {"$in":[None]}, "created_at": {"$gte": df, "$lte": dt},
                         "status": {"$in":["sent","accepted"]}}
    docs = await db.quotes.find(q, {"_id":0}).to_list(10000)
    pt_stats: Dict[str, Dict[str, float]] = {}
    fin_stats: Dict[str, Dict[str, float]] = {}
    total_margin = 0.0; total_cost = 0.0; total_sell = 0.0; total_lines = 0
    months_back = _months_back(6)
    margin_trend: Dict[str, List[float]] = {label: [] for _, _, label in months_back}
    for q_ in docs:
        for l in (q_.get("line_items") or []):
            if panel_filter and l.get("panel_type_key") != panel_filter: continue
            sell = float(l.get("subtotal_aud") or 0); cost = float(l.get("total_cost_aud") or 0)
            margin = sell - cost
            mpct = float(l.get("margin_pct") or 0)
            pt = l.get("panel_type_label","")
            fk = l.get("finish_label","")
            for sk_map, key in [(pt_stats, pt), (fin_stats, fk)]:
                d_ = sk_map.setdefault(key, {"sell":0,"cost":0,"margin":0,"margin_pct_sum":0,"n":0})
                d_["sell"] += sell; d_["cost"] += cost; d_["margin"] += margin
                d_["margin_pct_sum"] += mpct; d_["n"] += 1
            total_margin += margin; total_cost += cost; total_sell += sell; total_lines += 1
            ca = q_.get("created_at","")[:7]
            label = ca.replace("-", "-")  # already YYYY-MM
            if label in margin_trend: margin_trend[label].append(mpct)
    def avg(group):
        out = []
        for k, v in group.items():
            n = v["n"] or 1
            out.append({"key": k, "line_count": v["n"], "avg_sell_aud": _round2(v["sell"]/n),
                        "avg_cost_aud": _round2(v["cost"]/n), "avg_margin_aud": _round2(v["margin"]/n),
                        "avg_margin_pct": round(v["margin_pct_sum"]/n, 1)})
        out.sort(key=lambda r: -r["avg_margin_pct"]); return out
    by_panel = avg(pt_stats); by_finish = avg(fin_stats)
    margin_trend_arr = [{"month": label, "avg_margin_pct": round(sum(margin_trend[label])/len(margin_trend[label]),1) if margin_trend[label] else 0} for _,_,label in months_back]
    avg_margin_pct = round((total_margin/total_sell*100), 1) if total_sell else 0
    highest_panel = by_panel[0]["key"] if by_panel else "—"
    return {"kpis":{"avg_margin_pct":avg_margin_pct,"highest_margin_panel":highest_panel,
                    "total_quoted_margin_aud":_round2(total_margin),"total_cost_aud":_round2(total_cost)},
            "charts":{"avg_margin_pct_by_panel":by_panel,"avg_margin_pct_by_finish":by_finish,
                      "margin_trend":margin_trend_arr},
            "table":{"columns":["panel_type","line_count","avg_sell_aud","avg_cost_aud","avg_margin_aud","avg_margin_pct"],
                     "rows":[{"panel_type":r["key"],**{k:v for k,v in r.items() if k!="key"}} for r in by_panel],
                     "total":len(by_panel)}}

async def _report_compliance(date_from, date_to, filters):
    df, dt = _date_range_iso(date_from, date_to)
    q = {"deleted_at": None, "created_at": {"$gte": df, "$lte": dt}}
    docs = await db.compliance_forms.find(q, {"_id": 0}).to_list(2000)
    # KPIs
    month_start = (now_utc().replace(day=1)).date().isoformat() + "T00:00:00+00:00"
    completed_this_month = sum(1 for d in docs if d.get("status") == "completed" and d.get("created_at","") >= month_start)
    awaiting_qa = sum(1 for d in docs if d.get("status") == "completed")
    signed_count = sum(1 for d in docs if d.get("status") == "signed")
    ncr_count = sum(1 for d in docs if d.get("ncr_flag"))
    total = len(docs)
    ncr_rate = round((ncr_count / total) * 100.0, 1) if total else 0.0

    # ---- Phase 11: Hold-point compliance + sign-off latency + photo coverage ----
    # Hold-point compliance % over the date range:
    # for each active job that has reached or passed a hold-point status, check whether
    # the required form is signed. Numerator = satisfied checkpoints, denom = expected.
    jobs_in_range = await db.jobs.find(
        {"deleted_at": None,
         "$or": [{"updated_at": {"$gte": df, "$lte": dt}},
                  {"created_at": {"$gte": df, "$lte": dt}}]},
        {"_id": 0, "id": 1, "job_number": 1, "status": 1, "status_history": 1}
    ).to_list(2000)
    expected = 0; satisfied = 0
    missing_by_stage = {"pre_pour": 0, "post_pour": 0, "compliance_cert": 0}
    for j in jobs_in_range:
        cur_status = j.get("status")
        if cur_status == "cancelled": continue
        try: cur_i = JOB_STATUS_ORDER.index(cur_status)
        except ValueError: continue
        for rule in HOLD_POINT_RULES:
            to_i = JOB_STATUS_ORDER.index(rule["to"])
            # Was this hold point crossed (current job is at or past the gated status)?
            if cur_i < to_i: continue
            expected += 1
            signed = await db.compliance_forms.count_documents({
                "job_id": j["id"], "form_type": rule["form_type"],
                "status": "signed", "deleted_at": None})
            if signed > 0: satisfied += 1
            else: missing_by_stage[rule["form_type"]] += 1
    hold_point_compliance_pct = round((satisfied / expected) * 100.0, 1) if expected else 100.0

    # Sign-off latency: avg days from form created_at → status==signed (signed forms only)
    latencies = []
    for d in docs:
        if d.get("status") != "signed": continue
        c = d.get("created_at"); s = d.get("signed_at") or d.get("updated_at")
        if not c or not s: continue
        try:
            from datetime import datetime as _dt
            ct = _dt.fromisoformat(c.replace("Z","+00:00"))
            st = _dt.fromisoformat(s.replace("Z","+00:00"))
            delta_d = (st - ct).total_seconds() / 86400.0
            if delta_d >= 0: latencies.append(delta_d)
        except Exception: pass
    avg_signoff_days = round(sum(latencies) / len(latencies), 1) if latencies else 0.0

    # Photo coverage: % of completed/signed forms that have ≥1 photo
    needs_photo = [d for d in docs if d.get("status") in ("completed","signed")]
    with_photo = sum(1 for d in needs_photo if (d.get("photos") and len(d["photos"]) > 0)
                     or any((c.get("photos") or []) for s in (d.get("sections") or {}).values()
                            if isinstance(s, dict) for c in s.values() if isinstance(c, dict)))
    photo_coverage_pct = round((with_photo / len(needs_photo)) * 100.0, 1) if needs_photo else 0.0

    # Chart: forms by type per month (last 6)
    series = {"pre_pour": {}, "post_pour": {}, "compliance_cert": {}}
    months = list(_months_back(6))
    for d in docs:
        ts = d.get("created_at", "")[:7]
        ft = d.get("form_type")
        if ft in series:
            series[ft][ts] = series[ft].get(ts, 0) + 1
    chart_rows = []
    for y, m, label in months:
        ym = f"{y:04d}-{m:02d}"
        chart_rows.append({"month": label,
                           "Pre-Pour": series["pre_pour"].get(ym, 0),
                           "Post-Pour": series["post_pour"].get(ym, 0),
                           "Certificate": series["compliance_cert"].get(ym, 0)})

    # Chart: missing-by-stage (bar)
    missing_chart = [
        {"stage": "Pre-Pour",    "missing": missing_by_stage["pre_pour"]},
        {"stage": "Post-Pour",   "missing": missing_by_stage["post_pour"]},
        {"stage": "Certificate", "missing": missing_by_stage["compliance_cert"]},
    ]

    # Table
    rows = [{"_id": d.get("id"), "_entity": "compliance-forms", "_status": d.get("status"),
             "form_number": d.get("form_number"), "type": d.get("form_type"),
             "panel_id": d.get("panel_id"), "project": d.get("project_name") or "",
             "status": d.get("status"), "inspection": d.get("date_of_inspection") or "",
             "ncr": "Yes" if d.get("ncr_flag") else ""}
            for d in sorted(docs, key=lambda x: x.get("created_at",""), reverse=True)[:200]]
    return {
        "kpis": {
            "completed_this_month": completed_this_month,
            "awaiting_qa_signoff": awaiting_qa,
            "signed_total": signed_count,
            "ncr_rate_pct": ncr_rate,
            "hold_point_compliance_pct": hold_point_compliance_pct,
            "hold_point_expected": expected,
            "hold_point_satisfied": satisfied,
            "avg_signoff_latency_days": avg_signoff_days,
            "photo_coverage_pct": photo_coverage_pct,
        },
        "charts": {
            "by_type_per_month": {"type": "stacked_bar", "x": "month",
                                  "series": ["Pre-Pour", "Post-Pour", "Certificate"],
                                  "rows": chart_rows},
            "missing_by_stage": {"type": "bar", "x": "stage", "series": ["missing"], "rows": missing_chart},
        },
        "table": {
            "columns": ["form_number", "type", "panel_id", "project", "status", "inspection", "ncr"],
            "rows": rows,
        },
    }

async def _report_projects(date_from, date_to, _filters):
    df, dt = _date_range_iso(date_from, date_to)
    q: Dict[str, Any] = {"deleted_at": {"$in": [None]}}
    if (_filters or {}).get("customer_id"): q["customer_id"] = _filters["customer_id"]
    if (_filters or {}).get("status"): q["status"] = {"$in": _filters["status"].split(",")}
    docs = await db.projects.find(q, {"_id":0}).sort("created_at", -1).limit(2000).to_list(2000)
    cmap = {c["id"]: c["company_name"] for c in await db.customers.find(
        {"id": {"$in": [d.get("customer_id") for d in docs]}}, {"_id":0,"id":1,"company_name":1}).to_list(3000)}
    by_status: Dict[str, int] = {}
    for d in docs: by_status[d.get("status","planning")] = by_status.get(d.get("status","planning"),0)+1
    rows = [{"_id": d["id"], "_entity": "projects", "_status": d.get("status"),
             "project_name": d.get("project_name",""), "customer": cmap.get(d.get("customer_id"),""),
             "status": d.get("status",""), "created_at": d.get("created_at","")[:10]} for d in docs]
    return {
        "kpis": {"total_projects": len(docs),
                 "planning": by_status.get("planning",0),
                 "quoted": by_status.get("quoted",0),
                 "won": by_status.get("won",0),
                 "completed": by_status.get("completed",0)},
        "charts": {"by_status": [{"status":k,"count":v} for k,v in by_status.items()]},
        "table": {"columns":["project_name","customer","status","created_at"],"rows":rows,"total":len(rows)},
    }

async def _report_audit_trail(date_from, date_to, filters):
    """Minimal audit report — respects the same list-endpoint filters. Returned
    shape mirrors the other reports so the ReportDetail UI can render it, but
    Audit Trail rows do NOT expose _id/_entity so row-actions won't appear."""
    df, dt = _date_range_iso(date_from, date_to)
    q: Dict[str, Any] = {"created_at": {"$gte": df, "$lte": dt}}
    docs = await db.audit_events.find(q, {"_id":0}).sort("created_at", -1).limit(500).to_list(500)
    by_action: Dict[str, int] = {}
    for d in docs:
        a = d.get("action","?"); by_action[a] = by_action.get(a,0)+1
    top = sorted(by_action.items(), key=lambda x:-x[1])[:6]
    rows = [{"when": d.get("created_at","")[:19].replace("T"," "),
             "actor": d.get("actor_email") or d.get("actor_name") or "system",
             "action": d.get("action",""),
             "entity": d.get("entity_type",""),
             "entity_name": d.get("entity_name",""),
             "metadata": (str(d.get("metadata") or "")[:120]) } for d in docs]
    return {
        "kpis": {"events_in_range": len(docs),
                 "top_action": top[0][0] if top else "—",
                 "unique_actors": len({d.get("actor_email") for d in docs if d.get("actor_email")})},
        "charts": {"by_action": [{"action":k,"count":v} for k,v in top]},
        "table": {"columns":["when","actor","action","entity","entity_name","metadata"],
                  "rows":rows, "total":len(rows)},
    }

_REPORT_FNS = {"customers":_report_customers,"quotes":_report_quotes,"jobs":_report_jobs,
               "invoices":_report_invoices,"vehicles":_report_vehicles,"employees":_report_employees,
               "projects":_report_projects,
               "margin":_report_margin,"compliance":_report_compliance,
               "audit-trail":_report_audit_trail,
               # Aliases (Phase 11.4 bug-fix): tester-friendly canonical URLs
               "compliance-forms":_report_compliance}

@api_router.get("/reports/{key}")
async def get_report(key: str, user: dict = Depends(get_current_user),
                     date_from: Optional[str] = None, date_to: Optional[str] = None,
                     status: Optional[str] = None, customer_id: Optional[str] = None,
                     state: Optional[str] = None, active: Optional[str] = None,
                     role: Optional[str] = None, panel_type_key: Optional[str] = None):
    if key not in _REPORT_FNS: raise HTTPException(status_code=404, detail="Unknown report")
    perm = REPORT_PERMS[key]
    if not has_permission(user, perm): raise HTTPException(status_code=403, detail=f"Missing {perm} permission")
    filters = {k:v for k,v in {"status":status,"customer_id":customer_id,"state":state,"active":active,
                                "role":role,"panel_type_key":panel_type_key}.items() if v}
    return await _REPORT_FNS[key](date_from, date_to, filters)

@api_router.get("/reports/{key}/export.csv")
async def export_report(key: str, user: dict = Depends(get_current_user),
                        date_from: Optional[str] = None, date_to: Optional[str] = None,
                        status: Optional[str] = None, customer_id: Optional[str] = None,
                        state: Optional[str] = None, active: Optional[str] = None,
                        role: Optional[str] = None, panel_type_key: Optional[str] = None):
    if key not in _REPORT_FNS: raise HTTPException(status_code=404, detail="Unknown report")
    perm = REPORT_PERMS[key]
    if not has_permission(user, perm): raise HTTPException(status_code=403, detail=f"Missing {perm} permission")
    import csv, io
    filters = {k:v for k,v in {"status":status,"customer_id":customer_id,"state":state,"active":active,
                                "role":role,"panel_type_key":panel_type_key}.items() if v}
    data = await _REPORT_FNS[key](date_from, date_to, filters)
    buf = io.StringIO(); w = csv.writer(buf)
    cols = data["table"]["columns"]; w.writerow(cols)
    for r in data["table"]["rows"]: w.writerow([r.get(c, "") for c in cols])
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={key}-report.csv"})


_DATA_EXPORT_COLLECTIONS = {
    "customers": "customers", "projects": "projects", "quotes": "quotes",
    "jobs": "jobs", "invoices": "invoices", "vehicles": "vehicles",
    "employees": "employees", "audit": "audit_events",
}

@api_router.get("/data-export/{module}.csv")
async def data_export(module: str, user: dict = Depends(get_current_user),
                      date_from: Optional[str] = None, date_to: Optional[str] = None,
                      include_deleted: bool = False, max_rows: int = Query(100000, ge=1, le=100000)):
    if not user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Super admin only")
    if module not in _DATA_EXPORT_COLLECTIONS:
        raise HTTPException(status_code=404, detail="Unknown module")
    coll_name = _DATA_EXPORT_COLLECTIONS[module]
    coll = getattr(db, coll_name)
    q: Dict[str, Any] = {}
    if not include_deleted and module != "audit": q["deleted_at"] = {"$in": [None]}
    date_field = "timestamp" if module == "audit" else "created_at"
    if date_from or date_to:
        df, dt = _date_range_iso(date_from, date_to, default_days=10000)
        q[date_field] = {"$gte": df, "$lte": dt}
    import csv, io, json as _j
    docs = await coll.find(q, {"_id": 0}).sort(date_field, -1).limit(max_rows + 1).to_list(max_rows + 1)
    capped = len(docs) > max_rows
    docs = docs[:max_rows]
    cols: List[str] = []
    seen = set()
    for d in docs:
        for k in d.keys():
            if k not in seen: seen.add(k); cols.append(k)
    buf = io.StringIO(); w = csv.writer(buf); w.writerow(cols)
    for d in docs:
        row = []
        for c in cols:
            v = d.get(c, "")
            if isinstance(v, (list, dict)): v = _j.dumps(v, default=str)
            row.append(v)
        w.writerow(row)
    if capped: w.writerow([f"--- EXPORT CAPPED AT {max_rows} ROWS ---"] + [""] * (len(cols) - 1))
    headers = {"Content-Disposition": f"attachment; filename={module}-export.csv"}
    if capped: headers["X-Export-Capped"] = "true"
    return Response(content=buf.getvalue(), media_type="text/csv", headers=headers)


# ============================================================================
# Phase 11.6 — Tavily connect + AI Compliance Standards Check
# ============================================================================
from services.ai_compliance import (
    tavily_verify as _tavily_verify,
    gather_sources as _tavily_gather,
    call_llm as _ai_call_llm,
    _build_prompt as _ai_build_prompt,
    _extract_json as _ai_extract_json,
    filter_cited_changes as _ai_filter_changes,
    filter_cited_template as _ai_filter_template,
    check_rate_limit as _ai_rate_check,
)


@api_router.post("/admin/settings/tavily/connect")
async def tavily_connect(payload: Dict[str, Any] = Body(...),
                          user: dict = Depends(require_super_admin)):
    api_key = (payload.get("api_key") or "").strip()
    if _is_masked(api_key):
        stored = (await _load_admin_settings()).get("tavily", {})
        api_key = stored.get("api_key") or ""
    if not api_key:
        raise HTTPException(status_code=400, detail="api_key required")
    v = await _tavily_verify(api_key)
    if not v.get("ok"):
        return {"status": v.get("status","ERROR"), "message": v.get("message","Failed")}
    settings = await _load_admin_settings()
    settings["tavily"] = {"api_key": api_key, "enabled": True,
                           "status": "CONNECTED", "connected_at": now_iso()}
    await db.settings.update_one({"key":"admin_settings"},
        {"$set": {"tavily": settings["tavily"], "updated_at": now_iso()}}, upsert=True)
    await record_audit(user, "tavily_connected", "admin_settings", "tavily", "Tavily",
                       metadata={"status": "CONNECTED"})
    return {"status": "CONNECTED", "message": v.get("message","Connected")}


@api_router.post("/admin/settings/tavily/disconnect")
async def tavily_disconnect(user: dict = Depends(require_super_admin)):
    await db.settings.update_one({"key":"admin_settings"},
        {"$set": {"tavily": {"api_key":"","enabled":False,"status":"NOT_CONFIGURED","connected_at":None},
                  "updated_at": now_iso()}}, upsert=True)
    await record_audit(user, "tavily_disconnected", "admin_settings", "tavily", "Tavily")
    return {"status": "NOT_CONFIGURED"}


@api_router.get("/admin/settings/compliance-standards")
async def get_compliance_standards(user: dict = Depends(require_super_admin)):
    return (await _load_admin_settings()).get("compliance_standards", [])


@api_router.put("/admin/settings/compliance-standards")
async def put_compliance_standards(payload: List[Dict[str, Any]] = Body(...),
                                     user: dict = Depends(require_super_admin)):
    clean = [{"name": (s.get("name") or "").strip(),
              "url": (s.get("url") or "").strip()}
             for s in payload if (s.get("name") or "").strip()]
    await db.settings.update_one({"key":"admin_settings"},
        {"$set": {"compliance_standards": clean, "updated_at": now_iso()}}, upsert=True)
    await record_audit(user, "settings_changed", "admin_settings", "compliance_standards",
                       "compliance_standards", metadata={"count": len(clean)})
    return clean


class AICheckPayload(BaseModel):
    mode: Literal["update", "generate"]
    template_id: Optional[str] = None
    template_type: Optional[str] = None
    standards: List[str] = Field(default_factory=list)


@api_router.post("/admin/compliance/ai-check")
async def ai_compliance_check(payload: AICheckPayload,
                                user: dict = Depends(require_super_admin)):
    # Rate limit
    ok, remaining = _ai_rate_check(user["id"])
    if not ok:
        raise HTTPException(status_code=429, detail=f"AI check rate limit reached ({20}/hour). Try again later.")

    settings = await _load_admin_settings()
    ai = settings.get("ai_providers", {})
    active = ai.get("active_text_provider")
    if not active:
        raise HTTPException(status_code=400, detail="No active AI text provider set. Configure one in Admin Settings → AI Providers.")
    prov = ai.get(active) or {}
    status = prov.get("status")
    if status not in ("CONNECTED", "MANUAL"):
        raise HTTPException(status_code=400, detail=f"Active AI provider '{active}' is {status or 'NOT_CONFIGURED'}. Reconnect it.")
    ai_key = prov.get("api_key") or ""
    if not ai_key:
        raise HTTPException(status_code=400, detail=f"Active AI provider '{active}' has no stored API key.")

    tav = settings.get("tavily", {})
    if not tav.get("enabled") or not tav.get("api_key"):
        raise HTTPException(status_code=400, detail="Tavily web-search key not configured. Add it in Admin Settings → Integrations → Web Search.")

    # Load standards list
    if payload.standards:
        standards = payload.standards
    else:
        standards = [s["name"] for s in (settings.get("compliance_standards") or [])]

    # Load template (for update mode)
    template = None; template_type = payload.template_type
    if payload.mode == "update":
        if not payload.template_id:
            raise HTTPException(status_code=400, detail="template_id required for update mode")
        template = await db.compliance_form_templates.find_one({"id": payload.template_id}, {"_id":0})
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
        template_type = template.get("category") or template.get("code")

    # Step 1 — Tavily web search
    template_keywords = template_type or payload.template_type or "precast concrete compliance"
    sources, tavily_error = await _tavily_gather(tav["api_key"], standards, template_keywords)
    if tavily_error and not sources:
        raise HTTPException(status_code=502, detail=f"Tavily: {tavily_error}")
    if not sources:
        raise HTTPException(status_code=502,
            detail="Tavily returned no matching results for the selected standards. "
                    "Try broader standards names or verify the Tavily API key.")

    # Step 2 — LLM call
    prompt = _ai_build_prompt(payload.mode, template_type, template, standards, sources)
    llm_result = await _ai_call_llm(active, ai_key, prompt)
    if not llm_result.get("ok"):
        raise HTTPException(status_code=502, detail=f"LLM call failed: {llm_result.get('error')}")

    parsed = _ai_extract_json(llm_result["content"])
    if not parsed:
        raise HTTPException(status_code=502, detail="LLM did not return valid JSON")

    dropped_changes = 0
    changes: List[Dict[str, Any]] = []
    new_template = None
    if payload.mode == "update":
        changes, dropped_changes = _ai_filter_changes(parsed.get("changes", []))
    else:
        new_template, dropped_changes = _ai_filter_template(parsed.get("template"))

    # Step 3 — persist AI draft (never overwrite source)
    draft_id = str(uuid.uuid4())
    now = now_iso()
    draft_doc: Dict[str, Any] = {
        "id": draft_id,
        "code": (new_template.get("code") if new_template else f"AI_DRAFT_{draft_id[:8]}"),
        "name": (new_template.get("name") if new_template else
                  f"{template.get('name','Template')} (AI draft {now[:10]})"),
        "description": (new_template.get("description") if new_template else f"AI Standards Check draft — {now}"),
        "category": template_type or "custom",
        "sections": (new_template.get("sections", []) if new_template else template.get("sections", [])),
        "header_fields": (new_template.get("header_fields", []) if new_template else template.get("header_fields", [])),
        "signoff_stages": (new_template.get("signoff_stages", []) if new_template else template.get("signoff_stages", [])),
        "is_system": False, "active": False, "version": 1,
        "status": "ai_draft",
        "parent_template_id": payload.template_id,
        "ai_metadata": {
            "mode": payload.mode,
            "provider": active,
            "model": llm_result.get("model"),
            "prompt_tokens": llm_result.get("prompt_tokens", 0),
            "completion_tokens": llm_result.get("completion_tokens", 0),
            "sources": [{"standard": s["standard"], "title": s["title"], "url": s["url"]} for s in sources],
            "generated_at": now,
            "run_id": draft_id,
            "summary": (parsed.get("summary") or "")[:1000],
            "proposed_changes": changes,
            "dropped_for_missing_citation": dropped_changes,
        },
        "created_at": now, "updated_at": now,
        "created_by_user_id": user["id"], "deleted_at": None,
    }
    await db.compliance_form_templates.insert_one(draft_doc)
    await record_audit(user, "ai_template_check", "compliance_form_template",
                       draft_id, draft_doc["name"],
                       metadata={"mode": payload.mode, "template_id": payload.template_id,
                                  "draft_id": draft_id, "provider": active,
                                  "model": llm_result.get("model"),
                                  "standards_checked": standards,
                                  "sources_cited": [s["url"] for s in sources[:20]],
                                  "prompt_tokens": llm_result.get("prompt_tokens", 0),
                                  "completion_tokens": llm_result.get("completion_tokens", 0),
                                  "changes_kept": len(changes),
                                  "dropped_for_missing_citation": dropped_changes})
    return {
        "draft_id": draft_id,
        "mode": payload.mode,
        "summary": (parsed.get("summary") or ""),
        "changes": changes,
        "sources": [{"standard": s["standard"], "title": s["title"], "url": s["url"]} for s in sources],
        "provider_used": active,
        "model": llm_result.get("model"),
        "rate_remaining": remaining,
        "dropped_for_missing_citation": dropped_changes,
        "template_preview": new_template if payload.mode == "generate" else None,
    }


class AIAcceptPayload(BaseModel):
    accepted_change_ids: List[str] = Field(default_factory=list)


@api_router.post("/admin/compliance/ai-check/{draft_id}/accept")
async def ai_check_accept(draft_id: str, payload: AIAcceptPayload,
                           user: dict = Depends(require_super_admin)):
    draft = await db.compliance_form_templates.find_one({"id": draft_id, "status":"ai_draft"}, {"_id":0})
    if not draft:
        raise HTTPException(status_code=404, detail="AI draft not found")
    all_changes = (draft.get("ai_metadata") or {}).get("proposed_changes") or []
    if payload.accepted_change_ids:
        accepted = [c for c in all_changes if c.get("id") in set(payload.accepted_change_ids)]
    else:
        accepted = all_changes  # generate-mode drafts don't have separate change IDs

    # Never overwrite source. Promote the draft to a regular customer template.
    now = now_iso()
    await db.compliance_form_templates.update_one(
        {"id": draft_id},
        {"$set": {"status": "active", "active": True,
                  "ai_metadata.accepted_at": now,
                  "ai_metadata.accepted_change_ids": [c.get("id") for c in accepted],
                  "updated_at": now, "updated_by_user_id": user["id"]}})
    await record_audit(user, "ai_template_accepted", "compliance_form_template",
                       draft_id, draft.get("name"),
                       metadata={"accepted_change_count": len(accepted),
                                  "parent_template_id": draft.get("parent_template_id")})
    return {"draft_id": draft_id, "status": "active", "accepted_changes": len(accepted)}


app.include_router(api_router)


# ===========================================================================
# Phase 10 — Compliance Forms (Pre-Pour / Post-Pour / Compliance Cert)
# ===========================================================================
from compliance_schema import FORM_SCHEMAS, FORM_TYPE_CODE, empty_sections_for
from fastapi import UploadFile, File, Form

_cf_router = APIRouter(prefix="/api")

UPLOAD_DIR = ROOT_DIR.parent / "backend" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

class ComplianceFormCreate(BaseModel):
    form_type: str = Field(pattern="^(pre_pour|post_pour|compliance_cert)$")
    panel_id: str = Field(min_length=1, max_length=80)
    job_id: Optional[str] = None
    client_name: Optional[str] = ""
    project_name: Optional[str] = ""
    grade_of_concrete: Optional[str] = ""
    date_of_inspection: Optional[str] = None  # ISO date
    date_of_casting: Optional[str] = None

class ComplianceFormPatch(BaseModel):
    panel_id: Optional[str] = None
    client_name: Optional[str] = None
    project_name: Optional[str] = None
    grade_of_concrete: Optional[str] = None
    date_of_inspection: Optional[str] = None
    date_of_casting: Optional[str] = None
    sections: Optional[Dict[str, Any]] = None
    ncr_flag: Optional[bool] = None
    ncr_reference: Optional[str] = None
    checked_by_user_id: Optional[str] = None
    checked_by_qa_user_id: Optional[str] = None

class TransitionPayload(BaseModel):
    to: str = Field(pattern="^(draft|completed|signed)$")


async def _next_form_number(form_type: str) -> str:
    code = FORM_TYPE_CODE[form_type]
    year = now_utc().year
    prefix = f"{code}-{year}-"
    last = await db.compliance_forms.find_one(
        {"form_number": {"$regex": f"^{prefix}"}},
        sort=[("form_number", -1)], projection={"form_number": 1, "_id": 0},
    )
    nxt = 1
    if last and last.get("form_number"):
        try: nxt = int(last["form_number"].rsplit("-", 1)[1]) + 1
        except Exception: nxt = 1
    return f"{prefix}{nxt:04d}"


@_cf_router.get("/compliance-forms/schemas")
async def cf_schemas(_u: dict = Depends(require_permission("forms.view"))):
    return FORM_SCHEMAS


@_cf_router.get("/compliance-forms")
async def cf_list(form_type: Optional[str] = None, status: Optional[str] = None,
                   job_id: Optional[str] = None, lifecycle: str = "active",
                   date_from: Optional[str] = None, date_to: Optional[str] = None,
                   q: Optional[str] = None,
                   _u: dict = Depends(require_permission("forms.view"))):
    flt: Dict[str, Any] = {}
    if lifecycle == "active":   flt["deleted_at"] = None
    elif lifecycle == "deleted": flt["deleted_at"] = {"$ne": None}
    if form_type: flt["form_type"] = form_type
    if status:    flt["status"] = status
    if job_id:    flt["job_id"] = job_id
    if date_from or date_to:
        df, dt = _date_range_iso(date_from, date_to, default_days=365)
        flt["created_at"] = {"$gte": df, "$lte": dt}
    if q:
        flt["$or"] = [{"panel_id": {"$regex": q, "$options": "i"}},
                      {"form_number": {"$regex": q, "$options": "i"}},
                      {"project_name": {"$regex": q, "$options": "i"}}]
    docs = await db.compliance_forms.find(flt, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"items": docs, "total": len(docs)}


@_cf_router.post("/compliance-forms", status_code=201)
async def cf_create(payload: ComplianceFormCreate, user: dict = Depends(require_permission("forms.create"))):
    # Auto-fill from job if provided
    client_name, project_name, customer_id, project_id = (
        payload.client_name or "", payload.project_name or "", None, None)
    if payload.job_id:
        job = await db.jobs.find_one({"id": payload.job_id, "deleted_at": None}, {"_id": 0})
        if job:
            customer_id = job.get("customer_id"); project_id = job.get("project_id")
            if not client_name and customer_id:
                cust = await db.customers.find_one({"id": customer_id}, {"_id":0,"company_name":1})
                if cust: client_name = cust.get("company_name") or ""
            if not project_name and project_id:
                proj = await db.projects.find_one({"id": project_id}, {"_id":0,"name":1})
                if proj: project_name = proj.get("name") or ""
    fid = str(uuid.uuid4())
    doc = {
        "id": fid,
        "form_number": await _next_form_number(payload.form_type),
        "form_type": payload.form_type,
        "panel_id": payload.panel_id.strip(),
        "job_id": payload.job_id,
        "customer_id": customer_id,
        "project_id": project_id,
        "client_name": client_name,
        "project_name": project_name,
        "grade_of_concrete": payload.grade_of_concrete or "",
        "date_of_inspection": payload.date_of_inspection,
        "date_of_casting": payload.date_of_casting,
        "status": "draft",
        "sections": empty_sections_for(payload.form_type),
        "ncr_flag": False, "ncr_reference": "",
        "checked_by_user_id": None, "checked_by_qa_user_id": None,
        "signed_at": None, "signed_by_user_id": None,
        "photos": [],
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by_user_id": user["id"], "updated_by_user_id": user["id"],
        "deleted_at": None, "deleted_by_user_id": None,
    }
    await db.compliance_forms.insert_one(doc)
    doc.pop("_id", None)
    await record_audit(user, "created", "compliance_form", fid, doc["form_number"])
    return doc


@_cf_router.get("/compliance-forms/{fid}")
async def cf_get(fid: str, _u: dict = Depends(require_permission("forms.view"))):
    d = await db.compliance_forms.find_one({"id": fid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Form not found")
    return d


@_cf_router.patch("/compliance-forms/{fid}")
async def cf_patch(fid: str, payload: ComplianceFormPatch, user: dict = Depends(require_permission("forms.edit"))):
    d = await db.compliance_forms.find_one({"id": fid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Form not found")
    if d.get("deleted_at"): raise HTTPException(status_code=400, detail="Form is deleted")
    if d.get("status") == "signed" and not user.get("is_super_admin"):
        raise HTTPException(status_code=400, detail="Signed forms are immutable. Contact a super admin to unlock.")
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not upd: return d
    upd["updated_at"] = now_iso(); upd["updated_by_user_id"] = user["id"]
    await db.compliance_forms.update_one({"id": fid}, {"$set": upd})
    await record_audit(user, "updated", "compliance_form", fid, d["form_number"],
                       metadata={"fields": list(upd.keys())})
    return await db.compliance_forms.find_one({"id": fid}, {"_id": 0})


@_cf_router.delete("/compliance-forms/{fid}")
async def cf_delete(fid: str, user: dict = Depends(require_permission("forms.delete"))):
    """Soft-delete a compliance form. Signed forms are locked (super admin only)."""
    d = await db.compliance_forms.find_one({"id": fid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Form not found")
    if d.get("deleted_at"): raise HTTPException(status_code=400, detail="Form already deleted")
    if d.get("status") == "signed" and not user.get("is_super_admin"):
        raise HTTPException(status_code=400, detail="Signed forms are locked. Raise an NCR instead.")
    await db.compliance_forms.update_one({"id": fid},
        {"$set": {"deleted_at": now_iso(), "deleted_by_user_id": user["id"],
                  "updated_at": now_iso()}})
    await record_audit(user, "soft_deleted", "compliance_form", fid, d.get("form_number", fid))
    return {"soft_deleted": True}


@_cf_router.post("/compliance-forms/{fid}/transition")
async def cf_transition(fid: str, payload: TransitionPayload, user: dict = Depends(require_permission("forms.edit"))):
    d = await db.compliance_forms.find_one({"id": fid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Form not found")
    cur, to = d.get("status"), payload.to
    if cur == to: return d
    # State machine
    if to == "completed":
        if cur != "draft": raise HTTPException(status_code=400, detail=f"Cannot move {cur}→completed")
        if not d.get("panel_id"): raise HTTPException(status_code=400, detail="panel_id is required")
    elif to == "signed":
        if cur != "completed": raise HTTPException(status_code=400, detail=f"Cannot move {cur}→signed (must be completed first)")
        if not has_permission(user, "forms.sign"): raise HTTPException(status_code=403, detail="forms.sign permission required to sign forms")
        if not d.get("checked_by_qa_user_id"): raise HTTPException(status_code=400, detail="checked_by_qa_user_id must be set before signing")
    elif to == "draft":
        if cur == "signed" and not user.get("is_super_admin"):
            raise HTTPException(status_code=403, detail="Only super admins can un-sign a form")
    upd = {"status": to, "updated_at": now_iso(), "updated_by_user_id": user["id"]}
    if to == "signed":
        upd["signed_at"] = now_iso(); upd["signed_by_user_id"] = user["id"]
    elif to == "draft":
        upd["signed_at"] = None; upd["signed_by_user_id"] = None
    await db.compliance_forms.update_one({"id": fid}, {"$set": upd})
    await record_audit(user, "transition" if to != "signed" else "signed",
                       "compliance_form", fid, d["form_number"],
                       metadata={"from": cur, "to": to})
    return await db.compliance_forms.find_one({"id": fid}, {"_id": 0})


@_cf_router.post("/compliance-forms/{fid}/photos")
async def cf_upload_photo(fid: str, file: UploadFile = File(...), caption: str = Form(""),
                           explicit_lat: str = Form(""), explicit_lng: str = Form(""),
                           explicit_taken_at: str = Form(""),
                           user: dict = Depends(require_permission("forms.edit"))):
    d = await db.compliance_forms.find_one({"id": fid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Form not found")
    if d.get("status") == "signed" and not user.get("is_super_admin"):
        raise HTTPException(status_code=400, detail="Signed forms are immutable")
    ext = (file.filename or "").split(".")[-1].lower()
    if ext not in {"jpg","jpeg","png","webp","heic","heif"}:
        raise HTTPException(status_code=400, detail="Unsupported image type")
    pid = str(uuid.uuid4())
    saved = UPLOAD_DIR / f"{fid}_{pid}.{ext}"
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large (10 MB max)")
    saved.write_bytes(content)
    # Extract EXIF GPS + timestamp (best effort, never fail upload on parse error)
    gps_lat = gps_lng = None
    taken_at = None
    try:
        from PIL import Image, ExifTags
        from io import BytesIO
        im = Image.open(BytesIO(content))
        exif = im.getexif() or {}
        # Top-level DateTime
        for tag_id, val in exif.items():
            tag = ExifTags.TAGS.get(tag_id, tag_id)
            if tag in ("DateTime", "DateTimeOriginal") and not taken_at:
                taken_at = str(val)
        # GPS IFD
        gps_ifd_id = next((i for i,t in ExifTags.TAGS.items() if t == "GPSInfo"), 34853)
        gps_ifd = exif.get_ifd(gps_ifd_id) if hasattr(exif, "get_ifd") else exif.get(gps_ifd_id)
        if gps_ifd:
            gtags = {ExifTags.GPSTAGS.get(k, k): v for k, v in gps_ifd.items()}
            def _dms_to_deg(dms, ref):
                try:
                    d, m, s = [float(x) for x in dms]
                    val = d + m/60 + s/3600
                    if ref in ("S", "W"): val = -val
                    return round(val, 6)
                except Exception: return None
            if gtags.get("GPSLatitude") and gtags.get("GPSLatitudeRef"):
                gps_lat = _dms_to_deg(gtags["GPSLatitude"], gtags["GPSLatitudeRef"])
            if gtags.get("GPSLongitude") and gtags.get("GPSLongitudeRef"):
                gps_lng = _dms_to_deg(gtags["GPSLongitude"], gtags["GPSLongitudeRef"])
    except Exception as _e:
        logger.debug(f"EXIF parse skipped on photo {pid}: {_e}")
    # Explicit device coords override EXIF (e.g. from mobile GPS)
    if explicit_lat:
        try: gps_lat = float(explicit_lat)
        except Exception: pass
    if explicit_lng:
        try: gps_lng = float(explicit_lng)
        except Exception: pass
    if explicit_taken_at:
        taken_at = explicit_taken_at
    meta = {"id": pid, "filename": file.filename, "url": f"/api/compliance-forms/{fid}/photos/{pid}",
            "size": len(content), "caption": caption,
            "gps_lat": gps_lat, "gps_lng": gps_lng, "taken_at": taken_at,
            "uploaded_at": now_iso(), "uploaded_by_user_id": user["id"]}
    await db.compliance_forms.update_one({"id": fid},
        {"$push": {"photos": meta}, "$set": {"updated_at": now_iso()}})
    await record_audit(user, "photo_uploaded", "compliance_form", fid, d["form_number"],
                       metadata={"photo_id": pid, "filename": file.filename})
    return meta


@_cf_router.get("/compliance-forms/{fid}/photos/{pid}")
async def cf_get_photo(fid: str, pid: str, _u: dict = Depends(require_permission("forms.view"))):
    d = await db.compliance_forms.find_one({"id": fid}, {"_id": 0, "photos": 1})
    if not d: raise HTTPException(status_code=404, detail="Form not found")
    for p in d.get("photos", []):
        if p["id"] == pid:
            ext = p["filename"].split(".")[-1].lower() if p.get("filename") else "jpg"
            saved = UPLOAD_DIR / f"{fid}_{pid}.{ext}"
            if saved.exists():
                from fastapi.responses import FileResponse
                return FileResponse(str(saved))
    raise HTTPException(status_code=404, detail="Photo not found")


@_cf_router.delete("/compliance-forms/{fid}/photos/{pid}")
async def cf_delete_photo(fid: str, pid: str, user: dict = Depends(require_permission("forms.edit"))):
    d = await db.compliance_forms.find_one({"id": fid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Form not found")
    await db.compliance_forms.update_one({"id": fid},
        {"$pull": {"photos": {"id": pid}}, "$set": {"updated_at": now_iso()}})
    return {"ok": True}


@_cf_router.post("/compliance-forms/{fid}/signature")
async def cf_upload_signature(fid: str, file: UploadFile = File(...), user: dict = Depends(require_permission("forms.sign"))):
    """Upload a signature PNG and store on the form. Requires forms.sign permission."""
    d = await db.compliance_forms.find_one({"id": fid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Form not found")
    sig_dir = UPLOAD_DIR / "signatures"
    sig_dir.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    ext = file.filename.split(".")[-1].lower() if file.filename else "png"
    sig_path = sig_dir / f"{fid}.{ext}"
    sig_path.write_bytes(content)
    sig_url = f"/api/compliance-forms/{fid}/signature/image"
    await db.compliance_forms.update_one({"id": fid}, {"$set": {
        "signature_url": sig_url,
        "signed_by_user_id": user["id"],
        "signed_at": now_iso(),
        "updated_at": now_iso(),
    }})
    await record_audit(user, "signature_captured", "compliance_form", fid, d["form_number"])
    updated = await db.compliance_forms.find_one({"id": fid}, {"_id": 0})
    return updated


@_cf_router.get("/compliance-forms/{fid}/signature/image")
async def cf_get_signature_image(fid: str, _u: dict = Depends(require_permission("forms.view"))):
    """Serve the signature PNG."""
    sig_dir = UPLOAD_DIR / "signatures"
    for ext in ("png", "jpg", "jpeg"):
        sig_path = sig_dir / f"{fid}.{ext}"
        if sig_path.exists():
            from fastapi.responses import FileResponse
            return FileResponse(str(sig_path), media_type=f"image/{ext}")
    raise HTTPException(status_code=404, detail="Signature not found")


@_cf_router.delete("/compliance-forms/{fid}")
async def cf_soft_delete(fid: str, user: dict = Depends(require_permission("forms.delete"))):
    d = await db.compliance_forms.find_one({"id": fid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Form not found")
    if d.get("deleted_at"): raise HTTPException(status_code=400, detail="Already deleted")
    await db.compliance_forms.update_one({"id": fid},
        {"$set": {"deleted_at": now_iso(), "deleted_by_user_id": user["id"]}})
    await record_audit(user, "soft_deleted", "compliance_form", fid, d["form_number"])
    return {"ok": True}


@_cf_router.post("/compliance-forms/{fid}/restore")
async def cf_restore(fid: str, user: dict = Depends(require_permission("forms.delete"))):
    d = await db.compliance_forms.find_one({"id": fid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Form not found")
    if not d.get("deleted_at"): raise HTTPException(status_code=400, detail="Not deleted")
    await db.compliance_forms.update_one({"id": fid},
        {"$set": {"deleted_at": None, "deleted_by_user_id": None}})
    await record_audit(user, "restored", "compliance_form", fid, d["form_number"])
    return {"ok": True}

app.include_router(_cf_router)


# ===========================================================================
# Phase 10 Pass 3 — PDF, batch, email
# ===========================================================================
_cf_p3 = APIRouter(prefix="/api")

RECORD_LABEL = {"ok": "✓ Acceptable", "rectify": "✗ To be rectified", "na": "N/A"}

def _render_form_html(form: dict, schema: dict, is_draft: bool) -> str:
    """Generate the HTML used for WeasyPrint PDF rendering."""
    from html import escape
    title = schema.get("title", "Compliance Form")
    sections = form.get("sections", {})
    body_html = []

    def trow(*cells):
        return "<tr>" + "".join(f'<td>{c}</td>' for c in cells) + "</tr>"
    def thead(*cells):
        return "<tr>" + "".join(f'<th>{c}</th>' for c in cells) + "</tr>"

    # Header info
    body_html.append(f"""
    <table class="info"><tbody>
      <tr><th>Client</th><td>{escape(form.get('client_name') or '—')}</td><th>Date of Inspection</th><td>{escape(form.get('date_of_inspection') or '—')}</td></tr>
      <tr><th>Project</th><td>{escape(form.get('project_name') or '—')}</td><th>Date of Casting</th><td>{escape(form.get('date_of_casting') or '—')}</td></tr>
      <tr><th>Panel ID</th><td>{escape(form.get('panel_id') or '')}</td><th>Grade of Concrete</th><td>{escape(form.get('grade_of_concrete') or '—')}</td></tr>
    </tbody></table>""")

    if form["form_type"] != "compliance_cert":
        for sec in schema.get("sections", []):
            sstate = sections.get(sec["key"], {})
            body_html.append(f'<h2 class="sec">{escape(sec["label"])}</h2>')
            if sec.get("criteria"):
                rows = [thead("Criterion", "Value", "Record", "Notes")]
                for c in sec["criteria"]:
                    v = sstate.get(c["key"], {}) or {}
                    rows.append(trow(
                        escape(c["label"]),
                        escape(v.get("value") or (c.get("value_unit") or "")),
                        RECORD_LABEL.get(v.get("record"), "—"),
                        escape(v.get("notes") or "")
                    ))
                body_html.append('<table class="data">' + "".join(rows) + "</table>")
            if sec.get("defects_list"):
                rows = [thead("Location", "Description", "Remedy")]
                defects = sstate.get("_defects", [])
                if not defects:
                    rows.append('<tr><td colspan="3" class="empty">No defects recorded.</td></tr>')
                for d in defects:
                    rows.append(trow(escape(d.get("location","")), escape(d.get("description","")), escape(d.get("remedy",""))))
                body_html.append('<table class="data">' + "".join(rows) + "</table>")
    else:
        header = sections.get("header", {}) or {}
        body_html.append('<h2 class="sec">Project Details</h2><table class="info"><tbody>')
        for f in schema.get("header_fields", []):
            body_html.append(f'<tr><th>{escape(f["label"])}</th><td>{escape(header.get(f["key"]) or "—")}</td></tr>')
        body_html.append("</tbody></table>")
        body_html.append(f'<h2 class="sec">{escape(schema.get("schedule_of_elements_label","Schedule"))}</h2>')
        sched_rows = [thead(*schema.get("schedule_columns", []))]
        sched = sections.get("schedule_of_elements", []) or []
        if not sched:
            sched_rows.append('<tr><td colspan="2" class="empty">No elements listed.</td></tr>')
        for row in sched:
            sched_rows.append(trow(escape(row.get("identification_number","")), escape(row.get("casting_date",""))))
        body_html.append('<table class="data">' + "".join(sched_rows) + "</table>")
        body_html.append(f'<div class="declaration">{escape(schema.get("declaration_text",""))}</div>')
        body_html.append(f'<div class="standards">Standards referenced: {escape(" · ".join(schema.get("standards_referenced", [])))}</div>')

    if form.get("ncr_flag"):
        body_html.append(f'<div class="ncr"><strong>NCR raised:</strong> {escape(form.get("ncr_reference") or "No reference provided")}</div>')

    if form.get("photos"):
        body_html.append('<h2 class="sec">Photos</h2><div class="photos">')
        for p in form["photos"]:
            local = UPLOAD_DIR / f"{form['id']}_{p['id']}.{p['filename'].split('.')[-1].lower()}" if p.get("filename") else None
            if local and local.exists():
                gps = ""
                if p.get("gps_lat") is not None and p.get("gps_lng") is not None:
                    gps = f"📍 {p['gps_lat']}, {p['gps_lng']}"
                if p.get("taken_at"):
                    gps = (gps + " · " if gps else "") + str(p["taken_at"])
                body_html.append(f'<div class="photo"><img src="file://{local}"/><div class="meta">{escape(p.get("filename",""))}<br/>{escape(gps) or "No GPS data"}</div></div>')
        body_html.append("</div>")

    # Signatures
    if form["form_type"] != "compliance_cert":
        body_html.append(f"""
        <div class="sigs">
          <div><div class="lbl">Checked By</div><div class="val">{escape(form.get('checked_by_user_id') or '____________________')}</div></div>
          <div><div class="lbl">Checked By QA</div><div class="val">{escape(form.get('checked_by_qa_user_id') or '____________________')}</div></div>
        </div>""")
    if form.get("status") == "signed":
        body_html.append(f'<div class="signed">✓ Signed by user <code>{escape(form.get("signed_by_user_id") or "")}</code> on {escape(form.get("signed_at") or "")} AEST</div>')

    watermark = '<div class="wm">DRAFT — NOT FOR DISTRIBUTION</div>' if is_draft else ""

    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{escape(title)}</title><style>
      @page {{ size: A4; margin: 12mm; }}
      body {{ font-family: 'Helvetica', sans-serif; color: #1F2A33; font-size: 11px; }}
      .wm {{ position: fixed; top: 40%; left: 0; right: 0; text-align: center;
              transform: rotate(-30deg); font-size: 64px; color: rgba(220, 70, 70, 0.15);
              font-weight: 900; letter-spacing: 0.1em; z-index: -1; }}
      .hdr {{ display: flex; justify-content: space-between; align-items: flex-end;
               border-bottom: 2px solid #F5C518; padding-bottom: 6px; margin-bottom: 10px; }}
      .brand {{ font-size: 22px; font-weight: 900; letter-spacing: -0.02em; }}
      .tag {{ font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.1em; }}
      .meta-r {{ text-align: right; font-size: 9px; color: #666; }}
      h1 {{ font-size: 16px; font-weight: 900; margin: 4px 0 12px 0; }}
      h2.sec {{ font-size: 11px; font-weight: 700; text-transform: uppercase;
                background: #F5C518; color: #1F2A33; padding: 4px 8px; margin: 12px 0 0 0; }}
      table {{ width: 100%; border-collapse: collapse; margin-top: 4px; }}
      table.info th, table.info td, table.data th, table.data td {{
        border: 1px solid #c8d0d6; padding: 4px 6px; font-size: 10px; vertical-align: top; }}
      table.data th {{ background: #1F2A33; color: white; text-align: left; }}
      td.empty {{ text-align: center; font-style: italic; color: #999; }}
      .declaration {{ border-left: 4px solid #F5C518; background: #FFF8E1; padding: 8px;
                      font-style: italic; margin: 10px 0; font-size: 10px; }}
      .standards {{ font-size: 9px; color: #555; margin-top: 4px; }}
      .ncr {{ border: 1px solid #D11; background: #FFF0F0; padding: 6px; margin: 10px 0; font-size: 10px; }}
      .photos {{ display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }}
      .photo {{ width: 30%; border: 1px solid #ccc; padding: 2px; font-size: 8px; }}
      .photo img {{ width: 100%; height: 80px; object-fit: cover; display: block; }}
      .photo .meta {{ padding: 2px 4px; color: #3A6B8C; }}
      .sigs {{ display: flex; gap: 16px; margin-top: 20px; }}
      .sigs > div {{ flex: 1; border-top: 2px solid #1F2A33; padding-top: 4px; }}
      .sigs .lbl {{ font-size: 9px; text-transform: uppercase; color: #666; font-weight: 700; }}
      .sigs .val {{ margin-top: 16px; font-size: 10px; }}
      .signed {{ margin-top: 10px; padding: 6px; background: #E8F5E9; border: 1px solid #4CAF50;
                  font-size: 10px; }}
      .ftr {{ position: fixed; bottom: -8mm; left: 0; right: 0;
              font-size: 8px; color: #999; text-align: center; }}
    </style></head><body>
      {watermark}
      <div class="hdr">
        <div><div class="brand">PANELTEC GROUP</div><div class="tag">Precast Panel Business Management</div></div>
        <div class="meta-r">ABN: 12 345 678 901<br/>{escape(form.get('form_number',''))}</div>
      </div>
      <h1>{escape(title)}</h1>
      {''.join(body_html)}
      <div class="ftr">{escape(title)} · Generated {now_utc().strftime("%Y-%m-%d")} · Paneltec Group</div>
    </body></html>"""


async def _build_pdf_bytes(form: dict) -> bytes:
    from weasyprint import HTML
    schema = FORM_SCHEMAS[form["form_type"]]
    is_draft = form.get("status") != "signed"
    html = _render_form_html(form, schema, is_draft)
    return HTML(string=html, base_url=str(UPLOAD_DIR)).write_pdf()


@_cf_p3.get("/compliance-forms/{fid}/pdf")
async def cf_pdf(fid: str, user: dict = Depends(require_permission("forms.view"))):
    from fastapi.responses import Response
    f = await db.compliance_forms.find_one({"id": fid}, {"_id": 0})
    if not f: raise HTTPException(status_code=404, detail="Form not found")
    pdf_bytes = await _build_pdf_bytes(f)
    await record_audit(user, "pdf_generated", "compliance_form", fid, f.get("form_number"))
    fname = f"{f['form_number']}_{f.get('panel_id','')}_{f['form_type']}.pdf".replace(" ", "_")
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{fname}"'})


class BatchPDFPayload(BaseModel):
    form_ids: List[str] = Field(min_length=1, max_length=100)
    mode: str = Field(pattern="^(zip|combined)$")


@_cf_p3.post("/compliance-forms/batch-pdf")
async def cf_batch_pdf(payload: BatchPDFPayload, user: dict = Depends(require_permission("forms.view"))):
    from fastapi.responses import Response
    import io, zipfile
    forms = await db.compliance_forms.find({"id": {"$in": payload.form_ids}}, {"_id": 0}).to_list(120)
    forms_by_id = {f["id"]: f for f in forms}
    # Preserve requested order
    ordered = [forms_by_id[i] for i in payload.form_ids if i in forms_by_id]
    if not ordered: raise HTTPException(status_code=404, detail="No matching forms")
    today = now_utc().strftime("%Y-%m-%d")
    if payload.mode == "zip":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in ordered:
                pdf_bytes = await _build_pdf_bytes(f)
                fname = f"{f['form_number']}_{f.get('panel_id','')}_{f['form_type']}.pdf".replace(" ", "_")
                zf.writestr(fname, pdf_bytes)
                await record_audit(user, "pdf_generated", "compliance_form", f["id"], f.get("form_number"),
                                   metadata={"batch": True, "mode": "zip"})
        return Response(content=buf.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="paneltec_forms_export_{today}.zip"'})
    # combined
    from pypdf import PdfWriter, PdfReader
    writer = PdfWriter()
    for f in ordered:
        pdf_bytes = await _build_pdf_bytes(f)
        reader = PdfReader(io.BytesIO(pdf_bytes))
        for page in reader.pages: writer.add_page(page)
        await record_audit(user, "pdf_generated", "compliance_form", f["id"], f.get("form_number"),
                           metadata={"batch": True, "mode": "combined"})
    out = io.BytesIO(); writer.write(out)
    return Response(content=out.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="paneltec_forms_export_{today}.pdf"'})


class EmailFormPayload(BaseModel):
    recipient: str = Field(min_length=3)
    subject: str = Field(min_length=1)
    body: str = ""
    include_pdf: bool = True


@_cf_p3.post("/compliance-forms/{fid}/email")
async def cf_email(fid: str, payload: EmailFormPayload, user: dict = Depends(require_permission("forms.edit"))):
    f = await db.compliance_forms.find_one({"id": fid}, {"_id": 0})
    if not f: raise HTTPException(status_code=404, detail="Form not found")
    await db.compliance_forms.update_one({"id": fid}, {"$set": {"last_email_sent_at": now_iso()}})
    await record_audit(user, "email_sent", "compliance_form", fid, f.get("form_number"),
                       metadata={"recipient": payload.recipient, "mocked": True})
    return {
        "mocked": True,
        "preview": {
            "to": payload.recipient, "from": "noreply@paneltec.com.au (MOCKED)",
            "subject": payload.subject,
            "body": payload.body or f"Please find attached compliance form {f.get('form_number')} for panel {f.get('panel_id')}.",
            "attachments": ([f"{f['form_number']}_{f.get('panel_id','')}_{f['form_type']}.pdf"] if payload.include_pdf else []),
        }
    }


class BatchEmailPayload(BaseModel):
    form_ids: List[str] = Field(min_length=1, max_length=100)
    recipient: str = Field(min_length=3)
    subject: str = Field(min_length=1)
    body: str = ""
    pdf_mode: str = Field(pattern="^(zip|combined)$")


@_cf_p3.post("/compliance-forms/batch-email")
async def cf_batch_email(payload: BatchEmailPayload, user: dict = Depends(require_permission("forms.edit"))):
    forms = await db.compliance_forms.find({"id": {"$in": payload.form_ids}}, {"_id": 0}).to_list(120)
    today = now_utc().strftime("%Y-%m-%d")
    for f in forms:
        await db.compliance_forms.update_one({"id": f["id"]}, {"$set": {"last_email_sent_at": now_iso()}})
        await record_audit(user, "email_sent", "compliance_form", f["id"], f.get("form_number"),
                           metadata={"recipient": payload.recipient, "batch": True, "mocked": True})
    fname = (f"paneltec_forms_export_{today}.zip" if payload.pdf_mode == "zip"
             else f"paneltec_forms_export_{today}.pdf")
    return {
        "mocked": True,
        "preview": {
            "to": payload.recipient, "from": "noreply@paneltec.com.au (MOCKED)",
            "subject": payload.subject,
            "body": payload.body or f"Please find attached a batch of {len(forms)} compliance forms.",
            "attachments": [fname],
            "form_count": len(forms),
        }
    }



# ---------------------------------------------------------------------------
# Phase 11.1 — Export NCR Pack (routes below; _cf_p3 is mounted at the end)
# ---------------------------------------------------------------------------
class NCRExportPayload(BaseModel):
    date_from: str = Field(min_length=10, max_length=10)  # YYYY-MM-DD
    date_to: str   = Field(min_length=10, max_length=10)
    recipient: Optional[str] = None
    subject: Optional[str]   = None
    body: Optional[str]      = None


@_cf_p3.get("/compliance-forms/ncr-export/preview")
async def cf_ncr_export_preview(date_from: str, date_to: str,
                                 user: dict = Depends(require_permission("forms.view"))):
    """Light preview — count of NCR-flagged forms in the date range."""
    df, dt = _date_range_iso(date_from, date_to)
    n = await db.compliance_forms.count_documents({
        "ncr_flag": True, "deleted_at": None,
        "status": {"$in": ["completed", "signed"]},
        "updated_at": {"$gte": df, "$lte": dt},
    })
    return {"count": n, "date_from": date_from, "date_to": date_to, "cap": 100}


@_cf_p3.post("/compliance-forms/ncr-export")
async def cf_ncr_export(payload: NCRExportPayload,
                         user: dict = Depends(require_permission("forms.view"))):
    """Bundle every NCR-flagged compliance form completed in the date range into a
    single merged PDF. Optionally fire a MOCKED email preview."""
    from fastapi.responses import Response
    import io
    df, dt = _date_range_iso(payload.date_from, payload.date_to)
    cursor = db.compliance_forms.find({
        "ncr_flag": True, "deleted_at": None,
        "status": {"$in": ["completed", "signed"]},
        "updated_at": {"$gte": df, "$lte": dt},
    }, {"_id": 0}).sort("updated_at", 1).limit(100)
    forms = await cursor.to_list(100)
    if not forms:
        return {"count": 0, "message": "No NCR-flagged forms in that range"}

    fname = f"paneltec_ncr_pack_{payload.date_from}_to_{payload.date_to}.pdf"
    from pypdf import PdfWriter, PdfReader
    writer = PdfWriter()
    for f in forms:
        pdf_bytes = await _build_pdf_bytes(f)
        reader = PdfReader(io.BytesIO(pdf_bytes))
        for page in reader.pages: writer.add_page(page)
    out = io.BytesIO(); writer.write(out)

    form_ids = [f["id"] for f in forms]
    await record_audit(user, "ncr_pack_exported", "compliance_form", "batch", fname,
                       metadata={"count": len(forms), "date_from": payload.date_from,
                                  "date_to": payload.date_to, "form_ids": form_ids,
                                  "recipient": payload.recipient or None})

    if payload.recipient:
        for f in forms:
            await db.compliance_forms.update_one({"id": f["id"]},
                {"$set": {"last_email_sent_at": now_iso()}})
            await record_audit(user, "email_sent", "compliance_form", f["id"], f.get("form_number"),
                               metadata={"recipient": payload.recipient,
                                          "batch": True, "ncr_pack": True, "mocked": True})
        return {
            "mocked": True,
            "count": len(forms),
            "preview": {
                "to": payload.recipient,
                "from": "noreply@paneltec.com.au (MOCKED)",
                "subject": payload.subject or f"Paneltec NCR Pack — {payload.date_from} to {payload.date_to}",
                "body": payload.body or
                    f"Please find attached the Paneltec NCR pack covering "
                    f"{len(forms)} non-conformance-flagged compliance form(s) "
                    f"between {payload.date_from} and {payload.date_to}.",
                "attachments": [fname],
                "form_count": len(forms),
                "form_numbers": [f.get("form_number") for f in forms],
            }
        }
    return Response(content=out.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


app.include_router(_cf_p3)





# ===========================================================================
# Phase 11 Pass 1 — Form Template Builder (data-driven schema)
# ===========================================================================
_tpl_router = APIRouter(prefix="/api")

class TemplateCriterion(BaseModel):
    key: str
    label: str
    input_type: str = "text"  # text|number|checkbox|yes_no|date|signature|dimension_lw_mm
    unit: Optional[str] = None
    required: bool = False
    allow_photo: bool = False
    allow_notes: bool = True
    help_text: str = ""

class TemplateSection(BaseModel):
    key: str
    title: str
    defects_list: bool = False
    criteria: List[TemplateCriterion] = []

class TemplateCreate(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    category: str = "Quality"
    sections: List[TemplateSection] = []
    header_fields: List[Dict[str, Any]] = []
    signoff_stages: List[str] = ["checked_by", "checked_by_qa", "signed"]

class TemplatePatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    sections: Optional[List[TemplateSection]] = None
    header_fields: Optional[List[Dict[str, Any]]] = None
    signoff_stages: Optional[List[str]] = None
    active: Optional[bool] = None


def _schema_to_template(form_type: str, schema: dict, code: str, name: str, category: str) -> dict:
    """Convert a hard-coded FORM_SCHEMAS entry to a template document."""
    sections = []
    if form_type != "compliance_cert":
        for s in schema.get("sections", []):
            criteria = []
            for c in s.get("criteria", []):
                criteria.append({
                    "key": c["key"], "label": c["label"],
                    "input_type": "dimension_lw_mm" if c.get("value_unit") == "mm × mm"
                                   else ("number" if c.get("value_unit") else "yes_no"),
                    "unit": c.get("value_unit"),
                    "required": c.get("value_required", False),
                    "allow_photo": c.get("supports_photos", False),
                    "allow_notes": True, "help_text": "",
                })
            sections.append({"key": s["key"], "title": s["label"],
                             "defects_list": s.get("defects_list", False), "criteria": criteria})
    header_fields = schema.get("header_fields", []) if form_type == "compliance_cert" else [
        {"key": "client_name", "label": "Client", "required": False},
        {"key": "project_name", "label": "Project", "required": False},
        {"key": "panel_id", "label": "Panel ID", "required": True},
        {"key": "date_of_inspection", "label": "Date of Inspection", "input_type": "date"},
        {"key": "date_of_casting", "label": "Date of Casting", "input_type": "date"},
        {"key": "grade_of_concrete", "label": "Grade of Concrete"},
    ]
    return {
        "code": code, "name": name, "description": schema.get("title", ""),
        "category": category, "is_system": True, "version": 1, "active": True,
        "sections": sections, "header_fields": header_fields,
        "signoff_stages": ["checked_by", "checked_by_qa", "signed"],
        "form_type": form_type,  # legacy mapping
        "declaration_text": schema.get("declaration_text", "") if form_type == "compliance_cert" else "",
        "standards_referenced": schema.get("standards_referenced", []),
        "schedule_columns": schema.get("schedule_columns", []),
    }


async def _seed_compliance_templates():
    """Seed the 3 system templates from FORM_SCHEMAS if collection empty."""
    if await db.compliance_form_templates.count_documents({}) > 0: return
    seeds = [
        ("pre_pour",        "PRE",  "Precast Pre-Pour Checklist (9.1.2)",  "Quality"),
        ("post_pour",       "POST", "Precast Post-Pour Checklist (9.1.3)", "Quality"),
        ("compliance_cert", "CERT", "Manufacturer's Certificate of Compliance (9.1.4)", "Compliance"),
    ]
    for ft, code, name, cat in seeds:
        doc = _schema_to_template(ft, FORM_SCHEMAS[ft], code, name, cat)
        doc.update({
            "id": str(uuid.uuid4()),
            "created_by_user_id": "system",
            "created_at": now_iso(), "updated_at": now_iso(),
            "deleted_at": None,
        })
        await db.compliance_form_templates.insert_one(doc)
    logger.info("Seeded 3 system compliance form templates")


@_tpl_router.get("/compliance-templates")
async def tpl_list(active_only: bool = False, user: dict = Depends(require_permission("forms.view"))):
    q = {"deleted_at": None}
    if active_only: q["active"] = True
    docs = await db.compliance_form_templates.find(q, {"_id": 0}).sort([("is_system",-1),("category",1),("name",1)]).to_list(200)
    return {"items": docs, "total": len(docs)}


@_tpl_router.get("/compliance-templates/{tid}")
async def tpl_get(tid: str, user: dict = Depends(require_permission("forms.view"))):
    d = await db.compliance_form_templates.find_one({"id": tid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Template not found")
    return d


@_tpl_router.post("/compliance-templates", status_code=201)
async def tpl_create(payload: TemplateCreate, user: dict = Depends(require_permission("forms.template_manage"))):
    if await db.compliance_form_templates.find_one({"code": payload.code, "deleted_at": None}):
        raise HTTPException(status_code=400, detail=f"Code '{payload.code}' already exists")
    tid = str(uuid.uuid4())
    doc = {**payload.model_dump(), "id": tid, "is_system": False, "version": 1, "active": True,
           "form_type": "custom", "created_by_user_id": user["id"],
           "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None}
    await db.compliance_form_templates.insert_one(doc); doc.pop("_id", None)
    await record_audit(user, "created", "compliance_form_template", tid, payload.name)
    return doc


@_tpl_router.patch("/compliance-templates/{tid}")
async def tpl_patch(tid: str, payload: TemplatePatch, user: dict = Depends(require_permission("forms.template_manage"))):
    d = await db.compliance_form_templates.find_one({"id": tid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Template not found")
    if d.get("is_system"): raise HTTPException(status_code=400, detail="System templates cannot be edited — clone first")
    upd = {k: (v if not hasattr(v, "model_dump") else v.model_dump()) for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not upd: return d
    upd["version"] = d.get("version", 1) + 1; upd["updated_at"] = now_iso()
    await db.compliance_form_templates.update_one({"id": tid}, {"$set": upd})
    await record_audit(user, "updated", "compliance_form_template", tid, d["name"],
                       metadata={"new_version": upd["version"]})
    return await db.compliance_form_templates.find_one({"id": tid}, {"_id": 0})


class CloneOverride(BaseModel):
    code: Optional[str] = None

@_tpl_router.post("/compliance-templates/{tid}/clone")
async def tpl_clone(tid: str, payload: Optional[CloneOverride] = None,
                     user: dict = Depends(require_permission("forms.template_manage"))):
    src = await db.compliance_form_templates.find_one({"id": tid}, {"_id": 0})
    if not src: raise HTTPException(status_code=404, detail="Template not found")
    # Semantic code derivation. Use BASE (strip any _v\d+ suffix), then find next free _vN.
    import re as _re
    base = _re.sub(r"_v\d+$", "", src["code"])
    if payload and payload.code:
        if not _re.match(r"^[A-Z0-9_]{2,40}$", payload.code):
            raise HTTPException(status_code=400, detail="Invalid code — must match [A-Z0-9_]{2,40}")
        new_code = payload.code
    else:
        # Find highest existing version suffix for this base
        siblings = await db.compliance_form_templates.find(
            {"code": {"$regex": f"^{_re.escape(base)}(_v\\d+)?$"}, "deleted_at": None},
            {"_id": 0, "code": 1}
        ).to_list(200)
        max_v = 1
        for s in siblings:
            m = _re.match(rf"^{_re.escape(base)}_v(\d+)$", s["code"])
            if m: max_v = max(max_v, int(m.group(1)))
            elif s["code"] == base: max_v = max(max_v, 1)
        new_code = f"{base}_v{max_v + 1}"
    if await db.compliance_form_templates.find_one({"code": new_code, "deleted_at": None}):
        raise HTTPException(status_code=400, detail=f"Code '{new_code}' already exists")
    new = {**src, "id": str(uuid.uuid4()), "code": new_code,
           "name": f"{src['name']} (v{int(new_code.rsplit('_v',1)[-1]) if '_v' in new_code else 'copy'})",
           "is_system": False, "version": 1,
           "created_by_user_id": user["id"], "created_at": now_iso(), "updated_at": now_iso()}
    await db.compliance_form_templates.insert_one(new); new.pop("_id", None)
    await record_audit(user, "created", "compliance_form_template", new["id"], new["name"],
                       metadata={"cloned_from": tid, "code": new_code})
    return new


@_tpl_router.post("/compliance-templates/{tid}/activate")
async def tpl_activate(tid: str, user: dict = Depends(require_permission("forms.template_manage"))):
    await db.compliance_form_templates.update_one({"id": tid}, {"$set": {"active": True, "updated_at": now_iso()}})
    return {"ok": True}


@_tpl_router.post("/compliance-templates/{tid}/deactivate")
async def tpl_deactivate(tid: str, user: dict = Depends(require_permission("forms.template_manage"))):
    await db.compliance_form_templates.update_one({"id": tid}, {"$set": {"active": False, "updated_at": now_iso()}})
    return {"ok": True}


@_tpl_router.delete("/compliance-templates/{tid}")
async def tpl_delete(tid: str, user: dict = Depends(require_permission("forms.template_manage"))):
    d = await db.compliance_form_templates.find_one({"id": tid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Template not found")
    if d.get("is_system"): raise HTTPException(status_code=400, detail="System templates cannot be deleted")
    await db.compliance_form_templates.update_one({"id": tid}, {"$set": {"deleted_at": now_iso()}})
    await record_audit(user, "soft_deleted", "compliance_form_template", tid, d["name"])
    return {"ok": True}


# Forms-creation enhancement — accept template_id, snapshot template version
class FormFromTemplate(BaseModel):
    template_id: str
    panel_id: str = Field(min_length=1, max_length=80)
    job_id: Optional[str] = None
    client_name: Optional[str] = ""
    project_name: Optional[str] = ""

@_tpl_router.post("/compliance-forms/from-template", status_code=201)
async def cf_create_from_template(payload: FormFromTemplate, user: dict = Depends(require_permission("forms.create"))):
    tpl = await db.compliance_form_templates.find_one({"id": payload.template_id, "deleted_at": None}, {"_id": 0})
    if not tpl: raise HTTPException(status_code=404, detail="Template not found or deleted")
    if not tpl.get("active"): raise HTTPException(status_code=400, detail="Template is deactivated")
    form_type = tpl.get("form_type", "custom")
    # Reuse the existing creator's job auto-fill logic via inline call
    base = ComplianceFormCreate(form_type=form_type if form_type in ("pre_pour","post_pour","compliance_cert") else "pre_pour",
                                 panel_id=payload.panel_id, job_id=payload.job_id,
                                 client_name=payload.client_name, project_name=payload.project_name)
    # Build empty sections from template
    sections: Dict[str, Any] = {}
    if form_type == "compliance_cert":
        sections["header"] = {f["key"]: f.get("default", "") for f in tpl.get("header_fields", [])}
        sections["schedule_of_elements"] = []
        sections["signature"] = {"name": "", "signature": "", "date": ""}
    else:
        for s in tpl.get("sections", []):
            sections[s["key"]] = {}
            if s.get("defects_list"): sections[s["key"]]["_defects"] = []
            for c in s.get("criteria", []):
                sections[s["key"]][c["key"]] = {"value": "", "record": None, "notes": "",
                                                 "photos": [] if c.get("allow_photo") else None}
    fid = str(uuid.uuid4())
    doc = {
        "id": fid, "form_number": await _next_form_number(form_type if form_type in FORM_TYPE_CODE else "pre_pour"),
        "form_type": form_type, "panel_id": payload.panel_id.strip(),
        "template_id": tpl["id"], "template_version_snapshot": tpl["version"],
        "template_code": tpl["code"], "template_name": tpl["name"],
        "job_id": payload.job_id, "customer_id": None, "project_id": None,
        "client_name": payload.client_name or "", "project_name": payload.project_name or "",
        "grade_of_concrete": "", "date_of_inspection": None, "date_of_casting": None,
        "status": "draft", "sections": sections,
        "ncr_flag": False, "ncr_reference": "",
        "checked_by_user_id": None, "checked_by_qa_user_id": None,
        "signed_at": None, "signed_by_user_id": None, "photos": [],
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by_user_id": user["id"], "updated_by_user_id": user["id"],
        "deleted_at": None, "deleted_by_user_id": None,
    }
    await db.compliance_forms.insert_one(doc); doc.pop("_id", None)
    await record_audit(user, "created", "compliance_form", fid, doc["form_number"],
                       metadata={"template_id": tpl["id"], "template_version": tpl["version"]})
    return doc


app.include_router(_tpl_router)


async def _backfill_form_template_refs():
    """One-time migration: any existing compliance_form without template_id gets one
    pointing to the matching system template, frozen at version 1."""
    sys_tpls = {t["form_type"]: t async for t in db.compliance_form_templates.find(
        {"is_system": True}, {"_id": 0, "id": 1, "version": 1, "code": 1, "name": 1, "form_type": 1})}
    res = await db.compliance_forms.update_many(
        {"template_id": {"$exists": False}},
        [{"$set": {
            "template_id":               {"$ifNull": [None, None]},  # placeholder, set below per doc
        }}]
    )
    # Per-doc fix because we need form_type-conditional template_id
    async for d in db.compliance_forms.find({"template_id": {"$in": [None]}}, {"_id": 0, "id": 1, "form_type": 1}):
        t = sys_tpls.get(d["form_type"])
        if t:
            await db.compliance_forms.update_one({"id": d["id"]},
                {"$set": {"template_id": t["id"], "template_version_snapshot": t["version"],
                          "template_code": t["code"], "template_name": t["name"]}})


# ---- Seed sample compliance forms on startup if empty ----
async def _seed_compliance_forms():
    if await db.compliance_forms.count_documents({}) > 0: return
    # Find first non-deleted job to attach to
    job = await db.jobs.find_one({"deleted_at": None}, {"_id": 0})
    job_id = job["id"] if job else None
    client_name = ""
    project_name = ""
    if job:
        if job.get("customer_id"):
            c = await db.customers.find_one({"id": job["customer_id"]}, {"_id":0,"company_name":1})
            if c: client_name = c.get("company_name") or ""
        if job.get("project_id"):
            p = await db.projects.find_one({"id": job["project_id"]}, {"_id":0,"name":1})
            if p: project_name = p.get("name") or ""

    samples = [
        ("pre_pour",   "P-001", "draft"),
        ("post_pour",  "P-001", "completed"),
    ]
    for ft, panel, status in samples:
        fid = str(uuid.uuid4())
        doc = {
            "id": fid, "form_number": await _next_form_number(ft),
            "form_type": ft, "panel_id": panel, "job_id": job_id,
            "customer_id": job.get("customer_id") if job else None,
            "project_id": job.get("project_id") if job else None,
            "client_name": client_name, "project_name": project_name,
            "grade_of_concrete": "C32/40",
            "date_of_inspection": now_iso()[:10],
            "date_of_casting": now_iso()[:10],
            "status": status,
            "sections": empty_sections_for(ft),
            "ncr_flag": False, "ncr_reference": "",
            "checked_by_user_id": None, "checked_by_qa_user_id": None,
            "signed_at": None, "signed_by_user_id": None, "photos": [],
            "created_at": now_iso(), "updated_at": now_iso(),
            "created_by_user_id": "system", "updated_by_user_id": "system",
            "deleted_at": None, "deleted_by_user_id": None,
        }
        await db.compliance_forms.insert_one(doc)
    logger.info(f"Seeded {len(samples)} sample compliance forms")


# ===========================================================================
# Phase 8 Pass 3 — BI API Tokens + /api/reporting/v1/* read-only namespace
# ===========================================================================
import secrets as _secrets

_bi_router = APIRouter(prefix="/api")

# Recursive scrubber for internal cost/margin/secret keys.
_BI_FORBIDDEN_KEY_PATTERNS = ("cost_", "margin_", "internal_", "total_cost",
                              "_cost_aud", "_margin_aud", "_margin_pct",
                              "password", "password_hash", "client_secret",
                              "api_key", "token_hash")

def _bi_scrub(obj: Any) -> Any:
    """Recursively strip any key containing a forbidden substring (case-insensitive)."""
    if isinstance(obj, list): return [_bi_scrub(x) for x in obj]
    if not isinstance(obj, dict): return obj
    out = {}
    for k, v in obj.items():
        lk = k.lower()
        if any(p in lk for p in _BI_FORBIDDEN_KEY_PATTERNS):
            continue
        out[k] = _bi_scrub(v)
    return out

class BITokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)

# --- Token management (super admin) ---
@_bi_router.get("/reporting/tokens")
async def list_bi_tokens(user: dict = Depends(require_super_admin)):
    docs = await db.bi_api_tokens.find({}, {"_id": 0, "token_hash": 0}).sort("created_at", -1).to_list(200)
    return docs

@_bi_router.post("/reporting/tokens", status_code=201)
async def create_bi_token(payload: BITokenCreate, user: dict = Depends(require_super_admin)):
    active_count = await db.bi_api_tokens.count_documents({"revoked_at": None})
    if active_count >= BI_TOKEN_MAX_ACTIVE:
        raise HTTPException(status_code=400,
                            detail=f"Maximum {BI_TOKEN_MAX_ACTIVE} active tokens reached. Revoke an existing token first.")
    raw = BI_TOKEN_PREFIX + _secrets.token_urlsafe(24)
    tid = str(uuid.uuid4())
    doc = {
        "id": tid, "name": payload.name.strip(),
        "token_hash": hash_password(raw),
        "token_prefix": raw[:16],
        "created_by_user_id": user["id"],
        "created_by_name": user.get("name") or user.get("email") or "Unknown",
        "created_at": now_iso(),
        "last_used_at": None, "last_used_ip": None,
        "revoked_at": None, "revoked_by_user_id": None,
    }
    await db.bi_api_tokens.insert_one(doc)
    await record_audit(user, "created", "bi_api_token", tid, doc["name"],
                       metadata={"token_prefix": doc["token_prefix"]})
    return {"id": tid, "name": doc["name"], "token": raw, "token_prefix": doc["token_prefix"]}

@_bi_router.post("/reporting/tokens/{token_id}/revoke")
async def revoke_bi_token(token_id: str, user: dict = Depends(require_super_admin)):
    doc = await db.bi_api_tokens.find_one({"id": token_id}, {"_id": 0})
    if not doc: raise HTTPException(status_code=404, detail="Token not found")
    if doc.get("revoked_at"): raise HTTPException(status_code=400, detail="Token already revoked")
    await db.bi_api_tokens.update_one({"id": token_id},
        {"$set": {"revoked_at": now_iso(), "revoked_by_user_id": user["id"]}})
    await record_audit(user, "soft_deleted", "bi_api_token", token_id, doc["name"],
                       metadata={"token_prefix": doc.get("token_prefix")})
    return {"ok": True}

# --- /api/reporting/v1/* read-only namespace ---
async def _reporting_paginated(coll, perm: str, request: Request,
                                date_from: Optional[str], date_to: Optional[str],
                                page: int, per_page: int) -> Dict[str, Any]:
    per_page = max(1, min(per_page, 1000))
    page = max(1, page)
    q: Dict[str, Any] = {"deleted_at": {"$in": [None]}}
    if date_from or date_to:
        df, dt = _date_range_iso(date_from, date_to, default_days=10000)
        q["created_at"] = {"$gte": df, "$lte": dt}
    total = await coll.count_documents(q)
    docs = await coll.find(q, {"_id": 0}).sort("created_at", -1).skip((page-1)*per_page).limit(per_page).to_list(per_page)
    items = [_bi_scrub(d) for d in docs]
    return {"items": items, "total": total, "page": page, "per_page": per_page}

@_bi_router.get("/reporting/v1/customers")
async def rpt_customers(request: Request, user: dict = Depends(require_permission("customers.view")),
                         date_from: Optional[str] = None, date_to: Optional[str] = None,
                         page: int = 1, per_page: int = 100):
    return await _reporting_paginated(db.customers, "customers.view", request, date_from, date_to, page, per_page)

@_bi_router.get("/reporting/v1/quotes")
async def rpt_quotes(request: Request, user: dict = Depends(require_permission("quotes.view")),
                      date_from: Optional[str] = None, date_to: Optional[str] = None,
                      page: int = 1, per_page: int = 100):
    return await _reporting_paginated(db.quotes, "quotes.view", request, date_from, date_to, page, per_page)

@_bi_router.get("/reporting/v1/jobs")
async def rpt_jobs(request: Request, user: dict = Depends(require_permission("jobs.view")),
                    date_from: Optional[str] = None, date_to: Optional[str] = None,
                    page: int = 1, per_page: int = 100):
    return await _reporting_paginated(db.jobs, "jobs.view", request, date_from, date_to, page, per_page)

@_bi_router.get("/reporting/v1/invoices")
async def rpt_invoices(request: Request, user: dict = Depends(require_permission("invoices.view")),
                        date_from: Optional[str] = None, date_to: Optional[str] = None,
                        page: int = 1, per_page: int = 100):
    return await _reporting_paginated(db.invoices, "invoices.view", request, date_from, date_to, page, per_page)

@_bi_router.get("/reporting/v1/vehicles")
async def rpt_vehicles(request: Request, user: dict = Depends(require_permission("vehicles.view")),
                        date_from: Optional[str] = None, date_to: Optional[str] = None,
                        page: int = 1, per_page: int = 100):
    return await _reporting_paginated(db.vehicles, "vehicles.view", request, date_from, date_to, page, per_page)

@_bi_router.get("/reporting/v1/employees")
async def rpt_employees(request: Request, user: dict = Depends(require_permission("employees.view")),
                         date_from: Optional[str] = None, date_to: Optional[str] = None,
                         page: int = 1, per_page: int = 100):
    return await _reporting_paginated(db.employees, "employees.view", request, date_from, date_to, page, per_page)

app.include_router(_bi_router)
# (Removed stale comment about double-registration — handled via the dedicated sub-router above.)

# ---------------------------------------------------------------------------
# Blocker #3 — CORS lockdown
# `*` + allow_credentials=True is invalid per the CORS spec (browsers ignore
# credentials). If the operator has left CORS_ORIGINS unset OR set to `*`,
# refuse to start until they configure it.
# ---------------------------------------------------------------------------
_cors_raw = os.environ.get("CORS_ORIGINS", "").strip()
_cors_prod_strict = (os.environ.get("SEED_MODE","").lower() == "prod")
if _cors_raw == "*":
    _msg = ("[cors] wildcard origin '*' is incompatible with allow_credentials=True. "
             "Set CORS_ORIGINS to a specific domain (or comma-separated list).")
    if _cors_prod_strict:
        raise RuntimeError(_msg)
    logger.warning(_msg + " (dev mode — permitting wildcard without credentials)")
    _cors_origins = ["*"]
    _cors_credentials = False
elif not _cors_raw:
    logger.warning("[cors] CORS_ORIGINS not set — defaulting to http://localhost:3000 for dev only.")
    _cors_origins = ["http://localhost:3000"]
    _cors_credentials = True
else:
    _cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]
    _cors_credentials = True

app.add_middleware(CORSMiddleware,
    allow_credentials=_cors_credentials, allow_origins=_cors_origins,
    allow_methods=["*"], allow_headers=["*"])

async def _heal_active_ai_providers():
    """Phase 11.6.3 — self-heal for orphan connections.
    If a text/image provider is CONNECTED/MANUAL but no active_*_provider is set
    (typically because the provider was connected before the auto-elect code
    existed), promote the first eligible one so the AI Standards Check prereq
    gate opens automatically."""
    try:
        doc = await db.settings.find_one({"key": "admin_settings"}) or {}
        ai = doc.get("ai_providers") or {}
        text_providers = ("openai", "anthropic", "google")
        image_providers = ("openai", "nano_banana")
        changed = False
        def _connected(prov_key):
            p = ai.get(prov_key) or {}
            return p.get("status") in ("CONNECTED", "MANUAL")
        if not ai.get("active_text_provider"):
            elect = next((p for p in text_providers if _connected(p)), None)
            if elect:
                ai["active_text_provider"] = elect
                changed = True
                logger.info(f"[ai-heal] promoted '{elect}' → active_text_provider")
        if not ai.get("active_image_provider"):
            elect = next((p for p in image_providers if _connected(p)), None)
            if elect:
                ai["active_image_provider"] = elect
                changed = True
                logger.info(f"[ai-heal] promoted '{elect}' → active_image_provider")
        if changed:
            await db.settings.update_one({"key": "admin_settings"},
                {"$set": {"ai_providers": ai, "updated_at": now_iso()}}, upsert=True)
    except Exception as e:
        logger.exception(f"AI provider heal failed: {e}")


@app.on_event("startup")
async def on_startup():
    try: await seed_database()
    except Exception as e: logger.exception(f"Seeding failed: {e}")
    await _heal_active_ai_providers()
    await _migrate_simpro_company_id()


async def _migrate_simpro_company_id():
    """Phase 11.7.1 — migrate legacy `simpro.company_id: int` → `simpro.company_ids: [int]`.
    Runs once on startup. Idempotent. Safe when both/neither is present."""
    try:
        doc = await db.settings.find_one({"key": "integrations"}) or {}
        sp = (doc.get("simpro") or {})
        legacy = sp.get("company_id")
        if legacy is not None and not sp.get("company_ids"):
            new_ids = [int(legacy)] if isinstance(legacy, (int, float, str)) and str(legacy).strip() else []
            await db.settings.update_one({"key": "integrations"},
                {"$set": {"simpro.company_ids": new_ids},
                 "$unset": {"simpro.company_id": ""}})
            logger.info("[migrate] simpro.company_id (%s) → company_ids (%s)", legacy, new_ids)
        elif legacy is not None:
            # Both present — drop the legacy key silently
            await db.settings.update_one({"key": "integrations"},
                {"$unset": {"simpro.company_id": ""}})
    except Exception as e:
        logger.exception(f"[migrate] simpro.company_id migration failed: {e}")

@app.on_event("shutdown")
async def on_shutdown(): client.close()
