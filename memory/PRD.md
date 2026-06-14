# Paneltec Group — Product Requirements Document

## Problem Statement
Build a FARM-stack (FastAPI + React + MongoDB) web app for **Paneltec Group**, an Australian precast concrete panel business, in 4 phases. Phase 1 ships the core operating shell: auth, pricing settings, precast panel calculator, user administration, dashboard placeholder.

## Architecture
- **Backend**: FastAPI on port 8001, all routes prefixed `/api`. JWT (HS256, 12h) via `Authorization: Bearer …`. bcrypt for hashes. Motor (async) MongoDB. UUID string IDs.
- **Frontend**: React 19 + react-router 7, Tailwind, shadcn/ui (Button, Input, Label, Select, Switch, Dialog, DropdownMenu, Sonner toasts). Inter font. Left sidebar layout. AUD currency via `Intl.NumberFormat`.
- **Auth model**: token stored in `localStorage["paneltec_token"]`, axios interceptor attaches it; AuthContext + ProtectedRoute (adminOnly support).
- **Print export**: `window.print()` + `@media print` rules in `index.css` (no PDF lib).

## Personas
- **Admin (Operations Manager)** — manages pricing, users, all calculator access.
- **Staff (Estimator)** — uses calculator only; cannot view/edit pricing or users.

## Core requirements (static)
- Currency AUD `$1,234.56`, GST 10% shown as separate line.
- Brand: charcoal `#1F2A33`, steel blue `#3A6B8C`, safety yellow `#F5C518`, bg `#F5F6F7`.
- Mobile responsive ≥ 375px.
- OpenAPI spec at `/api/openapi.json`.

## Implemented (Phase 1 — 2026-06-14)
- JWT auth: `/api/auth/login`, `/logout`, `/me`, `/change-password`.
- User management (admin): list / create / patch (deactivate).
- Pricing settings (admin write, all auth read): editable panel types ($/m² in 3 columns), reinforcement densities, thickness options, concrete grades, finish multipliers, GST rate, concrete density.
- Calculator: `POST /api/calculator/calculate` returns per_panel, totals, cost_breakdown (material/manufacturing/transport_install/finish_premium/subtotal/gst/total_inc_gst). Validation: positive dims, openings < face area, qty ≥ 1.
- Seed: admin + staff users + default pricing, idempotent.
- Frontend: Login, Dashboard (welcome + KPI placeholders + roadmap), Calculator (live results + print), Pricing Settings (editable tables, toast feedback), Users (table + create dialog + activate toggle).
- Print stylesheet hides sidebar/header for clean export.
- Manual acceptance check VERIFIED: Wall Std 150mm, 6×3, qty 1 → $5,623.20 inc GST.

## Backlog (post-Phase 1)
### P0 (Phase 2)
- Customers CRUD
- Quotes (line items, accept/reject, link to calculator output, PDF/email)
### P1 (Phase 3)
- Jobs / production scheduling, materials issued
- Stripe payment links on invoices
### P2 (Phase 4)
- Invoices (Xero-style), aging report
- Fleet / Vehicles, Employees / timesheets
- Real KPIs on dashboard (open quotes, jobs WIP, AR aging)
- Real PDF export via WeasyPrint or pdf-lib
- Password reset email flow

## Files
- Backend: `/app/backend/server.py`, `/app/backend/.env`
- Frontend: `/app/frontend/src/{App.js, index.css, lib/{api,format}.js, contexts/AuthContext.jsx, components/{Layout,ProtectedRoute}.jsx, pages/{Login,Dashboard,Calculator,PricingSettings,Users}.jsx}`
- Memory: `/app/memory/{test_credentials,auth_testing}.md`, `/app/design_guidelines.json`
- Tests: `/app/backend/tests/backend_test.py` (20 pytest, 4s)

## Next Tasks
1. Phase 2: Customer model + CRUD endpoints + UI.
2. Phase 2: Quote model that snapshots a calculator result + line items + PDF export.
3. Wire real KPIs once Customers/Quotes land.

## Phase 2 — Live (2026-06-14)
### Implemented
- **Customers**: full CRUD with AU validation (ABN 11 digits, state from {NSW/VIC/QLD/WA/SA/TAS/ACT/NT}, 4-digit postcode), billing + site addresses, soft-delete when linked records exist, search + pagination, Simpro import button (mocked, Phase 4).
- **Projects**: belong to customer, status lifecycle (planning → quoted → won/lost → completed), inline list on customer detail.
- **Quotes**: Q-YYYY-#### sequence (per calendar year), draft → sent → accepted/rejected/expired, snapshot line items frozen at creation (pricing changes do NOT affect existing quotes), totals re-aggregated from lines, customer + optional project picker.
- **Magic link approvals**: public route `/q/:token`, sanitized read-only view (no internal_notes), Accept/Reject endpoints record IP + UA, single-decision (409 on retry), auto-expire on past `valid_until`.
- **Print view**: `/quotes/:id/print` with branded header, line items, totals, GST line.
- **Dashboard**: real KPIs (drafts/sent/accepted counts, customers active, quoted/accepted this month AUD, recent quotes table).
- **Email sending**: STUBBED — `send` endpoint returns `email_status: "MOCKED"` and a copyable magic link; will integrate M365 in Phase 4.

### Acceptance — 14/14 PASS
All 10 spec criteria plus variants verified by curl harness (`/tmp/test_phase2.py`): ABN validation, soft-delete, line totals math, Q-2026-#### sequence, send→token, public no-auth GET, accept→409 on retry, expired state, frozen snapshot, staff send, dashboard KPIs.

### Backlog (Phase 3+)
- P0 (Phase 3): Jobs/production scheduling, materials issue
- P1 (Phase 4): Invoices, Xero export, Fleet, M365 email sending, Simpro import wire-up, real PDF library

## Phase 3 — Live (2026-06-14)

### Implemented
- **Company Settings** (admin-write, all-read): business identity, AU address, banking (BSB validated XXX-XXX), payment terms, invoice footer.
- **Jobs**: auto-created from accepted quotes (both magic-link accept AND mark-accepted). Linear status flow `scheduled → in_production → ready_for_delivery → delivered → installed → completed` (jumps rejected with 400). `cancelled` allowed from any non-terminal status. Server-enforced. Full `status_history[]` audit log per transition.
- **Vehicles** (`GET /vehicles`) & **Employees** (`GET /employees`) — 5 + 6 mocked records each, hard-coded with `source: MOCKED_NAVIXY|MOCKED_SIMPRO`. Wired into Job assignments (vehicle dropdown, employee multi-select chips).
- **Invoices**: AU Tax Invoice format, `INV-YYYY-####` sequence per year, generated from delivered jobs only (400 otherwise). Lines deep-copied (frozen). `issue` → `mark-paid` → `push-to-xero` (MOCKED) lifecycle. Print view pulls live company settings (no snapshot).
- **Quote polish**: 
  - `POST /quotes/:id/revise` clones a sent/accepted/rejected/expired quote into a new draft, with bidirectional `revised_from_quote_id` / `revised_to_quote_id` lineage.
  - `POST /quotes/:id/send` now returns `email_preview {to, subject, body}` + `magic_link_url`. Modal exposes editable preview with "Copy magic link" / "Copy email content" actions and a yellow MOCKED banner.
  - View tracking: `view_count`, `first_viewed_at`, `last_viewed_at` on public GET. Bot UA (`bot|crawl|spider|preview`) filtered. 60-second same-IP debounce. Displayed in "Customer engagement" card on authenticated quote detail.
- **Dashboard**: added `jobs_by_status`, `jobs_active`, `invoices_draft/issued/paid`, `outstanding_aud`, `paid_this_month_aud`, `recent_jobs`.
- **Auto-progressed demo seed**: `Q-2026-0002` → `J-2026-0001` (delivered) → `INV-2026-0001` (issued) so Phase 3 UI screens have realistic data without manual setup.

### Acceptance — 17/17 PASS
All 12 spec criteria plus variants verified via `/tmp/test_phase3.py`.

### Backlog → Phase 4
- M365 / SendGrid email sending (replace MOCKED preview)
- Real Xero push (replace MOCKED_PUSHED)
- Real Navixy fleet feed (replace `/vehicles` mock)
- Real Simpro HR feed (replace `/employees` mock)
- Real Stripe / payment links on invoices
- PDF library (replace browser print)
- Overdue invoice auto-flagging cron


## Phase 4 Part 1 — Live (2026-06-14)

### Implemented
- **Integration Settings page** (`/settings/integrations`, admin only): 4 cards — Microsoft 365 (Email), Simpro (Customers + Employees), Navixy (Fleet), Xero (Accounting). All credential fields editable inline; `Enabled` switch + `Test Connection` (MOCKED) + `Save` per card; status badge (Not Configured / Configured — Not Wired).
- **Secret masking**: `GET /api/settings/integrations` masks `client_secret` / `api_key` fields as `••••••••XXXX` (last 4 chars). `PUT` preserves the stored secret when the masked value is resubmitted unchanged.
- **MOCKED test endpoints**: `POST /api/settings/integrations/{m365|simpro|navixy|xero}/test` returns `{status:"MOCKED", integration, message}` — no real HTTP fan-out to Microsoft / Simpro / Navixy / Xero (verified by source-scan test).
- **Universal Edit / Email / Print** on Customer, Project (per-row), Job, Invoice, Quote detail pages. Reusable `EmailModal` with MOCKED banner, copy-recipient, copy-content, Mark-as-Sent → POST `/api/{customers|projects|jobs|invoices}/{id}/email-sent` stamps `last_email_sent_at/subject/recipient/by_user_id` and the parent page displays the `📧 Last emailed:` label.
- **Print routes**: `/customers/:id/print`, `/projects/:id/print`, `/jobs/:id/print` (`/invoices/:id/print` and `/quotes/:id/print` already shipped). All branded, AUD-formatted, GST line where applicable, auto-`window.print()`.
- **Existing edit flows preserved**: quote line-item editing, customer detail form, job inline edit, invoice issue/mark-paid all unchanged.

### Acceptance — 100% PASS (Phase 4)
Backend pytest `test_phase4_integrations.py` 15/15 PASS (CRUD, mask preservation, MOCKED test, admin gating, email-sent tracking, no vendor libs imported). Frontend Playwright PASS for admin/staff visibility, 4 cards rendering, M365 mask roundtrip, MOCKED toasts, EmailModal flows, Print buttons.

### Backlog → Phase 4 Part 2 (real wiring)
- Wire **Microsoft 365 Graph API** for real email send (Mail.Send) — needs Azure AD app keys
- Wire **Simpro REST API** for customer + employee import — needs Build Name + OAuth keys
- Wire **Navixy API** for live vehicle feed — needs API key
- Wire **Xero OAuth2** invoice push — needs OAuth handshake + tenant connection
- Replace `/api/vehicles` and `/api/employees` mocks with live feeds
- Replace browser-print with real PDF library (e.g. WeasyPrint) once layouts stabilise
- Audit log of email-sent events surfaced on a dedicated `Comms` tab

