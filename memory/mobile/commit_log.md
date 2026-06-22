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
  - Fixed `app/index.tsx` entry point redirect
  - Fixed `line.line_total` → `line.total_aud` in all detail screens
  - Fixed `StatusBadge` crash on undefined status
  - Fixed job status history `h.status` → `h.to`
  - Fixed customer name fetch in detail screens
  - Created ForcePasswordChange screen, added API interceptor for 403
  - Added margin KPIs to Dashboard, InternalCostPanel to Calculator
  - Exported `usePermission` hook from AuthContext
- **Files modified**: 11 files
- **Files created**: `app/force-password-change.tsx`

## Iteration 3 — Compliance Forms (Phase 10)
- **Commit**: 4aeea975599e3d4b01f6915779097ae7a2d7e6bd
- **Date**: 2026-06-22
- **Changes**:
  - Added Forms tab (6th tab) to bottom nav, permission-gated on `forms.view`
  - Created Forms list screen (`app/(tabs)/forms.tsx`) with type/status filter chips, search, create modal
  - Created Form detail/editor screen (`app/forms/[id].tsx`) with full CONQA-style UI:
    - Section-level PASS/FAIL/N/A segmented controls with bulk-apply
    - Per-criterion ✓/✗/N/A buttons with value inputs and notes
    - Progress bar (completed/total criteria)
    - Defects editor for post-pour forms
    - Compliance Certificate editor for cert forms
    - Photo upload zone (expo-image-picker)
    - NCR & Sign-off section
    - QA Report PDF button (expo-web-browser)
    - State transitions: Save Draft → Mark Complete → Sign / Revert
  - Added `apiUpload()` for multipart FormData uploads to `src/lib/api.ts`
  - Updated tab layout to 6 tabs: Home, Calculator, Quotes, Jobs, Forms, More
  - Installed `expo-image-picker@17.0.11`, `expo-web-browser@15.0.11`
- **Files modified**: `app/(tabs)/_layout.tsx`, `app/_layout.tsx`, `src/lib/api.ts`
- **Files created**: `app/(tabs)/forms.tsx`, `app/forms/[id].tsx`
- **Web files referenced**: `FormsList.jsx`, `FormDetail.jsx`, `compliance_schema.py`
- **Regression verified**: Calculator $5,623.20 ✅, Dashboard margin KPIs ✅, all existing tabs ✅
