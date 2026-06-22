# Iteration 5 — Compliance Forms Pass 2 Completion

## What was implemented

### 1. Device Permissions (app.json)
- Added `NSLocationWhenInUseUsageDescription` to iOS infoPlist
- Added `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `READ_MEDIA_IMAGES` to Android permissions

### 2. iPad 2-Pane Layout (5 screens total)
- **Quotes tab** (`app/(tabs)/quotes.tsx`): List on left (40%) + QuoteDetailPanel on right (60%)
- **Jobs tab** (`app/(tabs)/jobs.tsx`): List on left + JobDetailPanel on right
- **Invoices screen** (`app/invoices/index.tsx`): List + InvoiceDetailPanel
- **Customers screen** (`app/customers/index.tsx`): List + CustomerDetailPanel
- **Forms tab** (already done in iteration 4): List + FormDetailPanel
- All use `useWindowDimensions()` with `width >= 768` threshold
- Selected item highlighted with steel-blue border

### 3. CameraCapture Integration
- `CameraCapture.tsx` wired into `FormDetailPanel.tsx` as a modal
- "Take photo" button opens CameraCapture (native viewfinder on device, ImagePicker fallback on web)
- GPS coords (lat/lng) from expo-location attached to capture result
- Photo uploads now include `lat` and `lng` fields in FormData

### 4. Offline Queue Fix
- Fixed critical bug: `enqueue` (undefined) → `enqueueJsonOp`/`enqueueFileOp`
- Photo uploads now queued via `enqueueFileOp` when offline
- Library photo picks also queued when offline
- Created `outbox.web.ts` web stub to avoid expo-sqlite WASM bundling error on web platform
- Platform-specific files: `outbox.ts` (native + SQLite) and `outbox.web.ts` (web + immediate execution)

## Web-to-Mobile Mapping Decisions
- iPad 2-pane breakpoint: 768px (matches standard iPad portrait width)
- List pane: 40% width, Detail pane: 60% width
- Selected row: 2px steel-blue border with subtle blue background tint
- Placeholder: Icon + text when no item selected

## Known Issues
- CDN preview URL (`expo-concrete-panel-app.preview.emergentagent.com`) cached stale "Preview Unavailable" page
  - Workaround: Use ngrok URL directly (`concrete-panel-app.ngrok.io`) for screenshots
- Camera viewfinder (expo-camera CameraView) only works on native — web gets ImagePicker fallback
- expo-sqlite version warning (SDK compatibility) — functional but shows warning
- Offline banner (acceptance #4) and queue sync (#5) require NetInfo to detect offline state; on web preview the app is always online

## Dependencies
- No new dependencies installed (all already present from iteration 4)
- `expo-camera`, `expo-location`, `expo-sqlite` already installed

## Acceptance Criteria Status
1. ✅ Camera viewfinder: CameraCapture component integrated, "Take photo" button visible in form detail
2. ✅ GPS-tagged photo: lat/lng extracted from expo-location and sent with photo upload
3. ✅ iPad two-pane on 5 tabs: Quotes, Jobs, Forms, Invoices, Customers all confirmed via screenshots
4. ⚠️ Offline mode with pending count: Architecture in place (outbox + NetworkContext + OfflineBanner), but web preview is always online — requires native device for full test
5. ⚠️ Pending-count-zero after sync: Same as above — sync worker runs on reconnect, architecture verified in code
