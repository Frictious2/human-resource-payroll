# Production Release

Release preparation date: Saturday, August 29, 2026

## Release Identity

| Item | Value |
| --- | --- |
| Release version | `v1.0.0` |
| Package version | `1.0.0` |
| Release candidate commit | `1e543a66c25edbabce0ebc85c376c668483517e2` |
| Short commit | `1e543a6` |
| Node.js version verified locally | `v22.19.0` |
| npm version verified locally | `11.17.0` |
| npm lockfile version | `3` |
| Application entry point | `server.js` |
| Database | `personnel_master` |
| Database engine/version verified locally | `11.4.9-MariaDB` |
| Staff Self-Service | Deferred / out of scope for Release 1.0 |

## Release Scope

Release 1.0 includes the active production roles:

- Administrator
- Data Entry Officer
- Finance Officer
- Finance Manager
- Manager
- Auditor
- Entity Head / HNO

Release 1.0 includes the verified HR, payroll, payroll approval, Post to Accounts, reversal, reopen/generation, yearly-payment, parameter-change, sensitive-record, notification, work-queue, report, persistent-session, CSRF, security-header, and rate-limit work documented in the PRD readiness files.

No new feature work should be added to this release candidate. Only deployment fixes, production compatibility fixes, and Critical/High defect fixes are allowed before go-live.

## Migration Level

Apply the following migrations deliberately. Do not rely on application runtime DDL.

1. `database/migrations/20260821-persistent-session-store.sql`
2. `database/migrations/20260324-payroll-gl-posting.sql`
3. `database/migrations/20260324-payroll-gl-posting-seed.sql`
4. `database/migrations/20260711-payroll-workflow.sql`
5. `database/migrations/20260714-record-workflow.sql`
6. `database/migrations/20260714-workflow-notifications.sql`
7. `database/migrations/20260714-parameter-change-workflow.sql`
8. `database/migrations/20260714-payroll-reversal-workflow.sql`
9. `database/migrations/20260715-payroll-reopen-workflow.sql`
10. `database/migrations/20260716-fix-payroll-generation-uniqueness.sql`
11. `database/migrations/20260821-yearly-payment-batches.sql`

## Production Environment Requirements

Required production variables must be configured on the deployment host and must not be committed to source control.

- `NODE_ENV=production`
- `PORT=<node application port>`
- `APP_BASE_URL=https://<production-domain>`
- `TRUST_PROXY_HOPS=<0 for direct TLS, 1 for one trusted proxy hop>`
- `SESSION_SECRET=<strong cryptographically random value>`
- `DB_HOST` or legacy `DBHOST`
- `DB_PORT` or legacy `DBPORT`
- `DB_NAME` or legacy `DBNAME`
- `DB_USER` or legacy `DBUSER`
- `DB_PASSWORD` or legacy `DBPASS`
- `EMAIL_NOTIFICATIONS_ENABLED=false` unless SMTP is fully configured and tested

## Deployment Status

| Area | Status | Notes |
| --- | --- | --- |
| Source release package | READY | Release candidate identified at commit `1e543a6` |
| Local readiness evidence | READY | PRD-009B passed with rendered-browser screenshots/PDF evidence |
| Production URL | PENDING ON DEPLOYMENT HOST | Must be supplied by hosting/deployment operator |
| Production DB credentials | PENDING ON DEPLOYMENT HOST | Use a dedicated least-privilege DB user where practical |
| Production DB backup | PENDING ON DEPLOYMENT HOST | Required before migrations/import |
| HTTPS/proxy | PENDING ON DEPLOYMENT HOST | Must verify secure cookies through the real proxy |
| SMTP decision | PENDING CLIENT/DEPLOYMENT DECISION | Enabled only with valid SMTP; otherwise keep disabled |
| Client signoff | PENDING DEPLOYED URL | Must be performed against the final deployed application |

## Release Verdict

Application code verdict remains:

`PRODUCTION READY WITH CONDITIONS`

Deployment verdict before real server execution:

`DEPLOYMENT VERDICT: BLOCKED`

Reason: the production URL, database credentials, backup evidence, HTTPS/proxy configuration, and client signoff are deployment-host prerequisites that cannot be completed from this local workspace alone.
