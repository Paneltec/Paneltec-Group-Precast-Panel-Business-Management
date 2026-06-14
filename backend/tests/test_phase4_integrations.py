"""
Phase 4 Part 1 backend regression tests for:
- /api/settings/integrations (GET / PUT with mask preservation, admin-only, staff 403)
- /api/settings/integrations/{key}/test (MOCKED)
- /api/{customers|projects|jobs|invoices}/{id}/email-sent
- No real third-party libs imported (msal / xero / requests-to-vendor)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://concrete-panel-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@paneltec.com.au"
ADMIN_PASSWORD = "Paneltec2026!"
STAFF_EMAIL = "staff@paneltec.com.au"
STAFF_PASSWORD = "Staff2026!"

MASK_PREFIX = "••••••••"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_h():
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASSWORD)}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def staff_h():
    return {"Authorization": f"Bearer {_login(STAFF_EMAIL, STAFF_PASSWORD)}", "Content-Type": "application/json"}


# --------------------- Integrations ---------------------
class TestIntegrations:
    def test_get_integrations_admin_ok(self, admin_h):
        r = requests.get(f"{API}/settings/integrations", headers=admin_h)
        assert r.status_code == 200
        data = r.json()
        for k in ("m365", "simpro", "navixy", "xero"):
            assert k in data, f"missing section {k}"

    def test_get_integrations_staff_forbidden(self, staff_h):
        r = requests.get(f"{API}/settings/integrations", headers=staff_h)
        assert r.status_code == 403

    def test_put_integrations_staff_forbidden(self, staff_h):
        r = requests.put(f"{API}/settings/integrations", headers=staff_h, json={
            "m365": {"tenant_id": "x", "client_id": "x", "client_secret": "x", "sender_mailbox": "x@y.com", "enabled": False},
            "simpro": {"build_name": "", "client_id": "", "client_secret": "", "api_base_url": "", "enabled": False},
            "navixy": {"api_key": "", "api_base_url": "https://api.navixy.com/v2", "account_id": "", "enabled": False},
            "xero": {"client_id": "", "client_secret": "", "tenant_id": "", "redirect_uri": "", "enabled": False},
        })
        assert r.status_code == 403

    def test_save_m365_secret_is_masked_on_get(self, admin_h):
        # Save with a real secret ending in 1234
        secret = "SuperSecret1234"
        payload = {
            "m365": {"tenant_id": "tenant-abc", "client_id": "client-xyz", "client_secret": secret,
                     "sender_mailbox": "quotes@paneltec.com.au", "enabled": True},
            "simpro": {"build_name": "", "client_id": "", "client_secret": "", "api_base_url": "", "enabled": False},
            "navixy": {"api_key": "", "api_base_url": "https://api.navixy.com/v2", "account_id": "", "enabled": False},
            "xero": {"client_id": "", "client_secret": "", "tenant_id": "", "redirect_uri": "", "enabled": False},
        }
        r = requests.put(f"{API}/settings/integrations", headers=admin_h, json=payload)
        assert r.status_code == 200, r.text
        saved = r.json()
        assert saved["m365"]["client_secret"] == f"{MASK_PREFIX}1234"
        # plaintext fields preserved
        assert saved["m365"]["tenant_id"] == "tenant-abc"
        assert saved["m365"]["client_id"] == "client-xyz"
        assert saved["m365"]["sender_mailbox"] == "quotes@paneltec.com.au"
        assert saved["m365"]["enabled"] is True
        # reload via GET => still masked, same suffix
        g = requests.get(f"{API}/settings/integrations", headers=admin_h)
        assert g.status_code == 200
        assert g.json()["m365"]["client_secret"] == f"{MASK_PREFIX}1234"

    def test_putting_masked_value_does_not_overwrite(self, admin_h):
        # Step 1: ensure secret ends with 1234 (from previous test); set it deterministically here too
        seed = {
            "m365": {"tenant_id": "tenant-abc", "client_id": "client-xyz", "client_secret": "SuperSecret1234",
                     "sender_mailbox": "quotes@paneltec.com.au", "enabled": True},
            "simpro": {"build_name": "", "client_id": "", "client_secret": "", "api_base_url": "", "enabled": False},
            "navixy": {"api_key": "", "api_base_url": "https://api.navixy.com/v2", "account_id": "", "enabled": False},
            "xero": {"client_id": "", "client_secret": "", "tenant_id": "", "redirect_uri": "", "enabled": False},
        }
        requests.put(f"{API}/settings/integrations", headers=admin_h, json=seed)
        # Step 2: send masked secret back (simulating user re-saving without re-typing)
        masked_payload = {**seed}
        masked_payload["m365"] = {**seed["m365"], "client_secret": f"{MASK_PREFIX}1234", "tenant_id": "tenant-CHANGED"}
        r = requests.put(f"{API}/settings/integrations", headers=admin_h, json=masked_payload)
        assert r.status_code == 200
        saved = r.json()
        # Mask suffix should still be 1234 (stored secret preserved)
        assert saved["m365"]["client_secret"] == f"{MASK_PREFIX}1234"
        # Plaintext change should still apply
        assert saved["m365"]["tenant_id"] == "tenant-CHANGED"

    def test_test_connection_returns_mocked(self, admin_h):
        for k in ("m365", "simpro", "navixy", "xero"):
            r = requests.post(f"{API}/settings/integrations/{k}/test", headers=admin_h)
            assert r.status_code == 200, f"{k}: {r.text}"
            d = r.json()
            assert d["status"] == "MOCKED"
            assert d["integration"] == k

    def test_test_connection_unknown_400(self, admin_h):
        r = requests.post(f"{API}/settings/integrations/unknown/test", headers=admin_h)
        assert r.status_code == 400

    def test_test_connection_staff_forbidden(self, staff_h):
        r = requests.post(f"{API}/settings/integrations/m365/test", headers=staff_h)
        assert r.status_code == 403


# --------------------- Universal email-sent ---------------------
class TestEmailSent:
    def test_customer_email_sent(self, admin_h):
        # pick any customer
        r = requests.get(f"{API}/customers", headers=admin_h)
        assert r.status_code == 200
        items = r.json().get("items") if isinstance(r.json(), dict) else r.json()
        assert items, "no customers seeded"
        cid = items[0]["id"]
        payload = {"subject": "Hello from QA", "recipient": "qa@example.com"}
        r2 = requests.post(f"{API}/customers/{cid}/email-sent", headers=admin_h, json=payload)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["last_email_subject"] == "Hello from QA"
        assert body["last_email_recipient"] == "qa@example.com"
        assert body.get("last_email_sent_at")

    def test_job_email_sent(self, admin_h):
        # find J-2026-0001
        r = requests.get(f"{API}/jobs", headers=admin_h)
        assert r.status_code == 200
        items = r.json().get("items") if isinstance(r.json(), dict) else r.json()
        jid = next((j["id"] for j in items if j.get("job_number") == "J-2026-0001"), items[0]["id"])
        r2 = requests.post(f"{API}/jobs/{jid}/email-sent", headers=admin_h,
                           json={"subject": "Job delivery", "recipient": "site@example.com"})
        assert r2.status_code == 200
        assert r2.json()["last_email_recipient"] == "site@example.com"

    def test_invoice_email_sent(self, admin_h):
        r = requests.get(f"{API}/invoices", headers=admin_h)
        assert r.status_code == 200
        items = r.json().get("items") if isinstance(r.json(), dict) else r.json()
        iid = next((i["id"] for i in items if i.get("invoice_number") == "INV-2026-0001"), items[0]["id"])
        r2 = requests.post(f"{API}/invoices/{iid}/email-sent", headers=admin_h,
                           json={"subject": "Invoice", "recipient": "ap@example.com"})
        assert r2.status_code == 200
        assert r2.json()["last_email_subject"] == "Invoice"

    def test_email_sent_unknown_id_404(self, admin_h):
        r = requests.post(f"{API}/customers/does-not-exist/email-sent", headers=admin_h,
                          json={"subject": "x", "recipient": "x@y.com"})
        assert r.status_code == 404


# --------------------- Mock guarantee ---------------------
class TestNoRealVendorCalls:
    def test_server_source_has_no_vendor_libs(self):
        with open("/app/backend/server.py", "r") as f:
            src = f.read()
        forbidden = ["import msal", "from msal", "xero_python", "graph.microsoft.com",
                     "login.microsoftonline.com", "api.xero.com"]
        # api.navixy.com is allowed only as a default base_url string (not as a network call)
        for needle in forbidden:
            assert needle not in src, f"server.py contains forbidden vendor reference: {needle}"


# --------------------- Auto-progressed flow still alive ---------------------
class TestSeededFlow:
    def test_q_j_inv_chain(self, admin_h):
        rq = requests.get(f"{API}/quotes", headers=admin_h)
        assert rq.status_code == 200
        quotes = rq.json().get("items") if isinstance(rq.json(), dict) else rq.json()
        q = next((x for x in quotes if x.get("quote_number") == "Q-2026-0002"), None)
        assert q is not None and q.get("status") == "accepted"

        rj = requests.get(f"{API}/jobs", headers=admin_h)
        jobs = rj.json().get("items") if isinstance(rj.json(), dict) else rj.json()
        j = next((x for x in jobs if x.get("job_number") == "J-2026-0001"), None)
        assert j is not None and j.get("status") == "delivered"

        ri = requests.get(f"{API}/invoices", headers=admin_h)
        invs = ri.json().get("items") if isinstance(ri.json(), dict) else ri.json()
        inv = next((x for x in invs if x.get("invoice_number") == "INV-2026-0001"), None)
        assert inv is not None and inv.get("status") in ("issued", "paid")


# --------------------- OpenAPI ---------------------
def test_openapi_json_phase4():
    r = requests.get(f"{API}/openapi.json")
    assert r.status_code == 200
    paths = r.json().get("paths", {})
    for p in ["/api/settings/integrations",
              "/api/settings/integrations/{integration}/test",
              "/api/customers/{cid}/email-sent",
              "/api/jobs/{jid}/email-sent",
              "/api/invoices/{iid}/email-sent"]:
        assert p in paths, f"missing OpenAPI path: {p}"
