# PRD-009B Visual UAT

Verification date: Fri, 28 Aug 2026 23:56:58 GMT

## Executive Result

Real rendered browser verification was performed with Chromium via installed Google Chrome channel. The Codex in-app browser bridge was unavailable in this environment, so Chromium/Chrome automation was used to inspect the actual running local application, capture screenshots, and generate print-style PDF evidence from rendered pages.

## Test Environment

| Item | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:3001` |
| Test company | CompanyID 2 |
| Payroll period | 11/2098 |
| Activity | `01` Salary |
| Synthetic staff | 9301, 9302 |
| Browser | Chromium via installed Google Chrome channel |
| Screen sizes | Desktop 1366x768, Tablet 768x1024, Mobile 390x844, selected report/filter desktop checks |

Staff Self-Service remains DEFERRED / OUT OF SCOPE FOR THIS RELEASE.

## Screens Inspected

| Test ID | Role | Route | Screen | Viewport | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| PRD009B-ADMIN-ADMIN-DASHBOARD-DESKTOP | Admin | `/admin/dashboard` | Admin Dashboard | desktop | PASS | docs\test-results\prd009b\admin-admin-dashboard-desktop.png |
| PRD009B-ADMIN-ADMIN-DASHBOARD-TABLET | Admin | `/admin/dashboard` | Admin Dashboard | tablet | PASS | docs\test-results\prd009b\admin-admin-dashboard-tablet.png |
| PRD009B-ADMIN-ADMIN-DASHBOARD-MOBILE | Admin | `/admin/dashboard` | Admin Dashboard | mobile | PASS | docs\test-results\prd009b\admin-admin-dashboard-mobile.png |
| PRD009B-ADMIN-DEPARTMENT-PARAMETER-WORKFLOW-DESKTOP | Admin | `/admin/parameters/departments` | Department Parameter Workflow | desktop | PASS | docs\test-results\prd009b\admin-department-parameter-workflow-desktop.png |
| PRD009B-ADMIN-PARAMETER-CHANGE-QUEUE-DESKTOP | Admin | `/admin/parameter-changes` | Parameter Change Queue | desktop | PASS | docs\test-results\prd009b\admin-parameter-change-queue-desktop.png |
| PRD009B-ADMIN-PROFILE-DESKTOP | Admin | `/profile` | Profile | desktop | PASS | docs\test-results\prd009b\admin-profile-desktop.png |
| PRD009B-ADMIN-NOTIFICATIONS-DESKTOP | Admin | `/notifications` | Notifications | desktop | PASS | docs\test-results\prd009b\admin-notifications-desktop.png |
| PRD009B-ADMIN-WORK-QUEUE-DESKTOP | Admin | `/work-queue` | Work Queue | desktop | PASS | docs\test-results\prd009b\admin-work-queue-desktop.png |
| PRD009B-DATAENTRY-DATA-ENTRY-DASHBOARD-DESKTOP | Data Entry Officer | `/data-entry/dashboard` | Data Entry Dashboard | desktop | PASS | docs\test-results\prd009b\dataEntry-data-entry-dashboard-desktop.png |
| PRD009B-DATAENTRY-DATA-ENTRY-DASHBOARD-TABLET | Data Entry Officer | `/data-entry/dashboard` | Data Entry Dashboard | tablet | PASS | docs\test-results\prd009b\dataEntry-data-entry-dashboard-tablet.png |
| PRD009B-DATAENTRY-DATA-ENTRY-DASHBOARD-MOBILE | Data Entry Officer | `/data-entry/dashboard` | Data Entry Dashboard | mobile | PASS | docs\test-results\prd009b\dataEntry-data-entry-dashboard-mobile.png |
| PRD009B-DATAENTRY-STAFF-BIODATA-FORM-DESKTOP | Data Entry Officer | `/data-entry/staff/new-edit` | Staff Biodata Form | desktop | PASS | docs\test-results\prd009b\dataEntry-staff-biodata-form-desktop.png |
| PRD009B-DATAENTRY-LOAN-SENSITIVE-WORKFLOW-DESKTOP | Data Entry Officer | `/data-entry/welfare/loan` | Loan Sensitive Workflow | desktop | PASS | docs\test-results\prd009b\dataEntry-loan-sensitive-workflow-desktop.png |
| PRD009B-DATAENTRY-BIO-DATA-FILTER-DESKTOP | Data Entry Officer | `/data-entry/reports/bio-data` | Bio Data Filter | desktop | PASS | docs\test-results\prd009b\dataEntry-bio-data-filter-desktop.png |
| PRD009B-DATAENTRY-BIO-DATA-FILTER-MOBILE | Data Entry Officer | `/data-entry/reports/bio-data` | Bio Data Filter | mobile | PASS | docs\test-results\prd009b\dataEntry-bio-data-filter-mobile.png |
| PRD009B-DATAENTRY-NASSIT-GRATUITY-FILTER-DESKTOP | Data Entry Officer | `/data-entry/reports/nassit-grats-statement` | NASSIT/Gratuity Filter | desktop | PASS | docs\test-results\prd009b\dataEntry-nassit-gratuity-filter-desktop.png |
| PRD009B-DATAENTRY-WORK-QUEUE-DESKTOP | Data Entry Officer | `/work-queue` | Work Queue | desktop | PASS | docs\test-results\prd009b\dataEntry-work-queue-desktop.png |
| PRD009B-FINANCE-FINANCE-DASHBOARD-DESKTOP | Finance Officer | `/finance/dashboard` | Finance Dashboard | desktop | PASS | docs\test-results\prd009b\finance-finance-dashboard-desktop.png |
| PRD009B-FINANCE-FINANCE-DASHBOARD-TABLET | Finance Officer | `/finance/dashboard` | Finance Dashboard | tablet | PASS | docs\test-results\prd009b\finance-finance-dashboard-tablet.png |
| PRD009B-FINANCE-FINANCE-DASHBOARD-MOBILE | Finance Officer | `/finance/dashboard` | Finance Dashboard | mobile | PASS | docs\test-results\prd009b\finance-finance-dashboard-mobile.png |
| PRD009B-FINANCE-PROCESS-EMOLUMENTS-DESKTOP | Finance Officer | `/finance/payroll/process-emoluments` | Process Emoluments | desktop | PASS | docs\test-results\prd009b\finance-process-emoluments-desktop.png |
| PRD009B-FINANCE-PAYROLL-WORKFLOW-LIST-DESKTOP | Finance Officer | `/finance/payroll/workflow` | Payroll Workflow List | desktop | PASS | docs\test-results\prd009b\finance-payroll-workflow-list-desktop.png |
| PRD009B-FINANCE-POST-TO-ACCOUNTS-DESKTOP | Finance Officer | `/finance/payroll/post-to-accounts` | Post to Accounts | desktop | PASS | docs\test-results\prd009b\finance-post-to-accounts-desktop.png |
| PRD009B-FINANCE-REVERSAL-REQUESTS-DESKTOP | Finance Officer | `/finance/payroll/reversals` | Reversal Requests | desktop | PASS | docs\test-results\prd009b\finance-reversal-requests-desktop.png |
| PRD009B-FINANCE-REOPEN-REQUESTS-DESKTOP | Finance Officer | `/finance/payroll/reopen` | Reopen Requests | desktop | PASS | docs\test-results\prd009b\finance-reopen-requests-desktop.png |
| PRD009B-FINANCE-YEARLY-PAYMENTS-DESKTOP | Finance Officer | `/finance/payroll/yearly-payments` | Yearly Payments | desktop | PASS | docs\test-results\prd009b\finance-yearly-payments-desktop.png |
| PRD009B-FINANCE-PAYROLL-LIABILITIES-FILTER-DESKTOP | Finance Officer | `/finance/reports/payroll-liabilities` | Payroll Liabilities Filter | desktop | PASS | docs\test-results\prd009b\finance-payroll-liabilities-filter-desktop.png |
| PRD009B-FINANCE-PAYROLL-LIABILITIES-FILTER-MOBILE | Finance Officer | `/finance/reports/payroll-liabilities` | Payroll Liabilities Filter | mobile | PASS | docs\test-results\prd009b\finance-payroll-liabilities-filter-mobile.png |
| PRD009B-FINANCE-JOURNAL-FILTER-DESKTOP | Finance Officer | `/finance/reports/journal` | Journal Filter | desktop | PASS | docs\test-results\prd009b\finance-journal-filter-desktop.png |
| PRD009B-FINANCE-PAYSLIP-FILTER-DESKTOP | Finance Officer | `/finance/reports/payslip` | Payslip Filter | desktop | PASS | docs\test-results\prd009b\finance-payslip-filter-desktop.png |
| PRD009B-FINANCE-END-OF-SERVICE-REPORT-DESKTOP | Finance Officer | `/finance/reports/end-of-service` | End of Service Report | desktop | PASS | docs\test-results\prd009b\finance-end-of-service-report-desktop.png |
| PRD009B-FINANCEMANAGER-FINANCE-MANAGER-DASHBOARD-DESKTOP | Finance Manager | `/finance-manager/dashboard` | Finance Manager Dashboard | desktop | PASS | docs\test-results\prd009b\financeManager-finance-manager-dashboard-desktop.png |
| PRD009B-FINANCEMANAGER-FINANCE-MANAGER-DASHBOARD-TABLET | Finance Manager | `/finance-manager/dashboard` | Finance Manager Dashboard | tablet | PASS | docs\test-results\prd009b\financeManager-finance-manager-dashboard-tablet.png |
| PRD009B-FINANCEMANAGER-FINANCE-MANAGER-DASHBOARD-MOBILE | Finance Manager | `/finance-manager/dashboard` | Finance Manager Dashboard | mobile | PASS | docs\test-results\prd009b\financeManager-finance-manager-dashboard-mobile.png |
| PRD009B-FINANCEMANAGER-PAYROLL-OVERSIGHT-DESKTOP | Finance Manager | `/finance-manager/payroll/workflow` | Payroll Oversight | desktop | PASS | docs\test-results\prd009b\financeManager-payroll-oversight-desktop.png |
| PRD009B-FINANCEMANAGER-YEARLY-PAYMENT-OVERSIGHT-DESKTOP | Finance Manager | `/finance-manager/payroll/yearly-payments` | Yearly Payment Oversight | desktop | PASS | docs\test-results\prd009b\financeManager-yearly-payment-oversight-desktop.png |
| PRD009B-FINANCEMANAGER-REVERSAL-OVERSIGHT-DESKTOP | Finance Manager | `/finance-manager/payroll/reversals` | Reversal Oversight | desktop | PASS | docs\test-results\prd009b\financeManager-reversal-oversight-desktop.png |
| PRD009B-FINANCEMANAGER-REOPEN-OVERSIGHT-DESKTOP | Finance Manager | `/finance-manager/payroll/reopen` | Reopen Oversight | desktop | PASS | docs\test-results\prd009b\financeManager-reopen-oversight-desktop.png |
| PRD009B-FINANCEMANAGER-PAYROLL-LIABILITIES-FILTER-DESKTOP | Finance Manager | `/finance-manager/reports/payroll-liabilities` | Payroll Liabilities Filter | desktop | PASS | docs\test-results\prd009b\financeManager-payroll-liabilities-filter-desktop.png |
| PRD009B-FINANCEMANAGER-GENERAL-LEDGER-DESKTOP | Finance Manager | `/finance-manager/reports/general-ledger` | General Ledger | desktop | PASS | docs\test-results\prd009b\financeManager-general-ledger-desktop.png |
| PRD009B-FINANCEMANAGER-PAYSLIP-FILTER-DESKTOP | Finance Manager | `/finance-manager/reports/payslip` | Payslip Filter | desktop | PASS | docs\test-results\prd009b\financeManager-payslip-filter-desktop.png |
| PRD009B-MANAGER-MANAGER-DASHBOARD-DESKTOP | Manager | `/manager/dashboard` | Manager Dashboard | desktop | PASS | docs\test-results\prd009b\manager-manager-dashboard-desktop.png |
| PRD009B-MANAGER-MANAGER-DASHBOARD-TABLET | Manager | `/manager/dashboard` | Manager Dashboard | tablet | PASS | docs\test-results\prd009b\manager-manager-dashboard-tablet.png |
| PRD009B-MANAGER-MANAGER-DASHBOARD-MOBILE | Manager | `/manager/dashboard` | Manager Dashboard | mobile | PASS | docs\test-results\prd009b\manager-manager-dashboard-mobile.png |
| PRD009B-MANAGER-SENSITIVE-RECORD-QUEUE-DESKTOP | Manager | `/manager/record-workflow` | Sensitive Record Queue | desktop | PASS | docs\test-results\prd009b\manager-sensitive-record-queue-desktop.png |
| PRD009B-MANAGER-PAYROLL-ENDORSEMENT-QUEUE-DESKTOP | Manager | `/manager/payroll/endorsement` | Payroll Endorsement Queue | desktop | PASS | docs\test-results\prd009b\manager-payroll-endorsement-queue-desktop.png |
| PRD009B-MANAGER-REVERSAL-QUEUE-DESKTOP | Manager | `/manager/payroll/reversals` | Reversal Queue | desktop | PASS | docs\test-results\prd009b\manager-reversal-queue-desktop.png |
| PRD009B-MANAGER-REOPEN-QUEUE-DESKTOP | Manager | `/manager/payroll/reopen` | Reopen Queue | desktop | PASS | docs\test-results\prd009b\manager-reopen-queue-desktop.png |
| PRD009B-MANAGER-YEARLY-PAYMENT-QUEUE-DESKTOP | Manager | `/manager/yearly-payments` | Yearly Payment Queue | desktop | PASS | docs\test-results\prd009b\manager-yearly-payment-queue-desktop.png |
| PRD009B-MANAGER-BIO-DATA-REPORT-FILTER-DESKTOP | Manager | `/manager/reports/bio-data` | Bio Data Report Filter | desktop | PASS | docs\test-results\prd009b\manager-bio-data-report-filter-desktop.png |
| PRD009B-AUDITOR-AUDITOR-DASHBOARD-DESKTOP | Auditor | `/auditor/dashboard` | Auditor Dashboard | desktop | PASS | docs\test-results\prd009b\auditor-auditor-dashboard-desktop.png |
| PRD009B-AUDITOR-AUDITOR-DASHBOARD-TABLET | Auditor | `/auditor/dashboard` | Auditor Dashboard | tablet | PASS | docs\test-results\prd009b\auditor-auditor-dashboard-tablet.png |
| PRD009B-AUDITOR-AUDITOR-DASHBOARD-MOBILE | Auditor | `/auditor/dashboard` | Auditor Dashboard | mobile | PASS | docs\test-results\prd009b\auditor-auditor-dashboard-mobile.png |
| PRD009B-AUDITOR-PAYROLL-REVIEW-QUEUE-DESKTOP | Auditor | `/auditor/payroll/review` | Payroll Review Queue | desktop | PASS | docs\test-results\prd009b\auditor-payroll-review-queue-desktop.png |
| PRD009B-AUDITOR-REVERSAL-REVIEW-QUEUE-DESKTOP | Auditor | `/auditor/payroll/reversals` | Reversal Review Queue | desktop | PASS | docs\test-results\prd009b\auditor-reversal-review-queue-desktop.png |
| PRD009B-AUDITOR-REOPEN-REVIEW-QUEUE-DESKTOP | Auditor | `/auditor/payroll/reopen` | Reopen Review Queue | desktop | PASS | docs\test-results\prd009b\auditor-reopen-review-queue-desktop.png |
| PRD009B-AUDITOR-YEARLY-PAYMENT-REVIEW-DESKTOP | Auditor | `/auditor/yearly-payments` | Yearly Payment Review | desktop | PASS | docs\test-results\prd009b\auditor-yearly-payment-review-desktop.png |
| PRD009B-AUDITOR-AUDIT-TRAIL-DESKTOP | Auditor | `/auditor/audit-trail` | Audit Trail | desktop | PASS | docs\test-results\prd009b\auditor-audit-trail-desktop.png |
| PRD009B-ENTITYHEAD-ENTITY-HEAD-DASHBOARD-DESKTOP | Entity Head / HNO | `/entity-head/dashboard` | Entity Head Dashboard | desktop | PASS | docs\test-results\prd009b\entityHead-entity-head-dashboard-desktop.png |
| PRD009B-ENTITYHEAD-ENTITY-HEAD-DASHBOARD-TABLET | Entity Head / HNO | `/entity-head/dashboard` | Entity Head Dashboard | tablet | PASS | docs\test-results\prd009b\entityHead-entity-head-dashboard-tablet.png |
| PRD009B-ENTITYHEAD-ENTITY-HEAD-DASHBOARD-MOBILE | Entity Head / HNO | `/entity-head/dashboard` | Entity Head Dashboard | mobile | PASS | docs\test-results\prd009b\entityHead-entity-head-dashboard-mobile.png |
| PRD009B-ENTITYHEAD-PARAMETER-APPROVAL-QUEUE-DESKTOP | Entity Head / HNO | `/entity-head/parameter-changes` | Parameter Approval Queue | desktop | PASS | docs\test-results\prd009b\entityHead-parameter-approval-queue-desktop.png |
| PRD009B-ENTITYHEAD-SENSITIVE-RECORD-APPROVAL-QUEUE-DESKTOP | Entity Head / HNO | `/entity-head/record-workflow` | Sensitive Record Approval Queue | desktop | PASS | docs\test-results\prd009b\entityHead-sensitive-record-approval-queue-desktop.png |
| PRD009B-ENTITYHEAD-PAYROLL-FINAL-APPROVAL-QUEUE-DESKTOP | Entity Head / HNO | `/entity-head/payroll/approvals` | Payroll Final Approval Queue | desktop | PASS | docs\test-results\prd009b\entityHead-payroll-final-approval-queue-desktop.png |
| PRD009B-ENTITYHEAD-REVERSAL-FINAL-APPROVAL-QUEUE-DESKTOP | Entity Head / HNO | `/entity-head/payroll/reversals` | Reversal Final Approval Queue | desktop | PASS | docs\test-results\prd009b\entityHead-reversal-final-approval-queue-desktop.png |
| PRD009B-ENTITYHEAD-REOPEN-FINAL-APPROVAL-QUEUE-DESKTOP | Entity Head / HNO | `/entity-head/payroll/reopen` | Reopen Final Approval Queue | desktop | PASS | docs\test-results\prd009b\entityHead-reopen-final-approval-queue-desktop.png |
| PRD009B-ENTITYHEAD-YEARLY-PAYMENT-FINAL-APPROVAL-DESKTOP | Entity Head / HNO | `/entity-head/yearly-payments` | Yearly Payment Final Approval | desktop | PASS | docs\test-results\prd009b\entityHead-yearly-payment-final-approval-desktop.png |

## Report Matrix

| Test ID | Role | Route | Report | Browser Preview | Print/PDF | Pagination | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PRD009B-RPT-PAYE | Finance Officer | `/finance/reports/payroll-liabilities/preview?liabilityType=PAYE&fromDate=2098-11-01&toDate=2098-11-30` | PAYE Preview | PASS | PASS | N/A | PASS |
| PRD009B-RPT-EOS | Finance Officer | `/finance/reports/payroll-liabilities/preview?liabilityType=EOS&fromDate=2098-11-01&toDate=2098-11-30` | EOS Benefit Preview | PASS | PASS | N/A | PASS |
| PRD009B-RPT-NASSIT_CONTRIBUTION | Finance Officer | `/finance/reports/payroll-liabilities/preview?liabilityType=NASSIT&fromDate=2098-11-01&toDate=2098-11-30` | NASSIT Contribution Preview | PASS | PASS | N/A | PASS |
| PRD009B-RPT-STAFF_PAYE | Finance Officer | `/finance/reports/payroll-liabilities/staff-preview?pfNo=9301&fromDate=2098-11-01&toDate=2098-11-30` | Staff PAYE Statement | PASS | PASS | N/A | PASS |
| PRD009B-RPT-NASSIT_STATEMENT | Finance Officer | `/finance/reports/nassit-gratuity?run=1&statementType=NASSIT&staffScope=ALL&asAtDate=2098-11-30` | NASSIT Statement | PASS | PASS | N/A | PASS |
| PRD009B-RPT-GRATUITY_STATEMENT | Finance Officer | `/finance/reports/nassit-gratuity?run=1&statementType=GRATUITY&staffScope=ALL&asAtDate=2098-11-30` | Gratuity Statement | PASS | PASS | N/A | PASS |
| PRD009B-RPT-BIO_DATA | Data Entry Officer | `/data-entry/reports/bio-data?run=1&staffScope=ALL&includeDependants=1&reportDate=2098-11-30` | Bio Data All Staff | PASS | PASS | PASS | PASS |
| PRD009B-RPT-JOURNAL | Finance Manager | `/finance-manager/reports/journal` | Journal Filter | PASS | N/A | N/A | PASS |
| PRD009B-RPT-PAYSLIP | Finance Manager | `/finance-manager/reports/payslip` | Payslip Filter | PASS | N/A | N/A | PASS |
| PRD009B-RPT-GL | Finance Manager | `/finance-manager/reports/general-ledger` | General Ledger | PASS | N/A | N/A | PASS |
| PRD009B-RPT-EOS_REPORT | Finance Manager | `/finance-manager/reports/end-of-service` | End of Service | PASS | N/A | N/A | PASS |

## Specific Findings

| Area | Result |
| --- | --- |
| Finance Manager read-only dashboard | PASS |
| Browser console | PASS - no console errors captured during inspected routes |
| CSRF visual regression | PASS - login/logout and rendered protected forms expose CSRF-backed navigation without user-facing token errors |
| Error page readability | PASS |
| PAYE/EOS statutory header | PASS - NRA logo and INCOME TAX DEPARTMENT rendered on PAYE/EOS previews and print-style PDFs |
| NASSIT header | PASS - NASSIT Contribution retained company/NASSIT header, no NRA Income Tax heading |
| Bio Data pagination | PASS - one logical report page per employee in rendered report viewer |
| Print/PDF controls | PASS - generated print PDFs were created from print media with viewer controls hidden |
| Production-mode validator | PASS - safe production fixture validates without exposing secrets |
| Missing production secret startup | PASS - production startup fails clearly with `SESSION_SECRET is required` before session-store initialization |

## Defects

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
| - | - | No Critical or High visual defects found in automated browser pass | CLOSED |

## Operational Conditions

- Configure real production `SESSION_SECRET`, database credentials, HTTPS base URL, and explicit proxy hop count during deployment.
- Apply final migrations only after a verified `personnel_master` backup.
- SMTP delivery remains optional unless email notifications are explicitly enabled with valid credentials.
- Keep Staff Self-Service out of the active release scope until a future approved phase implements it.

## PRD-009B Status

PRD-009B STATUS: PASS

## Final PRD-009 Verdict

FINAL VERDICT: PRODUCTION READY WITH CONDITIONS

Conditions are operational deployment prerequisites only: configure real production secrets and DB credentials, verify HTTPS/proxy settings, take final backups, confirm SMTP posture, and perform final client signoff on the deployed URL.
