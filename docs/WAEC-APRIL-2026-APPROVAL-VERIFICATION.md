# WAEC April 2026 Salary Review - Approval Verification

Generated: 2026-10-09

## Scope

This verification was read-only.

No employee records, entitlement records, salary records, August 2026 payroll rows, GL records, workflow records, or historical payroll records were changed.

Company: CompanyID 1

Employees verified:

- 0489 - Matilda Jusu
- 0496 - Festus C. Campbell
- 0692 - Georgiana James
- 0520 - Abass P. Renner
- 0684 - Chernor Sankoh
- 0587 - Basiru A. Waheed Sawyer

## Executive Result

| Requirement | Result | Finding |
| --- | --- | --- |
| Six `tblstaff` records approved | PASS | All six records have `Approved = 1`, `ApprovedBy = Manager`, and approval timestamps. |
| Six `tblentitle` records approved | PASS | All six records have `Approved = -1`, `ApprovedBy = Manager`, and approval timestamps. |
| Six `tblsalary` records approved | PASS | All six records have `Approved = -1`, `ApprovedBy = Manager`, and approval timestamps. |
| CompanyID isolation | PASS | All approved staff, entitlement, and salary records belong to CompanyID 1. |
| Salary setup totals | PASS | Approved totals exactly match expected system totals. |
| Excel earnings comparison | PASS WITH PAYE NOTE | Earnings and taxable income match the August Excel reference within rounding. PAYE remains higher by the separately documented statutory PAYE difference. |
| August payroll batch 161 unchanged | PASS | Batch 161 remains `PROCESSED`; six August rows retain previous totals. |
| August batch not posted to GL | PASS WITH LEGACY NOTE | Modern posting flags and posting-batch table show not posted. A legacy unapproved `tblgltrans` summary row exists for August 2026. |
| Audit trail | INCOMPLETE | Staff approval audit rows exist. Entitlement and salary approval timestamps exist, but no matching `tblaudittrail` rows were found for those approval actions. |

## Approval State

### Staff Records

| PFNo | Name | CompanyID | Approved | Approved By | Approved At | Grade | GradeCode | Notch | JobTitle |
| --- | --- | ---: | ---: | --- | --- | --- | --- | ---: | --- |
| 0489 | Matilda Jusu | 1 | 1 | Manager | 2026-10-08 22:56:53 | 0100 | 0100 | 1 | 0101 |
| 0496 | Festus C. Campbell | 1 | 1 | Manager | 2026-10-08 22:57:59 | 0400 | 0400 | 4 | 0401 |
| 0692 | Georgiana James | 1 | 1 | Manager | 2026-10-08 22:57:36 | 0600 | 0600 | 3 | 0601 |
| 0520 | Abass P. Renner | 1 | 1 | Manager | 2026-10-08 22:57:13 | 0700 | 0700 | 9 | 0701 |
| 0684 | Chernor Sankoh | 1 | 1 | Manager | 2026-10-08 22:56:33 | 0600 | 0600 | 1 | 0601 |
| 0587 | Basiru A. Waheed Sawyer | 1 | 1 | Manager | 2026-10-08 22:56:04 | 1000 | 1000 | 4 | 1002 |

### Entitlement Records

| PFNo | CompanyID | Approved | Approved By | Approved At | Salary | Transport `Allw03` | COLA `Allw06` | Staff Welfare `Allw07` | Maintenance `Allw10` | Responsibility `Allw11` | Maid `Allw12` | Acting `Allw14` | Professional `Allw16` | Risk `Allw17` | Academic `Allw19` |
| --- | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0489 | 1 | -1 | Manager | 2026-10-09 11:04:08 | -1 | -1 | -1 | -1 | -1 | -1 | -1 | 0 | -1 | -1 | 0 |
| 0496 | 1 | -1 | Manager | 2026-10-09 11:01:50 | -1 | -1 | -1 | 0 | -1 | -1 | -1 | -1 | -1 | -1 | 0 |
| 0692 | 1 | -1 | Manager | 2026-10-09 11:00:18 | -1 | -1 | -1 | 0 | -1 | -1 | -1 | -1 | -1 | -1 | 0 |
| 0520 | 1 | -1 | Manager | 2026-10-09 11:00:08 | -1 | -1 | -1 | 0 | -1 | -1 | -1 | -1 | -1 | -1 | 0 |
| 0684 | 1 | -1 | Manager | 2026-10-09 10:59:58 | -1 | -1 | -1 | 0 | -1 | -1 | -1 | -1 | -1 | -1 | 0 |
| 0587 | 1 | -1 | Manager | 2026-10-09 10:59:41 | -1 | 0 | -1 | 0 | -1 | 0 | 0 | -1 | 0 | 0 | 0 |

### Salary Records

| PFNo | CompanyID | Approved | Approved By | Approved At | PDate | Grade | JobTitle | Basic Salary | Transport | COLA | Staff Welfare | Maintenance | Responsibility | Maid | Acting | Professional | Risk | Academic |
| --- | ---: | ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0489 | 1 | -1 | Manager | 2026-10-09 11:11:45 | 2026-04-01 | 0100 | 0101 | 16,202.12 | 8,190.00 | 750.00 | 3,000.00 | 4,411.09 | 3,240.42 | 3,240.42 | 0.00 | 1,620.21 | 810.11 | 0.00 |
| 0496 | 1 | -1 | Manager | 2026-10-09 11:11:38 | 2026-04-01 | 0400 | 0401 | 9,857.49 | 4,095.00 | 450.00 | 0.00 | 360.00 | 1,971.50 | 1,971.50 | 3,548.70 | 985.75 | 492.87 | 0.00 |
| 0692 | 1 | -1 | Manager | 2026-10-09 11:10:16 | 2026-04-01 | 0600 | 0601 | 7,180.72 | 4,095.00 | 450.00 | 0.00 | 360.00 | 1,436.14 | 1,436.14 | 2,585.06 | 718.07 | 359.04 | 0.00 |
| 0520 | 1 | -1 | Manager | 2026-10-09 11:09:42 | 2026-04-01 | 0700 | 0701 | 6,856.42 | 4,095.00 | 450.00 | 0.00 | 360.00 | 1,371.28 | 1,371.28 | 2,468.31 | 685.64 | 342.82 | 0.00 |
| 0684 | 1 | -1 | Manager | 2026-10-09 11:08:45 | 2026-04-01 | 0600 | 0601 | 6,918.19 | 4,095.00 | 450.00 | 0.00 | 360.00 | 1,383.64 | 1,383.64 | 2,490.55 | 691.82 | 345.91 | 0.00 |
| 0587 | 1 | -1 | Manager | 2026-10-09 11:08:31 | 2026-04-01 | 1000 | 1002 | 3,825.75 | 0.00 | 300.00 | 0.00 | 191.29 | 0.00 | 0.00 | 4,095.00 | 0.00 | 0.00 | 0.00 |

## Approved Salary Totals

| Component | Expected | Approved `tblsalary` | Difference |
| --- | ---: | ---: | ---: |
| Basic Salary | 50,840.69 | 50,840.69 | 0.00 |
| Allowances | 77,508.20 | 77,508.20 | 0.00 |
| Gross Income | 128,348.89 | 128,348.89 | 0.00 |
| Taxable Income | 125,806.85 | 125,806.85 | 0.00 |
| PAYE | 35,582.06 | 35,582.06 | 0.00 |
| Employee NASSIT | 2,542.04 | 2,542.04 | 0.00 |
| Net Income | 85,140.72 | 85,140.72 | 0.00 |

## Excel Reference Comparison

The approved salary setup matches the August 2026 Excel earnings reference for basic salary, allowances, gross income, and taxable income within the established NLe0.01 rounding tolerance.

The PAYE difference remains the previously documented statutory PAYE variance. The approved setup uses the corrected Sierra Leone PAYE calculation and was not altered to reproduce the lower workbook PAYE.

| PFNo | Gross Variance vs Excel | Taxable Variance vs Excel | PAYE Variance vs Excel | Net Variance vs Excel |
| --- | ---: | ---: | ---: | ---: |
| 0489 | 0.00 | 0.00 | 150.00 | -150.00 |
| 0496 | 0.00 | 0.00 | 150.00 | -150.00 |
| 0692 | -0.01 | -0.01 | 150.00 | -150.01 |
| 0520 | -0.01 | -0.01 | 150.00 | -150.01 |
| 0684 | 0.01 | 0.01 | 150.00 | -149.99 |
| 0587 | 0.00 | 0.01 | 150.01 | -150.01 |

## Audit Trail Verification

### Found

Recent `tblaudittrail` rows exist for the six staff approvals:

| PFNo | Form | Field | Old Value | New Value | Audit Date |
| --- | --- | --- | --- | --- | --- |
| 0489 | manager/approve/new-staff | Approved | 0 | 1 | 2026-10-08 22:56:53 |
| 0496 | manager/approve/new-staff | Approved | 0 | 1 | 2026-10-08 22:58:00 |
| 0692 | manager/approve/new-staff | Approved | 0 | 1 | 2026-10-08 22:57:36 |
| 0520 | manager/approve/new-staff | Approved | 0 | 1 | 2026-10-08 22:57:13 |
| 0684 | manager/approve/new-staff | Approved | 0 | 1 | 2026-10-08 22:56:33 |
| 0587 | manager/approve/new-staff | Approved | 0 | 1 | 2026-10-08 22:56:05 |

### Gap

No recent `tblaudittrail` rows were found for the entitlement approvals or salary approvals. The live `tblentitle` and `tblsalary` rows have approval timestamps and `ApprovedBy = Manager`, but their Manager approval routes appear to update those tables directly rather than writing through the centralized audit helper.

This is an audit-governance gap, not a salary-value mismatch.

## August 2026 Payroll Batch 161

Workflow batch:

| Workflow Batch | CompanyID | Period | Type | Status | Staff | Basic | Gross | Net |
| ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: |
| 161 | 1 | 08/2026 | 01 | PROCESSED | 6 | 45,296.78 | 90,544.08 | 61,454.75 |

`tblpayroll` status:

- Rows: 6
- Approved range: -1 to -1
- `posted_to_gl`: 0 rows
- `gl_posted_batch_id` / `GlPostedBatchId`: 0 rows

Modern GL posting tables:

- `payroll_gl_posting_batches`: no August 2026 CompanyID 1 activity `01` batch found.

Legacy GL summary note:

- `tblgltrans` contains one August 2026 CompanyID 1 row for the same old August payroll totals.
- That legacy row has `Approved = 0`, `ApprovedBy = NULL`, and `DateApproved = NULL`.
- It is not linked to the modern posting-batch table and `tblpayroll` posting flags remain unset.

Conclusion: August batch 161 has not been posted through the current Post-to-Accounts workflow. The legacy `tblgltrans` row should be reviewed before any later posting, to avoid duplicate or stale legacy GL evidence.

## Differences Requiring Attention

1. Entitlement and salary approvals are financially approved in their source tables, but no matching centralized audit rows were found.
2. A legacy unapproved `tblgltrans` summary row exists for August 2026 even though the modern GL posting status is unposted.

## Final Status

The approvals and salary values are verified, but the required audit-record verification is incomplete for entitlement and salary approvals.

FINAL STATUS: WAEC APRIL 2026 APPROVALS: INCOMPLETE
