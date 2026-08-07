# Paneltec Group — Production Deployment Guide

**Audience:** ops / DevOps engineer taking Paneltec Group from the Emergent
preview URL to a real production domain.

**Assumes:** you can SSH into the target host (or shell into the Kubernetes
pod), MongoDB is either self-hosted or you have a managed cluster URI ready,
and you own DNS for the production domain (`app.paneltec.com.au` in the
examples below — substitute your own).

---

## 0 · What ships in this repo

| Piece | Path | Prod command |
|---|---|---|
| FastAPI backend | `/app/backend/` | `uvicorn server:app --host 0.0.0.0 --port 8001 --workers 4 --no-server-header --proxy-headers` |
| React frontend  | `/app/frontend/` | build once with `yarn build`, serve via `serve -s build -l tcp://0.0.0.0:3000` |
| MongoDB seed    | `/app/backend/server.py :: seed_database()` | runs on every backend start, idempotent |
| Env templates   | `backend/.env.example`, `frontend/.env.example` | copy to `.env` and fill |
| Prod supervisor | `/app/supervisor.production.conf` | replace the units in `/etc/supervisor/conf.d/supervisord.conf` |

---

## Phase A — Pre-flight (before you touch prod)

1. Verify the four deployment blockers listed in the readiness report are
   already merged into the deploy branch:
   - Blocker 1: `SEED_MODE=prod` refuses to seed without explicit
     `SEED_*_PASSWORD`; new seed users get `must_change_password: True`.
   - Blocker 2: `POST /api/auth/login` is rate-limited (5 fails / 15 min
     with per-IP 15-second micro-cooldown).
   - Blocker 3: `CORS_ORIGINS` cannot be `"*"` when `allow_credentials=True`
     and `SEED_MODE=prod`.
   - Blocker 4: frontend served by `serve`, backend served by uvicorn with
     workers=4 and no `--reload`.

2. Run the full test suite locally.

3. Confirm you can generate a fresh JWT secret:
   ```
   python3 -c 'import secrets; print(secrets.token_urlsafe(64))'
   ```

## Phase B — Environment file

4. `cp /app/backend/.env.example /app/backend/.env` and fill:

```
MONGO_URL="mongodb+srv://<user>:<pass>@<cluster>/paneltec_prod?retryWrites=true&w=majority"
DB_NAME="paneltec_prod"
CORS_ORIGINS="https://app.paneltec.com.au"
JWT_SECRET="<paste the fresh 64-char token>"
JWT_EXPIRES_HOURS="8"
SEED_MODE="prod"
SEED_ADMIN_EMAIL="owner@paneltec.com.au"
SEED_ADMIN_PASSWORD="<one-time strong random, 20+ chars>"
SEED_STAFF_EMAIL="<real onboarding email>"
SEED_STAFF_PASSWORD="<disposable strong string>"
SEED_PROD_EMAIL="<production lead email>"
SEED_PROD_PASSWORD="<disposable strong string>"
SEED_FORCE_CHANGE_PASSWORD="true"
LOGIN_MAX_FAILS="5"
LOGIN_WINDOW_SEC="900"
LOGIN_IP_COOLDOWN_SEC="15"
TIGRIS_ENDPOINT="<prod S3-compatible endpoint>"
TIGRIS_ACCESS_KEY_ID="<key id>"
TIGRIS_SECRET_ACCESS_KEY="<secret>"
TIGRIS_BUCKET="paneltec-prod"
```

5. `cp /app/frontend/.env.example /app/frontend/.env` and set:

```
REACT_APP_BACKEND_URL="https://app.paneltec.com.au"
```

6. Store `.env` files in a secret manager (HashiCorp Vault, 1Password, AWS
   Secrets Manager, etc.). Never commit them.

## Phase C — Build the frontend

```
cd /app/frontend
yarn install --frozen-lockfile
yarn build
```

Verify:
```
ls -lh build/static/js/main.*.js       # expect ~1.6 MB, gzipped ~420 kB
ls -lh build/static/css/*.css          # expect ~77 kB
```

## Phase D — Switch supervisor to production units

7. Back up the current supervisor config:
   ```
   sudo cp /etc/supervisor/conf.d/supervisord.conf \
           /etc/supervisor/conf.d/supervisord.dev.bak
   ```

8. Replace the `[program:backend]` and `[program:frontend]` blocks with
   the contents of `/app/supervisor.production.conf`. Keep other programs
   (`mongodb`, `nginx-code-proxy`, `webhook-crond`) unless you have a
   reason to change them.

9. Apply and restart:
   ```
   sudo supervisorctl reread
   sudo supervisorctl update
   sudo supervisorctl restart backend frontend
   sudo supervisorctl status
   ```

10. Tail the backend log for a clean boot. You should see:
    - `Seeded user: <SEED_ADMIN_EMAIL> (Administrator) · force_change=True`
    - No `[cors] wildcard` warning (you set a real domain).
    - No `[security] Default seed password …` warning (you set explicit
      passwords).
    - No `Duplicate Operation ID` warnings.
    - `[ai-heal] promoted …` line if you have connected AI providers.

## Phase E — First-run application setup

11. Open `https://app.paneltec.com.au/login`.
12. Sign in as `SEED_ADMIN_EMAIL` with the one-time password. The app
    force-redirects to `/force-password-change` — set the permanent
    admin password.
13. In-app: **Admin Settings → AI Providers** — connect OpenAI, Anthropic,
    or Google as required. Same page for Tavily (**Web Search**).
14. **Settings → Integrations** — enable Simpro if you have credentials.
    Xero / M365 / Navixy remain MOCKED until Phase 4 Part 2b lands.
15. **Admin Settings → Company Details** — set business name, ABN,
    ACN, address, phone, bank details, invoice footer note.
16. **Settings → Pricing** — verify the seeded pricing sheet matches
    Paneltec's current commercial values. Edit inline as needed.
17. Create real user accounts via **Users** page (each new user is
    seeded with `must_change_password: True`).
18. Optional smoke test:
    - `Calculator` — punch in a real panel spec, verify the total.
    - `Compliance Forms` — issue a signed form.
    - `AI Standards Check` on the compliance templates list (rate limit
      20 / hour, in-memory).

## Phase F — Go-live checklist

19. DNS: point the production domain at your reverse proxy (Cloudflare,
    nginx, cloud LB). Ensure TLS is terminated ahead of the app.
20. External monitoring:
    - Uptime probe on `GET /api/health` (returns `{status:"ok"}`).
    - Log forwarding on `/var/log/supervisor/backend.err.log` and
      `frontend.err.log`.
    - Audit trail export (nightly `mongodump` of `paneltec_prod`).
21. Backup strategy — the app has no on-app backup UI. Suggested minimum:
    - Nightly `mongodump` to an off-site bucket, 30-day retention.
    - Weekly full restore test into a scratch DB.
22. Rotation cadence:
    - `JWT_SECRET` every 90 days (invalidates all sessions — announce).
    - Provider API keys (OpenAI, Tavily, Simpro) per your compliance SLA.
    - Tigris keys every 90 days.

## Rollback

If something is wrong after Phase D:
```
sudo mv /etc/supervisor/conf.d/supervisord.dev.bak \
        /etc/supervisor/conf.d/supervisord.conf
sudo supervisorctl reread && sudo supervisorctl update
sudo supervisorctl restart backend frontend
```
Data is unaffected (the seed migration is idempotent and additive-only).

---

## Environment variable reference

See `/app/backend/.env.example` and `/app/frontend/.env.example` for the
full, commented list. Every value in those files is either required or has
a documented default; nothing else is read from the environment.
