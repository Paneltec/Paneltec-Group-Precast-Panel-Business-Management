# Paneltec Group — Auth Testing Guide (Phase 1)

## Mechanism
- Custom JWT (HS256), 12 hour expiry.
- Token returned in JSON: `{ "access_token": "<jwt>", "token_type": "bearer", "user": {...} }` from `POST /api/auth/login`.
- Frontend stores it in `localStorage["paneltec_token"]` and attaches `Authorization: Bearer <token>` to every API call (see `/app/frontend/src/lib/api.js`).

## How a tester obtains a session

### curl
```bash
API="$REACT_APP_BACKEND_URL"
curl -s -X POST "$API/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@paneltec.com.au","password":"Paneltec2026!"}'
```
Response:
```json
{
  "access_token": "<JWT>",
  "token_type": "bearer",
  "user": { "id": "...", "email": "admin@paneltec.com.au", "role": "admin", ... }
}
```

Use the JWT:
```bash
curl -s "$API/api/auth/me" -H "Authorization: Bearer <JWT>"
```

### Playwright UI
1. Navigate to `/login`.
2. Fill `data-testid="login-email-input"` and `data-testid="login-password-input"`.
3. Click `data-testid="login-submit-button"`.
4. App stores JWT in localStorage and redirects to `/`.
5. To logout: open `data-testid="user-menu-trigger"` then click `data-testid="logout-btn"`.

## Seeded accounts

| Role  | Email                  | Password       |
|-------|------------------------|----------------|
| admin | admin@paneltec.com.au  | Paneltec2026!  |
| staff | staff@paneltec.com.au  | Staff2026!     |

## RBAC checks

- Staff user → `GET /api/users` returns **403**.
- Staff user → `PUT /api/settings/pricing` returns **403**.
- Staff user UI → `/users` and `/settings/pricing` redirect back to `/`. Sidebar hides those links.
- Admin user → full access.

## Wrong password
`POST /api/auth/login` with bad password → **401 "Invalid email or password"**.
