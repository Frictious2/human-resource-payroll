# WAEC HR & Payroll System - Production Readiness Audit

Generated: 2026-10-09

## Scope

This audit reviewed the Node.js, Express, EJS, Bootstrap and MariaDB/MySQL HR & Payroll application for deployment readiness.

The audit was non-destructive. It did not cancel, reopen, regenerate, approve, post, reverse, or modify August 2026 payroll batch 161. It did not modify financial transactions, approval statuses, historical payroll, or accounting entries.

## Overall Classification

**READY FOR STAGING**

The application is suitable for a controlled online staging deployment for WAEC users, after dependency patching is completed or consciously accepted in a non-public staging environment.

It is **not ready for production go-live today** because production dependency vulnerabilities remain, production credentials/HTTPS/proxy/backup restore have not been rehearsed on the target server, CompanyID 1 has no Finance Manager account, and August batch 161 still requires an explicitly authorized correction procedure.

## Architecture

| Area | Finding |
| --- | --- |
| Runtime | Node.js with Express 5.1.0 |
| Views | EJS templates with Bootstrap styling |
| Database | MariaDB 11.4.9, database `personnel_master` |
| Data access | `mysql2/promise` pool in `config/db.js` |
| Authentication | `services/authService.js`, bcrypt support, legacy plaintext upgrade, masked-star passwords rejected |
| Authorization | Role middleware in `middleware/auth.js`, role-specific route mounts in `server.js` |
| Sessions | `express-session` with `express-mysql-session`, cookie name `hrpayroll.sid` |
| CSRF | Session-bound CSRF via `csrf-sync` and automatic token injection |
| Security headers | Helmet CSP, frame denial, MIME sniffing protection, production HSTS |
| Rate limiting | Login-specific `express-rate-limit` |
| Payroll | Process Emoluments plus workflow services; Finance-only processing and GL posting |
| Reports | EJS report views with shared viewer behavior and PDF/Excel exports |
| Audit logging | `auditTrailService` and workflow action tables; future entitlement/salary approvals patched for transactional audit logging |
| Email | Nodemailer configured but email notifications currently disabled |

## Security Findings

| Severity | Finding | Evidence | Recommendation |
| --- | --- | --- | --- |
| Critical | Production dependency vulnerabilities exist, including `proxy-addr` critical advisory and high advisories in `multer`, `mysql2`, and `nodemailer`. | `npm audit --omit=dev --json` returned 1 critical, 4 high, 3 moderate advisories. | Patch dependencies using lockfile-controlled updates, then rerun all regression/security tests before public production. |
| High | Production `SESSION_SECRET` is absent in the local environment. | Readiness runner reported `sessionSecret: missing`; production validator correctly rejects missing/unsafe secrets. | Configure a strong secret only on the target server. |
| High | CompanyID 1 currently has no Finance Manager account in `tblpassword`. | DB audit returned `company1FinanceManager: []`. | Create/verify a real Finance Manager account before staging UAT and go-live. |
| Medium | Seed developer behavior still exists for non-production startup and logs the seed password if a seed is created. | `server.js` calls `ensureSeedDeveloper()` and logs created credentials. | Disable seed creation in production or require explicit `SEED_DEVELOPER_ENABLED=true`; ensure production developer/admin users are created deliberately. |
| Medium | Some development defaults exist for local DB/session fallback. | `config/db.js` defaults to root/blank password/local DB; session fallback is `secret_key` outside production. | Accept only for local development; production validator must remain enforced. |
| Medium | Test/UAT user accounts remain in the current database. | `tblpassword` includes `phase11*` and `phase13*` users. | Clean known synthetic users before staging/prod if this DB is promoted. |
| Low | A shared Coming Soon template remains in the repository. | `views/shared/coming-soon.ejs`. | Not active in production navigation per readiness runner; keep only for deferred/internal routes or remove later. |

## Authentication And Authorization

Security controls verified:

- Login uses bcrypt for hashed credentials and rejects blank/masked legacy passwords.
- Login regenerates session before storing the user.
- Logout is POST-only and destroys the server-side session.
- CSRF rejects missing and invalid tokens.
- Role middleware protects Admin, Data Entry, Finance, Finance Manager, Manager, Auditor and Entity Head/HNO routes.
- Finance Manager read-only oversight test passed: 10 read-only routes and 8 mutation denials.
- CompanyID is propagated in session and used by report/workflow services.

Observed active production roles:

- Admin
- Data Entry Officer
- Finance Officer
- Finance Manager
- Manager
- Auditor
- Entity Head / HNO

Staff Self-Service is deferred/out of scope for this release.

## Database And Integrity

MariaDB/InnoDB is operational.

| Check | Result |
| --- | --- |
| MariaDB version | 11.4.9-MariaDB |
| InnoDB support | YES |
| `tblstaff` | InnoDB, accessible |
| `tblsalary` | InnoDB, accessible |
| `tblpayroll` | InnoDB, accessible |
| `tbltax` | InnoDB, accessible |
| `tblpayrollitems` | InnoDB, accessible |
| Session table | InnoDB, accessible |
| Workflow helper tables | InnoDB, accessible |

Preflight checks from the readiness runner passed for missing payroll rows, posted batches without GL batches, orphan reopen/reversal records, missing notification users, and duplicate generation keys.

## Payroll Calculation Findings

| Area | Status | Notes |
| --- | --- | --- |
| Sierra Leone PAYE | PASS AFTER CORRECTIONS | Progressive PAYE bands are active; employee NASSIT is deducted before PAYE; `AllwThreshold=500` is no longer deducted in active monthly PAYE. |
| Payroll Item Taxability | PASS | Taxable payroll items affect PAYE taxable earnings; non-taxable items do not. |
| Employee NASSIT | PASS | Payroll item `32`, 5% of basic salary. |
| Employer NASSIT | PASS | Payroll item `41`, 10%; not deducted from employee net pay. |
| Employee Provident Fund | PASS WITH CORRECTIONS | Payroll item `33`, `PROV-EMP`, 10% of basic salary, stored in legacy `GratEmp`, deducted exactly once. |
| Payslip/report integration | PASS | Reports consume authoritative payroll rows and do not independently recalculate PAYE. |

Known difference: the corrected statutory PAYE calculation differs from the August 2026 Excel reference by NLe900.01 total PAYE. This is documented and should not be changed merely to match the workbook.

## WAEC August 2026 Payroll State

Existing payroll:

| Field | Value |
| --- | --- |
| CompanyID | 1 |
| Period | August 2026 |
| PType | 01 |
| Batch | 161 |
| Status | PROCESSED |
| Modern GL posted | No |

Current batch 161 remains outdated and unposted. Approved April 2026 salary setup totals remain intact:

| Component | Amount |
| --- | ---: |
| Basic Salary | 50,840.69 |
| Allowances | 77,508.20 |
| Gross Income | 128,348.89 |
| Taxable Income | 125,806.85 |
| PAYE | 35,582.06 |
| Employee NASSIT | 2,542.04 |
| Employee Provident Fund | 5,084.07 |
| Total Deductions | 43,208.17 |
| Net Income | 85,140.72 |

Correction workflow is technically ready with conditions:

1. Take a fresh backup.
2. Finance submits batch 161.
3. Manager returns it for correction.
4. Finance starts correction.
5. Finance reruns Process Emoluments in correction mode.
6. Normal Manager, Auditor, Entity Head/HNO approvals follow.
7. Finance posts to accounts only after final approval.

Do not execute this without explicit client authorization.

## Reporting Findings

Prior PRD-009B evidence inspected 67 screens and 11 reports in Chromium, including PAYE, EOS, NASSIT, Staff PAYE, NASSIT Statement, Gratuity Statement, Bio Data, Journal, Payslip, General Ledger, and End of Service. Console errors were zero.

Current Payroll Liability report test failed in this reduced WAEC database because its scripted Staff PAYE fixture PFNo is not present. This is a test-fixture/data issue; it is not evidence of a production route defect.

## Test Summary

| Test / Check | Result |
| --- | --- |
| `node --check` selected JS files | PASS |
| `node scripts/runProductionReadinessChecks.js` | PASS |
| `node scripts/testCsrfProtection.js` with `NODE_ENV=test` | PASS |
| `node scripts/testLoginRateLimiting.js` with `NODE_ENV=test` | PASS |
| `node scripts/testPersistentSessionStore.js` | PASS |
| `node scripts/testFinanceManagerOversight.js` | PASS |
| `node scripts/auditSierraLeonePayeCalculation.js` | PASS AFTER CORRECTIONS |
| `node scripts/auditPayrollItemTaxability.js` | PASS |
| `node scripts/verifyWaecProvidentFundDeduction.js` | PASS WITH CORRECTIONS |
| `node scripts/testYearlyPaymentWorkflow.js` | PASS |
| `node scripts/testPayrollLiabilityReports.js` | FAIL - missing fixture PFNo in current reduced database |
| `npm audit --omit=dev --json` | FAIL - 1 critical, 4 high, 3 moderate advisories |

## Critical Blockers

1. Production dependency vulnerabilities must be patched or an explicit risk acceptance must be documented for staging-only use.

## High-Priority Issues Before Production

1. Configure real production secrets, DB credentials, HTTPS, trusted proxy, secure cookies and backup locations.
2. Create/verify all real production role accounts, including Finance Manager for CompanyID 1.
3. Remove known synthetic/test users from any database promoted to staging or production.
4. Complete target-server deployment and backup/restore rehearsal.
5. Execute August batch 161 correction only after explicit authorization and backup.
6. Rerun full route/report/browser UAT on the target staging URL.

## Recommendation

The system can be uploaded to an online **staging** server after dependency vulnerability remediation or explicit staging-risk acceptance. It should not be opened for production use until staging UAT, backup restore, production configuration, real role-account setup, and August payroll correction authorization are complete.

FINAL CLASSIFICATION: READY FOR STAGING
