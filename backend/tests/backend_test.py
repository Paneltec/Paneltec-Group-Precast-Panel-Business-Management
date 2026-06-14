"""
Backend regression tests for Paneltec Group API (Phase 1).
Covers: auth (login/me/change-password), users CRUD (admin), pricing settings,
calculator (acceptance check + validation + pricing-bump round trip), openapi.
"""
import os
import copy
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://concrete-panel-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@paneltec.com.au"
ADMIN_PASSWORD = "Paneltec2026!"
STAFF_EMAIL = "staff@paneltec.com.au"
STAFF_PASSWORD = "Staff2026!"


# --------------------- Fixtures ---------------------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token(session):
    return _login(session, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def staff_token(session):
    return _login(session, STAFF_EMAIL, STAFF_PASSWORD)


@pytest.fixture
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture
def staff_headers(staff_token):
    return {"Authorization": f"Bearer {staff_token}", "Content-Type": "application/json"}


# --------------------- Auth ---------------------
class TestAuth:
    def test_login_admin_success(self, session):
        r = session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data and isinstance(data["access_token"], str)
        assert data["user"]["email"] == ADMIN_EMAIL
        assert data["user"]["role"] == "admin"

    def test_login_staff_success(self, session):
        r = session.post(f"{API}/auth/login", json={"email": STAFF_EMAIL, "password": STAFF_PASSWORD})
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "staff"

    def test_login_wrong_password_401(self, session):
        r = session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong-pass-xyz"})
        assert r.status_code == 401

    def test_me_with_token(self, session, admin_headers):
        r = session.get(f"{API}/auth/me", headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_me_without_token_401(self, session):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_change_password_wrong_current_400(self, session, staff_headers):
        r = session.post(
            f"{API}/auth/change-password",
            headers=staff_headers,
            json={"current_password": "definitely_wrong", "new_password": "NewPass1234"},
        )
        assert r.status_code == 400

    def test_change_password_success_and_revert(self, session, staff_headers):
        new_pwd = "TempStaff2026!"
        # change
        r = session.post(
            f"{API}/auth/change-password",
            headers=staff_headers,
            json={"current_password": STAFF_PASSWORD, "new_password": new_pwd},
        )
        assert r.status_code == 200
        # verify new login works
        token2 = _login(session, STAFF_EMAIL, new_pwd)
        # revert
        r = session.post(
            f"{API}/auth/change-password",
            headers={"Authorization": f"Bearer {token2}", "Content-Type": "application/json"},
            json={"current_password": new_pwd, "new_password": STAFF_PASSWORD},
        )
        assert r.status_code == 200


# --------------------- Users mgmt ---------------------
class TestUsers:
    def test_list_users_staff_forbidden(self, session, staff_headers):
        r = session.get(f"{API}/users", headers=staff_headers)
        assert r.status_code == 403

    def test_list_users_admin_ok(self, session, admin_headers):
        r = session.get(f"{API}/users", headers=admin_headers)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list) and len(users) >= 2
        emails = [u["email"] for u in users]
        assert ADMIN_EMAIL in emails and STAFF_EMAIL in emails
        # no _id / no password_hash leak
        for u in users:
            assert "_id" not in u
            assert "password_hash" not in u

    def test_create_user_and_duplicate(self, session, admin_headers):
        email = f"test_user_{uuid.uuid4().hex[:8]}@paneltec-test.com"
        payload = {"email": email, "password": "TestPass1234", "name": "Test User", "role": "staff"}
        r = session.post(f"{API}/users", headers=admin_headers, json=payload)
        assert r.status_code == 201, r.text
        created = r.json()
        assert created["email"] == email and created["role"] == "staff" and created["is_active"] is True
        user_id = created["id"]

        # duplicate -> 409
        r2 = session.post(f"{API}/users", headers=admin_headers, json=payload)
        assert r2.status_code == 409

        # PATCH name + role
        r3 = session.patch(f"{API}/users/{user_id}", headers=admin_headers,
                           json={"name": "Updated Name", "role": "admin"})
        assert r3.status_code == 200
        assert r3.json()["name"] == "Updated Name"
        assert r3.json()["role"] == "admin"

        # PATCH deactivate
        r4 = session.patch(f"{API}/users/{user_id}", headers=admin_headers, json={"is_active": False})
        assert r4.status_code == 200
        assert r4.json()["is_active"] is False

    def test_admin_cannot_deactivate_self(self, session, admin_headers):
        me = session.get(f"{API}/auth/me", headers=admin_headers).json()
        r = session.patch(f"{API}/users/{me['id']}", headers=admin_headers, json={"is_active": False})
        assert r.status_code == 400


# --------------------- Pricing ---------------------
class TestPricing:
    def test_get_pricing_any_auth(self, session, staff_headers, admin_headers):
        # Per Phase 1 acceptance: staff cannot access /settings/pricing — API returns 403.
        r_staff = session.get(f"{API}/settings/pricing", headers=staff_headers)
        assert r_staff.status_code == 403
        r = session.get(f"{API}/settings/pricing", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["gst_rate"] == 10.0
        assert any(p["key"] == "wall_standard" for p in data["panel_types"])

    def test_put_pricing_staff_forbidden(self, session, staff_headers, admin_headers):
        current = session.get(f"{API}/settings/pricing", headers=admin_headers).json()
        # strip server-only keys
        current.pop("updated_at", None)
        r = session.put(f"{API}/settings/pricing", headers=staff_headers, json=current)
        assert r.status_code == 403


# --------------------- Calculator ---------------------
ACCEPTANCE_PAYLOAD = {
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


class TestCalculator:
    def test_acceptance_values(self, session, admin_headers):
        r = session.post(f"{API}/calculator/calculate", headers=admin_headers, json=ACCEPTANCE_PAYLOAD)
        assert r.status_code == 200, r.text
        d = r.json()
        per = d["per_panel"]
        cb = d["cost_breakdown"]
        totals = d["totals"]
        assert per["volume_m3"] == pytest.approx(2.7, abs=0.005)
        assert per["concrete_weight_kg"] == pytest.approx(6750.0, abs=0.5)
        assert per["steel_weight_kg"] == pytest.approx(121.5, abs=0.5)
        assert totals["cost_per_m2"] == pytest.approx(284.0, abs=0.5)
        assert cb["subtotal"] == pytest.approx(5112.0, abs=0.5)
        assert cb["gst"] == pytest.approx(511.2, abs=0.05)
        assert cb["total_inc_gst"] == pytest.approx(5623.2, abs=0.05)

    def test_openings_exceeds_face_400(self, session, admin_headers):
        p = copy.deepcopy(ACCEPTANCE_PAYLOAD)
        p["openings_m2"] = 18.0  # == face area 6*3
        r = session.post(f"{API}/calculator/calculate", headers=admin_headers, json=p)
        assert r.status_code == 400

    def test_length_zero_422(self, session, admin_headers):
        p = copy.deepcopy(ACCEPTANCE_PAYLOAD)
        p["length_m"] = 0
        r = session.post(f"{API}/calculator/calculate", headers=admin_headers, json=p)
        assert r.status_code == 422

    def test_quantity_zero_422(self, session, admin_headers):
        p = copy.deepcopy(ACCEPTANCE_PAYLOAD)
        p["quantity"] = 0
        r = session.post(f"{API}/calculator/calculate", headers=admin_headers, json=p)
        assert r.status_code == 422

    def test_unknown_panel_type_400(self, session, admin_headers):
        p = copy.deepcopy(ACCEPTANCE_PAYLOAD)
        p["panel_type_key"] = "no_such_panel"
        r = session.post(f"{API}/calculator/calculate", headers=admin_headers, json=p)
        assert r.status_code == 400

    def test_pricing_bump_changes_subtotal(self, session, admin_headers):
        # GET original pricing
        original = session.get(f"{API}/settings/pricing", headers=admin_headers).json()
        modified = copy.deepcopy(original)
        modified.pop("updated_at", None)
        # bump wall_standard material by $10
        for p in modified["panel_types"]:
            if p["key"] == "wall_standard":
                p["material_per_m2"] = float(p["material_per_m2"]) + 10.0
        try:
            r = session.put(f"{API}/settings/pricing", headers=admin_headers, json=modified)
            assert r.status_code == 200
            r2 = session.post(f"{API}/calculator/calculate", headers=admin_headers, json=ACCEPTANCE_PAYLOAD)
            assert r2.status_code == 200
            # subtotal should increase by 10 * 18 (net_area) * 1.0 (smooth multiplier) = 180
            new_subtotal = r2.json()["cost_breakdown"]["subtotal"]
            assert new_subtotal == pytest.approx(5112.0 + 180.0, abs=1.0), new_subtotal
        finally:
            # reset
            reset = copy.deepcopy(original)
            reset.pop("updated_at", None)
            rr = session.put(f"{API}/settings/pricing", headers=admin_headers, json=reset)
            assert rr.status_code == 200


# --------------------- OpenAPI ---------------------
class TestOpenAPI:
    def test_openapi_json(self, session):
        r = session.get(f"{API}/openapi.json")
        assert r.status_code == 200
        doc = r.json()
        assert doc.get("openapi", "").startswith("3.")
        assert "/api/auth/login" in doc.get("paths", {})
