# WAEC cPanel Staging Acceptance

Prepared 2026-11-10 UTC. **TARGET CPANEL ACCEPTANCE: NOT YET TESTED. PRODUCTION DEPLOYMENT: NOT READY.**

This is an executable acceptance plan, not evidence of deployment. Record the real URL, Node/npm/Passenger/MariaDB versions, provider proxy chain, tester/date and archive SHA-256 in protected release evidence before testing. Use only the separate synthetic staging database and operator-chosen staging credentials. Do not connect these tests to `personnel_master` or operate on August 2026 batch 161.

## Target-server matrix

All rows begin NOT YET TESTED; do not replace them with PASS from a local Windows/HTTP-only result.

| ID | Test | Expected evidence | Target result |
| --- | --- | --- | --- |
| CP-01 | HTTPS/certificate/redirect | Valid hostname/chain, HTTP redirects once, no mixed-content or redirect loop | NOT YET TESTED |
| CP-02 | Passenger/proxy | Startup `app.js`, one managed listener, no public Node port, confirmed trusted headers/hops | NOT YET TESTED |
| CP-03 | Secure cookies | Real-browser Secure/HttpOnly/SameSite=Lax cookie; no token/session value in screenshots | NOT YET TESTED |
| CP-04 | Login/logout | Seven synthetic roles route correctly; login regenerates session; protected POST logout invalidates it | NOT YET TESTED |
| CP-05 | CSRF | Missing/invalid tokens fail 403 without data changes; real valid forms and parallel follow-up navigation work | NOT YET TESTED |
| CP-06 | Sessions | Login survives managed app restart; expiration and bounded indexed cleanup work, active sessions remain | NOT YET TESTED |
| CP-07 | DB/engine | Guarded CLI check passes, expected DB/148-table schema baseline and InnoDB/session indexes verified | NOT YET TESTED |
| CP-08 | Role restrictions | Finance Manager cannot mutate; Manager cannot Auditor-review; Auditor cannot HNO-approve; HNO cannot Finance-execute | NOT YET TESTED |
| CP-09 | Installation company | Forged CompanyID and foreign-company sessions/records denied, including own-PF foreign child records | NOT YET TESTED |
| CP-10 | Employee management | Synthetic S001/S002 visible; new synthetic third employee can be submitted/reviewed; no real data present | NOT YET TESTED |
| CP-11 | Entitlement/salary | Pending values visible to Manager; approvals authenticated/audited; Transport/COLA remain manual where entered | NOT YET TESTED |
| CP-12 | Calculation controls | Basic 3,000, PAYE 287.50, employee NASSIT 150, PROV-EMP 300, net 2,262.50 for the two salary-only controls | NOT YET TESTED |
| CP-13 | Process Emoluments | August 2098 Salary 01 creates two Generation 1 rows and PROCESSED workflow; no August 2026 operation | NOT YET TESTED |
| CP-14 | Approval chain | Finance submit -> Manager -> Auditor -> HNO; Finance Manager observes only; audits/comments/statuses agree | NOT YET TESTED |
| CP-15 | Posting/correction safeguards | Premature/unauthorized/unsupported activity operations denied; any positive test only on approved synthetic Salary 01 | NOT YET TESTED |
| CP-16 | Payslips | Employee/period/earnings/deductions/net equal authoritative synthetic payroll rows; employer NASSIT not deducted | NOT YET TESTED |
| CP-17 | Reports/PDF/print | PAYE/EOS/NASSIT/Journal/GL/Payslip plus agreed statements/Bio Data open visually; all-page print/PDF, pagination and headers correct | NOT YET TESTED |
| CP-18 | Excel | Download/open supported exports; header/row count/dates/numeric totals match synthetic payroll | NOT YET TESTED |
| CP-19 | Private uploads | Synthetic image validates, authorized download works, anonymous/foreign-company/wrong-role/traversal denied; Apache static bypass impossible | NOT YET TESTED |
| CP-20 | Secret/source exposure | `.env`, private files, source, SQL/config snapshots, manifests, logs and backups cannot be fetched through the public origin | NOT YET TESTED |
| CP-21 | SMTP | Explicit approved recipient only; one non-sensitive message; recipient/log confirmation; no credentials in evidence | NOT YET TESTED |
| CP-22 | Managed restart | Request drain, worker return, DB reconnect, persistent login then logout verified; no active payroll interrupted | NOT YET TESTED |
| CP-23 | Errors/headers/limiter | Safe 403/404/500/429, no SQL/stack, CSP/assets work, HSTS/frame/MIME/referrer protections active, X-Powered-By absent | NOT YET TESTED |
| CP-24 | Restore/rollback | Restore a staging backup into another empty protected DB/storage root, verify counts/hashes and record recovery times | NOT YET TESTED |

Foreign-company fixtures for CP-09 must be created only by an explicitly authorized isolated test harness/administrator. Do not enable a public company switch, delete other-company records, or manufacture production approval history. Preserve before/after hashes/counts for negative mutation tests. Do not disable CSRF/rate limiting merely to get a passing result.

## Operator flow

1. Finish the installation guide through guarded initialization and read-only CLI controls. Confirm the schema/config seed contains no source personnel/payroll/account rows.
2. Record PASS/FAIL and safe evidence for CP-01 through CP-09 before widening access. Keep the host restricted if any security test fails.
3. Complete CP-10 through CP-15 through normal role sessions and approvals on synthetic data. The initializer deliberately leaves approvals pending and does not process monthly payroll.
4. Open and inspect actual browser/print/PDF and Excel output for CP-16 through CP-18. Record browser/device dimensions, page counts and data spot checks. Do not label an HTML export a binary PDF without checking the supported application output.
5. Test generated private images only. Retain no real employee documents or credentials as screenshots/download artifacts.
6. For SMTP, obtain recipient approval separately. If none is approved, mark CP-21 BLOCKED rather than sending. SMTP-disabled workflow operation should also be checked.
7. Restart through the provider control with no active payroll transaction; test persistent sessions and logout. Finish backup restore and client acceptance, then agree whether restricted staging may proceed. Production remains a separate approval.

## Local package verification (not target acceptance)

The accompanying machine report `docs/test-results/waec-cpanel-staging-package-latest.json` and deploy manifest record actual archive hash, contents, sensitive-path/known-secret/credential-pattern checks, deterministic rebuilding, schema/config counts, import/fixture tests, syntax/EJS checks, dependency audit and executed local regressions. They must not be used to pre-fill target rows as PASS.

Independent ZIP extraction/checksums are verified with the platform ZIP reader where available. The package test imports the shipped schema into an empty disposable DB under a user denied access to live WAEC data, seeds only synthetic pending records with transient generated credentials, verifies bcrypt/control values and runs the packaged application locally. No target cPanel/HTTPS/Passenger behavior is inferred from that test.

## Sign-off and rollback

Record unresolved Critical/High issues as blockers. Medium/Low findings need documented owners/workarounds/acceptance. Record stakeholder review of the actual URL and synthetic reports. Do not declare production readiness from a successful archive build.

If target tests fail, restrict/stop the staging application, preserve protected diagnostics and restore the previous compatible application/configuration where needed. Do not restore over or modify live WAEC. Recreate only the dedicated disposable staging DB with explicit authorization if a partial schema import cannot be repaired safely. Restore backup data only after assessing what would be lost. Private-file migration remains unexecuted and requires separate backup/authorization/checksum/rollback controls.
