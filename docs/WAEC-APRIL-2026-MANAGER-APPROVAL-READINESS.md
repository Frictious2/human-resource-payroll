# WAEC April 2026 Salary Review - Manager Approval Readiness

Generated: 2026-10-08

## Scope

This verification is read-only. No Manager approvals were performed, no financial records were changed, and August 2026 payroll batch 161 was not cancelled, regenerated, posted, or otherwise modified.

Company: CompanyID 1

Effective date under review: 2026-04-01

Reference workbook: `AUGUST. STAFF SALARY AND PAYSLIP-2026.xlsx`

Reference worksheet: `AUG. PAYROLL`

## Summary

| Check | Result | Evidence |
| --- | --- | --- |
| Staff submissions pending | PASS | 6 matching WAEC staff records have `tblstaff.Approved = 0`. |
| Entitlement submissions pending | PASS | 6 matching WAEC entitlement records have `tblentitle.Approved = 0`. |
| Salary submissions pending | PASS | 6 matching WAEC salary records have `tblsalary.Approved = 0`. |
| August 2026 payroll unchanged | PASS | Existing August payroll for the six employees remains 6 rows, Salary NLe45,296.78, Gross NLe90,544.08, Net NLe61,454.75, Approved -1. |
| Grade/notch verification | PASS | One GradeCode change and six Notch changes are present in pending staff data. |
| Basic salary vs Excel | PASS | Pending `tblsalary.Salary` matches Excel for all six employees. |
| Allowance earnings vs Excel | PASS | Pending salary earnings match Excel within NLe0.01 total rounding difference. |
| Manual Transport | PASS | Pending `Allw03` matches Excel Transport for all six employees. |
| COLA | PASS | Pending `Allw06` matches Excel COLA for all six employees. |
| Acting Allowance | PASS | Pending `Allw14` matches Excel Acting values for the five affected employees; Matilda Jusu remains zero. |
| Staff Welfare / Allw07 mapping | PASS WITH NOTE | Excel Staff Welfare maps to `tblsalary.Allw07`; `tblpayrollitems.Code = 07` remains labelled `BIKE ALLOWANCE`. No rename was made. |
| PAYE variance handling | PASS | PAYE variance remains separately documented; statutory PAYE calculation was not changed to match Excel. |
| Manager dashboard visibility | PASS | Manager approval queries list pending staff, entitlement, and salary records by `Approved = 0`. |
| Manager review detail | PASS | Manager review views expose read-only proposed values before approval. |
| Per-employee approval isolation | PASS | Manager approval updates are scoped by PFNo, and salary approval is scoped by PFNo + PDate. |
| Transport/COLA overwrite risk | PASS | Pending salary rows already contain manual Transport/COLA values; approval routes approve the pending rows and do not recalculate or overwrite these values. |
| Effective date | PASS WITH LIMITATION | Pending staff grade date and salary PDate retain 2026-04-01. `tblentitle` does not expose a separate effective-date column in the current workflow. |

## Manager Workflow Evidence

The Manager dashboard approval count configuration includes `tblstaff` and `tblentitle` records where `Approved = 0`. Salary approvals are available through dedicated Manager salary approval routes that query `tblsalary` records where `Approved = 0`.

Manager review pages load the proposed values in read-only fields before approval:

- Staff review: `/manager/approve/new-staff/view?pfno=<PFNo>`
- Entitlement review: `/manager/approve/entitlement/view?pfno=<PFNo>`
- Salary review: `/manager/approve/salary/view?pfno=<PFNo>&pdate=2026-04-01`

Approval scoping:

- Staff approval updates `tblstaff` by `PFNo`.
- Entitlement approval updates `tblentitle` by `PFNo` and pending approval state.
- Salary approval updates `tblsalary` by `PFNo` and `PDate`.

Runtime CSRF handling is provided by the shared security middleware, which injects `_csrf` hidden fields into server-rendered POST forms before HTML is sent.

## Payroll Item Mapping Notes

| Excel Component | Salary Column | Payroll Item Code | Current Payroll Item Label | Note |
| --- | --- | --- | --- | --- |
| Transport | `Allw03` | `03` | TRANSPORT | Manual values verified. |
| COLA | `Allw06` | `06` | COLA | Manual values verified. |
| Staff Welfare | `Allw07` | `07` | BIKE ALLOWANCE | Mapping verified from salary data; item label was not changed. |
| Maintenance | `Allw10` | `10` | CAR MAINTENANCE | Pending values match Excel. |
| Responsibility | `Allw11` | `11` | RESPONSIBILITY | Pending values match Excel. |
| Maid | `Allw12` | `12` | MAID | Pending values match Excel. |
| Acting | `Allw14` | `14` | ACTING | Five affected employees verified. |
| Professional | `Allw16` | `16` | PROFESSIONAL | Pending values match Excel. |
| Risk | `Allw17` | `17` | RISK | Pending values match Excel. |
| Academic | `Allw19` | `19` | ACADEMIC | Pending values match Excel. |

## Per-Employee Readiness

| PFNo | Name | Job Title Match | Grade Match | Notch Verification | Basic Salary Match | Allowance Match | Transport Match | COLA Match | Acting Allowance Match | Staff Approval Status | Entitlement Approval Status | Salary Approval Status | Ready for Manager Approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0489 | Matilda Jusu | PASS - Job code 0101 retained for Excel designation HNO. | PASS - CGrade/GradeCode 0100. | PASS - Notch 1, from Excel scale 1.01. | PASS - NLe16,202.12. | PASS - earnings match Excel. | PASS - NLe8,190.00. | PASS - NLe750.00. | PASS - NLe0.00, not affected. | Pending Manager approval (`Approved = 0`). | Pending Manager approval (`Approved = 0`). | Pending Manager approval (`Approved = 0`). | YES |
| 0496 | Festus C. Campbell | PASS WITH NOTE - Job code 0401 retained; Excel designation P.H.R.M.O requires code-name confirmation only. | PASS - CGrade/GradeCode 0400. | PASS - Notch 4, from Excel scale 4.04. | PASS - NLe9,857.49. | PASS - earnings match Excel. | PASS - NLe4,095.00. | PASS - NLe450.00. | PASS - NLe3,548.70. | Pending Manager approval (`Approved = 0`). | Pending Manager approval (`Approved = 0`). | Pending Manager approval (`Approved = 0`). | YES |
| 0692 | Georgiana James | PASS WITH NOTE - Job code 0601 retained; Excel designation Snr. Acct. II/AR II requires code-name confirmation only. | PASS - CGrade/GradeCode 0600. | PASS - Notch 3, from Excel scale 6.03. | PASS - NLe7,180.72. | PASS - earnings match Excel within NLe0.01 rounding. | PASS - NLe4,095.00. | PASS - NLe450.00. | PASS - NLe2,585.06. | Pending Manager approval (`Approved = 0`). | Pending Manager approval (`Approved = 0`). | Pending Manager approval (`Approved = 0`). | YES |
| 0520 | Abass P. Renner | PASS WITH NOTE - Job code 0701 retained; Excel designation Ag Head HRMO I/AR I requires code-name confirmation only. | PASS - CGrade/GradeCode 0700. | PASS - Notch 9, from Excel scale 7.09. | PASS - NLe6,856.42. | PASS - earnings match Excel within NLe0.01 rounding. | PASS - NLe4,095.00. | PASS - NLe450.00. | PASS - NLe2,468.31. | Pending Manager approval (`Approved = 0`). | Pending Manager approval (`Approved = 0`). | Pending Manager approval (`Approved = 0`). | YES |
| 0684 | Chernor Sankoh | PASS WITH NOTE - Job code 0601 retained; Excel designation Ag.Head Of Audit/AR II requires code-name confirmation only. | PASS - CGrade/GradeCode 0600. | PASS - Notch 1, from Excel scale 6.01. | PASS - NLe6,918.19. | PASS - earnings match Excel within NLe0.01 rounding. | PASS - NLe4,095.00. | PASS - NLe450.00. | PASS - NLe2,490.55. | Pending Manager approval (`Approved = 0`). | Pending Manager approval (`Approved = 0`). | Pending Manager approval (`Approved = 0`). | YES |
| 0587 | Basiru A. Waheed Sawyer | PASS WITH NOTE - Job code 1002 retained for Excel designation SAO. | PASS - GradeCode changed from 1400 to 1000; CGrade/GradeCode now 1000. | PASS - Notch 4, from Excel scale 10.04. | PASS - NLe3,825.75. | PASS - earnings match Excel. | PASS - NLe0.00. | PASS - NLe300.00. | PASS - NLe4,095.00. | Pending Manager approval (`Approved = 0`). | Pending Manager approval (`Approved = 0`). | Pending Manager approval (`Approved = 0`). | YES |

## Pending Salary vs Excel Earnings

| PFNo | Name | Pending Basic Salary | Pending Allowances | Pending Gross | Excel Gross | Gross Variance | Pending Taxable | Excel Taxable | Taxable Variance |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0489 | Matilda Jusu | 16,202.12 | 25,262.25 | 41,464.37 | 41,464.37 | 0.00 | 40,654.26 | 40,654.26 | 0.00 |
| 0496 | Festus C. Campbell | 9,857.49 | 13,875.32 | 23,732.81 | 23,732.81 | 0.00 | 23,239.94 | 23,239.94 | 0.00 |
| 0692 | Georgiana James | 7,180.72 | 11,439.45 | 18,620.17 | 18,620.18 | -0.01 | 18,261.13 | 18,261.14 | -0.01 |
| 0520 | Abass P. Renner | 6,856.42 | 11,144.33 | 18,000.75 | 18,000.76 | -0.01 | 17,657.93 | 17,657.94 | -0.01 |
| 0684 | Chernor Sankoh | 6,918.19 | 11,200.56 | 18,118.75 | 18,118.74 | 0.01 | 17,772.84 | 17,772.83 | 0.01 |
| 0587 | Basiru A. Waheed Sawyer | 3,825.75 | 4,586.29 | 8,412.04 | 8,412.04 | 0.00 | 8,220.75 | 8,220.74 | 0.01 |
| **Total** |  | **50,840.69** | **77,508.20** | **128,348.89** | **128,348.90** | **-0.01** | **125,806.85** | **125,806.85** | **0.00** |

## PAYE Variance

The pending salary rows use the corrected Sierra Leone progressive PAYE calculation. The Excel workbook PAYE is lower by approximately NLe150 per employee, producing a total PAYE variance of NLe900.01 and a matching net-pay variance. This variance is separately documented and was not resolved by changing statutory PAYE logic.

| PFNo | Pending PAYE | Excel PAYE | PAYE Variance | Pending Net | Excel Net | Net Variance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0489 | 11,836.28 | 11,686.28 | 150.00 | 27,197.77 | 27,347.77 | -150.00 |
| 0496 | 6,611.98 | 6,461.98 | 150.00 | 15,642.21 | 15,792.21 | -150.00 |
| 0692 | 5,118.34 | 4,968.34 | 150.00 | 12,424.72 | 12,574.73 | -150.01 |
| 0520 | 4,937.38 | 4,787.38 | 150.00 | 12,034.91 | 12,184.92 | -150.01 |
| 0684 | 4,971.85 | 4,821.85 | 150.00 | 12,109.17 | 12,259.16 | -149.99 |
| 0587 | 2,106.23 | 1,956.22 | 150.01 | 5,731.94 | 5,881.95 | -150.01 |
| **Total** | **35,582.06** | **34,682.05** | **900.01** | **85,140.72** | **86,040.74** | **-900.02** |

## Final Readiness Finding

All six WAEC April 2026 salary-review submissions are visible as pending records, contain the intended grade/notch/salary/allowance values, retain the April 2026 effective date where supported, and are ready for Manager review and approval.

The only remaining non-blocking notes are:

- Several Excel designation labels are abbreviations or acting designations that do not prove a different `tblstaff.JobTitle` code; no job-title code changes were made for those cases.
- `tblentitle` does not provide a separate effective-date column, so entitlement effective dating is represented by the pending submission state and accompanying audit/report evidence rather than a native entitlement date field.
- PAYE variance is intentionally preserved as a statutory-calculation difference; the corrected PAYE engine was not changed to reproduce the workbook’s lower PAYE values.

FINAL STATUS: WAEC MANAGER APPROVAL READINESS: PASS
