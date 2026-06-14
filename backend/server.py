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
    version="2.0.0",
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)
api_router = APIRouter(prefix="/api")
bearer_scheme = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("paneltec")


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "type": "access",
        "iat": now_utc(),
        "exp": now_utc() + timedelta(hours=JWT_EXPIRES_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def user_to_public(user_doc: dict) -> dict:
    return {
        "id": user_doc["id"],
        "email": user_doc["email"],
        "name": user_doc.get("name", ""),
        "role": user_doc["role"],
        "is_active": user_doc.get("is_active", True),
        "created_at": user_doc.get("created_at"),
    }


def _round2(x: float) -> float:
    return round(x + 1e-9, 2)


AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"]


def normalise_abn(raw: str) -> Optional[str]:
    if raw is None:
        return None
    digits = re.sub(r"\s+", "", str(raw))
    if not digits:
        return None
    if not re.fullmatch(r"\d{11}", digits):
        raise HTTPException(status_code=400, detail="ABN must be 11 digits (spaces allowed).")
    return digits


# ---------------------------------------------------------------------------
# Auth dependencies
# ---------------------------------------------------------------------------
async def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    token: Optional[str] = None
    if creds and creds.scheme.lower() == "bearer":
        token = creds.credentials
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ---------------------------------------------------------------------------
# Auth models
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=1)
    role: Literal["admin", "staff"] = "staff"


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = None
    role: Optional[Literal["admin", "staff"]] = None
    is_active: Optional[bool] = None


# ---------------------------------------------------------------------------
# Pricing models
# ---------------------------------------------------------------------------
class PanelTypePricing(BaseModel):
    key: str
    label: str
    thickness_mm: int
    material_per_m2: float
    manufacturing_per_m2: float
    transport_install_per_m2: float


class ReinforcementDensities(BaseModel):
    light: float
    standard: float
    heavy: float
    prestressed: float


class FinishMultiplier(BaseModel):
    key: str
    label: str
    multiplier: float


class PricingSettings(BaseModel):
    concrete_density: float = 2500.0
    gst_rate: float = 10.0
    reinforcement_densities: ReinforcementDensities
    panel_types: List[PanelTypePricing]
    thickness_options_mm: List[int]
    concrete_grades: List[str]
    finishes: List[FinishMultiplier]


class CalculateRequest(BaseModel):
    panel_type_key: str
    length_m: float = Field(gt=0)
    height_m: float = Field(gt=0)
    thickness_mm: int = Field(gt=0)
    concrete_grade: str
    quantity: int = Field(ge=1)
    reinforcement_type: Literal["light", "standard", "heavy", "prestressed"]
    openings_m2: float = Field(ge=0)
    finish_key: str


# ---------------------------------------------------------------------------
# Customer / Project / Quote models
# ---------------------------------------------------------------------------
class Address(BaseModel):
    street: str = ""
    suburb: str = ""
    state: str = ""
    postcode: str = ""

    @field_validator("state")
    @classmethod
    def _state_valid(cls, v: str) -> str:
        if v and v not in AU_STATES:
            raise ValueError(f"State must be one of: {', '.join(AU_STATES)}")
        return v

    @field_validator("postcode")
    @classmethod
    def _postcode_valid(cls, v: str) -> str:
        if v and not re.fullmatch(r"\d{4}", v):
            raise ValueError("Postcode must be 4 digits")
        return v


class CustomerCreate(BaseModel):
    company_name: str = Field(min_length=1)
    abn: Optional[str] = None
    contact_name: str = ""
    contact_email: EmailStr
    contact_phone: str = ""
    billing_address: Address = Field(default_factory=Address)
    site_address: Address = Field(default_factory=Address)
    site_same_as_billing: bool = True
    account_terms: str = "30 days"
    notes: str = ""


class CustomerUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    company_name: Optional[str] = None
    abn: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    billing_address: Optional[Address] = None
    site_address: Optional[Address] = None
    site_same_as_billing: Optional[bool] = None
    account_terms: Optional[str] = None
    notes: Optional[str] = None
    active: Optional[bool] = None


class ProjectCreate(BaseModel):
    customer_id: str
    project_name: str = Field(min_length=1)
    site_address: Optional[Address] = None
    description: str = ""
    status: Literal["planning", "quoted", "won", "lost", "completed"] = "planning"


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_name: Optional[str] = None
    site_address: Optional[Address] = None
    description: Optional[str] = None
    status: Optional[Literal["planning", "quoted", "won", "lost", "completed"]] = None


class QuoteCreate(BaseModel):
    customer_id: str
    project_id: Optional[str] = None
    valid_until: Optional[str] = None  # ISO date
    notes_to_customer: str = ""
    internal_notes: str = ""


class QuoteUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    customer_id: Optional[str] = None
    project_id: Optional[str] = None
    valid_until: Optional[str] = None
    notes_to_customer: Optional[str] = None
    internal_notes: Optional[str] = None


class QuoteLineInput(BaseModel):
    description: str = ""
    panel_type_key: str
    length_m: float = Field(gt=0)
    height_m: float = Field(gt=0)
    thickness_mm: int = Field(gt=0)
    concrete_grade: str
    quantity: int = Field(ge=1)
    reinforcement_type: Literal["light", "standard", "heavy", "prestressed"]
    openings_m2: float = Field(ge=0)
    finish_key: str


# ---------------------------------------------------------------------------
# Calculator core (shared helper)
# ---------------------------------------------------------------------------
REINFORCEMENT_LABELS = [
    {"key": "light", "label": "Light (mesh)"},
    {"key": "standard", "label": "Standard (mesh + bars)"},
    {"key": "heavy", "label": "Heavy (rebar cage)"},
    {"key": "prestressed", "label": "Prestressed tendons"},
]


def _reinforcement_label(key: str) -> str:
    for r in REINFORCEMENT_LABELS:
        if r["key"] == key:
            return r["label"]
    return key


def compute_calculation(payload: CalculateRequest, pricing: Dict[str, Any]) -> Dict[str, Any]:
    panel = next((p for p in pricing["panel_types"] if p["key"] == payload.panel_type_key), None)
    if not panel:
        raise HTTPException(status_code=400, detail="Unknown panel type")

    finish = next((f for f in pricing["finishes"] if f["key"] == payload.finish_key), None)
    if not finish:
        raise HTTPException(status_code=400, detail="Unknown finish")

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
    total_weight_tonnes = total_weight_kg / 1000.0

    base_cost_m2 = (
        float(panel["material_per_m2"])
        + float(panel["manufacturing_per_m2"])
        + float(panel["transport_install_per_m2"])
    )
    multiplier = float(finish["multiplier"])
    cost_per_m2 = base_cost_m2 * multiplier
    subtotal_per_panel = net_area * cost_per_m2
    subtotal_all = subtotal_per_panel * qty

    material_cost = net_area * float(panel["material_per_m2"]) * qty
    manufacturing_cost = net_area * float(panel["manufacturing_per_m2"]) * qty
    transport_install_cost = net_area * float(panel["transport_install_per_m2"]) * qty
    base_subtotal = material_cost + manufacturing_cost + transport_install_cost
    finish_premium = subtotal_all - base_subtotal

    gst_rate = float(pricing["gst_rate"]) / 100.0
    gst = subtotal_all * gst_rate
    total_inc_gst = subtotal_all + gst

    return {
        "inputs": payload.model_dump(),
        "panel_type": panel,
        "finish": finish,
        "per_panel": {
            "face_area_m2": _round2(face_area),
            "net_area_m2": _round2(net_area),
            "volume_m3": round(volume_per_panel, 4),
            "concrete_weight_kg": _round2(concrete_weight),
            "steel_weight_kg": _round2(steel_weight),
            "total_weight_kg": _round2(total_weight_per_panel),
        },
        "totals": {
            "quantity": qty,
            "total_volume_m3": round(total_volume, 4),
            "total_weight_kg": _round2(total_weight_kg),
            "total_weight_tonnes": round(total_weight_tonnes, 3),
            "cost_per_m2": _round2(cost_per_m2),
            "base_cost_per_m2": _round2(base_cost_m2),
            "finish_multiplier": multiplier,
        },
        "cost_breakdown": {
            "material": _round2(material_cost),
            "manufacturing": _round2(manufacturing_cost),
            "transport_install": _round2(transport_install_cost),
            "finish_premium": _round2(finish_premium),
            "subtotal": _round2(subtotal_all),
            "gst_rate_pct": pricing["gst_rate"],
            "gst": _round2(gst),
            "total_inc_gst": _round2(total_inc_gst),
        },
    }


def build_quote_line(payload: QuoteLineInput, pricing: Dict[str, Any]) -> Dict[str, Any]:
    calc_req = CalculateRequest(**payload.model_dump(exclude={"description"}))
    result = compute_calculation(calc_req, pricing)
    return {
        "id": str(uuid.uuid4()),
        "description": payload.description.strip(),
        "panel_type_key": result["panel_type"]["key"],
        "panel_type_label": result["panel_type"]["label"],
        "length_m": payload.length_m,
        "height_m": payload.height_m,
        "thickness_mm": payload.thickness_mm,
        "concrete_grade": payload.concrete_grade,
        "quantity": payload.quantity,
        "openings_m2_per_panel": payload.openings_m2,
        "reinforcement_key": payload.reinforcement_type,
        "reinforcement_label": _reinforcement_label(payload.reinforcement_type),
        "finish_key": result["finish"]["key"],
        "finish_label": result["finish"]["label"],
        "face_area_m2": result["per_panel"]["face_area_m2"],
        "net_face_area_m2": result["per_panel"]["net_area_m2"],
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


def recompute_quote_totals(lines: List[Dict[str, Any]]) -> Dict[str, float]:
    subtotal = sum(float(l["subtotal_aud"]) for l in lines)
    gst = sum(float(l["gst_aud"]) for l in lines)
    total = sum(float(l["total_aud"]) for l in lines)
    total_volume = sum(float(l["total_volume_m3"]) for l in lines)
    total_weight_kg = sum(float(l["total_weight_kg"]) for l in lines)
    return {
        "subtotal": _round2(subtotal),
        "gst": _round2(gst),
        "total": _round2(total),
        "total_volume_m3": round(total_volume, 4),
        "total_weight_kg": _round2(total_weight_kg),
        "total_weight_tonnes": round(total_weight_kg / 1000.0, 3),
    }


# ---------------------------------------------------------------------------
# Quote number sequence
# ---------------------------------------------------------------------------
async def next_quote_number() -> str:
    year = now_utc().year
    key = f"quote_seq_{year}"
    doc = await db.counters.find_one_and_update(
        {"key": key},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True,
    )
    # Motor with PyMongo 4+: return_document missing → fallback
    if doc is None:
        doc = await db.counters.find_one({"key": key})
    seq = int(doc["value"]) if doc and "value" in doc else 1
    return f"Q-{year}-{seq:04d}"


# ---------------------------------------------------------------------------
# Default pricing seed
# ---------------------------------------------------------------------------
DEFAULT_PRICING = {
    "concrete_density": 2500.0,
    "gst_rate": 10.0,
    "reinforcement_densities": {
        "light": 25.0,
        "standard": 45.0,
        "heavy": 70.0,
        "prestressed": 100.0,
    },
    "panel_types": [
        {"key": "wall_standard", "label": "Wall Standard (150mm)", "thickness_mm": 150,
         "material_per_m2": 97.0, "manufacturing_per_m2": 112.0, "transport_install_per_m2": 75.0},
        {"key": "wall_load_bearing", "label": "Wall Load-Bearing (200mm)", "thickness_mm": 200,
         "material_per_m2": 127.0, "manufacturing_per_m2": 135.0, "transport_install_per_m2": 92.0},
        {"key": "floor_slab", "label": "Floor Slab (250mm)", "thickness_mm": 250,
         "material_per_m2": 152.0, "manufacturing_per_m2": 147.0, "transport_install_per_m2": 105.0},
        {"key": "hollow_core", "label": "Hollow Core (200mm)", "thickness_mm": 200,
         "material_per_m2": 110.0, "manufacturing_per_m2": 122.0, "transport_install_per_m2": 85.0},
        {"key": "architectural_facade", "label": "Architectural Facade", "thickness_mm": 150,
         "material_per_m2": 185.0, "manufacturing_per_m2": 230.0, "transport_install_per_m2": 115.0},
        {"key": "prestressed", "label": "Prestressed", "thickness_mm": 200,
         "material_per_m2": 160.0, "manufacturing_per_m2": 175.0, "transport_install_per_m2": 110.0},
    ],
    "thickness_options_mm": [100, 150, 200, 250, 300],
    "concrete_grades": ["C25/30", "C30/37", "C35/45", "C40/50", "C50/60"],
    "finishes": [
        {"key": "smooth", "label": "Smooth (Troweled)", "multiplier": 1.00},
        {"key": "exposed_aggregate", "label": "Exposed Aggregate", "multiplier": 1.15},
        {"key": "acid_etched", "label": "Acid-Etched", "multiplier": 1.20},
        {"key": "sandblasted", "label": "Sandblasted", "multiplier": 1.18},
        {"key": "patterned", "label": "Patterned/Embedded", "multiplier": 1.30},
    ],
}


# ---------------------------------------------------------------------------
# Seed routine
# ---------------------------------------------------------------------------
async def seed_database():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.customers.create_index("id", unique=True)
    await db.projects.create_index("id", unique=True)
    await db.quotes.create_index("id", unique=True)
    await db.quotes.create_index("quote_number", unique=True)
    await db.quotes.create_index("magic_link_token")
    await db.counters.create_index("key", unique=True)

    seed_users = [
        {
            "email": os.environ.get("SEED_ADMIN_EMAIL", "admin@paneltec.com.au"),
            "password": os.environ.get("SEED_ADMIN_PASSWORD", "Paneltec2026!"),
            "name": "Paneltec Admin",
            "role": "admin",
        },
        {
            "email": os.environ.get("SEED_STAFF_EMAIL", "staff@paneltec.com.au"),
            "password": os.environ.get("SEED_STAFF_PASSWORD", "Staff2026!"),
            "name": "Paneltec Staff",
            "role": "staff",
        },
    ]
    for s in seed_users:
        existing = await db.users.find_one({"email": s["email"]})
        if existing is None:
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "email": s["email"],
                "password_hash": hash_password(s["password"]),
                "name": s["name"],
                "role": s["role"],
                "is_active": True,
                "created_at": now_iso(),
            })
            logger.info(f"Seeded user: {s['email']} ({s['role']})")
        elif not verify_password(s["password"], existing["password_hash"]):
            await db.users.update_one(
                {"email": s["email"]},
                {"$set": {"password_hash": hash_password(s["password"]), "is_active": True}},
            )

    if await db.settings.find_one({"key": "pricing"}) is None:
        await db.settings.insert_one({"key": "pricing", **DEFAULT_PRICING, "updated_at": now_iso()})
        logger.info("Seeded default pricing settings")

    # Phase 2 seed — only if no customers exist yet
    if await db.customers.count_documents({}) == 0:
        await _seed_phase2()


async def _seed_phase2():
    admin = await db.users.find_one({"role": "admin"}, {"_id": 0, "id": 1, "email": 1})
    admin_id = admin["id"] if admin else "system"

    customers_seed = [
        {
            "company_name": "Harbour Construction Pty Ltd",
            "abn": "53004085616",
            "contact_name": "Sarah Mitchell",
            "contact_email": "sarah@harbourconstruction.com.au",
            "contact_phone": "02 9555 1234",
            "billing_address": {"street": "Level 8, 45 Pyrmont St", "suburb": "Pyrmont", "state": "NSW", "postcode": "2009"},
            "site_address": {"street": "Lot 12 Foreshore Dr", "suburb": "Barangaroo", "state": "NSW", "postcode": "2000"},
            "site_same_as_billing": False,
            "account_terms": "30 days",
            "notes": "Long-term partner. Prefers Friday deliveries.",
        },
        {
            "company_name": "Western Precast Solutions",
            "abn": "27123456789",
            "contact_name": "James Wilson",
            "contact_email": "james@westernprecast.com.au",
            "contact_phone": "08 9444 7700",
            "billing_address": {"street": "22 Kewdale Rd", "suburb": "Welshpool", "state": "WA", "postcode": "6106"},
            "site_address": {"street": "22 Kewdale Rd", "suburb": "Welshpool", "state": "WA", "postcode": "6106"},
            "site_same_as_billing": True,
            "account_terms": "14 days",
            "notes": "",
        },
        {
            "company_name": "Metro Build Group",
            "abn": "78900112233",
            "contact_name": "Linh Nguyen",
            "contact_email": "linh@metrobuild.com.au",
            "contact_phone": "03 9620 3300",
            "billing_address": {"street": "188 Spencer St", "suburb": "Docklands", "state": "VIC", "postcode": "3008"},
            "site_address": {"street": "188 Spencer St", "suburb": "Docklands", "state": "VIC", "postcode": "3008"},
            "site_same_as_billing": True,
            "account_terms": "30 days",
            "notes": "Tower retrofit programme — multiple sites.",
        },
    ]

    customer_docs: List[dict] = []
    for c in customers_seed:
        doc = {
            "id": str(uuid.uuid4()),
            "active": True,
            "created_at": now_iso(),
            "updated_at": now_iso(),
            **c,
        }
        customer_docs.append(doc)
    await db.customers.insert_many(customer_docs)

    projects_seed = [
        {"customer_id": customer_docs[0]["id"], "project_name": "Barangaroo Tower B — Façade",
         "site_address": customer_docs[0]["site_address"],
         "description": "External architectural facade panels, levels 1-12.",
         "status": "quoted"},
        {"customer_id": customer_docs[1]["id"], "project_name": "Welshpool Warehouse 4",
         "site_address": customer_docs[1]["site_address"],
         "description": "Tilt-up walls + hollow core mezzanine.",
         "status": "planning"},
    ]
    project_docs: List[dict] = []
    for p in projects_seed:
        doc = {"id": str(uuid.uuid4()), "created_at": now_iso(), "updated_at": now_iso(), **p}
        project_docs.append(doc)
    await db.projects.insert_many(project_docs)

    pricing = await db.settings.find_one({"key": "pricing"}, {"_id": 0, "key": 0})

    def _line(panel_key, length, height, thickness, grade, qty, rein, openings, finish, desc):
        inp = QuoteLineInput(
            description=desc,
            panel_type_key=panel_key, length_m=length, height_m=height,
            thickness_mm=thickness, concrete_grade=grade, quantity=qty,
            reinforcement_type=rein, openings_m2=openings, finish_key=finish,
        )
        return build_quote_line(inp, pricing)

    # Draft quote — 2 lines (Western Precast)
    draft_lines = [
        _line("wall_load_bearing", 8, 3.5, 200, "C30/37", 16, "heavy", 0, "smooth", "Tilt-up perimeter walls"),
        _line("hollow_core", 7, 1.2, 200, "C30/37", 24, "standard", 0, "smooth", "Mezzanine floor slabs"),
    ]
    draft_totals = recompute_quote_totals(draft_lines)
    draft_quote = {
        "id": str(uuid.uuid4()),
        "quote_number": await next_quote_number(),
        "customer_id": customer_docs[1]["id"],
        "project_id": project_docs[1]["id"],
        "status": "draft",
        "valid_until": (now_utc() + timedelta(days=30)).date().isoformat(),
        "line_items": draft_lines,
        "notes_to_customer": "Preliminary pricing for Welshpool Warehouse 4. Subject to site survey.",
        "internal_notes": "Need to confirm crane access before finalising.",
        "subtotal": draft_totals["subtotal"],
        "gst": draft_totals["gst"],
        "total": draft_totals["total"],
        "total_volume_m3": draft_totals["total_volume_m3"],
        "total_weight_tonnes": draft_totals["total_weight_tonnes"],
        "created_by": admin_id,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "sent_at": None,
        "accepted_at": None,
        "rejected_at": None,
        "magic_link_token": None,
        "magic_link_decision_at": None,
        "magic_link_decision_ip": None,
    }

    # Sent quote — 3 lines (Harbour Construction) with magic link
    sent_lines = [
        _line("architectural_facade", 6, 3.2, 150, "C35/45", 48, "standard", 1.8, "exposed_aggregate", "Levels 1-6 north elevation"),
        _line("architectural_facade", 6, 3.2, 150, "C35/45", 48, "standard", 1.8, "exposed_aggregate", "Levels 7-12 north elevation"),
        _line("wall_standard", 5, 3, 150, "C30/37", 24, "standard", 0, "smooth", "Internal core walls"),
    ]
    sent_totals = recompute_quote_totals(sent_lines)
    sent_quote = {
        "id": str(uuid.uuid4()),
        "quote_number": await next_quote_number(),
        "customer_id": customer_docs[0]["id"],
        "project_id": project_docs[0]["id"],
        "status": "sent",
        "valid_until": (now_utc() + timedelta(days=30)).date().isoformat(),
        "line_items": sent_lines,
        "notes_to_customer": "Thanks for the opportunity. Pricing valid 30 days. Includes transport + install.",
        "internal_notes": "Customer asked about acid-etched alternative — quote that separately if needed.",
        "subtotal": sent_totals["subtotal"],
        "gst": sent_totals["gst"],
        "total": sent_totals["total"],
        "total_volume_m3": sent_totals["total_volume_m3"],
        "total_weight_tonnes": sent_totals["total_weight_tonnes"],
        "created_by": admin_id,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "sent_at": now_iso(),
        "accepted_at": None,
        "rejected_at": None,
        "magic_link_token": str(uuid.uuid4()),
        "magic_link_decision_at": None,
        "magic_link_decision_ip": None,
    }

    await db.quotes.insert_many([draft_quote, sent_quote])
    logger.info(f"Seeded Phase 2: {len(customer_docs)} customers, {len(project_docs)} projects, 2 quotes")
    logger.info(f"Sample magic link: /q/{sent_quote['magic_link_token']}")


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@api_router.post("/auth/login", response_model=LoginResponse)
async def auth_login(payload: LoginRequest):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], user["email"], user["role"])
    return LoginResponse(access_token=token, user=user_to_public(user))


@api_router.post("/auth/logout")
async def auth_logout(_user: dict = Depends(get_current_user)):
    return {"ok": True}


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return user_to_public(user)


@api_router.post("/auth/change-password")
async def auth_change_password(payload: ChangePasswordRequest, user: dict = Depends(get_current_user)):
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Users (admin)
# ---------------------------------------------------------------------------
@api_router.get("/users")
async def list_users(_admin: dict = Depends(require_admin)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.post("/users", status_code=201)
async def create_user(payload: UserCreate, _admin: dict = Depends(require_admin)):
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="User with this email already exists")
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name.strip(),
        "role": payload.role,
        "is_active": True,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    return user_to_public(doc)


@api_router.patch("/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdate, admin: dict = Depends(require_admin)):
    if user_id == admin["id"] and payload.is_active is False:
        raise HTTPException(status_code=400, detail="You cannot deactivate yourself")
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = await db.users.update_one({"id": user_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return user


# ---------------------------------------------------------------------------
# Pricing settings
# ---------------------------------------------------------------------------
@api_router.get("/settings/pricing")
async def get_pricing(_admin: dict = Depends(require_admin)):
    doc = await db.settings.find_one({"key": "pricing"}, {"_id": 0, "key": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Pricing not initialized")
    return doc


@api_router.put("/settings/pricing")
async def update_pricing(payload: PricingSettings, _admin: dict = Depends(require_admin)):
    data = payload.model_dump()
    data["updated_at"] = now_iso()
    await db.settings.update_one({"key": "pricing"}, {"$set": data}, upsert=True)
    doc = await db.settings.find_one({"key": "pricing"}, {"_id": 0, "key": 0})
    return doc


# ---------------------------------------------------------------------------
# Calculator endpoints
# ---------------------------------------------------------------------------
@api_router.get("/calculator/options")
async def calculator_options(_user: dict = Depends(get_current_user)):
    pricing = await db.settings.find_one({"key": "pricing"}, {"_id": 0, "key": 0})
    if not pricing:
        raise HTTPException(status_code=500, detail="Pricing not initialized")
    return {
        "panel_types": [
            {"key": p["key"], "label": p["label"], "thickness_mm": p["thickness_mm"]}
            for p in pricing["panel_types"]
        ],
        "thickness_options_mm": pricing["thickness_options_mm"],
        "concrete_grades": pricing["concrete_grades"],
        "finishes": [{"key": f["key"], "label": f["label"]} for f in pricing["finishes"]],
        "reinforcement_types": REINFORCEMENT_LABELS,
    }


@api_router.post("/calculator/calculate")
async def calculator_calculate(payload: CalculateRequest, _user: dict = Depends(get_current_user)):
    pricing = await db.settings.find_one({"key": "pricing"}, {"_id": 0, "key": 0})
    if not pricing:
        raise HTTPException(status_code=500, detail="Pricing not initialized")
    return compute_calculation(payload, pricing)


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------
def _strip_customer(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


@api_router.get("/customers")
async def list_customers(
    _user: dict = Depends(get_current_user),
    search: Optional[str] = Query(None),
    active: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    query: Dict[str, Any] = {}
    if active is not None:
        query["active"] = active
    if search:
        rx = re.compile(re.escape(search), re.IGNORECASE)
        query["$or"] = [
            {"company_name": rx},
            {"contact_name": rx},
            {"abn": rx},
            {"contact_email": rx},
        ]
    total = await db.customers.count_documents(query)
    cursor = (
        db.customers.find(query, {"_id": 0})
        .sort("created_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    items = await cursor.to_list(page_size)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@api_router.post("/customers", status_code=201)
async def create_customer(payload: CustomerCreate, _user: dict = Depends(get_current_user)):
    data = payload.model_dump()
    data["abn"] = normalise_abn(data.get("abn"))
    if data["site_same_as_billing"]:
        data["site_address"] = data["billing_address"]
    doc = {
        "id": str(uuid.uuid4()),
        "active": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        **data,
    }
    await db.customers.insert_one(doc)
    return _strip_customer(doc)


@api_router.get("/customers/{cid}")
async def get_customer(cid: str, _user: dict = Depends(get_current_user)):
    doc = await db.customers.find_one({"id": cid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Customer not found")
    return doc


@api_router.patch("/customers/{cid}")
async def update_customer(cid: str, payload: CustomerUpdate, _user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if "abn" in updates:
        updates["abn"] = normalise_abn(updates["abn"])
    if updates.get("site_same_as_billing"):
        # If user toggled it on, mirror billing
        billing = updates.get("billing_address")
        if billing is None:
            existing = await db.customers.find_one({"id": cid}, {"_id": 0, "billing_address": 1})
            if existing:
                billing = existing.get("billing_address")
        if billing:
            updates["site_address"] = billing
    updates["updated_at"] = now_iso()
    result = await db.customers.update_one({"id": cid}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Customer not found")
    doc = await db.customers.find_one({"id": cid}, {"_id": 0})
    return doc


@api_router.delete("/customers/{cid}")
async def delete_customer(cid: str, _user: dict = Depends(get_current_user)):
    has_projects = await db.projects.find_one({"customer_id": cid}) is not None
    has_quotes = await db.quotes.find_one({"customer_id": cid}) is not None
    if has_projects or has_quotes:
        # Soft delete only
        await db.customers.update_one({"id": cid}, {"$set": {"active": False, "updated_at": now_iso()}})
        return {"ok": True, "soft_deleted": True, "reason": "Customer has linked projects or quotes"}
    result = await db.customers.delete_one({"id": cid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"ok": True, "soft_deleted": False}


@api_router.get("/customers/{cid}/projects")
async def list_customer_projects(cid: str, _user: dict = Depends(get_current_user)):
    if not await db.customers.find_one({"id": cid}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Customer not found")
    docs = await db.projects.find({"customer_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
@api_router.get("/projects")
async def list_projects(
    _user: dict = Depends(get_current_user),
    customer_id: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
):
    query: Dict[str, Any] = {}
    if customer_id:
        query["customer_id"] = customer_id
    if status_filter:
        query["status"] = status_filter
    docs = await db.projects.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.post("/projects", status_code=201)
async def create_project(payload: ProjectCreate, _user: dict = Depends(get_current_user)):
    customer = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0, "site_address": 1})
    if not customer:
        raise HTTPException(status_code=400, detail="Customer not found")
    data = payload.model_dump()
    if data.get("site_address") is None:
        data["site_address"] = customer.get("site_address")
    doc = {
        "id": str(uuid.uuid4()),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        **data,
    }
    await db.projects.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/projects/{pid}")
async def get_project(pid: str, _user: dict = Depends(get_current_user)):
    doc = await db.projects.find_one({"id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    return doc


@api_router.patch("/projects/{pid}")
async def update_project(pid: str, payload: ProjectUpdate, _user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    updates["updated_at"] = now_iso()
    result = await db.projects.update_one({"id": pid}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return await db.projects.find_one({"id": pid}, {"_id": 0})


# ---------------------------------------------------------------------------
# Quotes
# ---------------------------------------------------------------------------
async def _get_quote_or_404(qid: str) -> dict:
    doc = await db.quotes.find_one({"id": qid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Quote not found")
    return doc


def _public_quote(doc: dict, customer: Optional[dict]) -> dict:
    """Sanitized read-only view for magic-link consumers."""
    return {
        "quote_number": doc["quote_number"],
        "status": doc["status"],
        "valid_until": doc["valid_until"],
        "customer": {"company_name": customer["company_name"]} if customer else None,
        "line_items": [
            {
                "description": l.get("description", ""),
                "panel_type_label": l["panel_type_label"],
                "length_m": l["length_m"],
                "height_m": l["height_m"],
                "thickness_mm": l["thickness_mm"],
                "quantity": l["quantity"],
                "finish_label": l["finish_label"],
                "total_aud": l["total_aud"],
            }
            for l in doc.get("line_items", [])
        ],
        "subtotal": doc["subtotal"],
        "gst": doc["gst"],
        "total": doc["total"],
        "notes_to_customer": doc.get("notes_to_customer", ""),
        "sent_at": doc.get("sent_at"),
        "accepted_at": doc.get("accepted_at"),
        "rejected_at": doc.get("rejected_at"),
    }


@api_router.get("/quotes")
async def list_quotes(
    _user: dict = Depends(get_current_user),
    status_filter: Optional[str] = Query(None, alias="status"),
    customer_id: Optional[str] = None,
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    query: Dict[str, Any] = {}
    if status_filter:
        query["status"] = status_filter
    if customer_id:
        query["customer_id"] = customer_id
    if search:
        rx = re.compile(re.escape(search), re.IGNORECASE)
        query["quote_number"] = rx
    total = await db.quotes.count_documents(query)
    docs = (
        await db.quotes.find(query, {"_id": 0})
        .sort("created_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list(page_size)
    )
    # Enrich with customer name for the list view
    cust_ids = list({d["customer_id"] for d in docs})
    customers = await db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0, "id": 1, "company_name": 1}).to_list(500)
    name_by_id = {c["id"]: c["company_name"] for c in customers}
    for d in docs:
        d["customer_company_name"] = name_by_id.get(d["customer_id"], "")
    return {"items": docs, "total": total, "page": page, "page_size": page_size}


@api_router.post("/quotes", status_code=201)
async def create_quote(payload: QuoteCreate, user: dict = Depends(get_current_user)):
    customer = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0, "id": 1})
    if not customer:
        raise HTTPException(status_code=400, detail="Customer not found")
    if payload.project_id:
        proj = await db.projects.find_one({"id": payload.project_id}, {"_id": 0, "customer_id": 1})
        if not proj or proj["customer_id"] != payload.customer_id:
            raise HTTPException(status_code=400, detail="Project does not belong to this customer")
    valid_until = payload.valid_until or (now_utc() + timedelta(days=30)).date().isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "quote_number": await next_quote_number(),
        "customer_id": payload.customer_id,
        "project_id": payload.project_id,
        "status": "draft",
        "valid_until": valid_until,
        "line_items": [],
        "notes_to_customer": payload.notes_to_customer,
        "internal_notes": payload.internal_notes,
        "subtotal": 0.0, "gst": 0.0, "total": 0.0,
        "total_volume_m3": 0.0, "total_weight_tonnes": 0.0,
        "created_by": user["id"],
        "created_at": now_iso(), "updated_at": now_iso(),
        "sent_at": None, "accepted_at": None, "rejected_at": None,
        "magic_link_token": None,
        "magic_link_decision_at": None, "magic_link_decision_ip": None,
    }
    await db.quotes.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/quotes/{qid}")
async def get_quote(qid: str, _user: dict = Depends(get_current_user)):
    doc = await _get_quote_or_404(qid)
    return doc


@api_router.patch("/quotes/{qid}")
async def update_quote(qid: str, payload: QuoteUpdate, _user: dict = Depends(get_current_user)):
    quote = await _get_quote_or_404(qid)
    if quote["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only draft quotes can be edited. Use status endpoints.")
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if "customer_id" in updates and updates["customer_id"]:
        if not await db.customers.find_one({"id": updates["customer_id"]}, {"_id": 0, "id": 1}):
            raise HTTPException(status_code=400, detail="Customer not found")
    if "project_id" in updates and updates["project_id"]:
        proj = await db.projects.find_one({"id": updates["project_id"]}, {"_id": 0, "customer_id": 1})
        cid = updates.get("customer_id", quote["customer_id"])
        if not proj or proj["customer_id"] != cid:
            raise HTTPException(status_code=400, detail="Project does not belong to this customer")
    updates["updated_at"] = now_iso()
    await db.quotes.update_one({"id": qid}, {"$set": updates})
    return await _get_quote_or_404(qid)


async def _require_draft(qid: str) -> dict:
    q = await _get_quote_or_404(qid)
    if q["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only draft quotes can be modified")
    return q


@api_router.post("/quotes/{qid}/lines", status_code=201)
async def add_quote_line(qid: str, payload: QuoteLineInput, _user: dict = Depends(get_current_user)):
    await _require_draft(qid)
    pricing = await db.settings.find_one({"key": "pricing"}, {"_id": 0, "key": 0})
    line = build_quote_line(payload, pricing)
    quote = await db.quotes.find_one({"id": qid}, {"_id": 0, "line_items": 1})
    lines = quote.get("line_items", []) + [line]
    totals = recompute_quote_totals(lines)
    await db.quotes.update_one(
        {"id": qid},
        {"$set": {
            "line_items": lines,
            "subtotal": totals["subtotal"], "gst": totals["gst"], "total": totals["total"],
            "total_volume_m3": totals["total_volume_m3"], "total_weight_tonnes": totals["total_weight_tonnes"],
            "updated_at": now_iso(),
        }},
    )
    return {"line": line, "totals": totals}


@api_router.patch("/quotes/{qid}/lines/{line_id}")
async def update_quote_line(qid: str, line_id: str, payload: QuoteLineInput, _user: dict = Depends(get_current_user)):
    await _require_draft(qid)
    pricing = await db.settings.find_one({"key": "pricing"}, {"_id": 0, "key": 0})
    new_line = build_quote_line(payload, pricing)
    new_line["id"] = line_id  # preserve line id
    quote = await db.quotes.find_one({"id": qid}, {"_id": 0, "line_items": 1})
    lines = quote.get("line_items", [])
    found = False
    for i, l in enumerate(lines):
        if l["id"] == line_id:
            lines[i] = new_line
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Line not found")
    totals = recompute_quote_totals(lines)
    await db.quotes.update_one(
        {"id": qid},
        {"$set": {
            "line_items": lines,
            "subtotal": totals["subtotal"], "gst": totals["gst"], "total": totals["total"],
            "total_volume_m3": totals["total_volume_m3"], "total_weight_tonnes": totals["total_weight_tonnes"],
            "updated_at": now_iso(),
        }},
    )
    return {"line": new_line, "totals": totals}


@api_router.delete("/quotes/{qid}/lines/{line_id}")
async def delete_quote_line(qid: str, line_id: str, _user: dict = Depends(get_current_user)):
    await _require_draft(qid)
    quote = await db.quotes.find_one({"id": qid}, {"_id": 0, "line_items": 1})
    lines = [l for l in quote.get("line_items", []) if l["id"] != line_id]
    if len(lines) == len(quote.get("line_items", [])):
        raise HTTPException(status_code=404, detail="Line not found")
    totals = recompute_quote_totals(lines)
    await db.quotes.update_one(
        {"id": qid},
        {"$set": {
            "line_items": lines,
            "subtotal": totals["subtotal"], "gst": totals["gst"], "total": totals["total"],
            "total_volume_m3": totals["total_volume_m3"], "total_weight_tonnes": totals["total_weight_tonnes"],
            "updated_at": now_iso(),
        }},
    )
    return {"ok": True, "totals": totals}


@api_router.post("/quotes/{qid}/send")
async def send_quote(qid: str, _user: dict = Depends(get_current_user)):
    q = await _get_quote_or_404(qid)
    if not q.get("line_items"):
        raise HTTPException(status_code=400, detail="Cannot send a quote with no line items")
    token = q.get("magic_link_token") or str(uuid.uuid4())
    await db.quotes.update_one(
        {"id": qid},
        {"$set": {
            "status": "sent",
            "magic_link_token": token,
            "sent_at": q.get("sent_at") or now_iso(),
            "updated_at": now_iso(),
        }},
    )
    return {"ok": True, "magic_link_token": token, "public_url": f"/q/{token}", "email_status": "MOCKED"}


@api_router.post("/quotes/{qid}/mark-accepted")
async def mark_accepted(qid: str, _user: dict = Depends(get_current_user)):
    await _get_quote_or_404(qid)
    await db.quotes.update_one(
        {"id": qid},
        {"$set": {"status": "accepted", "accepted_at": now_iso(), "updated_at": now_iso()}},
    )
    return await _get_quote_or_404(qid)


@api_router.post("/quotes/{qid}/mark-rejected")
async def mark_rejected(qid: str, _user: dict = Depends(get_current_user)):
    await _get_quote_or_404(qid)
    await db.quotes.update_one(
        {"id": qid},
        {"$set": {"status": "rejected", "rejected_at": now_iso(), "updated_at": now_iso()}},
    )
    return await _get_quote_or_404(qid)


# ---------------------------------------------------------------------------
# Public quote (magic link, NO auth)
# ---------------------------------------------------------------------------
def _is_expired(valid_until: str) -> bool:
    try:
        d = date.fromisoformat(valid_until)
        return d < now_utc().date()
    except Exception:
        return False


@api_router.get("/public/quotes/by-token/{token}")
async def public_get_quote(token: str):
    doc = await db.quotes.find_one({"magic_link_token": token}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Quote not found")
    customer = await db.customers.find_one({"id": doc["customer_id"]}, {"_id": 0, "company_name": 1})
    # Auto-expire if past valid_until and still in 'sent'
    if doc["status"] == "sent" and _is_expired(doc["valid_until"]):
        await db.quotes.update_one({"id": doc["id"]}, {"$set": {"status": "expired", "updated_at": now_iso()}})
        doc["status"] = "expired"
    return _public_quote(doc, customer)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


async def _public_decision(token: str, decision: Literal["accepted", "rejected"], request: Request):
    doc = await db.quotes.find_one({"magic_link_token": token}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Quote not found")
    if doc["status"] in ("accepted", "rejected"):
        raise HTTPException(status_code=409, detail=f"Quote already {doc['status']}")
    if doc["status"] == "expired" or _is_expired(doc["valid_until"]):
        raise HTTPException(status_code=409, detail="Quote has expired")
    if doc["status"] != "sent":
        raise HTTPException(status_code=409, detail=f"Quote cannot be {decision} from status '{doc['status']}'")
    ts = now_iso()
    field = "accepted_at" if decision == "accepted" else "rejected_at"
    await db.quotes.update_one(
        {"id": doc["id"]},
        {"$set": {
            "status": decision,
            field: ts,
            "magic_link_decision_at": ts,
            "magic_link_decision_ip": _client_ip(request),
            "updated_at": ts,
        }},
    )
    customer = await db.customers.find_one({"id": doc["customer_id"]}, {"_id": 0, "company_name": 1})
    return _public_quote(await db.quotes.find_one({"id": doc["id"]}, {"_id": 0}), customer)


@api_router.post("/public/quotes/by-token/{token}/accept")
async def public_accept(token: str, request: Request):
    return await _public_decision(token, "accepted", request)


@api_router.post("/public/quotes/by-token/{token}/reject")
async def public_reject(token: str, request: Request):
    return await _public_decision(token, "rejected", request)


# ---------------------------------------------------------------------------
# Dashboard KPIs
# ---------------------------------------------------------------------------
@api_router.get("/dashboard/kpis")
async def dashboard_kpis(_user: dict = Depends(get_current_user)):
    now = now_utc()
    start_of_month = datetime(now.year, now.month, 1, tzinfo=timezone.utc).isoformat()

    draft = await db.quotes.count_documents({"status": "draft"})
    sent = await db.quotes.count_documents({"status": "sent"})
    accepted = await db.quotes.count_documents({"status": "accepted"})
    customers_active = await db.customers.count_documents({"active": True})

    pipeline_quoted = [
        {"$match": {"created_at": {"$gte": start_of_month}}},
        {"$group": {"_id": None, "sum": {"$sum": "$total"}}},
    ]
    pipeline_accepted = [
        {"$match": {"accepted_at": {"$gte": start_of_month}}},
        {"$group": {"_id": None, "sum": {"$sum": "$total"}}},
    ]
    quoted_this_month = 0.0
    async for d in db.quotes.aggregate(pipeline_quoted):
        quoted_this_month = float(d.get("sum") or 0.0)
    accepted_this_month = 0.0
    async for d in db.quotes.aggregate(pipeline_accepted):
        accepted_this_month = float(d.get("sum") or 0.0)

    recent = await db.quotes.find({}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5)
    cust_ids = list({r["customer_id"] for r in recent})
    customers = await db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0, "id": 1, "company_name": 1}).to_list(500)
    name_by_id = {c["id"]: c["company_name"] for c in customers}
    recent_view = [
        {
            "id": r["id"],
            "quote_number": r["quote_number"],
            "status": r["status"],
            "total": r["total"],
            "created_at": r["created_at"],
            "customer_company_name": name_by_id.get(r["customer_id"], ""),
        }
        for r in recent
    ]
    return {
        "quotes_draft": draft,
        "quotes_sent": sent,
        "quotes_accepted": accepted,
        "customers_active": customers_active,
        "quoted_this_month_aud": _round2(quoted_this_month),
        "accepted_this_month_aud": _round2(accepted_this_month),
        "recent_quotes": recent_view,
    }


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {"app": "Paneltec Group API", "status": "ok", "version": "2.0.0"}


@api_router.get("/health")
async def health():
    return {"status": "ok", "time": now_iso()}


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    try:
        await seed_database()
    except Exception as e:
        logger.exception(f"Seeding failed: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
