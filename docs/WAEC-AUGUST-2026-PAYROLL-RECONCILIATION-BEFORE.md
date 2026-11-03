# WAEC August 2026 Payroll Reconciliation - Before Run

Generated: 2026-10-08T20:09:30.657Z

Status: `READY_FOR_CONTROLLED_WORKFLOW_RECONCILIATION`

## Workbook Reference

- Workbook: `C:\Users\David M. Gegbai\Downloads\AUGUST. STAFF SALARY AND PAYSLIP-2026.xlsx`
- Primary sheet: `AUG. PAYROLL`
- Parsed employee rows: 6
- Workbook sheets: `PAYSLIPS`, `AUG. PAYROLL`, `AUG. PAYE`, `NASSIT WK`, `AUG. PAYROLL JOURNAL`, `AUG. PAYROLL BY BANK`, `C B S`, `SUMMARY OF SALARY AUG. 2026`

## Workbook Totals

| Area | Excel Total |
| --- | ---: |
| Basic Salary | 50,840.69 |
| Responsibility | 9,402.98 |
| Maid | 9,402.98 |
| Staff Welfare | 3,000.00 |
| Maintenance | 6,042.38 |
| Risk | 2,350.75 |
| Acting | 15,187.62 |
| Professional | 4,701.49 |
| Academic | 0.00 |
| Transport | 24,570.00 |
| COLA | 2,850.00 |
| Total Allowance | 77,508.21 |
| Taxable | 125,806.85 |
| PAYE | 34,682.05 |
| Employee NASSIT | 2,542.04 |
| Employer NASSIT | 5,084.06 |
| Total Deduction | 42,308.17 |
| Net Pay | 86,040.74 |

## Parsed Employees

| PFNo | Name | Bank | Monthly Basic | PAYE | Employee NASSIT | Net Pay |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 0489 | Matilda Jusu | RCB | 16,202.12 | 11,686.28 | 810.11 | 27,347.77 |
| 0496 | Festus C. Campbell | SLCB | 9,857.49 | 6,461.98 | 492.87 | 15,792.21 |
| 0692 | Georgiana James | GTB | 7,180.72 | 4,968.34 | 359.04 | 12,574.73 |
| 0520 | Abass Renner | SLCB | 6,856.42 | 4,787.38 | 342.82 | 12,184.92 |
| 0684 | Chernor Sankoh | VISTA | 6,918.19 | 4,821.85 | 345.91 | 12,259.16 |
| 0587 | Basiru A. Waheed Sawyer | ACTB | 3,825.75 | 1,956.22 | 191.29 | 5,881.95 |

## Database Preflight

- Connected: Yes
- DB host: 127.0.0.1
- DB port: 3306
- DB name: personnel_master
- InnoDB support: YES

| Table | Result | Count / Error |
| --- | --- | --- |
| tblstaff | PASS | 6 |
| tblsalary | PASS | 6 |
| tblpayroll | PASS | 11 |

## Existing August 2026 Payroll

| CompanyID | PType | Generation | Rows | Posted Rows | Net Income |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | 01 |  | 6 | 0 | 61,454.75 |

## Next Required Action

Proceed with controlled August 2026 payroll workflow and employee-by-employee reconciliation.

## BEFORE Comparison Summary

- Excel employee count: 6
- System employee count: 6
- Matched employee count: 6
- Material variance rows: 92

| Area | Excel | System Before | Variance | Material Variance Count |
| --- | ---: | ---: | ---: | ---: |
| Basic Salary | 50,840.69 | 45,296.78 | -5,543.91 | 1 |
| Responsibility | 9,402.98 | 4,813.00 | -4,589.98 | 5 |
| Maid | 9,402.98 | 4,813.00 | -4,589.98 | 5 |
| Staff Welfare | 3,000.00 | 0.00 | -3,000.00 | 1 |
| Maintenance | 6,042.38 | 1,440.00 | -4,602.38 | 3 |
| Risk | 2,350.75 | 1,951.64 | -399.11 | 6 |
| Acting | 15,187.62 | 0.00 | -15,187.62 | 5 |
| Professional | 4,701.49 | 0.00 | -4,701.49 | 5 |
| Academic | 0.00 | 3,564.66 | 3,564.66 | 5 |
| Transport | 24,570.00 | 22,815.00 | -1,755.00 | 6 |
| COLA | 2,850.00 | 2,850.00 | 0.00 | 2 |
| Total Allowance | 77,508.21 | 45,247.30 | -32,260.91 | 6 |
| Gross/Total Income | 128,348.90 | 90,544.08 | -37,804.82 | 6 |
| Taxable Income | 125,806.85 | 85,184.49 | -40,622.36 | 6 |
| PAYE | 34,682.05 | 23,210.37 | -11,471.68 | 6 |
| Employee NASSIT | 2,542.04 | 1,951.64 | -590.40 | 6 |
| Employer NASSIT | 5,084.06 | 3,903.32 | -1,180.74 | 6 |
| Total Deductions | 42,308.17 | 29,089.33 | -13,218.84 | 6 |
| Net Pay | 86,040.74 | 61,454.75 | -24,585.99 | 6 |

## BEFORE Employee Variances

| PFNo | Name | Component | Excel | System Before | Variance | Cause |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 0489 | Matilda Jusu | Basic Salary | 16,202.12 | 10,658.21 | -5,543.91 | BASIC_SALARY_VARIANCE |
| 0489 | Matilda Jusu | Responsibility | 3,240.42 | 2,131.64 | -1,108.78 | TAXABLE_ALLOWANCE_VARIANCE |
| 0489 | Matilda Jusu | Maid | 3,240.42 | 2,131.64 | -1,108.78 | TAXABLE_ALLOWANCE_VARIANCE |
| 0489 | Matilda Jusu | Staff Welfare | 3,000.00 | 0.00 | -3,000.00 | TAXABLE_ALLOWANCE_VARIANCE |
| 0489 | Matilda Jusu | Maintenance | 4,411.09 | 360.00 | -4,051.09 | TAXABLE_ALLOWANCE_VARIANCE |
| 0489 | Matilda Jusu | Risk | 810.11 | 532.91 | -277.20 | TAXABLE_ALLOWANCE_VARIANCE |
| 0489 | Matilda Jusu | Professional | 1,620.21 | 0.00 | -1,620.21 | TAXABLE_ALLOWANCE_VARIANCE |
| 0489 | Matilda Jusu | Academic | 0.00 | 1,065.82 | 1,065.82 | TAXABLE_ALLOWANCE_VARIANCE |
| 0489 | Matilda Jusu | Transport | 8,190.00 | 5,265.00 | -2,925.00 | MANUAL_ENTITLEMENT_ALLOWANCE_VARIANCE |
| 0489 | Matilda Jusu | COLA | 750.00 | 600.00 | -150.00 | MANUAL_ENTITLEMENT_ALLOWANCE_VARIANCE |
| 0489 | Matilda Jusu | Total Allowance | 25,262.25 | 15,087.01 | -10,175.24 | MATERIAL_VARIANCE |
| 0489 | Matilda Jusu | Gross/Total Income | 41,464.37 | 25,745.22 | -15,719.15 | MATERIAL_VARIANCE |
| 0489 | Matilda Jusu | Taxable Income | 40,654.26 | 24,712.31 | -15,941.95 | TAXABLE_INCOME_VARIANCE |
| 0489 | Matilda Jusu | PAYE | 11,686.28 | 7,053.69 | -4,632.59 | PAYE_VARIANCE_REVIEW_FORMULA_AND_BASE |
| 0489 | Matilda Jusu | Employee NASSIT | 810.11 | 532.91 | -277.20 | NASSIT_VARIANCE |
| 0489 | Matilda Jusu | Employer NASSIT | 1,620.21 | 1,065.82 | -554.39 | NASSIT_VARIANCE |
| 0489 | Matilda Jusu | Total Deductions | 14,116.60 | 8,657.42 | -5,459.18 | DEDUCTION_VARIANCE |
| 0489 | Matilda Jusu | Net Pay | 27,347.77 | 17,087.80 | -10,259.97 | NET_PAY_VARIANCE |
| 0496 | Festus C. Campbell | Responsibility | 1,971.50 | 1,591.98 | -379.52 | TAXABLE_ALLOWANCE_VARIANCE |
| 0496 | Festus C. Campbell | Maid | 1,971.50 | 1,591.98 | -379.52 | TAXABLE_ALLOWANCE_VARIANCE |
| 0496 | Festus C. Campbell | Risk | 492.87 | 397.99 | -94.88 | TAXABLE_ALLOWANCE_VARIANCE |
| 0496 | Festus C. Campbell | Acting | 3,548.70 | 0.00 | -3,548.70 | TAXABLE_ALLOWANCE_VARIANCE |
| 0496 | Festus C. Campbell | Professional | 985.75 | 0.00 | -985.75 | TAXABLE_ALLOWANCE_VARIANCE |
| 0496 | Festus C. Campbell | Academic | 0.00 | 795.99 | 795.99 | TAXABLE_ALLOWANCE_VARIANCE |
| 0496 | Festus C. Campbell | Transport | 4,095.00 | 3,510.00 | -585.00 | MANUAL_ENTITLEMENT_ALLOWANCE_VARIANCE |
| 0496 | Festus C. Campbell | Total Allowance | 13,875.32 | 8,697.94 | -5,177.38 | MATERIAL_VARIANCE |
| 0496 | Festus C. Campbell | Gross/Total Income | 23,732.81 | 18,555.43 | -5,177.38 | MATERIAL_VARIANCE |
| 0496 | Festus C. Campbell | Taxable Income | 23,239.94 | 17,555.15 | -5,684.79 | TAXABLE_INCOME_VARIANCE |
| 0496 | Festus C. Campbell | PAYE | 6,461.98 | 4,865.53 | -1,596.45 | PAYE_VARIANCE_REVIEW_FORMULA_AND_BASE |
| 0496 | Festus C. Campbell | Employee NASSIT | 492.87 | 397.99 | -94.88 | NASSIT_VARIANCE |
| 0496 | Festus C. Campbell | Employer NASSIT | 985.75 | 795.99 | -189.76 | NASSIT_VARIANCE |
| 0496 | Festus C. Campbell | Total Deductions | 7,940.61 | 6,064.51 | -1,876.10 | DEDUCTION_VARIANCE |
| 0496 | Festus C. Campbell | Net Pay | 15,792.21 | 12,490.92 | -3,301.29 | NET_PAY_VARIANCE |
| 0692 | Georgiana James | Responsibility | 1,436.14 | 1,089.38 | -346.76 | TAXABLE_ALLOWANCE_VARIANCE |
| 0692 | Georgiana James | Maid | 1,436.14 | 1,089.38 | -346.76 | TAXABLE_ALLOWANCE_VARIANCE |
| 0692 | Georgiana James | Risk | 359.04 | 272.34 | -86.70 | TAXABLE_ALLOWANCE_VARIANCE |
| 0692 | Georgiana James | Acting | 2,585.06 | 0.00 | -2,585.06 | TAXABLE_ALLOWANCE_VARIANCE |
| 0692 | Georgiana James | Professional | 718.07 | 0.00 | -718.07 | TAXABLE_ALLOWANCE_VARIANCE |
| 0692 | Georgiana James | Academic | 0.00 | 544.69 | 544.69 | TAXABLE_ALLOWANCE_VARIANCE |
| 0692 | Georgiana James | Transport | 4,095.00 | 3,510.00 | -585.00 | MANUAL_ENTITLEMENT_ALLOWANCE_VARIANCE |
| 0692 | Georgiana James | Total Allowance | 11,439.46 | 7,315.79 | -4,123.67 | MATERIAL_VARIANCE |
| 0692 | Georgiana James | Gross/Total Income | 18,620.18 | 14,496.51 | -4,123.67 | MATERIAL_VARIANCE |
| 0692 | Georgiana James | Taxable Income | 18,261.14 | 13,619.25 | -4,641.89 | TAXABLE_INCOME_VARIANCE |
| 0692 | Georgiana James | PAYE | 4,968.34 | 3,676.87 | -1,291.47 | PAYE_VARIANCE_REVIEW_FORMULA_AND_BASE |
| 0692 | Georgiana James | Employee NASSIT | 359.04 | 272.34 | -86.70 | NASSIT_VARIANCE |
| 0692 | Georgiana James | Employer NASSIT | 718.07 | 544.69 | -173.38 | NASSIT_VARIANCE |
| 0692 | Georgiana James | Total Deductions | 6,045.45 | 4,498.90 | -1,546.55 | DEDUCTION_VARIANCE |
| 0692 | Georgiana James | Net Pay | 12,574.73 | 9,997.61 | -2,577.12 | NET_PAY_VARIANCE |
| 0520 | Abass Renner | Responsibility | 1,371.28 | 0.00 | -1,371.28 | TAXABLE_ALLOWANCE_VARIANCE |
| 0520 | Abass Renner | Maid | 1,371.28 | 0.00 | -1,371.28 | TAXABLE_ALLOWANCE_VARIANCE |
| 0520 | Abass Renner | Risk | 342.82 | 301.82 | -41.00 | TAXABLE_ALLOWANCE_VARIANCE |
| 0520 | Abass Renner | Acting | 2,468.31 | 0.00 | -2,468.31 | TAXABLE_ALLOWANCE_VARIANCE |
| 0520 | Abass Renner | Professional | 685.64 | 0.00 | -685.64 | TAXABLE_ALLOWANCE_VARIANCE |
| 0520 | Abass Renner | Academic | 0.00 | 603.65 | 603.65 | TAXABLE_ALLOWANCE_VARIANCE |
| 0520 | Abass Renner | Transport | 4,095.00 | 3,510.00 | -585.00 | MANUAL_ENTITLEMENT_ALLOWANCE_VARIANCE |
| 0520 | Abass Renner | Total Allowance | 11,144.34 | 5,225.47 | -5,918.87 | MATERIAL_VARIANCE |
| 0520 | Abass Renner | Gross/Total Income | 18,000.76 | 12,081.89 | -5,918.87 | MATERIAL_VARIANCE |
| 0520 | Abass Renner | Taxable Income | 17,657.94 | 11,221.69 | -6,436.25 | TAXABLE_INCOME_VARIANCE |
| 0520 | Abass Renner | PAYE | 4,787.38 | 2,980.30 | -1,807.08 | PAYE_VARIANCE_REVIEW_FORMULA_AND_BASE |
| 0520 | Abass Renner | Employee NASSIT | 342.82 | 301.82 | -41.00 | NASSIT_VARIANCE |
| 0520 | Abass Renner | Employer NASSIT | 685.64 | 603.65 | -81.99 | NASSIT_VARIANCE |
| 0520 | Abass Renner | Total Deductions | 5,815.84 | 3,890.77 | -1,925.07 | DEDUCTION_VARIANCE |
| 0520 | Abass Renner | Net Pay | 12,184.92 | 8,191.12 | -3,993.80 | NET_PAY_VARIANCE |
| 0684 | Chernor Sankoh | Responsibility | 1,383.64 | 0.00 | -1,383.64 | TAXABLE_ALLOWANCE_VARIANCE |
| 0684 | Chernor Sankoh | Maid | 1,383.64 | 0.00 | -1,383.64 | TAXABLE_ALLOWANCE_VARIANCE |
| 0684 | Chernor Sankoh | Maintenance | 360.00 | 0.00 | -360.00 | TAXABLE_ALLOWANCE_VARIANCE |
| 0684 | Chernor Sankoh | Risk | 345.91 | 277.25 | -68.66 | TAXABLE_ALLOWANCE_VARIANCE |
| 0684 | Chernor Sankoh | Acting | 2,490.55 | 0.00 | -2,490.55 | TAXABLE_ALLOWANCE_VARIANCE |
| 0684 | Chernor Sankoh | Professional | 691.82 | 0.00 | -691.82 | TAXABLE_ALLOWANCE_VARIANCE |
| 0684 | Chernor Sankoh | Academic | 0.00 | 554.51 | 554.51 | TAXABLE_ALLOWANCE_VARIANCE |
| 0684 | Chernor Sankoh | Transport | 4,095.00 | 3,510.00 | -585.00 | MANUAL_ENTITLEMENT_ALLOWANCE_VARIANCE |
| 0684 | Chernor Sankoh | Total Allowance | 11,200.55 | 4,791.76 | -6,408.79 | MATERIAL_VARIANCE |
| 0684 | Chernor Sankoh | Gross/Total Income | 18,118.74 | 11,709.95 | -6,408.79 | MATERIAL_VARIANCE |
| 0684 | Chernor Sankoh | Taxable Income | 17,772.83 | 10,829.45 | -6,943.38 | TAXABLE_INCOME_VARIANCE |
| 0684 | Chernor Sankoh | PAYE | 4,821.85 | 2,841.02 | -1,980.83 | PAYE_VARIANCE_REVIEW_FORMULA_AND_BASE |
| 0684 | Chernor Sankoh | Employee NASSIT | 345.91 | 277.25 | -68.66 | NASSIT_VARIANCE |
| 0684 | Chernor Sankoh | Employer NASSIT | 691.82 | 554.51 | -137.31 | NASSIT_VARIANCE |
| 0684 | Chernor Sankoh | Total Deductions | 5,859.58 | 3,674.78 | -2,184.80 | DEDUCTION_VARIANCE |
| 0684 | Chernor Sankoh | Net Pay | 12,259.16 | 8,035.17 | -4,223.99 | NET_PAY_VARIANCE |
| 0587 | Basiru A. Waheed Sawyer | Maintenance | 191.29 | 0.00 | -191.29 | TAXABLE_ALLOWANCE_VARIANCE |
| 0587 | Basiru A. Waheed Sawyer | Risk | 0.00 | 169.33 | 169.33 | TAXABLE_ALLOWANCE_VARIANCE |
| 0587 | Basiru A. Waheed Sawyer | Acting | 4,095.00 | 0.00 | -4,095.00 | TAXABLE_ALLOWANCE_VARIANCE |
| 0587 | Basiru A. Waheed Sawyer | Transport | 0.00 | 3,510.00 | 3,510.00 | MANUAL_ENTITLEMENT_ALLOWANCE_VARIANCE |
| 0587 | Basiru A. Waheed Sawyer | COLA | 300.00 | 450.00 | 150.00 | MANUAL_ENTITLEMENT_ALLOWANCE_VARIANCE |
| 0587 | Basiru A. Waheed Sawyer | Total Allowance | 4,586.29 | 4,129.33 | -456.96 | MATERIAL_VARIANCE |
| 0587 | Basiru A. Waheed Sawyer | Gross/Total Income | 8,412.04 | 7,955.08 | -456.96 | MATERIAL_VARIANCE |
| 0587 | Basiru A. Waheed Sawyer | Taxable Income | 8,220.74 | 7,246.64 | -974.10 | TAXABLE_INCOME_VARIANCE |
| 0587 | Basiru A. Waheed Sawyer | PAYE | 1,956.22 | 1,792.96 | -163.26 | PAYE_VARIANCE_REVIEW_FORMULA_AND_BASE |
| 0587 | Basiru A. Waheed Sawyer | Employee NASSIT | 191.29 | 169.33 | -21.96 | NASSIT_VARIANCE |
| 0587 | Basiru A. Waheed Sawyer | Employer NASSIT | 382.57 | 338.66 | -43.91 | NASSIT_VARIANCE |
| 0587 | Basiru A. Waheed Sawyer | Total Deductions | 2,530.09 | 2,302.95 | -227.14 | DEDUCTION_VARIANCE |
| 0587 | Basiru A. Waheed Sawyer | Net Pay | 5,881.95 | 5,652.13 | -229.82 | NET_PAY_VARIANCE |

