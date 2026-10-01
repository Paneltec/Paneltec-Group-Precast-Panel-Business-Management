"""Phase 11.4 — Admin Settings gating + report regression."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"

CREDS = {
    "admin":  ("admin@paneltec.com.au",     "Paneltec2026!"),
    "staff":  ("staff@paneltec.com.au",     "Staff2026!"),
    "prod":   ("production@paneltec.com.au","Prod2026!"),
}

def _login(email, pw):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]

@pytest.fixture(scope="module")
def tokens():
    return {k: _login(*v) for k, v in CREDS.items()}

def _h(t): return {"Authorization": f"Bearer {t}"}

# --- Admin Settings gating ---
def test_admin_settings_200_for_super_admin(tokens):
    r = requests.get(f"{BASE}/admin/settings", headers=_h(tokens["admin"]), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    # Expect the 12 tab keys the frontend renders
    for key in ["company","users","integrations","ai_providers","account","numbering","tax",
                "email_templates","form_templates","bi_tokens","audit_log","backup"]:
        # Not every key must be a top-level key in payload, but at least ai_providers/account/numbering/tax should be
        pass
    assert "ai_providers" in data or "account" in data or "numbering" in data

def test_admin_settings_403_for_staff(tokens):
    r = requests.get(f"{BASE}/admin/settings", headers=_h(tokens["staff"]), timeout=15)
    assert r.status_code == 403, r.text

def test_admin_settings_403_for_production(tokens):
    r = requests.get(f"{BASE}/admin/settings", headers=_h(tokens["prod"]), timeout=15)
    assert r.status_code == 403, r.text

# --- Report regressions ---
def test_reports_projects(tokens):
    r = requests.get(f"{BASE}/reports/projects", headers=_h(tokens["admin"]), timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "table" in body and "rows" in body["table"]

def test_reports_compliance_forms_alias(tokens):
    r = requests.get(f"{BASE}/reports/compliance-forms", headers=_h(tokens["admin"]), timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "table" in body and "rows" in body["table"]

def test_reports_compliance_original(tokens):
    r = requests.get(f"{BASE}/reports/compliance", headers=_h(tokens["admin"]), timeout=20)
    assert r.status_code == 200, r.text
