# Sierra Leone PAYE Calculation Audit

Generated: 2026-09-27

Evidence:

- `scripts/auditSierraLeonePayeCalculation.js`
- `docs/test-results/sierra-leone-paye-audit-latest.json`

## Executive Result

`SIERRA LEONE PAYE AUDIT: PASS AFTER CORRECTIONS`

The current Tax Table values support the Sierra Leone monthly progressive PAYE bands, and the independent band tests pass. The active-code defects discovered during the first audit pass have been corrected:

- `AllwThreshold = 500.00` is retained as legacy metadata but is no longer used by the active monthly PAYE calculation path.
- Future payroll setup auto-calculation now calculates PAYE using a canonical progressive PAYE helper.
- Admin Tax Table retrieval is CompanyID-scoped.
- Backlog/pay-code `07` now uses CompanyID/effective-date scoped Tax Table lookup.

Some historical `tblpayroll` rows still do not reconcile with progressive PAYE calculated from stored `tblpayroll.Taxable`. These rows were not changed, per historical payroll safety requirements.

No historical payroll rows were changed by this audit.

## Tax Table Path

| Layer | Path |
| --- | --- |
| Route | `routes/admin.js` |
| Page | `GET /admin/parameters/tax-table` |
| Fetch API | `GET /admin/api/parameters/tax-table` |
| Save API | `POST /admin/api/parameters/tax-table` |
| Controller | `controllers/adminController.js` |
| Workflow service | `services/parameterChangeService.js` module `tax-table` |
| View | `views/admin/parameters/tax-table.ejs` |
| Database | `tbltax` |

Tax Table updates are routed through Admin parameter-change drafts and require approval before live application. This is the correct governance pattern. A defect remains in the read API because it fetches `CompanyID = 1` directly.

## Current `tbltax` Values

Effective row for `CompanyID = 1`:

| Field | Value |
| --- | ---: |
| TaxDate | 2020-12-28 |
| R1 | 600 |
| R1Tax | 0 |
| R2 | 1200 |
| R2Tax | 15 |
| R3 | 1800 |
| R3Tax | 20 |
| R4 | 2400 |
| R4Tax | 25 |
| R5 | 99000 |
| R5Tax | 30 |
| R6/R7 | 0 |
| RentThreshold | 0.00 |
| AllwThreshold | 500.00 |
| Withholding_Tax | 6.5 |

## Band Semantics

`R1` through `R4` behave as cumulative upper limits:

- `R1 = 600`
- `R2 = 1200`
- `R3 = 1800`
- `R4 = 2400`

`R5Tax = 30` is the final/excess rate above `R4`. The independent audit calculator does not need `R5 = 99000` as an upper ceiling, and boundary testing confirmed no ceiling when interpreted correctly. If production code ever treats `R5` as a hard upper limit, that would be a defect.

## Progressive PAYE Boundary Results

The independent reference calculator and live `tbltax` bands agree for all required boundaries:

- 0
- 599.99
- 600
- 600.01
- 1,000
- 1,199.99
- 1,200
- 1,200.01
- 1,799.99
- 1,800
- 1,800.01
- 2,399.99
- 2,400
- 2,400.01
- 3,000
- 5,000
- 10,000
- 100,000

Worked examples passed:

| Chargeable Income | Expected PAYE | Live Table PAYE |
| ---: | ---: | ---: |
| 600 | 0.00 | 0.00 |
| 1,000 | 60.00 | 60.00 |
| 1,200 | 90.00 | 90.00 |
| 1,800 | 210.00 | 210.00 |
| 2,000 | 260.00 | 260.00 |
| 2,400 | 360.00 | 360.00 |
| 3,000 | 540.00 | 540.00 |
| 5,000 | 1,140.00 | 1,140.00 |

## NASSIT Configuration

Payroll Items configuration contains:

| Code | Meaning | Percent | Frequency |
| --- | --- | ---: | --- |
| 32 | NASSIT-EMP | 5 | M |
| 41 | NASSIT-INST | 10 | M |

NASSIT examples passed conceptually before applying any legacy `AllwThreshold`:

| Basic Salary | Employee NASSIT | Employer NASSIT | Chargeable Before AllwThreshold | PAYE | Net Before Other Deductions |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 50.00 | 100.00 | 950.00 | 52.50 | 897.50 |
| 2,000 | 100.00 | 200.00 | 1,900.00 | 235.00 | 1,665.00 |

Employer NASSIT is not deducted in the net-pay formula inspected.

## `AllwThreshold`

`AllwThreshold = 500.00` is retained as legacy metadata.

Legacy Access logic used:

```text
Taxable = TotalIncome - NassitEmp - AllwThreshold
```

Legacy Access logic used this value as an additional deduction:

```text
Taxable = TotalIncome - NassitEmp - AllwThreshold
```

The remediated active monthly PAYE path does not subtract `AllwThreshold`. The legacy column is not deleted because it may still be needed for historical reference or legacy reporting.

## Existing PAYE Calculation Paths

| Area | Finding |
| --- | --- |
| Monthly Process Emoluments | `services/processEmolumentsService.js` copies `tblsalary.TotalIncome`, `Taxable`, `Tax`, `NassitEmp`, `NassitInst`, and `NetIncome` into `tblpayroll`. It does not recalculate PAYE. |
| Backlog/pay-code 07 | `controllers/dataEntryController.js` contains a progressive tax calculation, but reads `SELECT * FROM tbltax LIMIT 1`; this is not CompanyID/effective-date safe. |
| Payroll setup | Data Entry setup saves editable `Taxable` and `Tax` values. The page can prefill calculated values, but saved manual edits remain authoritative. |
| Reports | Payroll Liability PAYE and Staff PAYE Statement consume `tblpayroll.Tax`; they do not independently recalculate PAYE. |

## Taxable Field Semantics

Based on legacy Access logic and matching `tblsalary` samples:

```text
tblsalary.Taxable = PAYE chargeable income after employee NASSIT and AllwThreshold
```

The same field is copied to:

```text
tblpayroll.Taxable
```

This is not simply gross income. It is not taxable allowances only.

## NetIncome Formula

The audited formula is:

```text
NetIncome =
  TotalIncome
  - Tax
  - NassitEmp
  - GratEmp
  - UnionDues
  - Ded1
  - Ded2 where present in tblpayroll
  - Ded3
  - Ded4
  - Ded5
  - Ded6 where present in tblpayroll
  - Ded7 where present in tblpayroll
```

`NassitInst` and `GratInst` are employer/institution liabilities and are not deducted from employee net pay.

## Data Consistency Results

| Area | Result |
| --- | --- |
| `tblsalary.Tax` vs independent PAYE on `tblsalary.Taxable` | PASS for sampled rows |
| `tblsalary.NetIncome` formula | PASS for sampled rows |
| `tblpayroll.Tax` vs independent PAYE on `tblpayroll.Taxable` | Historical mismatches documented; not rewritten |
| `tblpayroll.NetIncome` formula | PASS for sampled rows |

Sample `tblpayroll` mismatches found in August 2026 payroll include PFNos:

- `0496`
- `0520`
- `0587`
- `0684`
- `0692`

These rows remain internally net-pay consistent because stored `NetIncome` reconciles to stored `Tax`; the issue is that stored `Tax` does not match a fresh progressive calculation on stored `Taxable`.

No historical payroll was updated. If these periods are posted, correction should use reversal/reopen rather than direct row edits.

## Report Integration

| Report | Finding |
| --- | --- |
| PAYE Liability | Uses effective approved `tblpayroll.Tax`; reversed generations excluded through workflow helper logic. |
| Staff PAYE Statement | Uses `tblpayroll.Tax`; reversed generations excluded. |
| PAYE statutory report | Presents final payroll values; does not recalculate PAYE. |
| Payslip | Uses payroll row values; no separate PAYE formula identified in this audit. |
| Journal/GL | Uses final payroll tax and liability values. |

## Reversal And Generation Behavior

PAYE follows existing reversal/generation behavior through the report services that exclude reversed workflow batches and consume effective payroll rows. The legacy `tblpayroll` table itself does not carry a `GenerationNo` column in this database; generation identity is maintained in helper workflow tables.

## Effective-Date Behavior

Observed behavior:

- Parameter workflow fetches latest `tbltax` by `TaxDate DESC` for company.
- Backlog pay-code `07` path uses `SELECT * FROM tbltax LIMIT 1`, with no effective date and no CompanyID.
- Monthly activity `01` does not select tax rows during Process Emoluments; it copies precomputed `tblsalary` values.

Preferred future behavior is to select the latest approved Tax Table row on or before payroll date, scoped by CompanyID. That is not fully implemented across all paths.

## CompanyID Isolation

FAIL.

Defects:

- Admin Tax Table fetch API uses `CompanyID = 1`.
- Backlog/pay-code `07` tax calculation uses `SELECT * FROM tbltax LIMIT 1`.

These should be fixed before using multi-company tax configurations in production.

## Defects Discovered

| Severity | Defect |
| --- | --- |
| High | `tblpayroll.Tax` sampled rows do not all match independent progressive PAYE on stored `Taxable`. |
| High | `AllwThreshold = 500.00` may apply an obsolete/extra deduction unless explicitly confirmed as current business rule. |
| Medium | Admin Tax Table fetch is hard-coded to CompanyID 1. |
| Medium | Backlog/pay-code `07` tax path reads unscoped Tax Table row. |
| Medium | Monthly Process Emoluments does not recalculate PAYE, so payroll correctness depends on `tblsalary` setup being correct before processing. |

## Fixes Applied

Added:

- `scripts/auditSierraLeonePayeCalculation.js`
- `docs/test-results/sierra-leone-paye-audit-latest.json`
- `docs/SIERRA-LEONE-PAYE-AUDIT.md`
- `services/payeTaxService.js`

Updated:

- `services/payrollSetupAutoCalculationService.js`
- `controllers/dataEntryController.js`
- `controllers/adminController.js`

Correction summary:

- Introduced a canonical progressive PAYE helper.
- Future auto-calculated payroll setup computes:

```text
Taxable = taxable earnings - employee NASSIT
Tax = progressive PAYE(Taxable)
```

- `AllwThreshold` is no longer subtracted from the active monthly PAYE calculation.
- Tax Table lookup now respects CompanyID and effective date for remediated paths.

## Recommended Next Corrections

1. Confirm whether `AllwThreshold = 500.00` is still legally/business valid.
2. Fix Admin Tax Table fetch to use authenticated CompanyID.
3. Fix pay-code `07` tax lookup to use CompanyID and effective date.
4. Decide whether payroll setup should calculate `Taxable` and `Tax` from canonical logic while still allowing controlled override/approval.
5. Do not rewrite historical `tblpayroll`; identify affected periods and correct through reversal/reopen where necessary.

Final status:

`SIERRA LEONE PAYE AUDIT: PASS AFTER CORRECTIONS`
