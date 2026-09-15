# Production Readiness Defects

Audit baseline date: Thursday, August 27, 2026

## Status Legend

- `OPEN`
- `FIXED`
- `ACCEPTED LIMITATION`
- `PENDING MANUAL VERIFICATION`

## Defect Register

| ID | Severity | Module | Role | Issue | Impact | Root Cause | Fix / Action | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRD-001 | BLOCKER | Session / Authentication | All | Express session previously used the default in-memory store | Sessions would be lost on restart and were not production-safe under load | No external persistent session backend had been configured | Replaced MemoryStore with a MySQL-backed `express-mysql-session` store, added the `sessions` migration, and updated startup/readiness checks to fail clearly if the store is unavailable | `scripts/testPersistentSessionStore.js` passed on Friday, August 21, 2026, including restart persistence and logout destruction | FIXED |
| PRD-002 | HIGH | Session / Authentication | All | Session secret previously fell back to a hardcoded default and cookies were always insecure | Production sessions could be exposed or misconfigured | Dev-safe defaults were being reused in all environments | Hardened `server.js` to require a real `SESSION_SECRET` in production, set secure cookie options, and regenerate session on login | `server.js` patched on August 20, 2026 | FIXED |
| PRD-003 | HIGH | Notifications / SMTP | All | Workflow actions generated repeated `getaddrinfo ENOTFOUND smtp.your-mail-host.com` style email failures during script verification | Log noise, operator confusion, and false expectation that email notifications are operational | SMTP presence was treated as equivalent to SMTP readiness | Replaced mailer with explicit opt-in `EMAIL_NOTIFICATIONS_ENABLED=true`; in-app notifications remain active | `testPayrollWorkflowFoundation.js` passed after patch with no SMTP error spam | FIXED |
| PRD-004 | HIGH | Payroll Posting | Finance | Post-to-Accounts activity scope was previously unclear because non-`01` activities appeared scaffolded without verified GL strategies | Finance could mistake unsupported activities as postable or attempt unsupported direct posting | Legacy Process Emoluments branches and special-payment flows were broader than the implemented GL posting service | Added a centralized activity readiness policy, server-side blocking for unsupported activities, Finance UI support badges, readiness-runner reporting, and automated scope tests. Activity `01` remains fully supported; all other activities are intentionally blocked until verified. | `scripts/testGlPostingActivityScope.js`, `scripts/testPayrollWorkflowFoundation.js`, `scripts/testPhase15PayrollReopenWorkflow.js`, and `scripts/runProductionReadinessChecks.js` passed on Friday, August 21, 2026 | FIXED |
| PRD-005 | HIGH | Reversal Test Automation | Finance/Manager/Auditor/HNO | The Phase 14 test previously required an existing posted payroll scenario | Production-readiness automation could not verify reversal independently | The script assumed current DB state instead of preparing isolated test data | Rebuilt the test around the isolated Phase 15A fixture: real Process Emoluments, full approval/posting, reversal approvals/execution, integrity mutations, role/company checks, forced rollback, scoped cleanup, and an explicit destructive-test guard | Two consecutive isolated runs passed on August 27, 2026 for CompanyID 2, November 2098, activity `01`; each reconciled original and reversal debit/credit totals at 12,900 with zero net effect | FIXED |
| PRD-006 | MEDIUM | Shared Access Denied UI | Data Entry | Shared “Coming Soon / Access Denied” page checked `data_entry` instead of `data-entry` | Blocked Data Entry users could receive the wrong layout | Legacy role-label mismatch in template logic | Updated `views/shared/coming-soon.ejs` to accept both forms | Template patched on August 20, 2026 | FIXED |
| PRD-007 | MEDIUM | Timezone / Timestamps | All workflow roles | Sandbox notifications produced UTC timestamps on Friday, August 21, 2026 while the audit baseline is Thursday, August 20, 2026 Europe/London | Audit and user-facing timestamps may appear one day ahead depending on display context | Application/database timezone handling is not explicitly normalized across all writes and displays | Document and verify timezone policy before production cutover | Observed in Phase 15 sandbox notification output | OPEN |
| PRD-008 | MEDIUM | Reporting / History | Finance | Legacy `tblgltrans` remains month-level, not generation-level | Generation history cannot be reconstructed from `tblgltrans` alone | Legacy table schema predates generation-aware workflow design | Continue using generation-aware helper tables as the authoritative audit trail; document limitation | Isolated reopen script passed with helper tables preserving history | ACCEPTED LIMITATION |
| PRD-009 | MEDIUM | Cross-role UAT Coverage | Multiple | Authenticated HTTP UAT and final visual browser/print/PDF acceptance were required before the production verdict | Final client acceptance required proof beyond route-level HTTP checks | Initial in-app browser bridges failed, so installed Chrome automation was used for rendered browser evidence | Completed PRD-009B visual UAT across seven active roles, desktop/tablet/mobile dashboard checks, 67 protected screens, 11 reports, screenshots, print-style PDFs, console review, and error-page checks | `docs/PRD-009B-VISUAL-UAT.md`, `docs/test-results/prd009b/prd009b-visual-uat-latest.json`, and `scripts/runProductionReadinessChecks.js` report PASS | FIXED |
| PRD-010 | LOW | Mailer Config Surface | Admin/Developer onboarding | Some non-workflow email send paths still call the shared mailer, now safely disabled unless explicitly enabled | Account setup emails will be skipped until real SMTP is confirmed | Production email policy not yet finalized | Either configure SMTP or keep email disabled and use manual onboarding for go-live | Shared mailer now returns `skipped: true` when disabled | OPEN |
| PRD-011 | HIGH | Yearly Payments | Finance | Annual preview could return duplicate PFNo rows and fail the batch-row unique key | Rent, Inducement, or Leave draft creation could fail for legacy/company-overlap staff | Company-specific and legacy-null staff/salary rows were both eligible; tied latest salary dates could multiply rows | Prefer company-specific staff, aggregate latest salary per PFNo, and de-duplicate the calculated snapshot before insert | `scripts/testYearlyPaymentWorkflow.js` passes all three annual types | FIXED |
| PRD-012 | HIGH | Reopen UI | Manager/Auditor/HNO | Six nested reopen queue/detail views referenced missing role-level head partials | Authenticated reopen pages returned generic 500 errors | Reopen templates expected a shared partial that was never added for those role layouts | Added Manager, Auditor, and Entity Head `partials/head.ejs` files | Six EJS compile checks and authenticated queue requests pass | FIXED |
| PRD-013 | HIGH | Web Security | All mutation roles | Browser mutations previously had no anti-CSRF control | An authenticated browser session could be induced to submit state-changing requests | Existing Express forms did not carry or validate anti-CSRF tokens | Added session-bound synchronizer-token validation, central form token injection, same-origin fetch/XHR headers, safe 403 handling, and POST-only logout | `scripts/testCsrfProtection.js`, Department HTTP workflow, Phase 11 HTTP workflows and seven-role route sweep passed | FIXED |
| PRD-014 | HIGH | Web Security | All | Helmet/security headers and authentication throttling were missing | Browser hardening and brute-force resistance were incomplete | Production middleware was not added during feature phases | Added environment-aware Helmet/CSP/HSTS and login-only rate limiting; removed `X-Powered-By`; patched production dependencies | Header/rate tests pass and `npm audit --omit=dev` reports zero vulnerabilities | FIXED |
| PRD-015 | MEDIUM | Navigation / Incomplete Pages | Manager/Data Entry/Admin | Coming Soon routes were reachable from normal-role navigation or direct URLs | Client could enter incomplete production pages | Legacy placeholders remained after modules were deferred | Removed placeholder routes and active links; documented deferred scope rather than inventing features | Repository scan and readiness runner report zero Manager Coming Soon routes/navigation | FIXED |
| PRD-016 | MEDIUM | Staff Self-Service | Staff | No active Staff role is recognized by authentication normalization/dashboard routing | Staff self-service cannot be accepted in this release | Staff portal was never implemented in the active role architecture | Explicitly excluded Staff Self-Service from the current release and active role list; future implementation requires a separately approved phase | Role discovery documented in `docs/PRD-009A-SECURITY-HARDENING.md` | ACCEPTED LIMITATION |
| PRD-017 | MEDIUM | Test Isolation | Finance | Yearly-payment test left DRAFT helper rows after completion | Repeated readiness runs polluted helper tables and could cause collisions | Test had no scoped cleanup | Added exact PreparedBy/UserID/status-scoped transactional cleanup | Rerun passed and `yearly_test_batches=0` | FIXED |

## Blocking Conditions for Production

No Critical or High application defects remain open after PRD-009B. Production release still requires the following deployment prerequisites:

1. Real production environment values, including `SESSION_SECRET`, DB credentials, HTTPS base URL, and proxy hop count, configured during deployment
2. Final database/application/static asset backup before migration/deployment
3. SMTP either configured and tested or explicitly left disabled with in-app notifications only
4. Staff Self-Service remains formally out of scope for this release

## Fixed During Phase 16

- Session regeneration and secure cookie hardening
- Persistent MySQL session store with restart-survival verification
- SMTP email opt-in gate
- Shared access-denied role layout mismatch
- Centralized Post-to-Accounts activity support policy with backend enforcement and Finance UI status visibility
- Self-contained, guarded, repeatable Phase 14 reversal automation with isolated fixture cleanup
- Reopen queue/detail EJS runtime includes for Manager, Auditor, and Entity Head
- Yearly-payment company/legacy staff de-duplication and test-owned draft cleanup
- Session-bound CSRF protection for browser mutations and POST-only logout
- Helmet security headers, environment-aware HSTS/CSP, and login throttling
- Production environment validation and zero-vulnerability dependency audit
- Production navigation placeholder cleanup and explicit Staff Self-Service deferral
- PRD-009B rendered-browser visual UAT, responsive dashboard checks, report preview/PDF inspection, console review, and final production-verdict evidence
- Startup-order hardening so production `SESSION_SECRET` validation runs before MySQL session-store initialization

## Accepted Technical Limitation

- `tblgltrans` remains a legacy month-level summary table. Generation-aware workflow, posting, reversal, reopen, and archive tables remain the source of truth for audit and history.
- Staff Self-Service is deferred and must not appear in the active production role list for this release.
