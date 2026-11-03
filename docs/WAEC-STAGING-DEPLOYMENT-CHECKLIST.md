# WAEC Staging Deployment Checklist

Date: 2026-10-09

Status: `READY FOR STAGING DEPLOYMENT`

This checklist is for controlled staging deployment only. It does not authorize production go-live.

## 1. Server Preparation

- [ ] Provision Linux VPS, recommended Ubuntu 22.04 LTS or 24.04 LTS.
- [ ] Allocate at least 2 vCPU, 4 GB RAM and 60 GB SSD.
- [ ] Create a non-root application user.
- [ ] Configure firewall to allow SSH, HTTP and HTTPS only as required.
- [ ] Install Node.js LTS.
- [ ] Install MariaDB.
- [ ] Install Nginx.
- [ ] Configure system timezone.

## 2. Database Preparation

- [ ] Create staging database, preferably `personnel_master_staging`.
- [ ] Create dedicated database user.
- [ ] Grant only required application privileges.
- [ ] Import protected staging data.
- [ ] Apply migration scripts in documented order.
- [ ] Verify key tables exist:
  - `tblstaff`
  - `tblentitle`
  - `tblsalary`
  - `tblpayroll`
  - `tblgltrans`
  - `tblpassword`
  - `sessions`
  - payroll workflow helper tables
  - yearly payment helper tables
- [ ] Verify all staging tables use supported storage engines.
- [ ] Run read-only data checks.

## 3. Application Deployment

- [ ] Upload application source or pull from the approved release branch.
- [ ] Do not upload `.env` from development.
- [ ] Do not upload real database dumps into the web root.
- [ ] Do not upload local logs or temporary files.
- [ ] Ensure `public/uploads` and child upload directories are persistent and writable by the Node process.
- [ ] Run `npm ci --omit=dev`.
- [ ] Run `npm audit --omit=dev`.
- [ ] Confirm zero critical and zero high production vulnerabilities.

## 4. Environment Configuration

- [ ] Create server-side `.env` with staging values only.
- [ ] Set `NODE_ENV=production`.
- [ ] Set `APP_BASE_URL` to the HTTPS staging URL.
- [ ] Set production-style `SESSION_SECRET` using a strong random value.
- [ ] Set database host, port, name, user and password.
- [ ] Set `TRUST_PROXY_HOPS` to match the proxy topology.
- [ ] Decide SMTP enabled or disabled.
- [ ] Configure SMTP only if credentials are available.
- [ ] Configure log location and backup location.
- [ ] Confirm real secrets are not committed or printed.

## 5. Reverse Proxy and HTTPS

- [ ] Configure Nginx virtual host for staging domain.
- [ ] Proxy requests to the Node.js application port.
- [ ] Forward `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.
- [ ] Install TLS certificate.
- [ ] Redirect HTTP to HTTPS.
- [ ] Verify no redirect loop.
- [ ] Verify HSTS appears only over HTTPS production-mode responses.

## 6. Process Management

- [ ] Configure PM2 or systemd service.
- [ ] Ensure app starts after reboot.
- [ ] Configure graceful restart procedure.
- [ ] Configure log rotation.
- [ ] Confirm app refuses startup with unsafe production environment.
- [ ] Confirm app starts with valid staging production-mode environment.

## 7. Finance Manager Provisioning

- [ ] WAEC identifies real Finance Manager account holder.
- [ ] Confirm full name, official email and username.
- [ ] Admin signs into staging.
- [ ] Admin creates Finance Manager via `/admin/finance-managers/new`.
- [ ] Account is scoped to `CompanyID = 1`.
- [ ] Password setup link is delivered or resent after SMTP is configured.
- [ ] Finance Manager sets password.
- [ ] Finance Manager login redirects to `/finance-manager/dashboard`.
- [ ] Verify Finance Manager can view oversight pages.
- [ ] Verify Finance Manager cannot process, approve, post, reverse, reopen, edit or delete operational records.

## 8. Staging Acceptance Tests

- [ ] Admin login and logout.
- [ ] Data Entry login and logout.
- [ ] Finance Officer login and logout.
- [ ] Finance Manager login and logout after provisioning.
- [ ] Manager login and logout.
- [ ] Auditor login and logout.
- [ ] Entity Head/HNO login and logout.
- [ ] Employee registration using isolated staging record.
- [ ] Entitlement setup using isolated staging record.
- [ ] Salary setup using isolated staging record.
- [ ] Manager approval pages render correctly.
- [ ] Payroll calculation test uses isolated staging period only.
- [ ] Payroll reports open and remain CompanyID-scoped.
- [ ] PDF exports generate on Linux server.
- [ ] Excel exports download.
- [ ] CSRF-protected forms submit normally with valid tokens.
- [ ] Missing CSRF token returns safe 403.
- [ ] Login rate limiter is active.
- [ ] Session persists through normal navigation.
- [ ] Logout destroys session.
- [ ] Cross-role route attempts are blocked.
- [ ] Cross-company access attempts are blocked.

## 9. Reports to Check

- [ ] Payslip.
- [ ] Journal.
- [ ] General Ledger.
- [ ] Payroll Liabilities PAYE.
- [ ] Payroll Liabilities EOS Benefit.
- [ ] Payroll Liabilities NASSIT.
- [ ] Staff PAYE Statement.
- [ ] NASSIT Statement.
- [ ] Gratuity Statement.
- [ ] Bio Data.
- [ ] End of Service.

## 10. Backup and Recovery

- [ ] Configure daily staging database backup.
- [ ] Store at least one backup off-server.
- [ ] Verify backup file is readable.
- [ ] Restore backup to an isolated temporary database.
- [ ] Document restore command.
- [ ] Document rollback decision process.
- [ ] Do not restore over active production/live database.

## 11. WAEC August 2026 Payroll Safety

- [ ] Do not modify August batch 161 during staging setup.
- [ ] Do not post August batch 161 to GL.
- [ ] Do not cancel, reopen, reverse or regenerate August payroll without explicit WAEC authorization.
- [ ] Keep the legacy unapproved August GL summary row intact until WAEC authorizes the accounting treatment.
- [ ] If correction rehearsal is authorized, use isolated staging data or a formally approved staging copy.

## 12. Final Staging Gate

Staging is acceptable only when:

- [ ] All seven active roles can log in.
- [ ] Finance Manager account is provisioned and read-only controls are verified.
- [ ] Critical reports render and export.
- [ ] Security controls remain active.
- [ ] Backup restore has been demonstrated.
- [ ] No Critical or High staging defects remain.
- [ ] WAEC approves moving from staging testing toward production planning.

## Final Status

`OVERALL: READY FOR STAGING DEPLOYMENT`

`READY FOR PRODUCTION: NO`

