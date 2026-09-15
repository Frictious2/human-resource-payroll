# Deployment and Rollback Plan

Audit baseline date: Thursday, August 27, 2026

## Deployment Checklist

Use this checklist together with:

- `docs/PRODUCTION-RELEASE.md`
- `docs/PRODUCTION-DEPLOYMENT-EVIDENCE.md`
- `docs/CLIENT-GO-LIVE-ACCEPTANCE.md`

1. Take a full backup of the production `personnel_master` database.
2. Export application code and environment backups before deployment.
3. Verify the target environment has:
   - `NODE_ENV=production`
   - `DB_HOST` / legacy `DBHOST`
   - `DB_USER` / legacy `DBUSER`
   - `DB_PASSWORD` / legacy `DBPASS`
   - `DB_NAME` / legacy `DBNAME`
   - `SESSION_SECRET`
   - `APP_BASE_URL` using HTTPS
4. Decide the email posture before go-live:
   - Option A: set `EMAIL_NOTIFICATIONS_ENABLED=true` and validate real SMTP.
   - Option B: leave email disabled and rely on in-app notifications only.
5. Apply database migrations in this order:
   - `database/migrations/20260821-persistent-session-store.sql`
   - `database/migrations/20260324-payroll-gl-posting.sql`
   - `database/migrations/20260324-payroll-gl-posting-seed.sql`
   - `database/migrations/20260711-payroll-workflow.sql`
   - `database/migrations/20260714-record-workflow.sql`
   - `database/migrations/20260714-workflow-notifications.sql`
   - `database/migrations/20260714-parameter-change-workflow.sql`
   - `database/migrations/20260714-payroll-reversal-workflow.sql`
   - `database/migrations/20260715-payroll-reopen-workflow.sql`
   - `database/migrations/20260716-fix-payroll-generation-uniqueness.sql`
6. Verify the `sessions` table exists, uses InnoDB, and includes the expiration index.
7. Configure:
   - `SESSION_SECRET=<cryptographically random value of at least 32 characters>`
   - `NODE_ENV=production`
   - `TRUST_PROXY_HOPS=1` when HTTPS terminates at the upstream proxy/load balancer
8. Run schema preflight using `node scripts/runProductionReadinessChecks.js`.
9. Verify helper tables are present and use InnoDB.
10. Verify payroll generation uniqueness indexes exist on:
   - `payroll_workflow_batches`
   - `payroll_gl_posting_batches`
11. Install locked production dependencies with `npm ci --omit=dev` and run `npm audit --omit=dev`.
12. Restart the Node application.
13. Verify static assets under nested routes:
   - login page
   - finance dashboard
   - manager dashboard
   - auditor dashboard
   - entity-head dashboard
   - notifications
   - work queue
14. Run login smoke tests for:
   - Admin
   - Finance Officer
   - Finance Manager
   - Manager
   - Auditor
   - Data Entry Officer
   - Entity Head/HNO
15. Run `node scripts/testPersistentSessionStore.js`.
16. Perform one manual restart-persistence check after a successful login.
17. Run a non-destructive payroll workflow smoke test in staging/test company data.
18. Verify one in-app notification and one work-queue item per major role.
19. Verify key reports open without a 500 error.
20. Verify CSRF rejection (403), security headers, login throttling (429), secure cookie delivery through the production proxy, and POST logout.
21. Run `node scripts/testCsrfProtection.js` and `node scripts/testLoginRateLimiting.js` in the isolated staging environment.
22. Confirm PRD-009B evidence is available and rerun a production-environment smoke visual check for the deployed URL.
23. Review application logs for:
   - unhandled promise rejections
   - SQL errors
   - SMTP errors
   - session/cookie warnings

## HTTPS / Proxy Topology

Expected production topology:

Client browser -> HTTPS reverse proxy/web server -> Node.js application

Set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops only when TLS terminates before Node.js. For a single cPanel, Apache, Nginx, Cloudflare, or load-balancer hop, use `TRUST_PROXY_HOPS=1`. If Node.js terminates HTTPS directly, use `TRUST_PROXY_HOPS=0`. The reverse proxy must forward `X-Forwarded-Proto: https` so Express can issue and accept secure cookies correctly.

The application enables production HSTS through Helmet only when `NODE_ENV=production`. HTTP-to-HTTPS redirection should be handled by the reverse proxy unless the deployment topology explicitly moves TLS termination into Node.js.

## Production Preconditions

The following must be completed before opening public access:

- real production `SESSION_SECRET`, HTTPS URL, database credentials and proxy hop count configured
- full database, application, environment, upload/static asset backup completed
- supported GL posting scope retained as `01 = Salary` only unless future accounting mappings are approved
- PRD-009B visual evidence reviewed and a final deployed-URL smoke check completed
- SMTP decision confirmed: configured and tested, or disabled with in-app notifications only

## Rollback Plan

### Code Rollback

1. Stop the Node application.
2. Redeploy the previous stable code package.
3. Restore the previous environment file if it changed.
4. Restart the Node application.
5. Do not re-enable MemoryStore for production as a fallback; keep login unavailable until persistent-session configuration is corrected.

### Database Rollback

1. If the deployment introduced schema incompatibility or unrecoverable runtime defects, restore the full production backup taken immediately before deployment.
2. Do **not** manually delete:
   - payroll workflow history
   - record workflow history
   - notification rows
   - reversal rows
   - reopen rows
   - archived reversed payroll rows
3. Do **not** manually clear payroll generation history to “fix” a reopen issue.
4. Do **not** delete original GL posting or reversal records.

### Route/Feature Containment

If a rollback must be partial while preserving historical data:

- disable newly exposed workflow navigation links first
- block high-risk routes at middleware level if necessary
- keep existing historical workflow tables intact
- preserve all audit and workflow history for post-incident review

## Recovery Guidance After Failed Reopen/Reversal Tests

- If a reopen request fails before Generation 2 is created, keep the original generation `REVERSED` and investigate request/action history.
- If Generation 2 creation partially fails, resolve by reviewing:
  - `payroll_reopen_requests`
  - `payroll_reopen_actions`
  - `payroll_workflow_batches`
  - `payroll_reversed_row_archive`
- If posting fails, do not manually toggle `posted_to_gl`; use workflow and GL history to reconcile first.

## Final Acceptance Preconditions

Before handover closure:

- nominated users created
- final roles confirmed
- SMTP decision documented
- staging/manual UAT completed
- outstanding issues accepted or fixed
- support contact agreed
- backup/restore procedure tested or signed off
- deployed URL recorded in `docs/PRODUCTION-DEPLOYMENT-EVIDENCE.md`
- client role sign-off recorded in `docs/CLIENT-GO-LIVE-ACCEPTANCE.md`

## Go-Live Verdict Rule

Use:

- `DEPLOYMENT VERDICT: READY FOR CLIENT GO-LIVE` only after real production secrets, DB credentials, backup verification, migrations, HTTPS/proxy, secure cookies, deployed seven-role smoke tests, final HTTP UAT rerun, key report/PDF checks, and client signoff are complete.
- `DEPLOYMENT VERDICT: READY FOR CLIENT GO-LIVE WITH CONDITIONS` only when no Critical/High defects remain and any remaining items are explicitly accepted operational conditions.
- `DEPLOYMENT VERDICT: BLOCKED` if production URL, DB credentials, backups, HTTPS/proxy validation, deployed smoke tests, or client signoff are unavailable or failed.
