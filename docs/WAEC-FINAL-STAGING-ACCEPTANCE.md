# WAEC Final Staging Acceptance

Follow-up (2026-11-09 UTC): STG-ISO-001 and additional concrete standalone ownership findings have since been fixed and verified by the standalone/cPanel hardening pass. See `WAEC-STANDALONE-INSTALLATION-ARCHITECTURE.md`, `WAEC-CPANEL-WHM-READINESS-CHECKLIST.md` and `test-results/waec-standalone-cpanel-readiness-latest.json`. The historical results below are retained; actual hosted Linux/cPanel acceptance is still outstanding and no deployment occurred.

Date: 2026-11-09. Execution host: Windows, Node.js 22.19.0, MariaDB 11.4.9.

**STAGING ACCEPTANCE: BLOCKED**  
**EXTERNAL STAGING DEPLOYMENT: BLOCKED**  
**PRODUCTION DEPLOYMENT: NOT READY**

No application was deployed. This report supersedes any inference that the previous, narrower local security checks proved all company-isolation paths safe.

## Results

| Area | Result | Evidence / limitation |
| --- | --- | --- |
| SMTP delivery | PASS | Exactly one authorized non-sensitive message; recipient confirmed Inbox receipt in chat. |
| Private-file migration rehearsal | PASS, bounded scope | Copy-only test of the one database-referenced employee photo; original files and references unchanged. Actual migration NOT authorized or executed. |
| Disposable database regression | 15 suites PASS | Full synthetic run `waec_acceptance_20261109_2f0c1018`; no live rows copied. |
| Additional staff company-isolation test | FAIL / High | Company 2 Data Entry changed Company 1 synthetic staff through the real application route. |
| Actual Linux acceptance | BLOCKED / NOT EXECUTED | No installed WSL distribution; Docker Linux engine unavailable, service stopped. No separate Linux target supplied. |
| Dependency audit | PASS | `npm audit --omit=dev --json`: Critical 0, High 0, Moderate 0, Low 0. |
| JavaScript / EJS | PASS | 39 changed/new JS files initially checked, plus the new isolation test checked separately; changed runner and employee test rechecked. All 276 EJS templates compiled. |
| Live-data preservation | PASS for protected tables | Before/after fingerprints match in both final runs, including staff, entitlement, salary, payroll, GL, users, approval/workflow actions and audit rows. |
| Test cleanup | PASS | Both disposable databases and restricted identities removed; subsequent read-only inventory found zero acceptance databases and zero acceptance user-host entries. |

Counts are **15 passing and 1 failing unique regression suite**, not individual assertions. The focused run repeats employee setup successfully before running the failing isolation test. Earlier diagnostic failures are retained in run evidence; they are not overwritten by the passing full-run result.

## 1. SMTP delivery

Approved recipient: `davidgegbai@davisasmedia.com`. Subject: `WAEC staging acceptance: non-sensitive email test`. Reference: `1594acaf-6768-488c-8808-7a59f79fb049`.

The configured SMTP server accepted the message and the approved recipient confirmed **Received in Inbox**. The attempt ledger is exclusive: the send script refuses another attempt when the ledger exists. No additional message was sent after confirmation. SMTP credentials were neither printed nor replaced.

Evidence: `docs/test-results/staging-acceptance-email-attempt.json`.

## 2. Private-file migration rehearsal

Inventory: six files in the examined upload roots, one Company 1 `tblstaff.PhotoPath` reference and no Company 1 medical receipt references. The complete filename/reference manifest contains private information and remains outside public assets and source control:

`private/staging-file-rehearsal/1ee48c6d-1c0d-4dae-9f58-33cca2f1e548/migration-manifest.json`

The referenced file was copied into separate protected baseline and destination directories. A loopback HTTP harness used the existing private-file handler with synthetic ownership and session identities. Assertions checked authorized download 200 and SHA-256 equality, anonymous denial 401, other-company denial 404, and rollback download from the baseline after removing only the destination copy. Original-file hash and database references were rechecked. Both rehearsal copies were removed; the protected manifest remains.

The five other inventoried files are not thereby classified as employee-owned or authorized for migration. No ownership was invented. Existing paths and originals were not moved, deleted or overwritten. Windows filesystem tests do not prove Linux ownership/permission settings.

Actual migration requires a verified file/database backup, owner review of the protected manifest and unreferenced files, an approved maintenance window and a reversible reference/storage cutover. Keep the original tree available until post-migration download/hash checks pass. Roll back the deployment configuration/reference changes to the recorded baseline if those checks fail; never delete originals as a rollback step.

Evidence: `docs/test-results/private-file-migration-rehearsal-latest.json`.

## 3. Disposable database and regressions

`scripts/runDisposableStagingAcceptance.js` creates a generated database and a randomly credentialed user with privileges **only on that database**. Connection to `personnel_master` with this user was actually denied. A process preloader validates database identities, reasserts isolation after dotenv loading, rejects live-database SQL and mocks child-process SMTP transports. Mutation fixture entry points require that preloader and disposable identity. The unguarded-entry negative check passed before DB initialization.

Only 148 table definitions were copied; no employee, payroll, account, session or other live rows were copied. Reference configurations, companies, users and employee `Q001` were synthetic. Child HTTP servers used loopback. Disposable credentials were held in memory/environment, not written into evidence. All generated databases/users were removed.

The full run passed these suites:

| Script | Result / coverage |
| --- | --- |
| `testDisposableEmployeeSetup.js` | PASS: real HTTP Data Entry creation/submissions, Manager staff/entitlement/salary approvals, audits, monthly processing and normal payroll approval chain; payslip API. |
| `testFinalSecurityHardening.js` | PASS: isolated account/token security, private-file authorization, bounded cleanup and shutdown tests; some cases use controlled adapters rather than an OS/database outage. |
| `testSecurityHttpIsolated.js` | PASS: seven-role Express HTTP login/session regeneration, CSRF, role restrictions, logout, scoped account lists and headers using in-memory fixtures. Not an exhaustive live-controller company-isolation sweep. |
| `testSecurityPayrollRegression.js` | PASS: controlled calculation regressions. |
| `testCsrfProtection.js` | PASS: real application missing/invalid tokens and valid-token authorization contexts in the disposable DB. |
| `testLoginRateLimiting.js` | PASS. |
| `testPersistentSessionStore.js` | PASS: DB-backed session persistence tests on disposable tables. |
| `testPhase14PayrollReversalWorkflow.js` | PASS: isolated posting/reversal lifecycle and integrity/security safeguards. |
| `testPhase15PayrollReopenWorkflow.js` | PASS: isolated corrected-generation workflow. |
| `testYearlyPaymentWorkflow.js` | PASS. |
| `testPayrollWorkflowFoundation.js` | PASS using the synthetic processed payroll, not live batch 161. |
| `testPhase11RecordWorkflows.js` | PASS with assertions aligned to existing automatic submission and edit locking. |
| `testPayrollLiabilityReports.js` | PASS: synthetic payroll-backed report checks and supported Excel response. |
| `auditPayrollItemTaxability.js` | PASS. |
| `auditSierraLeonePayeCalculation.js` | PASS. |

Synthetic salary-only control: Basic 1,000; employee NASSIT 50; employer NASSIT 100; PAYE chargeable 950; PAYE 52.50; employee provident 100; net 797.50. Employer NASSIT is not an employee deduction. Existing employee-pay eligibility was explicitly set using the normal Edit Payroll form before salary approval.

Retained full-run evidence: `docs/test-results/waec_acceptance_20261109_2f0c1018-results.json`.

### Confirmed new High defect: STG-ISO-001

The separate real HTTP test logged in a **Company 2 Data Entry** synthetic user, supplied a valid CSRF token and submitted Company 1 employee `Q001` to:

`POST /data-entry/staff/new-edit`

Observed: **HTTP 302; Company A record unchanged = false**. The employee name/record was changed instead of returning 403/404. Only disposable data was affected; the database was subsequently removed.

Root cause: `controllers/dataEntryController.js`, `postStaffNewEdit`, uses PF-only staff/master-payroll/latest-salary lookups and updates, hard-coded CompanyID 1 on creation, and PF-only qualification writes. The existing role gate and CSRF protection do not establish record ownership. This is a genuine authorization defect, not a missing-token test artifact.

Required correction before external staging: scope all staff-save lookups/writes and compensation/reference lookups to the authenticated company; reject foreign PF numbers before any side effect; retain role/CSRF checks, approval requirements and audit identity. Review the related qualification and master-payroll writes together. Add own-company success, foreign-company denial, no-partial-write and audit tests using disposable fixtures. Do not fix or test by altering real employee records.

No authorization redesign or live record repair was attempted in this acceptance pass. The new failing regression remains strict and is included in future full disposable runs.

Evidence: `docs/test-results/waec_acceptance_20261109_03b1af90-results.json` and `scripts/testDisposableStaffCompanyIsolation.js`.

### Application/fixture changes made

The isolated new-staff test exposed a required `tblpayroll.FullPay` column omitted from the new-staff master-row insert. The insert now explicitly supplies `FullPay=1`, `HalfPay=0`, `WithoutPay=0`, matching the existing staff-edit master-row defaults. No calculation formula or live row changed. The normal salary Edit Payroll eligibility step is still required and was exercised, not bypassed.

The Phase 11 fixture previously expected DRAFT after saves that the existing application automatically submits. It now strictly verifies SUBMITTED_TO_MANAGER and a submission action; training edits first use the existing Manager-return transition. Financial and authorization assertions were not weakened.

Initial runs also saw intermittent valid-request CSRF failures. The last full run and repeated employee setup passed with persisted-session/token equality assertions. No security exemption was added, and no production CSRF defect/root cause was conclusively established. Retain this observation for repeated real-browser/session testing on staging; do not claim that a token race has been diagnosed or fixed.

## 4. Linux acceptance

`wsl --list --quiet` returned no distributions. Docker's Linux engine was unavailable and `com.docker.service` was stopped. The host had approximately 1.6 GB free memory during the earlier availability check; a VM was not started because MariaDB previously suffered InnoDB allocation failure. No public application endpoint was opened.

A static case-sensitive import review resolved 306 literal relative runtime imports without case mismatches. **This is not Linux runtime acceptance.**

The following remain unexecuted on Linux: startup with the selected Node version, MariaDB connection/session persistence and cleanup, actual SIGTERM/request-drain behavior, service-user ownership and permissions, protected upload storage, full PDF generation/rendering, workbook generation/opening, SMTP configuration, logs, production validation and private HTTPS reverse-proxy compatibility. Windows report/API checks do not satisfy those requirements.

Supply an approved private Linux staging host/container with adequate memory, a synthetic-only database and restricted credentials. Resolve STG-ISO-001 before exposing the application externally. Run Linux acceptance without copying real WAEC personal data or granting access to `personnel_master`.

## 5. Safety, remaining blockers and approvals

Live protected-table fingerprints matched before/after both final runs. No live employee/account/approval changes, no payroll processing on WAEC data, no batch 161 change, no live GL write and no fabricated historical audit event occurred. These fingerprints verify record preservation, not a full forensic audit of every database table or outside process.

| Item | Classification | Required next step |
| --- | --- | --- |
| STG-ISO-001 cross-company staff-save mutation | High application defect; blocks staging and production | Scoped authorization correction and disposable negative/rollback regressions. |
| Linux acceptance absent | Acceptance/environment blocker | Approved isolated Linux target and actual execution of the listed runtime/report/proxy checks. |
| Earlier intermittent CSRF failures | Unresolved diagnostic observation | Repeat authenticated browser/session scenarios; investigate if reproducible without weakening CSRF. |
| Private-file production migration | Not authorized / not performed | Backup, manifest/ownership review, approved cutover and rollback. |
| External deployment | Not authorized / not performed | Successful remediation/acceptance plus explicit deployment authorization. |
| Production launch | Not ready | Staging sign-off, production secret/DB/HTTPS/proxy, backup/restore evidence, role provisioning authorization and client acceptance. |

Within this bounded pass: **one confirmed High defect**, no newly demonstrated Critical defect; no assertion is made that untested paths are defect-free. The Linux omissions are untested requirements, not passing tests. SMTP recipient approval applies to the single delivered message only, not future mail or deployment.

## Reproduction

```text
node scripts/runDisposableStagingAcceptance.js
node scripts/runDisposableStagingAcceptance.js --staff-isolation-only
npm audit --omit=dev --json
```

The full runner now includes the failing staff-isolation regression and should remain nonzero until STG-ISO-001 is corrected. Do not run destructive workflow fixtures directly on the live database. The SMTP attempt must not be repeated; receipt has already been confirmed.

Machine-readable summary: `docs/test-results/waec-final-staging-acceptance-latest.json`.

**Recommendation: do not upload to externally accessible staging or production yet.** Remediate the demonstrated isolation flaw, rerun the complete protected disposable suite, then complete actual private Linux acceptance and obtain the required authorization.
