# WAEC cPanel Staging Installation

Prepared: 2026-11-10 UTC. This is a **synthetic standalone staging package**, not a production database backup. No deployment has been performed.

## Package and supported baseline

Archive: `deploy/waec-cpanel-staging.zip`. Verify its SHA-256 against `deploy/waec-cpanel-staging.manifest.json` before transfer/extraction. The archive has a root `DEPLOYMENT-MANIFEST.json` with per-file hashes. Build with `node scripts/buildCpanelStagingPackage.js`; it reads source metadata and approved configuration in a read-only database transaction. File ordering, ZIP timestamps and compression are fixed, so unchanged inputs produce identical bytes.

| Item | Requirement |
| --- | --- |
| Hosting | Owner-confirmed CloudLinux **Setup Node.js App** on cPanel/WHM; actual host acceptance pending |
| Node | Node.js 22; locally verified on 22.19.0. Select the host's supported/patched Node 22 release and record its exact version |
| Database | Tested baseline MariaDB 11.4.9 with InnoDB; use a provider-supported compatible 11.4 deployment or prove compatibility on the actual provided version. MySQL or another MariaDB release is not certified by the Windows tests |
| Startup | `app.js`, one managed listener, existing graceful-shutdown handler |
| URL | Dedicated HTTPS subdomain at `/`; arbitrary subdirectory hosting is not certified |
| Company | Server-side `INSTALLATION_COMPANY_ID=1`, separate application/database/users/storage |
| Dependencies | Exact lockfile, `npm ci --omit=dev` on Linux; never copy Windows `node_modules` |
| Storage | Private writable upload root outside every document root; no real employee files in this package |

Passenger manages the first HTTP listener through reverse port binding; no public application port is required. Plain Node respects `PORT` when supplied and production defaults to a loopback host. Do not launch an extra `npm start` process alongside Passenger. See [Passenger listener behavior](https://www.phusionpassenger.com/docs/advanced_guides/in_depth/node/reverse_port_binding.html) and [CloudLinux Node.js Selector documentation](https://docs.cloudlinux.com/cloudlinuxos/lve_manager/).

## Archive contents and exclusions

Included: application JS in `config/controllers/middleware/routes/services/utils/validations`, required EJS views, safe CSS/JS/vendor assets, `hr-vector.svg`, authoritative `nra-logo.jpg`, package/lock files, `app.js`, `server.js`, blank `.env.staging.example`, initialization/check scripts, table-only `database/staging/schema.sql`, allowlisted payroll configuration JSON, runtime-required migration SQL files, and these two installation/acceptance documents.

The schema snapshot includes legacy CompanyID columns and current modernization helper/session/generation tables. It contains **no live rows**. Configuration JSON contains only Company 1 Payroll Items, pay types and Tax Table definitions; NASSIT 32/41 and PROV-EMP 33 definitions are preserved. Legacy AllwThreshold metadata remains, but the existing canonical monthly PAYE service does not deduct it. Nothing changes verified formulas.

Excluded: populated `.env`, credentials/password hashes/tokens/keys, `node_modules`, `.git`, backups/dumps, employee documents/images, `public/uploads`, private folders, spreadsheets/payroll/PDF exports, logs, temporary workspaces, historical UAT evidence and test scripts with preset credentials. Only reviewed payroll configuration rows are included, never `tblstaff`, `tblsalary`, `tblpayroll`, accounts, sessions or GL row exports.

## Installation steps

1. **Create a staging subdomain.** In cPanel Domains, create the approved staging name with a dedicated document root. Do not reuse the live payroll URL or an unrelated PHP/WordPress document root. Keep access restricted while configuring it. Obtain deployment authorization; this guide is not automatic authorization.
2. **Enable HTTPS.** Issue/verify the provider certificate, certificate chain and hostname. Enable HTTP-to-HTTPS redirection without loops. Record the actual proxy chain and confirm client-supplied forwarded headers cannot bypass it.
3. **Create the Node application.** Open Setup Node.js App, select Node 22 and Production mode. Set application root such as `/home/ACCOUNT/apps/waec-staging`, application URL to the approved subdomain root, and startup file `app.js`. Do not expose the application root as a static document root. Pause the app until configuration/schema are ready.
4. **Upload the ZIP privately.** Use protected File Manager/SFTP. Upload outside `public_html`; never upload live database dumps or a populated environment file with the archive.
5. **Extract at the application root.** `app.js` and `package.json` must be directly in that root, not in an extra nested folder. Remove the uploaded transfer copy from web-accessible locations if applicable; do not delete unrelated host files. Retain the reviewed release backup privately.
6. **Install dependencies.** Use the activation command displayed by Setup Node.js App; do not guess its virtual-environment path. Verify `node --version` and `npm --version`, then run `npm ci --omit=dev`. Request provider help if the selected environment cannot install bcrypt. Do not run forced dependency upgrades.
7. **Create a separate database.** In MySQL Database Wizard create a database ending in `_waec_staging` (a cPanel account prefix is expected) and a dedicated non-root user. Grant privileges only on that staging database. Confirm InnoDB is enabled. Never select `personnel_master` or `personnel_master_staging`; the initializer refuses names containing `personnel_master`.
8. **Configure the environment privately.** Copy `.env.staging.example` to application-root `.env`; replace ACCOUNT placeholders, DB settings and exact HTTPS APP_BASE_URL. Generate independent strong SESSION_SECRET and RESET_TOKEN_SECRET securely on the host; do not put values in documentation or screenshots. Protect `.env` with 0600 permissions and ensure Apache cannot serve it. Set NODE_ENV=production and installation CompanyID=1. Other non-SMTP settings may come from the application manager, but conflicting DB aliases are rejected by setup. SMTP is deliberately `.env`-only.
9. **Prepare private storage.** Set an absolute `PRIVATE_UPLOAD_DIR`, for example `/home/ACCOUNT/waec-staging-private/uploads`, outside every domain document root. The initializer prepares `staff_photos`, `medical_receipts` and `logos` with 0700 directory modes. New upload files use 0600. Confirm the process account owns these directories and no symlink leads into a public root. Existing WAEC migration is NOT executed.
10. **Import schema and seed synthetic fixtures.** Use the guarded command below, with STAGING_DB_NAME matching DB_NAME exactly. It requires an empty database, creates table definitions without drops, and refuses to seed any non-empty table. Table DDL is outside the fixture transaction. A failed import may leave empty tables; inspect the error and recreate ONLY the dedicated disposable staging database through hosting administration if necessary. Never repair by running a broad drop/delete script. Do not blindly run older migrations after the complete schema snapshot.
11. **Keep sessions persistent.** The imported schema includes the InnoDB `sessions` table, primary key and expiration index. The existing store uses it, schedules bounded expired-session cleanup, and refuses missing schema. Cleanup timers run only while Passenger workers are alive; expiry checks still reject expired sessions on read. Confirm provider idle/restart behavior.
12. **Start through the hosting manager.** Return STAGING_SETUP_ENABLED to false, then use Setup Node.js App Start/Restart. Do not run the initializer at startup. It never provisions default users or resets passwords automatically. Production startup rejects missing/unsafe secrets and invalid configuration.
13. **Check liveness and DB access.** Open HTTPS `/login`: it should render, not return a Passenger error. There is no dedicated public health endpoint in this release; do not invent a URL or expose DB metadata. Use the guarded read-only CLI check below for DB identity/InnoDB/session/calculation checks. Its temporary setup flag permits verification, not a data reset.
14. **Test login.** Log in using operator-chosen synthetic credentials. The seven usernames are listed below; no default password exists. Verify dashboard routing, CSRF-protected logout and rejection of foreign-company identities. Do not create or use real WAEC employee accounts for staging.
15. **Check secure cookies/proxy.** In a real browser verify `hrpayroll.sid` is Secure, HttpOnly and SameSite=Lax. Configure TRUST_PROXY_HOPS only after the provider confirms the exact chain. Inspect CSP/HSTS/frame/MIME/referrer headers and ensure X-Powered-By is absent. No development/Passenger-friendly error details may be publicly exposed.
16. **Review pending employee and salary fixtures.** Log in as Manager and review/approve only S001/S002 staff, entitlement and salary entries through the normal UI. Their source approval states are pending after initialization, with no fabricated approval timestamps. Check stored salary controls before and after approval; investigate any discrepancy rather than changing tax rules to fit it.
17. **Process synthetic payroll only.** As Finance select Salary activity 01 and August **2098**, never August 2026 or batch 161. Run Process Emoluments after required approvals. Confirm two employees, Generation 1, PROCESSED status and the controls below. Follow Finance submission, Manager endorsement, Auditor review and Entity Head approval using the normal application. Do not directly set approval flags. GL posting tests require approved synthetic mappings and Salary 01; test unsupported/unauthorized posting denials without posting real data.
18. **Test reports/exports.** Inspect payslips, Journal, GL safeguards, PAYE/NASSIT/EOS and other agreed reports against the synthetic payroll. Open actual PDFs/browser print output and Excel exports; HTTP 200 alone is insufficient. Confirm `/images/nra-logo.jpg` loads over HTTPS and controls/sidebar are absent from print/PDF output. See the acceptance matrix.
19. **Test private uploads.** Upload a generated non-sensitive image through the authorized form, inspect authorized download and anonymous/wrong-role/foreign-company denial. Confirm Apache does not serve `/uploads/...` directly. Do not copy existing WAEC photos or medical receipts. Test `.env`, source, manifests, dumps and private paths cannot be downloaded; the archive/SQL/config artifacts must not reside in a static web root.
20. **Restart and recheck.** Use the hosting manager restart control while no payroll transaction is active. Verify application availability, DB reconnection, session survival, logout invalidation and cleanup/log behavior. Check protected logs and configured retention. Complete client/stakeholder acceptance before wider exposure.

### Guarded commands (host terminal, activated Node environment)

```sh
# Only after populating .env for the EMPTY dedicated staging DB:
STAGING_SETUP_ENABLED=true node scripts/initializeCpanelStaging.js --schema --seed
# Seven passwords are entered through hidden terminal prompts, not command arguments.
# STAGING_DB_NAME in .env must match DB_NAME; leave setup disabled normally.
STAGING_SETUP_ENABLED=true node scripts/checkCpanelStaging.js
```

For a controlled automation runner, `--passwords-stdin` accepts a JSON object through a private stdin pipe with keys `admin`, `data_entry`, `finance`, `finance_manager`, `manager`, `auditor`, `entity_head`. Do not create a plaintext password file, paste that object into shell history or retain it in logs. Seven different strong values are mandatory. No reusable passwords or hashes are distributed in the package.

The initializer inserts fixed synthetic account roles and pending fixtures **only into an explicitly enabled, empty staging database**. This is an operator-invoked staging bootstrap, not privileged seeding during production startup. It cannot be rerun to reset accounts or overwrite existing data. It does not send emails. Synthetic addresses end in `example.test` and are intentionally nondeliverable.

### Synthetic controls

| PF | Basic | Allowances | Taxable after employee NASSIT | PAYE | Employee NASSIT | Employer NASSIT | PROV-EMP / GratEmp | Total deductions | Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| S001 | 1,000.00 | 0 | 950.00 | 52.50 | 50.00 | 100.00 | 100.00 | 202.50 | 797.50 |
| S002 | 2,000.00 | 0 | 1,900.00 | 235.00 | 100.00 | 200.00 | 200.00 | 535.00 | 1,465.00 |
| Total | 3,000.00 | 0 | 2,850.00 | 287.50 | 150.00 | 300.00 | 300.00 | 737.50 | 2,262.50 |

Accounts: `staging_admin`, `staging_data_entry`, `staging_finance`, `staging_finance_manager`, `staging_manager`, `staging_auditor`, `staging_entity_head`. Their chosen passwords exist only as hashes in the staging DB. All fixtures are visibly synthetic; monthly `tblpayroll` rows are created by Process Emoluments, not by pretending initialization approvals occurred. The two initialized payroll rows have PMonth/PYear=0 and are master rows, not processed monthly payroll.

## SMTP and logging

Email is disabled by default. Populate SMTP_* only in the private `.env`, set the intended enable flags explicitly, and verify the provider's TLS/port details. A real test message requires an explicitly approved recipient and one-send limit; no recipient is embedded and no message is sent by initialization/check scripts. Never copy development mailbox credentials into an archive.

Logs use stdout/stderr managed by Passenger/CloudLinux, not a fictional LOG_DIR setting. Ask the provider for the protected log path, rotation, retention and access controls. The app omits credential/session values from security event payloads. Environment/DB details from an error must never be returned publicly. Protect backup storage and arrange encrypted off-server retention plus an isolated restore test.

## Rollback and permissions

Keep a verified application/configuration backup and database/file backup before any future update. Restrict directories and files to the account that needs them; never use 0777. Back up private uploads separately. Pause user activity before restart/migrations, and let active transactions drain. Restore the previous compatible application/configuration first if smoke tests fail. Database restoration requires explicit authorization and a data-loss assessment; never restore over live WAEC or delete payroll to make a rollout convenient.

This package is not authorization to migrate real files, deploy publicly, approve real payroll or change any production record. Actual cPanel, HTTPS/proxy, Linux permissions, report/PDF/Excel and restart acceptance remains **NOT YET TESTED**.
