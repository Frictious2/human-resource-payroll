# WAEC August 2026 Provident Fund Verification

Generated: 2026-10-09T14:56:55.632Z

## Result

WAEC PROVIDENT FUND VERIFICATION: PASS WITH CORRECTIONS

## PROV-EMP Payroll Item

| Field | Value |
| --- | --- |
| Code | 33 |
| Description | PROV-EMP |
| Percentage | 10.00% |
| Frequency | M |
| Mode | 02 |
| Taxable | No |
| Fixed | No |
| Threshold | No |
| CompanyID | 1 |

PROV-EMP is configured as a monthly employee deduction at 10% of basic salary. The legacy database field used by the salary/payroll tables is `GratEmp`; GL/reporting code maps this value to `ProvidentEmp`.

## Deduction Field Mapping

| Source | Mapping |
| --- | --- |
| Payroll item | `tblpayrollitems.Code = 33`, `Income = PROV-EMP` |
| Payroll setup / salary storage | `tblsalary.GratEmp` |
| Monthly payroll storage | `tblpayroll.GratEmp` |
| GL summary | `tblgltrans.ProvidentEmp = SUM(tblpayroll.GratEmp)` |
| Payslip display | Employee Provident Fund |
| Employer provident | `tblsalary.GratInst` / `tblpayroll.GratInst`, sourced from `PROV-INST` |

## Employee-Level Verification

| PFNo | Name | Basic Salary | Excel PF 10% | Approved Salary PF | Approved Total Deduction | Approved Net Pay | PF Check |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 0489 | Matilda Jusu | 16202.12 | 1620.21 | 1620.21 | 14266.60 | 27197.77 | PASS |
| 0496 | Festus C. Campbell | 9857.49 | 985.75 | 985.75 | 8090.60 | 15642.21 | PASS |
| 0692 | Georgiana James | 7180.72 | 718.07 | 718.07 | 6195.45 | 12424.72 | PASS |
| 0520 | Abass Renner | 6856.42 | 685.64 | 685.64 | 5965.84 | 12034.91 | PASS |
| 0684 | Chernor Sankoh | 6918.19 | 691.82 | 691.82 | 6009.58 | 12109.17 | PASS |
| 0587 | Basiru A. Waheed Sawyer | 3825.75 | 382.57 | 382.58 | 2680.10 | 5731.94 | PASS |

## Totals

| Component | Excel | Approved Salary Setup | Variance |
| --- | ---: | ---: | ---: |
| Basic Salary | 50840.69 | 50840.69 | 0.00 |
| Provident Fund Employee | 5084.06 | 5084.07 | 0.01 |
| Employee NASSIT | 2542.04 | 2542.04 | 0.00 |
| PAYE | 34682.05 | 35582.06 | 900.01 |
| Total Deductions | 42308.16 | 43208.17 | 900.01 |
| Net Pay | 86040.74 | 85140.72 | -900.02 |

The provident fund total reconciles within the normal one-cent rounding tolerance. The total deduction and net pay variance is caused by the documented PAYE formula difference between Excel and the corrected statutory PAYE engine.

## August Batch 161 Safety

The existing August 2026 payroll batch remains unchanged and unposted to the modern GL.

| PFNo | Batch 161 Provident | Approved Salary Provident | Batch Variance | Posted to GL |
| --- | ---: | ---: | ---: | --- |
| 0489 | 1065.82 | 1620.21 | -554.39 | No |
| 0496 | 795.99 | 985.75 | -189.76 | No |
| 0692 | 544.69 | 718.07 | -173.38 | No |
| 0520 | 603.65 | 685.64 | -81.99 | No |
| 0684 | 554.51 | 691.82 | -137.31 | No |
| 0587 | 338.66 | 382.58 | -43.92 | No |

Batch 161 still reflects outdated payroll values. It should only be replaced through the separately authorized reopen/reprocess workflow.

## Interface Findings

- Data Entry payroll setup displays PROV-EMP under Monthly Deductions.
- Manager salary approval displays PROV-EMP under Monthly Deductions.
- Finance and Finance Manager payslips display the deduction as Employee Provident Fund.
- The underlying legacy storage field remains `GratEmp` to preserve the existing schema.

## Approval Implications

No approved salary-review records were changed by this verification. If August payroll is later reprocessed, the replacement payroll should copy the approved `tblsalary.GratEmp` value into `tblpayroll.GratEmp`, include it in total deductions, and reduce net pay.

## Remaining Blockers

- No provident-fund calculation blocker remains.
- August batch 161 still requires explicit authorization before reopen/reprocess.
- The Excel workbook's row-level total deduction values are visually positioned inconsistently, but they reconcile as gross income minus net pay and include the 10% provident fund.
