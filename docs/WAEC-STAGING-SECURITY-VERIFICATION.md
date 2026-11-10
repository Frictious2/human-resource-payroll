# WAEC Staging Security Verification

Executed locally on Windows, 9 November 2026. This report separates real HTTP/database reads from mocked mutation tests. No online deployment occurred.

## Executed commands

| Command/check | Actual result / scope |
| --- | --- |
| `npm audit --omit=dev --json` before changes | 2 High / 5 Moderate affected packages, including propagated parent-package findings |
| `npm install --ignore-scripts` | Five compatible dependency changes; lockfile updated, no forced audit fix |
| `npm audit --omit=dev` after changes | PASS, zero vulnerabilities |
| `npm ls body-parser multer nodemailer qs ip-address --omit=dev` | PASS; versions recorded in hardening report |
| `node scripts/testFinalSecurityHardening.js` | PASS: actual services with in-memory account/audit adapter; role/company/tamper/expiry/replay/concurrency, audit rollback, no bootstrap; HTTP synthetic files/uploads; bounded cleanup; drain/duplicate/deadline shutdown |
| `node scripts/testSecurityHttpIsolated.js` | PASS: real Express server, real bcrypt authentication and CSRF/role/session middleware, seven synthetic role identities and memory sessions; missing/invalid CSRF 403, valid-token authorization denial, logout, fixed account scope, login/account 429 and safe headers |
| Production-mode startup rehearsal | PASS with a SELECT/SHOW-only fake DB and temporary loopback listener; no privileged creation/reset possible through the adapter |
| `node scripts/testSecurityPayrollRegression.js` | PASS: 19 independent PAYE boundaries; taxability, employee/employer NASSIT, PROV-EMP exactly once, net/deduction reconciliation with query-only synthetic calculation data |
| `node scripts/testStagingSessionStore.js` | PASS: actual sessions table; create/read/touch/expiry/delete, independent process read and distinct-session concurrency; five random session IDs removed; no user fixtures |
| `node scripts/testFinanceManagerOversight.js` | PASS: ten authenticated read routes, liability preview/PDF HTTP endpoints and eight forbidden mutations. Uses synthetic sessions, not new accounts; optional cross-company branches depend on existing foreign records |
| `node scripts/testReadOnlyReportRuntime.js` | PASS: runs existing `testPayrollLiabilityReports.js` against temporary app server and verifies protected source-table fingerprints unchanged |
| `node scripts/testAccountSetupEmail.js` | PASS: mocked account/mail handlers, required-mail behavior, all seven role resends, configuration/rejection failures, seven EJS templates |
| `node scripts/testSmtpEnvironment.js` | PASS: project-file-only settings, inherited SMTP removal, missing/blank/read-error handling, other environment settings preserved |
| SMTP transport `verify()` | PASS, including a fresh check after the owner confirmed rotation and `.env` update; no email sent, no password printed |
| Read-only DB/schema inspection | MariaDB 11.4.9; account/developer/audit/session tables InnoDB; current reset secret satisfies minimum length (value not disclosed) |
| `node scripts/runProductionReadinessChecks.js` | Exit 0; current date corrected; session/reset validation and existing security checks true; no syntax failures; one existing EmpStatus warning group remains |
| Changed/new JS `node --check` sweep | PASS (25 files at latest recorded sweep, including profile password hardening) |
| Full EJS compile sweep | PASS: 276 templates |
| `git diff --check` | PASS; only CRLF normalization warnings |
| Credential scan | No current SMTP password literal in scanned tracked source/docs; no secret printed. Full repository-history scan not claimed |

The shutdown deadline warning in the test output is intentionally induced by the timeout test, not an interrupted live payroll request.

## Financial and account safety

The report harness fingerprints Company 1 `tblstaff`, `tblentitle`, `tblsalary`, `tblpayroll` and `tblgltrans` before/after its execution. All fingerprints matched. Thus batch 161 and the related stored GL row remained intact during the runtime report regression. No values or hashes containing employee rows were exported.

Account creation, password setup and audit-failure scenarios were tested only against in-memory adapters. No production Finance Manager/Developer/Admin account, password or permission was created or modified. DB-backed session fixtures were cleaned by their exact random identifiers. This task did not approve, cancel, reverse, reopen, regenerate or post any payroll.

## Coverage limits and remaining gates

- The historical `testCsrfProtection.js` and `testLoginRateLimiting.js` harnesses seed privileged accounts in the selected DB. They were not executed here; the new in-memory HTTP harness exercises the real app/security stack without those writes.
- `testPersistentSessionStore.js` creates a Developer fixture; it was not rerun. Actual DB persistence/expiry/multi-process checks plus real HTTP memory-store login/regeneration/logout cover separate parts of that lifecycle, not a claimed end-to-end DB-backed login test.
- Full payroll foundation/yearly-payment/reversal/reopen/approval mutation suites were not run against `personnel_master`, in accordance with financial safety restrictions. Prior passing evidence is historical, not a new regression result. Run these only on an approved disposable DB.
- Synthetic fixed/percentage contributions and the canonical PAYE path were verified without altering calculations. No historical payroll was recalculated.
- No real database outage, Linux production install, OS signal/reboot rehearsal, browser visual/PDF rendering or HTTPS-proxy deployment was performed. The production-mode boot used a fake DB, not production infrastructure. PDF routes returning 200/HTML are not visual PDF evidence.
- SMTP rotation and `.env` update are owner-confirmed; a fresh authentication check passed. Old-password rejection was not tested and approved-recipient inbox receipt remains unverified. Successful authentication alone is not proof of rotation.
- Existing runtime ensure-table DDL/CRUD-only permission qualification and the readiness EmpStatus warning remain documented; no source data or schema was altered to remove them.

## Acceptance classification

SECURITY HARDENING: PASS (implemented local controls/tests only)

DEPENDENCY AUDIT: PASS

PRIVATE FILE ACCESS: PASS (application layer; legacy physical migration authorization pending)

SESSION LIFECYCLE: PASS (tested scope above)

ACCOUNT PROVISIONING: PASS (isolated tests; real account onboarding not performed)

STAGING DEPLOYMENT: BLOCKED

Clear the operator credential/private-storage gates and complete disposable-DB/Linux acceptance before approving external staging. No production-ready verdict is issued.
