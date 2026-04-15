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

## Extending Other Activities

The service is scaffolded so the remaining activity codes can be added on the same direct-schema pattern:

- `02 = Rent Allowance`
- `05 = Inducement`
- `07 = Backlog / Arrears`
- `08 = EOS Benefits`
- `09 = Bonus`
- `13 = Leave Allowance`
- `15 = Long Service`
