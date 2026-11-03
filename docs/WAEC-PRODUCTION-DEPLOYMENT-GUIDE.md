# WAEC HR & Payroll System - Production Deployment Guide

Generated: 2026-10-09

## Recommended Hosting

Recommended target: **Linux VPS or dedicated server**.

Shared hosting with Node.js support is not recommended for first production go-live because this system requires persistent MariaDB sessions, controlled backups, secure reverse proxy configuration, potentially large PDF/report generation, payroll workflow reliability, and predictable process management.

## Minimum Platform

| Component | Recommendation |
| --- | --- |
| Node.js | Current tested LTS/modern Node compatible with Express 5 |
| Database | MariaDB 11.x or MySQL 8-compatible |
| RAM | 2 GB minimum, 4 GB preferred |
| CPU | 2 vCPU preferred |
| Storage | SSD, with separate backup storage |
| Process manager | PM2 or systemd |
| Reverse proxy | Nginx or Apache |
| HTTPS | Required |

## Deployment Architecture

Browser -> HTTPS -> Reverse proxy -> Node.js application -> MariaDB

The reverse proxy must pass:

- `Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto`

Set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops, commonly `1` for Nginx or Apache in front of Node.

## Environment Variables

Use `.env.production.example` as a template only. Do not commit real secrets.

Required production variables:

```text
NODE_ENV=production
PORT=3001
APP_BASE_URL=https://your-waec-hr-domain.example
DB_HOST=
DB_PORT=3306
DB_NAME=personnel_master
DB_USER=
DB_PASSWORD=
SESSION_SECRET=
SESSION_COOKIE_NAME=hrpayroll.sid
SESSION_MAX_AGE_MS=28800000
SESSION_CLEANUP_INTERVAL_MS=900000
TRUST_PROXY_HOPS=1
LOGIN_RATE_LIMIT_MAX=20
LOGIN_RATE_LIMIT_WINDOW_MS=900000
EMAIL_NOTIFICATIONS_ENABLED=false
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
```

Generate `SESSION_SECRET` during deployment, for example:

```bash
openssl rand -base64 48
```

Never place the real secret in source control, screenshots, documentation, or logs.

## Database Preparation

1. Create a full backup before migration or deployment.
2. Verify the dump contains critical legacy tables:
   - `tblstaff`
   - `tblsalary`
   - `tblpayroll`
   - `tblentitle`
   - `tbltax`
   - `tblpayrollitems`
   - `tblparams1`
   - `tblgltrans`
   - `tblaudittrail`
3. Verify modernization/helper tables:
   - `sessions`
   - `payroll_workflow_batches`
   - `payroll_workflow_actions`
   - `workflow_notifications`
   - `record_workflow_items`
   - `record_workflow_actions`
   - `parameter_change_requests`
   - `payroll_gl_posting_batches`
   - `payroll_gl_posting_lines`
   - `payroll_reversal_requests`
   - `payroll_reopen_requests`
   - `yearly_payment_batches`
4. Verify InnoDB is available using `SHOW ENGINES`.
5. Apply migrations deliberately; do not rely on runtime DDL.

## Install And Start

```bash
npm ci --omit=dev
NODE_ENV=production node server.js
```

For production, run under PM2 or systemd rather than an interactive terminal.

## Reverse Proxy Checklist

- Proxy HTTPS traffic to the Node port.
- Preserve forwarded headers.
- Configure upload/request body limits if document uploads are enabled.
- Redirect HTTP to HTTPS.
- Avoid redirect loops.
- Confirm HSTS only after HTTPS is correct.

## SMTP

Choose one:

1. SMTP enabled: configure SMTP host, port, TLS, username, password, and sender; send a test email.
2. SMTP disabled: set `EMAIL_NOTIFICATIONS_ENABLED=false`; in-app notifications remain available.

Do not leave partially configured SMTP credentials.

## Security Verification

After deployment verify:

- Login works.
- Logout destroys session.
- Session cookie is `HttpOnly`, `Secure`, and `SameSite=Lax`.
- CSRF rejects missing/invalid tokens.
- Login rate limiting is active.
- CSP/security headers are present.
- `X-Powered-By` is absent.
- Production startup refuses unsafe/missing `SESSION_SECRET`.

## WAEC Payroll Deployment Constraint

Do not correct August 2026 batch 161 during deployment. That action requires separate explicit payroll authorization and a fresh backup.

## Rollback

Use `docs/DEPLOYMENT-ROLLBACK-PLAN.md` for detailed rollback. In short:

1. Stop user access or enable maintenance mode.
2. Stop the Node process.
3. Restore previous source release if application rollback is required.
4. Restore DB only if no live payroll/approval transactions occurred after the backup, or if WAEC authorizes data-loss implications.
5. Smoke-test authentication, dashboards, and reports before reopening.
