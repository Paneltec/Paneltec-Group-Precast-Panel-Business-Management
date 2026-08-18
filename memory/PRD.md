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



## Phase 5 — Live (2026-06-14)

### Implemented
- **Granular permissions**: `ALL_PERMISSIONS` = 33 perms across 11 modules (customers/projects/quotes/jobs/invoices/vehicles/employees/pricing/company/integrations/users). New user model: `is_super_admin` (bool), `permissions` (dict), `role_label` (free-text), `must_change_password`, `last_login_at`, `created_by_user_id`, `updated_by_user_id`. Legacy `role` field still written for one release.
- **`require_permission(key)` dependency** wired onto every business endpoint (32 routes). Super admins bypass; non-supers checked against `permissions[key]`. Elevated set (`users.manage`, `integrations.edit`, `pricing.edit`, `company.edit`) is reserved for super admins — server rejects setting them on a non-super via POST/PATCH `/api/users` with 400.
- **`GET /api/permissions/catalogue`**: returns `{modules, all_permissions, elevated_permissions, presets}` so the frontend builds the checkbox grid + preset buttons dynamically (Estimator / Production / Accounts / Read-only + Clear-all).
- **Login flow**: stamps `last_login_at`, returns 401 `"Account deactivated"` for inactive users, returns enriched user payload (`is_super_admin`, `permissions`, `role_label`, `must_change_password`, `last_login_at`).
- **Force-password-change gate**: `get_current_user` dependency raises 403 `{detail: {code: "password_change_required", message}}` for everything except `/auth/me`, `/auth/logout`, `/auth/change-password`. Frontend axios interceptor catches that code and hard-redirects to `/force-password-change`.
- **User management UI** (`/users`, `users.view` to read, super-admin-only to write): table with search + Active/Inactive filter, super-admin badge, last-login, active toggle (disabled on self). Create/edit dialog with full permission grid grouped by module, "Select all in module" master, 4 quick presets + Clear-all, super-admin warning checkbox, force-password-change checkbox (default on for new users), inline Reset Password (returns temp pwd once).
- **Self-service `/account` page**: any logged-in user can update display name and password (current-password verification). Email + role_label read-only. Permission summary chips show what they can do; super admins see a banner instead.
- **Last-admin safety**: server returns 400 when demoting/deactivating the only active super admin, and 400 when a user tries to deactivate or remove their own super-admin flag.
- **Seed user added**: `production@paneltec.com.au` / `Prod2026!`, role_label="Production", Production preset, `must_change_password=false`. Now 3 access levels demo-able (Super Admin / Estimator / Production).
- **Idempotent migration**: on every startup, seeded users are re-aligned with the current preset (so adjusting `PERMISSION_PRESETS` in code propagates immediately). Other existing users get their new fields back-filled if missing.
- **UI gating**: sidebar items filtered by `hasPerm(item.perm)`. `ProtectedRoute` supports `permission` prop; direct navigation to a forbidden route renders the dedicated 403 page (`/app/frontend/src/pages/Forbidden.jsx`) with the required permission shown. Action buttons (Issue/Mark Paid/Push-Xero on Invoices; Advance/Cancel/Generate Invoice on Jobs) are hidden when the user lacks the corresponding permission.
- **Print layout fix (bonus)**: all five print routes (`/quotes|invoices|jobs|customers|projects/:id/print`) already mount OUTSIDE the main `<Layout>` route group, so no sidebar/header in print. Strengthened `index.css` `@media print`: `@page { size: A4; margin: 15mm; }`, forces `html, body { width: 100%; margin: 0 }`, resets `.print-container` (and any nested `.max-w-3xl/4xl/5xl`) to full width — verified all five routes render at container_w == doc_w == 100% under print emulation.

### Acceptance — 100% PASS (12/12 Phase 5 criteria)
Backend pytest `test_phase5_permissions.py` 35/35 PASS in ~17s — covers migration, estimator/production/accounts gating, force-password-change flow, last-admin safety, elevated-perm guard, catalogue, self-service /me, reset-password, last_login_at, deactivated-user login, plus regressions for Phase 1 calculator ($5,623.20), Phase 3 quote→job→invoice chain, Phase 4 integrations.
Frontend Playwright (7/7) PASS — estimator hides Pricing/Company/Integrations/Users, direct nav renders 403 forbidden-page, /account renders correctly, /users renders the full permission grid + presets for super admin.

### Endpoints added in Phase 5
- `GET  /api/permissions/catalogue`
- `PATCH /api/users/me`
- `POST /api/users/{id}/reset-password`
- Login response payload now includes `is_super_admin`, `permissions`, `role_label`, `must_change_password`, `last_login_at`.

### Backlog → Phase 6
- Audit log of permission/role changes (who changed what, when).
- Granular project-level access controls (currently only module-level).
- Email-based password reset (today only super-admin can reset).
- 2FA / TOTP for super admins.
- Split `server.py` (~1840 lines) into routers + services.
- Reset stale Phase 1 `TestPricing::test_get_pricing_any_auth` (fixed in iteration 2 but recurred — flagged by testing agent).


## Phase 5+ Delete Users — Live (2026-06-14)

### Implemented
- **Soft delete**: `DELETE /api/users/{id}` (`users.manage`) sets `deleted_at`, `deleted_by_user_id`, `is_active=false`. Soft-deleted users are excluded from default `GET /api/users` (`?status=active`), cannot log in (generic 401 message "Invalid email or password" — no existence leak), and fail the JWT bearer check.
- **Hard delete**: `DELETE /api/users/{id}?permanent=true` (super-admin only). Server runs `_count_user_references(user_id)` across quotes.created_by, jobs.status_history.by_user_id, invoices.created_by, customers/projects/users created_by/updated_by/deleted_by. If ANY reference → 400 with `{message, references, suggestion}`. Otherwise hard-deletes the document.
- **Restore**: `POST /api/users/{id}/restore` (`users.manage`) — clears `deleted_at`/`deleted_by_user_id`, sets `is_active=true`. Rejects if another active user now owns the email.
- **References preview**: `GET /api/users/{id}/references` (super-admin) returns `{user_id, email, name, references:{quotes_created, jobs_modified, invoices_created, customers_created, projects_created, user_records_referenced}, total}` — used by the UI to disable Permanently Delete before the request.
- **List filter**: `GET /api/users?status=active|inactive|deleted|all` (default `active`). Active count of super admins for last-admin safety also excludes soft-deleted.
- **Safety**: cannot delete yourself; cannot delete the last active super admin; non-super-admin cannot hard-delete (`users.manage` is super-only by Phase 5 elevated guard, so this is enforced upstream).
- **UI**: `/users` table now has 4-state filter (Active/Inactive/Deleted/All), a Trash icon per row (soft delete with confirmation modal), Restore + Permanently buttons in the Deleted view, an email-typing confirmation modal for permanent delete that fetches refs first and disables itself when refs > 0. Soft-deleted rows render with `(deleted)` in red italic and `opacity-60`.

### Acceptance — 10/10 PASS (curl smoke + UI)
Backend curl 16/16 (incl. setup): soft delete + restore + login block + self-protection + last-super safety + hard-delete reference breakdown + clean hard delete + status filter. Frontend Playwright: 4 filter buttons render, Delete buttons appear on 17 active rows, Deleted view shows `(deleted)` tags + Restore + Permanently buttons for 3 test rows.

### Endpoints added
- `DELETE /api/users/{id}` (soft, `users.manage`)
- `DELETE /api/users/{id}?permanent=true` (hard, super-admin only, ref-check guarded)
- `POST /api/users/{id}/restore` (super-admin restores supers; `users.manage` for regulars)
- `GET /api/users/{id}/references` (super-admin)
- `GET /api/users?status=active|inactive|deleted|all` extended



## Phase 6 Pass 4 — List Page Delete UI + Bulk Xero Push (2026-06-14)

### Implemented
- **DeleteRowActions wired into 4 list pages**: CustomersList, QuotesList, JobsList, InvoicesList. Each row has a Trash icon (active view, gated by `<entity>.delete` permission), and in the Deleted view a Restore button + Permanently button (super-admin only).
- **Lifecycle filter** (`?lifecycle=active|deleted|all`, default `active`) on Quotes, Jobs, Invoices (`data-testid="lifecycle-filter"`).
- **4-state status filter** on Customers (`active|inactive|deleted|all`, default `active`, `data-testid="status-filter"`).
- **`(DELETED)` badge** rendered next to the identifier on every list page when `deleted_at` is set; the row is shown at `opacity-60`.
- **Projects sub-list (CustomerForm)**: each project row now has DeleteRowActions wired (`entity="projects"`). Soft delete refetches the list automatically.
- **Bulk Xero Push UI on InvoicesList** (requires `invoices.push_xero` perm):
  - Header checkbox (select-all, with indeterminate state) + per-row checkbox (hidden on soft-deleted rows).
  - Sticky bottom action bar (`data-testid="bulk-xero-action-bar"`) showing live selection count + Clear button + "Push to Xero" CTA.
  - Confirmation modal: warns when any selected invoice has `xero_push_status="MOCKED_PUSHED"`, lists prior-push timestamps per invoice, exposes a "Force re-push" toggle. Without Force, prior-pushed invoices are SKIPPED; with Force, they are pushed again.
  - Result modal: 3 summary cards (Pushed / Skipped / Errored) plus a per-invoice list with status icons and mock Xero IDs.

### Self-tested (7/7 PASS via Playwright/screenshot)
1. Lifecycle filter dropdown present on all 4 list pages.
2. 4-state status filter on Customers.
3. Trash icons gated by permission — staff (estimator) sees delete on Quotes (15 rows) but not on Jobs/Invoices.
4. Soft-delete dialog confirms → row disappears from Active → reappears in Deleted with DELETED badge.
5. Restore dialog returns row to Active view.
6. Permanently delete shows refs (when present) and disables Confirm button until identifier is typed; hidden from non-super-admins.
7. Bulk Xero: no-force push of 3 already-pushed invoices → 0 pushed, 3 skipped; force push of the same 3 → 3 pushed with new mock IDs. Clear button removes the action bar.

### Files touched
- `/app/frontend/src/pages/CustomersList.jsx` (4-state filter + DeleteRowActions + Actions col)
- `/app/frontend/src/pages/QuotesList.jsx` (lifecycle filter + DeleteRowActions + Actions col)
- `/app/frontend/src/pages/JobsList.jsx` (lifecycle filter + DeleteRowActions + Actions col)
- `/app/frontend/src/pages/InvoicesList.jsx` (lifecycle filter + DeleteRowActions + Bulk Xero UI: checkboxes, sticky bar, confirm + result modals)
- `/app/frontend/src/pages/CustomerForm.jsx` (DeleteRowActions per project row)

### Deferred to Phase 6 Pass 5
- Polished audit drawer (right-side drawer) + date-range filter.
- Recent Activity widget on super-admin dashboard.
- `(deleted)` / "Unknown user" badges on detail pages (created_by, status_history references).
- Standalone `/projects` page (still accessed via CustomerForm projects sub-list).


## Phase 6 Pass 5 — Audit Drawer Polish + Activity Widget + (deleted) Badges + Xero KPI (2026-06-15)

### Implemented
- **Audit page** (`/admin/audit`) — Dialog replaced with right-side **Sheet drawer** (~520 px). Drawer renders large action badge, absolute + relative timestamp, actor row with initials avatar, entity row with **Open <entity>** button (disabled w/ tooltip "Record no longer exists" if entity hard-deleted), pretty diff section (object diffs `{added, removed}` → green `+key` / red `−key`; scalar diffs `{from, to}` → strike-through red → arrow → green; long values truncate w/ hover tooltip), metadata section with light UA parsing.
- **URL-bound filters** on audit page — `?action=&entity_type=&search=&date_from=&date_to=&page=&focus=`. Default date range is last 30 days. **Clear dates** button resets the range. Page is shareable/bookmarkable. `?focus=<event_id>` auto-opens that drawer (used by dashboard widget links).
- **Recent Activity widget** on Dashboard (super-admin / `audit.view` gated) — "Today: …" summary line of non-zero action counts (`No activity yet today` when empty); last 10 events as compact rows; click row → `/admin/audit?focus=<id>` opens the drawer; "View all →" link.
- **Invoices awaiting Xero push** KPI card on Dashboard (`invoices.view` gated) — large count, click navigates to `/invoices?xero_push_status=pending` with the filter pre-applied.
- **`xero_push_status` filter** on `/invoices` — both backend (`?xero_push_status=pending|pushed|all`, default `all`) and UI dropdown + URL-synced state.
- **`<UserBadge user={u}/>`** component — single source of truth for user-reference rendering: `name` for active, `name (deleted)` muted italic for soft-deleted, `Unknown user` muted italic for hard-deleted, `—` for null. Wired into QuoteDetail header (`created_by_user`), JobDetail status_history rows (`by_user`), InvoiceDetail header (`created_by_user`).
- **Server-side user-ref population** — added `populate_user_refs(doc, fields)` helper + `_resolve_user_lite(uid)` (with per-request cache). Applied to `GET /api/quotes/{id}`, `GET /api/jobs/{id}` (incl. each `status_history` entry), `GET /api/invoices/{id}`, `GET /api/customers/{id}`, `GET /api/projects/{id}`. Each user-id field gets a sibling `<field>_user` of shape `{id, name, email, is_deleted, exists}`.

### New / changed endpoints
- `GET /api/audit/recent?limit=10` (`audit.view`) — returns `{items, today_summary, today_start}`. `today_summary` is a dict of non-zero action counts since UTC midnight.
- `GET /api/invoices` — adds `xero_push_status: all|pending|pushed` (default `all`). `pending` is defined as `status=issued AND xero_push_status NOT IN [MOCKED_PUSHED, PUSHED]`.
- `GET /api/dashboard/kpis` — adds `invoices_awaiting_xero_push: int`.
- `GET /api/{quotes|jobs|invoices|customers|projects}/{id}` — response shape now includes resolved `*_user` reference fields.

### Self-tested (10/10 PASS via Playwright)
1. Drawer is right-side (`audit-detail-drawer` exists, header structure rendered) ✓
2. Date range filter present; URL updates with `?date_from=…` ✓ (verified `URL after date filter: ...?date_from=2026-06-01&page=1`)
3. "Open <entity>" button present in drawer with valid entity (existence check via `ENTITY_FETCH` map) ✓
4. PrettyDiff renders scalar + added/removed cases (component verified) ✓
5. Super-admin Dashboard shows `recent-activity-card` + `xero-pending-kpi-card` (`summary="Today: 5 logins · 1 deletion"`, `xero_count="0"`) ✓
6. Quote detail `Created by Ref User (DELETED)` rendered correctly (test user is soft-deleted) ✓
7. Job status_history: first entry shows `by Unknown user` (magic-link author is missing → exists:false) ✓
8. `?xero_push_status=pending` filter shows correct empty list ✓ + KPI card clickable
9. Backend filter verified: `/api/invoices?xero_push_status=pending` returns 0; `/api/invoices?xero_push_status=pushed` returns 3 ✓
10. No regressions detected (0 console errors / 0 page errors across navigation) ✓

### Files touched
- `/app/backend/server.py` (helper + user-ref wiring + new endpoint + KPI + invoices filter)
- `/app/frontend/src/components/UserBadge.jsx` (new)
- `/app/frontend/src/pages/Audit.jsx` (rewrite for Sheet drawer + date filters + URL sync + PrettyDiff + UA parser)
- `/app/frontend/src/pages/Dashboard.jsx` (Recent Activity + Xero KPI cards)
- `/app/frontend/src/pages/InvoicesList.jsx` (xero_push_status URL filter + dropdown)
- `/app/frontend/src/pages/QuoteDetail.jsx`, `JobDetail.jsx`, `InvoiceDetail.jsx` (UserBadge integration)

### Phase 6 — COMPLETE
Next: Phase 7 — Pricing model upgrade (Cost vs Sell + labour per panel type & finish + margin display on calculator and quote builder).



## Phase 7 — Pricing Upgrade Complete (2026-06-15)

### Pass 1 (backend foundation, zero-leak verified) + Pass 2 (frontend UI)

**New permission**: `pricing.view_costs` (under `pricing` module; OFF in all presets; super-admin bypasses).

**Pricing settings cost fields** (defaults seeded; idempotent backfill on startup):
- Globals: `concrete_cost_per_m3=180`, `steel_cost_per_kg=1.50`, `transport_cost_per_m2=25`, `overhead_pct=12`
- Per panel type `manufacturing_labour_per_m2`: 35 / 42 / 40 / 32 / 65 / 55
- Per finish `finishing_labour_per_m2`: 5 / 18 / 20 / 15 / 25

**Calculator**: response now returns `internal_cost_breakdown` block (key chosen to avoid collision with the pre-existing sell-side `cost_breakdown`). Block contains concrete / steel / mfg-labour / finishing-labour / transport / subtotal / overhead / total / margin / margin_pct. Stripped when caller lacks perm.

**Quote line snapshot**: 9 frozen cost fields per line (`cost_concrete_aud`, `cost_steel_aud`, `cost_manufacturing_labour_aud`, `cost_finishing_labour_aud`, `cost_transport_aud`, `cost_overhead_aud`, `total_cost_aud`, `margin_aud`, `margin_pct`) + quote-level rollups (`total_cost_aud`, `margin_aud`, `margin_pct`).

**Zero-leak strip** at 4 surfaces (with helper `_strip_internal_costs_from_quote`):
- `POST /api/calculator/calculate` — strips `internal_cost_breakdown` without perm
- `GET /api/quotes/{id}` and `GET /api/quotes` — strip top-level + line-item cost/margin fields
- `GET /api/public/quotes/by-token/{token}` — `_public_quote` whitelists fields with explicit "PHASE 7 ZERO-LEAK GUARANTEE" comment

**Dashboard KPIs**: `quoted_margin_this_month_aud` + `quoted_margin_this_month_pct` (weighted by subtotal across sent/accepted, current month) — absent for users without perm.

**Frontend UI**:
- Pricing Settings → 2-tab layout with **Sell Prices** + **Cost Inputs (internal)** (yellow banner + 4 cost globals + per-type labour + per-finish labour)
- Calculator → `InternalCostPanel` with lock icon, full breakdown table, colour-coded margin pill (green ≥30, amber 15-30, red <15)
- Quote detail → `InternalMarginCard` collapsible (closed by default) with per-line and rollup margin, same colour rules
- Dashboard → 2 KPI cards (`Quoted margin` + `Avg margin %`) — colour-coded

**Regression fix (bundled in Pass 1)**: "Something went wrong" misleading error on Add Line modal — the catch handler now surfaces `ex.message` when the exception isn't an axios response (e.g. `Error("Pick a customer first")`).

### Self-tested 10/10 PASS
1. Pricing tabs visible; Cost Inputs tab with banner + 180/1.5/25/12 defaults ✓
2. Calculator (admin): margin $3,053.16 / 59.7% **green** pill — all 9 numbers exactly match brief ✓
3. Calculator (estimator): cost panel + margin pill **absent from DOM** ✓
4. Quote detail (admin): collapsible card renders with sell $5,112 / cost $2,058.84 / margin $3,053.16 / 59.7% ✓
5. Quote detail (estimator): margin card **absent from DOM** ✓
6. Quote print view: no cost/margin words or test-ids in rendered HTML ✓
7. Public magic-link (no auth): zero `cost_*` / `margin_*` / `internal_cost_breakdown` keys — curl-verified in Pass 1 ✓
8. Dashboard (admin): both margin KPI cards visible; estimator dashboard: **absent** ✓
9. Colour coding live-verified: 59.7% green, 6.2% red ✓
10. No regressions: $5,623.20 Phase 1 total intact; bulk Xero, delete modals, public magic-link accept all unaffected ✓

### Files touched
- `/app/backend/server.py` (Pass 1: permission + defaults + migration + models + compute + snapshot + rollup + strips at 4 surfaces + dashboard KPIs)
- `/app/frontend/src/pages/PricingSettings.jsx` (tabbed UI + Cost Inputs tab)
- `/app/frontend/src/pages/Calculator.jsx` (InternalCostPanel + margin pill colour gating)
- `/app/frontend/src/pages/QuoteDetail.jsx` (InternalMarginCard collapsible)
- `/app/frontend/src/pages/Dashboard.jsx` (margin KPI row)
- `/app/frontend/src/pages/QuoteEditor.jsx` (Add Line error message regression fix)

### Phase 7 — COMPLETE


## In-app User Manual (2026-06-15)

- New route `/help` (any logged-in user) — two-pane layout (sticky TOC + scrollable Markdown), substring search highlight, "Print Manual" docked-popup at `/help/print`.
- Sidebar shows new "Help" link at the bottom (above Logout); `BookOpen` icon.
- Single source of truth: `/app/frontend/src/content/user-manual.md` — Markdown rendered via `react-markdown`.
- Sections 1–16 cover the full shipped scope (Phases 1–7), with §14 listing what's still MOCKED and §16 a chronological change log.

### Process rule (enforced going forward)
**User manual updates: every new phase MUST include a corresponding update to `/app/frontend/src/content/user-manual.md`, bump the App version + "Manual last updated" line in §16, and add a change-log entry.** The reminder lives at the top of `/app/frontend/src/pages/Help.jsx` (every dev touching the manual sees it) — NOT inside the markdown, because the markdown is end-user facing. A defensive regex strip in `Help.jsx`/`HelpPrint.jsx` removes any stray HTML comments before render.


## Phase 11 — Form Template Builder + Hold Points + Enhanced Compliance Reports (2026-06-22)

### Pass 2 — Template Builder UI
- Wired `/forms/templates` and `/forms/templates/:id` routes; gated by `forms.template_manage`.
- Added "Form Templates" sidebar entry (admin-only).
- Refactored `FormsList` "+ New Form" modal to fetch `GET /api/compliance-templates?active_only=true` and POST to `/compliance-forms/from-template` — no more hardcoded PRE/POST/CERT radio.
- `TemplateEditor.jsx`: full inline editor with up/down section + criterion reorder (no `@dnd-kit` dependency), key/label/type/required/photo toggles, header fields editor, save bumps `version` and re-publishes.
- System templates render with read-only banner: "clone to edit".
- Cloning produces semantic `_vN` suffix (`PRE → PRE_v2 → PRE_v3`).

### Pass 3 — Hold Points + Enhanced Reports + Dashboard tile
- Backend `_transition_job_internal` extended with `enforce_holdpoints`, `force`, `force_reason`, `is_super_admin`. Seed code path passes `enforce_holdpoints=False`.
- HOLD_POINT_RULES: `in_production → ready_for_delivery` (Pre-Pour), `ready_for_delivery → delivered` (Post-Pour), `delivered → installed` (CERT).
- Block returns 400 with structured `{code:"hold_point_block", blockers:[...], transition:{...}}`. Override requires super admin + reason ≥5 chars; logged as `hold_point_override` audit event.
- New `GET /api/jobs/{id}/holdpoints` preview endpoint.
- `_report_compliance` extended: Hold-Point compliance %, NCR rate, avg sign-off latency days, photo coverage %; new "missing_by_stage" chart.
- `/api/dashboard/kpis` adds `compliance_health_pct`, `_satisfied`, `_expected` (gated on `forms.view`).
- Frontend: Dashboard "Compliance health · last 30 days" tile (green/amber/red bands).
- Frontend: `ReportDetail` compliance branch renders the 4 KPIs + 2 charts (forms-by-month + missing-by-stage).
- Frontend: `JobDetail` intercepts hold-point 400, surfaces a dialog with blocker list; super-admin sees inline override form.

### Manual updates
- §18 expanded with §18.5 (new compliance report KPIs) + §18.6 (Form Templates how-to).
- New §19 — Hold Points & Inspection Workflow.
- §16 changelog entry + APP_VERSION bumped to "v1.0 · Phase 11".
- Layout footer version label updated.

### Self-tested AC's (all PASS)
1. AC1 — Templates list at `/forms/templates`: 3 system + custom ✓
2. AC2 — Clone PRE → semantic `PRE_v2` ✓
3. AC3 — TemplateEditor renders; system template read-only ✓
4. AC4 — Compliance report shows hold-point %, NCR, latency, photo coverage ✓
5. AC5 — Dashboard tile renders colour-coded % ✓
6. AC6 — Transition blocked when forms unsigned; super-admin override with audit ✓
7. AC7 — "+ New Form" modal fetches dynamic active templates ✓
8. AC8 — Staff GET /compliance-templates → 403; POST → 403 ✓

### Files touched
- `/app/backend/server.py` (hold-points helper + transition update + JobTransition fields + dashboard KPI + compliance report KPIs + seed bypass)
- `/app/frontend/src/App.js` (templates routes)
- `/app/frontend/src/components/Layout.jsx` (nav + version label)
- `/app/frontend/src/pages/TemplateEditor.jsx` (NEW)
- `/app/frontend/src/pages/FormsList.jsx` (dynamic templates fetch)
- `/app/frontend/src/pages/Dashboard.jsx` (compliance health tile)
- `/app/frontend/src/pages/ReportDetail.jsx` (compliance KPIs + charts)
- `/app/frontend/src/pages/JobDetail.jsx` (hold-point dialog + force override)
- `/app/frontend/src/pages/Help.jsx` (APP_VERSION bump)
- `/app/frontend/src/content/user-manual.md` (§18 expansion + §19 + changelog)

### Phase 11 — COMPLETE

## Phase 11.1–11.6 + Deployment Hardening — Live (2026-08-07)

### Phase 11.1 — Export NCR Pack
- Endpoint `GET /api/compliance-forms/ncr-export/preview` + `POST /api/compliance-forms/ncr-export` returns a ZIP bundle of non-conformance report PDFs for a date range, with optional recipient/email delivery.
- Wired into the Compliance report detail view via a new "Export NCR Pack" action.

### Phase 11.2 — Reports tile banners
- Each tile on `/reports` renders a scoped, dynamic banner image sourced from the app-shell asset set (no hardcoded URLs).

### Phase 11.3 — Row-level Edit / Delete / Lock on Report tables
- New shared component `ReportRowActions.jsx` provides Edit / Delete (soft) / Lock/Unlock buttons on every report row, gated by per-user permissions.
- Locked rows cannot be edited/deleted by anyone except a super admin.
- Compliance report includes the same actions PLUS AI standards check hooks.
- Bulk-select soft-delete UX shipped on all list-style reports.
- Audit trail report is intentionally excluded — events are immutable.

### Phase 11.4 — Simpro LIVE integration + Admin Settings (Super Admin only)
- Simpro integration promoted from MOCKED → LIVE-capable. Client-credentials sync endpoints for customers + employees. Falls back gracefully to manual roster if disabled or credentials missing.
- New page `/admin/settings` (Super Admin only) with 14 functional tabs:
  Company Details • Users & Roles • Integrations • AI Providers • Web Search (Tavily) • Compliance Standards • Account • Numbering • Tax • Email Templates • Form Templates • BI Tokens • Audit Log • Backup & Export.

### Phase 11.5 — AI Providers "Connect account" flows
- OpenAI + Anthropic + Google Gemini + Gemini Nano Banana all wire through the new Admin Settings AI Providers tab.
- API-key connection mode + Google OAuth2 flow. Verify-and-store, disconnect, and `active_text_provider` / `active_image_provider` election.
- Self-heal migration `_heal_active_ai_providers()` runs on every startup and promotes an already-connected provider if no active_*_provider is set (fixes orphan-connection state introduced before the auto-elect code existed).

### Phase 11.6 — AI Compliance Standards Check
- New service `services/ai_compliance.py`. Tavily web search across curated AU standards domains → LLM prompt with strict citation requirement → returns proposed clause additions / edits.
- New endpoint `POST /api/admin/compliance/ai-check` (mode=update|generate). Existing templates are NEVER overwritten — AI outputs create a new `status: "ai_draft"` document.
- UI `AIStandardsCheckModal.jsx` with radio-card template picker, in-modal progress panel (4 client-timed steps), abort-controller Cancel, and a persistent error panel with contextual hints (429 / quota / invalid-key / Tavily failure).
- Rate limit: 20 runs / super-admin / rolling hour (in-memory sliding window). Rate-limit reset on backend restart.

### Deployment hardening (2026-08-07)
- **Blocker #1 (Seed hygiene)**: `SEED_MODE=prod` refuses to seed unless every `SEED_*_PASSWORD` env var is set. Newly-inserted seed users get `must_change_password: True`. Startup emits `[security]` warning if the well-known default password is still in use on any seeded account.
- **Blocker #2 (Login brute-force)**: `POST /api/auth/login` gated by a sliding-window rate limiter — 5 failed attempts per 15-minute window per (IP, email) → HTTP 429; plus a 15-second per-IP micro-cooldown to slow scripted attackers. Every 429 emits a `login_rate_limited` audit event.
- **Blocker #3 (CORS lockdown)**: `CORS_ORIGINS="*"` combined with `allow_credentials=True` is refused at startup in prod mode. Comma-separated origin list is now the canonical form. Missing value defaults to `http://localhost:3000` with a warning.
- **Blocker #4 (Production serving)**: `serve` added as a dep; new `serve:prod` script; new `/app/supervisor.production.conf` template with uvicorn `--workers 4 --no-server-header --proxy-headers` (no `--reload`) and `serve -s build` for the frontend.
- Fixed pre-existing double registration of `_cf_p3` router that produced 4 `Duplicate Operation ID` warnings on every boot.
- Added `AUDIT_ACTIONS` catalogue entry for `login_rate_limited`.
- New docs: `/app/DEPLOY.md` (Phase A→F ops walkthrough), `/app/backend/.env.example`, `/app/frontend/.env.example`.

### Key files touched (Phase 11.1–11.6 + hardening)
- `/app/backend/server.py` — rate limiter, seed hygiene, CORS lockdown, router dedup, audit action.
- `/app/backend/services/ai_compliance.py` — Tavily + LLM orchestration.
- `/app/backend/integrations/simpro_client.py` — LIVE Simpro client.
- `/app/frontend/src/components/AIStandardsCheckModal.jsx` — AI check UI.
- `/app/frontend/src/components/ReportRowActions.jsx` — row actions.
- `/app/frontend/src/components/PasswordInput.jsx` — eye-toggle for all password fields.
- `/app/frontend/src/pages/AdminSettings.jsx` — 14-tab admin dashboard.
- `/app/frontend/src/pages/ReportDetail.jsx` — bulk-select soft-delete.
- `/app/frontend/src/pages/TemplatesList.jsx` — AI check entry point.
- `/app/frontend/src/pages/Login.jsx` — PasswordInput + build marker.
- `/app/frontend/src/pages/ForcePasswordChange.jsx`, `Account.jsx` — PasswordInput fields.
- `/app/frontend/src/components/icon-map.json` — Customers → Handshake, Users → Person raising hand.
- `/app/frontend/src/content/user-manual.md` — §11, §14, §17, §18.4, §18.5 updates.

### Phase 11 + hardening — COMPLETE

### Phase 11.7.4 — Mock/demo data hard-purge (2026-08-08)
- Sweep script `/app/backend/scripts/purge_mock_data.py` — matches `source ^MOCKED_*` / `[SEED|MOCK|DEMO]` note tags / `example.com|demo.paneltec|test.local` emails / `is_seed=True` / mock-prefixed IDs across every business collection.
- Executed once with `--confirm`; backup at `/app/backend/backups/pre-purge-2026-08-08T06-03-11.342221+00-00.json` (71 KB).
- Consolidated audit event `system_purge_mock_data` (id `f8246f29-…`) with per-collection counts + backup file path.
- Deleted: 6 employees, 5 vehicles, 5 compliance_form_templates (AI drafts). All customer / project / quote / job / invoice tables were already clean. Re-run reports "Nothing to purge — already clean."

### Phase 11.7.5 — Simpro Position Filter, per-company (2026-08-08)
- Backend: `IntegrationSimpro.position_filter` typed as `Dict[str, List[str]]` (keyed by str(company_id)). `_coerce_position_filter` helper normalises any legacy list-form value to `{}` on read. `SimproSyncEmployeesPayload` gains `apply_position_filter: bool = True`. `_matches_position_filter(section, company_id, role, apply)` is applied in both `POST /api/integrations/simpro/preview-employees` and `.../sync-employees`. Preview returns `applied_position_filter` + `filtered_by_position_count`; sync returns `applied_position_filter` + `skipped_by_position` and includes both in the audit metadata.
- Frontend `IntegrationSettings.jsx`: new `SimproPositionFilterPerCompany` accordion — one collapsible section per configured `company_id`, each with its own ChipInput. Section headers show either `CO <id>` or `<name> (CO <id>)` when a company name has been learned via LIST modal or Test Connection. Empty-state chips-row hint: "No filter — all positions from this company will be imported." Orphan filter entries are pruned on save.
- Frontend `SimproEmployeeImportModal.jsx`: new "Apply position filter for the selected companies" checkbox (default ON), wired to both preview + sync calls. Per-company breakdown shown when at least one company has a filter configured. Preview count now reports "N filtered by position" when the filter is active.

### Phase 12.3 — Stock Excel parser overhaul + embedded images + category-grouped list (2026-08-18)
Delivered against the standing "no testing agent" rule. Manual curl + screenshot verification only.

**Backend** — `/app/backend/server.py`
- `_parse_reid_excel_bytes` now header-driven: scans the first 15 rows for tokens matching Part No / Description / Pack weight / Pack qty / Price per / Sell Price ea, and maps `unit_price` **strictly to Sell Price ea** (never Price per). Falls back to fixed B–G layout only if no header row is found.
- Category-header detection preserved (row with only the Part No column populated).
- New helper `_extract_reid_images(data)` opens the .xlsx as a zip, walks `xl/drawings/drawingN.xml` + its `.rels`, and returns `{anchor_row_index: [(bytes, ext), …]}`. Handles both `../media/imageN.ext` and `/xl/media/imageN.ext` Target formats.
- Each parsed row scans anchors within ±2 rows of its own row for a matching image; first hit wins and is written to `/app/backend/uploads/stock/<sanitised_part_number>.<ext>`. `image_url` is set to `/api/stock/image/<file>`.
- New public route `GET /api/stock/image/{filename}` (no auth — public catalogue image), with path-traversal guard.
- Parser response now includes `images_extracted`, `images_missing`, `header_row`, `columns`, `debug_pairings` (first 5).
- `/api/stock/import-excel/confirm` no longer wipes an existing `image_url` on re-import when the incoming row lacks one.

**Frontend** — `/app/frontend/src/pages/Stock.jsx`
- Rows grouped by `category` with a **sticky orange banner** (`#F97316`, white uppercase bold, item count pill on the right). Category rows use `iconForCategory()` (keyword rules covering chains/lifting/rigging/spacers/ferrules/bolts/screws/rebar/braces/forms/sealants/grout/precast → package fallback).
- New columns **Pack qty** and **Pack wt (kg)** between Supplier and Unit price.
- Product images now render as real `<img>` from `image_url` (prefixed with `REACT_APP_BACKEND_URL`), 48×48, `object-cover`, rounded border. Fluent Emoji category icon still used as the fallback when no `image_url`.
- Import preview modal now shows Pack qty / Pack wt / Sell price ea columns + Images extracted vs Images missing counts.

**Icons added** — `/app/frontend/src/components/icon-map.json`
- `chains`, `link`, `donut` (Doughnut), `nut_and_bolt`, `screw` (Screwdriver), `chair`, `hammer`, `straight_ruler`, `spray_bottle`, `oil_drum`, `building_construction`, `stock` (Package).

**Verified**
- Synthetic 4-row Reid-style .xlsx: parser correctly maps `unit_price = 3.20` from Sell Price ea (not `1.50` from Price per), captures pack_qty (50) and pack_weight (0.35), and extracts the embedded 1×1 PNG at anchor row 2 → paired to `RLA-100` at Excel row 3 (delta 0). See debug pairing:
  `{'part_number':'RLA-100','excel_row':3,'anchor_row':2,'delta':0,'image_file':'RLA-100.png','bytes':68}`
- `GET /api/stock/image/RLA-100.png` returns `HTTP 200 · image/png` publicly.
- Stock UI screenshot confirms orange banner + category icon + pack columns rendering.

**PAT untouched.** No `testing_agent_v3` invoked.

### Phase 12.4 — Deeper Excel fidelity + sortable per-group headers (2026-08-18)
Manual curl + screenshot verification only. Simpro PAT untouched. No testing_agent invoked.

**Source file inspected**: `Reid Price List Peltzer Con.xlsx` — 528 rows × max col F, single sheet, 79 embedded twoCellAnchor images across 76 media files.

**Full column dump** (first 40 rows) confirmed the sheet uses **only 6 columns** (A empty, B–F = data), with **17 header re-declarations** mid-sheet. Row 1's header uses `Pack qty` at col E; every other header uses `Price per` at col E. Row 500's header has a blank Sell Price cell. Attribute values (WLL / length / bar-size / etc.) are baked into the description text — no hidden columns.

**Backend rewrites** (`/app/backend/server.py`)
- `_extract_reid_images` now returns `(anchors, stats)` — anchors carry `from_row`, `to_row`, kind, ext, size, media_path (sorted by row asc, size desc). Stats include `anchor_count`, per-kind counts, `media_files`, and the size histogram (<10 KB / 10–100 KB / >100 KB / skipped_unsupported_ext).
- Handles `twoCellAnchor`, `oneCellAnchor`, `absoluteAnchor`. Skips `.emf` / `.wmf` (logs count).
- `_parse_reid_excel_bytes` re-detects header rows anywhere mid-sheet and **merges** the new mapping — old keys are retained UNLESS their column index is re-bound to a different meaning. This is the fix for row 500 where the sell_price mapping would otherwise be dropped.
- Category-header detection now strips whitespace before treating cells as populated — this is the fix for the `Ramset™ FaceLifters` row (col F held a single space that broke the earlier check).
- Row-image pairing rebuilt: prefers anchors whose `[from_row..to_row]` range CONTAINS the item row (so all items under a shared category image get the same image); falls back to a ±5-row nearest-anchor search only if no range match.
- New description miner `_mine_description` extracts `wll_tonnes` (from `10t WLL`, `1.3t x …`), `length_mm` (from `x 125mm`), `diameter_mm` (from `Ø25` or `25mm dia`), `bar_size` (from `RB16`, `RBA20`, `N12` etc.).
- `StockItemIn` schema + confirm-import doc extended with `wll_tonnes`, `length_mm`, `diameter_mm`, `bar_size`, `alt_part_number`.

**Live re-import against the real file**
- Parsed: **357 rows** (from 528, discarding blanks + 17 headers + 70 category rows)
- Valid: **329** · Needs review: **28** · Header re-declarations detected: **16**
- Populated: unit_price **341** / pack_qty **20** / pack_weight **308** / wll_tonnes **69** / length_mm **191** / bar_size **75** / diameter_mm **1** / image_url **330**
- Images written: **326** distinct part files from **79 anchors** and **76 media files**. Size distribution: small `<10KB` **11**, medium `10–100KB` **58**, large `>100KB` **1**. Skipped .emf/.wmf: **0**.
- Sample debug pairing (real file):
  `{'part_number':'FL050125B','excel_row':18,'anchor_from_row':18,'anchor_to_row':21,'range_contains_row':True,'image_file':'FL050125B.png','bytes':56999,'kind':'twoCell'}`
- Import confirm: **350 created + 7 updated** = 357 rows persisted with real prices, images, and mined attributes.

**Frontend rewrites** (`/app/frontend/src/pages/Stock.jsx`)
- Each category now renders as: **[orange sticky banner + category icon + item count pill] → [grey sticky sub-header row echoing all column labels] → [item rows]**. Both the top thead and the per-group sub-header are visually anchored.
- All six sortable columns (Part number · Description · Pack qty · Pack wt · Unit price · On hand) now carry a `<SortHeader>` control:
  - Neutral state → faint `ChevronsUpDown`
  - Active asc → `ChevronUp` at full opacity
  - Active desc → `ChevronDown` at full opacity
  - Click cycle: asc → desc → clear
- Sort is bound to URL params `?sort=…&dir=…` and is **applied within each category group only** — categories themselves never reorder (kept in original supplier sheet order, then alphabetically for ties).
- Active sort surface: a "SORT: <col> ▲/▼" pill in the filter bar next to the item-count pill.
- Item rows now render **description chips** for mined attributes: blue `Xt WLL`, emerald `XXmm`, slate `RB16` — so the sheet's baked-in metadata is visible without extra columns.

**Verified via screenshots**
- `/stock?q=SwiftLift`: three category groups stack with orange banner + repeated grey sub-header. Real product photos rendered (clutches, void formers, combination anchors). WLL / length chips visible on every anchor row.
- `/stock?q=Combination&sort=unit_price&dir=desc`: unit-price header shows the active down chevron, sort badge reads "SORT: UNIT PRICE ▼", and the 5 rows in the "REID™ SWIFTLIFT™ COMBINATION ANCHORS" group render in descending price order: $7.70 → $6.77 → $5.25 → $2.15 → $1.69.

### Phase 12.5 — Pack qty backfill fix (2026-08-18)
Manual curl + screenshot. Simpro PAT untouched. No testing_agent.

**Root cause**: Reid's Excel has 17 header re-declarations. Only row 1 uses `Pack qty` in col E; every subsequent header (rows 32, 64, 121, 146, 177, 208, 239, 269, 296, 327, 359, 380, 408, 439, 469, 500) labels the same column as `Price per`. Inspection of the DATA in those sections proves the label is a misnomer: values are integer pack quantities (1, 5, 10, 20, 40, 50, 75, 100, 200, 250) — the same semantic column as the row-1 "Pack qty". Verified with sample math on `1FA045H` (pw=9 kg / col-E=200 → 45 g each, matches a 45 mm foot anchor).

**Fix**: Aliased `priceper` / `priceperkg` / `priceperunit` into the `pack_qty` label set (`_STOCK_LABELS['pack_qty']`) and dropped the standalone `price_per` key. Header re-declarations now bind col E to `pack_qty` regardless of whether Reid printed "Pack qty" or "Price per".

**Result**:
| Metric | Before | After |
|---|---|---|
| Parser rows with pack_qty | 20 | **344** |
| DB rows with non-null pack_qty | 17 | **338** |
| Total rows in DB | 350 | 350 |

**Four user-cited rows** (SwiftLift 3Dx 10 Tonne section) after fix:
| Part No | pack_weight | pack_qty | unit_price |
|---|---|---|---|
| 3DX10A   | 255.0 ✓ | 250 ✓ | $13.13 ✓ |
| 3DX10ALC | 4.1 ✓   | 1 ✓   | $1,250.25 ✓ |
| 3DX85VF  | 1.80 ✓  | 10 ✓  | $21.97 ✓ (parser); DB shows $36.61 because Reid lists the same part in the "Narrow Edgelift 8 Tonne" section with different pricing — upsert-by-part_number keeps the later occurrence |
| 3DX85NP  | 0.60 ✓  | 6 ✓   | $37.25 ✓ (parser); DB shows $37.24 for the same duplication reason |

**Files changed**: `/app/backend/server.py` (`_STOCK_LABELS` + `_detect_header_row`).

**Not touched**: user's Simpro PAT.

### Phase 12.6 — Supplier per-brand assignment + banner-level Supplier UI (2026-08-18)
Manual curl + screenshot. Simpro PAT untouched. No testing_agent.

**Backend** — `/app/backend/server.py`
- `POST /api/stock/import-excel/confirm` now builds a case-insensitive `brand → supplier_id` map from the `suppliers` collection once per request, then resolves each row's supplier from its parsed `brand`. Falls back to the payload `supplier_id` (or the Reid supplier) when a row lacks a brand.
- Confirm response includes a `supplier_counts` breakdown (`{brand: rows}`) so the UI/import summary can surface the split.
- `_parse_reid_excel_bytes` now keeps `current_brand` sticky across "umbrella" category rows that don't name a brand (e.g. "Erection & Installation", "Structural Reinforcing Systems"), preventing the previously-detected brand from being wiped.

**Frontend** — `/app/frontend/src/pages/Stock.jsx`
- Removed the `Supplier` column entirely (top thead + per-group sub-header + all data `<td>`s).
- Added supplier text to the orange category banner in the format
  `[icon] <CATEGORY> · <Supplier> · <N items>`.
  Category name stays white uppercase bold; supplier is white/85 medium normal-case with a `·` separator; item pill unchanged.
- The banner supplier is derived from the group's rows: if all rows share a single `supplier_id` → that supplier's name; if multiple → `Multiple`; if no supplier_id but a single distinct `brand` → the brand string; otherwise blank.
- Sort options unchanged (Supplier never was in the SORT_COLS map, so no change needed there).

**Live re-import result**
- Supplier assignment counts: **Reid 353 · Ramset 4 · Peltzer Con 0**
- Curl verification of the 4 Ramset FaceLifters:
  ```
  FL050125B | category=Ramset™ FaceLifters | brand=Ramset | supplier=Ramset  ✓
  FL050150B | category=Ramset™ FaceLifters | brand=Ramset | supplier=Ramset  ✓
  FL050175B | category=Ramset™ FaceLifters | brand=Ramset | supplier=Ramset  ✓
  FL050200B | category=Ramset™ FaceLifters | brand=Ramset | supplier=Ramset  ✓
  ```
- Whole-DB distribution: Reid **346**, Ramset **4** (some part numbers are repeated across Reid/Ramset sections; upsert-by-part_number kept the last, hence 346 not 353).
- UI verified via DOM: header labels are `['Part number', 'Description', 'Pack qty', 'Pack wt (kg)', 'Unit price', 'On hand']` — no Supplier column at any level.
- Banners rendered as `'Ramset™ FaceLifters·Ramset4 items'` and `'Reid™ SwiftLift™ FaceLifters·Reid4 items'`.

### Phase 12.7 — "Add from Stock" browser modal on Quote editor (2026-08-18)
Manual curl + screenshot. Simpro PAT untouched. No testing_agent.

**Backend** — `/app/backend/server.py`
- `QuoteLineInput` extended with `line_type: "panel"|"stock"` (default `panel`) and optional `unit_price`. Panel dims (`panel_type_key`, `length_m`, `height_m`, `thickness_mm`, `concrete_grade`, `reinforcement_type`, `finish_key`) are now `Optional` in Pydantic but the panel builder still validates them (422 if any missing).
- New `build_stock_quote_line(payload, pricing)` skips the calculator: `subtotal = unit_price × qty`, `gst = subtotal × gst_rate%`, `total = subtotal + gst`. All panel-specific fields set to `None`/`0.0` so `recompute_totals` handles the sum cleanly. `line_type: "stock"` on the persisted line.
- `build_quote_line` routes stock payloads to the pass-through builder.
- New `POST /api/quotes/{qid}/lines/batch` — accepts `{ items: [QuoteLineInput...] }` and appends each line to the draft in one write. Returns `{added, failed, results, totals}` with per-item OK/error so the UI can preserve failed picks for retry.

**Frontend**
- **NEW** `/app/frontend/src/components/StockPickerModal.jsx` — 6xl dialog. Header with search (200 ms debounce), category dropdown, brand chips (All / Reid / Ramset / Genuine / Peltzer Con) and a live count pill. Body table grouped by category with sticky orange banner (identical layout to `/stock`) + grey sub-header. Per-row checkbox + qty spinner (focusing the qty input auto-selects the row). Footer with live tally `N items selected · $X.XX ex GST` and primary "Add N items to quote". On partial failure the modal stays open with only the failed rows still ticked; on full success it closes and toasts.
- `/app/frontend/src/pages/QuoteEditor.jsx` — new yellow "Add from Stock" button next to "Add line" (visible only with `stock.view`). Line-items table now handles stock rows: renders a `Stock` chip in the description cell, "Stock item" placeholder in the panel column, `—` for L×H, hides the Edit button (delete still available). Mounts `StockPickerModal` when a quote id exists (draft has been ensured).

**Backend contract additions live-verified via curl**
```
POST /api/quotes/{qid}/lines/batch
  payload: 3 Ramset FaceLifters × qty=5 @ $10.82–10.84 each
  response: { added: 3, failed: 0, totals: { subtotal: 162.40, gst: 16.24, total: 178.64 } }
```
Panel add still works unchanged: `POST /api/quotes/{qid}/lines` with `panel_type_key=wall_standard 6×3×150 …` → `total_volume_m3 = 2.7, subtotal_aud = 5112.0, total_aud = 5623.20` (matches Phase 1 sanity check).

**Screenshots**
- **Modal open** — brand chip set to Ramset, 4 rows ticked with the top row's qty bumped to 10. Footer reads `4 items selected · $140.70 ex GST` (10×$10.82 + $10.82 + $10.84 + $10.84 = $140.70 ✓) and primary button reads `Add 4 items to quote`.
- **Quote after add** — 4 new stock rows appear with Ramset supplier, "Stock" chip in description, "Stock item" in the panel column, correct subtotals (`$108.20`, `$10.82`, `$10.84`, `$10.84`) and totals inc GST. Running totals recomputed: `Subtotal $5,415.10 · GST $541.50 · Total inc GST $5,956.60`. Toast "Added 4 items to quote." confirmed top-right.

Existing typeahead single-line flow inside "Add line" is unchanged.

### Phase 12.8 — Supplier column removed from Quote lines table (2026-08-18)
Manual curl + screenshot. Simpro PAT untouched. No testing_agent.

**Files changed**
- `/app/frontend/src/pages/QuoteEditor.jsx` — removed the `<th>Supplier</th>` and its per-row `<td>{l.supplier_name_override}</td>`. Header is now `Part no. · Description · Panel · L × H · Qty · Subtotal · Total`. To preserve at-a-glance traceability on stock rows, the supplier now appears as a small muted hint (`Supplier: <name>`) directly under the description text (only for stock lines that carry a `supplier_name_override`).

**Verified**
- `/app/frontend/src/pages/Stock.jsx` — no per-row Supplier column (removed in Phase 12.6). `supplier` filter dropdown in the filter bar retained as requested.
- `/app/frontend/src/components/StockPickerModal.jsx` — no per-row Supplier column. Supplier text appears only on the orange category banner (Phase 12.7).
- Backend model unchanged: `supplier_id` and `supplier_name_override` continue to be persisted on every stock line for the customer PDF and internal traceability.
- Live DOM check: header labels = `['Part no.', 'Description', 'Panel', 'L × H', 'Qty', 'Subtotal', 'Total']`; body cells containing exactly `"Ramset"` = **0**.

### Phase 12.9 — Discoverable Delete + stock-line dedup by part_number (2026-08-18)
Manual curl + screenshot. Simpro PAT untouched. No testing_agent.

**Backend** — `/app/backend/server.py`
- Added `_find_existing_stock_line_idx(lines, part_no)` — returns the index of an existing stock line with a matching part_number, else `None`.
- Added `_increment_stock_line_qty(line, delta_qty, pricing)` — bumps qty and recomputes subtotal / GST / total for the line in place.
- `POST /api/quotes/{qid}/lines` — for stock payloads with a `part_number`, merges into any existing matching stock line instead of appending. Response gains an `action: "created" | "updated"` marker. Panel lines are unaffected.
- `POST /api/quotes/{qid}/lines/batch` — dedups per-item, returns `{added, updated, failed, results[], totals}` (`results[i].action` is `"created"` or `"updated"` when successful).

**Frontend** — `/app/frontend/src/pages/QuoteEditor.jsx`
- Replaced `window.confirm(...)` with a shadcn **AlertDialog** — title `"Remove <part_number OR panel-type L×H> from this quote?"`, muted description, Cancel + red **Delete line** action.
- Trash button restyled from hover-only ghost → always-visible red pill (`bg-red-50 border-red-200 → hover:bg-red-600 text-white`). Rendered on every row (stock and panel) via `rootHasPerm("quotes.edit")`. Edit pencil remains panel-only.
- New `lineLabelFor(line)` helper composes a friendly line identifier for the confirm modal.

**Frontend** — `/app/frontend/src/components/StockPickerModal.jsx`
- Toast on batch success now composes `Added N new items, updated M existing quantities.` based on the new response counts. Failure path still returns the failed rows to the picker for retry.

**Curl verification (fresh quote 10cd3163-3c7a-4344-8c0d-f6dd29acfa69)**
```
1) Single add:  FL050125B qty=5   → action=created,  qty=5,   subtotal $54.10
2) Single add:  FL050125B qty=3   → action=updated,  qty=8,   subtotal $86.56   (5+3, 8 × $10.82)
3) Batch: [FL050125B qty=2, FL050150B qty=7]
              → added=1  updated=1  failed=0
              → FL050125B qty=10, FL050150B qty=7
4) Two panel adds — same 6×3×150 Wall Standard, qty=1 each
              → both kept as separate rows (panels not deduped)

Final quote:
  stock  | FL050125B     | qty=10 | subtotal 108.20
  stock  | FL050150B     | qty= 7 | subtotal  75.74
  panel  | wall_standard | qty= 1 | subtotal 5112.00
  panel  | wall_standard | qty= 1 | subtotal 5112.00   ← intentionally NOT merged
```

**Screenshots delivered**
- Quote line-items view showing a red trash button on every row (`Delete buttons rendered: 4 / expected 4`).
- Confirm modal open on FL050125B: `Remove FL050125B from this quote?` + Cancel / red "Delete line".

### Phase 12.10 — Typable qty inputs on StockPicker + bulk-set-qty helper (2026-08-18)
Manual curl-free screenshot verification. Simpro PAT untouched. No testing_agent.

**Files changed**
- `/app/frontend/src/components/StockPickerModal.jsx`
  - Row qty is now stored as a **string** in `picks[id]` so an in-progress empty value survives keystrokes (previously `parseInt(..., 10) || 1` snapped the field back to `1` the moment the user cleared it, blocking typing "25" cleanly).
  - `onChange` accepts any string; `onBlur` (`commitQty`) normalises empty/invalid to `"1"`; `onFocus` auto-selects the current value so typing replaces cleanly.
  - Payload builder in `doAdd` coerces each string to a positive integer with a `1` fallback at submit time.
  - `runningTotal` re-computed from the string values.
  - Attributes tightened: `type="number" inputMode="numeric" min={1} step={1}` and `w-20 tabular-nums`.
  - **New bulk-set helper** in the footer next to the tally: appears only when ≥1 row is picked. `SET ALL TO [___]` numeric input + **Apply** button (Enter also submits). Sets the same qty on every ticked row and toasts `Set qty N on M rows.`

**Verified via Playwright DOM script**
```
Value after Ctrl+A + Delete: ''            ← was previously snapping to '1'
Value after typing '375':    '375'
Tally after typing:         '3 items selected · $4,079.16 ex GST'
                              (= 375 × $10.82 + 1 × $10.82 + 1 × $10.84 ✓)
Qty values after bulk-set to 50: ['50', '50', '50']
Tally after bulk-set:       '3 items selected · $1,624.00 ex GST'
```

**QuoteEditor single-line entry** — no code change required. The existing `NumF` "Quantity" input in the Add-line dialog (line ~587, `data-testid="line-qty"`) is a standard `<Input type="number" step="1" min="1">` with `onChange={e => onChange(e.target.value)}` — already fully typable. Confirmed by inspection.

**Screenshots delivered**
- Modal with `QTY = 375` typed into FL050125B (proven typed, not spinner-clicked), tally correct.
- Modal with all 3 ticked rows bulk-set to `50`, "Set qty 50 on 3 rows." toast visible.

### Phase 12.11 — Nested-pic image extraction + row supplier hint removal (2026-08-18)
Manual curl + screenshot. Simpro PAT untouched. No testing_agent.

**Bug 1 root cause**: Reid wraps some product photos in `<xdr:grpSp>` (group shapes) rather than placing an `<xdr:pic>` directly inside the anchor. My extractor only looked for a direct `<xdr:pic>` child, so ~27 anchors (SwiftLift 3Dx, JAWS, Foot Anchors, Erection & Install shape-groups) came back with no picture, and 27 rows never received an image_url. Discovered by dumping raw XML around row 2 (`3DX10A`) — the anchor contains `<xdr:grpSp>` → `<xdr:pic>` → `r:embed="rId57"`.

**Bug 1 fix** (`/app/backend/server.py`, `_extract_reid_images`):
```python
pic = anch.find("xdr:pic", ns)
if pic is None:
    pic = anch.find(".//xdr:pic", ns)   # nested inside <xdr:grpSp> etc.
```
Also widened the fallback radius for rows outside any anchor range from ±5 to **±20** — the Foot Anchors section has genuine ~8-row gaps between the section header's group image and its item rows, so the wider net lets every item borrow the section image.

**Bug 1 numbers**:
| Metric | Before | After |
|---|---|---|
| Parser images extracted | 326 | **353** |
| DB rows with image_url | 326 | **350 (100%)** |
| Rows without image | 24 | **0** |

Spot-checks (curl):
```
3DX10A       → /api/stock/image/3DX10A.png       HTTP 200 · 16 228 B · image/png   ← previously missing
5FA075       → /api/stock/image/5FA075.png       HTTP 200 · 5 407 B · image/png    ← previously missing
10FA150      → /api/stock/image/10FA150.png      HTTP 200                          ← previously missing
ANTCAP M12   → /api/stock/image/ANTCAP_M12.png   HTTP 200 · 9 850 B · image/png    ← red cap now renders
```

Screenshot delivered: `/stock?q=ANTCAP` now shows all 4 antennae caps with real product images (M12 red cap, M16/M20/M24 render too — image content per Reid's overlapping anchors).

**Bug 2 fix** (`/app/frontend/src/pages/QuoteEditor.jsx`):
Removed the muted `Supplier: <name>` hint div that Phase 12.8 had kept under the description on stock lines. Stock rows now show only the Stock chip + description text; supplier is not surfaced anywhere in the row. Backend fields `supplier_id` and `supplier_name_override` still persisted for the PDF renderer.

DOM check on the quote lines table: `'Supplier:' present in lines body: False`. Screenshot shows only description + `Stock item` panel column, no supplier text.

**Not touched**: user's Simpro PAT.

### Phase 12.12 — Removed redundant supplier chunk from category banners (2026-08-18)
Manual screenshot verification. Simpro PAT untouched. No testing_agent.

**Files changed**
- `/app/frontend/src/pages/Stock.jsx` — removed `{catSupplier && (…)}` chunk from the orange banner. The `catSupplier` derivation logic stays in place (still used to detect the "Multiple" edge case internally, but no longer rendered).
- `/app/frontend/src/components/StockPickerModal.jsx` — same removal in the picker's group banner.

**Retained**: the Supplier filter dropdown on the `/stock` filter row (still useful for filtering across categories by supplier).

**DOM verification** — banner text now reads:
```
Stock page:      'Reid™ Narrow edgelift anchor - 8 Tonne4 items'
                 'Reid™ SwiftLift™ 3Dx™ Lifting System - 10 Tonne1 item'
Picker modal:    'Ramset™ FaceLifters4 items'
                 'Reid™ SwiftLift™ FaceLifters4 items'
```
(no "Reid"/"Ramset" between the category name and the item count).

**Not touched**: user's Simpro PAT. No `testing_agent_v3`.

### Phase 12.13 — Project combobox (typable, inline-create) on Quote editor (2026-08-18)
Manual curl + screenshot. Simpro PAT untouched. No testing_agent.

**Backend** — `/app/backend/server.py`
- `ProjectCreate` gains `code`, `location`, `notes` optional fields and switches to `extra="ignore"`. `ProjectUpdate` mirrors those + drops `extra="forbid"`.
- `POST /api/projects` now writes an audit event `project_created` with metadata `{project_id, project_name, customer_id, customer_name}`. Retained the existing `require_permission("projects.create")` RBAC gate.
- Endpoint still returns the fully-populated project doc so the frontend can set it as selected without a refetch.

**Frontend**
- **NEW** `/app/frontend/src/components/ProjectCombobox.jsx` — typable dropdown that mirrors the Reid "combobox with create" pattern:
  - Input filters `projects[]` by case-insensitive substring on `project_name` OR `code`.
  - When the trimmed input has no exact match, a bottom **`Create "<typed>"`** row appears (green folder icon).
  - Clicking Create → `POST /api/projects` with `{customer_id, project_name}` → toast + auto-select the new project + push it into the parent's `projects` array via `onCreated`.
  - Existing selection is preserved while the user edits ("dirty" flag) — only replaced when they pick from the menu or hit Enter/Create.
  - `Enter` on an exact match picks; `Enter` when Create is offered creates.
  - Guards: Create disabled with tooltip "Select a customer first" when `customerId` is empty; Create disabled with tooltip "Ask an admin to create the project first" when the user lacks `projects.create` (chip `no perm` shown).
  - Clear (X) button when a project is currently selected.
- `/app/frontend/src/pages/QuoteEditor.jsx` — replaced the `<Select>` on the Project field with `<ProjectCombobox …/>`. `onCreated` pushes the new project into the local `projects` array so subsequent lookups find it without a fresh network hit.

**Curl verification (fresh customer)**
```
POST /api/projects  {customer_id: <cust>, project_name: "Peltzer Yard Extension <ts>"}
  → 201 {id, project_name, status: "planning", customer_id: <cust>}
GET  /api/customers/<cust>/projects  → new project appears in the list  ✓
```

**Screenshot flow captured (three states)**
1. Combobox open with `Create "Marina Precinct Stage 3"` as the only option.
2. Toast `Project "Marina Precinct Stage 3" created.` after clicking Create; the project is now the selected value.
3. Reopening the combobox and typing `Marina` shows the just-created project (highlighted with the yellow selection border, PLANNING status pill) AND a bottom `Create "Marina"` option for a different new name — proves the new project is now discoverable in subsequent lookups without a refresh.

**Not touched**
- Backend Simpro / Stock / any unrelated modules.
- User's Simpro PAT (the current test customer has no Simpro settings doc; PAT persistence path unchanged).
- Deployment/env files.
- No `testing_agent_v3`.

### Phase 12.14 — Quote-detail line actions + qty × unit formula everywhere (2026-08-18)
Manual curl + screenshot. Simpro PAT untouched. No testing_agent.

**Audit of quote-line rendering surfaces**
| Surface | Path | Before this pass | Notes |
|---|---|---|---|
| Quote editor  | `/quotes/:id/edit`   | ✅ trash+edit (Phase 12.9), ❌ no formula | internal — fix formula |
| Quote detail  | `/quotes/:id`        | ❌ no actions,  ❌ no formula          | internal — **GAP**, add both |
| Print/PDF     | `QuotePrint.jsx`     | (read-only)                            | customer-facing — leave clean |
| Magic-link    | `PublicQuote.jsx`    | (read-only)                            | customer-facing — leave clean |

**Files changed**
- `/app/frontend/src/pages/QuoteDetail.jsx`
  - Added imports: `Trash2`, `Edit2`, `useAuth`, `AlertDialog*`.
  - Added `hasPerm("quotes.edit")` gate; edit+trash column shown **only when the quote is a `draft` AND the user has `quotes.edit`** (protects sent/accepted/rejected quotes from destructive edits from the detail page).
  - Edit pencil → navigates to `/quotes/:id/edit`. Trash → confirm modal (`AlertDialog`) → `DELETE /api/quotes/:id/lines/:lineId` → reloads the quote.
  - Added `data-testid="line-formula-{id}"` muted subtitle under each description: `<qty> × <rate> = <subtotal>`. Rate = `unit_price_aud` for stock lines; `subtotal / qty` for panel lines. AUD locale formatted.
- `/app/frontend/src/pages/QuoteEditor.jsx`
  - Added the same `qty × rate = subtotal` subtitle under each description with `data-testid="editor-line-formula-{id}"`. Existing trash+edit unchanged.

**Not touched**
- `QuotePrint.jsx` and `PublicQuote.jsx` (customer-facing surfaces — remain clean, no formula, no actions).
- Backend endpoints (existing `DELETE /api/quotes/{qid}/lines/{lineId}` reused).
- User's Simpro PAT.

**Live DOM verification on `/quotes/10cd3163-…/`**
```
Detail delete buttons: 4  (was 0 before)
Detail edit buttons:   4  (was 0 before)
Formulas rendered:
  10 × $10.82 = $108.20
   7 × $10.82 = $75.74
   1 × $5,112.00 = $5,112.00
   1 × $5,112.00 = $5,112.00
```

### Phase 12.15 — Stock line edit modal + per-quote price override (2026-08-18)
Manual curl + screenshot. Simpro PAT untouched. No testing_agent.

**No backend schema changes** — the existing `PATCH /api/quotes/{qid}/lines/{line_id}` already routes stock payloads to `build_stock_quote_line`, which honours the caller-supplied `unit_price`. Verified:
```
PATCH /quotes/{qid}/lines/{lid}  {line_type:"stock", quantity:3, part_number:"FL050125B", unit_price:7.50}
  ⇒ quantity=3  unit_price_aud=7.5  subtotal=22.50  total=24.75  ✓
```

**Files changed**
- **NEW `/app/frontend/src/components/StockLineEditModal.jsx`** — reusable modal:
  - Read-only description block for context.
  - Qty (typable, min 1, blur-normalised).
  - Unit price (typable AUD, `$` prefix).
  - Fetches the current catalogue price via `GET /api/stock/typeahead?q=<part_number>` on open. When the entered price differs (>$0.005), an amber "Overridden from $X.XX" pill appears + a "Reset to catalogue" button + a computed `X.X% off` (or `X.X% above catalogue`) helper. When matched, a small green "Matches catalogue price" note is shown instead.
  - Zero-price warning banner ("won't contribute to total") when the user drops price to 0.
  - Live `qty × price = subtotal` preview under the fields.
  - Save disabled while price is negative/non-finite or qty<1.
  - `PATCH` with `line_type:"stock"`, description, qty, part_number, stock_item_id, supplier_id, supplier_name_override, unit_price. Toasts `Line updated.`
- **`/app/frontend/src/pages/QuoteEditor.jsx`**
  - Enabled edit pencil on stock rows (yellow pill, `data-testid="edit-stock-line-{id}"`), previously only shown on panel rows.
  - New `stockCatalogPriceMap` state fetched on mount for every distinct stock part_number in the quote; `isOverridden(line)` compares against the map.
  - Added subtle `OVERRIDDEN` chip in the description cell next to the `STOCK` chip when a row's price differs from catalogue.
  - Mounted `<StockLineEditModal>` next to the picker modal.
- **`/app/frontend/src/pages/QuoteDetail.jsx`**
  - On draft quotes with `quotes.edit`, the edit pencil on stock rows now opens the same modal in-place (instead of navigating to the editor). Panel rows still navigate to the editor.
  - Mounted `<StockLineEditModal>`.

**Screenshots delivered**
- Editor row (before opening modal): `FL050125B` shows `STOCK` + `OVERRIDDEN` chips, formula `3 × $7.50 = $22.50`, total `$24.75`. `FL050150B` (matches catalogue) has NO overridden chip.
- Modal open on `FL050125B` with `Qty=3`, price typed to `$8.50`. DOM confirms: pill `Overridden from $10.82`, discount `21.4% off`, subtitle `3 × $8.50 = $25.50`. `Reset to catalogue` button visible next to the pill.

**Not touched**
- Backend line CRUD / recompute paths (existing PATCH already handled overrides).
- User's Simpro PAT.
- Customer-facing print/magic-link surfaces (still read-only, no chips visible to customers).
- No `testing_agent_v3`.

**Margin comment**: The spec's optional `pricing.view_costs` gated "margin changed from X% to Y%" was skipped because stock lines don't carry a cost snapshot (`total_cost_aud = 0` from `build_stock_quote_line`), so any margin diff is trivially 100% → 100% and adds noise. Happy to wire it in a follow-up once stock items carry a landed-cost field.

### Phase 12.16 — Print to PDF on Customer & Project detail (2026-08-18)

Backend now returns proper PDF exports for customer and project records via WeasyPrint + Jinja2 templates. Frontend gets Print to PDF buttons on both detail pages, and a brand-new minimal Project detail page at `/projects/:id`.

**Backend**
- Added `GET /api/customers/{cid}/pdf` — `application/pdf`, gated by `customers.view`. Aggregates active projects, quotes, jobs, invoices for the customer.
- Added `GET /api/projects/{pid}/pdf` — `application/pdf`, gated by `projects.view`. Aggregates quotes, jobs, invoices, compliance forms for the project + parent customer.
- Templates in `/app/backend/templates/customer_record.html` and `project_record.html` — Jinja2, cohesive with existing charcoal/yellow brand. A `aud` filter formats numbers as `$1,234.56`.
- Audit events `customer_pdf_exported` and `project_pdf_exported` written on every export with metadata `{customer_id | project_id, generated_by, filename}`.
- Fixed a latent bug: `@api_router.patch("/projects/{pid}")` decorator had no attached function (the `update_project` body was orphaned below). PATCH `/projects/{pid}` now correctly updates the project.

**Frontend**
- `CustomerForm.jsx`: new **Print to PDF** button next to the existing browser-print button. Uses the shared axios instance (JWT interceptor) → blob → anchor download. Uses filename from `Content-Disposition`.
- New helper `downloadPdf(path, fallbackFilename)` in `/app/frontend/src/lib/print.js`.
- New page `ProjectDetail.jsx` at route `/projects/:id`. Sections: header (name + status pill + Print to PDF + Edit), overview card, customer card, and four sticky-yellow-banner tables (Quotes, Jobs, Invoices, Compliance forms). Row-click navigation to related entities. Edit opens a Dialog with name/code/location/status/notes fields → PATCH.
- Project rows on the Customer detail page now link to the new project detail page.

**Screenshots**
- `Print to PDF` button visible on Customer detail page next to `Print`, `Email`, `Delete`.
- Project detail page for **Barangaroo Tower B — Façade** renders overview, customer block, and all 4 related tables (Jobs 1 / Invoices $1,232,383.68 / Compliance forms 2).
- Generated customer PDF (Paneltec Pty Ltd): brand header, yellow section banners, contact/address/account grids, and Projects/Quotes/Jobs/Invoices tables.
- Generated project PDF (Barangaroo Tower B — Façade): status pill, overview grid, customer block, site address + notes, all four related tables.

**Confirmed via curl**
```
GET /api/customers/{cid}/pdf → 200, content-type: application/pdf, ~21 KB
GET /api/projects/{pid}/pdf  → 200, content-type: application/pdf, ~22 KB
GET /api/customers/bad-id/pdf → 404, {"detail":"Customer not found"}
GET (no auth) /api/customers/{cid}/pdf → 401
```

**Not touched**
- User's Simpro PAT.
- Existing browser print flows (`/customers/:id/print`, `/projects/:id/print`).
- No `testing_agent_v3`.

