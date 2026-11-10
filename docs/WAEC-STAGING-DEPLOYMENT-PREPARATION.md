# WAEC Staging Deployment Preparation

## Remediation Update: 9 November 2026

The original findings below are historical preparation evidence. Dependency findings are now zero; default privileged startup seeding, account-token/company/audit protections, private upload serving, session cleanup and graceful shutdown have been remediated. Production also defaults to a loopback listener. See `WAEC-FINAL-SECURITY-HARDENING.md` and `WAEC-STAGING-SECURITY-VERIFICATION.md` for current results and limitations.

External staging remains BLOCKED pending mailbox-owner credential rotation/confirmation and the isolated-DB/Linux/private-storage acceptance gates. Do not implement the older suggested session-cleanup cron: cleanup is now built into the store. Do not point Nginx static serving at legacy uploads; proxy file requests to the authenticated application handler. Existing files have not been moved.

Reviewed 9 November 2026. Release candidate: package `1.0.0`. No deployment performed.

STAGING DEPLOYMENT PACKAGE: BLOCKED

OVERALL: BLOCKED

Preparation instructions are complete, but external staging is not approved while the current High dependency/security findings remain. This supersedes the older READY statement. No production readiness is claimed.

## Verified environment and tests

| Check executed this review | Result |
| --- | --- |
| Node / lockfile | Node `v22.19.0`, lockfile version 3 |
| Read-only database identity | `personnel_master`, MariaDB `11.4.9` |
| InnoDB | `SHOW ENGINES`: YES |
| Finance Manager aggregate | One Company 1 account, non-empty password; holder not verified |
| Sessions table | `session_id varchar(128)` PK, `expires int unsigned` indexed, `data mediumtext` |
| `node scripts/testStagingSessionStore.js` | PASS; database-backed synthetic sessions only, including independent Node process read; cleanup PASS |
| `node scripts/testSmtpEnvironment.js` | PASS; file-only SMTP and no inherited fallback |
| `node scripts/testAccountSetupEmail.js` | PASS; mocked mail/account handlers and seven EJS templates |
| `npm audit --omit=dev --json` | FAIL (exit 1): 0 Critical, 2 High, 3 Moderate package findings |
| JavaScript syntax checks | PASS: new session test, session store, SMTP loader and environment validator |
| Real Linux / HTTPS / account login / reports | NOT RUN this review; target server not provided |

No financial or employee fixture was created. The session test inserts/removes only five random `waec-stage-...` session IDs; it verifies none remain. No batch 161 action, financial update, approval, GL write or schema migration was executed. Existing runtime-HTTP test scripts were not launched because `startServer()` can seed a Developer user and report getters can perform runtime DDL.

## Current blocking findings

| ID | Severity | Evidence / required action |
| --- | --- | --- |
| STG-01 | High | npm reports body-parser `<2.4.0` GHSA-27r3-jxmh-p828 and multer `<2.5.0` GHSA-q7qp-rjg7-q26m. Resolve compatible versions, regenerate lockfile deliberately and rerun security/upload/workflow tests. No dependency upgrades made in this task. |
| STG-02 | High | `server.startServer()` calls `authService.ensureSeedDeveloper()` without a production guard and can log the created password. Remove production auto-seeding/secret logging before target startup; inspect existing privileged users without exporting credentials. |
| STG-03 | High | Setup token default secret is not rejected by production validator; password policy/reuse/identity binding need hardening. See provisioning guide. Local reset secret exists, but target enforcement remains incomplete. |
| STG-04 | High | Provisioning administration list/deletion is not company-filtered; Finance Manager missing-company fallback is company 1. Confirm Admin scope policy and implement fail-closed company tests before external access. |
| STG-05 | High | `express.static(public)` precedes auth; uploaded employee photos/medical receipts live under `public/uploads`. Keep all real uploads out of staging and require authenticated ownership-controlled delivery before hosting confidential files. |
| STG-06 | High operational | The production example contained populated SMTP credentials; it has been replaced with a credential-free template. Rotate the exposed credential through the mailbox owner and check repository history/artifacts before any release. No real `.env` credentials were changed. |
| STG-07 | Moderate | npm reports ip-address GHSA-rxp7-6hxx-x8q5, nodemailer (three recipient-parser advisories), qs GHSA-6pq8-jhm2-2vcw. Investigate installed/locked versions and safe patches alongside STG-01. |
| STG-08 | Medium | Session expiration is lazy only; cleanup option is not connected to a scheduler. Arrange controlled expired-session cleanup on staging. |
| STG-09 | Medium | No SIGTERM/SIGINT drain/pool shutdown handler found. Verify in-flight request behavior; add reviewed graceful shutdown before acceptance. |
| STG-10 | Medium | Runtime ensure-table helpers may issue DDL even after migrations. Test with a CRUD-only account; do not grant root/DDL privileges just to hide errors. |

These are source/audit findings, not evidence of compromise. The two High audit results supersede the historical zero-vulnerability baseline. `npm audit` counts affected packages, not individual advisory records. No destructive exploit tests were performed.

Installed affected versions were confirmed by `npm ls`: body-parser 2.3.0, multer 2.4.0, nodemailer 10.0.16, ip-address 10.7.3 and qs 6.16.0. Machine-readable execution evidence: `docs/test-results/waec-staging-preparation-latest.json`.

## Session store verification matrix

| Requirement | Current result |
| --- | --- |
| Creation/persistence | PASS against sessions table |
| Expiration | PASS; expired read returns null and deletes that session |
| Explicit deletion | PASS; second store cannot read destroyed session |
| Logout invalidation | Calls `req.session.destroy`; source review only this run |
| Login regeneration | `req.session.regenerate` before saving identity; source review only |
| Reconnection | Query failure propagation tested with fake connection; actual outage/reconnect NOT tested |
| Concurrent sessions | PASS for distinct IDs; same-session concurrent writes are last-write-wins, not merge-safe |
| Pool ownership | PASS; store close leaves shared pool usable; queries return connections through pool |
| Scheduled cleanup | NOT IMPLEMENTED; `SESSION_CLEANUP_INTERVAL_MS` has no active timer |
| Table compatibility | Schema read from actual database; migration uses existing legacy-compatible columns |
| Multi-process | PASS; independent child process reads shared synthetic session |
| HTTP persistence across restart | Previously covered by `testPersistentSessionStore.js`; not rerun here (creates a Developer fixture/starts app) |
| Cookie/proxy | Secure/HttpOnly/lax config tests PASS; actual HTTPS termination NOT tested |

Sessions are database-only, not a static asset. Restrict DB/backup access: session contents are not encrypted at rest by the store. Never export sessions or cookies in evidence. All app workers must share the session secret, cookie name and DB. Use one worker initially: login rate limiting is in-memory and not globally coordinated across workers.

## Target and resources

Proposed topology, not an existing deployment:

`Authorized browser -> HTTPS Nginx -> loopback Node:3001 -> loopback MariaDB`

Choose a Linux VPS rather than shared hosting for reliable process supervision, DB backup access and HTTPS/firewall control. Start with **2 vCPU, 4 GB RAM, 60 GB SSD** for staging, with swap/alerting; this is a capacity estimate, not a measured load certification. Use Ubuntu 24.04 LTS or a maintained equivalent. MariaDB 11.4 matches the tested major/minor; validate the selected patch and SQL/table-name case behavior on Linux. Do not assume every MySQL/MariaDB version is interchangeable.

Node 22 is the locally tested major, not Node 20 from the old guide. Select a maintained security-patched Node 22 build, rerun the Linux suites and record the exact version before acceptance. [Node release guidance](https://nodejs.org/en/about/previous-releases) recommends supported LTS releases for production; installing a newer major is not a substitute for testing.

## Reproducible release procedure (not executed)

Freeze an approved commit plus reviewed changes first; the working tree is dirty. Do not claim `git archive HEAD` includes uncommitted fixes. Build on a trusted Linux build host from the reviewed source. No tarball was generated from this sensitive working directory.

Example explicit runtime allowlist, executed from the clean reviewed tree:

```bash
umask 077
tar --exclude='*.log' --exclude='*.tmp' --exclude='*.sql.gz' \
  --exclude='.env*' --exclude='public/uploads' \
  -czf /secure/waec-rc-runtime.tar.gz \
  package.json package-lock.json server.js config controllers middleware \
  routes services utils validations views database/migrations \
  public/css public/js public/vendor public/images
sha256sum /secure/waec-rc-runtime.tar.gz
tar -tzf /secure/waec-rc-runtime.tar.gz
```

Only reviewed static assets may be under `public/images`. The local review saw the NRA logo and an application SVG there; exclude any additional employee assets introduced later. Inspect the archive and scan source for embedded secrets before release. Exclude all `.env` files, database dumps, exports, employee documents, local logs, node_modules, test accounts/fixtures, screenshots, PDFs and financial audit reports. Transfer the sanitized example and these three deployment guides separately after review. Do not bundle the entire `docs` or `scripts` directories.

On Linux, test `npm ci --omit=dev` in the clean release directory and audit again. Do not copy Windows node_modules: bcrypt contains native/platform-specific components. No lockfile or runtime package was changed here. A clean Linux installation and import-case verification remain acceptance tasks. Reports commonly use browser-print HTML for PDF; do not assume a returned HTML PDF route is a generated PDF binary. Browser Print/PDF inspection on Linux remains mandatory. Playwright is dev-only; install it separately on the isolated test host if needed, not as an unreviewed runtime requirement.

## Database preparation and migration order

Use **`personnel_master_staging`**, not the live `personnel_master`. Import an anonymized, approved copy (including associated media sanitization) or a wholly synthetic baseline preserving legacy schema. Do not copy live sessions or UAT credentials. Never rename legacy tables/columns; preserve PF numbers as strings and leading zeros.

Before migration, inventory schema/engines/indexes; create and verify a backup; restore it to a separate scratch DB. Apply only missing changes with a DBA/migration account while app access is stopped. Existing `IF NOT EXISTS` clauses do not make every ALTER/seed safe or every script fully rerunnable. Review the generation-uniqueness preflights before applying them; stop on duplicates. Do not use a blind loop over all SQL files.

| Order | File under `database/migrations` |
| --- | --- |
| 1 | `20260324-payroll-gl-posting.sql` |
| 2 | `20260324-payroll-gl-posting-seed.sql` (review company/account mappings; do not blindly import live mappings) |
| 3 | `20260711-payroll-workflow.sql` |
| 4 | `20260714-record-workflow.sql` |
| 5 | `20260714-parameter-change-workflow.sql` |
| 6 | `20260714-workflow-notifications.sql` |
| 7 | `20260714-payroll-reversal-workflow.sql` |
| 8 | `20260715-payroll-reopen-workflow.sql` |
| 9 | `20260716-fix-payroll-generation-uniqueness.sql` |
| 10 | `20260821-persistent-session-store.sql` |
| 11 | `20260821-yearly-payment-batches.sql` |

Verify helper tables use InnoDB, required indexes exist, generation keys include CompanyID/period/activity/generation and no duplicates/orphans exist. Archive row counts and migration hashes without confidential row contents. No schema changes were applied here.

## Linux operator guide

1. Provision VPS and non-root `waec` service user. Patch OS, disable direct root/password SSH according to hosting policy, retain a tested recovery login. Keep staging on VPN/IP allowlist until all blockers clear.
2. Install the approved patched Node 22 build, MariaDB 11.4 client/server, Nginx and certificate tooling from trusted sources. Record versions. Do not install an arbitrary new Node major from a convenience script.
3. Create `personnel_master_staging` and dedicated application user limited to `SELECT, INSERT, UPDATE, DELETE` on that DB. Use a separate migration identity for DDL. Enter credentials securely; never put passwords into shell history or this guide. Bind DB to loopback; no public 3306.
4. Prepare reviewed immutable release under `/srv/waec/releases/<release>`, persistent uploads under `/srv/waec/shared/uploads`, and backup directory outside the web root. Install with `npm ci --omit=dev`; test imports on a case-sensitive filesystem. Do not start the app before STG-02 is fixed.
5. Copy sanitized template to the actual project-root `.env`, owner service/deployment user, mode `0600`. Use unique staging secrets, HTTPS base URL and CompanyID-specific users. SMTP is read ONLY from that file; a systemd EnvironmentFile is not a replacement for it. Notification switches retain normal environment precedence. DB legacy names `DBHOST/DBPASS/...` override standard names; avoid defining both families.
6. Configure persistent upload path via a deployment-time symlink to `public/uploads` (same working directory); no UPLOAD_DIR variable is implemented. Do not host real documents until STG-05 is resolved. Set service writable paths narrowly; no chmod 777. Logs and backups are infrastructure configuration, not implemented app variables.
7. Put one Nginx proxy in front of Node; `TRUST_PROXY_HOPS=1`. Forward `Host $host`, `X-Forwarded-Proto $scheme`, `X-Forwarded-For $remote_addr` and `X-Real-IP $remote_addr`; replace untrusted incoming forwarding headers. Proxy to `http://127.0.0.1:3001`. See [Nginx proxy directives](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).
8. Issue a real staging certificate using the host's approved ACME procedure. Redirect HTTP to HTTPS, no preload assumption. Restrict inbound ports to approved SSH sources, 80 and 443; firewall Node 3001 because current `listen(PORT)` does not explicitly bind loopback. Never expose MariaDB.
9. Suggested Nginx upload ceiling is 10 MB, but inspect actual Multer limits and client needs before approval. Send access/error logs to protected rotated files. Redact password-setup query tokens from access logs (log `$uri`, not the full `$request_uri`). Block direct `/uploads/` access as defense in depth; this alone does not implement authenticated document delivery.
10. Create a systemd unit with `User=waec`, `WorkingDirectory=/srv/waec/current`, `ExecStart=/usr/bin/node /srv/waec/current/server.js`, `Environment=NODE_ENV=production`, `Restart=on-failure`, `UMask=0077`, `NoNewPrivileges=true`, stdout/stderr to journald. Adjust Node path to the verified installation. Enable only after release gates. Commands: `systemctl enable --now waec-staging`, `systemctl status waec-staging`, `systemctl restart waec-staging`, `journalctl -u waec-staging`. Graceful drain is not implemented; schedule restarts outside workflow actions until fixed.
11. Review CSRF/header/cookie behavior over real HTTPS: `hrpayroll.sid`, Secure, HttpOnly, SameSite=Lax; invalid mutations must return safe 403. Confirm HSTS and CSP do not block assets. Do not expose cookies in screenshots. Set HTTPS external URL, not localhost, for setup links.
12. Decide SMTP separately for required account email and optional workflow email. Configure `ACCOUNT_EMAIL_ENABLED=true` only when mailbox delivery is approved. Test an authorized recipient, receipt, expiry and resend. If disabled, account setup delivery is blocked and warnings are expected. Do not distribute default passwords.
13. Configure system timezone/`TZ=Africa/Freetown`, then verify stored/displayed dates with MariaDB/session timezone; changing TZ alone does not migrate legacy timestamps. No standalone upload/log/backup variable is validated by startup.
14. Back up DB daily and before updates using a protected client option file (`0600`) outside the web root. Example: `mariadb-dump --defaults-extra-file=/secure/backup.cnf --single-transaction --routines --triggers --events personnel_master_staging > /secure/backups/staging.sql`. [MariaDB dump documentation](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump) limits transactional snapshot consistency to transactional tables: quiesce writes/coordinate locks for MyISAM/Aria, and avoid concurrent DDL.
15. Encrypt backup transport/storage; keep 7 daily/4 weekly copies as a proposed policy for WAEC approval, with an off-server copy. Back up uploads and a separately encrypted environment copy. Assign named restore owner; rehearse restore to a new temporary DB only. Proposed RPO 24h and RTO 4h require WAEC acceptance, not a measured guarantee.
16. Use a systemd timer/cron operated by the DBA for expired-session cleanup: `DELETE FROM sessions WHERE expires < UNIX_TIMESTAMP()` only against the staging DB, after approval. Expired sessions must never authenticate even before cleanup. No scheduler was installed or cleanup command executed here.
17. Monitor service restarts, free memory/disk, DB health/connections, 5xx and backup age. Cap journald storage and configure logrotate for Nginx; scrub auth tokens and secrets. No new monitoring endpoint is needed; `/login` is a basic availability probe, not complete DB/workflow health.
18. Before each update, enter maintenance/VPN restriction, take verified DB/upload backup, review migrations, unpack a new release, install locked dependencies, switch `current` symlink, restart, and run isolated smoke tests. Keep the prior release available.
19. Roll back application by stopping new writes and switching to the prior tested release only if schema compatible. Restore DB only into an isolated recovery DB first; require authorization and reconcile post-backup transactions before any live restore. Never blindly overwrite newer payroll/accounting data.
20. Rehearse crash/restart and recovery on staging, record timings, sessions and backup checks, then obtain WAEC sign-off on the deployed URL. Do not infer readiness from the process starting.

## Deployment configuration validation

The existing validator rejects missing/weak SESSION_SECRET, missing DB host/name/user/password, non-HTTPS APP_BASE_URL, invalid port, missing/invalid TRUST_PROXY_HOPS and missing SMTP fields when explicitly enabled. A synthetic complete config and an empty config were tested through this validator; this was not a full production-mode server boot. It does not yet enforce reset-token secret, safe Developer bootstrap or writable storage. Leave `.env` blank placeholders unfilled until an authorized operator provisions secrets; never log them.

## Next authorization

Resolve STG-01 through STG-06 and retest, then approve a sanitized staging DB/release artifact, target domain and operator. Confirm existing Finance Manager holder identity separately. Complete the staging checklist before changing this BLOCKED status. No August payroll correction sequence is authorized here.
