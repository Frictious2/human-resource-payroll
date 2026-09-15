# PRD-009 Cross-Role UAT and Production Readiness

Verification date: Saturday, August 29, 2026

## Executive Result

Authenticated HTTP UAT passed for all seven roles currently implemented by the application. The run exercised real login/session handling, 71 protected pages, representative cross-role mutation attempts, static report assets, Payroll Liability preview/PDF/Excel routes, invalid-password handling, and logout session destruction.

PRD-009A security hardening passed. PRD-009B rendered-browser visual UAT also passed using installed Chrome automation after the in-app browser bridge was unavailable. The visual pass inspected 67 rendered screens, all seven active-role dashboards at desktop/tablet/mobile widths, 11 reports, screenshots, print-style PDF evidence, and browser console output.

**FINAL VERDICT: PRODUCTION READY WITH CONDITIONS**

## Isolated Environment

| Item | Value |
| --- | --- |
| Test company | CompanyID 2 |
| Payroll period | November 2098 |
| Activity | `01` Salary |
| Staff | PFNo 9301 and 9302, synthetic records |
| Roles | Admin, Data Entry, Finance Officer, Finance Manager, Manager, Auditor, Entity Head |
| Lifecycle | Generation 1 posted/reversed; Generation 2 reopened/reprocessed/posted |
| Cleanup | Exact CompanyID 2, period, PFNo, user-prefix, workflow, GL, notification, and helper-table cleanup |

No active Staff self-service role is recognized by the current authentication normalization or dashboard router. Staff UAT is recorded as not implemented rather than falsely passed.

## Role Matrix

| Test ID | Role | Coverage | Actual Result | Status | Defect |
| --- | --- | --- | --- | --- | --- |
| UAT-AUTH-01 | All active roles | Real form login, role redirect, persistent cookie | Correct redirect and `hrpayroll.sid` received for all seven roles | PASS | - |
| UAT-ADM-01 | Administrator | Dashboard, Finance Manager users, Department/Pay Type proposals, parameter queue, profile, notifications, queue | 8 protected pages returned 200 | PASS | - |
| UAT-DE-01 | Data Entry | Dashboard, staff edit/dependants, Bio Data, NASSIT/Gratuity, profile, notifications, queue | 8 protected pages returned 200 | PASS | - |
| UAT-FIN-01 | Finance Officer | Dashboard, payroll, reversal, reopen, yearly payments, posting, Journal, Payslip, EOS, liabilities, profile, notifications, queue | 13 protected pages returned 200 | PASS | - |
| UAT-FM-01 | Finance Manager | Dashboard, payroll/yearly/reversal/reopen oversight, Journal, Payslip, GL, EOS, liabilities, profile, notifications | 12 read-only pages returned 200 | PASS | - |
| UAT-MGR-01 | Manager | Dashboard, record/payroll/reversal/reopen/yearly queues, Bio Data, NASSIT/Gratuity, profile, notifications, queue | 11 protected pages returned 200 | PASS after fix | PRD-012 |
| UAT-AUD-01 | Auditor | Dashboard, payroll/reversal/reopen/yearly queues, audit trail, profile, notifications, queue | 9 protected pages returned 200 | PASS after fix | PRD-012 |
| UAT-HNO-01 | Entity Head | Dashboard, parameter/record/payroll/reversal/reopen/yearly queues, profile, notifications, queue | 10 protected pages returned 200 | PASS after fix | PRD-012 |
| UAT-STF-01 | Staff | Login, dashboard, self-service | No active role implementation discovered | NOT IMPLEMENTED | PRD-016 |

Machine-readable route evidence is stored in `docs/test-results/prd009-http-uat-latest.json`.
Rendered-browser evidence is stored in `docs/test-results/prd009b/prd009b-visual-uat-latest.json`, with screenshots and PDFs under `docs/test-results/prd009b/`.

## Security and Session Matrix

| Test ID | Scenario | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| SEC-001 | Invalid password | Reject without session | HTTP 401 | PASS |
| SEC-002 | Manager opens Finance dashboard | Deny | HTTP 403 | PASS |
| SEC-003 | Finance Manager submits payroll | Deny | HTTP 403 | PASS |
| SEC-004 | Data Entry executes reversal | Deny | HTTP 403 | PASS |
| SEC-005 | Finance calls Manager endorsement | Deny | HTTP 403 | PASS |
| SEC-006 | Manager calls Auditor endorsement | Deny | HTTP 403 | PASS |
| SEC-007 | Auditor calls HNO approval | Deny | HTTP 403 | PASS |
| SEC-008 | Entity Head executes reversal | Deny | HTTP 403 | PASS |
| SEC-009 | Crafted WHT/Leave Tax liabilities | Reject unsupported type | HTTP 400 | PASS |
| SEC-010 | Logout then reuse old cookie | Redirect to login | HTTP 302 to `/login` | PASS |
| SEC-011 | CSRF protection | State-changing forms protected | Session-bound tokens pass across seven roles; missing/invalid tokens return 403 | PASS (PRD-009A) |
| SEC-012 | Security headers/rate limiting | Production middleware configured | Helmet/CSP/HSTS and login-only rate limiting pass | PASS |

Company isolation passed in Phase 14, Phase 15, Finance Manager, parameter, report service suites, and cross-role HTTP denial checks.

## Workflow Results

| Module | Verification | Result |
| --- | --- | --- |
| Payroll foundation | 34 transitions, checksum, duplicate and rollback guards | PASS |
| Sensitive records | Phase 11 and Phase 12 DB-backed suites | PASS |
| Parameter changes | Phase 13, Pay Type 13A, Department HTTP/service workflow | PASS |
| Reversal | Self-contained Company 2 lifecycle; original and reversal debit/credit each 12,900; net zero | PASS |
| Reopen/generation | Generation 1 remains REVERSED; Generation 2 reaches POSTED_TO_ACCOUNTS; archive and side effects reconciled | PASS |
| Yearly payments | Rent, Inducement and Leave previews pass after one-row-per-PFNo stabilization | PASS after fix |
| Notifications/queues | Action notifications created; completed lifecycle queues return zero actionable items | PASS |

## Reports and Assets

| Test ID | Report/Asset | HTTP/Service | Visual Browser | Print Preview | Status |
| --- | --- | --- | --- | --- | --- |
| RPT-001 | Payroll Liabilities PAYE preview | 200; statutory heading present | PASS | PASS | PASS |
| RPT-002 | Payroll Liabilities PAYE PDF route | 200; all-page HTML/PDF preparation markup present | PASS | PASS | PASS |
| RPT-003 | Payroll Liabilities Excel | 200; `application/vnd.ms-excel` | N/A | N/A | PASS |
| RPT-004 | Finance Manager PAYE preview | 200; read-only route | PASS | PASS | PASS |
| RPT-005 | NASSIT/Gratuity/Bio Data | Automated service/render suite | PASS | PASS | PASS |
| RPT-006 | NRA logo | 200 JPEG, 21,806 bytes | PASS | PASS | PASS |
| RPT-007 | Shared report viewer | 200 JavaScript, 4,598 bytes | PASS | PASS | PASS |

## Defects Found and Fixed

| Defect | Severity | Finding | Fix | Retest |
| --- | --- | --- | --- | --- |
| PRD-012 | HIGH | Manager, Auditor, and Entity Head reopen queue/detail pages referenced missing `partials/head` files | Added the three role-level reusable head partials | All six EJS views compile and authenticated queue routes return 200 |
| PRD-011 | HIGH | Yearly calculation could return duplicate PFNo rows when company-specific and legacy-null staff/salary rows coexisted | Prefer company-specific staff, aggregate tied latest salary rows, de-duplicate PFNo before snapshot | Rent, Inducement, Leave test passed; no test drafts remain |
| PRD-017 | MEDIUM | Yearly-payment test left DRAFT helper records | Added exact test-user/status-scoped transactional cleanup | `yearly_test_batches=0` after rerun |
| PRD-018 | HIGH | Login page Bootstrap assets were blocked by incorrect SRI hashes under real browser CSP checks | Corrected Bootstrap CSS/JS integrity hashes in `views/login.ejs` | PRD-009B browser console sweep passed with zero errors |
| PRD-019 | MEDIUM | Production startup could attempt MySQL session-store initialization before reporting a missing `SESSION_SECRET` | Moved production environment validation before session-store initialization in `startServer()` | Production missing-secret startup fails clearly with `SESSION_SECRET is required` before DB/session initialization |

## Open Findings

| Defect | Severity | Required Action |
| --- | --- | --- |
| PRD-009 | FIXED | PRD-009B rendered-browser walkthrough, responsive dashboard checks, print-style PDFs, screenshots, browser console sweep, and report visual verification completed |
| PRD-013 | FIXED | Session-bound CSRF protection and browser adapters verified in PRD-009A |
| PRD-014 | FIXED | Helmet/CSP/HSTS and login-only rate limiting verified without breaking the authenticated route/report sweep |
| PRD-015 | FIXED | Active production navigation and readiness runner report zero Coming Soon routes/links |
| PRD-016 | ACCEPTED LIMITATION | Staff Self-Service deferred and excluded from this production release |
| PRD-007 | MEDIUM | Confirm application/database timezone policy and display conversions |
| PRD-010 | LOW | Configure SMTP or retain documented in-app-only notifications and manual onboarding |

## Visual Browser Signoff

PRD-009B completed rendered-browser UAT with Chromium via the installed Google Chrome channel. Evidence includes desktop/tablet/mobile dashboard screenshots, report preview screenshots, print-style PDF output for PAYE, EOS Benefit, NASSIT Contribution, Staff PAYE, NASSIT Statement, Gratuity Statement and Bio Data, and zero captured browser console errors.

Evidence location: `docs/PRD-009B-VISUAL-UAT.md`

## Deployment Conditions

- Back up `personnel_master` before migrations or release deployment.
- Apply all migrations in repository order and verify InnoDB engines/generation indexes.
- Set a strong production `SESSION_SECRET`; production must not start without it.
- Configure HTTPS proxy hops and secure cookies.
- Keep email disabled unless valid SMTP is supplied and tested.
- Configure real production secrets/HTTPS/proxy values.
- Perform final client signoff in the deployment environment before opening production access.

## Rollback

Rollback means restoring the previous code release and, where required, restoring the verified database backup. Do not delete payroll, GL, reversal, reopen, archive, workflow, notification, or audit history manually. If secure sessions or authorization cannot be guaranteed, keep login disabled until corrected.
