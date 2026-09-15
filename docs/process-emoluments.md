# Process Emoluments

## Direct Legacy Schema Version

This version uses the existing `personnel_master` database directly. It does not redesign the payroll schema and does not introduce replacement core payroll tables.

The rebuilt module reads and writes the existing legacy tables such as:

- `tblSalary`
- `tblStaff`
- `tblEntitle`
- `tblPayroll`
- `tblloan`
- `tblloanrepyt`
- `tblLeaveAllowance`
- `tblGLTrans`

## What Process Emoluments Does

The module processes a selected payroll activity for a selected payroll date, derives `PMonth` and `PYear`, and writes the generated payroll rows directly into `tblPayroll`.

## Duplicate Prevention

The monthly duplicate rule is enforced directly in `tblPayroll`.

Before processing, the service checks for existing rows with the same:

- `CompanyID`
- `PType`
- `PMonth`
- `PYear`

If rows already exist for that period and activity, processing is blocked.

## Activity `01` Salary

Phase 1 fully implements `01 = Salary` against the legacy schema.

The service:

1. does not require manager approval before payroll processing
2. reads the latest salary setup rows from `tblSalary`
3. checks approved salary-impacting query rows in `tblquery`
4. applies legacy query reactions such as half pay, without pay, and surcharge markers
5. checks active loan deductions from `tblloan`
6. checks payroll-month medical deductions from `tblmedical`
7. checks active surcharge rows from `tblsurcharge` using `StarDate` and `ExpDate`
8. inserts full-pay, half-pay, and without-pay salary rows into `tblPayroll`
9. refreshes payroll deductions and net income before the follow-up legacy updates run
10. runs the related legacy follow-up updates for loan repayments, leave allowance, payday, acting reset, and `tblGLTrans`

## Legacy Validation Notes

- Manager approval is not a prerequisite for generating payroll rows in `tblPayroll`.
- `tblquery` drives salary-impacting reactions through legacy `MResponse` codes.
- `tblloan` contributes active due deductions to payroll.
- `tblmedical` contributes payroll-month medical deductions.
- `tblsurcharge` contributes date-range surcharge deductions based on `StarDate` and `ExpDate`.

## Post to Accounts Scope

Process Emoluments activity definitions are broader than the currently approved GL posting scope.

As of Friday, August 21, 2026:

- `01 = Salary` is the only activity fully supported for Post to Accounts.
- `13 = Leave Allowance` is handled through salary-side support tables and is not a standalone GL posting activity.
- `14 = Acting` is a salary component (`Allw14`) and is not a standalone GL posting activity.
- `02`, `04`, `05`, `07`, `08`, `09`, and `15` have legacy processing evidence but remain blocked from Post to Accounts until their debit/credit rules are explicitly confirmed.
- `06`, `33`, `40`, `41`, `42`, `00`, and `99` are not currently approved for operational GL posting.

## Extending Other Activities Safely

Do not generalize salary posting logic to other activities. Any future enablement must first verify:

- the source tables and row lifecycle,
- the approved debit and credit accounts,
- grouping and narration rules,
- whether the activity posts through `tblPayroll`, `tblExport`, `tblGLTrans`, or another legacy path,
- whether the activity is monthly, yearly, ad hoc, or event-driven.
