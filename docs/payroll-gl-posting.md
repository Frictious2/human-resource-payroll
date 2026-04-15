# Payroll GL Posting Notes

## How posting works
- `POST /data-entry/payroll/gl-posting` accepts `companyId`, `activityCode`, and `postingDate`.
- The controller validates the payload and user role, then calls `postMonthlyPayrollToGL`.
- The service derives `postingMonth` and `postingYear`, validates that payroll exists, validates that payroll is approved, validates that the month has not already been posted to accounts, loads approved payroll rows, loads GL mappings, groups posting components into GL lines, inserts a posting batch, inserts posting lines, marks source payroll rows as posted, writes an audit log, and commits.
- If any step fails, the transaction is rolled back and a failed audit entry is written.

## Duplicate prevention
- Application check: the service queries `payroll_gl_posting_batches` for the same `company_id`, `activity_code`, `posting_month`, and `posting_year`.
- Database check: `payroll_gl_posting_batches` has unique key `uq_payroll_gl_batch`.
- Friendly duplicate message: `This payroll activity has already been posted for the selected month and year.`

## Salary phase-1 assumptions
- The current code uses `tblpayroll` as the monthly payroll results source because it already contains month/year, approval state, earnings, deductions, and net pay.
- The service treats `tblpayroll` as the preferred source over master setup tables.
- A lightweight `posted_to_gl` flag plus `gl_posted_batch_id` and `gl_posted_at` fields are added to `tblpayroll` if they are missing.
- GL posting does not recalculate salary-side deductions. It posts the payroll result rows as already prepared in `tblPayroll`, including any effects previously applied from `tblquery`, `tblloan`, `tblmedical`, and `tblsurcharge`.
- Salary posting groups records into these components:
  - `BASIC_SALARY`
  - `ALLOWANCES`
  - `PAYE`
  - `NASSIT_EMPLOYEE`
  - `LOAN_DEDUCTION`
  - `NET_PAY`

## How to extend other activity codes
- Add a new builder method in `services/payrollGlPostingService.js`, similar to the salary flow.
- Add the activity-specific source query in `services/payrollGlQueryService.js`.
- Add the component mapping rules for that activity in `gl_account_mappings`.
- Update the `postMonthlyPayrollToGL` switch so the new activity code calls its builder.
- Keep the same transaction pattern: source lookup, mapping lookup, grouped lines, batch insert, line insert, source update, audit log.

## Legacy assumptions from personnel_master
- `tblpayroll` is used as the modern monthly payroll result source because it already resembles the result set the legacy Access posting logic relied on.
- `tblglaccounts` informed the starter account seed values, but account numbers are not hardcoded into the posting flow itself.
- The service intentionally does not copy legacy Access queries directly. It recreates the business purpose in grouped, parameterized MySQL queries.
