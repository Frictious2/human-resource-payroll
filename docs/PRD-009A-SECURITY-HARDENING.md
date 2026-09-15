# PRD-009A Security Hardening

Verification date: Thursday, August 27, 2026

## Outcome

PRD-009A closes the production security/configuration findings without changing payroll, yearly-payment, reversal, reopen, parameter, sensitive-record, or report calculations. PRD-009B has since completed the visual, responsive, print-preview, and PDF acceptance pass.

## Security Matrix

| Control | Finding | Implementation | Verification | Result / Condition |
| --- | --- | --- | --- | --- |
| CSRF | Browser mutations had no anti-CSRF control | Session-bound synchronizer token using `csrf-sync`; all POST/PUT/PATCH/DELETE requests validated | Seven-role DB-backed HTTP test; missing and invalid tokens returned 403; valid token plus unauthorized role remained 403 | PASS; no route-prefix exemptions |
| EJS forms | Hundreds of legacy forms made per-controller token wiring unsafe | Central HTML adapter injects `_csrf` into non-GET forms and exposes a `csrf-token` meta value | Login, Department proposal, Phase 11 sensitive workflows, and logout passed | PASS |
| AJAX/fetch | Inline scripts submit mutations throughout legacy pages | `/js/csrf-protection.js` adds `X-CSRF-Token` to same-origin `fetch` and XMLHttpRequest mutations and handles dynamically added forms | Representative Admin, Finance, Manager, Auditor, HNO, Data Entry and Finance Manager contexts tested | PASS |
| GET mutations | Logout and notification-open previously changed state on GET | Logout is now POST-only; notification-open GET only redirects and explicit POST actions mark read | Persistent-session logout test passed; GET `/logout` returns 405 | PASS |
| Headers | No central browser hardening | Helmet, no `X-Powered-By`, nosniff, DENY framing/frame-ancestors, strict referrer policy, CSP | Header assertions in `testCsrfProtection.js` | PASS |
| CSP | Legacy CDN and inline assets prevented an immediate nonce-only policy | Explicit self/approved-CDN allow-list; no wildcard scripts; object-src none; form-action/base-uri self | 71 protected pages and report/export routes passed | PASS WITH CONDITION: externalize inline scripts for a future nonce-only CSP |
| HSTS | Must not affect local HTTP | Six-month HSTS with subdomains only in production; disabled in development | Static configuration/readiness inspection | PASS |
| Login throttling | Login endpoints were unrestricted | 20 failed attempts per IP per 15 minutes; successful responses skipped; standard rate-limit headers; login POST routes only | Test override of 3 attempts produced HTTP 429 on the fourth request; ordinary GET/static browsing remained available | PASS |
| Session secret | Deployment environment had no production secret | Production rejects missing, blank, known defaults, or values shorter than 32 characters | Direct production startup refused missing secret | PASS AT CODE LEVEL; real deployment secret remains mandatory |
| Cookies/proxy | Secure cookies must work behind TLS termination | `httpOnly`, `sameSite=lax`, `secure=true` in production, `hrpayroll.sid`, eight-hour lifetime; production requires an explicit proxy setting | Persistent-session restart/logout suite passed | PASS; use `0` for direct TLS or the exact trusted proxy count |
| Environment | Validation was distributed | Central startup validator checks session secret, DB variables, HTTPS app URL, port/proxy, and SMTP only when enabled; production validation now runs before MySQL session-store initialization | Safe/unsafe fixture tests and direct startup test | PASS |
| Errors | No global production-safe 404/error response | Safe HTML/JSON handlers omit stacks, SQL, paths, environment, cookies and session details | HTTP route sweep and CSRF failures passed | PASS |
| Security logging | Important denials were not consistently visible | Sanitized events for invalid CSRF, rate-limit hits, unauthenticated and forbidden access | Test output verified; request bodies/tokens/cookies never logged | PASS |
| Dependencies | Initial audit reported 8 production advisories | Compatible transitive updates plus Nodemailer 9.0.6 | `npm audit --omit=dev` reports 0 vulnerabilities | PASS |

## CSP Asset Policy

Allowed script/style origins are limited to the application and the legacy origins currently used by Bootstrap, DataTables, jQuery, SheetJS, JSZip/pdfmake and html2pdf. Image sources permit local/data/blob images, the existing Picsum placeholders, and the NRA source. `unsafe-inline` remains temporarily required by existing EJS pages; `script-src *` is not used.

## Incomplete Route Disposition

Unimplemented Manager links for Warning, Medical Limits, Travel, Attendance, Long Service, Payroll Liabilities, COM/ORG Liabilities and Travel reporting were removed from active routes/navigation. Unimplemented Data Entry Import, Travel, Liabilities, Corporate Benefit, Long Service, Payroll Liabilities, COM/ORG Liabilities and Travel links were also removed. Unlinked Admin placeholder endpoints were removed. These are deferred roadmap items, not production features.

## Staff Self-Service Scope

Classification: **NOT IMPLEMENTED / DEFERRED**.

No Staff role is normalized by authentication, no Staff dashboard exists, and no company-scoped self-service workspace is active. Staff Self-Service is excluded from this production release and must not appear in the active role list or acceptance claims.

## Active Production Roles

- Administrator (`admin`)
- Data Entry Officer (`data-entry`)
- Finance Officer (`finance-officer`)
- Finance Manager (`finance-manager`)
- Manager (`manager`)
- Auditor (`auditor`)
- Entity Head / HNO (`entity-head`)

The developer account remains a deployment/support capability rather than a nominated client business role.

## Production Configuration

Use `.env.production.example` as the deployment checklist. Generate `SESSION_SECRET` outside source control with at least 32 bytes of cryptographic randomness. Set `APP_BASE_URL` to HTTPS and `TRUST_PROXY_HOPS` to the exact reverse-proxy count. Do not fall back to MemoryStore or an unsafe session secret. Email remains disabled unless complete SMTP credentials are supplied.

## Automated Evidence

- `scripts/testCsrfProtection.js`: PASS, seven active roles
- `scripts/testLoginRateLimiting.js`: PASS
- `scripts/testPersistentSessionStore.js`: PASS
- `scripts/testFinanceManagerOversight.js`: PASS
- `scripts/testDepartmentParameterWorkflow.js`: PASS over HTTP with CSRF
- `scripts/testPhase11RecordWorkflows.js`: PASS over HTTP with CSRF
- `scripts/testPayrollLiabilityReports.js`: PASS
- `scripts/testYearlyPaymentWorkflow.js`: PASS
- `scripts/testPhase14PayrollReversalWorkflow.js`: PASS
- `scripts/testPhase15PayrollReopenWorkflow.js`: PASS
- `scripts/testPrd009CrossRoleHttpUat.js`: PASS, seven roles and 71 protected pages
- `npm audit --omit=dev`: 0 vulnerabilities

## Remaining Conditions

- Configure the real production `SESSION_SECRET`, database credentials, HTTPS base URL, and proxy hop count at deployment.
- PRD-009B visual/responsive/print/PDF UAT is complete and passed; final public go-live still needs deployment-environment smoke signoff.
- Future hardening should externalize legacy inline scripts/styles and adopt CSP nonces/hashes.

## Status

`PRD-009A STATUS: PASS`
