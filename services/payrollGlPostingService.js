const payrollGlQueryService = require('./payrollGlQueryService');
const payrollValidationService = require('./payrollValidationService');
const pool = require('../config/db');

const SUPPORTED_ACTIVITIES = {
    '01': 'Salary',
    '02': 'Rent Allowance',
    '05': 'Inducement',
    '08': 'EOS Benefits',
    '09': 'Bonus',
    '13': 'Leave Allowance',
    '15': 'Long Service'
};

function roundMoney(value) {
    const amount = Number(value || 0);
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function isHeadquartersDepartment(deptCode) {
    return ['06', '12'].includes(String(deptCode || '').trim());
}

function buildPostingComponents(record) {
    const sourceTable = record.source_table || 'tblpayroll';
    const sourceRecordId = Number.isFinite(Number(record.result_id))
        ? Number(record.result_id)
        : (Number.isFinite(Number(record.employee_id)) ? Number(record.employee_id) : null);
    const isHeadquarters = isHeadquartersDepartment(record.Dept || record.dept);
    const level = String(record.Level || record.level || '').trim();

    const basicSalary = roundMoney(record.basic_salary);
    const allw03 = roundMoney(record.allw03);
    const allw04 = roundMoney(record.allw04);
    const allw05 = roundMoney(record.allw05);
    const allw06 = roundMoney(record.allw06);
    const allw07 = roundMoney(record.allw07);
    const allw10 = roundMoney(record.allw10);
    const allw11 = roundMoney(record.allw11);
    const allw12 = roundMoney(record.allw12);
    const allw14 = roundMoney(record.allw14);
    const allw16 = roundMoney(record.allw16);
    const allw17 = roundMoney(record.allw17);
    const allw19 = roundMoney(record.allw19);
    const allw20 = roundMoney(record.allw20);
    const grossPay = roundMoney(record.gross_pay);
    const paye = roundMoney(record.paye);
    const nassitEmployee = roundMoney(record.nassit_employee);
    const gratuityEmployee = roundMoney(record.gratuity_employee);
    const ded1 = roundMoney(record.ded1);
    const ded2 = roundMoney(record.ded2);
    const ded3 = roundMoney(record.ded3);
    const ded4 = roundMoney(record.ded4);

    let salaryAmount = isHeadquarters ? 0 : basicSalary;
    let headquartersAmount = isHeadquarters
        ? roundMoney(
            basicSalary +
            allw03 +
            allw04 +
            allw05 +
            allw06 +
            allw10 +
            allw11 +
            allw12 +
            allw14 +
            allw16 +
            allw17 +
            allw19 +
            allw20
        )
        : 0;
    const transportAmount = isHeadquarters ? 0 : roundMoney(allw03 + allw10);
    const staffWelfareAmount = roundMoney(allw04 + allw07);
    const colaAmount = isHeadquarters ? 0 : allw06;
    const responsibilityAmount = isHeadquarters ? 0 : allw11;
    const maidAmount = isHeadquarters ? 0 : allw12;
    const actingAmount = isHeadquarters ? 0 : allw14;
    const riskAmount = isHeadquarters ? 0 : allw17;
    const professionalAmount = isHeadquarters ? 0 : allw16;
    const academicAmount = isHeadquarters ? 0 : allw19;

    const mappedDebitTotal = roundMoney(
        salaryAmount +
        headquartersAmount +
        transportAmount +
        staffWelfareAmount +
        colaAmount +
        responsibilityAmount +
        maidAmount +
        actingAmount +
        riskAmount +
        professionalAmount +
        academicAmount
    );

    const debitResidual = roundMoney(grossPay - mappedDebitTotal);
    if (Math.abs(debitResidual) > 0.0001) {
        if (isHeadquarters) {
            headquartersAmount = roundMoney(headquartersAmount + debitResidual);
        } else {
            salaryAmount = roundMoney(salaryAmount + debitResidual);
        }
    }

    const salaryAdvanceAmount = ded1;
    const ssaAmount = level === '01' ? ded2 : 0;
    const jsaAmount = level === '02' ? ded2 : 0;
    const interestOnAdvanceAmount = ded3;
    const rentDeductionAmount = ded4;

    // Salary and wages control acts as the balancing control line for legacy
    // deductions that do not have one of the configured 20 GL accounts, such as
    // UnionDues or any residual rounding carried in tblPayroll.
    const salaryWagesAmount = roundMoney(
        grossPay -
        paye -
        nassitEmployee -
        gratuityEmployee -
        ssaAmount -
        jsaAmount -
        salaryAdvanceAmount -
        interestOnAdvanceAmount -
        rentDeductionAmount
    );

    const components = [
        {
            payComponentCode: 'SALARY',
            employeeId: record.employee_id,
            amount: salaryAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'HEADQUARTERS',
            employeeId: record.employee_id,
            amount: headquartersAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'TRANSPORT',
            employeeId: record.employee_id,
            amount: transportAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'STAFF_WELFARE',
            employeeId: record.employee_id,
            amount: staffWelfareAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'COLA',
            employeeId: record.employee_id,
            amount: colaAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'RESPONSIBILITY',
            employeeId: record.employee_id,
            amount: responsibilityAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'MAID',
            employeeId: record.employee_id,
            amount: maidAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'ACTING',
            employeeId: record.employee_id,
            amount: actingAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'RISK',
            employeeId: record.employee_id,
            amount: riskAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'PROFESSIONAL',
            employeeId: record.employee_id,
            amount: professionalAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'ACADEMIC',
            employeeId: record.employee_id,
            amount: academicAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'INCOME_TAX',
            employeeId: record.employee_id,
            amount: paye,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'NASSIT_EMP',
            employeeId: record.employee_id,
            amount: nassitEmployee,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'PROVIDENT_EMP',
            employeeId: record.employee_id,
            amount: gratuityEmployee,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'DED2_SSA',
            employeeId: record.employee_id,
            amount: ssaAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'DED2_JSA',
            employeeId: record.employee_id,
            amount: jsaAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'SALARY_ADVANCE',
            employeeId: record.employee_id,
            amount: salaryAdvanceAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'INTEREST_ON_ADVANCE',
            employeeId: record.employee_id,
            amount: interestOnAdvanceAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'RENT_DEDUCTION',
            employeeId: record.employee_id,
            amount: rentDeductionAmount,
            sourceTable,
            sourceRecordId
        },
        {
            payComponentCode: 'SALARY_WAGES',
            employeeId: record.employee_id,
            amount: salaryWagesAmount,
            sourceTable,
            sourceRecordId
        }
    ];

    return components.filter((component) => component.amount > 0);
}

function getDefaultSalaryMappings() {
    return [
        { pay_component_code: 'SALARY', gl_account_code: '90102', gl_account_name: 'BASIC SALARY', entry_type: 'debit' },
        { pay_component_code: 'HEADQUARTERS', gl_account_code: '40401', gl_account_name: 'HEADQUARTERS', entry_type: 'debit' },
        { pay_component_code: 'RESPONSIBILITY', gl_account_code: '90113', gl_account_name: 'RESPONSIBILITY ALLOW', entry_type: 'debit' },
        { pay_component_code: 'MAID', gl_account_code: '90112', gl_account_name: 'MAID ALLOW', entry_type: 'debit' },
        { pay_component_code: 'STAFF_WELFARE', gl_account_code: '90514', gl_account_name: 'STAFF WELFARE', entry_type: 'debit' },
        { pay_component_code: 'TRANSPORT', gl_account_code: '90115', gl_account_name: 'TRANSPORT ALLOW(CAR MAINT)', entry_type: 'debit' },
        { pay_component_code: 'COLA', gl_account_code: '90117', gl_account_name: 'COST OF LIVING ALLOW', entry_type: 'debit' },
        { pay_component_code: 'RISK', gl_account_code: '90119', gl_account_name: 'RISK', entry_type: 'debit' },
        { pay_component_code: 'ACTING', gl_account_code: '90111', gl_account_name: 'ACTING', entry_type: 'debit' },
        { pay_component_code: 'PROFESSIONAL', gl_account_code: '90120', gl_account_name: 'PROFESSIONAL', entry_type: 'debit' },
        { pay_component_code: 'ACADEMIC', gl_account_code: '90121', gl_account_name: 'ACADEMIC', entry_type: 'debit' },
        { pay_component_code: 'INCOME_TAX', gl_account_code: '50109', gl_account_name: 'INCOME TAX', entry_type: 'credit' },
        { pay_component_code: 'NASSIT_EMP', gl_account_code: '90106', gl_account_name: '5% NASSIT', entry_type: 'credit' },
        { pay_component_code: 'PROVIDENT_EMP', gl_account_code: '90107', gl_account_name: '10% PROVIDENT FUND', entry_type: 'credit' },
        { pay_component_code: 'RENT_DEDUCTION', gl_account_code: '80210', gl_account_name: 'RENT', entry_type: 'credit' },
        { pay_component_code: 'DED2_SSA', gl_account_code: '50401', gl_account_name: 'SSA', entry_type: 'credit' },
        { pay_component_code: 'DED2_JSA', gl_account_code: '50402', gl_account_name: 'JSA', entry_type: 'credit' },
        { pay_component_code: 'SALARY_ADVANCE', gl_account_code: '20104', gl_account_name: 'SALARY ADVANCE', entry_type: 'credit' },
        { pay_component_code: 'INTEREST_ON_ADVANCE', gl_account_code: '80202', gl_account_name: 'INTEREST ON ADVANCE', entry_type: 'credit' },
        { pay_component_code: 'SALARY_WAGES', gl_account_code: '90103', gl_account_name: 'SALARY AND WAGES CONTROL', entry_type: 'credit' }
    ];
}

function normalizeMappings(mappingRows) {
    const mappingMap = new Map();
    mappingRows.forEach((row) => {
        const code = String(row.pay_component_code || '').trim().toUpperCase();
        const entryType = String(row.entry_type || '').trim().toLowerCase();
        const key = `${code}:${entryType}`;
        mappingMap.set(key, {
            glAccountCode: row.gl_account_code,
            glAccountName: row.gl_account_name,
            entryType
        });
    });
    return mappingMap;
}

function groupPostingComponentsByGlAccount({ companyId, activityCode, postingDate, postingMonth, postingYear, components, mappingRows }) {
    const monthLabel = postingDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const mergedMappings = [
        ...(mappingRows || []),
        ...getDefaultSalaryMappings()
    ];
    const mappingMap = normalizeMappings(mergedMappings);
    const grouped = new Map();

    components.forEach((component) => {
        const entryType = ['INCOME_TAX', 'NASSIT_EMP', 'PROVIDENT_EMP', 'DED2_SSA', 'DED2_JSA', 'SALARY_ADVANCE', 'INTEREST_ON_ADVANCE', 'RENT_DEDUCTION', 'SALARY_WAGES'].includes(component.payComponentCode)
            ? 'credit'
            : 'debit';
        const mapping = mappingMap.get(`${component.payComponentCode}:${entryType}`);
        if (!mapping) {
            throw new Error(`No GL mapping was found for component ${component.payComponentCode}.`);
        }

        const key = `${mapping.entryType}:${mapping.glAccountCode}`;
        const existing = grouped.get(key) || {
            companyId,
            activityCode,
            employeeId: null,
            glAccountCode: mapping.glAccountCode,
            glAccountName: mapping.glAccountName,
            entryType: mapping.entryType,
            amount: 0,
            narration: `${monthLabel} ${SUPPORTED_ACTIVITIES[activityCode]} posting`,
            sourceTable: component.sourceTable || 'tblpayroll',
            sourceRecordId: component.sourceRecordId || null
        };

        existing.amount = roundMoney(existing.amount + component.amount);
        grouped.set(key, existing);
    });

    const groupedLines = Array.from(grouped.values()).filter((line) => line.amount > 0);
    const debitTotal = roundMoney(groupedLines
        .filter((line) => line.entryType === 'debit')
        .reduce((sum, line) => sum + line.amount, 0));
    const creditTotal = roundMoney(groupedLines
        .filter((line) => line.entryType === 'credit')
        .reduce((sum, line) => sum + line.amount, 0));

    if (Math.abs(debitTotal - creditTotal) > 0.009) {
        throw new Error('The generated GL posting lines are not balanced. Debits and credits must be equal.');
    }

    return {
        lines: groupedLines,
        debitTotal,
        creditTotal
    };
}

function validateRequiredGlMappings(components, mappingRows) {
    const mergedMappings = [
        ...(mappingRows || []),
        ...getDefaultSalaryMappings()
    ];
    const mappingMap = normalizeMappings(mergedMappings);
    const requiredMappings = new Set();

    components.forEach((component) => {
        if (!component || Number(component.amount || 0) <= 0) {
            return;
        }

        const entryType = ['INCOME_TAX', 'NASSIT_EMP', 'PROVIDENT_EMP', 'DED2_SSA', 'DED2_JSA', 'SALARY_ADVANCE', 'INTEREST_ON_ADVANCE', 'RENT_DEDUCTION', 'SALARY_WAGES'].includes(component.payComponentCode)
            ? 'credit'
            : 'debit';
        requiredMappings.add(`${component.payComponentCode}:${entryType}`);
    });

    const missingMappings = Array.from(requiredMappings).filter((mappingKey) => !mappingMap.has(mappingKey));
    if (missingMappings.length > 0) {
        const error = new Error(`Required GL accounts are missing for: ${missingMappings.join(', ')}.`);
        error.statusCode = 409;
        throw error;
    }
}

async function buildSalaryPostingPayload({ connection, companyId, activityCode, postingDate, postingMonth, postingYear }) {
    await payrollValidationService.validatePayrollBeforePosting(connection, {
        companyId,
        activityCode,
        postingMonth,
        postingYear
    });

    const sourceRows = await payrollGlQueryService.getApprovedMonthlyPayrollRows(connection, {
        companyId,
        activityCode,
        postingMonth,
        postingYear
    });

    if (sourceRows.length === 0) {
        const error = new Error('No approved payroll records found for the selected month and year.');
        error.statusCode = 404;
        throw error;
    }

    const mappingRows = await payrollGlQueryService.getGlMappings(connection, {
        companyId,
        activityCode
    });

    const components = sourceRows.flatMap((row) => buildPostingComponents(row));
    if (components.length === 0) {
        const error = new Error('Payroll not found for the selected month and activity.');
        error.statusCode = 404;
        throw error;
    }

    validateRequiredGlMappings(components, mappingRows);

    const grouped = groupPostingComponentsByGlAccount({
        companyId,
        activityCode,
        postingDate,
        postingMonth,
        postingYear,
        components,
        mappingRows
    });

    return {
        sourceRows,
        postingLines: grouped.lines,
        totalAmount: grouped.debitTotal
    };
}

async function postMonthlyPayrollToGL({ companyId, activityCode, postingDate, postedBy }) {
    const postingMonth = postingDate.getMonth() + 1;
    const postingYear = postingDate.getFullYear();

    try {
        return await payrollGlQueryService.withTransaction(async (connection) => {
            await payrollGlQueryService.ensureInfrastructure(connection);

            const duplicateBatch = await payrollGlQueryService.findExistingBatch(connection, {
                companyId,
                activityCode,
                postingMonth,
                postingYear
            });

            if (duplicateBatch && duplicateBatch.status !== 'reversed') {
                const error = new Error('This payroll activity has already been posted for the selected month and year.');
                error.statusCode = 409;
                throw error;
            }

            let postingPayload;
            if (activityCode === '01') {
                postingPayload = await buildSalaryPostingPayload({
                    connection,
                    companyId,
                    activityCode,
                    postingDate,
                    postingMonth,
                    postingYear
                });
            } else {
                const error = new Error(`Posting logic for activity ${activityCode} has been scaffolded but not implemented yet.`);
                error.statusCode = 501;
                throw error;
            }

            const batchId = await payrollGlQueryService.insertPostingBatch(connection, {
                companyId,
                activityCode,
                postingDate,
                postingMonth,
                postingYear,
                status: 'posted',
                totalLines: postingPayload.postingLines.length,
                totalAmount: postingPayload.totalAmount,
                sourceRecordCount: postingPayload.sourceRows.length,
                postedBy,
                remarks: `${SUPPORTED_ACTIVITIES[activityCode]} posting for ${postingMonth}/${postingYear}`
            });

            await payrollGlQueryService.insertPostingLines(connection, postingPayload.postingLines.map((line) => ({
                batchId,
                companyId,
                activityCode,
                employeeId: line.employeeId,
                glAccountCode: line.glAccountCode,
                glAccountName: line.glAccountName,
                entryType: line.entryType,
                amount: line.amount,
                narration: line.narration,
                sourceTable: line.sourceTable,
                sourceRecordId: line.sourceRecordId
            })));

            const markedRows = await payrollGlQueryService.markPayrollRowsPosted(connection, {
                batchId,
                companyId,
                activityCode,
                postingMonth,
                postingYear
            });

            if (markedRows !== postingPayload.sourceRows.length) {
                const error = new Error('Payroll posting state changed during processing. Please try again.');
                error.statusCode = 409;
                throw error;
            }

            await payrollGlQueryService.insertAuditLog(connection, {
                companyId,
                userId: postedBy,
                action: 'GL_POST',
                activityCode,
                postingMonth,
                postingYear,
                result: 'success',
                referenceId: batchId,
                details: `Posted ${postingPayload.sourceRows.length} payroll record(s) into ${postingPayload.postingLines.length} GL line(s).`
            });

            return {
                success: true,
                batchId,
                postingMonth,
                postingYear,
                activityCode,
                totalLines: postingPayload.postingLines.length,
                totalAmount: postingPayload.totalAmount
            };
        });
    } catch (error) {
        await payrollGlQueryService.withTransaction(async (connection) => {
            await payrollGlQueryService.ensureInfrastructure(connection);
            await payrollGlQueryService.insertAuditLog(connection, {
                companyId,
                userId: postedBy,
                action: 'GL_POST',
                activityCode,
                postingMonth,
                postingYear,
                result: 'failed',
                referenceId: null,
                details: error.message
            });
        }).catch((auditError) => {
            console.error('Failed to write GL posting audit log:', auditError.message);
        });

        throw error;
    }
}

async function getPostingHistory(filters) {
    await payrollGlQueryService.withTransaction(async (connection) => {
        await payrollGlQueryService.ensureInfrastructure(connection);
    });
    return payrollGlQueryService.getPostingHistory(filters);
}

async function getPostingBatchDetail({ companyId, batchId }) {
    await payrollGlQueryService.withTransaction(async (connection) => {
        await payrollGlQueryService.ensureInfrastructure(connection);
    });
    const result = await payrollGlQueryService.getPostingBatchDetail({ companyId, batchId });
    if (!result) {
        const error = new Error('Posting batch not found.');
        error.statusCode = 404;
        throw error;
    }

    const debitTotal = roundMoney(result.lines
        .filter((line) => line.entry_type === 'debit')
        .reduce((sum, line) => sum + Number(line.amount || 0), 0));
    const creditTotal = roundMoney(result.lines
        .filter((line) => line.entry_type === 'credit')
        .reduce((sum, line) => sum + Number(line.amount || 0), 0));

    return {
        batch: result.batch,
        lines: result.lines,
        debitTotal,
        creditTotal
    };
}

async function reversePostingBatch() {
    const error = new Error('GL posting reversal is not yet implemented.');
    error.statusCode = 501;
    throw error;
}

module.exports = {
    buildPostingComponents,
    getPostingBatchDetail,
    getPostingHistory,
    groupPostingComponentsByGlAccount,
    getSupportedActivities: payrollGlQueryService.getSupportedActivities,
    postMonthlyPayrollToGL,
    reversePostingBatch,
    getCompanySummary: async (companyId) => {
        const [rows] = await pool.query(
            `SELECT CompanyID, Com_Name, Address
             FROM tblcominfo
             WHERE CompanyID = ?
             LIMIT 1`,
            [companyId]
        );

        return rows[0] || { CompanyID: companyId, Com_Name: 'Human Resource Payroll', Address: '' };
    }
};
