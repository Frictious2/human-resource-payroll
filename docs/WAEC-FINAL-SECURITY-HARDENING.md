# WAEC Final Security Hardening

9 November 2026. Project: Human Resource Payroll. Database inspected: `personnel_master` (MariaDB 11.4.9). No deployment, privileged account creation, credential rotation or financial processing was performed.

## Classification

| Area | Local implementation/verification |
| --- | --- |
| Security hardening | PASS for implemented controls and executed checks; not an online release authorization |
| Dependency audit | PASS: zero Critical, High, Moderate or Low production findings |
| Private file access | PASS for application-layer access and synthetic upload/download checks |
| Session lifecycle | PASS for tested persistence, expiry, cleanup, logout/regeneration and shutdown behavior |
| Account provisioning | PASS for scoped authorization, state-bound password links and isolated transactional failure tests |
| Staging deployment | BLOCKED pending the operator/security acceptance conditions below |

These results supersede the corresponding original source findings in the earlier staging-preparation guide. The owner subsequently confirmed SMTP credential rotation and updating `.env`; a fresh TLS/authentication check passed. Inbox delivery, actual Linux/proxy acceptance and deferred destructive workflow regressions remain open.

## Dependency remediation

The fresh initial audit reported 2 High and 5 Moderate affected packages; the earlier baseline counted 2 High/3 Moderate. The additional package counts were propagated findings on Express and express-rate-limit, not additional independent advisories.

| Package / dependency | Installed before -> after | Vulnerable range / selected remediation | Advisory / severity | Application exposure |
| --- | --- | --- | --- | --- |
| body-parser (transitive through Express) | 2.3.0 -> 2.4.0 | >=2.0.0 <2.4.0; exact compatible 2.4.0 override | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828), High | Express JSON/urlencoded parsing is reachable on browser requests; compressed-body DoS relevant |
| multer (direct) | 2.4.0 -> 2.5.0 | >=2.0.0 <2.5.0; compatible minor | [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m), High | Authenticated upload endpoints use file filters; CSRF does not replace patching |
| ip-address (transitive through rate limiter) | 10.7.3 -> 10.7.6 | <=10.7.3; patched same-major override | [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5), Moderate | IPv6 address processing in authentication/account rate limits; proxy configuration still matters |
| nodemailer (direct) | 10.0.16 -> 10.1.7 | >=3.0.0 <10.1.4; constrained to patched 10.1.x | [GHSA-8c8m-p3m8-cjg8](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8), [GHSA-m943-m63m-w62w](https://github.com/advisories/GHSA-m943-m63m-w62w), [GHSA-85x2-q946-cp5h](https://github.com/advisories/GHSA-85x2-q946-cp5h), Moderate | Account/company recipient strings enter email delivery; patched recipient parser |
| qs (transitive through Express/body-parser) | 6.16.0 -> 6.17.1 | >=6.7.0 <=6.16.0; patched same-major override | [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw), Moderate | No direct application stringify call identified; patch removes inherited advisory regardless |

`package.json` and lockfile updated deliberately; `npm install --ignore-scripts` changed five packages. No `npm audit fix --force`, major Express update or session-store replacement. `npm ls` confirms Express 5.1.0, express-rate-limit 8.6.2 and the patched dependency tree. `npm audit --omit=dev` now exits 0 with zero findings. This is a known-advisory result, not proof of absence of all vulnerabilities.

## Developer and account security

- Removed automatic seeding from startup. Compatibility `ensureSeedDeveloper()` is a no-op in every environment, with no default credentials, SQL writes or password returns. No development seed command remains enabled.
- Removed startup credential logging. Existing accounts/passwords were not changed. Manual Developer creation/update/deletion remains restricted to an authenticated Developer; ordinary Admin cannot assign Developer or arbitrary roles.
- Shared `accountSecurityService` implements fixed-role CompanyID-scoped portal creation/deletion, target-company validation, strong password checks and transactional centralized auditing. Body fields cannot override the authenticated Admin company or handler-selected role. Developer may explicitly create an Admin in a selected existing company, as before.
- Company Admin user lists, resend and deletion are scoped to the authenticated company; malformed non-Developer sessions without a positive company are denied. Finance Manager no longer defaults missing scope to company 1.
- Setup links use HS256, audience/issuer/purpose and 30-minute expiry. An HMAC fingerprint binds the token to PFNo, company, email, role and current password hash. No bearer token is stored in plaintext. A successful password change invalidates every old token; an atomic compare-and-set prevents concurrent reuse.
- Production startup requires a strong reset-token secret; known default reset strings are not used. Do not reuse session secrets for account links. Old-format invitations must be resent after restart.
- New passwords require 12+ characters, upper/lower case, digit and symbol, at most 72 UTF-8 bytes; stored with bcrypt cost 12. Existing hashes/passwords are untouched unless an authorized holder explicitly completes a valid setup/reset action.
- The Developer edit form no longer displays a stored password hash or silently resubmits it as a new password. Blank means unchanged.
- Authenticated self-service password changes retain current-password/confirmation checks and now use the same strong policy and transactional audit helper; failed audit persistence rolls back the password change. This does not automatically reset any existing password.
- Account creation/deletion, link issuance and successful password setup use the existing audit helper with the same DB transaction for each respective operation. Failed audits roll back their associated changes. `tblpassword`, `developer` and `tblaudittrail` were confirmed InnoDB. Link issuance is not recorded as proof of email delivery.
- Account setup/resend and account-management mutations are rate limited to 30 requests/IP/15 minutes, separately from the existing failed-login policy. Single-instance staging is recommended until rate-limit coordination is explicitly configured for multiple workers.
- Security event/global error paths omit query strings so setup tokens are not logged. Nginx/proxy logging must also omit token query strings.

No activation column/migration was introduced: null password remains the pending-setup state. A signed valid link plus password setup is the activation mechanism; future authenticated invitations can still reset a password through the approved route. No new approval stage or financial authority was introduced.

## Private uploads

New photos/receipts and company logo files are written under `PRIVATE_UPLOAD_DIR`, default `<project>/private/uploads`, outside public storage. Nothing was moved or deleted from existing employee storage.

All `/uploads` traffic is excluded from general static serving, including encoded/case variants. The authenticated delivery handler checks stored record ownership, exact CompanyID and role, validates safe path components and real paths, and sends no-store/nosniff/sandbox headers. It can read authorized legacy files as a compatibility bridge. Unknown paths, unrelated files and company mismatches are not disclosed.

The adjacent company/logo settings flaw was also corrected: Admin company reads/updates use the authenticated CompanyID, no first-company fallback or implicit company insertion. A submitted `currentLogo` cannot substitute another path; without a new upload the stored logo is preserved. Mocked controller regression verifies that a submitted CompanyID 2 cannot redirect a Company 1 update. No real company fields were updated.

| Asset | Access |
| --- | --- |
| Staff photo | Valid CompanyID plus Admin/Data Entry/Manager/Auditor/Entity Head/Finance Officer/Finance Manager; stored staff ownership required |
| Medical receipt | Valid CompanyID plus Admin/Data Entry/Manager/Auditor/Entity Head; Finance roles do not receive receipt access |
| Company logo | Public only when the exact path is configured as a company logo; logo is not an employee attachment |

New images have a strict MIME/extension allowlist, content-signature check, bounded memory/file/field limits, safe UUID filenames and private permissions. Staff/medical images are limited to 3 MB; logos to 2 MB. SVG, executable extensions, mismatched signatures, cross-company employee targets and invalid staff identifiers are rejected. Signature validation is not malware scanning; only supported image types are accepted.

Read-only inventory found one Company 1 staff photo reference, no medical receipt references and six legacy files in `public/uploads`. No filenames or file contents were exported. Files without verified stored ownership remain unavailable through the private endpoint, not guessed from a filename.

### Controlled legacy migration (not executed)

1. Obtain file-owner/WAEC authorization and a verified DB plus file backup; keep backup outside the web root, encrypted and access-restricted.
2. In maintenance mode inventory stored photo/receipt/logo paths and map them to company/employee ownership. Review unreferenced files separately; do not delete or assign ownership by assumption.
3. Copy approved files into the matching relative subdirectories under private storage, preserving URL mappings. Verify hashes, size, ownership and permissions. Do not update payroll or employee financial fields.
4. Verify authenticated same-company access and anonymous/cross-company denial, including report images. Legacy URLs stay unchanged; the new handler searches private storage first.
5. Retain original files under access restriction until explicit authorization permits removal. The new code does not perform this removal. Never configure Nginx/Apache to serve `public/uploads` directly; proxy the URL to the application handler instead.
6. Roll back the copy/paths only through the approved maintenance procedure. Do not restore unrelated DB tables over newer transactions.

## Sessions and shutdown

The local mysql2 store now starts an unref'ed cleanup timer after session-table readiness. `SESSION_CLEANUP_INTERVAL_MS` defaults to 15 minutes (minimum 1 second); `SESSION_CLEANUP_BATCH_SIZE` defaults to 100 and is capped at 1000. Each indexed DELETE removes only rows with `expires < UNIX_TIMESTAMP()`, ordered by expiry, in a bounded batch. One cleanup may run per store; multiple instances safely use InnoDB row locking/predicate checks. Errors are sanitized and retried at the next interval. No unrelated table is touched.

Expired reads also condition their delete on expiry, protecting a concurrently refreshed active session. `touch()` updates only expiry and cannot resurrect a deleted session or overwrite another request's stored payload. Cleanup stops on close/shutdown, and an outstanding sweep is awaited before pool closure.

SIGTERM/SIGINT now enter one idempotent shutdown operation: stop cleanup scheduling, stop HTTP acceptance/idle keepalive, allow active requests to finish, then close the session store, shared SMTP transport and DB pool. `SHUTDOWN_TIMEOUT_MS` defaults to 30 seconds. At deadline it force-closes HTTP connections, logs a generic warning and exits 1. A forced deadline can interrupt a payroll transaction; InnoDB rolls back uncommitted work, but an already committed request may have lost its response. Inspect workflow/idempotency state before retrying; do not automatically reverse or repost. Native Linux signal delivery remains a staging rehearsal item.

Production startup now binds loopback by default (`APP_HOST=127.0.0.1`), unless an operator explicitly overrides it. A local production-mode boot using a SELECT/SHOW-only in-memory DB adapter succeeded without account writes. This is not a deployed production database/proxy test.

## SMTP assessment

- SMTP values remain project `.env`-only; no OS fallback. Stronger ignore rules exclude `.env.*` except the sanitized example, private storage, logs and dump files. Release allowlists must also exclude all live credentials, exports and employee attachments.
- Current tracked non-node_modules files were scanned for the current configured SMTP password without printing it: no literal matches. Only the sanitized example is tracked among root environment files. HEAD's example did not contain that current password. This was not an exhaustive all-history secret scan.
- The owner confirmed that the exposed SMTP password was rotated and the local `.env` updated. This confirmation is owner-provided evidence, not an independent check that the old password is rejected. Mailbox/access-log review remains the owner's responsibility. No credential was generated, replaced or printed by this work.
- A fresh post-confirmation SMTP `verify()` check passed TLS/mailbox authentication using file-only settings. No email was sent; approved-recipient inbox delivery is still unverified.

## Files and verification

Runtime changes: `package.json`, lockfile, `server.js`, `config/sessionStore.js`, `config/mailer.js`, `middleware/auth.js`, `routes/dataEntry.js`, Admin/Developer/Finance Manager controllers, `services/authService.js`, `services/profileService.js`, `services/accountSecurityService.js`, `services/privateFileService.js`, `services/shutdownService.js`, environment validator, audit metadata and sanitized security event paths. Password templates and the sanitized environment example/ignore rules were updated. No payroll calculation/report mapping service changed.

See `WAEC-STAGING-SECURITY-VERIFICATION.md` for actual executed commands and limitations. Separate deployment and provisioning guides remain operator checklists, not approval to deploy.

## Remaining staging/production gates

1. Rotation is owner-confirmed and post-confirmation SMTP authentication passed. An authorized-recipient email/receipt test remains required.
2. Approve/verify persistent private storage, proxy-only upload delivery and the controlled legacy file plan. Actual Linux filesystem/proxy/TLS acceptance has not been performed.
3. Rerun the full mutation/approval/reversal/reopen suites on a separate disposable DB, not the protected WAEC records. No new production account or financial workflow was executed just to satisfy coverage.
4. Rehearse real Linux SIGTERM/restart, outage recovery, backup restore and a clean locked Linux dependency install. Confirm CRUD-only runtime DB behavior: existing runtime ensure-table DDL is still a deployment qualification concern, not fixed by this security patch.
5. Supply real deployment DB/session/reset/proxy/HTTPS settings, identify the Finance Manager holder, perform protected staging acceptance and obtain client sign-off. Production remains a separate decision.

No historical approvals/audit events were fabricated; August batch 161 and the legacy GL summary were not canceled, reversed, reopened, regenerated, approved or posted.
