"""
Simpro API client — Personal Access Token (PAT) flow.

Phase 11.7.5 rewrite: the earlier OAuth2 client-credentials flow (build_name /
client_id / client_secret) has been replaced by the PAT-style credentials that
the Admin Settings → Integrations → Simpro page now collects (URL + API Token).

The client sends `Authorization: Bearer {api_token}` on every request. Simpro
scopes every REST call to a single company via the path prefix
`/api/v1.0/companies/{company_id}/...`, so we iterate each configured
`company_id` in turn and tag every returned row with `_source_company_id` so
callers can attribute rows back to a specific company.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

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
    url: str
    api_token: str
    company_ids: List[int] = field(default_factory=list)

    def __post_init__(self):
        # Defensive: paste artifacts (leading/trailing whitespace, stray newlines)
        # in a Bearer header are rejected client-side by httpx as
        # `LocalProtocolError: Illegal header value` — before the request even
        # leaves the process. Strip once, here, so every callsite is safe.
        self.url = (self.url or "").strip()
        self.api_token = (self.api_token or "").strip()

    @property
    def api_root(self) -> str:
        """Return the API root URL, e.g. https://build.simprosuite.com/api/v1.0."""
        base = (self.url or "").strip().rstrip("/")
        if not base:
            raise SimproError("Simpro URL is not configured")
        if not base.startswith(("http://", "https://")):
            base = f"https://{base}"
        if not base.endswith("/api/v1.0"):
            base = f"{base}/api/v1.0"
        return base


class SimproClient:
    """Thin async wrapper over Simpro's REST API using a Personal Access Token.

    No token exchange dance: the PAT is sent directly as a Bearer header.
    """

    def __init__(self, settings: SimproSettings):
        if not settings.url:
            raise SimproError("Simpro URL is required")
        if not settings.api_token:
            raise SimproError("Simpro API token is required")
        self.settings = settings

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.settings.api_token}",
            "Accept": "application/json",
        }

    async def _request(self, method: str, path: str,
                        params: Optional[Dict[str, Any]] = None) -> httpx.Response:
        url = f"{self.settings.api_root}{path}"
        last_exc: Optional[Exception] = None
        for attempt in range(DEFAULT_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_S) as client:
                    r = await client.request(method, url, params=params, headers=self._headers())
            except httpx.HTTPError as e:
                last_exc = e
                if attempt < DEFAULT_RETRIES:
                    await asyncio.sleep(BACKOFF_S); continue
                raise SimproError(f"Simpro API unreachable ({type(e).__name__})")
            if r.status_code in (429, 502, 503, 504) and attempt < DEFAULT_RETRIES:
                await asyncio.sleep(BACKOFF_S); continue
            return r
        # unreachable
        raise SimproError(f"Simpro API exhausted retries ({type(last_exc).__name__ if last_exc else 'unknown'})")

    async def test_connection(self) -> Dict[str, Any]:
        """Probe: ping the first configured company (or /companies/ if none).
        Returns `{ok, message, tenant_name?}` — never raises."""
        cid = self.settings.company_ids[0] if self.settings.company_ids else None
        path = f"/companies/{cid}/" if cid is not None else "/companies/"
        try:
            r = await self._request("GET", path)
        except SimproError as e:
            return {"ok": False, "message": str(e)}
        if r.status_code == 401:
            return {"ok": False, "message": "Simpro authentication failed — check the API token."}
        if r.status_code >= 400:
            return {"ok": False, "message": f"Simpro API returned {r.status_code}"}
        try:
            body = r.json() or {}
        except Exception:
            body = {}
        if isinstance(body, dict):
            name = body.get("Name") or body.get("CompanyName") or (f"Company {cid}" if cid is not None else None)
            return {"ok": True, "message": "Simpro connection OK", "tenant_name": name}
        return {"ok": True, "message": f"{len(body)} companies visible", "tenant_name": None}

    async def _list_page(self, company_id: int, resource: str,
                          page: int, per_page: int) -> List[Dict[str, Any]]:
        r = await self._request("GET", f"/companies/{company_id}/{resource}/",
                                 params={"pageSize": per_page, "page": page})
        if r.status_code == 401:
            raise SimproAuthError("Simpro authentication failed", status_code=401)
        if r.status_code >= 400:
            raise SimproError(f"Simpro list_{resource} HTTP {r.status_code} for company {company_id}",
                              status_code=r.status_code)
        body = r.json() or []
        return body if isinstance(body, list) else []

    async def _iter_company(self, company_id: int, resource: str,
                             hard_cap: int = 5000) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        page = 1
        while len(out) < hard_cap:
            batch = await self._list_page(company_id, resource, page=page, per_page=DEFAULT_PAGE_SIZE)
            if not batch:
                break
            for row in batch:
                if isinstance(row, dict):
                    row["_source_company_id"] = company_id
                    out.append(row)
            if len(batch) < DEFAULT_PAGE_SIZE:
                break
            page += 1
        return out

    async def list_customers(self) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for cid in self.settings.company_ids or []:
            rows.extend(await self._iter_company(cid, "customers"))
        return rows

    async def list_employees(self) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for cid in self.settings.company_ids or []:
            rows.extend(await self._iter_company(cid, "employees"))
        return rows

    async def get_employee_detail(self, company_id: int, employee_id: str) -> Dict[str, Any]:
        """Fetch the full employee record from Simpro.
        The detail endpoint is `/companies/{cid}/employees/{eid}` (NO trailing
        slash — Simpro returns 404 "Invalid route" with a trailing slash on
        this specific resource). Returns {} on 404 / any error — never raises."""
        try:
            r = await self._request("GET", f"/companies/{company_id}/employees/{employee_id}")
            if r.status_code == 401:
                raise SimproAuthError("Simpro authentication failed", status_code=401)
            if r.status_code >= 400:
                logger.info("[simpro.detail] company=%s employee=%s HTTP %s body=%r",
                             company_id, employee_id, r.status_code, (r.text or "")[:120])
                return {}
            body = r.json() or {}
            return body if isinstance(body, dict) else {}
        except SimproAuthError:
            raise
        except (SimproError, httpx.HTTPError) as e:
            logger.warning("[simpro.detail] company=%s employee=%s error %s: %s",
                            company_id, employee_id, type(e).__name__, str(e)[:120])
            return {}

    async def enrich_employees(self, rows: List[Dict[str, Any]],
                                concurrency: int = 8) -> List[Dict[str, Any]]:
        """Fan out a bounded batch of detail calls, merging each response back
        onto its source row. Rows missing `_source_company_id` or `ID` are
        left as-is."""
        sem = asyncio.Semaphore(concurrency)
        async def _one(row: Dict[str, Any]) -> None:
            cid = row.get("_source_company_id")
            eid = row.get("ID")
            if cid is None or eid is None:
                return
            async with sem:
                detail = await self.get_employee_detail(cid, str(eid))
            if detail:
                for k, v in detail.items():
                    # Do not overwrite ID / Name / _source_company_id from the list row.
                    if k in ("ID", "Name", "_source_company_id"):
                        continue
                    row[k] = v
        await asyncio.gather(*(_one(r) for r in rows))
        return rows

    async def iter_all(self, list_fn, hard_cap: int = 5000) -> List[Dict[str, Any]]:
        """Kept for source-level backwards compatibility with server.py.
        The new list_customers / list_employees already iterate every configured
        company and every page, so this simply invokes the passed callable
        (which is now a no-arg async method)."""
        rows = await list_fn()
        return rows[:hard_cap]


# ---------------- helpers used by server.py ----------------
def build_settings_from_doc(section: Dict[str, Any]) -> Optional[SimproSettings]:
    """Return SimproSettings if the section has enough to attempt a real API
    call; otherwise None. Callers should treat None as "not configured"."""
    if not section:
        return None
    if not section.get("enabled"):
        return None
    url = (section.get("url") or "").strip()
    api_token = (section.get("api_token") or "").strip()
    company_ids = [int(x) for x in (section.get("company_ids") or []) if str(x).strip()]
    if not (url and api_token and company_ids):
        return None
    return SimproSettings(url=url, api_token=api_token, company_ids=company_ids)


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
    """Map a Simpro employee (either the thin list-endpoint row or the
    fully-hydrated detail-endpoint response) to the Paneltec employee schema.

    Simpro's list endpoint returns only `{ID, Name}`. The detail endpoint
    (`/companies/{cid}/employees/{eid}` — no trailing slash) additionally
    returns `Position`, `PrimaryContact.{Email, WorkPhone, CellPhone}`, plus
    Address / Banking / etc. that we don't need. We prefer CellPhone over
    WorkPhone."""
    name = (sim.get("Name") or "").strip()
    if not name:
        given = (sim.get("GivenName") or "").strip()
        family = (sim.get("FamilyName") or "").strip()
        name = (f"{given} {family}").strip()
    if not name:
        name = f"Simpro #{sim.get('ID')}"
    contact = sim.get("PrimaryContact") or {}
    email = (contact.get("Email") or sim.get("Email") or "").strip().lower()
    phone = (contact.get("CellPhone") or contact.get("WorkPhone")
              or sim.get("Phone") or sim.get("Mobile") or "").strip()
    role = (sim.get("Position") or sim.get("Type") or sim.get("Title") or "").strip()[:100]
    return {
        "simpro_employee_id": str(sim.get("ID")),
        "name": name,
        "role": role,
        "email": email,
        "phone": phone[:50],
        "notes": "",
    }
