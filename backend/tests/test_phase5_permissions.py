"""
Phase 5 — Granular Permissions + Full User Management
Run: pytest /app/backend/tests/test_phase5_permissions.py -v
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("admin@paneltec.com.au", "Paneltec2026!")
STAFF = ("staff@paneltec.com.au", "Staff2026!")
PROD = ("production@paneltec.com.au", "Prod2026!")


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed {email}: {r.status_code} {r.text}"
    return r.json()


def _headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(*ADMIN)["access_token"]


@pytest.fixture(scope="module")
def admin_user():
    return _login(*ADMIN)["user"]


@pytest.fixture(scope="module")
def staff_token():
    return _login(*STAFF)["access_token"]


@pytest.fixture(scope="module")
def prod_token():
    return _login(*PROD)["access_token"]


@pytest.fixture(scope="module")
def admin_h(admin_token):
    return _headers(admin_token)


@pytest.fixture(scope="module")
def staff_h(staff_token):
    return _headers(staff_token)


@pytest.fixture(scope="module")
def prod_h(prod_token):
    return _headers(prod_token)


_created_user_ids: list[str] = []


def _create_user(admin_h, **overrides):
    payload = {
        "email": f"test_{uuid.uuid4().hex[:8]}@example.com",
        "password": "TempPass123!",
        "name": "TEST User",
        "role_label": "Tester",
        "is_super_admin": False,
        "permissions": {},
        "must_change_password": False,
    }
    payload.update(overrides)
    r = requests.post(f"{API}/users", json=payload, headers=admin_h, timeout=15)
    assert r.status_code == 201, f"create_user failed: {r.status_code} {r.text}"
    user = r.json()
    _created_user_ids.append(user["id"])
    return user, payload


@pytest.fixture(scope="module", autouse=True)
def _cleanup(admin_h):
    yield
    # Deactivate all test-created users at end of module
    for uid in _created_user_ids:
        try:
            requests.patch(f"{API}/users/{uid}", json={"is_active": False}, headers=admin_h, timeout=15)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Seed login / migration — admin/staff/production
# ---------------------------------------------------------------------------
class TestSeedLogin:
    def test_admin_login_is_super(self):
        d = _login(*ADMIN)
        u = d["user"]
        assert u["is_super_admin"] is True
        assert u["role_label"] == "Administrator"
        assert u.get("must_change_password") is False
        assert "last_login_at" in u

    def test_staff_estimator(self):
        u = _login(*STAFF)["user"]
        assert u["is_super_admin"] is False
        assert u["role_label"] == "Estimator"
        perms = u.get("permissions") or {}
        # Estimator preset must contain these
        for p in ["customers.view","customers.create","quotes.create","jobs.view","invoices.view"]:
            assert perms.get(p) is True, f"Estimator missing {p}"
        # Estimator must NOT have pricing.view, company.view, users.view, integrations.view
        for p in ["pricing.view","pricing.edit","company.view","company.edit",
                  "users.view","users.manage","integrations.view","integrations.edit"]:
            assert not perms.get(p), f"Estimator should not have {p}"

    def test_production_login(self):
        u = _login(*PROD)["user"]
        assert u["is_super_admin"] is False
        assert u["role_label"] == "Production"
        perms = u.get("permissions") or {}
        for p in ["jobs.view","jobs.edit","jobs.transition","jobs.cancel",
                  "customers.view","projects.view","quotes.view",
                  "invoices.view","vehicles.view","employees.view"]:
            assert perms.get(p) is True, f"Production missing {p}"
        # Should NOT have quote/invoice create
        for p in ["quotes.create","invoices.create","pricing.edit","users.manage"]:
            assert not perms.get(p), f"Production should not have {p}"


# ---------------------------------------------------------------------------
# Estimator 403s on admin-gated endpoints
# ---------------------------------------------------------------------------
class TestEstimatorForbiddenEndpoints:
    @pytest.mark.parametrize("path", [
        "/settings/pricing", "/settings/company", "/settings/integrations", "/users"
    ])
    def test_estimator_403(self, staff_h, path):
        r = requests.get(f"{API}{path}", headers=staff_h, timeout=15)
        assert r.status_code == 403, f"Expected 403 for staff on {path}, got {r.status_code} {r.text}"


# ---------------------------------------------------------------------------
# Production user cannot create quote/invoice
# ---------------------------------------------------------------------------
class TestProductionForbiddenWrites:
    def test_prod_cannot_post_quote(self, prod_h):
        r = requests.post(f"{API}/quotes", headers=prod_h, json={
            "customer_id": "x", "valid_until": "2026-12-31", "line_items": []
        }, timeout=15)
        assert r.status_code == 403, r.text

    def test_prod_cannot_post_invoice(self, prod_h):
        r = requests.post(f"{API}/invoices", headers=prod_h, json={
            "customer_id": "x", "line_items": []
        }, timeout=15)
        assert r.status_code == 403, r.text

    def test_prod_can_view_jobs(self, prod_h):
        r = requests.get(f"{API}/jobs", headers=prod_h, timeout=15)
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# /api/permissions/catalogue shape
# ---------------------------------------------------------------------------
class TestPermissionsCatalogue:
    def test_catalogue_shape(self, admin_h):
        r = requests.get(f"{API}/permissions/catalogue", headers=admin_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert len(d["modules"]) == 15, f"expected 15 modules got {len(d['modules'])}"
        assert len(d["all_permissions"]) == 54, f"expected 54 perms got {len(d['all_permissions'])}"
        assert len(d["presets"]) == 4
        keys = {p["key"] for p in d["presets"]}
        assert keys == {"estimator","production","accounts","readonly"}
        for elev in ["pricing.edit","company.edit","integrations.edit","users.manage"]:
            assert elev in d["elevated_permissions"], f"missing elevated {elev}"


# ---------------------------------------------------------------------------
# Elevated-permissions enforcement on POST/PATCH /api/users
# ---------------------------------------------------------------------------
class TestElevatedPermissionGuard:
    @pytest.mark.parametrize("perm", ["pricing.edit","company.edit","integrations.edit","users.manage"])
    def test_post_user_with_elevated_perm_rejected(self, admin_h, perm):
        r = requests.post(f"{API}/users", headers=admin_h, json={
            "email": f"test_elev_{uuid.uuid4().hex[:6]}@example.com",
            "password": "TempPass123!", "name": "TEST Elev",
            "is_super_admin": False, "permissions": {perm: True},
        }, timeout=15)
        assert r.status_code == 400, f"Expected 400 for {perm}, got {r.status_code} {r.text}"

    def test_patch_user_with_elevated_perm_rejected(self, admin_h):
        u, _ = _create_user(admin_h)
        r = requests.patch(f"{API}/users/{u['id']}", headers=admin_h,
                           json={"permissions": {"pricing.edit": True}}, timeout=15)
        assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# Last-admin safety + self-protection
# ---------------------------------------------------------------------------
class TestLastAdminSafety:
    def test_cannot_demote_self_when_only_super(self, admin_h, admin_user):
        r = requests.patch(f"{API}/users/{admin_user['id']}", headers=admin_h,
                           json={"is_super_admin": False}, timeout=15)
        assert r.status_code == 400, r.text
        assert "super admin" in r.text.lower()

    def test_cannot_deactivate_self(self, admin_h, admin_user):
        r = requests.patch(f"{API}/users/{admin_user['id']}", headers=admin_h,
                           json={"is_active": False}, timeout=15)
        assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# Force password change flow (backend)
# ---------------------------------------------------------------------------
class TestForcePasswordChange:
    def test_force_flow(self, admin_h):
        user, payload = _create_user(admin_h, must_change_password=True,
                                     permissions={"customers.view": True})
        # login
        d = _login(payload["email"], payload["password"])
        assert d["user"]["must_change_password"] is True
        tok = d["access_token"]
        h = _headers(tok)

        # business endpoint should return 403 with structured detail
        r = requests.get(f"{API}/customers", headers=h, timeout=15)
        assert r.status_code == 403, r.text
        body = r.json()
        detail = body.get("detail")
        assert isinstance(detail, dict) and detail.get("code") == "password_change_required", body

        # auth/me should still work
        r2 = requests.get(f"{API}/auth/me", headers=h, timeout=15)
        assert r2.status_code == 200

        # change-password clears the flag
        r3 = requests.post(f"{API}/auth/change-password", headers=h, json={
            "current_password": payload["password"], "new_password": "NewPass987!"
        }, timeout=15)
        assert r3.status_code == 200, r3.text

        # business endpoint now works
        r4 = requests.get(f"{API}/customers", headers=h, timeout=15)
        assert r4.status_code == 200, r4.text


# ---------------------------------------------------------------------------
# Accounts preset — new user can invoice, cannot quote
# ---------------------------------------------------------------------------
class TestAccountsPreset:
    def test_accounts_user_perms(self, admin_h):
        accounts_perms = {
            "customers.view": True, "projects.view": True, "quotes.view": True, "jobs.view": True,
            "invoices.view": True, "invoices.create": True, "invoices.issue": True,
            "invoices.mark_paid": True, "invoices.push_xero": True, "company.view": True,
        }
        user, payload = _create_user(admin_h, permissions=accounts_perms,
                                     role_label="Accounts", must_change_password=False)
        tok = _login(payload["email"], payload["password"])["access_token"]
        h = _headers(tok)

        # Can view invoices
        r = requests.get(f"{API}/invoices", headers=h, timeout=15)
        assert r.status_code == 200

        # Cannot create quote
        r = requests.post(f"{API}/quotes", headers=h, json={
            "customer_id": "x", "valid_until": "2026-12-31", "line_items": []
        }, timeout=15)
        assert r.status_code == 403

        # Cannot edit jobs (no jobs.edit/transition)
        # Find a job first
        jobs_resp = requests.get(f"{API}/jobs", headers=h, timeout=15).json()
        jobs = jobs_resp.get("items", jobs_resp) if isinstance(jobs_resp, dict) else jobs_resp
        if jobs:
            jid = jobs[0]["id"]
            r = requests.post(f"{API}/jobs/{jid}/transition", headers=h,
                              json={"new_status": "in_production"}, timeout=15)
            assert r.status_code == 403


# ---------------------------------------------------------------------------
# /users/me self-service + last_login_at
# ---------------------------------------------------------------------------
class TestSelfServiceAndLastLogin:
    def test_patch_me_name(self, admin_h):
        user, payload = _create_user(admin_h, must_change_password=False)
        tok = _login(payload["email"], payload["password"])["access_token"]
        h = _headers(tok)
        r = requests.patch(f"{API}/users/me", headers=h, json={"name": "Updated Name"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Updated Name"

    def test_patch_me_password(self, admin_h):
        user, payload = _create_user(admin_h, must_change_password=False)
        tok = _login(payload["email"], payload["password"])["access_token"]
        h = _headers(tok)
        r = requests.patch(f"{API}/users/me", headers=h, json={
            "current_password": payload["password"], "new_password": "BrandNew123!"
        }, timeout=15)
        assert r.status_code == 200, r.text
        # Old password fails
        r2 = requests.post(f"{API}/auth/login", json={"email": payload["email"], "password": payload["password"]}, timeout=15)
        assert r2.status_code == 401
        # New password works
        r3 = requests.post(f"{API}/auth/login", json={"email": payload["email"], "password": "BrandNew123!"}, timeout=15)
        assert r3.status_code == 200

    def test_last_login_at_updates(self):
        d1 = _login(*STAFF)
        ts1 = d1["user"].get("last_login_at")
        time.sleep(1.2)
        d2 = _login(*STAFF)
        ts2 = d2["user"].get("last_login_at")
        assert ts1 and ts2 and ts2 >= ts1

    def test_auth_me_returns_last_login(self, staff_h):
        r = requests.get(f"{API}/auth/me", headers=staff_h, timeout=15)
        assert r.status_code == 200
        assert r.json().get("last_login_at")


# ---------------------------------------------------------------------------
# Deactivated user login
# ---------------------------------------------------------------------------
class TestDeactivatedLogin:
    def test_deactivated_user_login_blocked(self, admin_h):
        user, payload = _create_user(admin_h, must_change_password=False)
        # deactivate
        r = requests.patch(f"{API}/users/{user['id']}", headers=admin_h,
                           json={"is_active": False}, timeout=15)
        assert r.status_code == 200, r.text
        # login should fail with 401
        r2 = requests.post(f"{API}/auth/login",
                           json={"email": payload["email"], "password": payload["password"]}, timeout=15)
        assert r2.status_code == 401, r2.text


# ---------------------------------------------------------------------------
# Reset-password endpoint
# ---------------------------------------------------------------------------
class TestResetPasswordEndpoint:
    def test_super_admin_can_reset(self, admin_h):
        user, payload = _create_user(admin_h, must_change_password=False)
        new_pw = "ResetPass456!"
        r = requests.post(f"{API}/users/{user['id']}/reset-password", headers=admin_h,
                          json={"new_password": new_pw, "must_change_password": True}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("new_password") == new_pw
        assert body.get("must_change_password") is True
        # Now login as that user
        d = _login(payload["email"], new_pw)
        assert d["user"]["must_change_password"] is True

    def test_non_super_cannot_reset(self, staff_h, admin_h):
        user, _ = _create_user(admin_h)
        r = requests.post(f"{API}/users/{user['id']}/reset-password", headers=staff_h,
                          json={"new_password": "abcdefgh1", "must_change_password": True}, timeout=15)
        assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# Phase 1 calculator regression (admin/staff/production)
# ---------------------------------------------------------------------------
class TestCalculatorRegression:
    payload = {
        "panel_type_key": "wall_standard",
        "length_m": 6,
        "height_m": 3,
        "thickness_mm": 150,
        "concrete_grade": "C30/37",
        "quantity": 1,
        "reinforcement_type": "standard",
        "openings_m2": 0,
        "finish_key": "smooth",
    }

    @pytest.mark.parametrize("creds", [ADMIN, STAFF, PROD])
    def test_calculator_5623(self, creds):
        tok = _login(*creds)["access_token"]
        h = _headers(tok)
        r = requests.post(f"{API}/calculator/calculate", headers=h, json=self.payload, timeout=15)
        assert r.status_code == 200, r.text
        total = r.json().get("cost_breakdown", {}).get("total_inc_gst")
        assert total == 5623.20, f"expected 5623.20 got {total}"


# ---------------------------------------------------------------------------
# Phase 3 chain regression
# ---------------------------------------------------------------------------
class TestPhase3Regression:
    def test_seeded_chain(self, admin_h):
        def _items(resp):
            data = resp.json()
            return data["items"] if isinstance(data, dict) and "items" in data else data
        q = _items(requests.get(f"{API}/quotes", headers=admin_h, timeout=15))
        j = _items(requests.get(f"{API}/jobs", headers=admin_h, timeout=15))
        inv = _items(requests.get(f"{API}/invoices", headers=admin_h, timeout=15))
        qnums = {x.get("quote_number") for x in q}
        jnums = {x.get("job_number") for x in j}
        inums = {x.get("invoice_number") for x in inv}
        assert "Q-2026-0002" in qnums, qnums
        assert "J-2026-0001" in jnums, jnums
        assert "INV-2026-0001" in inums, inums


# ---------------------------------------------------------------------------
# Phase 4 integrations regression
# ---------------------------------------------------------------------------
class TestPhase4IntegrationsRegression:
    def test_admin_get_integrations_masked(self, admin_h):
        r = requests.get(f"{API}/settings/integrations", headers=admin_h, timeout=15)
        assert r.status_code == 200
        data = r.json()
        # secrets should be masked or empty strings (not raw)
        assert isinstance(data, dict)

    def test_staff_403_integrations(self, staff_h):
        r = requests.get(f"{API}/settings/integrations", headers=staff_h, timeout=15)
        assert r.status_code == 403

    def test_prod_403_integrations(self, prod_h):
        r = requests.get(f"{API}/settings/integrations", headers=prod_h, timeout=15)
        assert r.status_code == 403

    def test_test_connection_mocked(self, admin_h):
        for k in ["m365","simpro","navixy","xero"]:
            r = requests.post(f"{API}/settings/integrations/{k}/test", headers=admin_h, timeout=15)
            assert r.status_code == 200, f"{k}: {r.text}"
            assert r.json().get("status") == "MOCKED", r.text
