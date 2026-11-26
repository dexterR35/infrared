# Release decision

**Current: production-capable, self-hosted.** Real-site collection works once `RELEASE_STATUS=PRODUCTION`, HTTPS dashboard and collector origins are configured, an owner approves each website with its consent policy version, and the snippet is installed. Synthetic fixtures are refused in production. Setup steps are in the [README](../README.md#install-on-a-server-production).

Verified in this repository: strict type checking, 38 unit/integration test files (231 tests), production build, SDK integrity and size budget, dependency audit with no known vulnerabilities, and a production-mode start (HSTS, Secure cookies, Host enforcement, project-root path resolution, reverse-proxy client addresses).

Not verified here, and recommended before handling real visitor data at scale:

- Your server, DNS, certificates and reverse proxy (run `pnpm verify:links` against the deployed hostnames and check the installation screen on a real page).
- Restore drills from off-server backups, and PostgreSQL point-in-time recovery if you use hosted PostgreSQL.
- Load and capacity for your traffic. Rate limits are per process; add gateway limits when running several collector replicas.
- Your consent manager integration and privacy review for each website (CMP, retention, CSP, private regions).
- Browser coverage beyond Chromium (Safari, Firefox) on your actual website.
- Single sign-on/MFA if your organisation requires it. The built-in sign-in uses Argon2id passwords and sessions.
- Least-privilege database accounts when collector, API and worker run as separate services.
- External screenshot capture stays restricted to local fixtures; upload reviewed reference layouts instead.

Acquisition and experiment features additionally need a backend integration on your website (integration key, consent, unit tokens, outcome definitions and spend reconciliation). See [ACQUISITION_EXPERIMENTS.md](ACQUISITION_EXPERIMENTS.md).

Security reviews: [AUDIT-2026-11-25.md](AUDIT-2026-11-25.md), [SECURITY_AUDIT.md](SECURITY_AUDIT.md), [THREAT_MODEL.md](THREAT_MODEL.md). They reduce risk; they do not certify a deployment.
