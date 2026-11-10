# WAEC Standalone Installation Architecture

Reviewed: 2026-11-09 UTC. Release: package 1.0.0. No deployment, live data changes or schema migration performed.

## Deployment boundary

One customer receives one application directory, database, restricted database user, private upload root, session table, configuration, HTTPS origin and portal accounts. This is not a shared SaaS installation. Do not share databases, session secrets, reset secrets, writable directories or cPanel application registrations between customers. CompanyID columns and other-company legacy rows remain intact.

The WAEC deployment uses `INSTALLATION_COMPANY_ID=1`. Production startup requires an explicit positive integer; invalid values fail validation. Development defaults to 1 for existing local compatibility. No browser selector can change this setting. Only CompanyID 1 has been certified for this WAEC release; do not repurpose the setting as a company switch or assume every legacy module supports a different installation ID without separate testing.

## Enforcement

| Layer | Control |
| --- | --- |
| Login | `authService` selects `tblpassword` by installation CompanyID; legacy password upgrade is scoped to that same company. Other-company portal accounts are not authenticated. |
| Privileged developer portal | Developer identities are not accepted through standalone portal login. No account is deleted or reset; customer Admin remains the existing authorized provisioning role. |
| Existing sessions | `middleware/installationCompany.js` rejects authenticated identities with a missing ID or non-installation company before protected routes, notifications or private-file handling. Old foreign-company sessions cannot bypass the new login restriction. |
| Request company fields | Query/body `CompanyID`, `companyId` and `company_id`, including nested values, must equal the configured company; arrays/objects or mismatches are rejected. They never establish company authority. |
| Staff identifiers | Exact PF identifiers and covered staff API paths are validated without numeric coercion. Foreign, unowned or ambiguous existing PF ownership is rejected before legacy PF-only handlers run. |
| Staff save | The handler independently verifies the installation identity, Data Entry role, request company and PF identifier. Staff, qualification, latest salary and master-payroll writes use CompanyID predicates. |
| Approvals and payroll | Priority Manager staff/entitlement/salary, payroll setup, processing, workflow, posting and yearly-payment query paths no longer admit NULL CompanyID as company-owned data. Existing role and workflow-stage guards remain. |
| Reporting/selectors | Common staff selectors, staff search, birthday/general-info enquiry, salary fallback, bonus and redundancy selection have explicit installation scope. The salary fallback groups and joins by both company and PF. Modern financial report services retain their explicit company predicates. |
| Private files and branding | User identity and installation company are checked; logos/branding are selected for the installation company only. File ownership still requires exact stored URL plus company and allowed role. |
| Accounts | Existing account service requires an installation-authorized Admin actor and matching company; public setup tokens for other companies are rejected. Roles are not taken from free-form client fields. |

CompanyID NULL is not evidence of ownership. Such rows require administrative review; no row was reassigned or migrated. Global PF identifiers that collide across companies are denied conservatively by the request boundary rather than guessed. This is intentionally not multi-company administration.

## Staff-save defect STG-ISO-001

Affected route: `POST /data-entry/staff/new-edit`; controller: `postStaffNewEdit` in `controllers/dataEntryController.js`.

Previously, the controller queried/updated by PF only and created related rows with CompanyID 1 regardless of actor. A synthetic Company 2 Data Entry user could change a Company 1 employee. The handler now locks/checks ownership, scopes every related operation, and writes masked field-level audit entries on the **same database connection and transaction**. An audit failure rolls back the staff, salary, qualification and master-payroll operations. Errors do not expose SQL or database paths.

Successful staff edits still set `Approved=0` and require the existing authenticated Manager approval. No Manager decision is fabricated, no approval chain is changed, and no current financial value is changed by deploying this source correction. Compensation uses the existing calculation formula with a company-scoped grade/scale lookup.

The disposable regression includes normal own-company update, foreign-company update and stale session, forbidden company input, invalid PF, wrong role, unauthenticated request, audit attribution, approval reset, parallel login-CSRF requests, scoped list output and forced audit persistence failure with no partial writes. See the machine-readable execution evidence and private synthetic test logs.

## Additional findings corrected

Source review found PF/company-crossing latest-salary aggregation, unscoped bonus IDs, unscoped guarantee review/update, and unscoped staff enquiries. Those lookup/write predicates were tightened without changing calculation formulas. Unknown bonus update IDs now return not-found instead of falling through into creation. Bonus error responses no longer return SQL error text.

The same review also found dependant child records were keyed by PF/DepNo without checking their own company. Data Entry listing/editing/creation/age processing, Manager dependant queue/actions and Manager staff-review child data now use company predicates. An isolated fixture deliberately places a Company 2 child under a Company 1 PF: editing/approval are denied with no writes, while the Company 1 child remains editable and foreign children do not appear in staff review. Multipart company input is checked after parsing even when no file is attached.

The login-session CSRF token is now generated **after session regeneration and before its explicit save/redirect**, preventing redirected requests from independently initializing competing tokens. The pre-login token is not reused. Missing/invalid token rejection and role checks remain active.

## Safety and review limits

Live `tblstaff`, `tblentitle`, `tblsalary`, `tblpayroll`, `tblgltrans`, account, audit and workflow records are fingerprinted before/after disposable runs. Test users, approvals, posting/reversal/correction actions exist only in generated synthetic databases. Batch 161 and its legacy GL summary are not operated on. Existing accounts/passwords are not changed.

This is a focused hardening pass, not proof that every legacy controller is free of defects. Read the readiness checklist for acceptance gaps and the tested scope. Do not infer production readiness from a passing dependency audit or from the installation login boundary alone. New or modified legacy handlers must use company predicates on both parent and child rows; the global PF guard is defense in depth, not a replacement for row ownership checks.

## Execution evidence

`docs/test-results/waec-standalone-cpanel-readiness-latest.json` records the final executed checks. `docs/test-results/disposable-staging-acceptance-latest.json` and its immutable per-run copies preserve full suite outcomes, live-table preservation and disposable cleanup. Prior failed evidence is retained, not rewritten as passing history.
