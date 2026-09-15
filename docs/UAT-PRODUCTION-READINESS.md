# UAT Production Readiness

Audit baseline date: Friday, August 21, 2026

## Summary

This checklist captures the production-readiness audit status for the completed HR & Payroll system. It combines:

- automated verification that was executed during Phase 16,
- isolated sandbox workflow tests,
- schema and preflight diagnostics,
- rendered-browser visual UAT evidence for PRD-009B,
- final deployment/client signoff items that must be completed in the production environment.

Status values used in this document:

- `PASS`
- `FAIL`
- `PENDING MANUAL`

## Verified Automated Checks

| Test ID | Module | Role | Preconditions | Steps | Expected Result | Actual Result | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PH16-AUTO-001 | Schema | System | Database reachable | Run `scripts/runProductionReadinessChecks.js` schema section | Workflow/helper tables exist and use InnoDB | Verified for sessions, payroll workflow, record workflow, notifications, parameter changes, reversal, reopen, reversed-row archive | PASS | Verified on August 21, 2026 |
| PH16-AUTO-002 | Payroll Workflow | Finance/Manager/Auditor/HNO | Isolated sandbox available | Run `scripts/testPayrollWorkflowFoundation.js` | Core payroll transition rules succeed with rollback checks | 34 transitions verified, checksum verified, rollback verified | PASS | In-app notifications remained active |
| PH16-AUTO-003 | Reopen Lifecycle | Finance/Manager/Auditor/HNO | Isolated CompanyID 2 sandbox available | Run `scripts/testPhase15PayrollReopenWorkflow.js` | Generation 1 → reversal → reopen → Generation 2 completes | Full lifecycle passed with Generation 1 preserved as `REVERSED` and Generation 2 `POSTED_TO_ACCOUNTS` | PASS | Archived rows matched Generation 1 row count |
| PH16-AUTO-004 | Notification Delivery Mode | System | SMTP host unresolved in current environment | Run workflow foundation script after mailer hardening | In-app notifications work without SMTP error spam | Workflow still passed and SMTP error spam stopped | PASS | Email is now explicit opt-in |
| PH16-AUTO-005 | Session Persistence | All roles | Session migration applied | Run `scripts/testPersistentSessionStore.js` | Session store persists sessions, survives restart, and removes destroyed sessions | MySQL store verified, restart survived, logout removed stored session row, representative role-shaped session payloads round-tripped correctly | PASS | Production-path runner also reported `Session Store: MySQL` |
| PH16-AUTO-006 | Reversal Automation Coverage | Finance/Manager/Auditor/HNO | `ALLOW_DESTRUCTIVE_TESTS=true` or `NODE_ENV=test`; isolated DB fixture available | Run `scripts/testPhase14PayrollReversalWorkflow.js` twice | Script creates its own Generation 1 payroll, approves/posts/reverses it, verifies integrity and removes only its fixtures | Passed twice consecutively on August 27, 2026 using CompanyID 2, November 2098, activity `01`, and two synthetic staff. Each run balanced original and reversal entries at 12,900 and left zero net effect | PASS | Production-safe guard refuses unflagged self-seeding; latest evidence is stored in `docs/test-results/phase14-reversal-latest.json` |
| PH16-AUTO-007 | GL Posting Activity Scope | Finance | Database reachable with pay types and GL mappings | Run `scripts/testGlPostingActivityScope.js` | Salary stays postable; unsupported activities are blocked server-side and Finance UI exposes status clearly | Passed. Activity `01` remained supported, unsupported activities were blocked, salary workflow/regeneration regressions passed, and readiness runner reported only `01` as GL-supported | PASS | Verified on Friday, August 21, 2026 |
| PH16-AUTO-008 | Final visual UAT | Seven active roles | Running local application and PRD-009 synthetic fixture | Run `scripts/testPrd009bVisualUat.js` with installed Chrome | Rendered screens, responsive dashboards, report previews, print-style PDFs, and console checks pass | 67 rendered screens and 11 reports passed with screenshots/PDF evidence under `docs/test-results/prd009b/`; zero console errors captured | PASS | In-app browser bridge unavailable; installed Chrome automation used |

## Role UAT Matrix

| Test ID | Module | Role | Preconditions | Steps | Expected Result | Actual Result | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PH16-ROLE-001 | Authentication | Administrator | Valid admin account | Login, dashboard redirect, logout | Role lands on Admin dashboard and session closes on logout | Real form login, redirect, dashboard, profile, notifications and queue rendered successfully | PASS | PRD-009/009B |
| PH16-ROLE-002 | Authentication | Finance Officer | Valid finance account | Login, dashboard redirect, logout | Role lands on Finance dashboard and session closes on logout | Service and route structure reviewed; isolated workflow scripts used synthetic finance actor | PASS | Browser/sidebar verification still manual |
| PH16-ROLE-003 | Authentication | Manager | Valid manager account | Login, queue access, logout | Manager sees endorsement areas only | Verified through isolated workflow scripts and route middleware | PASS | Manual visual dashboard verification still pending |
| PH16-ROLE-004 | Authentication | Auditor | Valid auditor account | Login, queue access, logout | Auditor sees audit/review areas only | Verified through isolated workflow scripts and route middleware | PASS | Manual visual verification pending |
| PH16-ROLE-005 | Authentication | Entity Head/HNO | Valid entity-head account | Login, approval access, logout | HNO sees read-only workspace plus approval actions | Verified through isolated workflow scripts and route middleware | PASS | Manual dashboard verification pending |
| PH16-ROLE-006 | Authentication | Data Entry Officer | Valid data-entry account | Login, workflow pages | Data Entry cannot access Finance/Manager/HNO actions | Real form login, dashboard, staff form, reports, work queue and sensitive workflow page rendered successfully | PASS | PRD-009/009B |
| PH16-ROLE-007 | Authentication | Staff | Valid staff account | Login, own pages only | Staff cannot access admin/payroll routes | Staff Self-Service is not implemented and is excluded from this release | DEFERRED | Explicit PRD-009A scope decision; not an active role |

## Payroll and Accounting UAT

| Test ID | Module | Role | Preconditions | Steps | Expected Result | Actual Result | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PH16-PAY-001 | Normal Payroll | Finance → Manager → Auditor → HNO | Sandbox CompanyID 2 | Process payroll, approve, post | Payroll reaches `POSTED_TO_ACCOUNTS` with action history and GL batch | Verified in isolated Generation 1 cycle | PASS | Activity `01` only |
| PH16-PAY-002 | Reversal | Finance → Manager → Auditor → HNO | Sandbox posted payroll | Request, endorse, approve, execute reversal | GL opposite lines created, original posting preserved, workflow becomes `REVERSED` | Verified in isolated Generation 1 cycle | PASS | Balanced reversal totals |
| PH16-PAY-003 | Reopen / Generation 2 | Finance → Manager → Auditor → HNO | Sandbox reversed payroll | Request reopen, approve, create Generation 2, reprocess, reapprove, repost | Generation 1 preserved, Generation 2 becomes active | Verified end-to-end in isolated script | PASS | `tblgltrans` remains legacy month-level summary |
| PH16-PAY-004 | Duplicate Processing | Finance | Existing processed generation | Attempt duplicate processing outside correction/reopen path | Duplicate prevention blocks second run | Verified by workflow foundation logic and generation-aware keys | PASS | Manual UI double-click test still pending |
| PH16-PAY-005 | Post to Accounts for non-01 activities | Finance | Non-salary activity selected | Attempt posting | System should either support the activity or clearly block it | Verified: unsupported activities are blocked server-side with “Post to Accounts is not yet configured for this payroll activity.” Finance UI also shows support state | PASS | Current supported scope is intentionally limited to `01 = Salary` |

## Notifications and Work Queue

| Test ID | Module | Role | Preconditions | Steps | Expected Result | Actual Result | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PH16-NOTIF-001 | In-app notifications | Finance/Manager/Auditor/HNO | Workflow action executed | Review notification rows and unread counts | Notifications created with role-appropriate links | Verified in Phase 15 sandbox output | PASS | ActionURLs present for payroll, reversal, reopen |
| PH16-NOTIF-002 | Email notifications | System | SMTP should be explicitly enabled | Trigger workflow actions | No email attempt unless enabled | Email now disabled by default unless `EMAIL_NOTIFICATIONS_ENABLED=true` | PASS | Prevents ENOTFOUND noise |
| PH16-QUEUE-001 | Unified work queue | Finance/Manager/Auditor/HNO | Sandbox workflow completed | Inspect queue summaries | Actionable queues empty after completion | Verified in Phase 15 sandbox output | PASS | Default queue did not show completed work items |

## Reports and Enquiries

| Test ID | Module | Role | Preconditions | Steps | Expected Result | Actual Result | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PH16-REP-001 | Payroll workflow history | Finance/Finance Manager | Existing workflow batches | Open workflow history/report pages | No 500 errors and generation history visible | Finance workflow and Finance Manager payroll oversight rendered successfully | PASS | PRD-009B |
| PH16-REP-002 | GL posting history | Finance/Finance Manager | Existing posting batches | Open posting/GL history | Posted rows and generation linkage display correctly | Finance Post-to-Accounts and Finance Manager General Ledger screens rendered successfully | PASS | PRD-009B |
| PH16-REP-003 | HR enquiries and reports | Admin/Data Entry/Manager/Finance | Test records exist | Open active report pages with filters | Correct CompanyID scope and no dead navigation | Representative Bio Data, NASSIT/Gratuity, Payroll Liabilities, Journal, Payslip, GL and EOS routes rendered successfully | PASS | PRD-009B |

## Security and Isolation

| Test ID | Module | Role | Preconditions | Steps | Expected Result | Actual Result | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PH16-SEC-001 | Company isolation preflight | System | Database reachable | Run diagnostic queries and cross-role security probes | No orphan notifications or reopen/reversal links across companies | Verified by SQL preflight, workflow suites, report suites, and cross-role route denial checks | PASS | Staff Self-Service deferred |
| PH16-SEC-002 | Unauthorized route blocking | All roles | Authenticated user in wrong role | Hit protected routes directly | 403 or redirect; no privileged action access | Middleware review completed, shared access-denied view fixed for `data-entry` role label | PASS | Needs browser tamper walkthrough |
| PH16-SEC-003 | Session handling | All roles | Production config review | Review session config and login/logout flow | Session secret, cookie flags, regeneration on login, destroy on logout | Regeneration, secure cookie handling, MySQL persistence, and restart survival verified | PASS | Production startup now requires `SESSION_SECRET` |

## Final Deployment Signoff Still Required Before Handover

The following are operational/client signoff activities, not open Critical or High application defects:

- Configure real production `SESSION_SECRET`, DB credentials, HTTPS URL, proxy hop count, and SMTP decision
- Complete production-environment smoke login for each nominated user
- Confirm Staff Self-Service remains deferred/out of scope for this release
- Capture final client signoff against the deployed URL

## Overall UAT Position

- Automated payroll workflow coverage: strong
- Generation, reversal, and reopen: strong in isolated sandbox
- In-app notifications and queue behavior: strong
- Full cross-role browser UAT: passed for active roles
- Production configuration readiness: code-ready with deployment prerequisites for real secrets, HTTPS/proxy, backups, and SMTP decision

## GL Posting Support Matrix

| Code | Activity | Payroll Evidence | GL Posting State | Notes |
| --- | --- | --- | --- | --- |
| 01 | Salary | `tblPayroll`, `payroll_gl_posting_batches`, `gl_account_mappings`, `tblgltrans` | SUPPORTED | Verified and regression-tested |
| 02 | Rent | `tblyearlypayments` | BLOCKED_PENDING_MAPPING | Legacy special-payment branch exists but no approved GL mapping was verified |
| 04 | Welfare | legacy special-payment evidence | BLOCKED_PENDING_MAPPING | Do not route through salary GL logic |
| 05 | Inducement | `tblyearlypayments` | BLOCKED_PENDING_MAPPING | Legacy branch exists; no approved current GL mapping |
| 07 | Backlog / Arrears | legacy processing text evidence | NEEDS_CONFIRMATION | Requires accounting confirmation |
| 08 | EOS Benefit | EOS legacy processing text evidence | NEEDS_CONFIRMATION | Requires accounting confirmation |
| 09 | Bonus | bonus legacy processing text evidence | NEEDS_CONFIRMATION | Requires accounting confirmation |
| 13 | Leave Allowance | `tblyearlypayments`, `tblleaveallowance` | NOT_APPLICABLE | Current system feeds leave allowance into salary-side support tables |
| 15 | Long Service | legacy processing text evidence | NEEDS_CONFIRMATION | Requires accounting confirmation |

## PRD-009 Authenticated Cross-Role Pass - August 27, 2026

| Test ID | Module | Role | Preconditions | Steps | Expected Result | Actual Result | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRD009-AUTH-001 | Login/redirect | Seven active roles | Isolated Company 2 users | Submit real login form for each role | Correct role dashboard and persistent session | All seven roles redirected correctly | PASS | Invalid password also returned 401 |
| PRD009-ROUTE-001 | Protected pages | All active roles | Authenticated sessions | Open dashboards, queues, workflow and report pages | 200 without render errors | 71 pages passed | PASS | Evidence JSON retained |
| PRD009-SEC-001 | Direct mutation denial | Cross-role actors | Authenticated wrong-role session | POST representative payroll/reversal/approval actions | 403/established denial | Six representative mutations returned 403 | PASS | Finance Manager remained observer-only |
| PRD009-REP-001 | Payroll Liabilities | Finance/Finance Manager | Isolated 11/2098 payroll | Open PAYE preview/PDF/Excel | Valid output and statutory markup | Preview/PDF/Excel HTTP checks passed | PASS | Visual PDF acceptance remains manual |
| PRD009-ASSET-001 | Report assets | Reporting roles | Running application | Request NRA logo and report viewer JS | 200 and non-empty | Both assets passed | PASS | Browser visual rendering remains manual |
| PRD009-UI-001 | Reopen queues | Manager/Auditor/HNO | Authenticated sessions | Open role reopen queues | No EJS include failure | Missing role head partials fixed; routes now 200 | PASS | Six affected EJS views compile |
| PRD009-YEARLY-001 | Yearly preview | Finance | Legacy/company-overlap staff present | Preview Rent, Inducement, Leave | One snapshot row per PFNo | All three pass after de-duplication fix | PASS | Test-owned drafts are removed in `finally` |
| PRD009-BROWSER-001 | Visual browser/print | All active roles | Running local application and installed Chrome | Inspect responsive UI, console, print/PDF pages | Signed browser evidence | 67 rendered screens and 11 reports passed; screenshots/PDF evidence retained | PASS | `docs/PRD-009B-VISUAL-UAT.md` |
| PRD009-SEC-002 | CSRF/security middleware | All | DB-backed HTTP tests | Missing/invalid/valid CSRF, headers and throttling | CSRF, headers, login throttling configured | Seven-role CSRF checks and rate-limit test passed; valid CSRF did not bypass authorization | PASS | PRD-009A |
| PRD009-STAFF-001 | Staff self-service | Staff | Active Staff role | Login and verify own-record access | Staff portal works and isolates records | No active Staff role discovered; explicitly excluded from this release | DEFERRED | Future approved phase required |

## PRD-009A Security Hardening - August 27, 2026

| Test ID | Module | Role | Preconditions | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRD009A-CSRF-001 | CSRF | Seven active roles | Isolated Company 2 users | POST representative mutation without/invalid token | HTTP 403, no mutation | All roles blocked | PASS | Sanitized security events logged |
| PRD009A-CSRF-002 | CSRF + authorization | Finance Manager | Valid session/token | POST Finance payroll action | Role denial remains effective | HTTP 403 | PASS | CSRF does not replace authorization |
| PRD009A-RATE-001 | Authentication | Anonymous | Test limit 3/60 seconds | Submit four failed logins | Fourth returns 429 | HTTP 429; GET/static pages available | PASS | Production default 20/15 minutes |
| PRD009A-ENV-001 | Startup | System | Production mode, missing secret | Start server | Refuse startup | Startup failed safely | PASS | No secret value logged |
| PRD009A-WF-001 | Parameter workflow | Admin/HNO | HTTP server with CSRF | Create, return, correct, approve Department proposal | Existing workflow remains operational | Complete workflow passed | PASS | Isolated proposal data |
| PRD009A-WF-002 | Sensitive records | Data Entry/Manager/HNO | HTTP server with CSRF | Run Phase 11 workflows | Existing workflows remain operational | All tested modules passed | PASS | No CSRF bypass used |
| PRD009A-UAT-001 | Cross-role pages | Seven active roles | Isolated Company 2 lifecycle | Login and open protected pages | Prior 71 pages remain green | 71/71 passed | PASS | PRD-009B visual checks remain |

Detailed route, workflow, report, defect, deployment, and rollback evidence is in `docs/PRD-009-CROSS-ROLE-UAT.md`.
