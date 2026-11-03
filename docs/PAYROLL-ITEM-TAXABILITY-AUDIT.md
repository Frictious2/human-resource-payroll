# Payroll Item Taxability & PAYE Integration Audit

Generated: 2026-09-28

Evidence files:

- `scripts/auditPayrollItemTaxability.js`
- `docs/test-results/payroll-item-taxability-audit-latest.json`

Final status:

`PAYROLL ITEM TAXABILITY AUDIT: PASS`

## Scope

This audit verifies whether `tblpayrollitems.Taxable` controls PAYE treatment for applicable payroll earnings after the Sierra Leone PAYE remediation. It covers monthly payroll setup, Process Emoluments handoff into `tblpayroll`, annual Rent/Inducement/Leave batches, payslip/report integration paths, Admin Payroll Item persistence, parameter governance, and CompanyID isolation.

No historical `tblsalary`, `tblpayroll`, `tblyearlypayments`, or GL rows were modified.

## Inventory Summary

| Metric | Count |
| --- | ---: |
| Total Payroll Items | 36 |
| Monthly Items | 19 |
| Yearly Items | 4 |
| Other/Unknown Frequency | 13 |
| Taxable Items | 19 |
| Non-Taxable Items | 17 |

## Taxable Flag Semantics

`tblpayrollitems.Taxable` uses legacy non-zero truth semantics.

| Database Value | Meaning |
| --- | --- |
| `-1` | Taxable in current legacy data |
| `1` | Taxable when written by Admin create/update paths |
| `0` | Non-taxable |
| Any other non-zero value | Treated as taxable by active calculation code |

The Admin Payroll Items UI writes `1`/`0`, while legacy rows currently use `-1`/`0`. Active payroll code treats any non-zero value as taxable, so both formats are supported.

## Frequency Semantics

Live `tblpayrollitems.Freq` values are:

| Value | Meaning |
| --- | --- |
| `M` | Monthly item |
| `Y` | Yearly/annual item |
| blank/null | Legacy, deduction, employer liability, or special item requiring process-specific handling |

## Payroll Item Matrix

| Code | Description | Frequency | Taxable | Fixed | Mode | Percent | Threshold | Payroll Column | Used By |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| 01 | SALARY | M | Taxable (-1) | No | 01 | 0 | No | Salary | Basic salary / tblsalary.Salary |
| 02 | RENT | Y | Taxable (-1) | No | 01 | 75 | No | Allw02 | Monthly/yearly earning column Allw02 or yearly payment PType 02 |
| 03 | TRANSPORT | M | Taxable (-1) | Yes | 01 | 0 | No | Allw03 | Monthly/yearly earning column Allw03 or yearly payment PType 03 |
| 04 | WELFARE | M | Taxable (-1) | Yes | 01 | 0 | No | Allw04 | Monthly/yearly earning column Allw04 or yearly payment PType 04 |
| 05 | INDUCEMENT | Y | Taxable (-1) | No | 01 | 15 | No | Allw05 | Monthly/yearly earning column Allw05 or yearly payment PType 05 |
| 06 | COLA | M | Taxable (-1) | Yes | 01 | 0 | No | Allw06 | Monthly/yearly earning column Allw06 or yearly payment PType 06 |
| 07 | BIKE ALLOWANCE | M | Taxable (-1) | No | 01 | 0 | No | Allw07 | Monthly/yearly earning column Allw07 or yearly payment PType 07 |
| 08 | EOS | blank | Taxable (-1) | No | 01 | 0 | No | Allw08 | Monthly/yearly earning column Allw08 or yearly payment PType 08 |
| 09 | BONUS | M | Taxable (-1) | No | 01 | 0 | No | Allw09 | Monthly/yearly earning column Allw09 or yearly payment PType 09 |
| 10 | CAR MAINTENANCE | M | Taxable (-1) | Yes | 01 | 0 | No | Allw10 | Monthly/yearly earning column Allw10 or yearly payment PType 10 |
| 11 | RESPONSIBILITY | M | Taxable (-1) | No | 01 | 20 | No | Allw11 | Monthly/yearly earning column Allw11 or yearly payment PType 11 |
| 12 | MAID | M | Taxable (-1) | No | 01 | 20 | No | Allw12 | Monthly/yearly earning column Allw12 or yearly payment PType 12 |
| 13 | LEAVE | Y | Taxable (-1) | No | 01 | 20 | No | Allw13 | Monthly/yearly earning column Allw13 or yearly payment PType 13 |
| 14 | ACTING | M | Taxable (-1) | No | 01 | 1 | No | Allw14 | Monthly/yearly earning column Allw14 or yearly payment PType 14 |
| 15 | LONG SERVICE | Y | Taxable (-1) | No | 01 | 10 | No | Allw15 | Monthly/yearly earning column Allw15 or yearly payment PType 15 |
| 16 | PROFESSIONAL | M | Taxable (-1) | No | 01 | 5 | No | Allw16 | Monthly/yearly earning column Allw16 or yearly payment PType 16 |
| 17 | RISK | M | Taxable (-1) | No | 01 | 10 | No | Allw17 | Monthly/yearly earning column Allw17 or yearly payment PType 17 |
| 18 | EX-GRACIA | blank | Taxable (-1) | No | 01 | 25 | No | Allw18 | Monthly/yearly earning column Allw18 or yearly payment PType 18 |
| 19 | ACADEMIC | M | Taxable (-1) | No | 01 | 10 | No | Allw19 | Monthly/yearly earning column Allw19 or yearly payment PType 19 |
| 20 | ADD2 | blank | Non-taxable (0) | No | 01 | 0 | No | Allw20 | Monthly/yearly earning column Allw20 or yearly payment PType 20 |
| 21 | ADD3 | blank | Non-taxable (0) | No | 01 | 0 | No | No direct monthly payroll column confirmed | Unknown/legacy |
| 31 | INCOME TAX | M | Non-taxable (0) | No | 02 | 0 | No | Tax | PAYE deduction / tblsalary.Tax / tblpayroll.Tax |
| 32 | NASSIT-EMP | M | Non-taxable (0) | No | 02 | 5 | No | NassitEmp | Employee NASSIT / NassitEmp |
| 33 | PROV-EMP | M | Non-taxable (0) | No | 02 | 10 | No | GratEmp | Employee provident/gratuity / GratEmp |
| 34 | LOAN DED | blank | Non-taxable (0) | No | 02 | 0 | No | Ded1 / Ded4 depending loan path | Employee deduction columns / supporting deduction tables |
| 35 | UNION DUES | M | Non-taxable (0) | No | 02 | 0 | No | UnionDues | Employee deduction columns / supporting deduction tables |
| 36 | INTEREST | blank | Non-taxable (0) | No | 02 | 0 | No | Ded3 | Employee deduction columns / supporting deduction tables |
| 37 | DED04 | blank | Non-taxable (0) | No | 02 | 0 | No | Ded4 | Employee deduction columns / supporting deduction tables |
| 38 | DED05 | blank | Non-taxable (0) | No | 02 | 0 | No | Ded5 | Employee deduction columns / supporting deduction tables |
| 39 | DED06 | blank | Non-taxable (0) | No | 02 | 0 | No | No direct monthly payroll column confirmed | Employee deduction columns / supporting deduction tables |
| 40 | GUARANTEE | blank | Non-taxable (0) | No | 02 | 0 | No | No direct monthly payroll column confirmed | Employee deduction columns / supporting deduction tables |
| 41 | NASSIT-INST | M | Non-taxable (0) | No | 03 | 10 | No | NassitInst | Employer NASSIT / NassitInst |
| 42 | PROV-INST | M | Non-taxable (0) | No | 03 | 20 | No | GratInst | Employer provident/gratuity / GratInst |
| 43 | OTH01 | blank | Non-taxable (0) | No | 03 | 0 | No | No direct monthly payroll column confirmed | Other employer/liability item |
| 44 | OTH02 | blank | Non-taxable (0) | No | 03 | 0 | No | No direct monthly payroll column confirmed | Other employer/liability item |
| 45 | OTH03 | blank | Non-taxable (0) | No | 03 | 0 | No | No direct monthly payroll column confirmed | Other employer/liability item |

## Monthly Calculation Mapping

Monthly calculation is performed upstream in payroll setup:

- `services/payrollSetupAutoCalculationService.js` reads company-scoped `tblpayrollitems`.
- Salary is taxable when item `01` is taxable; basic salary remains represented by `Salary`.
- Monthly allowances are mapped to `Allw02` through `Allw20`.
- Monthly taxable earnings are built from salary plus the actual monetary allowance amounts whose Payroll Item is taxable.
- Employee NASSIT item `32` is deducted before PAYE.
- Employer NASSIT item `41` remains an employer liability and is not deducted from employee net pay.
- `services/payeTaxService.js` receives the already-classified monthly taxable earnings and applies progressive Sierra Leone PAYE bands.
- Data Entry manual payroll setup save also recomputes `Taxable`, `Tax`, `TotalDeduction`, and `NetIncome` server-side from submitted values and company-scoped Payroll Item taxability.
- Process Emoluments snapshots `tblsalary.TotalIncome`, `tblsalary.Taxable`, `tblsalary.Tax`, `tblsalary.NassitEmp`, `tblsalary.NassitInst`, and `tblsalary.NetIncome` into `tblpayroll`.

## Monthly Test Results

| Scenario | Total Income | Taxable Earnings | Employee NASSIT | PAYE Chargeable | PAYE | Net Income |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Salary only | 2,000.00 | 2,000.00 | 100.00 | 1,900.00 | 235.00 | 1,665.00 |
| Salary + taxable fixed allowance | 2,500.00 | 2,500.00 | 100.00 | 2,400.00 | 360.00 | 2,040.00 |
| Salary + non-taxable fixed allowance | 2,500.00 | 2,000.00 | 100.00 | 1,900.00 | 235.00 | 2,165.00 |
| Salary + taxable 20% allowance | 2,400.00 | 2,400.00 | 100.00 | 2,300.00 | 335.00 | 1,965.00 |
| Salary + non-taxable 20% allowance | 2,400.00 | 2,000.00 | 100.00 | 1,900.00 | 235.00 | 2,065.00 |
| Salary + taxable and non-taxable allowances | 3,000.00 | 2,500.00 | 100.00 | 2,400.00 | 360.00 | 2,540.00 |
| Salary + taxable allowance + other deduction | 2,500.00 | 2,500.00 | 100.00 | 2,400.00 | 360.00 | 1,940.00 |
| High-income employee | 12,000.00 | 12,000.00 | 500.00 | 11,500.00 | 3,090.00 | 8,410.00 |

Control comparison:

- A taxable NLe500 allowance on a NLe2,000 salary increases PAYE from NLe235.00 to NLe360.00.
- A non-taxable NLe500 allowance increases gross/net cash but leaves PAYE chargeable income and PAYE unchanged.
- Employee NASSIT is deducted before PAYE; employer NASSIT is not deducted from employee pay.

## Yearly Calculation Mapping

The implemented annual batch workflow covers:

- `02` Rent
- `05` Inducement
- `13` Leave

The yearly-payment service reads company-scoped `tblpayrollitems`, uses the item `Taxable` flag to set `TaxableAmount`, and applies the existing yearly tax treatment separately from monthly PAYE. This audit did not change the annual tax formula.

## Yearly Test Results

| Type | Live Percent | Taxable Scenario Total | Taxable Amount | Tax | Net | Non-Taxable Amount | Non-Taxable Tax | Non-Taxable Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Rent | 75 | 9,000.00 | 9,000.00 | 2,700.00 | 6,300.00 | 0.00 | 0.00 | 9,000.00 |
| Inducement | 15 | 3,600.00 | 3,600.00 | 1,080.00 | 2,520.00 | 0.00 | 0.00 | 3,600.00 |
| Leave | 20 | 4,800.00 | 4,800.00 | 1,440.00 | 3,360.00 | 0.00 | 0.00 | 4,800.00 |

Rent first-year six-month behavior remains preserved in the yearly service. The test scenario confirms the taxable flag affects `TaxableAmount`, `TaxAmount`, and `NetIncome`; it does not alter the established first-year Rent rule.

## Fixed, Percentage, and Threshold Findings

- Fixed monthly items are supported as monetary earnings. If taxable, their monetary amount enters PAYE earnings; if non-taxable, it remains outside PAYE earnings.
- Percentage items are calculated to monetary amounts first. PAYE applies to the calculated amount only when the item is taxable.
- No active audited path proves that `tblpayrollitems.Threshhold`, `TPercent`, `TPercentage`, or `TAmount` currently adjust monthly PAYE taxable earnings. These fields are preserved as legacy configuration fields and should not be reinterpreted without a separate business rule confirmation.

## NASSIT and Deduction Findings

- `32` NASSIT-EMP is a deduction item and is not treated as positive taxable earnings.
- `41` NASSIT-INST is an employer/institution contribution and is not deducted from employee net pay.
- Generic deduction items are not treated as positive taxable earnings merely because they are Payroll Items.

## Reports and Payslip Integration

- Payslip and report paths consume final payroll rows rather than recalculating Payroll Item taxability.
- PAYE liability reports consume effective approved `tblpayroll.Tax`.
- Staff PAYE Statement and statutory PAYE reporting remain tied to effective payroll history and generation-aware report logic.

## Admin Persistence and Governance

Admin Payroll Items are exposed through:

- `GET /admin/parameters/payroll-items`
- `GET /admin/api/parameters/payroll-items`
- `POST /admin/api/parameters/payroll-items`
- `PATCH /admin/api/parameters/payroll-items/:code`
- `DELETE /admin/api/parameters/payroll-items/:code`

Payroll Items are registered in the parameter-change workflow through `services/parameterChangeService.js`. Taxability changes are therefore governed as sensitive parameter changes and are not silently applied outside the approval path.

## Company Isolation

Monthly and yearly Payroll Item lookups are CompanyID-scoped and prefer company-specific rows, falling back to `CompanyID IS NULL` legacy rows where applicable.

Company A does not use Company B's taxable flag, rate, frequency, threshold, or fixed/percentage settings through the audited calculation paths.

## Effective-Date and Historical Configuration Risk

`tblpayrollitems` does not provide historical effective dating for taxability. Future calculations and reopened/corrected payroll will use the currently approved configuration at the time the payroll setup is recalculated. Historical `tblsalary`, `tblpayroll`, and `tblyearlypayments` rows were not changed by this audit.

If historical payroll was produced under a different taxability rule, reconstructing that rule from current `tblpayrollitems` alone may be impossible. Any posted historical correction must use the established Reversal -> Reopen -> corrected Generation -> approvals -> Post to Accounts workflow.

## Other Special-Payment Findings

| Code | Finding |
| --- | --- |
| 04 | Welfare is active as monthly `Allw04`; legacy yearly references exist, but current confirmed annual batch scope is Rent/Inducement/Leave. |
| 06 | COLA is active as monthly `Allw06`. |
| 07 | Backlog uses difference-based calculation and progressive PAYE on income delta; not generic Payroll Item taxability. |
| 08 | EOS is treated as separate EOS/statutory logic, not changed by this audit. |
| 09 | Bonus appears as monthly `Allw09`; bonus-specific legacy paths require separate confirmation before changing taxation. |
| 14 | Acting is active as monthly `Allw14`. |
| 15 | Long Service is configured yearly but is not part of the current confirmed annual batch workflow. |
| 33 | Provident employee contribution is not ordinary taxable earnings. |
| 40 | Guarantee is a deduction/legacy item, not ordinary taxable earnings. |
| 41 | NASSIT-INST is employer contribution, not employee taxable earnings or employee deduction. |
| 42 | PROV-INST is employer/liability contribution, not employee taxable earnings. |

## Audit Status Matrix

| Area | Result |
| --- | --- |
| Monthly Payroll Item Taxability | PASS |
| Yearly Payroll Item Taxability | PASS |
| Taxable Item Inclusion | PASS |
| Non-Taxable Item Exclusion | PASS |
| NASSIT Interaction | PASS |
| PAYE Integration | PASS |
| Admin Configuration Persistence | PASS |
| Company Isolation | PASS |
| Payroll Item Governance | PASS |

## Defects and Fixes

No calculation defect was found in the active audited taxability paths after the Sierra Leone PAYE remediation. No payroll calculation code was changed during this audit.

Audit evidence script improvement:

- `scripts/auditPayrollItemTaxability.js` was created.
- The script was adjusted to recognize the existing yearly-service CompanyID fallback query pattern.

## Cleanup

The audit used synthetic in-memory scenarios and read-only source/database inspection. No production payroll rows or Payroll Item configuration rows were inserted, updated, or deleted. Cleanup status: PASS.

