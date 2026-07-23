"""
Simpro API client — OAuth 2.0 client-credentials flow.

Used by Phase 4 Part 2 sync workers. When credentials are missing or the
`enabled` flag is False on the integration_settings.simpro document, callers
must NOT invoke this client — the higher-level endpoints fall back to MOCKED
behaviour.

We deliberately keep the surface small (customers, employees, connectivity
probe). Secrets are never logged. Access tokens are cached in-process only.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("paneltec.simpro")

DEFAULT_TIMEOUT_S = 30.0
DEFAULT_RETRIES = 1
BACKOFF_S = 2.0
DEFAULT_PAGE_SIZE = 100


class SimproError(RuntimeError):
    """Raised on any non-recoverable Simpro API failure."""
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class SimproAuthError(SimproError):
    """Raised specifically on 401 / auth failures."""


@dataclass
class SimproSettings:
    build_name: str
    client_id: str
    client_secret: str
    api_base_url: str = ""  # optional override; otherwise derived from build_name

    @property
    def resolved_base_url(self) -> str:
        if self.api_base_url:
            return self.api_base_url.rstrip("/")
        if not self.build_name:
            raise SimproError("Simpro build_name is not configured")
        return f"https://{self.build_name}.simprosuite.com/api/v1.0"

    @property
    def token_url(self) -> str:
        if not self.build_name:
            raise SimproError("Simpro build_name is not configured")
        return f"https://{self.build_name}.simprosuite.com/oauth2/token"


class SimproClient:
    """Thin async wrapper over Simpro's REST API.

    Uses an in-memory cached access token; refreshes automatically on 401 or
    when the cached token is within 30 s of expiry.
    """
    _token_cache: Dict[str, Tuple[str, float]] = {}  # keyed by client_id → (token, expires_epoch)

    def __init__(self, settings: SimproSettings):
        if not settings.client_id or not settings.client_secret:
            raise SimproError("Simpro client_id / client_secret are required")
        self.settings = settings

    # ---------------- token management ----------------
    async def _get_token(self, force_refresh: bool = False) -> str:
        cid = self.settings.client_id
        cached = self._token_cache.get(cid)
        if not force_refresh and cached and cached[1] - time.time() > 30:
            return cached[0]

        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_S) as client:
            try:
                r = await client.post(
                    self.settings.token_url,
                    data={"grant_type": "client_credentials",
                          "client_id": self.settings.client_id,
                          "client_secret": self.settings.client_secret},
                    headers={"Accept": "application/json"},
                )
            except httpx.HTTPError as e:
                # Never log the secret; message includes only host + reason.
                logger.warning("Simpro token endpoint unreachable: %s", type(e).__name__)
                raise SimproError(f"Cannot reach Simpro ({type(e).__name__})")

        if r.status_code == 401 or r.status_code == 400:
            raise SimproAuthError("Simpro authentication failed", status_code=r.status_code)
        if r.status_code >= 500:
            raise SimproError(f"Simpro token endpoint returned {r.status_code}", status_code=r.status_code)
        if r.status_code >= 300:
            raise SimproError(f"Unexpected Simpro token response: {r.status_code}", status_code=r.status_code)

        body = r.json()
        token = body.get("access_token")
        if not token:
            raise SimproError("Simpro token response missing access_token")
        expires_in = int(body.get("expires_in", 3600))
        self._token_cache[cid] = (token, time.time() + expires_in)
        return token

    # ---------------- HTTP helpers ----------------
    async def _request(self, method: str, path: str,
                        params: Optional[Dict[str, Any]] = None) -> httpx.Response:
        base = self.settings.resolved_base_url
        url = f"{base}{path}"
        for attempt in range(DEFAULT_RETRIES + 1):
            token = await self._get_token(force_refresh=(attempt > 0))
            headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
            try:
                async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_S) as client:
                    r = await client.request(method, url, params=params, headers=headers)
            except httpx.HTTPError as e:
                if attempt < DEFAULT_RETRIES:
                    await asyncio.sleep(BACKOFF_S); continue
                raise SimproError(f"Simpro API unreachable ({type(e).__name__})")
            if r.status_code == 401 and attempt < DEFAULT_RETRIES:
                # Token might have expired mid-flight — force a fresh one.
                continue
            if r.status_code in (429, 502, 503, 504) and attempt < DEFAULT_RETRIES:
                await asyncio.sleep(BACKOFF_S); continue
            return r
        # unreachable, but satisfy the type checker
        raise SimproError("Simpro API exhausted retries")

    # ---------------- Public API ----------------
    async def test_connection(self) -> Dict[str, Any]:
        """Probe: get an access token AND make one lightweight GET. Returns
        `{ok, message, tenant_name?}` — never raises."""
        try:
            await self._get_token(force_refresh=True)
        except SimproAuthError as e:
            return {"ok": False, "message": "Simpro authentication failed"}
        except SimproError as e:
            return {"ok": False, "message": str(e)}

        # Ping /companies/0/ (returns tenant metadata). Simpro uses company id 0
        # as a synonym for "the primary tenant".
        try:
            r = await self._request("GET", "/companies/0/")
        except SimproError as e:
            return {"ok": False, "message": str(e)}
        if r.status_code == 401:
            return {"ok": False, "message": "Simpro authentication failed"}
        if r.status_code >= 400:
            return {"ok": False, "message": f"Simpro API returned {r.status_code}"}
        try:
            body = r.json() or {}
        except Exception:
            body = {}
        return {
            "ok": True,
            "message": "Simpro connection OK",
            "tenant_name": body.get("Name") or body.get("CompanyName") or self.settings.build_name,
        }

    async def list_customers(self, page: int = 1, per_page: int = DEFAULT_PAGE_SIZE) -> List[Dict[str, Any]]:
        r = await self._request("GET", "/companies/0/customers/",
                                 params={"pageSize": per_page, "page": page})
        if r.status_code >= 400:
            raise SimproError(f"Simpro list_customers HTTP {r.status_code}", status_code=r.status_code)
        return r.json() or []

    async def list_employees(self, page: int = 1, per_page: int = DEFAULT_PAGE_SIZE) -> List[Dict[str, Any]]:
        r = await self._request("GET", "/companies/0/employees/",
                                 params={"pageSize": per_page, "page": page})
        if r.status_code >= 400:
            raise SimproError(f"Simpro list_employees HTTP {r.status_code}", status_code=r.status_code)
        return r.json() or []

    async def iter_all(self, list_fn, hard_cap: int = 5000) -> List[Dict[str, Any]]:
        """Walk pages until an empty page or the hard cap is reached.
        Simpro's response header `Result-Total` also gives the total, but we
        keep it simple: paginate until the API returns fewer than pageSize."""
        out: List[Dict[str, Any]] = []
        page = 1
        while len(out) < hard_cap:
            batch = await list_fn(page=page, per_page=DEFAULT_PAGE_SIZE)
            if not batch:
                break
            out.extend(batch)
            if len(batch) < DEFAULT_PAGE_SIZE:
                break
            page += 1
        return out


# ---------------- helpers used by server.py ----------------
def build_settings_from_doc(section: Dict[str, Any]) -> Optional[SimproSettings]:
    """Return SimproSettings if the section has enough to attempt a real API
    call; otherwise None. Callers should treat None as "fall back to MOCKED"."""
    if not section: return None
    if not section.get("enabled"): return None
    build_name = (section.get("build_name") or "").strip()
    client_id = (section.get("client_id") or "").strip()
    client_secret = section.get("client_secret") or ""
    if not (build_name and client_id and client_secret):
        return None
    return SimproSettings(
        build_name=build_name,
        client_id=client_id,
        client_secret=client_secret,
        api_base_url=(section.get("api_base_url") or "").strip(),
    )


# --------- Field-mapping helpers (Simpro payload → local schema) ---------
def _addr_dict(raw: Dict[str, Any]) -> Dict[str, str]:
    """Simpro Address → local Address (street/suburb/state/postcode).
    Local schema restricts state to AU codes and postcode to 4 digits — we
    silently drop invalid values so we never break the whole sync."""
    if not isinstance(raw, dict): return {"street": "", "suburb": "", "state": "", "postcode": ""}
    line1 = (raw.get("Line1") or raw.get("Address1") or "").strip()
    line2 = (raw.get("Line2") or raw.get("Address2") or "").strip()
    street = ", ".join(x for x in (line1, line2) if x)
    state = (raw.get("State") or "").strip().upper()
    if state not in {"NSW","VIC","QLD","WA","SA","TAS","ACT","NT"}: state = ""
    postcode = (raw.get("Postcode") or "").strip()
    if not (postcode and len(postcode) == 4 and postcode.isdigit()): postcode = ""
    return {
        "street": street[:200],
        "suburb": (raw.get("City") or raw.get("Suburb") or "").strip()[:100],
        "state": state,
        "postcode": postcode,
    }


def map_customer(sim: Dict[str, Any]) -> Dict[str, Any]:
    contact = sim.get("PrimaryContact") or {}
    given = (contact.get("GivenName") or "").strip()
    family = (contact.get("FamilyName") or "").strip()
    contact_name = (f"{given} {family}").strip()
    billing = _addr_dict(sim.get("Address") or {})
    return {
        "simpro_customer_id": str(sim.get("ID")),
        "company_name": (sim.get("CompanyName") or contact_name or "(Simpro import)").strip()[:200],
        "abn": (sim.get("ABN") or "").replace(" ", "").strip(),
        "contact_name": contact_name[:100],
        "contact_email": (contact.get("Email") or "").strip().lower(),
        "contact_phone": (contact.get("WorkPhone") or contact.get("Phone") or "").strip()[:50],
        "billing_address": billing,
        "site_address": billing,
        "site_same_as_billing": True,
    }


def map_employee(sim: Dict[str, Any]) -> Dict[str, Any]:
    given = (sim.get("GivenName") or "").strip()
    family = (sim.get("FamilyName") or "").strip()
    return {
        "simpro_employee_id": str(sim.get("ID")),
        "name": (f"{given} {family}").strip() or f"Simpro #{sim.get('ID')}",
        "role": (sim.get("Type") or sim.get("Position") or "").strip()[:100],
        "email": (sim.get("Email") or "").strip().lower(),
        "phone": (sim.get("Phone") or sim.get("WorkPhone") or "").strip()[:50],
        "notes": "",
    }
