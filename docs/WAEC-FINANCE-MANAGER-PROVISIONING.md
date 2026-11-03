# WAEC Finance Manager Provisioning

Date: 2026-10-09

Project: WAEC HR & Payroll Management System

Database: `personnel_master`

Company scope: `CompanyID = 1`

## Status

`FINANCE MANAGER PROVISIONING: AWAITING AUTHORIZATION`

No Finance Manager account was created or modified during this review.

## Role Architecture Confirmed

The application stores active portal users in `tblpassword`.

Relevant fields:

| Field | Purpose |
| --- | --- |
| `PFNo` | Portal account primary key |
| `Username` | Login username |
| `FullName` | Display name |
| `Email` | Login email and setup-link destination |
| `Pword` | Password hash, null before setup |
| `Level` | Legacy role value |
| `CompanyID` | Company scope |
| `DateCreated` | Account creation timestamp |

Finance Manager is represented as:

| Layer | Value |
| --- | --- |
| Database role | `Finance Manager` |
| Normalized application role | `finance-manager` |
| Dashboard | `/finance-manager/dashboard` |
| Route middleware | `requireRoles('finance-manager')` |

The role is recognized in `services/authService.js` by `normalizeRole()`.

## Current Account Inventory

Read-only query result on 2026-10-09:

| Role | CompanyID | Count |
| --- | ---: | ---: |
| Admin | 1 | 2 |
| Auditor | 1 | 1 |
| Data Entry | 1 | 3 |
| Developer | 1 | 1 |
| Entity Head | 1 | 4 |
| Finance Officer | 1 | 1 |
| Manager | 1 | 3 |
| User | 1 | 1 |
| Admin | 2 | 1 |
| Finance Manager | 1 | 0 |

Finding: No `Finance Manager` account currently exists for `CompanyID = 1`.

## Permissions Confirmed

Finance Manager is an oversight role only.

Allowed read-only areas:

| Area | Route |
| --- | --- |
| Dashboard | `/finance-manager/dashboard` |
| Payroll workflow oversight | `/finance-manager/payroll/workflow` |
| Payroll workflow detail | `/finance-manager/payroll/workflow/:batchId` |
| Yearly payment oversight | `/finance-manager/payroll/yearly-payments` |
| Reversal oversight | `/finance-manager/payroll/reversals` |
| Reopen/correction oversight | `/finance-manager/payroll/reopen` |
| Journal report | `/finance-manager/reports/journal` |
| Payslip report | `/finance-manager/reports/payslip` |
| General Ledger history | `/finance-manager/reports/general-ledger` |
| End of Service report | `/finance-manager/reports/end-of-service` |
| Payroll Liabilities reports | `/finance-manager/reports/payroll-liabilities` |

Forbidden operational actions:

| Action family | Status |
| --- | --- |
| Process payroll | Not permitted |
| Submit payroll | Not permitted |
| Manager endorsement | Not permitted |
| Auditor review | Not permitted |
| Entity Head/HNO approval | Not permitted |
| Post to Accounts | Not permitted |
| Request or execute reversal | Not permitted |
| Request or approve reopen | Not permitted |
| Create/edit employee records | Not permitted |
| Change payroll parameters | Not permitted |
| Approve sensitive records | Not permitted |

Finance Manager report access reuses existing report services and does not create a second calculation engine.

## CompanyID Scoping

The authenticated session stores:

- `req.session.user.companyId`
- `req.session.companyId`
- `req.session.CompanyID`

Finance Manager services use the authenticated user's company context. Cross-company access remains forbidden by route authorization and service-level `CompanyID` filters verified by the Finance Manager oversight regression suite.

## Provisioning Procedure

Provisioning must be performed by an authorized Admin user through the application UI.

1. Confirm WAEC has named the Finance Manager account holder.
2. Confirm the account holder's full name, official email address and username.
3. Sign in as an authorized Admin for `CompanyID = 1`.
4. Open `Admin -> Finance Managers -> Add Finance Manager`.
5. Enter username, email and full name.
6. Submit the form.
7. The system inserts a `tblpassword` row with:
   - `Level = 'Finance Manager'`
   - `CompanyID` from the Admin session
   - `Pword = NULL`
   - `DateCreated = NOW()`
8. The system sends a 30-minute set-password link to the account email when SMTP is enabled.
9. If SMTP is disabled or delivery fails, the Admin may use the existing resend-link action after SMTP is configured.
10. The account holder sets a password through `/admin/admins/set-password?token=...`.
11. Verify sign-in redirects to `/finance-manager/dashboard`.
12. Verify Finance Manager can view oversight/report pages but cannot invoke mutation routes.

## Secure Password Handling

The provisioning workflow does not store plaintext passwords.

Password behavior:

- New account is created with `Pword = NULL`.
- Password is set only through a signed, expiring token.
- Password is stored using bcrypt.
- Legacy plaintext-compatible login upgrade remains available for older accounts, but new accounts should use bcrypt immediately.

## Audit and Notification Notes

Provisioning currently relies on Admin account creation flow and security logging around authentication. If WAEC requires a formal account-creation audit row for every new portal user, add that as a separate controlled enhancement before production go-live.

## Required Authorization Before Provisioning

Provisioning is awaiting:

- Named Finance Manager account holder.
- Official WAEC email address.
- Confirmation that the Admin performing provisioning is authorized for `CompanyID = 1`.
- SMTP decision for password-link delivery.

## Final Recommendation

Do not create a default Finance Manager account. Create the real account only after WAEC confirms the named holder and the Admin performs provisioning through the existing UI.

