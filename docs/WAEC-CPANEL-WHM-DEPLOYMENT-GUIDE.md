# WAEC cPanel/WHM Deployment Guide

Prepared 2026-11-09 UTC. **Instructions only; nothing has been uploaded or deployed.**

## Confirmed hosting choice and prerequisites

The owner confirmed **Setup Node.js App (CloudLinux)** and **Node.js 22 available**. Exact Node minor version, provider limits, Passenger version, target URL and proxy topology remain to be tested. No Docker, VPS, PM2 or replacement web server is required by this procedure.

The provider must enable Node applications, production mode/environment variables, npm/terminal access, MariaDB/MySQL with InnoDB, HTTPS certificates, private directories outside every document root, logs, backups and application restart controls. Verify bcrypt can install on the host; a compatible binary or provider build tools may be needed. Use the tested Node 22 line (local 22.19.0), not an untested major upgrade.

Start with one application worker. Request a per-account resource budget sufficient for Node, database/report workload and package installation; 1 GB available application memory is a planning floor, not a benchmark or compatibility guarantee. Verify LVE memory/process/CPU/I/O limits using synthetic workloads. Pool capacity is currently 10 connections per process; the provider's database connection limit must cover all workers and administrative headroom.

Provider references: [cPanel Node application installation](https://docs.cpanel.net/knowledge-base/web-services/how-to-install-a-node.js-application/), [CloudLinux Manager documentation](https://docs.cloudlinux.com/cloudlinuxos/lve_manager/), [Passenger reverse port binding](https://www.phusionpassenger.com/docs/advanced_guides/in_depth/node/reverse_port_binding.html). Product interfaces vary; confirm actual controls before applying these instructions.

## 1. Backup and isolated preparation

Obtain deployment authorization and an agreed maintenance/rollback window. Back up the database, application, protected environment file and uploaded assets. Record timestamp, size and checksums in access-restricted storage; verify important legacy/workflow table definitions and demonstrate restoration into a separate protected temporary database. Never restore over live WAEC data for testing.

Initial online acceptance must use a separate synthetic database, not an unprotected clone of WAEC employees. Use a unique cPanel database/user dedicated to this application and grant permissions only on that database. Never use database root, a shared customer database or global privileges. Confirm the provider's cPanel account prefix on database/user names.

## 2. Reproducible release upload

Use a reviewed release/commit. Package an allowlist: `app.js`, `server.js`, package/lock files, `config`, `controllers`, `middleware`, `routes`, `services`, `utils`, `validations`, `views`, safe public CSS/JS/images/vendor assets and reviewed SQL migrations. Keep operational scripts outside the document root and include only those needed by the deployment plan.

Exclude populated `.env*`, `.git`, local `node_modules`, private/upload trees, database dumps, spreadsheets/payroll exports, employee documents, logs, synthetic test workspaces, test credentials and test-result artifacts. Install Linux dependencies on the host with `npm ci --omit=dev`; do not copy Windows native modules. Retain the lockfile and record the Node/npm versions. Do not upgrade packages during deployment.

Use the environment activation command displayed by **Setup Node.js App** before terminal commands; do not guess a `nodevenv` path. Confirm `node --version` and `npm --version` resolve to the selected Node 22 environment. If terminal access is unavailable, ask the provider for a lockfile-preserving production installation method rather than silently using another Node version.

Suggested directories (replace `ACCOUNT` with the real account name):

```text
/home/ACCOUNT/apps/waec/                 application root, not public_html
/home/ACCOUNT/apps/waec/public/          safe static assets only
/home/ACCOUNT/waec-private/uploads/     persistent private files
/home/ACCOUNT/waec-backups/             protected backup staging, plus off-server copy
```

Do not set the document root to the application root. Do not expose config, source, private files or `.env` through Apache aliases/symlinks. **Do not upload legacy `public/uploads` employee files:** Apache/Passenger may serve an existing static file without calling Express. Keep employee files outside the web root and prove requests pass through the authenticated application handler.

## 3. Register Setup Node.js App

Select Node.js 22, production application mode, the actual application root, the staging subdomain at its root URL, and startup file **`app.js`**. Root-subdomain deployment is recommended because the existing routes and assets use absolute root paths; arbitrary URL subdirectory hosting is not certified.

`app.js` calls the shared `startManagedServer()` bootstrap once, initializes the existing persistent session store and attaches shutdown handling. No privileged account is seeded. For a host that launches plain Node, `PORT` is taken from its environment. Passenger normally intercepts the single listener using its internal socket; its reverse port binding does not require a fixed public TCP port. Do not open port 3001 to the internet or start a second competing Node process. Confirm this behavior on the target host.

## 4. Protected configuration

Copy `.env.production.example` to the **application-root `.env` on the host**, populate it privately and restrict permissions (normally 0600). Do not commit it or include it in screenshots. Generate independent cryptographically random session/reset secrets through a secure administrator terminal; do not transmit them in chat or logs.

Required configuration includes:

| Setting | Deployment requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `INSTALLATION_COMPANY_ID` | `1` for this WAEC installation; not a browser-selected company |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Actual dedicated cPanel database configuration; do not mix standard and legacy DB aliases with conflicting values |
| `SESSION_SECRET`, `RESET_TOKEN_SECRET` | Distinct strong random secrets; production validator rejects missing/unsafe values |
| `APP_BASE_URL` | Exact deployed HTTPS origin, no localhost or placeholder |
| `TRUST_PROXY_HOPS` | Provider-confirmed exact trusted proxy chain, not an assumed universal value |
| `PRIVATE_UPLOAD_DIR` | Absolute stable directory outside all document roots, owned by app account |
| `SESSION_COOKIE_NAME` | Keep `hrpayroll.sid` unless deliberately reviewed |
| Session expiry/cleanup | Existing max age, bounded cleanup interval/batch; indexed `sessions.expires` |
| `SHUTDOWN_TIMEOUT_MS` | Provider must allow sufficient request drain before forcibly killing workers |
| `TZ` | `Africa/Freetown`; verify Node and DB timestamp behavior on target |
| `EMAIL_NOTIFICATIONS_ENABLED`, `ACCOUNT_EMAIL_ENABLED` | Explicit enabled/disabled decision |
| `SMTP_*` | **Read from application-root `.env` only**; inherited cPanel SMTP environment values are intentionally ignored |

Non-SMTP values may be supplied by the application manager; avoid conflicting duplicate values. Local source credentials are not deployment credentials. Never print the real environment file. Account invitations require working configured SMTP; disabled mail does not magically deliver setup links. Any delivery test needs an explicitly approved recipient; the earlier authorized test is already complete and must not be resent automatically.

Confirm whether the DB is on the same host or a provider-protected private connection. The current pool configuration does not establish a separately configured remote TLS channel; do not point it at an untrusted public-network DB connection. A remote TLS requirement must be reviewed and implemented/tested against the provider's actual certificate requirements before use.

## 5. Schema preparation

Use the protected staging schema and inspect its existing migration level first. Retain legacy table/column names and data. Inventory, dependency-check and apply only required reviewed migrations, with a verified backup before any schema operation:

```text
20260324-payroll-gl-posting.sql
20260324-payroll-gl-posting-seed.sql       review approved mappings; do not blindly overwrite
20260711-payroll-workflow.sql
20260714-record-workflow.sql
20260714-workflow-notifications.sql
20260714-parameter-change-workflow.sql
20260714-payroll-reversal-workflow.sql
20260715-payroll-reopen-workflow.sql
20260716-fix-payroll-generation-uniqueness.sql
20260821-yearly-payment-batches.sql
20260821-persistent-session-store.sql
```

These files are under `database/migrations`. This is an inventory, not permission to run every file against an existing live schema. Check idempotence, existing indexes/duplicates, engine, column casing and generation keys before each operation. Session startup deliberately refuses a missing session table. Other legacy services still contain helper-schema ensure logic: provision helpers deliberately and confirm required schema-local privileges with the provider; do not assume runtime is purely DML or silently grant global administration privileges. No migration was executed by this preparation task.

## 6. HTTPS, proxy and session verification

Expected topology is browser -> HTTPS -> provider-managed Apache/Passenger proxy -> this Node application. Ask the provider for the actual forwarded-header chain and ensure clients cannot bypass it or spoof trusted forwarded headers. Configure HTTP-to-HTTPS redirect and a valid certificate through the hosting controls, avoiding redirect loops.

Test real login/logout and inspect `hrpayroll.sid`: Secure, HttpOnly, SameSite=Lax, sensible expiry. Verify session continuity across a managed app restart and invalidation after CSRF-protected POST logout. Confirm production HSTS, CSP, frame protection, no MIME sniffing and no `X-Powered-By`. Check real assets and console errors. Do not enable HSTS preload based on an untested staging domain.

The store schedules bounded expired-session deletion while workers are alive; separate workers use the same indexed expiration predicate safely. Passenger can idle-stop workers: expiration is still checked on reads, but timer cleanup resumes only when a worker runs. Confirm provider lifecycle behavior and storage retention. Do not add an unbounded session-deletion cron or delete active sessions.

## 7. Private-file migration procedure (NOT AUTHORIZED YET)

Use the protected manifest from the successful copy-only rehearsal, not an invented file inventory. Record all DB references, source paths and SHA-256 hashes in protected storage. Review unreferenced files and ownership with WAEC. Back up both references and originals before the approved cutover.

Copy files into the private upload root preserving category directories and filenames so existing `/uploads/...` database references remain unchanged. Never overwrite differing destination files; investigate collisions. Verify every checksum and file count. Original files remain preserved and access-restricted; do not leave any publicly served employee copy on the deployed host.

Use the application's authenticated `/uploads` handler, not Apache static aliases. Test authorized downloads, anonymous/wrong-role denial, foreign-company denial, invalid paths and response headers. Record results without exposing document content in public evidence. Restart safely after changing a storage root. If verification fails, restore the previous **protected** storage configuration/application release, retaining recorded references and originals; do not roll back by exposing a public directory or deleting source files. Actual WAEC file migration requires explicit approval and has not occurred.

## 8. Reports and operations

The application uses EJS/report HTML and browser print/output behavior rather than a new server PDF engine. Validate every supported PDF/output action on the actual target and client browser; do not assume an HTTP 200 proves a usable PDF. Check NRA logo over HTTPS, PAYE/EOS/NASSIT, payslips, all-page pagination, Excel exports and company branding with synthetic data. No server-side Playwright installation is required by this deployment plan; any newly discovered renderer requirement must be reviewed, not installed speculatively.

Use provider-managed stdout/stderr logs with restricted access, retention and rotation. Never expose log URLs or credentials. Restart through Setup Node.js App's control. Where supported by the provider, Passenger's conventional `tmp/restart.txt` mechanism can request a restart; confirm the hosting instructions first. Test signal drain and session continuity before go-live. A forced hosting shutdown can interrupt an in-flight request; never perform upgrades/migrations mid-payroll.

Back up the database daily and before releases/payroll-critical changes, retain multiple generations, encrypt/restrict access, and keep off-server copies. WAEC must approve retention/RPO/RTO and restore responsibility. Back up private uploads separately and test restoration into isolated storage/database.

## 9. Acceptance, update and rollback

Keep staging access restricted until security checks pass. Complete the companion checklist on the real URL using synthetic accounts. Do not run the destructive local acceptance runner against live WAEC or assume a shared host allows CREATE DATABASE/USER: provision an appropriately isolated test environment through hosting administration instead.

During updates, stop user activity in an agreed maintenance window, back up, install the reviewed release and lockfile, apply only approved migrations, restart, and smoke-test all roles/security/reports. Keep the previous application and protected environment/storage configuration recoverable. Roll back application/configuration first where schema-compatible. Restore a DB only with explicit authorization after assessing transactions since the backup and possible data loss; do not erase live payroll to make an application rollback convenient.

No actual cPanel, Linux, SSL, proxy, filesystem permission, backup restore or deployed report acceptance is claimed by this guide.
