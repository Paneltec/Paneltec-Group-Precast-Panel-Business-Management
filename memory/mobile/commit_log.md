## Iteration 1 — Initial MVP build
- **Commit**: d31caa1
- **Date**: 2026-06-22
- **Changes**: Initial mobile app build with all core features
- **Files modified**: All mobile files
- **Web files referenced**: All frontend files

## Iteration 2 — Data mapping fixes
- **Commit**: d31caa1
- **Date**: 2026-06-22
- **Changes**: Fixed data mapping issues across detail screens
- **Files modified**: Multiple mobile screens

## Iteration 3 — Compliance Forms Pass 1
- **Commit**: d31caa1
- **Date**: 2026-06-22
- **Changes**: Forms tab, list view, form detail editor with bulk PASS/FAIL/N/A, image attachment, scaffolded SignatureModal and NetworkContext
- **Files modified**: app/(tabs)/forms.tsx, app/forms/[id].tsx, src/components/SignatureModal.tsx, src/contexts/NetworkContext.tsx

## Iteration 4 — Compliance Forms Pass 2
- **Commit**: 1b092c0e33d5c67758d56a76522306be149bc66c
- **Date**: 2026-06-22
- **Changes**:
  - Extracted FormDetailPanel from app/forms/[id].tsx into src/components/FormDetailPanel.tsx
  - Integrated SignatureModal into form detail (base64 capture → multipart upload → transition to signed)
  - Integrated NetworkContext (offline queue for PATCH saves, OfflineBanner at top)
  - Added direct camera capture via ImagePicker.launchCameraAsync()
  - iPad 2-pane layout in forms tab (width >= 768: list 40% + detail 60%)
  - Local form caching via AsyncStorage for offline fallback
  - Camera permissions in app.json (iOS + Android)
  - Signature image display in NCR section when form has signature_url
- **Files modified**: 
  - app/_layout.tsx (NetworkProvider wrapper)
  - app/forms/[id].tsx (thin wrapper)
  - app/(tabs)/forms.tsx (iPad 2-pane layout)
  - app.json (camera permissions)
  - src/components/FormDetailPanel.tsx (NEW - extracted + Pass 2 features)
- **Web files referenced**: None changed (used existing API endpoints)
- **Verification**: Metro bundled 735+ modules, 0 errors. Localhost returns 200. CDN cache preventing external preview screenshots.


## Iteration 5 — Compliance Forms Pass 2 Completion
- **Commit**: 3e4d9fc9223cc5637962c99fd0ac50cc5ded2406
- **Date**: 2026-06-22
- **Changes**:
  - Fixed critical bug: `enqueue` → `enqueueJsonOp`/`enqueueFileOp` in FormDetailPanel
  - Integrated CameraCapture component into FormDetailPanel (native viewfinder + GPS tagging)
  - Photos now include lat/lng GPS coordinates from expo-location
  - Offline photo queuing via outbox: photos enqueued when offline, uploaded on reconnect
  - Platform-split outbox: outbox.ts (native with expo-sqlite) + outbox.web.ts (web no-op stub)
  - iPad 2-pane layout for Quotes tab (QuoteDetailPanel)
  - iPad 2-pane layout for Jobs tab (JobDetailPanel)
  - iPad 2-pane layout for Invoices screen (InvoiceDetailPanel)
  - iPad 2-pane layout for Customers screen (CustomerDetailPanel)
  - Added NSLocationWhenInUseUsageDescription to iOS infoPlist
  - Added ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, READ_MEDIA_IMAGES to Android permissions
- **Files modified**:
  - app.json (location + photo library permissions)
  - app/(tabs)/quotes.tsx (iPad 2-pane with QuoteDetailPanel)
  - app/(tabs)/jobs.tsx (iPad 2-pane with JobDetailPanel)
  - app/invoices/index.tsx (iPad 2-pane with InvoiceDetailPanel)
  - app/customers/index.tsx (iPad 2-pane with CustomerDetailPanel)
  - src/components/FormDetailPanel.tsx (CameraCapture integration, GPS, offline queue fix)
  - src/lib/outbox.ts (native-only with expo-sqlite)
  - src/lib/outbox.web.ts (NEW - web stub to avoid WASM bundling error)
- **Verification**: Metro bundled 870+ modules, 0 errors. All 5 tabs show iPad 2-pane layout. Camera/Photos section visible in form detail. Bundler returns HTTP 200.
