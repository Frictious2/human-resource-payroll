# WAEC Staging Deployment Preparation

Date: 2026-10-09

Project: WAEC HR & Payroll Management System

Current readiness: `READY FOR STAGING`

Production readiness: Not claimed.

## Status

`STAGING DEPLOYMENT PACKAGE: READY`

This review prepared deployment instructions and verified staging prerequisites. It did not deploy the application and did not change payroll, GL, approval or employee financial records.

## Application Stack

| Component | Confirmed value |
| --- | --- |
| Runtime | Node.js / Express.js |
| View engine | EJS |
| UI | Bootstrap |
| Database | MariaDB/MySQL |
| Session store | Local MySQL-backed `express-session` store using `mysql2` |
| Database | `personnel_master` |
| Package version | `1.0.0` |

## Production Dependency Status

`npm audit --omit=dev` was previously remediated to zero vulnerabilities after replacing `express-mysql-session` with the local MySQL session store and patching vulnerable production packages.

Production package changes already in place:

| Package | Current status |
| --- | --- |
| `express-session` | `^1.18.2` |
| `mysql2` | `^3.24.5` |
| `multer` | `^2.4.0` |
| `nodemailer` | `^10.0.16` |
| `helmet` | `^8.3.0` |
| `csrf-sync` | `^4.2.1` |

## Session Store Verification

The application now uses `config/sessionStore.js`.

Verified behavior:

| Check | Result |
| --- | --- |
| Session table exists | PASS |
| Expected columns: `session_id`, `expires`, `data` | PASS |
| Session store descriptor | MySQL |
| Session creation | Covered by `testPersistentSessionStore.js` |
| Session persistence | Covered by `testPersistentSessionStore.js` |
| Session deletion/logout invalidation | Covered by session and logout tests |
| Session regeneration on login | Implemented in `server.js` |
| Expiration handling | Implemented via `expires` epoch seconds |
| Touch/update support | Implemented by updating stored session and expiry |
| Connection cleanup | Uses shared `mysql2` pool; store `close()` does not destroy the application DB pool |
| Multi-process compatibility | Compatible when all Node processes share the same MariaDB `sessions` table |

Session table schema observed:

| Field | Type | Key |
| --- | --- | --- |
| `session_id` | `varchar(128)` | Primary |
| `expires` | `int(11) unsigned` | Indexed |
| `data` | `mediumtext` |  |

Session data is stored server-side in the database and is not exposed publicly. Browser cookies contain only the signed session identifier.

## Production Configuration Requirements

The application validates production configuration before startup through `services/environmentValidationService.js` and `config/sessionStore.js`.

Required production variables:

```env
NODE_ENV=production
PORT=3001
APP_BASE_URL=https://your-waec-hrpayroll-domain.example

DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=personnel_master
DB_USER=hrpayroll
DB_PASSWORD=replace-with-secure-db-password

SESSION_SECRET=replace-with-strong-random-secret
SESSION_COOKIE_NAME=hrpayroll.sid
SESSION_MAX_AGE_MS=28800000
SESSION_CLEANUP_INTERVAL_MS=900000
TRUST_PROXY_HOPS=1

LOGIN_RATE_LIMIT_MAX=20
LOGIN_RATE_LIMIT_WINDOW_MS=900000

EMAIL_NOTIFICATIONS_ENABLED=false
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
```

Important requirements:

- `SESSION_SECRET` must be at least 32 characters and must not be a placeholder.
- `APP_BASE_URL` must be HTTPS in production.
- `TRUST_PROXY_HOPS` must match the real reverse-proxy topology.
- SMTP may remain disabled for staging if WAEC accepts in-app notifications only.
- Do not commit the real `.env` file.

## Secure Cookies and Proxy

Production session cookie behavior:

| Setting | Production value |
| --- | --- |
| Cookie name | `hrpayroll.sid` unless overridden |
| `httpOnly` | `true` |
| `secure` | `true` in production |
| `sameSite` | `lax` |
| Max age | `SESSION_MAX_AGE_MS`, default 8 hours |

Express `trust proxy` is set from `TRUST_PROXY_HOPS`. For a standard Nginx HTTPS reverse proxy in front of Node.js, set:

```env
TRUST_PROXY_HOPS=1
```

## Linux Compatibility Findings

The application uses mostly portable Node.js path handling.

Confirmed portable areas:

- Main app paths use `path.join`.
- Upload directories are created under `public/uploads`.
- Migrations use relative repository paths.
- Static assets are served from `public`.
- PDF/report evidence generation is browser/test based and not required at runtime unless running visual UAT scripts.

Items requiring deployment attention:

| Area | Finding | Action |
| --- | --- | --- |
| Uploads | Runtime writes to `public/uploads`, `public/uploads/staff_photos`, and `public/uploads/medical_receipts` | Ensure writable persistent storage |
| WAEC audit scripts | Some local scripts reference a Windows workbook path under `C:\\Users\\...\\Downloads` | Do not run those scripts on staging unless `WAEC_AUGUST_PAYROLL_XLSX` points to a staging-safe workbook |
| Case-sensitive filesystem | Linux import paths are case-sensitive | Run smoke tests after deployment |
| PDF visual UAT | Playwright may require Linux browser dependencies | Install browser dependencies only on staging/test host if visual UAT will be rerun |
| Logs | Existing local `.log` files are development artifacts | Exclude from deployment package |

## Deployment Package Contents

Include:

- Application source files.
- `package.json`.
- `package-lock.json`.
- `database/migrations`.
- `public` assets, including `/images/nra-logo.jpg`.
- `views`, `controllers`, `routes`, `services`, `middleware`, `config`.
- Documentation and deployment checklists.

Exclude:

- `.env` and any real secrets.
- Database dumps.
- Payroll exports and sensitive employee documents.
- Local logs such as `phase15a_server.log`.
- Temporary scripts/output not needed by runtime.
- `node_modules` if deploying with lockfile-based install.
- UAT screenshots/PDFs if they contain sensitive staff data.

Recommended install command on the server:

```bash
npm ci --omit=dev
```

## Database Migration Procedure

Apply required migrations deliberately before starting the application.

Migration inventory:

| File | Purpose |
| --- | --- |
| `database/migrations/20260324-payroll-gl-posting.sql` | GL posting support |
| `database/migrations/20260324-payroll-gl-posting-seed.sql` | GL posting seed/support data |
| `database/migrations/20260711-payroll-workflow.sql` | Payroll workflow batches/actions |
| `database/migrations/20260714-parameter-change-workflow.sql` | Parameter-change workflow |
| `database/migrations/20260714-payroll-reversal-workflow.sql` | Payroll reversal workflow |
| `database/migrations/20260714-record-workflow.sql` | Staff/sensitive-record workflow |
| `database/migrations/20260714-workflow-notifications.sql` | Workflow notifications |
| `database/migrations/20260715-payroll-reopen-workflow.sql` | Payroll reopen workflow |
| `database/migrations/20260716-fix-payroll-generation-uniqueness.sql` | Generation-aware payroll uniqueness |
| `database/migrations/20260821-persistent-session-store.sql` | Persistent MySQL sessions |
| `database/migrations/20260821-yearly-payment-batches.sql` | Yearly payment workflow |

Do not rely on runtime DDL as the production migration strategy.

## Recommended Staging Server

Recommended minimum for staging:

| Resource | Minimum |
| --- | --- |
| OS | Ubuntu 22.04 LTS or 24.04 LTS |
| CPU | 2 vCPU |
| RAM | 4 GB |
| Storage | 60 GB SSD |
| Node.js | 20 LTS or current tested LTS compatible with the lockfile |
| Database | MariaDB 10.6+ or MariaDB 11.x |
| Web server | Nginx reverse proxy |
| TLS | Let's Encrypt or WAEC-approved certificate |
| Backup | Daily database dump plus off-server copy |

Shared hosting is not recommended unless it provides:

- Long-running Node.js process management.
- MariaDB access with migration privileges.
- Reverse proxy / HTTPS control.
- Persistent writable upload storage.
- Scheduled backups and restore access.
- Ability to configure environment variables securely.

## Deployment Readiness Blockers

Staging deployment blockers:

- None at code/package level after dependency remediation.
- Finance Manager login UAT requires WAEC to identify and provision a real Finance Manager account.

Production blockers:

- Real production secrets and DB credentials not configured in this repository.
- HTTPS/proxy must be configured on target server.
- Backup and restore rehearsal must be completed.
- Finance Manager account must be provisioned.
- WAEC must authorize any August batch 161 correction workflow separately.
- Client sign-off must occur on the deployed URL.

## Final Recommendation

The application can be prepared for an online staging server. Do not open production access until the staging checklist passes and WAEC provides the remaining operational authorizations.

