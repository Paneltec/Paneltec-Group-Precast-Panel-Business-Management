from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict


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
    description="Precast Panel Business Management — Phase 1",
    version="1.0.0",
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
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


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
# Models
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
# Seed data
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


async def seed_database():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)

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
                "created_at": now_utc().isoformat(),
            })
            logger.info(f"Seeded user: {s['email']} ({s['role']})")
        elif not verify_password(s["password"], existing["password_hash"]):
            await db.users.update_one(
                {"email": s["email"]},
                {"$set": {"password_hash": hash_password(s["password"]), "is_active": True}},
            )
            logger.info(f"Updated seeded user password: {s['email']}")

    existing_pricing = await db.settings.find_one({"key": "pricing"})
    if existing_pricing is None:
        doc = {"key": "pricing", **DEFAULT_PRICING, "updated_at": now_utc().isoformat()}
        await db.settings.insert_one(doc)
        logger.info("Seeded default pricing settings")


# ---------------------------------------------------------------------------
# Auth routes
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
    # Stateless JWT: client discards the token.
    return {"ok": True}


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return user_to_public(user)


@api_router.post("/auth/change-password")
async def auth_change_password(payload: ChangePasswordRequest, user: dict = Depends(get_current_user)):
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# User management (admin only)
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
        "created_at": now_utc().isoformat(),
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
    data["updated_at"] = now_utc().isoformat()
    await db.settings.update_one(
        {"key": "pricing"},
        {"$set": data},
        upsert=True,
    )
    doc = await db.settings.find_one({"key": "pricing"}, {"_id": 0, "key": 0})
    return doc


# ---------------------------------------------------------------------------
# Calculator
# ---------------------------------------------------------------------------
REINFORCEMENT_LABELS = [
    {"key": "light", "label": "Light (mesh)"},
    {"key": "standard", "label": "Standard (mesh + bars)"},
    {"key": "heavy", "label": "Heavy (rebar cage)"},
    {"key": "prestressed", "label": "Prestressed tendons"},
]


@api_router.get("/calculator/options")
async def calculator_options(_user: dict = Depends(get_current_user)):
    """Public dropdown metadata for any authenticated user.

    Intentionally OMITS pricing values (material/manufacturing/transport/finish
    multipliers/reinforcement densities) so staff cannot derive admin pricing.
    """
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


def _round2(x: float) -> float:
    return round(x + 1e-9, 2)


@api_router.post("/calculator/calculate")
async def calculate(payload: CalculateRequest, _user: dict = Depends(get_current_user)):
    pricing = await db.settings.find_one({"key": "pricing"}, {"_id": 0, "key": 0})
    if not pricing:
        raise HTTPException(status_code=500, detail="Pricing not initialized")

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


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {"app": "Paneltec Group API", "status": "ok", "version": "1.0.0"}


@api_router.get("/health")
async def health():
    return {"status": "ok", "time": now_utc().isoformat()}


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
