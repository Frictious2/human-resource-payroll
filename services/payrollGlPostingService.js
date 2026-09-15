const payrollGlQueryService = require('./payrollGlQueryService');
const payrollValidationService = require('./payrollValidationService');
const payrollWorkflowService = require('./payrollWorkflowService');
const pool = require('../config/db');

const ACTIVITY_NAMES = {
    '00': 'Allowances',
    '01': 'Salary',
    '02': 'Rent Allowance',
    '04': 'Welfare',
    '05': 'Inducement',
    '06': 'Gratuity',
    '07': 'Backlog / Arrears',
    '08': 'EOS Benefits',
    '09': 'Bonus',
    '13': 'Leave Allowance',
    '14': 'Acting',
    '15': 'Long Service',
    '33': 'Provident',
    '40': 'Guarantee',
    '41': 'Ex-Gratia',
    '42': 'Death Benefit',
    '99': 'All'
};

const GL_POSTING_POLICY = {
    '01': {
        state: 'SUPPORTED',
        implementationType: 'salary-monthly-payroll',
        processEmolumentsSupport: 'Implemented',
        legacyGlEvidence: 'Verified current tblgltrans salary-style columns, active GL mappings, and posting batches.',
        reason: 'Salary posting is fully implemented, mapped, generation-aware, and regression-tested.'
    },
    '02': {
        state: 'BLOCKED_PENDING_MAPPING',
        implementationType: 'yearly-payment-rent',
        processEmolumentsSupport: 'Not implemented as standalone payroll activity',
        legacyGlEvidence: 'Yearly payment rows exist, but no verified GL mapping rows or posting batches were found.',
        reason: 'Rent Allowance appears in yearly payments, but its dedicated Post to Accounts rule is not verified.'
    },
    '04': {
        state: 'NOT_APPLICABLE',
        implementationType: 'non-payroll-lookup',
        processEmolumentsSupport: 'No standalone payroll processing path found',
        legacyGlEvidence: 'No current GL posting evidence was found.',
        reason: 'Welfare is present as a pay type label, but no monthly payroll or GL posting path was verified.'
    },
    '05': {
        state: 'BLOCKED_PENDING_MAPPING',
        implementationType: 'yearly-payment-inducement',
        processEmolumentsSupport: 'Not implemented as standalone payroll activity',
        legacyGlEvidence: 'Yearly payment rows exist, but no verified GL mapping rows or posting batches were found.',
        reason: 'Inducement has yearly-payment usage but no approved GL posting configuration.'
    },
    '06': {
        state: 'LEGACY_ONLY',
        implementationType: 'legacy-benefit',
        processEmolumentsSupport: 'No standalone payroll processing path found',
        legacyGlEvidence: 'No current GL posting evidence was found.',
        reason: 'Gratuity exists in legacy pay types, but no current payroll posting implementation was verified.'
    },
    '07': {
        state: 'NEEDS_CONFIRMATION',
        implementationType: 'backlog-arrears',
        processEmolumentsSupport: 'Declared in activity definitions only',
        legacyGlEvidence: 'No verified GL query, mapping rows, or posting batches were found.',
        reason: 'Backlog / Arrears requires client or legacy-query confirmation before any GL posting can be enabled.'
    },
    '08': {
        state: 'NEEDS_CONFIRMATION',
        implementationType: 'end-of-service-benefit',
        processEmolumentsSupport: 'Not implemented as standalone payroll activity',
        legacyGlEvidence: 'EOS records exist, but no verified GL mapping rows or posting batches were found.',
        reason: 'EOS Benefits need confirmed debit/credit treatment and posting structure before enabling GL posting.'
    },
    '09': {
        state: 'NEEDS_CONFIRMATION',
        implementationType: 'bonus-award',
        processEmolumentsSupport: 'Not implemented as standalone payroll activity',
        legacyGlEvidence: 'Bonus workflow/pages exist, but no verified GL mapping rows or posting batches were found.',
        reason: 'Bonus posting rules are not yet verified, so Post to Accounts must remain blocked.'
    },
    '13': {
        state: 'NOT_APPLICABLE',
        implementationType: 'leave-allowance-via-salary-supporting-table',
        processEmolumentsSupport: 'Handled through tblleaveallowance using TCode 01',
        legacyGlEvidence: 'Current Process Emoluments feeds leave allowance into salary-side support tables, not a standalone GL posting batch.',
        reason: 'Leave Allowance is currently handled through salary-side processing rather than a separate Post to Accounts activity.'
    },
    '14': {
        state: 'NOT_APPLICABLE',
        implementationType: 'acting-allowance-component',
        processEmolumentsSupport: 'Handled as Salary component Allw14',
        legacyGlEvidence: 'Acting allowance flows into salary payroll components, not a separate GL activity.',
        reason: 'Acting is represented inside salary posting components, not as its own Post to Accounts batch.'
    },
    '15': {
        state: 'NEEDS_CONFIRMATION',
        implementationType: 'long-service-award',
        processEmolumentsSupport: 'Declared in activity definitions only',
        legacyGlEvidence: 'No verified GL mapping rows or posting batches were found.',
        reason: 'Long Service requires confirmed accounting treatment before GL posting can be enabled.'
    },
    '33': {
        state: 'LEGACY_ONLY',
        implementationType: 'legacy-benefit',
        processEmolumentsSupport: 'No standalone payroll processing path found',
        legacyGlEvidence: 'No current GL posting evidence was found.',
        reason: 'Provident is not verified as a separate Post to Accounts activity in the current system.'
    },
    '40': {
        state: 'LEGACY_ONLY',
        implementationType: 'legacy-guarantee',
        processEmolumentsSupport: 'No standalone payroll processing path found',
        legacyGlEvidence: 'No current GL posting evidence was found.',
        reason: 'Guarantee exists in legacy pay types, but no current payroll GL rule was verified.'
    },
    '41': {
        state: 'NEEDS_CONFIRMATION',
        implementationType: 'ex-gratia',
        processEmolumentsSupport: 'No standalone payroll processing path found',
        legacyGlEvidence: 'No current GL posting evidence was found.',
        reason: 'Ex-Gratia needs client or accounting confirmation before any GL posting logic can be enabled.'
    },
    '42': {
        state: 'NEEDS_CONFIRMATION',
        implementationType: 'death-benefit',
        processEmolumentsSupport: 'No standalone payroll processing path found',
        legacyGlEvidence: 'No current GL posting evidence was found.',
        reason: 'Death Benefit needs client or accounting confirmation before any GL posting logic can be enabled.'
    },
    '99': {
        state: 'NOT_APPLICABLE',
        implementationType: 'selector-only',
        processEmolumentsSupport: 'Not a real payroll activity',
        legacyGlEvidence: 'No current GL posting evidence was found.',
        reason: 'Code 99 is an aggregate selector and must never be posted to accounts.'
    }
};

const ACTIVITY_DISPLAY_ORDER = ['01', '02', '04', '05', '06', '07', '08', '09', '13', '14', '15', '33', '40', '41', '42', '00', '99'];

function roundMoney(value) {
    const amount = Number(value || 0);
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function normalizeActivityCode(activityCode) {
    const rawValue = String(activityCode || '').trim();
    if (!rawValue) {
        return '';
    }

    if (/^\d+$/.test(rawValue)) {
        return rawValue.padStart(2, '0');
    }

    return rawValue.toUpperCase();
}

function getActivityName(activityCode, fallbackName = '') {
    const normalizedCode = normalizeActivityCode(activityCode);
    return fallbackName || ACTIVITY_NAMES[normalizedCode] || normalizedCode;
}

function getActivityPolicy(activityCode) {
    const normalizedCode = normalizeActivityCode(activityCode);
    return GL_POSTING_POLICY[normalizedCode] || {
        state: 'NEEDS_CONFIRMATION',
        implementationType: 'unclassified-legacy-activity',
        processEmolumentsSupport: 'Unknown',
        legacyGlEvidence: 'No verified GL posting evidence was found.',
        reason: 'This payroll activity is not yet configured for Post to Accounts.'
    };
}

async function getActivityUsageMaps(companyId) {
    const queries = {
        payrollUsage: `
            SELECT LPAD(TRIM(PType), 2, '0') AS code, COUNT(*) AS usageCount
            FROM tblpayroll
            WHERE CompanyID = ?
            GROUP BY LPAD(TRIM(PType), 2, '0')
        `,
        yearlyUsage: `
            SELECT LPAD(TRIM(PType), 2, '0') AS code, COUNT(*) AS usageCount
            FROM tblyearlypayments
            WHERE CompanyID = ?
            GROUP BY LPAD(TRIM(PType), 2, '0')
        `,
        incrementUsage: `
            SELECT LPAD(TRIM(Type), 2, '0') AS code, COUNT(*) AS usageCount
            FROM tblincrement
            WHERE CompanyID = ?
            GROUP BY LPAD(TRIM(Type), 2, '0')
        `,
        postingUsage: `
            SELECT LPAD(TRIM(activity_code), 2, '0') AS code, COUNT(*) AS usageCount
            FROM payroll_gl_posting_batches
            WHERE company_id = ?
            GROUP BY LPAD(TRIM(activity_code), 2, '0')
        `,
        mappingUsage: `
            SELECT LPAD(TRIM(activity_code), 2, '0') AS code, COUNT(*) AS usageCount
            FROM gl_account_mappings
            WHERE company_id = ?
              AND is_active = 1
            GROUP BY LPAD(TRIM(activity_code), 2, '0')
        `
    };

    const usageMaps = {};
    for (const [key, sql] of Object.entries(queries)) {
        const [rows] = await pool.query(sql, [companyId]);
        usageMaps[key] = new Map(rows.map((row) => [normalizeActivityCode(row.code), Number(row.usageCount || 0)]));
    }

    return usageMaps;
}

async function getPayTypeRows(companyId) {
    const [rows] = await pool.query(
        `
            SELECT CompanyID, TRIM(Code) AS Code, TRIM(PayType) AS PayType
            FROM tblpaytype
            WHERE CompanyID = ? OR CompanyID IS NULL
            ORDER BY COALESCE(CompanyID, ?), Code
        `,
        [companyId, companyId]
    );

    return rows;
}

async function getActivityGlPostingCatalog(companyId) {
    const normalizedCompanyId = Number(companyId) || 1;
    const [payTypes, usageMaps] = await Promise.all([
        getPayTypeRows(normalizedCompanyId),
        getActivityUsageMaps(normalizedCompanyId)
    ]);

    const discoveredCodes = new Set([
        ...ACTIVITY_DISPLAY_ORDER,
        ...payTypes.map((row) => normalizeActivityCode(row.Code)),
        ...usageMaps.payrollUsage.keys(),
        ...usageMaps.yearlyUsage.keys(),
        ...usageMaps.incrementUsage.keys(),
        ...usageMaps.postingUsage.keys(),
        ...usageMaps.mappingUsage.keys()
    ]);

    const orderedCodes = Array.from(discoveredCodes).sort((left, right) => {
        const leftIndex = ACTIVITY_DISPLAY_ORDER.indexOf(left);
        const rightIndex = ACTIVITY_DISPLAY_ORDER.indexOf(right);
        if (leftIndex !== -1 || rightIndex !== -1) {
            return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
        }

        return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
    });

    return orderedCodes.map((code) => {
        const payTypeRow = payTypes.find((row) => normalizeActivityCode(row.Code) === code) || null;
        const policy = getActivityPolicy(code);
        const mappingCount = usageMaps.mappingUsage.get(code) || 0;
        const postingBatchCount = usageMaps.postingUsage.get(code) || 0;
        const supported = policy.state === 'SUPPORTED';

        return {
            code,
            companyId: payTypeRow?.CompanyID || normalizedCompanyId,
            name: getActivityName(code, payTypeRow?.PayType || ''),
            payType: payTypeRow?.PayType || getActivityName(code),
            supported,
            state: policy.state,
            reason: supported
                ? 'Approved General Ledger posting configuration is available for this payroll activity.'
                : 'This activity can be processed in payroll but does not yet have an approved General Ledger posting configuration.',
            detailedReason: policy.reason,
            implementationType: policy.implementationType,
            processEmolumentsSupport: policy.processEmolumentsSupport,
            legacyGlEvidence: policy.legacyGlEvidence,
            usage: {
                tblPayroll: usageMaps.payrollUsage.get(code) || 0,
                tblyearlypayments: usageMaps.yearlyUsage.get(code) || 0,
                tblincrement: usageMaps.incrementUsage.get(code) || 0,
                postingBatches: postingBatchCount,
                activeMappings: mappingCount
            },
            currentPostToAccountsSupport: supported,
            currentProcessEmolumentsSupport: policy.processEmolumentsSupport,
            missingMappings: supported
                ? []
                : [
                    policy.state === 'NOT_APPLICABLE'
                        ? 'Separate Post to Accounts handling is not applicable in the current design.'
                        : 'Verified debit/credit mapping and posting strategy are still required.'
                ]
        };
    });
}

async function getActivityGlPostingReadiness(activityCode, companyId) {
    const normalizedCode = normalizeActivityCode(activityCode);
    const catalog = await getActivityGlPostingCatalog(companyId);
    const entry = catalog.find((row) => row.code === normalizedCode);
    if (entry) {
        return entry;
    }

    const policy = getActivityPolicy(normalizedCode);
    return {
        code: normalizedCode,
        companyId: Number(companyId) || 1,
        name: getActivityName(normalizedCode),
        supported: false,
        state: policy.state,
        reason: 'This activity can be processed in payroll but does not yet have an approved General Ledger posting configuration.',
        detailedReason: policy.reason,
        implementationType: policy.implementationType,
        processEmolumentsSupport: policy.processEmolumentsSupport,
        legacyGlEvidence: policy.legacyGlEvidence,
        usage: {
            tblPayroll: 0,
            tblyearlypayments: 0,
            tblincrement: 0,
            postingBatches: 0,
            activeMappings: 0
        },
        currentPostToAccountsSupport: false,
        currentProcessEmolumentsSupport: policy.processEmolumentsSupport,
        missingMappings: ['Verified debit/credit mapping and posting strategy are still required.']
    };
}

async function getSupportedGlPostingActivities(companyId) {
    const catalog = await getActivityGlPostingCatalog(companyId);
    return catalog.filter((row) => row.supported);
}

async function assertActivityGlPostingSupported(companyId, activityCode) {
    const readiness = await getActivityGlPostingReadiness(activityCode, companyId);
    if (!readiness.supported) {
        const error = new Error('Post to Accounts is not yet configured for this payroll activity.');
        error.statusCode = 409;
        error.activityReadiness = readiness;
        throw error;
    }

    return readiness;
}

function normalizeWorkflowActor(postedByUser = {}) {
    return {
        id: Number(postedByUser.id ?? postedByUser.user_id ?? postedByUser.UserID ?? postedByUser.PFNo ?? 0) || 0,
        role: String(postedByUser.role || postedByUser.level || '').trim() || 'finance-officer',
        name: postedByUser.name || postedByUser.fullName || postedByUser.username || postedByUser.email || 'Finance Officer',
        source: postedByUser.source || 'tblpassword'
    };
}

function createWorkflowApprovalError(message, statusCode = 409) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
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

async function validateWorkflowReadyForPosting(connection, {
    companyId,
    activityCode,
    postingMonth,
    postingYear
}) {
    const workflowBatch = await payrollWorkflowService.getWorkflowBatch(
        companyId,
        postingMonth,
        postingYear,
        activityCode,
        connection
    );

    if (!workflowBatch) {
        throw createWorkflowApprovalError('No workflow batch was found for the selected payroll period.', 404);
    }

    if (workflowBatch.Status !== payrollWorkflowService.WORKFLOW_STATUSES.FINAL_APPROVED) {
        throw createWorkflowApprovalError('Monthly payroll has not received final approval from the Entity Head/HNO.', 409);
    }

    const currentSnapshot = await payrollWorkflowService.calculatePayrollSnapshot(
        companyId,
        postingMonth,
        postingYear,
        activityCode,
        connection
    );
    const integrity = payrollWorkflowService.verifyPayrollSnapshotUnchanged(workflowBatch, currentSnapshot);
    if (!integrity.matches) {
        throw createWorkflowApprovalError('Payroll figures have changed after final approval. The payroll must be returned for correction and approved again before posting.', 409);
    }

    const postingStatus = await payrollGlQueryService.getPayrollPostingStatus(connection, {
        companyId,
        activityCode,
        postingMonth,
        postingYear
    });
    if (Number(postingStatus.posted_rows || 0) > 0) {
        throw createWorkflowApprovalError('Payroll has already been posted to accounts.', 409);
    }

    return {
        workflowBatch,
        currentSnapshot,
        postingStatus
    };
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
            narration: `${monthLabel} ${getActivityName(activityCode)} posting`,
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
        const error = new Error(`Required GL mappings are incomplete. Missing: ${missingMappings.join(', ')}.`);
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

function mapWorkflowStatusToPostingBadge(status, isPosted, checksumValid = true, isSupported = true) {
    if (!isSupported) {
        return { label: 'GL Not Configured', tone: 'warning', canPost: false };
    }

    if (isPosted || status === payrollWorkflowService.WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS) {
        return { label: 'Already Posted', tone: 'success', canPost: false };
    }

    if (!checksumValid && status === payrollWorkflowService.WORKFLOW_STATUSES.FINAL_APPROVED) {
        return { label: 'Approval Invalidated', tone: 'danger', canPost: false };
    }

    switch (status) {
        case payrollWorkflowService.WORKFLOW_STATUSES.FINAL_APPROVED:
            return { label: 'Ready to Post', tone: 'success', canPost: true };
        case payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER:
        case payrollWorkflowService.WORKFLOW_STATUSES.MANAGER_ENDORSED:
            return { label: 'Awaiting Manager Endorsement', tone: 'info', canPost: false };
        case payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR:
        case payrollWorkflowService.WORKFLOW_STATUSES.AUDITOR_ENDORSED:
            return { label: 'Awaiting Auditor Review', tone: 'secondary', canPost: false };
        case payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD:
            return { label: 'Awaiting Final Approval', tone: 'dark', canPost: false };
        case payrollWorkflowService.WORKFLOW_STATUSES.RETURNED_BY_MANAGER:
        case payrollWorkflowService.WORKFLOW_STATUSES.RETURNED_BY_AUDITOR:
        case payrollWorkflowService.WORKFLOW_STATUSES.FINAL_REJECTED:
            return { label: 'Returned / Rejected', tone: 'warning', canPost: false };
        case payrollWorkflowService.WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS:
            return { label: 'Correction In Progress', tone: 'warning', canPost: false };
        case payrollWorkflowService.WORKFLOW_STATUSES.PROCESSED:
            return { label: 'Awaiting Submission', tone: 'primary', canPost: false };
        default:
            return { label: status || 'No Workflow', tone: 'light', canPost: false };
    }
}

async function getPostingReadinessRows(companyId) {
    return payrollGlQueryService.withTransaction(async (connection) => {
        await payrollGlQueryService.ensureInfrastructure(connection);

        const activityCatalog = await getActivityGlPostingCatalog(companyId);
        const workflowBatches = await payrollWorkflowService.listWorkflowBatches(companyId, {}, connection);
        const rows = [];

        for (const batch of workflowBatches.slice(0, 60)) {
            const activityReadiness = activityCatalog.find((row) => row.code === normalizeActivityCode(batch.PType))
                || await getActivityGlPostingReadiness(batch.PType, companyId);
            const currentSnapshot = await payrollWorkflowService.calculatePayrollSnapshot(
                companyId,
                batch.PMonth,
                batch.PYear,
                batch.PType,
                connection
            );
            const integrity = payrollWorkflowService.verifyPayrollSnapshotUnchanged(batch, currentSnapshot);
            const postingStatus = await payrollGlQueryService.getPayrollPostingStatus(connection, {
                companyId,
                activityCode: batch.PType,
                postingMonth: Number(batch.PMonth),
                postingYear: Number(batch.PYear)
            });
            const postingBatch = await payrollGlQueryService.findExistingBatch(connection, {
                companyId,
                activityCode: batch.PType,
                postingMonth: Number(batch.PMonth),
                postingYear: Number(batch.PYear)
            });
            const readiness = mapWorkflowStatusToPostingBadge(
                batch.Status,
                Number(postingStatus.posted_rows || 0) > 0 || (postingBatch && postingBatch.status !== 'reversed'),
                integrity.matches,
                activityReadiness.supported
            );

            rows.push({
                ...batch,
                activityName: activityReadiness.name || getActivityName(batch.PType),
                finalApprovedByName: batch.finalApprovedByName || batch.FinalApprovedBy || '',
                checksumValid: integrity.matches,
                currentChecksum: currentSnapshot.payrollChecksum,
                postedRows: Number(postingStatus.posted_rows || 0),
                glPostingBatchId: postingStatus.gl_posted_batch_id || postingBatch?.id || null,
                glPostedAt: postingStatus.gl_posted_at || null,
                readinessLabel: readiness.label,
                readinessTone: readiness.tone,
                canPost: readiness.canPost,
                activitySupported: activityReadiness.supported,
                activitySupportState: activityReadiness.state,
                activitySupportReason: activityReadiness.reason,
                activitySupportDetail: activityReadiness.detailedReason,
                activityImplementationType: activityReadiness.implementationType
            });
        }

        return rows;
    });
}

async function postMonthlyPayrollToGL({ companyId, activityCode, postingDate, postedBy, postedByUser, connection = null }) {
    const postingMonth = postingDate.getMonth() + 1;
    const postingYear = postingDate.getFullYear();
    const workflowActor = normalizeWorkflowActor(postedByUser || { id: postedBy });
    const managedTransaction = !connection;

    try {
        const work = async (executor) => {
            await payrollGlQueryService.ensureInfrastructure(executor);
            const activityReadiness = await assertActivityGlPostingSupported(companyId, activityCode);

            const workflowReadiness = await validateWorkflowReadyForPosting(executor, {
                companyId,
                activityCode,
                postingMonth,
                postingYear
            });
            const workflowBatch = workflowReadiness.workflowBatch;
            const generationNo = Number(workflowBatch?.GenerationNo || 1);

            const duplicateBatch = await payrollGlQueryService.findExistingBatch(executor, {
                companyId,
                activityCode,
                postingMonth,
                postingYear,
                generationNo
            });

            if (duplicateBatch && duplicateBatch.status !== 'reversed') {
                const error = new Error('A GL posting batch already exists for this payroll period.');
                error.statusCode = 409;
                throw error;
            }

            let postingPayload;
            if (activityCode === '01') {
                postingPayload = await buildSalaryPostingPayload({
                    connection: executor,
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

            const batchId = await payrollGlQueryService.insertPostingBatch(executor, {
                companyId,
                activityCode,
                postingDate,
                postingMonth,
                postingYear,
                generationNo,
                workflowBatchId: workflowBatch.id,
                status: 'posted',
                totalLines: postingPayload.postingLines.length,
                totalAmount: postingPayload.totalAmount,
                sourceRecordCount: postingPayload.sourceRows.length,
                postedBy,
                remarks: `${activityReadiness.name} posting for ${postingMonth}/${postingYear}`
            });

            await payrollGlQueryService.insertPostingLines(executor, postingPayload.postingLines.map((line) => ({
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

            const markedRows = await payrollGlQueryService.markPayrollRowsPosted(executor, {
                batchId,
                companyId,
                activityCode,
                postingMonth,
                postingYear
            });

            if (markedRows !== postingPayload.sourceRows.length) {
                const error = new Error('Payroll row count changed during posting. No changes were committed.');
                error.statusCode = 409;
                throw error;
            }

            const workflowTransition = await payrollWorkflowService.transitionWorkflow({
                companyId,
                pMonth: postingMonth,
                pYear: postingYear,
                pType: activityCode,
                action: payrollWorkflowService.WORKFLOW_ACTIONS.POST_TO_ACCOUNTS,
                user: workflowActor,
                comments: `GL posting batch #${batchId} completed successfully.`,
                metadata: {
                    stage: 'gl-posting',
                    glPostingBatchId: batchId,
                    totalPostedLines: postingPayload.postingLines.length,
                    totalPostedAmount: postingPayload.totalAmount
                },
                connection: executor
            });

            await payrollGlQueryService.insertAuditLog(executor, {
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
                workflowBatchId: workflowTransition.batch.id,
                workflowStatus: workflowTransition.batch.Status,
                postingMonth,
                postingYear,
                activityCode,
                totalLines: postingPayload.postingLines.length,
                totalAmount: postingPayload.totalAmount
            };
        };

        if (managedTransaction) {
            return await payrollGlQueryService.withTransaction(work);
        }

        return await work(connection);
    } catch (error) {
        if (!managedTransaction) {
            throw error;
        }

        await payrollGlQueryService.withTransaction(async (auditConnection) => {
            await payrollGlQueryService.ensureInfrastructure(auditConnection);
            await payrollGlQueryService.insertAuditLog(auditConnection, {
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
    getPostingReadinessRows,
    getActivityGlPostingCatalog,
    getActivityGlPostingReadiness,
    getSupportedGlPostingActivities,
    assertActivityGlPostingSupported,
    groupPostingComponentsByGlAccount,
    getSupportedActivities: getSupportedGlPostingActivities,
    postMonthlyPayrollToGL,
    reversePostingBatch,
    validateRequiredGlMappings,
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

async function resolveLatestApprovedWorkflowGeneration(companyId, pMonth, pYear, pType, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `
            SELECT *
            FROM payroll_workflow_batches
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
              AND Status = 'FINAL_APPROVED'
            ORDER BY COALESCE(GenerationNo, 1) DESC, id DESC
            LIMIT 1
        `,
        [Number(companyId) || 1, Number(pMonth), Number(pYear), String(pType || '').trim()]
    );
    return rows[0] || null;
}

function patchPostingExport(exportName) {
    const original = module.exports[exportName];
    if (typeof original !== 'function') {
        return;
    }

    module.exports[exportName] = async function phase15GenerationAwarePosting(payload = {}) {
        const companyId = Number(payload.companyId || payload.CompanyID) || 1;
        const pMonth = Number(payload.pMonth || payload.PMonth || payload.postingMonth) || 0;
        const pYear = Number(payload.pYear || payload.PYear || payload.postingYear) || 0;
        const pType = String(payload.pType || payload.PType || payload.activityCode || payload.activity_code || '').trim();
        const connection = payload.connection || null;

        if (companyId && pMonth && pYear && pType) {
            const latestApproved = await resolveLatestApprovedWorkflowGeneration(companyId, pMonth, pYear, pType, connection);
            if (latestApproved) {
                payload.workflowBatchId = payload.workflowBatchId || latestApproved.id;
                payload.generationNo = payload.generationNo || latestApproved.GenerationNo || 1;
            }
        }

        return original.call(this, payload);
    };
}

patchPostingExport('postPayrollToGl');
patchPostingExport('postPayrollBatchToGl');
patchPostingExport('postToAccounts');
module.exports.resolveLatestApprovedWorkflowGeneration = resolveLatestApprovedWorkflowGeneration;
