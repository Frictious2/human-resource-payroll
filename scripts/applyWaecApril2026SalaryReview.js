const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const payeTaxService = require('../services/payeTaxService');

const COMPANY_ID = 1;
const EFFECTIVE_DATE = '2026-04-01';
const APPLY = process.env.ALLOW_WAEC_APRIL_2026_SALARY_REVIEW === 'true';
const PFNOS = ['0489', '0496', '0692', '0520', '0684', '0587'];
const SOURCE_JSON = path.join('docs', 'test-results', 'waec-august-2026-payroll-reconciliation-before.json');
const OUTPUT_JSON = path.join('docs', 'test-results', 'waec-april-2026-salary-review-latest.json');
const IMPLEMENTATION_MD = path.join('docs', 'WAEC-APRIL-2026-SALARY-REVIEW-IMPLEMENTATION.md');
const CHANGELOG_MD = path.join('docs', 'WAEC-APRIL-2026-STAFF-ENTITLEMENT-CHANGES.md');

function money(value) {
    const n = Number(value || 0);
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

function fmt(value) {
    return money(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function legacyFlag(enabled) {
    return enabled ? -1 : 0;
}

function scaleToGradeNotch(scale) {
    const n = Number(scale);
    if (!Number.isFinite(n) || n <= 0) return null;
    const gradeNumber = Math.trunc(n);
    const notch = Math.max(1, Math.round((n - gradeNumber) * 100));
    return {
        grade: String(gradeNumber).padStart(2, '0') + '00',
        notch
    };
}

function buildTargetFromExcel(row) {
    const salary = money(row.monthlyBasic);
    const allowances = {
        Allw02: 0,
        Allw03: money(row.transport),
        Allw04: 0,
        Allw05: 0,
        Allw06: money(row.cola),
        Allw07: money(row.staffWelfare),
        Allw08: 0,
        Allw09: 0,
        Allw10: money(row.maintenance),
        Allw11: money(row.responsibility),
        Allw12: money(row.maid),
        Allw13: 0,
        Allw14: money(row.acting),
        Allw15: 0,
        Allw16: money(row.professional),
        Allw17: money(row.risk),
        Allw18: 0,
        Allw19: money(row.academic),
        Allw20: 0
    };
    const entitlementFlags = {
        Allw03: allowances.Allw03 > 0,
        Allw04: false,
        Allw06: allowances.Allw06 > 0,
        Allw07: allowances.Allw07 > 0,
        Allw10: allowances.Allw10 > 0,
        Allw11: allowances.Allw11 > 0,
        Allw12: allowances.Allw12 > 0,
        Allw14: allowances.Allw14 > 0,
        Allw16: allowances.Allw16 > 0,
        Allw17: allowances.Allw17 > 0,
        Allw19: allowances.Allw19 > 0
    };
    return {
        pf: row.pf,
        name: row.name,
        designation: row.designation,
        scale: row.scale,
        gradeNotch: scaleToGradeNotch(row.scale),
        salary,
        annual: money(row.yearlyBasic || salary * 12),
        allowances,
        entitlementFlags,
        nassitEmp: money(salary * 0.05),
        nassitInst: money(salary * 0.10),
        gratEmp: money(salary * 0.10),
        gratInst: money(salary * 0.20),
        sourceTotalIncome: money(row.totalIncome),
        sourceTaxable: money(row.taxable),
        sourceTax: money(row.paye),
        sourceNetPay: money(row.netPay)
    };
}

function changed(before, after) {
    return String(before ?? '') !== String(after ?? '');
}

async function query(connection, sql, params = []) {
    const [rows] = await connection.query(sql, params);
    return rows;
}

async function getPayrollItems(connection) {
    const rows = await query(
        connection,
        'SELECT Code, Income, Taxable, Percent, Fixed, TAmount, Freq FROM tblpayrollitems WHERE CompanyID = ? OR CompanyID IS NULL ORDER BY CASE WHEN CompanyID = ? THEN 0 ELSE 1 END, Code',
        [COMPANY_ID, COMPANY_ID]
    );
    const map = new Map();
    rows.forEach((row) => {
        const code = String(row.Code || '').padStart(2, '0');
        if (!map.has(code)) map.set(code, row);
    });
    return map;
}

function isTaxable(item) {
    return item && (item.Taxable === -1 || item.Taxable === 1 || item.Taxable === true || item.Taxable === '-1' || item.Taxable === '1');
}

async function buildSalaryFields(connection, target, staff, latestSalary, payrollItems) {
    const totalAllowance = money(Object.values(target.allowances).reduce((sum, value) => sum + money(value), 0));
    const totalIncome = money(target.salary + totalAllowance);
    const taxableEarnings = money(
        (isTaxable(payrollItems.get('01')) ? target.salary : 0)
        + Object.entries(target.allowances).reduce((sum, [field, value]) => {
            const code = field.replace('Allw', '');
            return sum + (isTaxable(payrollItems.get(code)) ? money(value) : 0);
        }, 0)
    );
    const paye = await payeTaxService.calculateMonthlyPaye({
        companyId: COMPANY_ID,
        payrollDate: new Date(EFFECTIVE_DATE),
        taxableEarnings,
        employeeNassit: target.nassitEmp,
        connection
    });
    const unionDues = 0;
    const ded1 = money(latestSalary?.Ded1 || 0);
    const ded3 = money(latestSalary?.Ded3 || 0);
    const ded4 = money(latestSalary?.Ded4 || 0);
    const ded5 = money(latestSalary?.Ded5 || 0);
    const totalDeduction = money(paye.tax + target.nassitEmp + target.gratEmp + ded1 + unionDues + ded3 + ded4 + ded5);
    return {
        PDate: EFFECTIVE_DATE,
        PFNo: target.pf,
        Dept: staff.CDept,
        Grade: staff.CGrade,
        JobTitle: staff.JobTitle,
        Annual: target.annual,
        Salary: target.salary,
        ...target.allowances,
        TotAllw: totalAllowance,
        TotalIncome: totalIncome,
        Taxable: paye.chargeableIncome,
        Tax: paye.tax,
        NassitEmp: target.nassitEmp,
        NassitInst: target.nassitInst,
        GratEmp: target.gratEmp,
        GratInst: target.gratInst,
        Ded1: ded1,
        UnionDues: unionDues,
        Ded3: ded3,
        Ded4: ded4,
        Ded5: ded5,
        TotalDeduction: totalDeduction,
        NetIncome: money(totalIncome - totalDeduction),
        Operator: 'WAEC April 2026 Salary Review',
        DateKeyed: new Date(),
        TimeKeyed: new Date(),
        Approved: 0,
        ApprovedBy: null,
        DateApproved: null,
        TimeApproved: null
    };
}

async function main() {
    const source = JSON.parse(fs.readFileSync(SOURCE_JSON, 'utf8'));
    const excelRows = source.workbook.employees.filter((row) => PFNOS.includes(row.pf));
    if (excelRows.length !== PFNOS.length) {
        throw new Error(`Expected ${PFNOS.length} Excel rows, found ${excelRows.length}.`);
    }

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'personnel_master',
        port: Number(process.env.DB_PORT || 3306),
        dateStrings: true
    });

    const [engineRows] = await connection.query('SHOW ENGINES');
    const innodb = engineRows.find((row) => row.Engine === 'InnoDB');
    if (!innodb || !['YES', 'DEFAULT'].includes(String(innodb.Support).toUpperCase())) {
        throw new Error('InnoDB is not available. Aborting salary review implementation.');
    }

    const payrollItems = await getPayrollItems(connection);
    const report = {
        generatedAt: new Date().toISOString(),
        mode: APPLY ? 'APPLY' : 'DRY_RUN',
        companyId: COMPANY_ID,
        effectiveDate: EFFECTIVE_DATE,
        augustPayrollTouched: false,
        approvalModel: 'Data Entry submissions created with Approved = 0; Manager approval required in application.',
        employees: [],
        totals: {},
        unresolved: []
    };

    await connection.beginTransaction();
    try {
        for (const row of excelRows) {
            const target = buildTargetFromExcel(row);
            const staffRows = await query(
                connection,
                'SELECT * FROM tblstaff WHERE CompanyID = ? AND PFNo = ? LIMIT 1',
                [COMPANY_ID, target.pf]
            );
            if (!staffRows.length) throw new Error(`Staff ${target.pf} not found in CompanyID ${COMPANY_ID}.`);
            const staff = staffRows[0];
            const entitlementRows = await query(connection, 'SELECT * FROM tblentitle WHERE PFNo = ? LIMIT 1', [target.pf]);
            const entitlement = entitlementRows[0] || {};
            const salaryRows = await query(
                connection,
                'SELECT * FROM tblsalary WHERE CompanyID = ? AND PFNo = ? ORDER BY PDate DESC LIMIT 1',
                [COMPANY_ID, target.pf]
            );
            const latestSalary = salaryRows[0] || {};
            const targetGradeNotch = target.gradeNotch;
            const staffChanges = [];
            const entitlementChanges = [];
            const salaryFields = await buildSalaryFields(connection, target, staff, latestSalary, payrollItems);
            const salaryChanges = [];

            if (targetGradeNotch) {
                if (changed(staff.CGrade, targetGradeNotch.grade)) {
                    staffChanges.push({ field: 'CGrade', oldValue: staff.CGrade, newValue: targetGradeNotch.grade });
                    staffChanges.push({ field: 'GradeCode', oldValue: staff.GradeCode, newValue: targetGradeNotch.grade });
                } else if (changed(staff.GradeCode, staff.CGrade)) {
                    staffChanges.push({ field: 'GradeCode', oldValue: staff.GradeCode, newValue: staff.CGrade });
                }
                if (changed(staff.Notch, targetGradeNotch.notch)) {
                    staffChanges.push({ field: 'Notch', oldValue: staff.Notch, newValue: targetGradeNotch.notch });
                }
            }

            Object.entries(target.entitlementFlags).forEach(([field, enabled]) => {
                const newValue = legacyFlag(enabled);
                if (changed(entitlement[field], newValue)) {
                    entitlementChanges.push({ field, oldValue: entitlement[field] ?? null, newValue });
                }
            });
            if (changed(entitlement.Salary, -1)) {
                entitlementChanges.push({ field: 'Salary', oldValue: entitlement.Salary ?? null, newValue: -1 });
            }

            Object.entries(salaryFields).forEach(([field, value]) => {
                if (['DateKeyed', 'TimeKeyed', 'ApprovedBy', 'DateApproved', 'TimeApproved'].includes(field)) return;
                if (changed(latestSalary[field], value)) {
                    salaryChanges.push({ field, oldValue: latestSalary[field] ?? null, newValue: value });
                }
            });

            if (APPLY) {
                if (staffChanges.length) {
                    await connection.query(
                        `
                            UPDATE tblstaff
                            SET CGrade = ?,
                                GradeCode = ?,
                                Notch = ?,
                                CGradeDate = ?,
                                Approved = 0,
                                KeyedInBy = ?,
                                KeyedIn = ?,
                                KeyTime = ?
                            WHERE CompanyID = ?
                              AND PFNo = ?
                        `,
                        [
                            targetGradeNotch?.grade || staff.CGrade,
                            targetGradeNotch?.grade || staff.GradeCode,
                            targetGradeNotch?.notch || staff.Notch,
                            EFFECTIVE_DATE,
                            'WAEC April 2026 Salary Review',
                            new Date(),
                            new Date(),
                            COMPANY_ID,
                            target.pf
                        ]
                    );
                }

                const entitlementSet = {
                    Salary: -1,
                    Allw03: legacyFlag(target.entitlementFlags.Allw03),
                    Allw04: legacyFlag(target.entitlementFlags.Allw04),
                    Allw06: legacyFlag(target.entitlementFlags.Allw06),
                    Allw07: legacyFlag(target.entitlementFlags.Allw07),
                    Allw10: legacyFlag(target.entitlementFlags.Allw10),
                    Allw11: legacyFlag(target.entitlementFlags.Allw11),
                    Allw12: legacyFlag(target.entitlementFlags.Allw12),
                    Allw14: legacyFlag(target.entitlementFlags.Allw14),
                    Allw16: legacyFlag(target.entitlementFlags.Allw16),
                    Allw17: legacyFlag(target.entitlementFlags.Allw17),
                    Allw19: legacyFlag(target.entitlementFlags.Allw19),
                    KeyedIn: new Date(),
                    Operator: 'WAEC April 2026 Salary Review',
                    TimeKeyed: new Date(),
                    Approved: 0,
                    ApprovedBy: null,
                    DateApproved: null,
                    TimeApproved: null,
                    CompanyID: COMPANY_ID
                };
                if (entitlementRows.length) {
                    const fields = Object.keys(entitlementSet);
                    await connection.query(
                        `UPDATE tblentitle SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE PFNo = ?`,
                        [...fields.map((field) => entitlementSet[field]), target.pf]
                    );
                } else {
                    const allFields = { PFNo: target.pf, ...entitlementSet };
                    const fields = Object.keys(allFields);
                    await connection.query(
                        `INSERT INTO tblentitle (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
                        fields.map((field) => allFields[field])
                    );
                }

                const salarySet = salaryFields;
                if (salaryRows.length) {
                    const fields = Object.keys(salarySet);
                    await connection.query(
                        `UPDATE tblsalary SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE PFNo = ? AND PDate = ? AND (CompanyID = ? OR CompanyID IS NULL)`,
                        [...fields.map((field) => salarySet[field]), latestSalary.PFNo, latestSalary.PDate, COMPANY_ID]
                    );
                } else {
                    const allFields = {
                        ...salarySet,
                        PType: '01',
                        Paid: 0,
                        FullPay: 1,
                        HalfPay: 0,
                        WithoutPay: 0,
                        Linked: 0,
                        Posted: 0,
                        CompanyID: COMPANY_ID
                    };
                    const fields = Object.keys(allFields);
                    await connection.query(
                        `INSERT INTO tblsalary (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
                        fields.map((field) => allFields[field])
                    );
                }
            }

            report.employees.push({
                pf: target.pf,
                name: target.name,
                designation: target.designation,
                scale: target.scale,
                gradeNotch: targetGradeNotch,
                jobTitle: {
                    oldCode: staff.JobTitle,
                    oldName: staff.JobTitleName || null,
                    action: 'No job-title code changed automatically; designation text requires WAEC/code mapping confirmation unless already matched.'
                },
                staffChanges,
                entitlementChanges,
                salaryChanges,
                salaryCalculation: {
                    Salary: salaryFields.Salary,
                    TotAllw: salaryFields.TotAllw,
                    TotalIncome: salaryFields.TotalIncome,
                    Taxable: salaryFields.Taxable,
                    Tax: salaryFields.Tax,
                    NassitEmp: salaryFields.NassitEmp,
                    NassitInst: salaryFields.NassitInst,
                    GratEmp: salaryFields.GratEmp,
                    TotalDeduction: salaryFields.TotalDeduction,
                    NetIncome: salaryFields.NetIncome
                },
                excelReference: {
                    TotalIncome: target.sourceTotalIncome,
                    Taxable: target.sourceTaxable,
                    Tax: target.sourceTax,
                    NetIncome: target.sourceNetPay
                },
                remainingExcelVarianceAfterCanonicalTax: {
                    TotalIncome: money(salaryFields.TotalIncome - target.sourceTotalIncome),
                    Taxable: money(salaryFields.Taxable - target.sourceTaxable),
                    Tax: money(salaryFields.Tax - target.sourceTax),
                    NetIncome: money(salaryFields.NetIncome - target.sourceNetPay)
                },
                approvalState: APPLY ? 'SUBMITTED_TO_MANAGER' : 'DRY_RUN_NOT_APPLIED'
            });
        }

        if (APPLY) {
            await connection.commit();
        } else {
            await connection.rollback();
        }
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.end();
    }

    report.totals = report.employees.reduce((sum, employee) => {
        for (const [key, value] of Object.entries(employee.salaryCalculation)) {
            sum[key] = money((sum[key] || 0) + money(value));
        }
        return sum;
    }, {});

    report.counts = {
        employees: report.employees.length,
        staffChangeEmployees: report.employees.filter((employee) => employee.staffChanges.length).length,
        salaryChangeEmployees: report.employees.filter((employee) => employee.salaryChanges.length).length,
        entitlementChangeEmployees: report.employees.filter((employee) => employee.entitlementChanges.length).length,
        approvedChanges: 0,
        pendingApprovals: APPLY ? report.employees.length : 0
    };

    fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2));
    writeMarkdown(report);

    console.log(JSON.stringify({
        mode: report.mode,
        employees: report.counts.employees,
        staffChangeEmployees: report.counts.staffChangeEmployees,
        salaryChangeEmployees: report.counts.salaryChangeEmployees,
        entitlementChangeEmployees: report.counts.entitlementChangeEmployees,
        pendingApprovals: report.counts.pendingApprovals,
        totals: report.totals,
        outputs: { json: OUTPUT_JSON, implementation: IMPLEMENTATION_MD, changelog: CHANGELOG_MD }
    }, null, 2));
}

function writeMarkdown(report) {
    const lines = [
        '# WAEC April 2026 Salary Review Implementation',
        '',
        `Mode: ${report.mode}`,
        `Effective date: ${report.effectiveDate}`,
        '',
        'August 2026 payroll batch 161 was not cancelled, regenerated, posted, or financially changed.',
        '',
        '## Summary',
        '',
        `- Employees reviewed: ${report.counts.employees}`,
        `- Staff master change submissions: ${report.counts.staffChangeEmployees}`,
        `- Salary setup change submissions: ${report.counts.salaryChangeEmployees}`,
        `- Entitlement change submissions: ${report.counts.entitlementChangeEmployees}`,
        `- Approved changes: ${report.counts.approvedChanges}`,
        `- Pending Manager approvals: ${report.counts.pendingApprovals}`,
        '',
        '## Updated Salary Setup Totals',
        '',
        '| Metric | Total |',
        '| --- | ---: |',
        `| Basic Salary | ${fmt(report.totals.Salary)} |`,
        `| Total Allowances | ${fmt(report.totals.TotAllw)} |`,
        `| Gross Income | ${fmt(report.totals.TotalIncome)} |`,
        `| Taxable Income | ${fmt(report.totals.Taxable)} |`,
        `| PAYE | ${fmt(report.totals.Tax)} |`,
        `| Employee NASSIT | ${fmt(report.totals.NassitEmp)} |`,
        `| Employer NASSIT | ${fmt(report.totals.NassitInst)} |`,
        `| Net Income | ${fmt(report.totals.NetIncome)} |`,
        '',
        '## Employee Results',
        ''
    ];
    for (const employee of report.employees) {
        lines.push(`### ${employee.pf} - ${employee.name}`);
        lines.push('');
        lines.push(`- Excel designation: ${employee.designation}`);
        lines.push(`- Excel scale: ${employee.scale}`);
        lines.push(`- Target grade/notch: ${employee.gradeNotch ? `${employee.gradeNotch.grade} / ${employee.gradeNotch.notch}` : 'Not available'}`);
        lines.push(`- Approval state: ${employee.approvalState}`);
        lines.push('');
        lines.push('| Calculation | Amount |');
        lines.push('| --- | ---: |');
        for (const [key, value] of Object.entries(employee.salaryCalculation)) {
            lines.push(`| ${key} | ${fmt(value)} |`);
        }
        lines.push('');
        lines.push('| Remaining variance vs Excel | Amount |');
        lines.push('| --- | ---: |');
        for (const [key, value] of Object.entries(employee.remainingExcelVarianceAfterCanonicalTax)) {
            lines.push(`| ${key} | ${fmt(value)} |`);
        }
        lines.push('');
    }
    fs.writeFileSync(IMPLEMENTATION_MD, `${lines.join('\n')}\n`);

    const changeLines = [
        '# WAEC April 2026 Staff Entitlement Changes',
        '',
        'No August 2026 payroll rows were changed by this change log.',
        '',
        '| PFNo | Name | Area | Field | Previous | New | Effective Date | Approval State |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |'
    ];
    for (const employee of report.employees) {
        const rows = [
            ...employee.staffChanges.map((change) => ({ area: 'Staff', ...change })),
            ...employee.entitlementChanges.map((change) => ({ area: 'Entitlement', ...change })),
            ...employee.salaryChanges.map((change) => ({ area: 'Salary Setup', ...change }))
        ];
        if (!rows.length) {
            changeLines.push(`| ${employee.pf} | ${employee.name} | None | No change required |  |  | ${report.effectiveDate} | ${employee.approvalState} |`);
        } else {
            rows.forEach((row) => {
                changeLines.push(`| ${employee.pf} | ${employee.name} | ${row.area} | ${row.field} | ${row.oldValue ?? ''} | ${row.newValue ?? ''} | ${report.effectiveDate} | ${employee.approvalState} |`);
            });
        }
    }
    fs.writeFileSync(CHANGELOG_MD, `${changeLines.join('\n')}\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
