# Iteration 2 — Stabilization + ForcePasswordChange + Permission Gating

## What was implemented
- **ForcePasswordChange screen** (`app/force-password-change.tsx`): Lock icon, current/new/confirm password fields, POSTs to `/api/auth/change-password`, sign-out link, blocks tab navigation
- **Permission gating**:
  - Dashboard: Margin KPIs (Quoted Margin $, Avg Margin %) conditionally rendered when `kpis.quoted_margin_this_month_aud` is present in API response
  - Calculator: InternalCostPanel (cost breakdown + margin pill) rendered when `result.internal_cost_breakdown` is present
  - More tab: Menu items already gated by previous agent (Customers requires `customers.view`, Invoices requires `invoices.view`)
- **API interceptor**: 403 responses with `code: password_change_required` trigger event bus → AuthContext sets `must_change_password: true` → redirects to force-password-change
- **Bug fixes**: line_total→total_aud, StatusBadge null guard, job history h.status→h.to, customer name fetch in detail screens

## Web-to-mobile mapping decisions
- `ForcePasswordChange.jsx` → `app/force-password-change.tsx` (stack screen, no tab bar)
- Dashboard margin KPIs: Backend gates data by permission (returns field or not), mobile renders conditionally — same pattern as web
- Calculator ICB: Backend gates `internal_cost_breakdown` by `pricing.view_costs`, mobile renders when present — same as web
- Detail screens are read-only (no action buttons like Send, Mark Accepted, etc.) — no additional permission gating needed for these

## Smoke test results (3 personas)
| Feature | Admin | Staff (Estimator) | Production |
|---------|-------|-------------------|------------|
| Dashboard margin KPIs | ✅ Visible | ✅ Hidden | ✅ Hidden |
| Calculator ICB panel | ✅ Visible ($3,053.16 / 59.7%) | ✅ Hidden | ✅ Hidden |
| Calculator total $5,623.20 | ✅ | ✅ | ✅ |
| More → Customers | ✅ | ✅ | ✅ |
| More → Invoices | ✅ | ✅ | ✅ |
| Force password change screen | ✅ Renders | ✅ Renders | ✅ Renders |

## Dependencies installed
- Downgraded: `@react-native-async-storage/async-storage@2.2.0`, `expo-secure-store@15.0.8`

## Known issues / deferred
- Detail screens (Quote/Job/Invoice) are read-only — no action buttons (Send, Mark Accepted, Advance Status, Mark Paid, etc.) exist to gate
- ESLint v9 flat config not set up (cosmetic, doesn't affect build)
- `shadow*` style deprecation warnings (cosmetic, SDK 54 web rendering)
