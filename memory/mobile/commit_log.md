# Paneltec Group Mobile — Commit Log

## Iteration 1 — Initial scaffolding (prior agent)
- **Commit**: 205ff86f53094f2dd4870192e2244510819dfb1f
- **Changes**: Installed deps, created 20+ files (screens, components, contexts, utilities)
- **Files created**: All files under `app/`, `src/lib/`, `src/contexts/`, `src/components/`
- **Web files referenced**: Full frontend/src/ tree
- **Status**: Unverified — no compilation or screenshot check

## Iteration 2 — Stabilization, bug fixes, entry point
- **Commit**: ba81737c5f9fc960da0ce84a369bd41711fdde4b
- **Date**: 2026-06-16
- **Changes**:
  - Fixed `app/index.tsx` to redirect based on auth + `must_change_password`
  - Fixed `line.line_total` → `line.total_aud` in quote/job/invoice detail screens
  - Fixed `StatusBadge` crash on undefined status (added null guard)
  - Fixed `h.status` → `h.to` in job status history
  - Fixed customer name fetch in quote/job/invoice detail screens (detail endpoints don't include `customer_company_name`)
  - Downgraded `@react-native-async-storage/async-storage` 3.1.1→2.2.0, `expo-secure-store` 56.0.4→15.0.8
  - Created `app/force-password-change.tsx` — full ForcePasswordChange screen
  - Added force-password-change route to `app/_layout.tsx` with `gestureEnabled: false`
  - Added `must_change_password` guard in `(tabs)/_layout.tsx`
  - Exported `usePermission(key)` hook from `AuthContext`
  - Added 403 `password_change_required` interceptor in `api.ts` with event bus
  - Added margin KPIs to Dashboard (gated on `kpis.quoted_margin_this_month_aud !== undefined`)
  - Added `InternalCostPanel` to Calculator (gated on `result.internal_cost_breakdown`)
  - Wired `onPasswordChangeRequired` listener in AuthContext
- **Files modified**: `app/index.tsx`, `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/calculator.tsx`, `app/quotes/[id].tsx`, `app/jobs/[id].tsx`, `app/invoices/[id].tsx`, `src/contexts/AuthContext.tsx`, `src/lib/api.ts`, `src/components/StatusBadge.tsx`
- **Files created**: `app/force-password-change.tsx`
- **Web files referenced**: `ForcePasswordChange.jsx`, `Calculator.jsx`, `Dashboard.jsx`, `ProtectedRoute.jsx`, `AuthContext.jsx`
