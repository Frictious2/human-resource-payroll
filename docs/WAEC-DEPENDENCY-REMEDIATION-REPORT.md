# WAEC HR & Payroll - Dependency Remediation Report

Generated: 2026-10-09

## Scope

This remediation addressed production dependency vulnerabilities and stabilized the Payroll Liability report test fixture.

No payroll records, staff records, entitlement records, salary records, GL rows, approval statuses, August batch 161 records, or historical financial records were intentionally modified.

## Original Vulnerabilities

`npm audit --omit=dev --json` originally reported:

| Package | Severity | Direct / Transitive | Installed Path | Vulnerable Range | Remediation |
| --- | --- | --- | --- | --- | --- |
| `proxy-addr` | Critical | Transitive via `express` | `express -> proxy-addr@2.0.7` | `>=1.1.0 <2.0.8` | npm override to `2.0.8` |
| `multer` | High | Direct | `multer@2.2.0` | `<2.3.0` plus `>=2.2.0 <2.4.0` | upgraded to `2.4.0` |
| `mysql2` | High | Direct and transitive | `mysql2@3.15.3`, `express-mysql-session -> mysql2@3.10.2` | `<3.22.0`, `<=3.23.0` | upgraded direct `mysql2` to `3.24.5`; removed vulnerable `express-mysql-session` |
| `nodemailer` | High | Direct | `nodemailer@9.0.6` | multiple ranges up to `<=10.0.5` | upgraded to `10.0.16` |
| `brace-expansion` | High | Transitive via `ejs -> jake -> filelist -> minimatch` | `brace-expansion@2.1.4` | `2.0.0 - 2.1.6` | npm override to `2.1.7` |
| `ip-address` | Moderate | Transitive via `express-rate-limit` | `ip-address@10.5.0` | `<=10.7.0` | npm override to `10.7.3` |
| `qs` | Moderate | Transitive via `express` / `body-parser` | `qs@6.15.3` | `>=6.14.2 <=6.15.3`, `<6.16.0` | npm override to `6.16.0` |
| `express-mysql-session` | Moderate/High blocker during investigation | Direct | `express-mysql-session@3.0.3` or downgrade `2.1.8` | `3.0.3` vendors vulnerable exact `mysql2@3.10.2`; `2.1.8` brings vulnerable old dependencies | removed and replaced with local MySQL session store |

## Packages Updated

| Package | Before | After | Notes |
| --- | ---: | ---: | --- |
| `multer` | `^2.0.2` | `^2.4.0` | Direct patch upgrade |
| `mysql2` | `^3.15.3` | `^3.24.5` | Direct patch/minor upgrade |
| `nodemailer` | `^9.0.6` | `^10.0.16` | Major upgrade; email notifications remain disabled in current env |
| `express-mysql-session` | `^3.0.3` | removed | Replaced by local `MysqlSessionStore` using existing `sessions` table |

Overrides added:

- `brace-expansion: 2.1.7`
- `ip-address: 10.7.3`
- `proxy-addr: 2.0.8`
- `qs: 6.16.0`

## Session Store Compatibility Change

`express-mysql-session` was removed because:

- Version `3.0.3` pins `mysql2@3.10.2` exactly, leaving high advisories.
- npm's suggested downgrade to `2.1.8` introduced high/low advisories in `underscore`, nested `express-session`, `cookie`, and `on-headers`.

Implemented replacement:

- `config/sessionStore.js` now contains `MysqlSessionStore`, extending `express-session`'s store.
- It uses the existing shared `mysql2` pool.
- It preserves the existing `sessions` table schema: `session_id`, `expires`, `data`.
- It supports callback and Promise-style `get`, `set`, `destroy`, `touch`, `close`, and `onReady`.
- `getSessionStoreDescriptor()` still reports `MySQL`.

Verified by:

- `node scripts/testPersistentSessionStore.js` -> PASS
- `node scripts/runProductionReadinessChecks.js` -> PASS

## Payroll Liability Fixture Correction

Original failure:

- `scripts/testPayrollLiabilityReports.js` defaulted to PFNo `0300`.
- The current reduced WAEC dataset contains six employees and no PFNo `0300`.
- Staff PAYE Statement lookup failed with: `No staff record was found for the selected PFNo within your company.`

Correction:

- Added `resolveTestPfNo(companyId)`.
- If `TEST_PFNO` is supplied, the test honors it.
- Otherwise the test discovers a CompanyID-scoped staff PFNo with PAYE-bearing `tblpayroll` rows.
- The test still fails clearly if no suitable staff/payroll fixture exists.

Result:

- `node scripts/testPayrollLiabilityReports.js` -> PASS

## Final Dependency State

Final command:

```text
npm audit --omit=dev --json
```

Result:

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Moderate | 0 |
| Low | 0 |
| Total | 0 |

Installed patched dependency evidence:

- `proxy-addr@2.0.8`
- `qs@6.16.0`
- `multer@2.4.0`
- `mysql2@3.24.5`
- `nodemailer@10.0.16`
- `ip-address@10.7.3`
- `brace-expansion@2.1.7`
- `express-session@1.18.2`

## Regression Test Results

| Command | Result |
| --- | --- |
| `node --check config/sessionStore.js` | PASS |
| `node --check scripts/testPayrollLiabilityReports.js` | PASS |
| `node --check server.js` | PASS |
| `node --check middleware/security.js` | PASS |
| `node scripts/testPersistentSessionStore.js` | PASS |
| `NODE_ENV=test node scripts/testCsrfProtection.js` | PASS |
| `NODE_ENV=test node scripts/testLoginRateLimiting.js` | PASS |
| `node scripts/testPayrollLiabilityReports.js` | PASS |
| `node scripts/testFinanceManagerOversight.js` | PASS |
| `node scripts/auditSierraLeonePayeCalculation.js` | PASS AFTER CORRECTIONS |
| `node scripts/auditPayrollItemTaxability.js` | PASS |
| `node scripts/verifyWaecProvidentFundDeduction.js` | PASS WITH CORRECTIONS |
| `node scripts/testYearlyPaymentWorkflow.js` | PASS |
| `node scripts/runProductionReadinessChecks.js` | PASS |
| `npm audit --omit=dev --json` | PASS - zero vulnerabilities |

Notes:

- CSRF and rate-limit tests share the same temporary security users and must be run sequentially, not in parallel.
- Destructive payroll reversal/reopen lifecycle simulations were not rerun in this pass to avoid changing live WAEC financial records. The readiness runner still confirms the latest isolated PRD-005 reversal evidence is PASS and protected by its production safety guard.
- The yearly-payment test created preview draft IDs during execution but left no persisted `yearly_payment_batches` rows after completion.

## Financial Safety

The remediation did not intentionally modify:

- `tblstaff`
- `tblentitle`
- `tblsalary`
- `tblpayroll`
- `tblgltrans`
- Payroll batch 161
- Existing approval records

No payroll was approved, reopened, reversed, regenerated, paid, or posted.

## Remaining Blockers

No dependency vulnerability blocker remains.

Production readiness still depends on deployment-only and business-process prerequisites documented in the production-readiness audit:

- Real production `SESSION_SECRET`
- Production DB credentials
- HTTPS/reverse proxy
- Verified backup/restore
- Real Finance Manager account for CompanyID 1
- Explicit authorization before correcting August batch 161
- Target-server staging UAT

## Final Status

DEPENDENCY REMEDIATION: PASS

READY FOR STAGING: YES

READY FOR PRODUCTION: NO

Production readiness is not claimed solely from dependency remediation; deployment configuration, staging validation, backup restore, role setup, and August payroll authorization remain required.
