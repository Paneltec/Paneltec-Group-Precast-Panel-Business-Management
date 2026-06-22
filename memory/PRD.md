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
