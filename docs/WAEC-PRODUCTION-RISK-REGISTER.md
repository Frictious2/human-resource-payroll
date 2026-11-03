# WAEC HR & Payroll System - Production Risk Register

Generated: 2026-10-09

| ID | Severity | Area | Risk | Status | Recommended Action | Blocks Staging | Blocks Production |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WAEC-PRD-001 | Critical | Dependencies | `npm audit --omit=dev` reports 1 critical, 4 high, 3 moderate production advisories. | Open | Patch with lockfile-controlled updates and rerun full regression. | Conditional | Yes |
| WAEC-PRD-002 | High | Accounts | No CompanyID 1 Finance Manager account found. | Open | Create/verify real Finance Manager user before staging UAT. | Yes | Yes |
| WAEC-PRD-003 | High | Deployment | Real production `SESSION_SECRET`, DB credentials, HTTPS and proxy are not configured in this local environment. | Open | Configure on target server; do not commit secrets. | No | Yes |
| WAEC-PRD-004 | High | Backup | Backup restore has not been rehearsed on target staging/production infrastructure in this audit. | Open | Restore latest DB dump into temporary DB and verify critical tables. | No | Yes |
| WAEC-PRD-005 | High | Payroll | August 2026 batch 161 remains outdated and unposted; correction requires explicit authorization. | Open | Use documented controlled correction workflow after backup and approval. | No | Yes for live August payroll processing |
| WAEC-PRD-006 | Medium | Legacy GL | One related unapproved August legacy GL processing-summary row exists. | Open | Preserve evidence and approve whether it may be superseded by correction. | No | Yes before August correction/posting |
| WAEC-PRD-007 | Medium | Data Hygiene | Synthetic/UAT users remain in the database. | Open | Remove known test users before staging/prod promotion unless this is an isolated staging DB. | Conditional | Yes |
| WAEC-PRD-008 | Medium | Developer Seeding | Non-production startup can seed/log developer credentials if missing. | Open | Gate seed creation behind explicit env flag before production deployment. | No | Recommended before production |
| WAEC-PRD-009 | Medium | Reports/Test Fixture | Payroll Liability automated test expects a PFNo not present in reduced WAEC data. | Open | Update fixture selection to use available test staff or seed isolated staff in test mode. | No | No if route UAT passes |
| WAEC-PRD-010 | Medium | Naming | Legacy `GratEmp` stores PROV-EMP employee provident fund; some older wording still references gratuity. | Partly mitigated | Confirm final client wording for provident/gratuity statements and reports. | No | Recommended |
| WAEC-PRD-011 | Low | Deferred Scope | Staff Self-Service is not implemented. | Accepted | Keep out of Release 1.0 scope. | No | No |

## Current Defect Counts

| Severity | Count |
| --- | ---: |
| Critical | 1 |
| High | 4 |
| Medium | 6 |
| Low | 1 |
