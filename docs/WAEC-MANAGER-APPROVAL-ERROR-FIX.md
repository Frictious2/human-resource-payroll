# WAEC Manager Approval Error Fix

Generated: 2026-10-08

## Scope

This fix addressed two Manager Dashboard approval defects found during the WAEC April 2026 salary-review approval process.

No entitlement records were approved by this fix. No salary records were approved by this fix. August 2026 payroll batch 161 was not cancelled, regenerated, posted, or modified.

## Error 1 - Entitlement View

Route:

`GET /manager/approve/entitlement/view?pfno=0587`

Observed error:

`companyBBANs is not defined`

Root cause:

`views/manager/approve/entitlement_view.ejs` renders a Company Account Number selector using `companyBBANs`, but `managerController.getApproveEntitlementView` did not load or pass that variable. The Data Entry entitlement page already loads Company BBAN records from `tblpayingbank`; the Manager review page needed the same read-only lookup data.

Correction:

- `managerController.getApproveEntitlementView` now loads `tblpayingbank` records for the authenticated Manager's CompanyID.
- If no BBAN records exist, the page receives an empty array and still renders safely.
- Entitlement list, entitlement view, and entitlement approval update queries were tightened to the authenticated company scope.

BBAN source:

`tblpayingbank`

Relevant columns:

- `BBAN`
- `Short`
- `Bank`
- `CompanyID`

Company scope:

The controller uses the existing `getCompanyId(req)` helper, not a hard-coded CompanyID.

## Error 2 - Staff Notch Validation

Observed error:

`Cannot approve staff 0489: Notch 1 exceeds max 0`

Root cause:

The Manager staff approval path used only `tblgrade.NotchIncr` as the maximum permitted notch. WAEC grade `0100` is a fixed/single-rate grade:

- `tblgrade.NotchIncr = 0`
- latest `tblallowance.Notches = 0`
- pending staff notch = `1`

The salary setup calculation logic treats this kind of fixed grade as valid by allowing notch `1`. Manager approval incorrectly interpreted zero as the maximum permitted notch.

Correction:

- Manager approval validation now reads both `tblgrade.NotchIncr` and latest `tblallowance.Notches`.
- The effective maximum notch is `max(NotchIncr, ScaleNotches, 1)`.
- Missing grade configuration remains blocked.
- Invalid notch values remain blocked.
- Validation now returns a blocking `400` response instead of only logging the problem and continuing.

## Grade/Notch Findings

| PFNo | Employee | Grade | Pending Notch | Grade NotchIncr | Scale Notches | Effective Max Notch | Validation |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 0489 | Matilda Jusu | 0100 | 1 | 0 | 0.00 | 1 | PASS |
| 0496 | Festus C. Campbell | 0400 | 4 | 7 | 7.00 | 7 | PASS |
| 0692 | Georgiana James | 0600 | 3 | 7 | 7.00 | 7 | PASS |
| 0520 | Abass P. Renner | 0700 | 9 | 10 | 10.00 | 10 | PASS |
| 0684 | Chernor Sankoh | 0600 | 1 | 7 | 7.00 | 7 | PASS |
| 0587 | Basiru A. Waheed Sawyer | 1000 | 4 | 10 | 10.00 | 10 | PASS |

## Current Staff Approval State

During this fix pass, no staff approval action was executed automatically.

Database inspection after the user's earlier Manager approval attempts showed the six staff records already had `tblstaff.Approved = 1`, with `ApprovedBy = Manager`, before this fix completed. This indicates the previous code logged the notch error but did not actually block the update. The corrected validation now blocks invalid values before update.

Entitlement and salary records remain pending:

- `tblentitle.Approved = 0` for all six WAEC employees.
- `tblsalary.Approved = 0` for all six WAEC employees.

## Entitlement View Verification

All six entitlement review pages render successfully in the read-only EJS render test:

| PFNo | Result |
| --- | --- |
| 0489 | PASS |
| 0496 | PASS |
| 0692 | PASS |
| 0520 | PASS |
| 0684 | PASS |
| 0587 | PASS |

Additional checks:

- Missing/empty `companyBBANs` renders safely.
- Company-specific BBAN query is scoped by CompanyID.
- Employee entitlement records render with correct staff identity.

## Salary and Payroll Safety

Pending salary totals remain unchanged:

| Component | Total |
| --- | ---: |
| Basic Salary | NLe50,840.69 |
| Allowances | NLe77,508.20 |
| Gross Income | NLe128,348.89 |
| PAYE | NLe35,582.06 |
| Net Income | NLe85,140.72 |

August 2026 payroll for the six WAEC employees remains unchanged:

| Component | Total |
| --- | ---: |
| Rows | 6 |
| Basic Salary | NLe45,296.78 |
| Gross Income | NLe90,544.08 |
| Net Income | NLe61,454.75 |

## Files Modified

- `controllers/managerController.js`
- `scripts/testWaecManagerApprovalErrorFix.js`
- `docs/WAEC-MANAGER-APPROVAL-ERROR-FIX.md`
- `docs/test-results/waec-manager-approval-error-fix-latest.json`

## Test Results

Commands run:

```text
node --check controllers/managerController.js
node --check scripts/testWaecManagerApprovalErrorFix.js
node scripts/testWaecManagerApprovalErrorFix.js
node scripts/testWaecManagerApprovalErrorFix.js > docs/test-results/waec-manager-approval-error-fix-latest.json
```

Results:

- JavaScript syntax checks: PASS
- Six entitlement view render checks: PASS
- Empty BBAN render check: PASS
- Notch validation for all six WAEC staff: PASS
- Invalid notch rejection scenario: PASS
- Missing grade configuration rejection scenario: PASS
- Entitlement records remain pending: PASS
- Salary records remain pending: PASS
- Salary totals unchanged: PASS
- August payroll unchanged: PASS

## Remaining Blockers

No code blocker remains for the two reported errors.

Operational note:

The staff records appear already Manager-approved from the prior manual attempts. Entitlement and salary records are still pending and can be approved through the corrected Manager screens.

FINAL STATUS: WAEC MANAGER APPROVAL ERRORS: FIXED
