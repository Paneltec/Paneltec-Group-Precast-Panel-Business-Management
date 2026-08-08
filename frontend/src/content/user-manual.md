# Paneltec Group — User Manual

## 1. Welcome to Paneltec Group

Paneltec Group is the end-to-end business management app for an Australian precast concrete panel manufacturer. It covers customer relationships, quoting (with magic-link customer approvals), production jobs, invoicing in AU Tax Invoice format, fleet, employees, and full audit logging.

**Who it's for**
- **Super admins** — own the business: configure pricing, users, integrations.
- **Estimators** — build customers, quotes, send them to clients.
- **Production** — schedule and progress jobs through the factory floor.
- **Accounts** — issue invoices, mark paid, push to Xero.
- **Read-only** — view-only access for board members / auditors.

**Live URL**: this app — `https://concrete-panel-app.preview.emergentagent.com`
**Login**: enter your email + password on `/login`. Sessions use JWT (you stay signed-in until you log out).

---

## 2. Getting Started

### First login + forced password change
Newly created users are flagged `must_change_password=true`. On first sign-in you'll be redirected to `/account` and required to set a new password before continuing.

### `/account` — Self-service profile
Every user can update their name, change their password, and see their current permissions on this page. It does NOT require an admin.

### Sidebar tour
- **Dashboard** — welcome card, today's activity, KPIs (and margin KPIs for cost-viewers).
- **Calculator** — quick standalone quoting tool.
- **Customers / Projects / Quotes / Jobs / Invoices** — the core CRM-to-cash flow.
- **Vehicles / Employees** — fleet and crew, used by Job assignment.
- **Pricing / Company / Integrations / Users / Audit Trail** — admin areas (gated by permission).
- **Help** — this manual.
- **Logout** — sign out (sessions are JWT-based, no server-side state to clear).

### Brand-new account checklist (super admin)
1. **Pricing → Sell Prices** — confirm panel base rates and reinforcement densities.
2. **Pricing → Cost Inputs (internal)** — set realistic material, labour, transport and overhead so margin tracking is accurate.
3. **Company Settings** — your business name, ABN and bank details for EFT — these flow into all invoices.
4. **Integrations** — leave MOCKED for now (real wiring lands in Phase 4 Part 2 once credentials are provided).
5. **Users** — invite your team and assign roles.

---

## 3. Roles & Permissions

### Preset roles
| Preset | Customers | Quotes | Jobs | Invoices | Pricing edit | Cost visibility | Users | Audit |
|---|---|---|---|---|---|---|---|---|
| **Super Admin** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Estimator** | ✅ | ✅ | view | — | — | — | — | — |
| **Production** | — | view | ✅ | — | — | — | — | — |
| **Accounts** | view | view | view | ✅ | — | — | — | — |
| **Read-only** | view | view | view | view | — | — | — | — |

### Custom permission sets
Super admin can override any preset on a per-user basis via `/users → Edit user → Permissions`. Each permission is independent.

### Elevated permissions (super admin only — cannot be granted)
- `users.manage` (create, edit, soft/hard delete users)
- `pricing.edit`
- `company.edit`
- `integrations.edit`
- `audit.view` (always available to super admins; can be granted to managers as needed)

### `pricing.view_costs` — internal margin visibility
This permission is **separate** from `pricing.edit`. It controls whether the user sees:
- The "Internal — Cost & Margin" column on the Calculator
- The "Internal — Margin Analysis" card on Quote detail
- The "Quoted margin" + "Avg margin %" KPI cards on the Dashboard

By default OFF in every preset (only super admins see costs). Grant it to managers who need margin visibility. **Customer-facing surfaces (public magic-link, quote print, customer email) NEVER show cost or margin — regardless of who logged in.**

---

## 4. Precast Panel Calculator (`/calculator`)

### Inputs
- **Panel Type** — Wall Standard 150mm, Wall Load-Bearing 200mm, Floor Slab 250mm, Hollow Core 200mm, Architectural Facade, Prestressed.
- **Length (m)** × **Height (m)** — panel face dimensions.
- **Thickness (mm)** — pick from the configured list (default 100/150/200/250/300).
- **Concrete grade** — label only, doesn't affect price.
- **Quantity** — number of identical panels.
- **Openings (m²/panel)** — total cut-outs (doors, windows). Subtracts from face area before volume + weight calc.
- **Reinforcement** — Light / Standard / Heavy / Prestressed (drives steel weight per m³).
- **Surface finish** — Smooth, Exposed Aggregate, Acid-Etched, Sandblasted, Patterned/Embedded (applies cost multiplier).

### How calculations work (per panel)
1. Face area = length × height
2. Net area = face area − openings
3. Volume = net area × (thickness ÷ 1000)
4. Concrete weight = volume × density (default 2,500 kg/m³)
5. Steel weight = volume × reinforcement density (e.g. Standard = 45 kg/m³)
6. Cost per m² = (material + manufacturing + transport+install) × finish multiplier
7. Subtotal = net area × cost per m² × quantity
8. GST = subtotal × 10%
9. Total = subtotal + GST

### Reading the results panel (right side on desktop, below on mobile)
- **Per panel**: face area, net area, volume, concrete weight, steel weight, total weight.
- **Project totals**: total volume, total weight (t), base cost per m², finish multiplier.
- **Cost breakdown table**: material, manufacturing, transport+install, finish premium, subtotal, GST.
- **Total inc. GST** — big yellow card at the bottom.

### Internal Cost & Margin panel (cost-viewers only)
Below the sell-side breakdown, super admins (and anyone with `pricing.view_costs`) see a separate panel with internal costs:
- Concrete, Steel, Mfg labour, Finishing labour, Transport, Subtotal cost, Overhead, **Total cost**.
- **Margin pill** at the bottom — colour-coded:
  - 🟢 **Green** if margin ≥ 30%
  - 🟡 **Amber** if 15–29.9%
  - 🔴 **Red** if < 15%

### Print / Export
Click **Export / Print** in the results panel to open a print-friendly view in a docked popup window.

---

## 5. Customers (`/customers`)

### Create / Edit
Click **New customer**. Fill in:
- **Company name** (required)
- **ABN** (11 digits, AU format)
- **Contact name + email**
- **Billing address** + **Site address** (state dropdown, postcode validated)

### Soft delete, restore, permanent delete
Every list row has a trash icon (with `customers.delete` permission). Soft delete sets `deleted_at` — record disappears from default view, available under **Deleted** filter. Restore (any cost-viewer) brings it back. Permanently delete (super admin only) requires typing the company name to confirm and refuses if quotes/projects reference the customer.

---

## 6. Projects

Projects live under their customer — open a customer and use the "Projects" card to add one. A project has:
- **Name + description**
- **Status** (planning, quoted, in-progress, complete, cancelled)
- **Site address** (defaults to customer's)

Projects don't have a standalone list page in Phase 7; they're managed inline from the customer detail page. Soft/hard delete works the same way as customers.

---

## 7. Quotes — Full Lifecycle (`/quotes`)

### Creating
**New quote** → pick customer (and optionally project) → use the mini-calculator on each line to populate sell + cost snapshots. Add as many lines as you like, then save the draft.

### Pricing snapshots
When you add a line, the line freezes BOTH the sell numbers and the cost numbers. Editing **Pricing Settings** later does NOT change existing quotes — only new lines on new quotes use the new rates.

### Internal margin card (admin only)
Below the line items on quote detail: a collapsible **Internal — Margin Analysis** card with per-line and quote-level cost / margin / margin%. Colour-coded by the same thresholds as the calculator. Customers never see this.

### Sending — Microsoft 365 (MOCKED)
Click **Send**. The Email modal opens with the magic-link, subject, and body pre-filled. The real M365 send is MOCKED in Phase 7 — copy the content with the **Copy email content** button, paste into your own inbox, and send. The app records the "last emailed at" timestamp regardless.

### Magic-link customer flow
The recipient gets a public URL (`/q/<token>`) that does NOT require login. They can review the quote and click **Accept** or **Reject**. We track:
- First viewed at
- Last viewed at + total view count
- Accepted at / Rejected at

### Quote statuses
`draft → sent → accepted` or `rejected` (or `expired` if `valid_until` passes).

### Revising a sent quote
Open a sent quote → **Revise**. This creates a new linked draft with the previous lines pre-loaded. The lineage is bidirectional — both the old and new quote show a "Previous / Next revision" link.

### Printing
**Print** opens an AU-standard quote PDF view in a docked popup. NO cost/margin info ever renders here.

---

## 8. Jobs — Production Workflow (`/jobs`)

### Auto-creation
When a quote is **accepted** (manually or via magic-link), a Job is automatically created with the next sequential job number. No manual step.

### Status workflow (linear)
`scheduled → in_production → ready_for_delivery → delivered → installed → completed`. **Cancelled** can be set at any time. Every transition is auditable, with the actor user, timestamp and optional note.

### Assignments
- **Vehicle** — single vehicle from the fleet (see §10)
- **Crew** — multi-select of employees

### Schedule fields
- Production start / end (planned)
- Delivery date (planned)
- Install start / end (planned)
- Actual completion date

### Production Sheet
**Print** on a Job opens a warehouse/driver-focused docked-popup print: panels, weights, total volume, vehicle, crew, addresses. No prices.

### Audit log
The Job detail page shows the full transition history at the bottom: from → to, by user (with `(deleted)` / `Unknown user` badges where appropriate), timestamp, note.

---

## 9. Invoices (`/invoices`)

### Generate from a job
Open a delivered job → **Generate invoice** to create a draft invoice with line items copied from the underlying quote.

### AU Tax Invoice print format
The invoice print includes:
- "Tax Invoice" heading
- Your business ABN
- Customer ABN
- Itemised lines with subtotal + GST 10%
- EFT block (BSB / Account / Reference) — from Company Settings

### Status workflow
`draft → issued → paid` (or `overdue` / `cancelled`).

### Mark paid
Open an issued invoice → **Mark paid** → enter amount, reference (e.g. EFT receipt), date. Audit event recorded.

### Push to Xero (MOCKED)
- **Single push**: invoice detail → **Push to Xero**. Mock Xero ID stamped, `xero_push_status=MOCKED_PUSHED`.
- **Bulk push**: select multiple rows on `/invoices` → sticky bottom bar → **Push to Xero**. Confirmation modal warns about prior-pushed invoices and offers a **Force re-push** toggle. Result modal summarises pushed / skipped / errored.

### Duplicate-send / re-push warnings
The send and bulk-push modals both surface the previous timestamp so you don't accidentally double-send or duplicate a Xero invoice. Use Force re-push only when you intend to.

### Dashboard KPI: Invoices awaiting Xero push
Top of the dashboard (visible to anyone with `invoices.view`). Click → opens `/invoices?xero_push_status=pending` pre-filtered.

---

## 10. Vehicles & Employees

These are **DB-backed CRUD** in Phase 7 — meaning you create them manually here. They will sync from **Navixy** (vehicles) and **Simpro** (employees) when those integrations are wired (Phase 4 Part 2).

### Vehicles (`/vehicles`)
Fields: code, name, rego, capacity (tonnes), status (active / maintenance / retired). Used by the Vehicle dropdown on Job detail.

### Employees (`/employees`)
Fields: code, name, role, phone, status. Used by the Crew multi-select on Job detail.

**Employees are Simpro-only.** There is no manual "Add employee" button any more — every crew member must exist in Simpro first (or be added directly in Simpro), then pulled into Paneltec via one of the two buttons at the top of the page.

**Import from Simpro** (yellow, cloud-download)

Opens the preview modal:

1. **Companies to import from** — one segmented pill per company ID configured in `admin_settings.integrations.simpro.company_ids`. All selected by default. Tap a pill to deselect.
2. **Filtering by positions** banner — shows the position chips from the same settings so you know what will (and won't) come across. Change them in Admin Settings → Integrations.
3. **Preview** — hits the live Simpro API for every selected company. The result table shows Name / Position / Email / Status where Status is `NEW` (green pill) or `EXISTING` (grey — already in Paneltec).
4. **Ticked rows only** are imported when you press **Import selected (N)**. New employees are pre-ticked; existing rows can be re-ticked to force an update (name / phone / position refresh).
5. Cancel is safe — nothing is written until Import selected is pressed.

**Refresh from Simpro** (dark navy outline, next to Import)

One-click "keep the roster current". No modal, no preview — hits the same sync endpoint with all configured company_ids and the full position filter. Runs live and toasts a summary (`X added, Y updated, Z unchanged`). Underneath the two buttons you'll see **"Last Simpro refresh: ..."** — either a timestamp or `never`.

**Per-row Delete + `excluded_from_sync` flag**

Every employee row has a small trash icon on the right. Visible to Production role and Super Admin only. Delete confirms with a modal that explains:

- Soft-delete only — the record stays in the DB and the audit trail forever.
- For Simpro-sourced employees, an extra amber note appears: "Deleting won't remove them from Simpro — but this record will be flagged and future syncs will skip them." That flag is `excluded_from_sync: true` on the employee document. Restoring the employee (from the Deleted filter) clears the flag automatically.
- **RBAC**: Estimator / Accounts / Read-only see NO delete button. Production and Super Admin see it. The backend `DELETE /api/employees/{id}` also enforces `employees.delete` — even if the UI leaked, the API would reject.

Both lists support soft delete + restore + permanent delete (super admin), same as customers.

---

## 11. Settings (Admin)

### Company Settings (`/settings/company`)
Business name, ABN, address, contact email/phone, **bank details** for EFT (BSB, account name, account number, reference prefix). Saved values flow into every invoice automatically.

### Pricing Settings (`/settings/pricing`)
Two tabs:
- **Sell Prices** — customer-facing rates: concrete density, GST rate, panel base costs (material/manufacturing/transport+install per m²), thickness list, concrete grade list, finish multipliers.
- **Cost Inputs (internal)** — for margin calculation only, **never shown to customers**:
  - Concrete cost ($/m³), Steel cost ($/kg), Transport cost ($/m²), Overhead (%)
  - Manufacturing labour per panel type ($/m²)
  - Finishing labour per finish ($/m²)

Audit event fires on every save.

### Integration Settings (`/settings/integrations`)
Credential templates for **Microsoft 365** (email), **Simpro** (customers / employees), **Navixy** (fleet), **Xero** (invoices).

Phase 4 Part 2 wires **Simpro live**. The other three are still MOCKED until their credentials arrive. Simpro details:

**Setting up Simpro** (super admin, one-time)
1. Log in to your Simpro tenant as an admin → Setup → System → API Setup.
2. Create a new API key with scopes for Customers + Employees (read).
3. Note the **build name** (the subdomain — e.g. `paneltec` for `paneltec.simprosuite.com`), the **client ID**, and the **client secret**.
4. In Paneltec: Settings → Integrations → Simpro card → paste build name / client ID / client secret → toggle **Enable** → **Save**.
5. Click **Test Connection**:
   - **LIVE** (green) — Simpro handshake succeeded and returned the tenant name.
   - **ERROR** — check the message; the secret is masked once saved so you can re-paste to update.
   - **MOCKED** — the enable toggle is off; flip it on and save first.
6. From `/customers` click **Import from Simpro** (purple), from `/employees` click **Sync from Simpro** — records upsert by `simpro_customer_id` / `simpro_employee_id`. Manually-created local records with no Simpro ID are never touched.
7. Synced rows show a small purple **Simpro** chip so users can tell live vs manual at a glance. The list-page banner turns green with "LIVE · Synced from Simpro <timestamp> · N records".

### User Management (`/users`)
- Create / edit users (name, email, role preset)
- Reset password (generates a temporary password; user must change on next login)
- Custom permissions (override the preset on a per-user basis)
- Soft / hard delete, restore
- Last-admin safety: you can't deactivate or delete the only remaining super admin.

---

## 12. Audit Trail (`/admin/audit`)

Super admin only by default; can be opened to any user with `audit.view`.

### What's recorded
Every business-critical action:
- **CRUD**: created / updated / soft_deleted / hard_deleted / restored on every entity
- **Status transitions**: `status_changed` on quotes, jobs, invoices
- **Auth events**: `login_success`, `login_failed`, `login_rate_limited`, `password_changed`, `password_reset`
  - `login_rate_limited` — recorded when a client hits the brute-force
    protection (5 failed attempts / 15 min window OR sub-15-second
    successive attempts from the same IP). Metadata carries the client
    IP, cool-down seconds remaining, and the reason
    (`too_many_fails` or `ip_cooldown`).
- **Meta-audit**: `audit_row_hidden`, `audit_row_unhidden` — recorded when a
  Super Admin uses the bulk-hide action (see "Hidden rows" below). Metadata
  captures the target row's id, action, actor, and timestamp so the tidy-up
  is itself fully traceable. Meta-audit events are **immutable** — the API
  refuses to hide or un-hide them.
- **Permission events**: `permission_changed`
- **Business actions**: `quote_sent`, `quote_viewed` (public link), `quote_accepted`, `quote_rejected`, `quote_revised`, `invoice_issued`, `invoice_paid`, `invoice_pushed_xero`, `email_sent`
- **Settings**: `settings_changed` (cost edits included; secret API keys redacted in the diff)

### Hidden rows (Super Admin only)

Audit rows can never be truly deleted — the Audit Trail is the ONLY report
where a bulk action is available on individual rows, and it flags rows
**hidden from default view** rather than removing them.

- **Bulk-select checkboxes** appear on every non-meta row for Super Admins.
  The header checkbox toggles all visible rows.
- **Hide selected** opens a confirm dialog with a compliance note and a
  required "I understand this action is logged and non-destructive"
  consent checkbox. The primary button stays disabled until consent is
  given.
- Each hidden row gets `hidden_from_view: true`, `hidden_at`, and
  `hidden_by_user_id` fields on the audit document AND produces a NEW
  `audit_row_hidden` meta-event with metadata that references the hidden
  row.
- **Show hidden rows** toggle in the page header (Super Admin only, URL
  param `?show_hidden=1`) — when ON, hidden rows are visible at reduced
  opacity with a "hidden" pill; each hidden row exposes an inline
  **Un-hide** link that writes a matching `audit_row_unhidden` meta-event.
- **CSV export always includes hidden rows** (regardless of the toggle).

**Compliance note (Tasmania AU — AS 3850 / NCC 2022):** hidden rows remain
in the database, are exportable on request, and every hide/un-hide action
is itself audit-trailed. This satisfies the retention/immutability
requirements of the standards for precast concrete panel manufacturers.

### Filtering
URL-bound filters: action / entity type / search / **date range** (default last 30 days) / page. The URL is shareable + reload-safe.

### Audit drawer
Click any row → right-side drawer opens with:
- Large action badge + absolute & relative timestamp
- Actor row (avatar with initials, name, email, `(deleted)` / Unknown markers)
- Entity row + **Open <entity>** button (disabled with tooltip "Record no longer exists" when entity is hard-deleted)
- **Pretty diff** — object diffs render as `+key` (green) / `−key` (red); scalar diffs as `from → to` with strike-through on the old value
- Metadata (incl. user-agent parsed to readable form)

### CSV export
**Export CSV** button respects current filters.

### Recent Activity dashboard widget
Top of Dashboard for `audit.view` users — today's summary line + last 10 events. Click a row → opens that event's drawer in the audit page.

---

## 13. Universal actions on every entity

### Edit / Email / Print triad
Most detail pages (Customer, Project, Quote, Job, Invoice) share three buttons:
- **Edit** — opens the editor for that record.
- **Email** — opens the M365 modal (MOCKED — copy content + magic link, send from your inbox).
- **Print** — opens the customer/internal print view in a **docked popup window** (no full-screen takeover).

### Last-emailed / last-pushed timestamps
Wherever an email or Xero push action exists, the latest timestamp and the user who did it (with `(deleted)` markers) are displayed inline.

### Soft / hard delete
Every list row (where the user has the relevant `*.delete` permission) has a trash icon → confirmation dialog → soft delete. Deleted view shows Restore + Permanently (super admin). Permanently checks references and forces typed confirmation.

---

## 14. What's currently MOCKED

| Integration | Status | Activates in |
|---|---|---|
| **Microsoft 365** (email send) | MOCKED — copy content & send from your inbox | Phase 4 Part 2 |
| **Simpro** (customer + employee import) | **LIVE-capable** — real API wired; MOCKED until credentials entered + enable toggle flipped in Settings → Integrations | Phase 4 Part 2 ✓ |
| **Navixy** (vehicle/fleet sync) | MOCKED — manual CRUD for now | Phase 4 Part 2 |
| **Xero** (single + bulk invoice push) | MOCKED — Mock Xero ID stamped | Phase 4 Part 2 |

Simpro test/sync endpoints degrade gracefully: with `enabled: false` or missing credentials the app runs in MOCKED mode (manual roster, `Import from Simpro` button disabled). With bad credentials Test Connection returns a friendly error message — no crash, no corrupted local data. See §11 for the one-time setup guide.

---

## 15. Troubleshooting

### I can't log in
- Check email + password (case-sensitive on password).
- Wrong-password lock: 5 failures in 15 minutes triggers a temporary lockout.
- Forgot password? Ask a super admin to reset it on `/users`. You'll get a temporary password and be forced to change it on next sign-in.

### The Email button didn't actually send
Email is MOCKED. Open the modal, click **Copy email content** + **Copy magic link**, paste into Outlook / Gmail and send from your inbox. The app records the "last emailed at" timestamp.

### The print page is empty
- Ensure you're still logged in (sessions can expire after long idle periods — refresh and re-login).
- Your browser's popup blocker may be blocking the docked print popup — allow popups for this site.
- Try **Open print in new tab** as a fallback in the popup window header.

### I don't see Settings / Users / Audit
Those are gated by permission. Ask a super admin to:
- Grant `pricing.view` / `pricing.edit` for Pricing
- Grant `users.view` / `users.manage` for Users
- Grant `audit.view` for Audit Trail
- Or change your role preset.

### I can't see the Internal Cost / Margin section
You need the `pricing.view_costs` permission. Ask a super admin to grant it on your user. By design, this is OFF in every default preset — it's separate from "edit pricing" so finance/managers can see margins without changing sell prices.

### A quote / job / invoice "disappeared"
It was soft-deleted. Switch the list filter to **Deleted** or **All** to find it, then **Restore**.

---

## 18. Compliance Forms

The Compliance Forms module digitises the three Australian Precast Code of Practice forms used at Paneltec — Pre-Pour Checklist (9.1.2), Post-Pour Checklist (9.1.3) and Manufacturer's Certificate of Compliance (9.1.4). Forms live at `/forms`, are linked to Jobs, and produce branded A4 print-ready output.

### 18.1 The three form types
- **Pre-Pour (9.1.2)** — inspection BEFORE concrete is poured. Sections: FORMWORK, REINFORCEMENT (with photograph capture), CAST-IN ITEMS (ferrules / lifters / grout tubes), OTHER (recesses, openings, panel ID plate, form liners).
- **Post-Pour (9.1.3)** — inspection AFTER de-mould. Sections: PANEL (ID/weight visibility + Length/Width/Thickness in mm + cleanliness) and CONCRETE DEFECTS (free-form defect log with location, description, remedy).
- **Manufacturer's Certificate of Compliance (9.1.4)** — final hand-off cert. Header (Client, Project, Site Address, Engineer), Schedule of Elements (one row per panel: Identification Number + Casting Date), declaration text + AS 3850 / AS 3600 references, and Signatory block.

### 18.2 Workflow & states
1. **Draft** — Production user creates a form via "+ New Form", picks form type, panel ID, and (optionally) links a Job. The form ships pre-populated with all the criteria from the source docx.
2. **Completed** — Once every criterion is recorded (`✓ OK`, `✗ Rectify`, or `N/A`) and any rectifications noted, hit "Mark Complete".
3. **Signed** — A user with `forms.sign` permission (typically the QA Officer role) reviews and clicks "Sign". The form becomes immutable; super admins can revert it back if needed.

### 18.3 Photos & GPS
Tap "Click to upload photo" on the form editor to attach JPEGs/PNGs (max 10 MB). Photos taken on a phone with EXIF location enabled show their GPS coords and timestamp under each thumbnail (📍 -27.4705, 153.0260 · 14 Jun 2026 09:32). Photos without GPS data are marked "No GPS data" and still upload normally.

### 18.4 Print format
Click "Print" on a form to open the branded A4 print popup. Signed forms render a typed signature block ("✓ Signed by user uuid on 14 Jun 2026 14:32 AEST") instead of empty lines, suitable for client hand-off or archival.

### 18.5 Reports
A "Compliance" report tile on `/reports` surfaces:
- **Hold-Point compliance %** — signed-vs-required ratio across jobs that have crossed each hold point in the date range (≥95 green, 80-94 amber, <80 red)
- **NCR rate %** — proportion of forms flagged with a Non-Conformance Report
- **Avg sign-off latency** — days from form creation to "Signed"
- **Photo coverage %** — proportion of completed/signed forms with at least one photo attached
- Stacked bar chart of forms-by-type per month (Pre-Pour / Post-Pour / Certificate)
- "Hold-points missing by stage" bar with red/amber/green tints
- Recent forms table
- **Export NCR Pack** button (top-right) — bundles every NCR-flagged form completed in the selected window into a single merged PDF (cap 100). Either download directly, or supply a recipient email to fire a **MOCKED** email preview with the PDF as attachment. The button disables to "No NCRs to export" when zero NCR-flagged forms exist in the range. Each export records an `ncr_pack_exported` audit event listing the form IDs.

### 18.6 Form Templates (`/forms/templates`) — super admin
Templates are now data-driven. Browse, clone, edit, activate / deactivate and (for non-system templates) delete from `/forms/templates`. The "+ New Form" picker on `/forms` only lists **active** templates.

- **System templates** (`PRE`, `POST`, `CERT`) are seeded and **read-only** — clone them to customise. Cloning auto-generates a semantic `_vN` suffix (e.g. `PRE` → `PRE_v2` → `PRE_v3`).
- **Custom templates** can be edited inline: rename sections, add / re-order criteria (use the up/down arrows), toggle "required" or "photo" flags per criterion, and edit header fields. Each save bumps the template version (`v2`, `v3`, …).
- Each created form **snapshots** its template_id + version, so editing a template never alters historic forms.
- Deactivating a template hides it from the "New Form" picker but keeps existing forms intact.
- Keys (section & criterion) must be `[a-z0-9_]+` and unique within their parent.

---

## 19. Hold Points & Inspection Workflow

Australian Precast Code of Practice §9 requires inspection sign-offs before key job milestones. Paneltec enforces this with **Hold Points** — automatic transition blocks on jobs that have not collected the required signed compliance forms.

### 19.1 The three hold points
| Transition | Required signed form | Why |
|---|---|---|
| `in_production` → `ready_for_delivery` | **Pre-Pour Checklist (9.1.2)** | Confirms formwork, reinforcement & cast-in items before concrete is poured |
| `ready_for_delivery` → `delivered` | **Post-Pour Checklist (9.1.3)** | Confirms panel quality & dimensions after de-mould |
| `delivered` → `installed` | **Manufacturer's Certificate of Compliance (9.1.4)** | Final hand-off cert covering the batch — one per job is enough |

### 19.2 What you'll see when blocked
Clicking "Advance" on a job that's missing a signed form opens the **Hold-point block** dialog, listing exactly which form(s) are needed and whether a draft exists. Create the form (or sign the existing one) then retry.

### 19.3 Super-admin override
In genuine emergencies (urgent dispatch, sign-off on paper that hasn't been transcribed yet), a super admin can override the hold point:
1. Click "Advance" → block dialog opens
2. Enter a reason (≥5 chars) in the override box
3. Click "Override & advance" — the transition succeeds, but is recorded as a `hold_point_override` audit event with the reason

Override events are visible on the job's status history (with a red OVERRIDE flag) and on the audit trail.

### 19.4 Compliance health on the dashboard
The "Compliance health · last 30 days" tile shows the percentage of hold-points satisfied across active jobs touched in the rolling 30-day window. Click through to drill into the Compliance report. Colour bands: ≥95 green, 80-94 amber, <80 red.

## 17. Reports & Data Export

Where to find it: **Reports** in the sidebar (the green chart icon). Available to every user who has any of the report `*.view` permissions; the Data Export and Power BI Integration tabs are super-admin only.

### 17.1 Reports landing page
A card grid of all 7 reports. Each card shows live KPI previews so you can sanity-check the numbers at a glance before drilling into a full dashboard.

### 17.2 The 7 reports
- **Customers** — top 10 by quoted value, new customers per month, full customer activity table.
- **Quotes** — pipeline funnel (draft → sent → accepted → rejected), 6-month win-rate trend, stacked value-by-month.
- **Jobs** — by status doughnut, completions per month, cycle-time histogram.
- **Invoices** — aging buckets ($), issued vs paid by month, average days-to-pay trend.
- **Vehicles** — assignments per vehicle, status distribution.
- **Employees** — assignments per employee, role distribution.
- **Pricing & Margin** — *INTERNAL, requires `pricing.view_costs`*: avg margin % by panel type, by finish, 6-month margin trend. Margin colour-coded green ≥30, amber 15-30, red <15.

### 17.3 Date filtering
Every report has a `From` and `To` date picker (defaults to the last 90 days). Changing dates refreshes the KPIs, charts, and table.

### 17.4 CSV export per report
Click "Export CSV" on any report detail page to download the filtered table data. The CSV columns match the on-screen table.

### 17.5 Data Export tab (super admin only)
Raw, flattened CSV dumps of any entity module — customers, projects, quotes, jobs, invoices, vehicles, employees, audit events. Use this for ad-hoc analysis, GDPR exports, or moving data into another system.

- Pick a module from the dropdown
- Set a date range or tick "All time"
- Tick "Include soft-deleted" to also export records that were deleted (audit module ignores this)
- Click **Download CSV** — the file streams directly to your browser
- **Hard cap of 100,000 rows** per request — if you hit it the response includes the `X-Export-Capped: true` header and the CSV ends with a marker row. Narrow your date range to get more.

### 17.6 Power BI Integration (super admin only)
Long-lived API tokens let Power BI Desktop, Excel Power Query, Tableau, and similar BI tools pull data directly. The on-screen guide gives copy-pastable instructions for each tool; the gist is:

1. Generate a token (next section)
2. In your BI tool, add a Web data source pointing at `<APP_URL>/api/reporting/v1/<entity>`
3. Add a request header **X-BI-Token** = your raw token
4. Iterate pages with `?page=N&per_page=1000`

Available endpoints (all read-only, all paginated, max 1000 rows/page):
`/api/reporting/v1/customers`, `/api/reporting/v1/quotes`, `/api/reporting/v1/jobs`, `/api/reporting/v1/invoices`, `/api/reporting/v1/vehicles`, `/api/reporting/v1/employees`.

### 17.7 API token management (super admin)
The same tab lists every BI token ever created — active and revoked — for full audit history.

- **Generate** — give it a memorable name like "Power BI - Sales Dashboard". The raw token is shown **once** in a modal with a Copy button. Save it immediately into your BI tool's credentials — it will never be displayed again, only the prefix.
- **Revoke** — instantly disables the token. Any BI tool still using it will start getting 401 errors. Revoked tokens stay in the list (greyed out, struck through, with a red REVOKED badge) for audit purposes.
- **Cap** — maximum 20 active tokens at any time. Revoke unused ones to free a slot.
- **Rotation** — best practice is rotate every 90 days. If a token leaks, revoke immediately.

Every generation and revoke is recorded in the audit trail (`bi_api_token` entity type) so you always know who created or killed what and when.

### 17.8 What's filtered out — privacy guarantee
The reporting endpoints recursively scrub every key whose name contains any of:
`cost_`, `margin_`, `internal_`, `total_cost`, `password`, `api_key`, `client_secret`, `token_hash`.

That means a Power BI token connected to `/api/reporting/v1/quotes` will see line items but **never** the internal cost breakdown, margin %, or any secret fields — even though super admins can see them in the UI. BI tools also cannot read the Pricing & Margin report, Pricing Settings cost inputs, integration secrets, or the user list. They are scoped strictly to operational facts about customers, quotes, jobs, invoices, vehicles and employees.

### 17.9 Row-level Edit / Delete on report tables

Every business-record report tile (Customers, Quotes, Jobs, Invoices, Vehicles, Employees, Compliance Forms) now shows an **Actions** column on its table:

- **Edit** (blue pencil) — opens the record's detail / edit page.
- **Delete** (red bin) — opens a confirmation dialog. On confirm the row is **soft-deleted**: it disappears from every default view and every report, but is retained in the audit trail as a `soft_deleted` event and can be restored by a Super Admin.
- **Lock icon + tooltip** — replaces the Edit / Delete buttons when the record is finalised:
  - Invoice → `sent` OR `xero_push_status == pushed / MOCKED_PUSHED` → *"Locked — already sent to customer or pushed to Xero. Void and reissue instead."*
  - Quote → `accepted` / `approved` → *"Locked — customer-approved. Create a revision instead."*
  - Job → `delivered` / `installed` / `completed` / `closed` → *"Locked — job completed."*
  - Compliance Form → `signed` / `signed_off` → *"Locked — signed off. Raise an NCR instead."*
  - Customers, Projects, Employees, Vehicles have no lock rules — always editable / deletable by permitted roles.

Permission gating (super admin bypasses everything):

| Role | Edit / Delete on |
|---|---|
| Accounts | Invoices |
| Estimator | Quotes, Customers, Projects |
| Production | Jobs, Compliance Forms, Vehicles, Employees |
| Super Admin | Everything |

If your role lacks the permission for a given entity the icons don't render at all — they aren't just greyed out. The **Audit Trail** report has no row actions by design (audit events are immutable).

There is no restore UI in this release. Super Admins can undelete a record by removing its `deleted_at` field directly in Mongo if urgent.

---

## 16. Version & Change Log

**App version**: v1.0 · Phase 11
**Manual last updated**: 2026-06-22

### Phase 11.6 (2026-08-04) — AI Standards Check for Compliance Templates
- New super-admin feature under Form Template Builder → **AI Standards Check** button. Runs a real 3-step pipeline: Tavily web search across AU standards domains → active AI provider LLM call → new AI-draft template stored in `compliance_form_templates` with `status: ai_draft`. Existing templates are NEVER overwritten.
- Region is hard-locked to Tasmania, Australia (prompt + Tavily search scope).
- Modes: **Suggest updates** (diff-style change list with per-item accept/reject) or **Generate a brand new template** (full JSON preview). Every proposed change/criterion MUST include a `citation.source_url`; server-side filter drops any uncited output before returning.
- Rate limit: 20 runs / super-admin / rolling hour (in-memory sliding window).
- New Admin Settings tabs: **Web Search** (Tavily API key connect/disconnect with live verify) and **Compliance Standards** (editable list, seeded with 9 AU standards: AS 3600 / AS 3850.1-.2 / AS/NZS 4671 / NCC 2022 Vol 1-2 / Tasmanian Building Act 2016 / Director's Determinations Tas / WorkSafe Tas).
- Audit event `ai_template_check` written per run with mode, template_id, draft_id, provider, model, standards, source URLs, prompt/completion token counts, and `dropped_for_missing_citation` count. `ai_template_accepted` on save-as-draft.
- Fallback behaviour: with Tavily OR active AI provider missing/disconnected, the modal shows a red "Prerequisites missing" banner listing exactly what's needed and disables the Run button — no crash, no silent failure.

### 18.5 AI Standards Check for Compliance Templates
Super Admin only. Available at **Form Templates → "AI Standards Check"** (top-right, purple button with 🤖 icon).

**Prerequisites** — the modal will block Run until both are green:
1. Active text AI provider CONNECTED or MANUAL (Admin Settings → AI Providers)
2. Tavily API key CONNECTED (Admin Settings → Web Search)

**How to run**
1. Click AI Standards Check → modal opens.
2. Pick a **Mode**:
   - *Suggest updates to this template* — the modal shows a **radio-card list of every compliance template** in your workspace (system + custom, active + drafts). Click the row you want the AI to audit. Nothing is pre-selected — the **Run** button stays disabled until you actively choose one. Each row shows the template name, status pill (System / Active / Draft / AI Draft), code, version, and last-updated date.
   - *Generate a brand new template* — pick a type (Pre-Pour / Post-Pour / Certificate / Custom). AI outputs a full structured template with citation-tagged sections/criteria.
3. **Standards to check against** — all 9 seeded AU standards are ticked by default; untick to narrow scope.
4. Confirm the active AI provider shown at the bottom, then click **Run**. Live progress panel steps through: Searching standards → Fetching clauses → Analysing → Generating (30-90 s typical).

**Result screen**
- Update mode: change list with per-item checkboxes, each showing before/after, rationale, and clickable clause citation (`AS 3850.1:2015 §7.3.2` + source URL).
- Generate mode: full template JSON preview.
- Click **Save as new draft** — creates a new template `{original} (AI draft {date})` with `status: "active"` (was `ai_draft` before accept). The source template is untouched.

**Region + guardrails**
- Prompt and Tavily search filter both hard-lock to Tasmania, Australia.
- Every proposed change/criterion without a citation is server-side filtered before it reaches the UI (drop count shown at the top of the result panel).
- Rate limit: 20 runs per super-admin per rolling hour.
- Audit trail records provider, model, token counts, and every source URL cited.

### Phase 11.5 (2026-08-04) — AI Providers Connect flow + audit-trail report
- New "Connect account" flow per provider under Admin Settings → AI Providers, replacing the flat paste-key input. OpenAI / Anthropic / Nano Banana use paste-key + live verify (real `GET /v1/models` roundtrip). Google Gemini uses OAuth2 when `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` env vars are set; otherwise renders a yellow fallback banner and accepts a manual API key.
- Status pills per provider: `NOT CONFIGURED` (grey) · `MANUAL` (yellow) · `CONNECTED` (green) · `ERROR` (red, message on hover).
- Disconnect button clears creds. Every connect/disconnect writes `ai_provider_connected` / `ai_provider_disconnected` audit events.
- New endpoints (all super-admin gated): `POST /api/admin/settings/ai_providers/{provider}/connect`, `POST .../disconnect`, `GET .../oauth/google/start`, `GET .../oauth/google/callback`, `GET .../oauth-status`.
- `GET /api/reports/audit-trail` now returns 200 with a proper `{kpis, charts, table}` payload — last "Unknown report" regression closed. Rows have no `_id`/`_entity` so the Actions column stays hidden.

### 18.4 AI Providers — connect account
Admin Settings → **AI Providers** shows one card per provider. Instead of pasting a key blindly, click **Connect account** to run a verified handshake:

1. **OpenAI** — modal opens with a "Sign in to OpenAI" link (`platform.openai.com/api-keys` in a new tab), a paste field, and **Save & verify**. Live `GET /v1/models` call — 200 → green **CONNECTED**; anything else → **ERROR** with the reason.
2. **Anthropic (Claude)** — identical pattern against `api.anthropic.com/v1/models` using `x-api-key` + `anthropic-version` headers.
3. **Google (Gemini)** — if `GOOGLE_OAUTH_CLIENT_ID/_SECRET/_REDIRECT_URI` are set on the server, a **Sign in with Google** button starts OAuth2 (offline access, scopes `openid email profile generative-language`). On callback the app stores refresh + access tokens and the user's email; pill goes **CONNECTED as user@example.com**. If OAuth is not configured, a yellow fallback banner shows — paste an API key from `aistudio.google.com/apikey` and Save & verify (pill goes yellow **MANUAL**).
4. **Nano Banana (image gen)** — API-key paste + Save & verify. No public metadata endpoint so any key ≥ 20 chars is accepted; pill goes green **CONNECTED**.

Once ≥1 text-provider is CONNECTED / MANUAL, its radio button becomes clickable to make it the app's **active text provider**. Same for the image provider (Nano Banana is the only image option today). AI-driven features in future phases will read `admin_settings.ai_providers.active_text_provider` / `.active_image_provider`.

Click **Disconnect** to clear stored credentials — pill reverts to grey **NOT CONFIGURED** and the audit trail records who unlinked it and when.

### Phase 11.3 (2026-08-04) — Report row Edit/Delete + Lock rules
- Report tables (Customers, Quotes, Jobs, Invoices, Vehicles, Employees, Compliance Forms) now show an **Actions** column with role-gated Edit + Delete icons.
- Finalised records collapse to a lock icon + tooltip (see §17.9): invoices sent/pushed-to-Xero, quotes accepted, jobs delivered/completed, compliance forms signed.
- Soft-delete via existing `DELETE /:entity/:id` endpoint (new: `DELETE /compliance-forms/:id`). Audit event `soft_deleted` fires per delete.
- Production role preset gains `employees.edit/delete`, `vehicles.edit/delete`, `forms.delete` per the RBAC matrix.
- Audit Trail report intentionally excluded — audit events remain immutable.
- No restore UI in this pass. Super Admins can undelete via Mongo if urgent.

### Phase 4 Part 2 (in progress) — Simpro LIVE wiring
- New async `SimproClient` with OAuth 2.0 client-credentials, token caching, retry-on-401/429/5xx.
- New endpoints `POST /api/integrations/simpro/sync-customers` and `.../sync-employees` — upsert-by-`simpro_*_id`, per-row error isolation, audit-logged as `simpro_customer_sync` / `simpro_employee_sync`.
- Test Connection now returns `LIVE` when enabled + credentials valid; `ERROR` with a friendly message on bad creds; `MOCKED` when disabled. Sync status (`last_sync_at`, `last_sync_status`, counts) persisted on `integration_settings.simpro`.
- Customers + Employees list pages show a purple **Import from Simpro** / **Sync from Simpro** button when enabled+configured, a green LIVE banner after a successful sync, and a small **Simpro** chip next to each synced row.
- Full graceful fallback: with Simpro disabled or credentials missing, both list pages behave exactly as before — the old MOCKED yellow banner + disabled import button.

### Phase 11 — Form Template Builder + Hold Points + Enhanced Compliance Reports
- **Template Builder** (`/forms/templates`): data-driven compliance form templates living in the `compliance_form_templates` collection. Browse, clone (semantic `_vN`), edit (sections + criteria with up/down reorder), activate / deactivate, soft-delete. System PRE/POST/CERT templates seeded read-only.
- **"+ New Form"** now fetches active templates dynamically and snapshots `template_id` + `version` per form, so future edits to a template never alter historic forms.
- **Hold Points**: job status transitions `in_production → ready_for_delivery`, `ready_for_delivery → delivered`, and `delivered → installed` are blocked until the matching signed compliance form exists. Super admins can override with a reason — recorded as a `hold_point_override` audit event.
- **Dashboard "Compliance health" tile**: signed-vs-required hold-point ratio over active jobs in the last 30 days, colour-coded (≥95 green, 80-94 amber, <80 red), drills into the Compliance report.
- **Enhanced Compliance Report** (`/reports/compliance`): adds Hold-Point Compliance %, Avg Sign-off Latency, Photo Coverage %, "missing-by-stage" Recharts bar with red/amber/green tints.
- **Export NCR Pack** (Phase 11.1, 2026-06-22 minor): one-click button on the Compliance report top-right — bundles all NCR-flagged forms completed in the date range into a single merged PDF (cap 100), with optional MOCKED email send to a recipient. Disables to "No NCRs to export" when zero matches. Audit-logged as `ncr_pack_exported`.
- **Permissions**: `forms.template_manage` is now seeded for super admin; staff cannot see `/forms/templates` (UI hidden AND API returns 403).

### Phase 1 — Foundation
Auth (JWT + bcrypt), Super Admin + Estimator seed users, brand palette, GST 10%, Precast Panel Calculator with full sell-side breakdown, dashboard placeholder, OpenAPI spec at `/api/openapi.json`.

### Phase 2 — Customers, Projects, Quotes
AU customer model with ABN validation, projects under customers, quote builder with mini-calculator per line, magic-link customer Accept / Reject without login, view tracking, quote revisions with bidirectional lineage, customer-facing print view.

### Phase 3 — Jobs & Production
Auto-create Job on quote accept, 6-stage linear workflow + cancel, vehicle + crew assignments, schedule fields, Production Sheet print, full audit of transitions.

### Phase 4 Part 1 — Invoices
Generate from delivered Jobs, AU Tax Invoice print format with EFT block, draft → issued → paid workflow, Mark paid with reference, single Xero push (MOCKED).

### Phase 5 — Granular Permissions
5 preset roles, custom per-user permission overrides, last-admin safety, elevated super-admin-only permissions, soft/hard delete + restore for users.

### Phase 6 — Universal Delete + Audit
Universal soft/hard delete + restore on every entity, audit log of all business-critical actions, polished right-side audit drawer with pretty diff renderer, URL-bound filters with date range, Recent Activity dashboard widget, Bulk Xero Push UI with confirmation + force re-push + result modals, Vehicles + Employees DB-backed CRUD.

### Phase 7 — Pricing Upgrade (Cost vs Sell + Margin)
- New `pricing.view_costs` permission
- Pricing Settings → Cost Inputs (internal) tab with material, labour-per-panel-type, labour-per-finish, transport, overhead
- Calculator → Internal Cost & Margin panel with colour-coded margin pill (green ≥30, amber 15-30, red <15)
- Quote detail → Internal — Margin Analysis collapsible card
- Quote line snapshots freeze BOTH sell and cost numbers — old quotes never change
- Dashboard → "This month — Quoted margin" + "Avg margin %" KPI cards
- **Zero-leak guarantee**: customer-facing print, public magic-link, and the M365 email body never contain any cost or margin info, regardless of viewer permission

### Phase 8 — Reports, Data Export & Power BI Integration
- New **Reports** sidebar entry with 7 detail dashboards: Customers, Quotes, Jobs, Invoices, Vehicles, Employees, Pricing & Margin (admin-only).
- Each report ships KPIs, Recharts visuals (lines, stacked bars, doughnuts, histograms) and a filterable table with `?date_from / ?date_to` pickers + per-report CSV export.
- **Data Export tab** (super admin): bulk CSV dumps for any module (customers, projects, quotes, jobs, invoices, vehicles, employees, audit events) with a 100,000-row hard cap; date range, "All time", and "Include soft-deleted" toggles; capped responses emit `X-Export-Capped: true` plus a trailing marker row.
- **Power BI Integration tab** (super admin): generate long-lived API tokens (raw value shown once, bcrypt-stored), connect via `X-BI-Token` header to read-only `/api/reporting/v1/*` endpoints, manage/revoke tokens with full audit trail.
- BI tokens are scoped strictly to operational reads — recursive scrub strips every `cost_*`, `margin_*`, `internal_*`, `total_cost`, `password*`, `client_secret`, `api_key`, `token_hash` key from responses; cross-route writes/non-reporting routes return 403.
- In-app User Manual gains §17 with end-to-end guidance + Recharts-coloured navigation icons (welcome=yellow, customers=purple, calculator=charcoal, jobs=orange, invoices=green, audit=red, reports=green, …).

---

*This manual is the single source of truth for end users. Every new phase MUST update it (and bump the "last updated" date in §16).*
