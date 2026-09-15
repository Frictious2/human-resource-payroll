# Training Change Log

Effective audit baseline: Thursday, August 20, 2026

## Finance Officer

- Finance now has a dedicated dashboard and sidebar.
- Process Emoluments remains the payroll processing entry point.
- Monthly payroll must move through:
  - Finance submission
  - Manager endorsement
  - Auditor review
  - Entity Head/HNO final approval
  - Post to Accounts
- Returned payroll batches now use controlled correction instead of ad hoc reruns.
- Posted payroll reversal is controlled and approval-based.
- Reopened payroll after reversal creates a new generation and must pass the full chain again.

## Manager

- Manager endorses sensitive records; Manager does not give final approval.
- Manager endorses payroll to Auditor.
- Manager endorses payroll reversal requests.
- Manager endorses payroll reopen requests.
- Returned items require comments.

## Auditor

- Auditor reviews payroll detail and source-linked deductions.
- Auditor forwards payroll to Entity Head/HNO.
- Auditor reviews payroll reversal requests.
- Auditor reviews payroll reopen requests.

## Entity Head / HNO

- Entity Head/HNO performs final approval for:
  - monthly payroll
  - sensitive HR records
  - parameter changes
  - payroll reversals
  - payroll reopen requests
- Entity Head/HNO remains read-only outside dedicated approval actions.

## Data Entry Officer

- Sensitive HR and payroll-related records now use draft → submit → endorse → final approve workflow.
- Returned items must be corrected and resubmitted instead of directly edited after submission.
- Final approval status now controls operational effect for integrated modules.

## Administrator

- Controlled parameter changes now use proposal → HNO approval instead of immediate live-table writes.
- Payroll activities / pay types now follow parameter-change approval flow.
- User onboarding still depends on the chosen SMTP posture or manual password setup process.

## Cross-Role Changes

- Unified work queue added by role.
- In-app notifications added by workflow action.
- Profile page allows only name, email, and password maintenance.
- Theme toggle and role dashboards should be included in training walkthroughs.

## Trainer Notes

- Demonstrate the difference between:
  - Manager endorsement
  - Auditor review
  - final Entity Head/HNO approval
- Explain generation-aware payroll history:
  - Generation 1 posted and reversed
  - Generation 2 reopened, reprocessed, reapproved, reposted
- Clarify that email notifications may be disabled at go-live while in-app notifications remain active.
