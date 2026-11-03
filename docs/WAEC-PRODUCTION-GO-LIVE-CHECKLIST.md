# WAEC HR & Payroll System - Go-Live Checklist

Generated: 2026-10-09

## Before Staging Upload

- [ ] Patch production dependency vulnerabilities or approve staging-only risk acceptance.
- [ ] Prepare staging server or VPS.
- [ ] Configure staging `.env` with strong non-production secrets.
- [ ] Restore a protected staging database copy.
- [ ] Remove or clearly isolate synthetic test accounts.
- [ ] Create all seven active WAEC role accounts.
- [ ] Verify Finance Manager account exists for CompanyID 1.
- [ ] Verify MariaDB InnoDB support.
- [ ] Run `node scripts/runProductionReadinessChecks.js`.
- [ ] Run authenticated route smoke tests.
- [ ] Run report preview/PDF smoke tests.

## Before Production Go-Live

- [ ] Full database backup completed and verified.
- [ ] Application source backup completed.
- [ ] Environment file backed up securely outside source control.
- [ ] Production `SESSION_SECRET` generated and stored securely.
- [ ] Production DB user configured with least practical privileges.
- [ ] HTTPS certificate installed and valid.
- [ ] Reverse proxy configured with forwarded proto.
- [ ] `TRUST_PROXY_HOPS` matches hosting topology.
- [ ] Secure session cookie verified in browser.
- [ ] SMTP enabled and tested, or explicitly disabled.
- [ ] Production logs and log rotation configured.
- [ ] Backup schedule approved by WAEC.
- [ ] Restore rehearsal completed against a temporary DB.
- [ ] Client representatives sign off on deployed URL.

## Role Acceptance

- [ ] Admin dashboard.
- [ ] Data Entry dashboard and staff/payroll setup.
- [ ] Finance dashboard and payroll workflow.
- [ ] Finance Manager read-only oversight.
- [ ] Manager approval queues.
- [ ] Auditor review queues.
- [ ] Entity Head/HNO final approval queues.

## Payroll Acceptance

- [ ] April 2026 approved salary setup reviewed.
- [ ] Provident Fund 10% employee deduction verified.
- [ ] PAYE statutory calculation accepted.
- [ ] August 2026 batch 161 correction authorization obtained separately.
- [ ] Legacy August GL summary handling approved separately.
- [ ] First live payroll checklist completed by Finance.

## Reports Acceptance

- [ ] Payslip.
- [ ] Payroll summaries.
- [ ] PAYE liabilities.
- [ ] EOS Benefit.
- [ ] NASSIT Contribution.
- [ ] NASSIT Statement.
- [ ] Gratuity/Provident Statement naming confirmed.
- [ ] Bio Data.
- [ ] Journal.
- [ ] General Ledger.
- [ ] PDF generation.
- [ ] Excel export where supported.

## Go / No-Go Rule

Go-live is allowed only when no Critical or High application/security defects remain and operational prerequisites are complete.
