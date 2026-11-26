# Infrared runtime and deployment

The supported local runtime is Node.js 24+ with persistent PGlite. Start the application with `pnpm start`; the dashboard, collector and database worker share one process. Keep `DATABASE_URL` unset or empty. Local storage stays under `DATA_DIR`, defaulting to .local.

| Concern | Local runtime | Optional hosted deployment |
| --- | --- | --- |
| Application | Native Node.js process | Supervised native Node.js process |
| Database | Persistent PGlite | PostgreSQL, including Supabase |
| Sessions and job queue | Database tables | Database tables |
| Redis | Not required | Not required for the present implementation |
| HTTPS | Local loopback HTTP | HTTPS reverse proxy or approved gateway |
| Binding | 127.0.0.1 by default | Keep 127.0.0.1 behind a local reverse proxy |
| Client addresses | Socket address | `TRUSTED_EDGE=proxy` (X-Forwarded-For) or `cloudflare` |
| Reference images and models | Private DATA_DIR | Private persistent storage with backups |

Multiple processes must not open the same PGlite filesystem database. Independent API, collector and worker entry points require shared PostgreSQL. Use a direct or session-pooled Supabase connection on port 5432, verified TLS and the private infrared schema. Database credentials stay on the server. A hosted database connection does not synchronize or migrate existing local data automatically.

Public operation requires validated HTTPS routing, application accounts, per-site permissions and consent integration, protected reference files, and tested recovery. Per-process rate limits need shared enforcement if multiple replicas are deployed. A step-by-step server setup (systemd, Caddy or nginx, firewall) is in the [README](../README.md#install-on-a-server-production).

No container engine or separate database server is needed for local use. Python and PyTorch are optional, installed separately for the intelligence features.
