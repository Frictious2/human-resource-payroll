# Production Deployment Evidence

Preparation date: Saturday, August 29, 2026

This document records deployment evidence for Release `v1.0.0`. Items marked `PENDING ON DEPLOYMENT HOST` must be completed on the actual production server and must not be inferred from local development evidence.

## Deployment Summary

| Item | Evidence |
| --- | --- |
| Release version | `v1.0.0` |
| Commit | `1e543a66c25edbabce0ebc85c376c668483517e2` |
| Deployment date/time | PENDING ON DEPLOYMENT HOST |
| Production domain / URL | PENDING ON DEPLOYMENT HOST |
| Production topology | Browser -> HTTPS -> reverse proxy/web server -> Node.js application |
| Node.js version | PENDING ON DEPLOYMENT HOST; local verified version is `v22.19.0` |
| npm install method | `npm ci --omit=dev` |
| Database | `personnel_master` |
| DB server/version | PENDING ON DEPLOYMENT HOST; local verified version is `11.4.9-MariaDB` |
| SMTP posture | PENDING: enabled with tested SMTP or disabled with in-app notifications only |

## Backup Evidence

| Check | Result | Notes |
| --- | --- | --- |
| Full database backup created | PENDING ON DEPLOYMENT HOST | Must be completed before migration/import |
| Backup filename | PENDING ON DEPLOYMENT HOST | Do not store secrets in evidence |
| Backup size | PENDING ON DEPLOYMENT HOST | Record approximate size |
| Dump inspected | PENDING ON DEPLOYMENT HOST | Verify legacy and helper tables exist |
| Temporary restore test | OPTIONAL / RECOMMENDED | Strongly recommended before go-live |
| Application source backup | PENDING ON DEPLOYMENT HOST | Include source, migrations, public assets, views and docs |
| Environment backup | PENDING ON DEPLOYMENT HOST | Store securely; do not commit |
| Uploaded/static asset backup | PENDING ON DEPLOYMENT HOST | Include company logos and report assets |

Critical tables to verify in backup:

- `tblstaff`
- `tblsalary`
- `tblPayroll`
- `tblentitle`
- `tblpaytype`
- `tblparams1`
- `tblgltrans`
- `tblyearlypayments`
- `tblaudittrail`
- `sessions`
- `payroll_workflow_batches`
- `payroll_workflow_actions`
- `payroll_gl_posting_batches`
- `payroll_reversal_requests`
- `payroll_reversal_actions`
- `payroll_reopen_requests`
- `payroll_reopen_actions`
- `payroll_reversed_row_archive`
- `record_workflow_items`
- `record_workflow_actions`
- `parameter_change_requests`
- `parameter_change_actions`
- `workflow_notifications`
- `yearly_payment_batches`
- `yearly_payment_batch_rows`
- `yearly_payment_batch_actions`

## Migration Evidence

| Migration | Status | Verification |
| --- | --- | --- |
| `20260821-persistent-session-store.sql` | PENDING ON DEPLOYMENT HOST | `sessions` table exists, InnoDB, expiration index |
| `20260324-payroll-gl-posting.sql` | PENDING ON DEPLOYMENT HOST | GL posting helper tables/columns present |
| `20260324-payroll-gl-posting-seed.sql` | PENDING ON DEPLOYMENT HOST | Salary GL mapping seeds verified |
| `20260711-payroll-workflow.sql` | PENDING ON DEPLOYMENT HOST | Payroll workflow tables present |
| `20260714-record-workflow.sql` | PENDING ON DEPLOYMENT HOST | Record workflow tables present |
| `20260714-workflow-notifications.sql` | PENDING ON DEPLOYMENT HOST | Notification table/indexes present |
| `20260714-parameter-change-workflow.sql` | PENDING ON DEPLOYMENT HOST | Parameter change tables present |
| `20260714-payroll-reversal-workflow.sql` | PENDING ON DEPLOYMENT HOST | Reversal tables present |
| `20260715-payroll-reopen-workflow.sql` | PENDING ON DEPLOYMENT HOST | Reopen/archive tables and generation columns present |
| `20260716-fix-payroll-generation-uniqueness.sql` | PENDING ON DEPLOYMENT HOST | Old period-only unique keys gone; generation-aware keys active |
| `20260821-yearly-payment-batches.sql` | PENDING ON DEPLOYMENT HOST | Yearly-payment batch/action/row tables present |

Post-migration command:

```powershell
node scripts/runProductionReadinessChecks.js
```

Expected result: readiness runner reports PASS, including `Session Store: MySQL`, generation-aware indexes, zero active Coming Soon routes, and PRD-009B visual evidence present.

## Environment Validation

| Check | Result |
| --- | --- |
| `NODE_ENV=production` | PENDING ON DEPLOYMENT HOST |
| Strong `SESSION_SECRET` configured | PENDING ON DEPLOYMENT HOST |
| Missing/unsafe `SESSION_SECRET` refuses startup | VERIFIED IN CODE |
| DB host/name/user/password configured | PENDING ON DEPLOYMENT HOST |
| `APP_BASE_URL` uses HTTPS | PENDING ON DEPLOYMENT HOST |
| `TRUST_PROXY_HOPS` matches topology | PENDING ON DEPLOYMENT HOST |
| Email disabled or SMTP complete | PENDING ON DEPLOYMENT HOST |

Do not print or record real secret values in this document.

## HTTPS / Proxy / Cookie Evidence

| Check | Result |
| --- | --- |
| HTTPS certificate valid | PENDING ON DEPLOYMENT HOST |
| HTTP redirects to HTTPS without loop | PENDING ON DEPLOYMENT HOST |
| Reverse proxy forwards `X-Forwarded-Proto: https` | PENDING ON DEPLOYMENT HOST |
| Express trust proxy matches proxy hop count | PENDING ON DEPLOYMENT HOST |
| Cookie name is `hrpayroll.sid` | PENDING ON DEPLOYMENT HOST |
| Cookie has `HttpOnly` | PENDING ON DEPLOYMENT HOST |
| Cookie has `Secure` in production HTTPS | PENDING ON DEPLOYMENT HOST |
| Cookie has `SameSite=Lax` | PENDING ON DEPLOYMENT HOST |
| HSTS present over production HTTPS | PENDING ON DEPLOYMENT HOST |

## Security Checks

| Check | Result |
| --- | --- |
| CSRF valid mutation works | PENDING ON DEPLOYMENT HOST |
| Missing CSRF token returns safe 403 | PENDING ON DEPLOYMENT HOST |
| Login rate limiting active | PENDING ON DEPLOYMENT HOST |
| CSP does not block deployed assets | PENDING ON DEPLOYMENT HOST |
| `X-Powered-By` absent | PENDING ON DEPLOYMENT HOST |
| Production error pages hide stack traces | PENDING ON DEPLOYMENT HOST |

## Role Smoke Tests

| Role | Login | Dashboard | Core read page | Logout | Status |
| --- | --- | --- | --- | --- | --- |
| Administrator | PENDING | PENDING | PENDING | PENDING | PENDING ON DEPLOYMENT HOST |
| Data Entry Officer | PENDING | PENDING | PENDING | PENDING | PENDING ON DEPLOYMENT HOST |
| Finance Officer | PENDING | PENDING | PENDING | PENDING | PENDING ON DEPLOYMENT HOST |
| Finance Manager | PENDING | PENDING | PENDING | PENDING | PENDING ON DEPLOYMENT HOST |
| Manager | PENDING | PENDING | PENDING | PENDING | PENDING ON DEPLOYMENT HOST |
| Auditor | PENDING | PENDING | PENDING | PENDING | PENDING ON DEPLOYMENT HOST |
| Entity Head / HNO | PENDING | PENDING | PENDING | PENDING | PENDING ON DEPLOYMENT HOST |

Staff Self-Service is deferred/out of scope for Release 1.0.

## Report Checks

| Report | Browser preview | PDF | Export | Status |
| --- | --- | --- | --- | --- |
| PAYE | PENDING | PENDING | PENDING | PENDING ON DEPLOYMENT HOST |
| EOS Benefit | PENDING | PENDING | PENDING | PENDING ON DEPLOYMENT HOST |
| NASSIT Contribution | PENDING | PENDING | PENDING | PENDING ON DEPLOYMENT HOST |
| Staff PAYE Statement | PENDING | PENDING | N/A | PENDING ON DEPLOYMENT HOST |
| NASSIT Statement | PENDING | PENDING | N/A | PENDING ON DEPLOYMENT HOST |
| Gratuity Statement | PENDING | PENDING | N/A | PENDING ON DEPLOYMENT HOST |
| Bio Data | PENDING | PENDING | N/A | PENDING ON DEPLOYMENT HOST |
| Journal | PENDING | PENDING | As supported | PENDING ON DEPLOYMENT HOST |
| Payslip | PENDING | PENDING | As supported | PENDING ON DEPLOYMENT HOST |
| General Ledger | PENDING | PENDING | As supported | PENDING ON DEPLOYMENT HOST |
| End of Service | PENDING | PENDING | As supported | PENDING ON DEPLOYMENT HOST |

## Test Data Cleanup

Search for known UAT markers before production handover:

- `phase15a_%`
- PFNo `9301`
- PFNo `9302`
- payroll period `11/2098`
- synthetic CompanyID `2` only if confirmed not to be real production data
- test yearly-payment drafts created by automation
- stale `sessions` rows

Do not delete genuine CompanyID 2 data if it has a real business purpose.

## Final HTTP UAT Rerun

Run after deployment:

```powershell
node scripts/testPrd009CrossRoleHttpUat.js
```

Result: PENDING ON DEPLOYMENT HOST.

This run closes the prior local interruption note only when completed against the stable deployed environment.

## Deployment Verdict

`DEPLOYMENT VERDICT: BLOCKED`

Reason: production deployment access, real URL, real DB credentials, backup evidence, HTTPS/proxy verification, deployed route smoke tests, report/PDF checks, and client signoff have not yet been completed on the production host.
