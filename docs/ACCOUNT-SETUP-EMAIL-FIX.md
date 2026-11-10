# Account setup email delivery

## Update: file-only SMTP configuration (9 November 2026)

SMTP settings now come exclusively from the project-root `.env`, resolved relative to the application code rather than the launch directory. Startup discards inherited `SMTP_*` values before loading this file. The shared mailer applies the same policy when used by standalone scripts. Missing/blank file settings do not fall back to Windows, shell or process-manager SMTP values. An unreadable file fails safely without exposing its contents.

This supersedes the earlier instruction to remove Windows SMTP variables: removing them is no longer necessary. Restart the application after changing `.env`. Other environment settings (database, sessions, notification switches) retain their existing precedence. Keep `.env` private and outside source control; provisioning must put this file at the project root on staging/production too.

Verification: `node scripts/testSmtpEnvironment.js` covers inherited-value replacement/removal, fixed file path, blank/missing/unreadable files and preservation of non-SMTP settings. No real email or database writes are required.

Verified: 3 November 2026.

## Findings

- All portal roles share the account setup email helper: Admin, Data Entry, Finance Officer, Finance Manager, Manager, Auditor and Entity Head.
- Optional workflow email was disabled. Previously this silently skipped account setup mail as well, while account creation/resend still reported success.
- The inherited SMTP hostname/password were placeholders. The supplied `mail.hrpayroll.davisasmedia.com` returned DNS ENOTFOUND. The subsequently authorized `hrpayroll.davisasmedia.com` resolves and passes unauthenticated SMTP/TLS verification on port 465 after an initial connection reset. The ignored local `.env` now uses this host; inherited process environment values can override it. No password or token is included here.

## Corrections

- Required account emails are independent of `EMAIL_NOTIFICATIONS_ENABLED`. That switch still controls optional workflow notifications.
- `ACCOUNT_EMAIL_ENABLED=false` explicitly disables account mail; create/resend reports an unsuccessful send rather than pretending delivery occurred.
- Missing SMTP credentials and SMTP recipient rejection now fail account email delivery. Transport connection/greeting/socket timeouts are bounded.
- All seven account list pages show resend failure messages, not just successful responses.
- Role-specific resend lookups include the authenticated company ID.
- Setup links prefer `APP_BASE_URL` when configured. Configure a recipient-accessible URL; a localhost link cannot be used from another machine.
- Production validation requires SMTP fields when account email is explicitly enabled. The example environment documents the separate setting and optional `SMTP_FROM`.
- Error logging avoids printing full mail errors that might expose recipient/token details.

## Verification

- `node scripts/testAccountSetupEmail.js`: PASS. Mock SMTP/database only; no accounts or real emails created. Covers required/optional mail isolation, explicit disable, missing credentials, recipient rejection, six generic creation handlers, seven role resend handlers and cross-company denials.
- Seven account list EJS templates compile successfully.
- Syntax checks pass for mailer, Admin controller, environment validator and test script.
- Production validator checks pass for enabled account email with/without SMTP credentials and explicitly disabled email.
- Live DNS control succeeds; supplied mail hostname fails DNS. Alternative hostname passes SMTP/TLS verification on port 465; port 587 returns EPROTOCOL. End-to-end inbox delivery is NOT verified.
- SMTP verification using `.env` values directly passes TLS and mailbox authentication for `hrpayroll.davisasmedia.com:465` (no email sent). The default process still inherits placeholder SMTP values: remove/replace those in the application launcher before restarting. Normal dotenv loading intentionally does not override deployment environment variables.

## Required configuration and retry

1. Obtain the exact outgoing server, port and TLS mode from the hosting provider's mail-client configuration. Do not disable TLS certificate verification.
2. Configure the SMTP mailbox username and real password locally/through the server secret mechanism. Do not put passwords into chat, source control or this document.
3. Set `ACCOUNT_EMAIL_ENABLED=true` and the correct `APP_BASE_URL`; leave optional notifications disabled if desired.
4. Restart the application to load its environment and transport configuration. Check for inherited environment values overriding `.env`.
5. Use Admin > relevant account list > Resend Link for existing accounts. Recreating accounts is unnecessary. The new link expires after 30 minutes.
6. Verify SMTP acceptance and receipt in inbox/spam. SMTP acceptance is not proof of final inbox delivery.

No payroll, staff, entitlement, salary, approval or accounting records were changed. No existing passwords were reset and no unsolicited password emails were sent.
