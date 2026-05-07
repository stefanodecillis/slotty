# Slotty

A self-hosted, single-user scheduling app — like Calendly, but yours.

Connect multiple Google Workspace calendars, share a public booking link, and let bookers pick a slot that's automatically respected across every calendar you own. Confirmed bookings land on the right calendar with a working Google Meet link.

- Single binary deploy (one Docker container, one volume, one `.env`)
- Material You design — pick a brand color, the whole UI re-themes
- Public booking page works on mobile, fast, accessible
- Never double-books across multiple Google accounts
- Designed to sit behind a reverse proxy (Caddy / Nginx / Traefik)

> **Status:** All ten phases shipped. The MVP is feature-complete: setup wizard, password + 2FA admin auth, Google Calendar integration with multi-account sync, availability rules + holidays, event types with custom questions and password-gated links, public booking flow with reschedule/cancel, ICS attachments, audit log, outgoing webhooks, security middleware, and end-to-end tests.

---

## Table of contents

1. [Quick start (Docker)](#quick-start-docker)
2. [Local development](#local-development)
3. [Environment variables](#environment-variables)
4. [Generating secrets](#generating-secrets)
5. [Google OAuth setup](#google-oauth-setup)
6. [SMTP / email](#smtp--email)
7. [Reverse proxy](#reverse-proxy)
8. [First-run setup](#first-run-setup)
9. [Production deployment](#production-deployment)
10. [Security model](#security-model)
11. [Performance](#performance)
12. [Backup & restore](#backup--restore)
13. [Migration from Calendly / Cal.com](#migration-from-calendly--calcom)
14. [Architecture](#architecture)
15. [Troubleshooting](#troubleshooting)
16. [License](#license)

---

## Quick start (Docker)

The fastest way to get running. Assumes you have Docker + a reverse proxy (Caddy in the example below) on a server with a public DNS record.

```bash
# 1. Clone and prepare config
git clone https://github.com/slotty/slotty.git
cd slotty
cp .env.example .env

# 2. Generate the two required secrets and write them into .env
bun run scripts/generate-encryption-key.ts --write
#   (or, without bun installed, run the equivalent openssl commands shown below)

# 3. Edit .env — at minimum set:
#    SLOTTY_PUBLIC_URL=https://book.example.com
#    SLOTTY_GOOGLE_CLIENT_ID=...     (see "Google OAuth setup")
#    SLOTTY_GOOGLE_CLIENT_SECRET=...
#    SLOTTY_SMTP_*                   (see "SMTP / email")

# 4. Boot the app
cp docker-compose.example.yml docker-compose.yml
docker compose up -d

# 5. Point Caddy (or Nginx/Traefik) at 127.0.0.1:3000
cp Caddyfile.example /etc/caddy/Caddyfile      # adjust domain + IP allowlist for /admin
sudo systemctl reload caddy

# 6. Visit https://book.example.com/setup to create your admin account.
```

**Without bun installed**, you can generate the secrets with `openssl`:

```bash
echo "SLOTTY_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
echo "SLOTTY_SESSION_SECRET=$(openssl rand -base64 64)" >> .env
```

---

## Local development

Slotty uses [Bun](https://bun.sh) for tooling and Node 20+ as the runtime (Next.js prod server runs on Node).

```bash
# Install Bun if you don't have it
curl -fsSL https://bun.sh/install | bash

# Install Node 20 if you don't have it (use nvm or fnm)
nvm install 20

# Install deps
bun install

# Configure .env
cp .env.example .env
bun run scripts/generate-encryption-key.ts --write

# Apply database migrations (creates data/slotty.db)
bunx prisma migrate dev

# Start the dev server
bun run dev
# → http://localhost:3000
```

Then visit <http://localhost:3000/setup> to create the admin account.

### Useful scripts

| Command | What it does |
|---|---|
| `bun run dev` | Next.js dev server (Bun runtime) on port 3000 |
| `bun run build` | Production build (`prisma generate && next build`) |
| `bun run start` | Production server (Node runtime) |
| `bun run lint` | ESLint |
| `bun run typecheck` | `tsc --noEmit` with strict + `noUncheckedIndexedAccess` |
| `bun test` | Unit + integration tests via Bun's test runner |
| `bun run test:e2e` | Build + Playwright end-to-end tests (Chromium, requires `bunx playwright install chromium` first) |
| `bun run test:load` | Hit the slot endpoint with 100 concurrent connections via autocannon and assert p95 latency budget |
| `bun run audit:security` | Static security audit (admin-CSRF / requireUser, public POST rate limits, raw `console.*`, unsafe inline-HTML insertion) |
| `bun run db:migrate` | Create + apply a new Prisma migration |
| `bun run db:studio` | Open Prisma Studio (GUI for the DB) |
| `bun run key:generate` | Print fresh `SLOTTY_ENCRYPTION_KEY` + `SLOTTY_SESSION_SECRET`. Add `--write` to append to `.env` |
| `bun run theme:generate '#FF5733'` | Print the M3 CSS variables for a given seed color |
| `bun run cli reset-password` | Emergency admin password reset (Phase 1) |

---

## Environment variables

Set these in `.env` (loaded by Next.js automatically) or in your container env. They are validated at startup — the app refuses to boot if any required var is missing or weak.

### Required

| Variable | Description |
|---|---|
| `SLOTTY_PUBLIC_URL` | Public URL where Slotty is reachable (no trailing slash). E.g. `https://book.example.com`. Used to construct OAuth callback URLs and email links. |
| `SLOTTY_ENCRYPTION_KEY` | **32 random bytes, base64-encoded.** Encrypts OAuth tokens, SMTP passwords, TOTP secrets at rest. The app refuses to start if this is missing or decodes to fewer than 32 bytes. **Rotating this invalidates every encrypted secret in the DB.** |
| `SLOTTY_SESSION_SECRET` | ≥ 32 character random string. Used to sign session cookies. |
| `SLOTTY_DATABASE_URL` | DB connection string. Default: `file:../data/slotty.db` (SQLite — Prisma resolves relative paths from `prisma/`, so `../data/` puts the file at the project root). For Postgres: `postgresql://user:pass@host:5432/slotty`. |

### Required for Google calendar integration

| Variable | Description |
|---|---|
| `SLOTTY_GOOGLE_CLIENT_ID` | OAuth 2.0 client ID from Google Cloud Console. See [Google OAuth setup](#google-oauth-setup). |
| `SLOTTY_GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret. |

### Required for sending email (confirmations, reminders, cancellations)

| Variable | Description |
|---|---|
| `SLOTTY_SMTP_HOST` | SMTP server host. |
| `SLOTTY_SMTP_PORT` | SMTP port. `587` (STARTTLS) or `465` (SMTPS). |
| `SLOTTY_SMTP_USER` | SMTP username. |
| `SLOTTY_SMTP_PASS` | SMTP password (encrypted at rest if changed via admin UI). |
| `SLOTTY_SMTP_FROM` | From-address, e.g. `Slotty <noreply@example.com>`. |

### Optional

| Variable | Default | Description |
|---|---|---|
| `SLOTTY_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `SLOTTY_TURNSTILE_SITE_KEY` | unset | Cloudflare Turnstile site key. If both Turnstile vars are set, the public booking form requires a captcha. |
| `SLOTTY_TURNSTILE_SECRET` | unset | Turnstile secret key. |
| `SLOTTY_SENTRY_DSN` | unset | If set, unhandled errors are reported to Sentry. |
| `SLOTTY_TRUST_PROXY` | `true` | Honor `X-Forwarded-For` / `X-Forwarded-Proto` from the reverse proxy. Disable only if you expose Slotty directly. |

---

## Generating secrets

Both `SLOTTY_ENCRYPTION_KEY` and `SLOTTY_SESSION_SECRET` must be cryptographically random. **Never reuse a key between environments.**

```bash
# With Bun installed
bun run key:generate                # prints to stdout
bun run key:generate --write        # appends to .env (creates from .env.example if missing)

# Without Bun
openssl rand -base64 32             # SLOTTY_ENCRYPTION_KEY
openssl rand -base64 64             # SLOTTY_SESSION_SECRET
```

If you ever lose `SLOTTY_ENCRYPTION_KEY`, every connected Google account will need to be re-authenticated and the SMTP password re-entered. Bookings, schedules, and event types are not affected.

---

## Google OAuth setup

Slotty needs OAuth credentials to read your calendars and create events.

1. Go to <https://console.cloud.google.com/projectcreate> and create a new project (or pick an existing one).
2. **Enable APIs:** APIs & Services → Library → enable **Google Calendar API**.
3. **OAuth consent screen:**
   - User type: *External* (works for personal Gmail too) or *Internal* (Workspace only).
   - App name: `Slotty` (or whatever you prefer).
   - Add yourself as a Test user.
   - Scopes: add
     - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
     - `https://www.googleapis.com/auth/calendar.readonly`
     - `https://www.googleapis.com/auth/calendar.events`
4. **Credentials → Create Credentials → OAuth client ID:**
   - Application type: **Web application**.
   - Authorized redirect URIs: `${SLOTTY_PUBLIC_URL}/api/admin/calendars/callback`
     (e.g. `https://book.example.com/api/admin/calendars/callback`)
5. Copy the **Client ID** and **Client secret** into your `.env`:
   ```
   SLOTTY_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   SLOTTY_GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```
6. Restart Slotty.

You can connect multiple Google accounts (e.g., one per job) from **Admin → Calendars** once Phase 3 is shipped.

---

## SMTP / email

Slotty doesn't send marketing email — only transactional messages tied to bookings (confirmations, reminders, reschedules, cancellations). Any SMTP relay works:

- **Postmark / SendGrid / Mailgun / Amazon SES** — provide host, port 587, API user + key.
- **Personal mailbox** (Gmail with App Password, Fastmail, etc.) — fine for low volume.
- **Self-hosted** (Postfix, Maddy) — also works.

Test it from **Admin → Settings → Email → Send test email** once Phase 2 is shipped.

---

## Reverse proxy

The container listens on plain HTTP. **Always run it behind a reverse proxy that terminates TLS.** Examples:

### Caddy (recommended for simplicity)

`Caddyfile.example` ships with the repo. The key idea:

```caddy
book.example.com {
    @admin path /admin* /api/admin/*
    @admin_allowed remote_ip 192.168.0.0/16 100.64.0.0/10
    handle @admin {
        @blocked not remote_ip 192.168.0.0/16 100.64.0.0/10
        respond @blocked 403
        reverse_proxy 127.0.0.1:3000
    }

    # /api/webhooks/google must remain reachable from Google's IPs.
    reverse_proxy 127.0.0.1:3000
}
```

Edit the IP ranges to match your home / VPN / Tailscale CIDR.

### Nginx

```nginx
location /admin {
    allow 192.168.0.0/16;
    allow 100.64.0.0/10;
    deny all;
    proxy_pass http://127.0.0.1:3000;
}
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Traefik

Use the `ipWhiteList` middleware on the `/admin` router. Webhooks at `/api/webhooks/*` should not have the middleware applied.

> **Why allowlist `/admin`?** It's a single-user app — there's no reason for the rest of the internet to even see the login page. Browser-based attacks on the admin panel become trivially blocked. This complements (does not replace) the in-app password + 2FA auth.

---

## First-run setup

1. Visit `https://<your-domain>/setup` from an allowlisted IP.
2. Create your admin account (pick whatever password you want — Slotty only blocks the very common ones).
3. Sign in at `/admin/login`.
4. Connect your Google accounts at `/admin/calendars`.
5. Configure your default schedule at `/admin/availability`.
6. Create your first event type at `/admin/event-types`.
7. Share your booking link: `https://<your-domain>/<event-slug>`.

The `/setup` route 404s once an admin account exists. To recover from a forgotten password without database access, run:

```bash
docker exec -it slotty bun run cli reset-password <username>
```

---

## Production deployment

A complete walkthrough for putting Slotty on a single host behind Caddy on Ubuntu / Debian. Adjust paths to taste.

### 1. Prerequisites

- A small VPS with a public IP and a DNS A-record pointing at it.
- Docker + Docker Compose v2 (`docker compose version`).
- Caddy 2 installed natively on the host (`apt install caddy`) **or** as a sibling container.
- A Google Cloud project with Calendar API enabled and OAuth credentials issued for `https://book.example.com/api/admin/calendars/callback`.

### 2. Install

```bash
# Pick a deploy directory.
sudo mkdir -p /opt/slotty
cd /opt/slotty

# Pull the example configs.
sudo curl -fsSL -o docker-compose.yml \
  https://raw.githubusercontent.com/slotty/slotty/main/docker-compose.example.yml
sudo curl -fsSL -o .env.example \
  https://raw.githubusercontent.com/slotty/slotty/main/.env.example
sudo cp .env.example .env

# Generate secrets directly into .env.
docker run --rm -v "$PWD":/app -w /app oven/bun:1 \
  bun run scripts/generate-encryption-key.ts --write
```

Edit `/opt/slotty/.env`:

```ini
SLOTTY_PUBLIC_URL=https://book.example.com
SLOTTY_GOOGLE_CLIENT_ID=…apps.googleusercontent.com
SLOTTY_GOOGLE_CLIENT_SECRET=GOCSPX-…
SLOTTY_SMTP_HOST=smtp.example.com
SLOTTY_SMTP_PORT=587
SLOTTY_SMTP_USER=postmaster@example.com
SLOTTY_SMTP_PASS=…
SLOTTY_SMTP_FROM=Slotty <bookings@example.com>
SLOTTY_TRUST_PROXY=true
SLOTTY_LOG_LEVEL=info
```

### 3. Caddy configuration

Drop in `/etc/caddy/Caddyfile` (or `Caddyfile.d/slotty.caddy` if you use `import`):

```caddy
book.example.com {
    encode zstd gzip
    log {
        output file /var/log/caddy/slotty.log
        format json
    }

    # /admin is single-user — restrict it to your home / Tailscale ranges.
    @admin {
        path /admin* /api/admin/*
        not remote_ip 192.168.0.0/16 100.64.0.0/10
    }
    handle @admin {
        respond "Forbidden" 403
    }

    # Everything else is public; Google's webhook lives at /api/webhooks/google
    # and must remain publicly reachable.
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto https
    }
}
```

```bash
sudo systemctl reload caddy
```

### 4. systemd service for Docker Compose

If you prefer systemd over `docker compose up -d`, drop this in `/etc/systemd/system/slotty.service`:

```ini
[Unit]
Description=Slotty (self-hosted scheduling)
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/slotty
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now slotty
journalctl -u slotty -f
```

### 5. First-run + smoke test

```bash
# Health check (Caddy strips no headers, so this is reachable from anywhere):
curl -fsSL https://book.example.com/api/health
# {"status":"ok",...}
```

Visit `https://book.example.com/setup` from an allow-listed IP, create the admin account, then connect Google + configure availability.

### 6. Updates

```bash
cd /opt/slotty
docker compose pull && docker compose up -d --remove-orphans
docker image prune -f
```

The schema migrates automatically on container start (`prisma migrate deploy`).

---

## Security model

Slotty is built around a "single owner, public booking surface" threat model.

- **Single user, single deploy.** The `/setup` route accepts exactly one User row. After that it's permanently 410.
- **/admin behind an IP allowlist.** The reverse proxy gates `/admin/*` and `/api/admin/*` to a CIDR you trust (LAN, VPN, Tailscale, etc.). This is defense in depth — even if there's a future auth bug, the random internet can't reach the panel.
- **Argon2id for the admin password.** With the OWASP-recommended params (`m=19MiB, t=2, p=1`) and a per-IP exponential lockout (`60s × 2ⁿ` after 10 failed attempts).
- **Optional TOTP 2FA + SHA-256-hashed single-use backup codes.** Configure under **Admin → Security**.
- **AES-256-GCM at rest.** OAuth access/refresh tokens, SMTP password, TOTP secret, and webhook secrets are sealed with `SLOTTY_ENCRYPTION_KEY`. Ciphertext is `v1.<iv>.<tag>.<ct>`; rotating the key invalidates every encrypted blob (you can re-auth Google + re-enter SMTP from admin in a few minutes).
- **CSRF: Origin/Referer match.** Every state-changing admin route runs through `csrf()` — the request is rejected unless `Origin` (or `Referer`) matches `SLOTTY_PUBLIC_URL`. When `SLOTTY_TRUST_PROXY=true`, `X-Forwarded-Host` is also accepted.
- **Security middleware.** `src/middleware.ts` stamps the canonical defense-in-depth headers on every response: `Content-Security-Policy` (with `frame-ancestors 'none'`), `X-Frame-Options DENY` on admin / `SAMEORIGIN` elsewhere, `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`, `Permissions-Policy camera=(), microphone=(), geolocation=()`. `Strict-Transport-Security` is added only when the request originated over HTTPS (the proxy sets `X-Forwarded-Proto https`).
- **Rate limits.**
  - `/api/admin/login`: 10 fails per IP, exponential lockout afterwards.
  - `/api/public/bookings` (POST): 10/min/IP.
  - `/api/public/event-types/[slug]/slots`: 60/min/IP.
  - All other `/api/public/*` endpoints: 120/min/IP default.
  - 429 responses always carry `Retry-After`.
- **Idempotent booking writes.** Submit a booking with a `clientRequestId`; subsequent retries with the same id return the original booking instead of duplicating it.
- **No Slotty-side email.** Confirmation, reschedule and cancel emails are sent by Google Calendar (`sendUpdates=all`) — Slotty never has its own message body that could leak booker PII through misconfiguration. SMTP is reserved for owner-side reminders.
- **Booker tokens.** Cancel and reschedule URLs include a 32-byte random token; the DB stores a SHA-256 hash. Constant-time comparison; tokens are never returned a second time after the original confirmation response.
- **Outgoing webhooks signed with HMAC-SHA256.** Deliveries retry with exponential backoff (up to 24 hours). Endpoint secrets are encrypted at rest.
- **Audit log.** Every admin action lands in `audit_logs` (login, settings change, event-type create / archive, booking cancel, etc.) — viewable at **Admin → Audit log**.

---

## Performance

- **Slot endpoint p95 ≤ 300 ms.** This is the hot path: `GET /api/public/event-types/<slug>/slots`. The endpoint reads from the `BusyEvent` mirror (no Google round-trip), caches results for 30 s keyed off the maximum `BusyEvent.updatedAt`, and snaps to the slot grid in the schedule's tz. Run the load test with `bun run test:load` (requires the server to be running and the slug to exist).
- **In-process job worker.** No Redis, no broker. The worker polls every 5 s and handles watch-channel renewal, incremental Google sync, reminder emails, outgoing webhook delivery, and daily backups.
- **Cold start.** A fresh container reaches `/api/health=200` within ~ 1 s on a 2-vCPU host.
- **Resource footprint.** RAM in steady-state hovers around 80 – 120 MiB; SQLite + WAL keep IO local.

---

## Backup & restore

### What's in `data/`

| Path | Purpose | Safe to restore? |
|---|---|---|
| `data/slotty.db` | Primary SQLite database (everything: users, bookings, schedules, encrypted tokens). | Yes — atomic snapshot. |
| `data/slotty.db-wal`, `data/slotty.db-shm` | SQLite WAL artefacts. | Don't copy these in isolation. Either copy all three together, or use `Admin → Backup → Download snapshot`, which performs a checkpoint first. |
| `data/avatars/` | Owner profile picture (PNG). | Yes — copy whole tree. |
| `backups/` | Auto-rotated daily snapshots produced by the in-process backup job (7 daily + 4 weekly). | Yes — but each file is a snapshot, not a delta. |

### Routine backups

Daily snapshots are written to `backups/` inside the volume by the job worker. You can also:

- **Admin → Settings → Backup → Download snapshot** — single SQLite file (post-checkpoint, safe to restore).
- **Admin → Settings → Backup → Export all data** — ZIP with JSON tables + per-booking ICS files. Useful for long-term archival or migrating to a different storage backend.

### Off-host

```bash
# Append the date to keep a rolling history.
rclone copy /var/lib/docker/volumes/slotty_data/_data \
  remote:slotty-backups/$(date +%Y-%m-%d) \
  --include "*.db" --include "avatars/**" --include "backups/**"
```

### Restore

```bash
docker compose down
# Replace the SQLite file (whole-volume restore is also fine).
cp /path/to/backup/slotty.db /var/lib/docker/volumes/slotty_data/_data/slotty.db
docker compose up -d
```

If you restored from an export ZIP rather than a snapshot, the encrypted token blobs only decrypt with the same `SLOTTY_ENCRYPTION_KEY` that was active when the export was produced. Keep the key alongside your backups (in a secret manager — *not* in the same archive).

---

## Migration from Calendly / Cal.com

Slotty doesn't ship an automated importer; the data shapes between products differ enough that a one-shot import would be more brittle than helpful. The recommended manual path:

1. **Export your Cal.com / Calendly event types and availability** (both products offer a JSON export).
2. **Re-create event types in Slotty** under **Admin → Event Types**. Copy titles, durations, location kinds, and custom questions over by hand.
3. **Mirror your weekly availability** under **Admin → Availability**. Slotty's rules cover Mon–Sun with start/end minutes; date overrides handle holidays.
4. **Update booking links you've shared.** Slotty's URLs are `https://<your-domain>/<slug>`. If you maintained a `book.example.com/<slug>` before, you can keep the same domain — just point DNS at your Slotty box.
5. **Existing bookings on Calendly / Cal.com don't auto-migrate.** Let those run out their natural life on the legacy system; new bookings flow to Slotty.

A scripted importer is on the roadmap. Until then, the manual path takes ~ 15 minutes for a typical setup.

---

## Architecture

Single Next.js 14 process (App Router). SQLite for storage. In-process job worker for reminders, watch-channel renewal, outgoing webhooks and daily backups — no Redis, no message broker.

```
Browser ──► Caddy ──► Next.js (App Router) ──► middleware.ts (CSP/HSTS/CSRF)
                        │
                        ├─ Public site (/, /<slug>, /b/<id>, /b/<id>/reschedule)
                        ├─ /admin/* (session-gated, IP-allowlisted at proxy)
                        ├─ /setup (only when zero User rows exist)
                        ├─ /api/public/* (rate-limited)
                        ├─ /api/admin/*  (CSRF + requireUser)
                        └─ /api/webhooks/google (Google push notifications)
                        │
                        ├─► Prisma → SQLite (./data/slotty.db)
                        │     • users, sessions, audit_logs
                        │     • schedules, schedule_rules, date_overrides
                        │     • connected_accounts, calendars, busy_events
                        │     • event_types, event_type_questions, bookings, booking_history
                        │     • webhook_endpoints, webhook_deliveries, backup_codes, jobs
                        │
                        ├─► Job worker (in-process, 5 s poll)
                        │     • renew Google watch channels (~7 days)
                        │     • incremental Google sync (sync tokens)
                        │     • reminder emails (T-24h, T-1h)
                        │     • booking_sync_retry (Google insert retry)
                        │     • webhook delivery with exponential backoff
                        │     • daily SQLite snapshot (7 daily + 4 weekly)
                        │
                        └─► googleapis (with token refresh wrapper, encrypted at rest)
```

**Material You** drives the visual language. The owner picks one seed color (default `#4F6CFF`, settable in **Admin → Branding**); `@material/material-color-utilities` generates the full M3 palette (~25 color roles) for both light and dark schemes. CSS variables are written under `:root` and `[data-theme="dark"]`, and Tailwind references them via `bg-primary`, `text-on-surface`, `rounded-shape-lg`, etc. There's no FOUC: theme is applied via inline `<script>` before hydration.

### Phase shipping checklist

| Phase | Scope |
|---|---|
| 0 | Project skeleton, design tokens, Prisma + SQLite |
| 1 | Lucia v3 sessions, argon2id + per-IP login lockout, /setup wizard |
| 2 | Material You theme generator, branding controls |
| 3 | Google OAuth + multi-account calendar sync + watch channels |
| 4 | Schedules, weekly rules, holidays, date overrides |
| 5 | Event types with custom questions and password gate |
| 6 | Slot computation engine (cached, p95 < 300 ms target) |
| 7 | Public booking flow, reschedule, cancel, ICS, idempotency |
| 8 | (out of scope — not used) |
| 9 | Audit log, outgoing webhooks, TOTP 2FA, backup codes |
| 10 | Security middleware, CSP/HSTS, full rate-limit coverage, Playwright E2E, load test, README pass |

---

## Troubleshooting

**App won't start: `Invalid environment configuration`**
You're missing one of the required env vars or your `SLOTTY_ENCRYPTION_KEY` doesn't decode to 32 bytes. Run `bun run key:generate` and update `.env`.

**Can't connect Google account: `redirect_uri_mismatch`**
The redirect URI configured in Google Cloud Console must exactly match `${SLOTTY_PUBLIC_URL}/api/admin/calendars/callback`. Check for `http` vs `https`, trailing slash, and exact host.

**Booking page is empty / no slots**
- Make sure your default schedule has at least one weekly rule.
- Verify the event type is not archived or hidden.
- Check **Admin → Calendars** — every Busy calendar should show a recent successful sync.

**Push notifications not arriving from Google**
Watch channels require a publicly reachable HTTPS URL for `/api/webhooks/google`. If you're testing locally, use `ngrok http 3000` or Cloudflare Tunnel. The fallback poll every 10 minutes will pick up missed events anyway.

**`/admin` returns 403**
Your reverse proxy is blocking your IP. Update the allowlist CIDRs in your Caddyfile / Nginx config and reload.

**Slot disappears for 30 seconds after a booking, then reappears**
Slot computation is cached for 30 s. After a booking, the cache invalidates within seconds. If a slot reappears, that means a Google event got cancelled — confirm in your calendar.

**SQLite "database is locked"**
Make sure you don't have multiple Slotty processes pointing at the same DB file. The container should be the only writer.

---

## License

Slotty is licensed under [AGPL-3.0-or-later](LICENSE). If you modify Slotty and run it as a network service, you must make your modified source available to users of that service.
