# Client Go-Live Acceptance

Release: `v1.0.0`

Acceptance date: PENDING

Production URL: PENDING

Staff Self-Service: Deferred / out of scope for Release 1.0

## Client Role Sign-Off

| Area | Client representative | Date | Result | Notes / Outstanding observations |
| --- | --- | --- | --- | --- |
| Administration | PENDING | PENDING | PENDING | User setup and parameter proposal workflow |
| HR / Data Entry | PENDING | PENDING | PENDING | Staff records and sensitive-record submissions |
| Finance | PENDING | PENDING | PENDING | Payroll, posting, reports, reversal/reopen entry points |
| Finance Manager | PENDING | PENDING | PENDING | Read-only payroll/yearly-payment/report oversight |
| Manager | PENDING | PENDING | PENDING | Endorsement queues and returned-item visibility |
| Auditor | PENDING | PENDING | PENDING | Audit review queues and audit trail |
| Entity Head / HNO | PENDING | PENDING | PENDING | Final approvals for payroll, parameter, sensitive-record, reversal, reopen and yearly payments |

## Acceptance Checklist

| ID | Check | Expected result | Client result | Notes |
| --- | --- | --- | --- | --- |
| GO-LIVE-001 | Production URL opens over HTTPS | Login page loads securely without certificate warning | PENDING |  |
| GO-LIVE-002 | Login for each active role | Correct dashboard appears for each user | PENDING |  |
| GO-LIVE-003 | Logout | Session ends; back/refresh does not expose protected content | PENDING |  |
| GO-LIVE-004 | Role navigation | Sidebar/topbar/profile/notifications are visible and appropriate per role | PENDING |  |
| GO-LIVE-005 | Finance Manager oversight | Finance Manager sees read-only payroll/yearly/report information and no action buttons | PENDING |  |
| GO-LIVE-006 | Data Entry staff lookup | Staff search/detail pages are company-scoped and usable | PENDING |  |
| GO-LIVE-007 | Parameter proposal | Admin creates proposal; HNO sees proposed/current values and can approve/return/reject | PENDING | Use safe non-critical test parameter if needed |
| GO-LIVE-008 | Sensitive-record workflow | Data Entry submits; Manager endorses/returns; HNO final approves/returns/rejects | PENDING | Use safe test record |
| GO-LIVE-009 | Payroll workflow visibility | Finance sees payroll workflow; Manager/Auditor/HNO queues show proper stages | PENDING | Non-destructive review unless approved |
| GO-LIVE-010 | Post to Accounts scope | Activity `01 = Salary` is supported; unsupported activities cannot be posted | PENDING | Do not post live payroll during acceptance unless approved |
| GO-LIVE-011 | Reversal/reopen visibility | Historical reversal/reopen records are visible and read-only where appropriate | PENDING | Do not execute live reversal for acceptance |
| GO-LIVE-012 | Yearly payments | Rent, Inducement and Leave batch pages are visible to Finance/workflow roles | PENDING | Do not authorize duplicate real annual payment |
| GO-LIVE-013 | PAYE report | Preview/PDF/export work; NRA header renders | PENDING | Use safe/reportable data |
| GO-LIVE-014 | EOS Benefit report | Preview/PDF/export work; NRA header renders | PENDING | Use safe/reportable data |
| GO-LIVE-015 | NASSIT Contribution report | Preview/PDF/export work; company header renders | PENDING |  |
| GO-LIVE-016 | Staff PAYE Statement | PFNo validation, preview and PDF work | PENDING |  |
| GO-LIVE-017 | NASSIT/Gratuity Statements | Statement type, date and staff filters work | PENDING |  |
| GO-LIVE-018 | Bio Data report | All-staff/single-staff modes and dependants option work | PENDING |  |
| GO-LIVE-019 | Journal/Payslip/General Ledger/End of Service | Reports open, filter and print/PDF where supported | PENDING |  |
| GO-LIVE-020 | Company branding | `tblcominfo` name/address/logo/contact/TIN are correct on pages/reports | PENDING |  |
| GO-LIVE-021 | Security behavior | Missing-token action returns safe 403; invalid login/rate-limit message is safe | PENDING | Controlled test only |
| GO-LIVE-022 | Company isolation | Users do not see another company's data by URL/form tampering | PENDING | Use safe two-company test accounts |

## First Live Payroll Checklist

Before the first real Process Emoluments run, Finance and HR must confirm:

- active employee master data
- salary values
- entitlement flags
- grades and job titles
- pay type `01 = Salary`
- tax setup
- NASSIT numbers
- bank details
- loan deductions
- medical recoveries
- surcharge deductions
- leave/acting/increment inputs
- payroll month/year
- company GL mappings for salary posting

Before the first live Post to Accounts:

- payroll is `FINAL_APPROVED`
- activity is `01 = Salary`
- generation is the intended active generation
- debit total equals credit total
- posting journal preview is reviewed by Finance

Do not test reversal on real payroll merely for confidence. Use reversal only for a genuine approved business correction.

## Acceptance Statement

The client confirms that Release `v1.0.0` has been reviewed on the deployed production URL and is accepted for go-live subject to any observations recorded above.

Client signatory: ______________________________

Role/title: ____________________________________

Date: _________________________________________

Implementation signatory: ______________________

Date: _________________________________________
