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

1. validates that salary and entitlement data are already approved
2. reads the latest approved salary setup rows from `tblSalary`
3. inserts full-pay salary rows into `tblPayroll`
4. inserts half-pay salary rows into `tblPayroll` using the legacy half-pay treatment
5. excludes without-pay rows from insertion
6. runs the related legacy follow-up updates for loan repayments, leave allowance, payday, acting reset, and `tblGLTrans`

## Extending Other Activities

The service is scaffolded so the remaining activity codes can be added on the same direct-schema pattern:

- `02 = Rent Allowance`
- `05 = Inducement`
- `07 = Backlog / Arrears`
- `08 = EOS Benefits`
- `09 = Bonus`
- `13 = Leave Allowance`
- `15 = Long Service`
