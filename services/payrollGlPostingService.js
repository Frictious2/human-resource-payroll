const payrollGlQueryService = require('./payrollGlQueryService');
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

function buildPostingComponents(record) {
    return [
        {
            payComponentCode: 'BASIC_SALARY',
            employeeId: record.employee_id,
            amount: roundMoney(record.basic_salary),
            sourceTable: 'tblpayroll',
            sourceRecordId: Number.isFinite(record.employee_id) ? record.employee_id : null
        },
        {
            payComponentCode: 'ALLOWANCES',
            employeeId: record.employee_id,
            amount: roundMoney(record.allowances_total),
            sourceTable: 'tblpayroll',
            sourceRecordId: Number.isFinite(record.employee_id) ? record.employee_id : null
        },
        {
            payComponentCode: 'PAYE',
            employeeId: record.employee_id,
            amount: roundMoney(record.paye),
            sourceTable: 'tblpayroll',
            sourceRecordId: Number.isFinite(record.employee_id) ? record.employee_id : null
        },
        {
            payComponentCode: 'NASSIT_EMPLOYEE',
            employeeId: record.employee_id,
            amount: roundMoney(record.nassit_employee),
            sourceTable: 'tblpayroll',
            sourceRecordId: Number.isFinite(record.employee_id) ? record.employee_id : null
        },
        {
            payComponentCode: 'LOAN_DEDUCTION',
            employeeId: record.employee_id,
            amount: roundMoney(record.loan_deduction),
            sourceTable: 'tblpayroll',
            sourceRecordId: Number.isFinite(record.employee_id) ? record.employee_id : null
        },
        {
            payComponentCode: 'NET_PAY',
            employeeId: record.employee_id,
            amount: roundMoney(record.net_pay),
            sourceTable: 'tblpayroll',
            sourceRecordId: Number.isFinite(record.employee_id) ? record.employee_id : null
        }
    ].filter((component) => component.amount > 0);
}

function getDefaultSalaryMappings() {
    return [
        { pay_component_code: 'BASIC_SALARY', gl_account_code: '90102', gl_account_name: 'Basic Salary Expense', entry_type: 'debit' },
        { pay_component_code: 'ALLOWANCES', gl_account_code: '90115', gl_account_name: 'Allowance Expense', entry_type: 'debit' },
        { pay_component_code: 'PAYE', gl_account_code: '50109', gl_account_name: 'PAYE Payable', entry_type: 'credit' },
        { pay_component_code: 'NASSIT_EMPLOYEE', gl_account_code: '90106', gl_account_name: 'NASSIT Employee Payable', entry_type: 'credit' },
        { pay_component_code: 'LOAN_DEDUCTION', gl_account_code: '20104', gl_account_name: 'Loan Deductions Payable', entry_type: 'credit' },
        { pay_component_code: 'NET_PAY', gl_account_code: '90103', gl_account_name: 'Net Salaries Payable', entry_type: 'credit' }
    ];
}

function normalizeMappings(mappingRows) {
    const mappingMap = new Map();
    mappingRows.forEach((row) => {
        const key = `${row.pay_component_code}:${row.entry_type}`;
        mappingMap.set(key, {
            glAccountCode: row.gl_account_code,
            glAccountName: row.gl_account_name,
            entryType: row.entry_type
        });
    });
    return mappingMap;
}

function groupPostingComponentsByGlAccount({ companyId, activityCode, postingDate, postingMonth, postingYear, components, mappingRows }) {
    const monthLabel = postingDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const mappingMap = normalizeMappings(mappingRows.length > 0 ? mappingRows : getDefaultSalaryMappings());
    const grouped = new Map();

    components.forEach((component) => {
        const entryType = ['PAYE', 'NASSIT_EMPLOYEE', 'LOAN_DEDUCTION', 'NET_PAY'].includes(component.payComponentCode)
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

async function buildSalaryPostingPayload({ connection, companyId, activityCode, postingDate, postingMonth, postingYear }) {
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

            await payrollGlQueryService.markPayrollRowsPosted(connection, {
                batchId,
                companyId,
                activityCode,
                postingMonth,
                postingYear
            });

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
