# WAEC August 2026 Batch 161 - Final Reopen Safety Check

Generated: 2026-10-09

## Scope

This was a read-only investigation.

No payroll rows, workflow batches, GL rows, staff records, entitlement records, salary records, reversal records, reopen records, or approval records were modified.

Company: CompanyID 1

Payroll under review:

- Period: August 2026
- PType: `01`
- Workflow batch: `161`
- Current status: `PROCESSED`
- Modern GL posted: No

## Current Payroll State

| Item | Finding |
| --- | --- |
| Workflow batch | `payroll_workflow_batches.id = 161` |
| Generation | `1` |
| Status | `PROCESSED` |
| Staff count | 6 |
| Modern GL posting batch | None |
| `tblpayroll.posted_to_gl` | 0 posted rows |
| `tblpayroll.gl_posted_batch_id` / `GlPostedBatchId` | No linked rows |
| Existing reversal request | None |
| Existing reopen request | None |

Current outdated batch 161 totals:

| Component | Current Batch 161 |
| --- | ---: |
| Basic Salary | 45,296.78 |
| Allowances | 45,247.30 |
| Gross Income | 90,544.08 |
| PAYE | 23,210.37 |
| Employee NASSIT | 1,951.64 |
| Employer NASSIT | 3,903.32 |
| Net Income | 61,454.75 |

## Legacy GL Transaction

One August 2026 row exists in `tblgltrans`.

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

The row is related to batch 161 because its totals match the old August payroll values and the salary process inserts or updates `tblgltrans` during payroll processing.

It is not a modern accounting posting because:

- no modern `payroll_gl_posting_batches` row exists;
- no August `tblpayroll` rows are marked posted;
- no August payroll rows are linked to a GL posting batch;
- `tblgltrans.Approved = 0`;
- `ApprovedBy`, `DateApproved`, `operatedby`, and `DateKeyedIn` are empty.

Conclusion:

The row is best treated as an unapproved legacy processing summary, not as a completed Post-to-Accounts transaction.

## Supported Workflow Findings

### Posted-Payroll Reopen Workflow

The Phase 15 reopen workflow is designed for this sequence:

`POSTED_TO_ACCOUNTS -> formal reversal -> REVERSED -> reopen request -> approval chain -> Generation 2 -> reprocess`

The reopen service requires:

- original batch status = `REVERSED`;
- a successful reversal request;
- reversal GL lines;
- no later generation.

Batch 161 does not meet those requirements because it is `PROCESSED`, not `POSTED_TO_ACCOUNTS` or `REVERSED`, and it has no successful reversal.

Finding:

Do not use the posted-payroll reopen workflow for batch 161 in its current state.

### Direct Reprocessing

The Process Emoluments service blocks direct reprocessing when an existing batch is `PROCESSED`.

Relevant behavior:

- Direct reprocessing of an existing `PROCESSED` batch is rejected.
- The user must use the controlled correction or restart workflow first.

Finding:

Do not directly rerun Process Emoluments against batch 161 while it remains plain `PROCESSED`.

### Controlled Correction Workflow

The existing workflow supports correction for batches that have been returned or rejected.

Supported path for this unposted batch:

1. Finance submits batch 161 to Manager.
2. Manager returns the batch for correction with a clear reason, such as `incomplete salary payroll data / April 2026 salary review approved`.
3. Finance starts controlled correction from the workflow detail page.
4. Batch 161 moves to `CORRECTION_IN_PROGRESS`.
5. Finance reruns Process Emoluments in correction mode for August 2026, PType `01`.
6. Existing unposted August `tblpayroll` rows are removed and replaced.
7. Workflow batch 161 is updated back to `PROCESSED` with the corrected totals.
8. The corrected batch then goes through the normal approval chain before Post to Accounts.

Finding:

This is the safest currently supported method for replacing the outdated unposted August payroll.

## Generation Preservation Finding

The system supports a new payroll generation when a posted payroll has been reversed and reopened.

For batch 161:

- Current status is `PROCESSED`.
- It has not been posted.
- It has not been reversed.
- Therefore the Phase 15 Generation 2 path is not available without first posting and reversing the bad payroll, which is not recommended.

Expected correction behavior:

- Batch 161 remains the workflow batch.
- Prior batch totals are preserved in workflow action metadata when correction is started.
- Existing unposted `tblpayroll` rows are replaced by corrected rows.
- The legacy `tblgltrans` row is not generation-aware and cannot preserve old-versus-new generations by itself.

Condition:

If WAEC requires a separate Generation 2 audit trail for an unposted processed payroll, that is not supported by the current reopen workflow and would require a separate approved change. Do not force this by posting and reversing the bad payroll.

## Replacement Salary Source

The approved April 2026 salary setup is now the latest approved `tblsalary` source for the six WAEC employees.

All six records are eligible for full-pay August salary processing:

- staff CompanyID = 1;
- staff approved;
- salary CompanyID = 1;
- salary approved;
- latest salary `PDate = 2026-04-01`;
- `FullPay` enabled;
- `HalfPay = 0`;
- `WithoutPay = 0`;
- `Posted = 0`.

Expected replacement totals from approved salary setup:

| Component | Expected Replacement |
| --- | ---: |
| Basic Salary | 50,840.69 |
| Allowances | 77,508.20 |
| Gross Income | 128,348.89 |
| Taxable Income | 125,806.85 |
| PAYE | 35,582.06 |
| Employee NASSIT | 2,542.04 |
| Employer NASSIT | 5,084.07 |
| Employee Provident Fund / Gratuity | 5,084.07 |
| Net Income | 85,140.72 |

These values reconcile with the August 2026 Excel reference except for the already documented PAYE formula difference.

## Provident Fund vs Employer NASSIT

The Excel workbook's separate 10% Provident Fund employee deduction must not be confused with employer NASSIT.

Current system distinction:

- Employee NASSIT: `NassitEmp`, 5%, employee deduction.
- Employer NASSIT: `NassitInst`, 10%, employer liability.
- Employee Provident/Gratuity deduction: `GratEmp`, 10%, employee deduction.
- Legacy `tblgltrans.ProvidentEmp` is populated from `tblpayroll.GratEmp`, not from `NassitInst`.

For the six approved salary rows:

- Employee NASSIT = 2,542.04
- Employer NASSIT = 5,084.07
- Employee Provident/Gratuity = 5,084.07

The matching 10% totals are expected because both are based on salary, but they are different payroll concepts.

## Legacy GL Risk

The legacy `tblgltrans` table is month-level and not generation-aware.

The salary processing service writes the August summary using `INSERT ... ON DUPLICATE KEY UPDATE` keyed by the legacy GL period. Therefore, if corrected August Process Emoluments is run, the existing unapproved August `tblgltrans` row is expected to be superseded with corrected summary totals rather than preserved as a separate row.

Risk:

- Leaving the row intact without recording its current state could obscure the old processing-summary values after corrected processing.
- Deleting the row manually is not recommended and is not authorized by this review.
- Treating the row as a completed accounting posting would be incorrect based on current evidence.

Recommended handling:

1. Preserve the current row in documentation/evidence before correction.
2. Obtain explicit authorization that the unapproved legacy processing summary may be superseded by corrected August processing.
3. After corrected processing, verify `tblgltrans` reflects corrected summary totals and remains unapproved until the appropriate accounting step.
4. Use the modern Post-to-Accounts workflow only after normal payroll approval is complete.

## Recommended Procedure

The safest supported correction procedure is:

1. Take a fresh database backup.
2. Preserve read-only evidence of batch 161 and the current legacy `tblgltrans` row.
3. Confirm client authorization to supersede the unapproved legacy August processing summary.
4. Finance submits batch 161 to Manager.
5. Manager returns batch 161 for correction with reason: `incomplete salary payroll data / April 2026 salary review approved`.
6. Finance starts payroll correction on batch 161 with the same reason.
7. Finance runs Process Emoluments in correction mode for August 2026, PType `01`.
8. Verify replacement payroll totals:
   - Basic Salary: 50,840.69
   - Allowances: 77,508.20
   - Gross Income: 128,348.89
   - PAYE: 35,582.06
   - Employee NASSIT: 2,542.04
   - Net Income: 85,140.72
9. Verify `tblgltrans` now reflects the corrected unapproved processing summary, or document any variance.
10. Finance submits corrected payroll to Manager.
11. Manager, Auditor, and Entity Head/HNO complete normal approvals.
12. Only after final approval, Finance posts to accounts through the modern Post-to-Accounts workflow.

## Actions Requiring Explicit Authorization

The following actions must not be performed without explicit user/client authorization:

- Submit batch 161 to Manager.
- Return batch 161 for correction.
- Start correction on batch 161.
- Rerun Process Emoluments for August 2026.
- Allow the legacy `tblgltrans` August summary row to be superseded.
- Submit the corrected payroll for approval.
- Post corrected August payroll to accounts.
- Any manual handling of the legacy `tblgltrans` row.

## Actions Not Recommended

- Do not delete the legacy `tblgltrans` row manually.
- Do not post the outdated payroll merely to create reversal eligibility.
- Do not use Phase 15 reopen/generation workflow while batch 161 is unposted and unreversed.
- Do not manually edit `tblpayroll` rows.
- Do not manually edit GL rows to force reconciliation.
- Do not change PAYE/NASSIT/provident formulas to match workbook differences.

## Final Assessment

| Item | Result |
| --- | --- |
| Legacy GL transaction inspected | PASS |
| Legacy GL classification | Related unapproved processing summary |
| Batch 161 modern GL posted | No |
| Batch 161 eligible for Phase 15 reopen now | No |
| Batch 161 eligible for direct rerun now | No |
| Supported correction path exists | Yes, controlled correction after Manager return |
| New generation supported for this unposted batch | No |
| Replacement payroll will use approved April 2026 salary rows | Yes |
| Duplicate accounting risk | Manageable if legacy summary is treated as superseded processing evidence, not a posted accounting entry |

FINAL STATUS: SAFE_WITH_CONDITIONS
