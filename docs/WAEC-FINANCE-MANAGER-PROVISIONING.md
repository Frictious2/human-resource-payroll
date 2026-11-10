# WAEC Finance Manager Provisioning

## Security Remediation Update

The earlier gaps below are preserved as historical findings. Scoped account management, state-bound one-time setup links, strong passwords, reset-secret validation, transactional account/password audits and disabled Developer bootstrap are now implemented. See `WAEC-FINAL-SECURITY-HARDENING.md` for the authoritative current behavior and executed tests. No real account was created or reset; holder authorization remains outstanding. Use only newly issued invitations after restart because legacy-format links are rejected.

Reviewed 9 November 2026. Database: `personnel_master`; company: 1.

FINANCE MANAGER PROVISIONING: AWAITING AUTHORIZATION

## Current verified state

A read-only aggregate query found **one Company 1 Finance Manager account**, with a non-empty password field. This supersedes the older inventory reporting zero accounts. Password presence does not prove successful login, account ownership or WAEC authorization. No identifying account data or password was exported. No user was created, reassigned, reset or approved during this review.

WAEC must identify the authorized holder and confirm whether this existing account belongs to that person. Do not create a duplicate or assign an existing Manager/Finance Officer extra powers. There is no reviewed role-reassignment workflow; do not update `tblpassword.Level` directly.

## Role and permission architecture

| Layer | Implementation |
| --- | --- |
| Account table | `tblpassword`; portal key `PFNo`, `CompanyID`, `Level`, `Username`, `FullName`, `Email`, `Pword`, `DateCreated` |
| Separate role/permission tables | No separate tables used by the reviewed login/route authorization path; permissions are code-defined |
| Stored role | `Finance Manager` |
| Normalized role | `finance-manager` in `services/authService.js` |
| Authentication/session | Existing login, bcrypt, session regeneration, company-scoped identity; no separate authentication system |
| Route mount | `server.js`: `requireRoles('finance-manager')` |
| Manager approvals | Separate `/manager` mount restricted to `manager`; Finance Manager is not an approval stage |

| Allowed oversight/report area | Route under `/finance-manager` |
| --- | --- |
| Dashboard | `/dashboard` |
| Payroll list/detail | `/payroll/workflow`, `/payroll/workflow/:batchId` |
| Annual payment list/detail | `/payroll/yearly-payments`, `/payroll/yearly-payments/:batchId` |
| Reversals and corrections | `/payroll/reversals`, `/payroll/reopen` and their detail routes |
| Journal, Payslip, GL, EOS | `/reports/journal`, `/reports/payslip`, `/reports/general-ledger`, `/reports/end-of-service` |
| Liabilities | `/reports/payroll-liabilities` plus preview/PDF/Excel/staff statement routes; PAYE/EOS/NASSIT only |

The benefit-status calculation POST is a read-only report calculation, not approval permission. Processing, submission, endorsement, review, approval, posting, reversals, reopen, staff edits, parameters and sensitive-record approvals remain forbidden. Report services and calculations are reused.

## Company isolation and verification limits

Authenticated sessions hold `user.companyId`, `companyId` and `CompanyID`. Oversight controllers pass that scope to workflow/reversal/reopen/GL services. Detail lookups use record ID plus company, not URL ID alone. Resend-link queries now use PFNo, role and the authenticated company.

The existing `testFinanceManagerOversight.js` checks ten read pages/eight forbidden POSTs, but its cross-company branches skip when no foreign-company fixture exists. Those branches are not unconditional proof. Its startup invokes application seed behavior, so it was not rerun against this database. Run it on an isolated staging database only, after startup hardening, and add explicit two-company fixtures for payroll, yearly payments, staff statements and GL.

`financeManagerController.getCompanyId()` still defaults a missing scope to company 1. Normal login supplies a company, but malformed/missing-scope sessions need fail-closed verification before external deployment. No authorization logic was changed in this preparation task.

## Authorized provisioning procedure

1. Obtain written holder/role authorization, official email, full name and approved username. Reconcile the existing account first using the authorized Admin UI.
2. Sign in as an authorized Company 1 Admin. Confirm the account company before any action.
3. For a genuinely new authorized holder, open `/admin/finance-managers/new`. Existing shared creation code obtains CompanyID from the Admin session and inserts `Pword = NULL`; never enter a default password or set approval flags by SQL.
4. Configure account email in the project-root `.env`: `ACCOUNT_EMAIL_ENABLED=true`, exact SMTP server/port/TLS/username/password, optional sender and HTTPS `APP_BASE_URL`. SMTP does not inherit Windows/shell settings. Restart after configuration changes.
5. The system emails a signed link valid for 30 minutes. Required mail failures now show warnings; use Resend Link once corrected, rather than deleting/recreating accounts. SMTP acceptance alone is not proof of inbox receipt.
6. The holder sets their own password at `/admin/admins/set-password`; bcrypt hashes it. Do not send passwords through chat or store them in handover documents.
7. Verify real login redirects to `/finance-manager/dashboard`, company isolation, report access, forbidden actions, logout and post-logout protected access.
8. Record holder confirmation and provisioning evidence in an approved external access register until the account-audit gap below is fixed. This is not a substitute for application audit logging and must not fabricate historical events.

## Activation, passwords and governance gaps

| Finding | Severity / release condition |
| --- | --- |
| Creation does not call the centralized audit helper | Medium; fix/test creation, resend and deletion audit before acceptance |
| Password setup token can be reused until expiry; no explicit activation or forced-first-change field | Medium; document and harden before real account onboarding |
| Setup handler has no password-strength validation and updates by PFNo alone | High for external provisioning; bind token to intended identity/current state and enforce password policy |
| `RESET_SECRET` falls back to a known development string; production validator does not require reset secret | High; local secret is configured (value not disclosed), but target startup must reject missing/unsafe reset secret |
| Admin role lists and deletion queries are not CompanyID-filtered | High company-isolation issue in provisioning administration; correct/test before external release |
| Startup may seed a default Developer account and log its credentials | High; disable automatic production seeding and secret logging before staging startup |

Do not claim that creating an account already meets every requested governance control. No production account changes are authorized by this document.

## Staging acceptance

Use the checklist in `WAEC-STAGING-DEPLOYMENT-CHECKLIST.md`. Account holder identity/sign-off is still awaited even though one account exists. Staff Self-Service remains deferred. Application security/dependency gates in the preparation guide must clear before externally accessible staging.
