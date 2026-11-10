# WAEC Staging Deployment Checklist

Security code remediation is complete for the tested scope; the original checkboxes below remain deployment acceptance tasks, not current defect counts. Consult `WAEC-STAGING-SECURITY-VERIFICATION.md`. Mailbox rotation and controlled Linux/disposable-DB acceptance remain gates; no deployment is authorized by passing local tests.

9 November 2026. Current external-deployment gate: **BLOCKED**.

This is an acceptance plan, not a record of deployed tests passing. See the preparation guide for executed local checks and blockers STG-01 through STG-10. No production readiness is claimed.

## Release and authorization

- [ ] WAEC names staging owner, operator, Finance Manager holder and authorized approvers.
- [ ] Confirm the existing Company 1 Finance Manager account belongs to the approved holder; do not create a default or duplicate.
- [ ] Resolve two High dependency findings; classify/patch three Moderate findings, rerun audit and relevant regressions.
- [ ] Disable production default Developer seeding and credential logging; inspect privileged accounts securely.
- [ ] Enforce reset-token secret, password/identity/reuse controls and company-scoped provisioning administration; test missing-company denial.
- [ ] Protect confidential upload delivery; exclude real employee attachments and payroll exports.
- [ ] Rotate the formerly populated example credential and inspect source history/artifacts for secrets.
- [ ] Add/test provisioning audit events without fabricating history; record activation/password-policy limitations.
- [ ] Freeze approved commit/release hash, clean Linux dependency install and inspected allowlist archive/checksum.

## Server and database

- [ ] Linux VPS and patched tested Node/MariaDB versions recorded; staging domain confirmed.
- [ ] Firewall, SSH recovery, non-root service, Nginx HTTPS/redirect and certificate renewal verified.
- [ ] Node and DB ports inaccessible from the internet; proxy forwarding headers replace client values; exact trust proxy count verified.
- [ ] Dedicated staging DB/user; no connection to live `personnel_master`; protected/anonymized source approved.
- [ ] Verified backup and scratch restore before migration; selective migration order and duplicate-generation preflights reviewed.
- [ ] Verify engines, session columns/indexes, helper tables and company/generation unique keys; no implicit runtime migration dependencies.
- [ ] Test CRUD-only application privileges; migrations run separately, no routine app root/DDL permissions.
- [ ] Root `.env` populated securely, mode 0600; strong separate session/reset secrets and HTTPS base URL.
- [ ] SMTP file-only behavior verified on target; explicit account-email/workflow-email decision.
- [ ] Persistent upload path, ownership, private media delivery, timezone, log rotation and backup paths verified.
- [ ] Service start/status/restart and reboot recovery verified; graceful drain/maintenance behavior recorded.

## Isolated staging test rules

Create a separate synthetic test company with uniquely marked staff/accounts/periods after authorization. Provision independent participants through approved workflows; never use real WAEC staff or batch 161 for mutations. Record fixture ownership, before-state, cleanup and test IDs. Tests that can modify financial rows or issue runtime DDL must target only the isolated staging DB, not the local/live database.

## Authentication and role acceptance

| Test | Expected | Result / evidence |
| --- | --- | --- |
| Admin login/logout | Correct dashboard, authorized administration only | Pending |
| Data Entry login/logout | Correct dashboard and permitted submissions | Pending |
| Finance Officer login/logout | Financial processing permissions as designed | Pending |
| Finance Manager login/logout | Read-only oversight dashboard, no approval action queue | Pending identity confirmation |
| Manager login/logout | Manager review/actions only | Pending |
| Auditor login/logout | Auditor review/actions only | Pending |
| Entity Head/HNO login/logout | Final-approval role, no Finance execution | Pending |
| Setup email | Real approved recipient receives link; correct HTTPS URL; safe failure/resend | Pending |
| Session fixation/logout | ID regenerated at login; old ID invalid; logout destroys session | Pending |
| Session expiry/restart | Expired ID rejected; persistent sessions survive intended restart | Pending |
| Parallel workers/outage | Same DB/secret; outage safe, restoration recovers without leaking data | Pending |
| Rate limit and CSRF | Valid forms work; invalid/missing CSRF 403; controlled failed login limit 429 | Pending |

Staff Self-Service: **DEFERRED / OUT OF SCOPE**.

## Employee and workflow acceptance

- [ ] Synthetic employee create/edit, grade/notch/job/department changes reviewed before approval.
- [ ] Entitlement eligibility, manual Transport/COLA and salary setup survive authorized approval/recalculation.
- [ ] All required approval pages show proposed values, actor, timestamps and correct company; audits roll back on forced failure in isolated fixtures.
- [ ] Manager/Auditor/HNO separation holds; Finance Manager has no processing/approval/post/reversal/reopen rights.
- [ ] Monthly payroll figures independently reconcile PAYE, employee/employer NASSIT, PROV-EMP once, deductions and net.
- [ ] Rent/Inducement/Leave annual workflows preserve existing formulas, including first-year Rent rule.
- [ ] Controlled isolated reversal/reopen fixtures preserve original history and effective-generation reports.
- [ ] Existing relevant payroll, report, session, CSRF and authorization suites run only against approved isolated fixtures; record actual command, timestamp, exit and cleanup.
- [ ] Direct forbidden mutations use a valid CSRF token so authorization is tested independently, not merely CSRF rejection.

## Company isolation

- [ ] Explicit Company A and Company B fixtures exist; no conditional skip accepted as proof.
- [ ] Payroll/yearly detail ID manipulation returns established denied/not-found response without disclosure.
- [ ] GL/reversal/reopen IDs and PFNo statement manipulation are denied across companies.
- [ ] Query/body CompanyID cannot override session company; missing company fails closed.
- [ ] Account creation/resend/list/delete obey approved company-scope policy.

## Reports and browser acceptance

- [ ] Payslip: authoritative payroll amounts, PROV-EMP deduction, net, correct period/company.
- [ ] Journal and GL: balanced totals, generation identity, Finance Manager read-only display.
- [ ] PAYE/EOS: local NRA logo and centered tax-department header; all pages print/PDF.
- [ ] NASSIT: separate company contribution header, correct employer/employee contributions.
- [ ] Staff PAYE, NASSIT and Gratuity statements: company/PFNo scope and effective generations.
- [ ] Bio Data and End of Service: private authorized data, intact page structure.
- [ ] Preview opens new tab; Previous/Next and Page X/Y work; print/PDF includes all pages, no viewer controls.
- [ ] Excel downloads open with numeric values and expected row counts; retain synthetic-only evidence.
- [ ] Desktop/tablet/mobile usability and CSP browser console checked on actual HTTPS staging.
- [ ] HTTP tests alone are not accepted as visual/PDF evidence.

## Operations and recovery

- [ ] Daily encrypted DB/uploads backup, retention and off-server replication configured and monitored.
- [ ] Restore to a scratch database demonstrated; recovery owner/RPO/RTO approved.
- [ ] Session cleanup timer implemented/tested; no expired sessions authenticate before cleanup.
- [ ] Logs exclude passwords, tokens, session payloads and payroll exports; retention bounded.
- [ ] Deployment rollback and schema compatibility rehearsed; no automatic restore over newer transactions.
- [ ] No remaining Critical/High application findings; client signs staging acceptance on deployed URL.

## Financial safety and final gate

- [ ] No change to local/live `tblstaff`, `tblentitle`, `tblsalary`, `tblpayroll`, `tblgltrans` from deployment preparation.
- [ ] August 2026 batch 161 and its legacy GL summary remain untouched: no approve/cancel/reopen/reprocess/reverse/post.
- [ ] No historical audit event fabricated; named approvers act through authenticated workflows only.

FINANCE MANAGER PROVISIONING: AWAITING AUTHORIZATION

STAGING DEPLOYMENT PACKAGE: BLOCKED

OVERALL: BLOCKED

After the identified blockers are corrected and verified, authorize deployment to restricted staging; only completion of this checklist can establish staging acceptance. Production requires a separate go-live decision.
