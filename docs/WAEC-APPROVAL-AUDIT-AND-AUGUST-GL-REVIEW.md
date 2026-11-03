# WAEC Approval Audit and August GL Safety Review

Generated: 2026-10-09

## Scope

This review investigated the completed April 2026 WAEC salary-review approvals and the unapproved August 2026 legacy GL row.

No August payroll cancellation, reopening, reversal, regeneration, posting, staff update, entitlement update, salary update, GL update, or historical audit backfill was performed.

Company: CompanyID 1

Employees:

- 0489 - Matilda Jusu
- 0496 - Festus C. Campbell
- 0692 - Georgiana James
- 0520 - Abass P. Renner
- 0684 - Chernor Sankoh
- 0587 - Basiru A. Waheed Sawyer

## Approval Audit Investigation

### Staff Approvals

Manager staff approval is handled in `controllers/managerController.js` through the `postApproveStaff` route family. That path already used `controllerAuditHelper.auditUpdate`, so staff approval changes were written to `tblaudittrail`.

Verified historical evidence:

- 6 staff approval audit rows found.
- Form: `manager/approve/new-staff`
- Field: `Approved`
- Old value: `0`
- New value: `1`
- CompanyID: 1

### Entitlement Approvals

Manager entitlement approval is handled by `postApproveEntitlement` in `controllers/managerController.js`.

Root cause found:

- The route updated `tblentitle` directly.
- It did not call the centralized audit helper or `auditTrailService`.
- The source table contains Manager approval metadata, but `tblaudittrail` has no matching historical entitlement approval rows for these six records.

Historical evidence available:

- `tblentitle.Approved = -1`
- `tblentitle.ApprovedBy = Manager`
- `tblentitle.DateApproved` and `TimeApproved` are populated for all six records.

Historical audit limitation:

- No retroactive `tblaudittrail` rows were created.
- The source-table metadata is valid approval evidence, but it is not centralized audit evidence.

### Salary Approvals

Manager salary approval is handled by `postApproveSalary` in `controllers/managerController.js`.

Root cause found:

- The route updated `tblsalary` directly.
- It did not call the centralized audit helper or `auditTrailService`.
- The source table contains Manager approval metadata, but `tblaudittrail` has no matching historical salary approval rows for these six records.

Historical evidence available:

- `tblsalary.Approved = -1`
- `tblsalary.ApprovedBy = Manager`
- `tblsalary.DateApproved` and `TimeApproved` are populated for all six records.
- `tblsalary.PDate = 2026-04-01` for the April 2026 salary-review setup.

Historical audit limitation:

- No retroactive `tblaudittrail` rows were created.
- The source-table metadata is valid approval evidence, but it is not centralized audit evidence.

## Code Correction

Future Manager entitlement and salary approvals now use a transactional audit path in `controllers/managerController.js`.

Correction implemented:

- Added a strict transactional approval-audit helper.
- Added future audit logging for `tblentitle` approvals.
- Added future audit logging for `tblsalary` approvals.
- Kept existing Manager authorization and CSRF-protected POST routes.
- Added CompanyID-scoped salary approval list, view, and POST filtering.
- Audit write and approval update now commit together for these two routes.
- If the future audit write fails, the approval update is rolled back.

Important historical boundary:

- The already-completed WAEC approvals were not changed.
- No historical audit rows were fabricated or backdated.

## Approved Salary Data Verification

All six approved salary records remain unchanged and match the expected approved setup totals.

| Component | Expected | Approved `tblsalary` | Difference |
| --- | ---: | ---: | ---: |
| Basic Salary | 50,840.69 | 50,840.69 | 0.00 |
| Allowances | 77,508.20 | 77,508.20 | 0.00 |
| Gross Income | 128,348.89 | 128,348.89 | 0.00 |
| Taxable Income | 125,806.85 | 125,806.85 | 0.00 |
| PAYE | 35,582.06 | 35,582.06 | 0.00 |
| Employee NASSIT | 2,542.04 | 2,542.04 | 0.00 |
| Net Income | 85,140.72 | 85,140.72 | 0.00 |

Transport and COLA values remain intact in the approved salary setup.

## August 2026 Payroll Batch 161

Workflow status:

| Batch | CompanyID | Period | PType | Status | Staff | Basic | Gross | Net |
| ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: |
| 161 | 1 | 08/2026 | 01 | PROCESSED | 6 | 45,296.78 | 90,544.08 | 61,454.75 |

Modern GL posting status:

- `tblpayroll.posted_to_gl`: 0 posted rows.
- `tblpayroll.gl_posted_batch_id`: no linked rows.
- `tblpayroll.GlPostedBatchId`: no linked rows.
- `payroll_gl_posting_batches`: no CompanyID 1 August 2026 activity `01` posting batch.

Conclusion:

- Batch 161 is not posted through the current Post-to-Accounts workflow.

## Legacy August GL Transaction

One legacy August 2026 row exists in `tblgltrans`.

Observed row:

| Field | Value |
| --- | --- |
| CompanyID | 1 |
| GLMonth | 8 |
| GLYear | 2026 |
| GLDate | 2026-08-21 |
| BasicSalary | 31,197.87 |
| Headquarters | 26,206.46 |
| Responsibility | 3,723.62 |
| MaidAllowance | 3,723.62 |
| StaffWelfare | 0.00 |
| Transport | 16,875.00 |
| COLA | 1,950.00 |
| Risk | 1,402.05 |
| Acting | 0.00 |
| Professional | 0.00 |
| Academic | 2,465.46 |
| IncomeTax | 23,210.37 |
| NassitEmp | 1,951.64 |
| ProvidentEmp | 3,903.32 |
| SalaryWages | 61,454.75 |
| Approved | 0 |
| ApprovedBy | NULL |
| DateApproved | NULL |
| operatedby | NULL |
| DateKeyedIn | NULL |

Classification:

`RELATED_LEGACY_PROCESSING_SUMMARY_UNAPPROVED`

Reasoning:

- The row is CompanyID 1 and August 2026.
- It matches the old August payroll totals in batch 161 and `tblpayroll`.
- The legacy payroll-processing code inserts `tblgltrans` monthly summary rows during payroll processing.
- The row is not a modern `payroll_gl_posting_batches` posting.
- It is unapproved and has no modern posting-batch linkage.

## GL Safety Assessment

| Question | Finding |
| --- | --- |
| Is batch 161 genuinely unposted in the modern GL workflow? | Yes. |
| Does a modern GL posting batch reference batch 161? | No. |
| Are August payroll rows marked posted? | No. |
| Was a legacy payroll liability summary row created? | Yes, one unapproved `tblgltrans` row. |
| Does the legacy row prove modern posting? | No. |
| Could duplicate/stale GL evidence be created if August is reprocessed without review? | Yes, the legacy row should be reviewed/handled by an authorized accounting step before reprocessing/posting. |
| Does this review authorize reopening batch 161? | No. |

Recommended next action:

1. Do not post, cancel, reopen, reverse, or regenerate August payroll until the user explicitly authorizes the next payroll action.
2. Before any August reprocessing, decide how to handle the unapproved legacy `tblgltrans` row through an authorized accounting/data governance step.
3. If August is later reopened/reprocessed, confirm the legacy summary row does not remain as stale evidence alongside corrected payroll totals.

## Regression Results

Commands run:

| Command | Result |
| --- | --- |
| `node --check controllers/managerController.js` | PASS |
| `node --check scripts/testWaecApprovalAuditAndGlReview.js` | PASS |
| `node scripts/testWaecApprovalAuditAndGlReview.js` | PASS |

Evidence file:

`docs/test-results/waec-approval-audit-and-august-gl-review-latest.json`

Summary from evidence script:

- Staff approval audit rows: 6
- Entitlement approval audit rows: 0
- Salary approval audit rows: 0
- Future salary approval audit patch present: true
- Future entitlement approval audit patch present: true
- Transactional approval audit helper present: true
- Legacy GL classification: `RELATED_LEGACY_PROCESSING_SUMMARY_UNAPPROVED`
- Safe to reopen: `REQUIRES_AUTHORIZATION_AND_LEGACY_GL_REVIEW`

## Final Status Matrix

| Item | Status |
| --- | --- |
| Approval audit investigation | PASS |
| Future approval audit logging | PASS |
| Historical approval evidence | INCOMPLETE |
| Legacy August GL classification | RELATED |
| August batch 161 safe to reopen | REQUIRES AUTHORIZATION |

FINAL STATUS: WAEC APPROVAL AUDIT AND GL REVIEW: PASS WITH HISTORICAL AUDIT LIMITATIONS
