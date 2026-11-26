# Infrared

Private, self-hosted website analytics: click and scroll heatmaps, element engagement, funnels, acquisition and spend, A/A and A/B experiments, experience diagnostics and optional journey intelligence. Each website is a separate project with its own tracking key, pages, reports, reference layouts and access permissions.

Infrared collects only on websites an owner has approved, only on paths your rules allow, only after the visitor consents, and never across websites. It uses no cookies on your visitors' browsers and never reads form values or page text.

![Heatmap of clicks](docs/screenshots/heatmap-clicks.png)

| | |
| --- | --- |
| ![Overview](docs/screenshots/overview-recorded.png) | ![Scroll reach](docs/screenshots/heatmap-scroll-reach.png) |
| ![Diagnostics](docs/screenshots/diagnostics.png) | ![Navigation](docs/screenshots/dashboard-navigation.png) |

More screenshots: [before activity](docs/screenshots/overview-before-activity.png) · [more analysis](docs/screenshots/heatmap-more-analysis.png) · [product concept](docs/screenshots/product-concept.png).

---

## Contents

1. [Features](#features)
2. [Choose how to run it](#choose-how-to-run-it)
3. [Install on your computer](#install-on-your-computer)
4. [Install on a server (production)](#install-on-a-server-production)
5. [Connect a website](#connect-a-website)
6. [Security](#security)
7. [Operations, backup and restore](#operations-backup-and-restore)
8. [Configuration reference](#configuration-reference)
9. [Development](#development)
10. [FAQ](#faq)

---

## Features

**Projects and collection**
- Website projects: add an HTTPS website once. Infrared prepares its Home page, a unique site key and one installation snippet.
- Whole-site mode discovers pages by canonical path on first visit, within include/exclude rules and path patterns. Sensitive paths (login, account, admin, checkout, cart, payment, password and similar) are excluded by default, including their sub-paths. Selected-page mode remains available for exact URLs.
- Automatic structural discovery of up to 100 elements per view (headers, navigation, sections, buttons, links), without reading text, URLs or form values.
- Owner approval per website, recording the reviewed consent policy version. Events signed with any other policy version are rejected.
- Per-page pause/resume, a workspace-wide emergency stop, and project archiving.
- Installation screen with a link and pixel check (static, SSRF-safe) and live activity status.

**Analysis**
- Heatmaps: clicks, scroll reach, elements, repeated clicks and clicks with no response, drawn on a reviewed screenshot of the page.
- Overview across pages, funnels, comparisons, page versions, data quality and diagnostics (load speed, layout stability, error signals).
- Acquisition: backend-registered visits, registrations, qualified acquisitions, daily spend and cost per acquisition.
- Experiments: A/A and A/B tests with stable assignment, power planning, allocation (SRM) checks, guardrails and a frozen final readout.
- Optional predictive intelligence: one-click database training, daily/weekly retraining, loss charts, held-out metrics, version rollback, interactive journeys, element reviews, and separate next-action, click and primary-action conversion models (SASRec/EulerNet; one-time Python runtime setup). See [Intelligence](docs/INTELLIGENCE.md).
- Sortable, searchable, paginated tables, CSV and PNG exports, market/product/brand filters.

**Operations**
- Roles: owner, administrator, analyst, installer, viewer, each scoped to the websites they are members of.
- Scheduled retention and verified backups, alerts, a persistent audit trail and an operations history. Per-minute health checks are hidden from the history by default and can be shown with a toggle.
- Optional OpenTelemetry metrics export (no visitor data).

---

## Choose how to run it

| | On your computer | On a server (production) |
| --- | --- | --- |
| Good for | Trying Infrared, reviewing reports, local development | Collecting from real visitors on your live website |
| Address | `http://127.0.0.1:3000` | `https://analytics.example.com` (dashboard) and `https://collect.example.com` (collector) |
| HTTPS | Not needed | Required |
| Database | Built-in (PGlite), no setup | Built-in PGlite, or PostgreSQL/Supabase |
| Collects from a live website? | **No.** A public HTTPS website cannot send data to `127.0.0.1` | Yes |

Visitors' browsers must reach the collector over HTTPS. To collect from a real website, run Infrared on a server, or behind a reverse proxy or tunnel with a public HTTPS address.

You do **not** need Express.js, Docker, Redis or a separate database server. Infrared uses Fastify, which is already included.

---

## Install on your computer

Requirements: [Node.js 24 or newer](https://nodejs.org). Works on Windows, macOS and Linux.

```sh
# 1. Get the code, then in the project folder:
corepack enable            # provides the pinned pnpm version
pnpm install --frozen-lockfile
#    (or: npm ci)

# 2. Create your settings file
cp .env.example .env       # Windows PowerShell: Copy-Item .env.example .env

# 3. Build the dashboard and tracking script
pnpm build                 # or: npm run build

# 4. Create the first owner account (only if none exists)
pnpm admin bootstrap-local # or: npm run admin -- bootstrap-local

# 5. Start
pnpm start                 # or: npm start
```

Open http://127.0.0.1:3000 and sign in with the credentials written to `.local/admin-credentials.json`. Change them by creating your own owner (see below), then delete that file.

Create an owner with your own email and password (stop the server first):

```sh
pnpm admin create-user     # or: npm run admin -- create-user
```

Data is stored in `.local/` inside the project folder. On Windows, run the commands in PowerShell; `.env` values work the same way. Paths are resolved from the project folder, so Infrared works no matter which folder you start it from.

---

## Install on a server (production)

This is a typical single-server setup: Ubuntu 24.04 or similar, one Node.js process, and [Caddy](https://caddyserver.com) for automatic HTTPS. nginx works too (see below).

### 1. DNS

Create two DNS records pointing to the server, one for the dashboard and one for the collector. They must be different hostnames:

```
analytics.example.com  →  your server IP
collect.example.com    →  your server IP
```

### 2. System user and code

```sh
sudo adduser --system --group --home /opt/infrared infrared
sudo -u infrared git clone <your-repository> /opt/infrared/app
cd /opt/infrared/app
sudo corepack enable                               # makes the pinned pnpm available
sudo -u infrared pnpm install --frozen-lockfile   # dev dependencies are needed: the build and `start` use them
sudo -u infrared cp .env.example .env
sudo chmod 600 .env
```

### 3. Configure `.env`

```ini
RELEASE_STATUS=PRODUCTION
DASHBOARD_ORIGIN=https://analytics.example.com
COLLECTOR_ORIGIN=https://collect.example.com
BIND_HOST=127.0.0.1          # only the reverse proxy can reach Node
DASHBOARD_PORT=3000
COLLECTOR_PORT=8080
DEMO_PORT=4173
TRUSTED_EDGE=proxy           # real visitor IPs for rate limiting (see Security)
TRUSTED_PROXIES=             # leave empty when the proxy runs on this server
DATA_DIR=/var/lib/infrared   # outside the code folder
HEATMAP_BACKUP_DIR=/var/backups/infrared
# Optional hosted PostgreSQL instead of the built-in database:
# DATABASE_URL=postgresql://user:password@host:5432/postgres
```

```sh
sudo mkdir -p /var/lib/infrared /var/backups/infrared
sudo chown infrared:infrared /var/lib/infrared /var/backups/infrared
sudo chmod 700 /var/lib/infrared /var/backups/infrared
sudo -u infrared pnpm build
sudo -u infrared pnpm admin create-user
```

### 4. Run as a service (systemd)

`/etc/systemd/system/infrared.service`:

```ini
[Unit]
Description=Infrared analytics
After=network-online.target

[Service]
User=infrared
Group=infrared
WorkingDirectory=/opt/infrared/app
# Use the path printed by `which node`.
ExecStart=/usr/bin/node --import tsx apps/server/main.ts
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/infrared /var/backups/infrared
UMask=0077

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now infrared
sudo systemctl status infrared
```

### 5. HTTPS reverse proxy (Caddy)

`/etc/caddy/Caddyfile`:

```
analytics.example.com {
    reverse_proxy 127.0.0.1:3000
}
collect.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy obtains and renews certificates automatically, keeps the original `Host` header and adds `X-Forwarded-For`, which Infrared needs.

With **nginx**, use one `server` block per hostname with a certificate (for example from certbot), and:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;     # 8080 for the collector host
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, do not append client-supplied values
    client_max_body_size 8m;
}
```

### 6. Firewall

Only SSH and HTTPS should be reachable from the internet:

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```

Ports 3000, 8080 and 4173 stay private because `BIND_HOST=127.0.0.1`. For extra protection, restrict the **dashboard** hostname to your office IPs or a VPN in the proxy. The **collector** hostname must remain public so visitors' browsers can reach it.

### 7. Update

```sh
cd /opt/infrared/app
sudo -u infrared git pull
sudo -u infrared pnpm install --frozen-lockfile
sudo -u infrared pnpm build
sudo systemctl restart infrared
```

Database migrations run automatically at startup. Take a backup before upgrading.

### Running services separately (optional)

`pnpm start` runs the dashboard, collector and worker in one process, which is right for most installations. To scale them separately, use `start:api`, `start:collector` and `start:worker` with a shared PostgreSQL `DATABASE_URL` (run `pnpm db:migrate` first). The built-in database cannot be shared between processes. Rate limits are per process, so add limits at the proxy or gateway when running several collector replicas.

---

## Connect a website

1. **Projects → Start a project.** Enter a name and the website's HTTPS address (for example `https://www.example.com`).
2. As an owner, **approve** the website and enter your consent policy version (for example `privacy-2026-11`). Collection stays off until you do.
3. Open **Installation** and copy the snippet into your website's `<head>` (template or tag manager). Allow the collector in your Content-Security-Policy: `script-src https://collect.example.com; connect-src https://collect.example.com`.
4. Connect your cookie/consent banner:

   ```js
   InfraredHost.setConsent('granted');  // visitor accepted analytics
   InfraredHost.setConsent('denied');   // declined or withdrew
   ```

   Browsers with Do Not Track or Global Privacy Control enabled are never tracked.
5. Mark private areas with `data-hm-private` (excluded and masked) or `data-hm-ignore`. Forms and editable fields are always excluded.
6. Visit your website, accept consent, then check **Installation** and **Pages**. Use **Check link & pixel** to confirm the snippet is present.

If you later re-approve a website with a new consent policy version, copy the updated snippet. Snippets carrying the old version are rejected.

Backend integrations (experiments, registrations, spend) use per-website integration keys created in the dashboard. Keep them on your server, never in browser code.

---

## Security

**Built-in protections**

| Area | Protection |
| --- | --- |
| Sign-in | Argon2id password hashes, login rate limit, CSRF tokens, `HttpOnly` + `SameSite=Strict` session cookies (`Secure` on HTTPS), 1-hour idle and 12-hour absolute session expiry |
| Dashboard | Strict Content-Security-Policy (no inline scripts), `X-Frame-Options: DENY`, HSTS on HTTPS, exact `Host` and `Origin` checks, `no-store` API responses |
| Access control | Per-website membership on every route; owner-only approval, operations, privacy and audit; archived projects inaccessible |
| Tracking script (pixel) | Immutable, hash-named file loaded with Subresource Integrity (SRI). A modified script will not run. Host data is embedded with escaped JSON, so stored values cannot break out of the `<script>` |
| Collector | Accepts only approved origins with an approved consent version; strict JSON schemas; only registered pages, elements and actions; body size, time window, per-view, per-visitor and per-site quotas; no cookies |
| Injection | Parameterised SQL everywhere; table sorting from an allowlist; React rendering (no raw HTML); CSV formula neutralisation |
| Outbound requests | Link checks use public IPs only, with DNS pinning and re-validation on each redirect (no access to internal or cloud-metadata addresses) |
| Data | Visitor IPs are used only for rate limiting and never stored; private files are created with owner-only permissions; checksummed backups |
| Dependencies | Exact versions pinned; `pnpm audit --prod` reports no known vulnerabilities at release |

**Your responsibilities on a server**

- Keep `BIND_HOST=127.0.0.1` behind a reverse proxy, with only ports 22/80/443 open.
- Set `TRUSTED_EDGE=proxy` behind nginx or Caddy, or `cloudflare` when all traffic comes through Cloudflare. Otherwise every visitor looks like the proxy, and rate limits (including login protection) would apply to everyone together.
- Use strong, unique owner passwords (minimum 12 characters). Give people the lowest role they need, and only membership of their websites.
- Protect `.env` (`chmod 600`), `DATA_DIR` and the backup folder. Backups contain password hashes and analytics data. Copy them off the server, encrypted.
- Keep Node.js, the OS and dependencies updated, and run `pnpm audit --prod` before each upgrade.
- Consider restricting the dashboard hostname to a VPN or trusted IPs.

Security reviews: [docs/AUDIT-2026-11-25.md](docs/AUDIT-2026-11-25.md), [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). No software can be guaranteed free of vulnerabilities. These measures reduce risk; they do not certify a deployment.

---

## Operations, backup and restore

- **Operations** (owner): automatic retention (default after 02:00 UTC) and backups (off by default, after 03:00 UTC, kept 7 days), run-now buttons, alerts and the maintenance history.
- **Manual backup** (stop the server first): `pnpm backup /absolute/path/outside/data`
- **Restore** into an empty database: `pnpm restore /absolute/path/to/backup`
- **Health check:** `pnpm doctor`, `pnpm db:check`, and `GET https://collect.example.com/healthz`.

See [docs/OPERATIONS.md](docs/OPERATIONS.md).

---

## Configuration reference

All settings live in `.env` (see [.env.example](.env.example)).

| Setting | Default | Purpose |
| --- | --- | --- |
| `RELEASE_STATUS` | `LOCAL_DEMO` | `PRODUCTION` requires HTTPS origins and disables synthetic fixtures |
| `DASHBOARD_ORIGIN` / `COLLECTOR_ORIGIN` | `http://127.0.0.1:3000` / `:8080` | Public addresses; must differ; HTTPS unless loopback |
| `BIND_HOST` | `127.0.0.1` | Listening IP address |
| `DASHBOARD_PORT` / `COLLECTOR_PORT` / `DEMO_PORT` | 3000 / 8080 / 4173 | Local ports, must be distinct |
| `TRUSTED_EDGE` | empty | `proxy` (X-Forwarded-For) or `cloudflare` (CF headers and visitor country) |
| `TRUSTED_PROXIES` | loopback | Extra proxy IPs/CIDRs allowed to set forwarding headers |
| `DATA_DIR` | `.local` | Database, references and models; relative paths resolve from the project folder |
| `HEATMAP_BACKUP_DIR` | `DATA_DIR/backups` | Scheduled backups |
| `DATABASE_URL` | empty | Hosted PostgreSQL/Supabase (port 5432, verified TLS, private schema) |
| `HEATMAP_OTEL_METRICS_ENDPOINT` | empty | Optional OTLP/HTTP metrics receiver |
| `INFRARED_INTELLIGENCE_PYTHON` | `python` | Optional Python for journey intelligence |

Blank port and bind values are rejected on purpose: remove the line to use the default.

---

## Development

```sh
pnpm typecheck      # strict TypeScript
pnpm test           # unit and integration tests (Vitest)
pnpm build          # dashboard, SDK and OpenAPI
pnpm test:e2e       # browser tests (Playwright, disposable data)
pnpm release:check  # pinned versions and SDK size budget
```

Architecture and data: [ARCHITECTURE](docs/ARCHITECTURE.md) · [DATA_DICTIONARY](docs/DATA_DICTIONARY.md) · [OPENAPI](docs/OPENAPI.json) · [CONSENT_INTEGRATION](docs/CONSENT_INTEGRATION.md) · [ACQUISITION_EXPERIMENTS](docs/ACQUISITION_EXPERIMENTS.md) · [INTELLIGENCE](docs/INTELLIGENCE.md). A non-technical feature tour is in [README2.md](README2.md).

---

## FAQ

**Do I need Express.js?** No. Infrared's server uses Fastify, installed automatically with the other dependencies. Adding Express would not add anything.

**Do I need Docker, Redis or a database server?** No. The built-in database is enough for one server. PostgreSQL is optional.

**Can I run it on my PC and track my live website?** Only if the collector is reachable over public HTTPS (for example through a tunnel). For real use, run it on a server.

**Windows server?** Supported with Node.js 24. Use a service manager such as NSSM or a scheduled task, and IIS/Caddy as the HTTPS reverse proxy with `TRUSTED_EDGE=proxy`.
