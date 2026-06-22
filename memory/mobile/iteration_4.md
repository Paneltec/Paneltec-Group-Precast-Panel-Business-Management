## Iteration 4 — Compliance Forms Pass 2

### What was implemented
1. **SignatureModal Integration** — Wired up the existing `SignatureModal.tsx` into the form detail. When a user clicks "Sign" on a completed form, the signature modal opens. The user draws a signature → confirms → the base64 PNG is uploaded via `POST /api/compliance-forms/{id}/signature` → the form is transitioned to "signed" status. The signature image is then displayed in the NCR & Sign-off section.

2. **NetworkContext (Offline Queue) Integration** — Wrapped the app with `<NetworkProvider>` in `app/_layout.tsx`. The `OfflineBanner` component appears at the top of the form detail when offline or when pending sync items exist. When saving while offline, form data is queued to AsyncStorage via `enqueue()` and synced automatically on reconnect. Photo and signature uploads require online (user is alerted if offline).

3. **Camera Capture** — Added a "Take photo" button alongside the "From library" button in the PhotoZone. Uses `ImagePicker.launchCameraAsync()` with camera permission request. Both buttons are visible when the form is not locked.

4. **iPad 2-Pane Layout** — Modified `app/(tabs)/forms.tsx` to detect tablet width (>= 768px). On iPad, the forms list occupies 40% width on the left and the `FormDetailPanel` occupies 60% on the right. Selected forms are highlighted with a blue border. On phone, navigation remains unchanged (push to separate screen).

5. **FormDetailPanel Extraction** — Extracted the full form detail logic from `app/forms/[id].tsx` into `src/components/FormDetailPanel.tsx` as a reusable component accepting `formId` prop. The `app/forms/[id].tsx` is now a thin wrapper. This enables the iPad 2-pane layout to render the detail panel inline.

6. **Local Caching** — Form data is cached to AsyncStorage after each successful load. When offline, the cached version is used as fallback so users can continue viewing/editing.

7. **Camera Permissions** — Added `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` (iOS) and `CAMERA` permission (Android) to `app.json`.

### Web-to-Mobile mapping decisions
- SignatureModal uses HTML5 Canvas on web (for preview testing) and `react-native-signature-canvas` on native
- Offline queue uses AsyncStorage (JSON serializable operations only; file uploads require online)
- iPad detection uses `useWindowDimensions()` with 768px breakpoint

### Known issues / deferred items
- External CDN preview URL shows cached "Preview Unavailable" page (infrastructure issue, not code). The app compiles and runs correctly locally.
- The `@react-native-community/netinfo` version warning (12.0.1 vs expected 11.4.1) is non-blocking
- Shadow deprecation warnings are pre-existing and cosmetic

### Dependencies installed
- No new dependencies (all were already installed: expo-image-picker, expo-web-browser, @react-native-community/netinfo, react-native-signature-canvas, @react-native-async-storage/async-storage)

### Files modified
- `app/_layout.tsx` — Added NetworkProvider wrapper
- `app/forms/[id].tsx` — Rewritten as thin wrapper around FormDetailPanel
- `app/(tabs)/forms.tsx` — iPad 2-pane layout with FormDetailPanel
- `app.json` — Camera permissions
- `src/components/FormDetailPanel.tsx` — NEW: extracted form detail with all Pass 2 features

### Compilation verified
- Metro Bundler: 735+ modules compiled successfully, 0 errors
- localhost:3001 returns HTTP 200
