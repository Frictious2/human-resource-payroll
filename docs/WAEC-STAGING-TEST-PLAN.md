# WAEC HR & Payroll System - Staging Test Plan

Generated: 2026-10-09

## Objective

Validate the application on an online staging server using protected test or anonymized data before public production go-live.

## Entry Criteria

- Dependency vulnerability remediation completed or staging-only risk accepted.
- Staging environment configured with non-production secrets.
- Staging database restored and verified.
- InnoDB enabled.
- Seven active role accounts created.
- Finance Manager account exists.
- HTTPS enabled.

## Test Areas

### Authentication And Roles

- Admin login/logout.
- Data Entry login/logout.
- Finance login/logout.
- Finance Manager login/logout.
- Manager login/logout.
- Auditor login/logout.
- Entity Head/HNO login/logout.
- Unauthorized route probes.
- Cross-role mutation denial.
- Cross-company access denial.

### HR Workflow

- Staff create/edit submission.
- Manager staff review.
- Entitlement submission.
- Entitlement review.
- Salary setup submission.
- Salary approval.
- Rejection/return paths.

### Payroll

- Process Emoluments using safe test period.
- Payroll workflow submission.
- Manager return/approval.
- Auditor review.
- Entity Head/HNO final approval.
- Post to Accounts only for supported salary activity `01`.
- Reversal and reopen only with isolated test data.

### WAEC August 2026

Do not alter batch 161 in staging unless WAEC explicitly authorizes the correction rehearsal.

If authorized:

1. Backup staging DB.
2. Finance submits batch 161.
3. Manager returns it for correction.
4. Finance starts correction.
5. Finance processes August 2026 correction.
6. Verify approved salary totals are used.
7. Do not post to accounts unless separately authorized.

### Reports

- Payslip.
- PAYE.
- EOS Benefit.
- NASSIT Contribution.
- NASSIT Statement.
- Gratuity/Provident Statement.
- Bio Data.
- Journal.
- General Ledger.
- End of Service.
- PDF and Excel export.

### Security

- CSRF valid/missing/invalid token behavior.
- Login rate limit behavior.
- Secure cookie flags.
- CSP/security headers.
- Production error pages.
- Session expiration and logout back-button behavior.

### Backup And Restore

- Create staging database backup.
- Restore into temporary database.
- Verify critical tables and row counts.
- Record restore time.

## Exit Criteria

- No Critical defects.
- No High defects.
- Role smoke tests pass.
- Report/PDF smoke tests pass.
- Backup restore succeeds.
- WAEC signs off staging URL and role coverage.

## Recommended Test Order

1. Environment startup and health.
2. Security headers/session/CSRF.
3. Role logins.
4. Dashboards and navigation.
5. HR approval workflows.
6. Payroll workflows using isolated data.
7. Reports/PDF/Excel.
8. Backup and restore rehearsal.
9. Client acceptance.
