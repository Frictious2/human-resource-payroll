# WAEC cPanel/WHM Readiness Checklist

Date: 2026-11-09 UTC. **Do not deploy automatically.**

Owner-confirmed: CloudLinux **Setup Node.js App**, Node.js 22 available. Target credentials/URL were not provided and no server was accessed. cPanel/WHM compatibility remains **READY FOR TARGET-SERVER TESTING**, not certified on the target.

## Local source and synthetic checks

| Requirement | Evidence / current disposition |
| --- | --- |
| One customer/app/database/user/storage/origin | Documented in standalone architecture; no SaaS company switching. |
| Installation company | `INSTALLATION_COMPANY_ID=1` template, production validation, company-filtered login, stale-session and request-field denial. |
| Staff-save STG-ISO-001 | FIXED: isolated ownership/forgery/role/approval/audit and forced-failure rollback regression passed. |
| Company-scoped priority paths | Manager staff/entitlement/salary, setup, workflow/processing/posting, annual configuration, staff selectors/enquiry, file/branding and account service tightened. NULL-company fallback removed in reviewed priority paths. |
| CSRF/session bootstrap | Token initialized in regenerated session before explicit login save; concurrent follow-up request regression added. |
| Manager approval rules | No direct approvals of live records; successful staff edits remain pending approval. |
| Finance Manager | Existing read-only routes and valid-token mutation denials are exercised in disposable tests. |
| Node/Passenger entry | `app.js` delegates to shared managed bootstrap once; plain Node respects hosting PORT; actual Passenger listener must be tested. |
| Dependencies | `npm audit --omit=dev --json` reports zero findings in this pass; no package upgrades required. |
| Financial safety | Disposable runner denies live DB access, copies schemas only, fingerprints protected live records, removes generated DB/users. See per-run evidence. |

The machine-readable result `docs/test-results/waec-standalone-cpanel-readiness-latest.json` is authoritative for executed suite outcomes; this checklist is not itself a passing test.

Final full disposable run: `waec_acceptance_20261109_0e186fe1` (22:27:05-22:31:38 UTC), 18 suites PASS, 0 FAIL. Both PAYE and Payroll Item Taxability audits, Finance Manager oversight, sessions, approval workflows, payroll foundation, reversal/reopen/yearly processing, CSRF/rate limiting, multipart/private-file/shutdown security, child ownership and standalone configuration checks passed. Live protected-table fingerprints matched; generated DB/users were removed. A follow-up read-only check found zero remaining acceptance databases or test-user host entries. Earlier failed fixture runs remain in the evidence history.

Syntax: 56 changed/new JavaScript files checked (subsequent edited files rechecked); 276 EJS templates compiled. `git diff --check` passed. No dependencies changed in this pass; audit counts are zero for all severities.

## Remaining target-server gates

- [ ] Record actual domain, cPanel account, application root, Node/npm/Passenger/MariaDB versions and LVE/connection limits.
- [ ] Confirm startup file `app.js`, one managed listener, no exposed public Node port and no second manually launched worker.
- [ ] Install the exact lockfile on Linux and verify bcrypt/native-module compatibility.
- [ ] Configure independent production secrets privately and prove startup refuses unsafe/missing configuration.
- [ ] Create a dedicated synthetic staging DB/user, provision reviewed schema and verify InnoDB/indexes/session table.
- [ ] Verify full backup and restore on a temporary DB/storage root; approve retention and off-server backup policy.
- [ ] Confirm app/document roots do not expose `.env`, source, logs, dumps, private files or `public/uploads` legacy employee files.
- [ ] Approve and execute private-file migration separately; preserve/checksum originals and unchanged references.
- [ ] Confirm exact trusted proxy topology, HTTPS certificate, redirects and Secure/HttpOnly/SameSite cookies in a real browser.
- [ ] Verify CSP/assets, HSTS, MIME/frame/referrer protections and sanitized errors on target.
- [ ] Test login, logout, session restart persistence, expiration, cleanup and managed graceful restart under provider time limits.
- [ ] Test seven active roles, foreign-company/stale-session denials and same-installation access; do not provision real accounts without identity/authorization.
- [ ] Run synthetic staff/entitlement/salary/approval/payroll/PAYE/NASSIT/provident/correction/GL-safeguard/report tests without access to live WAEC tables.
- [ ] Open and inspect target-generated report previews, all-page print/PDF output and Excel exports with synthetic data.
- [ ] Confirm SMTP decision and file-only `.env` configuration; any additional delivery test needs fresh recipient/send authorization.
- [ ] Obtain explicit deployment authorization and client/stakeholder staging acceptance. Staff Self-Service remains deferred.

## Scope and limitations

The installation-company gate is not a replacement for scoped SQL. The reviewed priority paths and concrete findings above were tested locally; future legacy child-record/ID-based changes must include explicit ownership tests. Do not turn off this gate to accommodate a fixture or a foreign-company account. Preserve other-company and NULL-company records for authorized review rather than deleting/reassigning them. Full target-server acceptance and broader security assurance are not implied by these local results.

The concrete dependant child-row finding identified in this pass was corrected in Data Entry and Manager handlers, including staff-review display. A foreign-child-record fixture under the same PF independently verifies ownership instead of relying only on staff ownership. Preserve this test for future changes. Other legacy-module changes still require their own row-ownership and target-server acceptance tests; this review is not a universal penetration-test certification.

**STANDALONE SECURITY: PASS (local source and isolated regression scope; target-server acceptance outstanding)**

**STAFF-SAVE VULNERABILITY: FIXED**

**CPANEL/WHM COMPATIBILITY: READY FOR TARGET-SERVER TESTING**

**STAGING DEPLOYMENT: BLOCKED**

**PRODUCTION DEPLOYMENT: NOT READY**
