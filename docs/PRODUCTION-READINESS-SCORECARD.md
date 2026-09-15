# Production Readiness Scorecard

Audit baseline date: Thursday, August 27, 2026

| Area | Status | Blocking? | Notes |
| --- | --- | --- | --- |
| Authentication | READY | No | Seven active roles passed real form login, redirect, persistent-cookie, invalid-password, and logout-destruction checks |
| Session Management | READY | No | MySQL-backed session store verified, including restart persistence and logout destruction |
| Company Isolation | READY | No | Workflow/report service tests, cross-role HTTP denial checks, Finance Manager isolation, and report scope checks pass |
| Admin User Management | READY | No | Route/account creation paths exist and representative Admin dashboard/parameter pages passed rendered-browser UAT |
| Parameter Workflow | READY | No | Department and representative parameter approval pages passed service, HTTP, CSRF, and rendered-browser checks |
| Sensitive Record Workflow | READY | No | Phase 11/12 suites pass and representative queues/forms passed rendered-browser UAT |
| Payroll Workflow | READY | No | Foundation script passed with transitions, checksum, rollback validation |
| Post to Accounts | READY | No | Salary (`01`) is fully supported; all other activities are explicitly blocked until accounting mappings are verified |
| Reversal Workflow | READY | No | Self-contained Phase 14 automation passed twice with real processing/posting, full approvals, integrity guards, balanced opposite entries, rollback verification, and scoped cleanup |
| Reopen / Generation Workflow | READY | No | Full isolated Generation 1 → REVERSED → Generation 2 cycle passed |
| Notifications (In-App) | READY | No | Queue and notification rows verified in sandbox lifecycle |
| Notifications (Email) | READY WITH MINOR FIXES | No | Explicitly disabled by default pending valid SMTP |
| Reports / Enquiries | READY | No | Automated render/export suites, authenticated HTTP routes, PRD-009B report previews, screenshots, and print-style PDF evidence pass |
| Dashboards / Navigation | READY | No | Seven dashboards, 71 protected HTTP pages, 67 rendered screens, desktop/tablet/mobile dashboard checks, and active placeholder cleanup pass |
| Audit Logging | READY WITH MINOR FIXES | No | Legacy `Loggedout` compatibility verified; handwritten audit inserts should still be reviewed in UAT |
| Database Migrations | READY | No | Required helper tables and generation indexes verified |
| Production Configuration | READY WITH CONDITIONS | No | Code-level validation passes; deployment must provide real secrets, DB credentials, HTTPS URL, proxy settings, backups, and SMTP decision |
| Security Hardening | READY | No | CSRF, Helmet/CSP/HSTS, login throttling, safe errors, dependency audit, sanitized logging, and production secret startup failure pass |
| Training Readiness | READY | No | Change list and final active role scope are documented; Staff Self-Service is deferred |

## Final Recommendation

**PRODUCTION READY WITH CONDITIONS**

Reason:

- Authenticated HTTP UAT passes seven active roles and 71 protected pages.
- PRD-009B rendered-browser UAT passes 67 screens and 11 reports with screenshots, desktop/tablet/mobile dashboard checks, print-style PDF evidence, and zero captured console errors.
- No Critical or High application defects remain open.
- Production must still supply real environment secrets, HTTPS/proxy settings, backups, and the SMTP decision before public go-live.
- Staff Self-Service is explicitly deferred and excluded from the active production role list.

## Post to Accounts Activity Scope

| Code | Activity | Current State | Production Conclusion |
| --- | --- | --- | --- |
| 01 | Salary | Supported, mapped, posted historically, generation-aware | FULLY SUPPORTED FOR POST TO ACCOUNTS |
| 02 | Rent | Yearly-payment usage found; no approved GL strategy verified | PAYROLL SUPPORTED BUT GL POSTING BLOCKED |
| 04 | Welfare | Legacy/special-payment evidence found; no safe current GL implementation | PAYROLL SUPPORTED BUT GL POSTING BLOCKED |
| 05 | Inducement | Yearly-payment usage found; no approved GL strategy verified | PAYROLL SUPPORTED BUT GL POSTING BLOCKED |
| 06 | Gratuity | Legacy pay type only; no current posting path verified | NEEDS CLIENT/ACCOUNTING CONFIRMATION |
| 07 | Backlog / Arrears | Legacy processing evidence found; no verified GL strategy | NEEDS CLIENT/ACCOUNTING CONFIRMATION |
| 08 | EOS Benefit | Legacy processing evidence found; no verified GL strategy | NEEDS CLIENT/ACCOUNTING CONFIRMATION |
| 09 | Bonus | Legacy processing evidence found; no verified GL strategy | NEEDS CLIENT/ACCOUNTING CONFIRMATION |
| 13 | Leave Allowance | Routed through salary-side support tables rather than standalone GL posting | NOT A PAYROLL POSTING ACTIVITY |
| 14 | Acting | Salary component only (`Allw14`) | NOT A PAYROLL POSTING ACTIVITY |
| 15 | Long Service | Legacy processing evidence found; no verified GL strategy | NEEDS CLIENT/ACCOUNTING CONFIRMATION |
| 33 | Provident | Legacy-only pay type | NEEDS CLIENT/ACCOUNTING CONFIRMATION |
| 40 | Guarantee | Legacy-only pay type | NEEDS CLIENT/ACCOUNTING CONFIRMATION |
| 41 | Ex-Gratia | Legacy-only/special benefit | NEEDS CLIENT/ACCOUNTING CONFIRMATION |
| 42 | Death Benefit | Legacy-only/special benefit | NEEDS CLIENT/ACCOUNTING CONFIRMATION |
| 99 | All | Selector-only aggregate code | NOT A PAYROLL POSTING ACTIVITY |
| 00 | Allowances | Unclassified legacy grouping code | NEEDS CLIENT/ACCOUNTING CONFIRMATION |
