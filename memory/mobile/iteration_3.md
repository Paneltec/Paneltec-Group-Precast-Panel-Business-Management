# Iteration 3 — Compliance Forms (Phase 10)

## What was implemented

### Forms Tab (6th tab)
- Added to bottom nav bar, gated on `forms.view` permission
- Tab order: Home · Calculator · Quotes · Jobs · Forms · More
- Steel blue active, grey inactive (matches CONQA aesthetic)

### Forms List Screen (`app/(tabs)/forms.tsx`)
- Type filter chips: All / Pre-Pour / Post-Pour / Cert
- Status filter chips: All / Draft / Completed / Signed
- Search bar
- Form rows showing: form_number, form_type label, panel_id, status pill, date
- "+ New Form" button (gated on `forms.create`) → modal with form type picker, panel ID, optional job link
- Pull-to-refresh

### Form Detail/Editor (`app/forms/[id].tsx`)
- Header: schema title, form number, status badge, QA Report PDF button
- Progress bar: completed criteria / total criteria
- Meta fields: Panel ID, Client, Date of Inspection, Grade of Concrete
- **Pre-Pour & Post-Pour forms**: Section cards from server schema
  - PASS/FAIL/N/A segmented control per section (bulk-applies to all criteria)
  - Per-criterion ✓/✗/N/A buttons, value input (with unit), notes textarea
  - Defects editor (post-pour): add/remove defect rows with location/description/remedy
- **Compliance Cert forms**: Header fields, Schedule of Elements, Declaration text, Signatory
- Photos zone: upload button (expo-image-picker), thumbnail grid, delete
- NCR & Sign-off: NCR raised checkbox + reference field, signed-at banner
- Bottom action bar: Save Draft, Mark Complete, Sign (gated on `forms.sign`), Revert

### API Integration
- `apiUpload()` function for multipart FormData (photo uploads)
- All endpoints match web frontend: `/api/compliance-forms`, `/api/compliance-forms/{id}`, PATCH, transition, photos

## Permission Gating (3 personas verified)
| Feature | Admin (super) | Staff (estimator) | Production |
|---------|---------------|-------------------|------------|
| Forms tab visible | ✅ | ❌ Hidden | ✅ |
| Create form (+) | ✅ | N/A | ✅ |
| Sign button | ✅ | N/A | ❌ Hidden |
| Calculator $5,623.20 | ✅ | ✅ | ✅ |

## Dependencies installed
- `expo-image-picker@17.0.11` (SDK 54 compatible)
- `expo-web-browser@15.0.11` (SDK 54 compatible)

## Known issues / deferred to Pass 2
- **Offline support**: Not implemented — forms require network. CONQA-style offline queue deferred.
- **Signature canvas**: Not implemented — sign action calls API directly without canvas capture.
- **iPad two-pane layout**: Not implemented — single-column on all screen sizes.
- **Camera capture**: Uses image picker from library only, not direct camera. `expo-camera` deferred.
- **Photo thumbnails**: API-served images may require auth headers; currently use direct URL.
