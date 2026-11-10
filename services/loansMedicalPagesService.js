const pool = require('../config/db');
const staffStatusService = require('./staffStatusService');
const recordWorkflowService = require('./recordWorkflowService');

function normalizeText(value) {
    const text = String(value || '').trim();
    return text || '';
}

function normalizeOptionalText(value) {
    const text = normalizeText(value);
    return text || null;
}

function normalizeDate(value) {
    const text = normalizeText(value);
    if (!text) {
        return null;
    }

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString().slice(0, 10);
}

async function getCompanyInfo() {
    const [rows] = await pool.query('SELECT CompanyID, Com_Name, Address, LogoPath FROM tblcominfo LIMIT 1');
    return rows[0] || { CompanyID: 1, Com_Name: 'Human Resource Payroll', Address: '', LogoPath: null };
}

async function getDepartments() {
    const [rows] = await pool.query('SELECT Code, Dept FROM tbldept ORDER BY Dept');
    return rows;
}

async function getLoanCodes() {
    const [rows] = await pool.query('SELECT TCode, TransName FROM tblloancode ORDER BY TransName');
    return rows;
}

async function getMedicalCodes() {
    const [rows] = await pool.query('SELECT TCode, TransName FROM tblmcode ORDER BY TransName');
    return rows;
}

async function getActiveStaffList() {
    const [rows] = await pool.query(
        staffStatusService.getActiveStaffQuery({
            fields: 'PFNo, SName, CDept, CompanyID',
            orderBy: 'PFNo'
        })
    );

    return rows;
}

async function getSurchargeTypes() {
    const [rows] = await pool.query('SELECT Code, Surcharge FROM tblsurchargetype ORDER BY Surcharge');
    return rows;
}

function buildWorkflowActor(user = {}) {
    return {
        id: Number(user.id || user.pfno || user.PFNo || 0) || 0,
        role: user.role || user.level || 'data-entry',
        name: user.name || user.fullName || user.username || user.email || 'Data Entry Officer'
    };
}

async function getWorkflowItemsForModules(companyId, modules) {
    if (!modules.length) {
        return [];
    }

    const placeholders = modules.map(() => '?').join(', ');
    const [rows] = await pool.query(
        `
            SELECT id, Module, RecordReference, Status, SubmittedAt, ManagerComments, EntityHeadComments, RejectionReason
            FROM record_workflow_items
            WHERE CompanyID = ?
              AND Module IN (${placeholders})
        `,
        [Number(companyId) || 1, ...modules]
    );

    return rows;
}

function buildWorkflowStatus(record, workflowItem, options = {}) {
    const {
        legacyApprovedField = 'Approved',
        noWorkflowImpliesApproved = false
    } = options;

    if (workflowItem?.Status) {
        return workflowItem.Status;
    }

    if (legacyApprovedField && Object.prototype.hasOwnProperty.call(record, legacyApprovedField)) {
        const approvedValue = Number(record[legacyApprovedField] ?? 0);
        if (approvedValue === 2) {
            return 'FINAL_REJECTED';
        }
        if (approvedValue === -1 || approvedValue === 1) {
            return 'FINAL_APPROVED';
        }
        return 'DRAFT';
    }

    return noWorkflowImpliesApproved ? 'FINAL_APPROVED' : 'DRAFT';
}

async function enrichRowsWithWorkflowStatus(companyId, module, rows, options = {}) {
    const workflowItems = await getWorkflowItemsForModules(companyId, [module]);
    const itemMap = new Map(workflowItems.map((item) => [item.RecordReference, item]));
    const config = recordWorkflowService.getModuleConfig(module);

    return rows.map((row) => {
        const reference = config.buildReferenceFromRow(row);
        const workflowItem = itemMap.get(reference) || null;
        return {
            ...row,
            WorkflowItemID: workflowItem?.id || null,
            WorkflowStatus: buildWorkflowStatus(row, workflowItem, options),
            WorkflowComments: workflowItem?.EntityHeadComments || workflowItem?.ManagerComments || workflowItem?.RejectionReason || '',
            WorkflowRecordReference: reference
        };
    });
}

function applySharedStaffFilters(conditions, params, filters, tableAlias, staffAlias = 's') {
    if (filters.pfNo) {
        conditions.push(`${tableAlias}.PFNo = ?`);
        params.push(filters.pfNo);
    }

    if (filters.staffName) {
        conditions.push(`${staffAlias}.SName LIKE ?`);
        params.push(`%${filters.staffName}%`);
    }

    if (filters.department) {
        conditions.push(`${staffAlias}.CDept = ?`);
        params.push(filters.department);
    }

    if (filters.dateFrom) {
        conditions.push(`DATE(${tableAlias}.EntryDate) >= ?`);
        params.push(filters.dateFrom);
    }

    if (filters.dateTo) {
        conditions.push(`DATE(${tableAlias}.EntryDate) <= ?`);
        params.push(filters.dateTo);
    }
}

async function getLoanBalanceEnquiryData({ companyId, filters = {} }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        department: normalizeOptionalText(filters.department),
        loanType: normalizeOptionalText(filters.loanType),
        loanStatus: normalizeOptionalText(filters.loanStatus),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo)
    };

    const conditions = [
        '(l.CompanyID = ? OR l.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s'),
        "COALESCE(l.LTrans, '') NOT IN ('03', '04')"
    ];
    const params = [resolvedCompanyId];

    applySharedStaffFilters(conditions, params, normalizedFilters, 'l');

    if (normalizedFilters.loanType) {
        conditions.push('l.LTrans = ?');
        params.push(normalizedFilters.loanType);
    }

    if (normalizedFilters.loanStatus === 'active') {
        conditions.push('COALESCE(l.Repaid, 0) = 0');
        conditions.push('COALESCE(l.Expired, 0) = 0');
        conditions.push('COALESCE(l.LoanBal, 0) > 0');
    } else if (normalizedFilters.loanStatus === 'completed') {
        conditions.push('(COALESCE(l.Repaid, 0) <> 0 OR COALESCE(l.Expired, 0) <> 0 OR COALESCE(l.LoanBal, 0) <= 0)');
    }

    const [company, departments, loanCodes, staffList, rowsResult] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        getLoanCodes(),
        getActiveStaffList(),
        pool.query(
            `
                SELECT
                    l.TransNo,
                    l.EntryDate,
                    l.PFNo,
                    s.SName,
                    d.Dept AS DeptName,
                    lc.TransName AS LoanTypeName,
                    l.Amount,
                    l.LoanBal,
                    l.MonthlyRepayment,
                    l.Interest,
                    l.MonthlyInt,
                    l.StartDate,
                    l.ExpDate,
                    l.Repaid,
                    l.Expired,
                    l.RepaidAmount,
                    l.Approved
                FROM tblloan l
                LEFT JOIN tblstaff s
                    ON s.PFNo = l.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN tblloancode lc
                    ON lc.TCode = l.LTrans
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY l.EntryDate DESC, l.PFNo ASC
                LIMIT 300
            `,
            params
        )
    ]);

    const rows = await enrichRowsWithWorkflowStatus(resolvedCompanyId, 'loan', rowsResult[0]);

    return {
        company,
        departments,
        loanCodes,
        staffList,
        rows,
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            department: normalizedFilters.department || '',
            loanType: normalizedFilters.loanType || '',
            loanStatus: normalizedFilters.loanStatus || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || ''
        }
    };
}

async function getMedicalEnquiryData({ companyId, filters = {} }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        department: normalizeOptionalText(filters.department),
        medicalCode: normalizeOptionalText(filters.medicalCode),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo)
    };

    const conditions = [
        '(m.CompanyID = ? OR m.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];
    const params = [resolvedCompanyId];

    applySharedStaffFilters(conditions, params, normalizedFilters, 'm');

    if (normalizedFilters.medicalCode) {
        conditions.push('m.MCode = ?');
        params.push(normalizedFilters.medicalCode);
    }

    const [company, departments, medicalCodes, staffList, rowsResult] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        getMedicalCodes(),
        getActiveStaffList(),
        pool.query(
            `
                SELECT
                    m.TransNo,
                    m.EntryDate,
                    m.PFNo,
                    s.SName,
                    d.Dept AS DeptName,
                    m.Dependant,
                    m.MCode,
                    mc.TransName AS MedicalDescription,
                    m.Amount,
                    m.PicturePath
                FROM tblmedical m
                LEFT JOIN tblstaff s
                    ON s.PFNo = m.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN tblmcode mc
                    ON mc.TCode = m.MCode
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY m.EntryDate DESC, m.PFNo ASC
                LIMIT 300
            `,
            params
        )
    ]);

    const rows = await enrichRowsWithWorkflowStatus(resolvedCompanyId, 'medical', rowsResult[0], {
        legacyApprovedField: null,
        noWorkflowImpliesApproved: true
    });

    return {
        company,
        departments,
        medicalCodes,
        staffList,
        rows,
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            department: normalizedFilters.department || '',
            medicalCode: normalizedFilters.medicalCode || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || ''
        }
    };
}

async function getLoanReportData({ companyId, filters = {} }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        department: normalizeOptionalText(filters.department),
        loanType: normalizeOptionalText(filters.loanType),
        loanStatus: normalizeOptionalText(filters.loanStatus),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo)
    };

    const conditions = [
        '(l.CompanyID = ? OR l.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s'),
        "COALESCE(l.LTrans, '') NOT IN ('03', '04')"
    ];
    const params = [resolvedCompanyId];

    applySharedStaffFilters(conditions, params, normalizedFilters, 'l');

    if (normalizedFilters.loanType) {
        conditions.push('l.LTrans = ?');
        params.push(normalizedFilters.loanType);
    }

    if (normalizedFilters.loanStatus === 'active') {
        conditions.push('COALESCE(l.Repaid, 0) = 0');
        conditions.push('COALESCE(l.Expired, 0) = 0');
        conditions.push('COALESCE(l.LoanBal, 0) > 0');
    } else if (normalizedFilters.loanStatus === 'completed') {
        conditions.push('(COALESCE(l.Repaid, 0) <> 0 OR COALESCE(l.Expired, 0) <> 0 OR COALESCE(l.LoanBal, 0) <= 0)');
    }

    const [company, departments, loanCodes, rowsResult] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        getLoanCodes(),
        pool.query(
            `
                SELECT
                    l.TransNo,
                    l.EntryDate,
                    l.PFNo,
                    s.SName,
                    d.Dept AS DeptName,
                    lc.TransName AS LoanTypeName,
                    l.Amount,
                    l.LoanBal,
                    l.RepaidAmount,
                    l.MonthlyRepayment,
                    l.Interest,
                    l.MonthlyInt,
                    l.StartDate,
                    l.ExpDate,
                    l.Duration,
                    l.DurationBal,
                    l.Approved,
                    l.Repaid,
                    l.Expired,
                    COALESCE(repyt.TotalPayrollDeductions, 0) AS TotalPayrollDeductions,
                    COALESCE(repyt.LastDeductionDate, NULL) AS LastDeductionDate,
                    COALESCE(repay.PendingRepayments, 0) AS PendingRepayments,
                    COALESCE(repay.ApprovedRepayments, 0) AS ApprovedRepayments
                FROM tblloan l
                LEFT JOIN tblstaff s
                    ON s.PFNo = l.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN tblloancode lc
                    ON lc.TCode = l.LTrans
                LEFT JOIN (
                    SELECT
                        TransRef,
                        SUM(COALESCE(DAmount, 0)) AS TotalPayrollDeductions,
                        MAX(DeductionDate) AS LastDeductionDate
                    FROM tblloanrepyt
                    GROUP BY TransRef
                ) repyt
                    ON repyt.TransRef = l.TransNo
                LEFT JOIN (
                    SELECT
                        LoanTransNo,
                        SUM(CASE WHEN COALESCE(Approved, 0) = 0 THEN Amount ELSE 0 END) AS PendingRepayments,
                        SUM(CASE WHEN COALESCE(Approved, 0) IN (-1, 1) THEN Amount ELSE 0 END) AS ApprovedRepayments
                    FROM tblloanrepayment
                    GROUP BY LoanTransNo
                ) repay
                    ON repay.LoanTransNo = l.TransNo
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY l.EntryDate DESC, l.PFNo ASC
                LIMIT 300
            `,
            params
        )
    ]);

    const rows = await enrichRowsWithWorkflowStatus(resolvedCompanyId, 'loan', rowsResult[0]);
    const totals = {
        totalLoans: rows.length,
        totalAmount: rows.reduce((sum, row) => sum + Number(row.Amount || 0), 0),
        totalOutstanding: rows.reduce((sum, row) => sum + Number(row.LoanBal || 0), 0),
        totalMonthlyRepayment: rows.reduce((sum, row) => sum + Number(row.MonthlyRepayment || 0), 0)
    };

    return {
        company,
        departments,
        loanCodes,
        rows,
        totals,
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            department: normalizedFilters.department || '',
            loanType: normalizedFilters.loanType || '',
            loanStatus: normalizedFilters.loanStatus || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || ''
        }
    };
}

async function getWelfareLoanPageData({ companyId }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const [staffList, loanCodes, applicationsResult, repaymentsResult, paramsResult] = await Promise.all([
        pool.query(staffStatusService.getActiveStaffQuery({ fields: 'PFNo, SName, AccountNo', orderBy: 'PFNo' })),
        getLoanCodes(),
        pool.query(
            `
                SELECT 
                    l.TransNo,
                    l.EntryDate,
                    l.PFNo,
                    s.SName,
                    s.AccountNo,
                    l.LTypeCode,
                    l.LTrans,
                    l.Amount,
                    l.Duration,
                    l.Interest,
                    l.MonthlyInt,
                    l.MonthlyRepayment,
                    l.StartDate,
                    l.ExpDate,
                    l.LoanBal,
                    l.RepaidAmount,
                    l.Surcharge,
                    l.Approved
                FROM tblloan l
                LEFT JOIN tblstaff s ON l.PFNo = s.PFNo
                WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
                ORDER BY l.EntryDate DESC, l.TransNo DESC
            `,
            [resolvedCompanyId]
        ),
        pool.query(
            `
                SELECT 
                    l.TransNo,
                    l.PFNo,
                    s.SName,
                    l.Amount,
                    l.EntryDate as LoanDate,
                    l.Duration,
                    l.RepaidAmount,
                    l.LoanBal,
                    l.StartDate,
                    l.ExpDate,
                    l.Repayment,
                    l.MonthlyRepayment,
                    l.Approved
                FROM tblloan l
                LEFT JOIN tblstaff s ON l.PFNo = s.PFNo
                WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
                  AND (l.LoanBal > 0 OR l.RepaidAmount > 0)
                ORDER BY l.EntryDate DESC, l.TransNo DESC
            `,
            [resolvedCompanyId]
        ),
        pool.query(
            `SELECT AdvanceInt, LoanDuration
             FROM tblparams1
             WHERE CompanyID = ? OR CompanyID IS NULL
             LIMIT 1`,
            [resolvedCompanyId]
        )
    ]);

    const applications = await enrichRowsWithWorkflowStatus(resolvedCompanyId, 'loan', applicationsResult[0]);
    const repayments = await enrichRowsWithWorkflowStatus(resolvedCompanyId, 'loan', repaymentsResult[0]);

    return {
        staffList: staffList[0],
        loanCodes,
        applications,
        repayments,
        loanParams: paramsResult[0][0] || { AdvanceInt: 0, LoanDuration: 0 }
    };
}

async function getStaffLoanHistoryData({ companyId, pfNo }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const [staffRows] = await pool.query(
        `SELECT PFNo FROM tblstaff WHERE PFNo = ? AND (CompanyID = ? OR CompanyID IS NULL) AND ${staffStatusService.getActiveStaffFilter('')}`,
        [pfNo, resolvedCompanyId]
    );

    if (!staffRows.length) {
        return null;
    }

    const [loans] = await pool.query(
        `
            SELECT *
            FROM tblloan
            WHERE PFNo = ?
              AND (CompanyID = ? OR CompanyID IS NULL)
            ORDER BY EntryDate DESC, TransNo DESC
            LIMIT 1
        `,
        [pfNo, resolvedCompanyId]
    );

    if (!loans.length) {
        return { lastLoan: null };
    }

    return {
        lastLoan: {
            EntryDate: loans[0].EntryDate,
            Amount: loans[0].Amount,
            Completed: Number(loans[0].LoanBal || 0) <= 0 ? 'Yes' : 'No'
        }
    };
}

async function saveLoanDraft({ companyId, user, payload }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const actor = buildWorkflowActor(user);
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const entryDate = normalizeText(payload.entryDate);
        const pfNo = normalizeText(payload.pfno);
        const lTrans = normalizeText(payload.lTrans);
        const lTypeCode = normalizeText(payload.lTypeCode || '01') || '01';
        const amount = Number(payload.amount || 0);
        const duration = Number(payload.duration || 0);
        const monthlyRepayment = Number(payload.monthlyRepayment || 0);
        const interest = Number(payload.interest || 0);
        const monthlyInt = Number(payload.monthlyInt || 0);
        const startDate = normalizeText(payload.startDate);
        const surcharge = payload.surcharge === 'Yes' || payload.surcharge === 'on' ? 'Yes' : 'No';
        const transNoInput = Number(payload.transNo || 0);
        const loanBal = amount + interest;
        const [paramRows] = await connection.query(
            `SELECT AdvanceInt, LoanDuration
             FROM tblparams1
             WHERE CompanyID = ? OR CompanyID IS NULL
             LIMIT 1`,
            [resolvedCompanyId]
        );
        const params = paramRows[0] || { AdvanceInt: 0, LoanDuration: 0 };
        const interestRate = Number(params.AdvanceInt || 0);
        const durationThreshold = Number(params.LoanDuration || 0);
        const rate = durationThreshold > 0 && duration > durationThreshold ? interestRate : 0;
        const expDateValue = startDate ? new Date(startDate) : null;
        if (expDateValue && !Number.isNaN(expDateValue.getTime())) {
            expDateValue.setMonth(expDateValue.getMonth() + duration);
        }
        const expDate = expDateValue ? expDateValue.toISOString().slice(0, 19).replace('T', ' ') : null;

        let transNo = transNoInput;
        let previousReference = null;

        if (transNo > 0) {
            const [existingRows] = await connection.query(
                `SELECT * FROM tblloan WHERE TransNo = ? AND (CompanyID = ? OR CompanyID IS NULL) LIMIT 1`,
                [transNo, resolvedCompanyId]
            );
            if (!existingRows.length) {
                throw new Error('Loan draft not found.');
            }
            previousReference = recordWorkflowService.getModuleConfig('loan').buildReferenceFromRow(existingRows[0]);
            await recordWorkflowService.assertRecordEditableByReference(resolvedCompanyId, 'loan', previousReference, connection);

            await connection.query(
                `
                    UPDATE tblloan
                    SET EntryDate = ?, PFNo = ?, LTypeCode = ?, LTrans = ?, Amount = ?, Duration = ?, DurationBal = ?,
                        Rate = ?, Repayment = 0, Interest = ?, MonthlyInt = ?, MonthlyRepayment = ?, StartDate = ?, ExpDate = ?,
                        LoanBal = ?, RepaidAmount = 0, Approved = 0, ApprovedBy = NULL, DateApproved = NULL, Expired = 0,
                        Reschedule = 0, Repaid = 0, CompanyID = ?, Surcharge = ?
                    WHERE TransNo = ?
                      AND (CompanyID = ? OR CompanyID IS NULL)
                `,
                [
                    entryDate, pfNo, lTypeCode, lTrans, amount, duration, duration, rate, interest, monthlyInt, monthlyRepayment,
                    startDate || null, expDate, loanBal, resolvedCompanyId, surcharge, transNo, resolvedCompanyId
                ]
            );
        } else {
            const [maxRows] = await connection.query('SELECT COALESCE(MAX(TransNo), 0) + 1 AS nextTransNo FROM tblloan');
            transNo = Number(maxRows[0]?.nextTransNo || 1);

            await connection.query(
                `
                    INSERT INTO tblloan (
                        TransNo, EntryDate, PFNo, LTypeCode, LTrans, Rate, Duration, DurationBal, Amount,
                        LoanBal, Repayment, Interest, MonthlyInt, MonthlyRepayment, StartDate, ExpDate,
                        TimeKeyed, Approved, DateApproved, ApprovedBy, Expired, Surcharge, Reschedule,
                        RescheduleDate, Repaid, RepaidAmount, RepaidDate, CompanyID
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, NOW(), 0, NULL, NULL, 0, ?, 0, NULL, 0, 0, NULL, ?)
                `,
                [
                    transNo, entryDate, pfNo, lTypeCode, lTrans, rate, duration, duration, amount, loanBal, interest,
                    monthlyInt, monthlyRepayment, startDate || null, expDate, surcharge, resolvedCompanyId
                ]
            );
        }

        const recordReference = recordWorkflowService.getModuleConfig('loan').buildReferenceFromInput({
            transNo,
            entryDate,
            lTypeCode,
            lTrans
        });
        const savedRecord = await recordWorkflowService.fetchModuleRecord(resolvedCompanyId, 'loan', recordReference, connection);
        await recordWorkflowService.ensureDraftItemForExistingRecord({
            companyId: resolvedCompanyId,
            module: 'loan',
            recordReference,
            record: savedRecord,
            previousReference,
            user: actor,
            connection
        });

        await connection.commit();
        return { transNo, workflowReference: recordReference };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function saveLoanRepaymentDraft({ companyId, user, payload }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const actor = buildWorkflowActor(user);
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const repayIdInput = Number(payload.repayId || 0);
        const loanTransNo = Number(payload.transNo || payload.loanTransNo || 0);
        const pfNo = normalizeText(payload.pfno);
        const amount = Number(payload.repaymentAmount || payload.amount || 0);
        const datePaid = normalizeText(payload.repaymentDate || payload.datePaid);

        let repayId = repayIdInput;
        let previousReference = null;

        if (repayId > 0) {
            const [existingRows] = await connection.query('SELECT * FROM tblloanrepayment WHERE RepayID = ? LIMIT 1', [repayId]);
            if (!existingRows.length) {
                throw new Error('Loan repayment draft not found.');
            }
            previousReference = recordWorkflowService.getModuleConfig('loan-repayment').buildReferenceFromRow(existingRows[0]);
            await recordWorkflowService.assertRecordEditableByReference(resolvedCompanyId, 'loan-repayment', previousReference, connection);

            await connection.query(
                `
                    UPDATE tblloanrepayment
                    SET LoanTransNo = ?, PFNo = ?, Amount = ?, DatePaid = ?, Approved = 0, ApprovedBy = NULL, DateApproved = NULL
                    WHERE RepayID = ?
                `,
                [loanTransNo, pfNo, amount, datePaid, repayId]
            );
        } else {
            const [result] = await connection.query(
                `
                    INSERT INTO tblloanrepayment (LoanTransNo, PFNo, Amount, DatePaid, Approved, ApprovedBy, DateApproved)
                    VALUES (?, ?, ?, ?, 0, NULL, NULL)
                `,
                [loanTransNo, pfNo, amount, datePaid]
            );
            repayId = Number(result.insertId);
        }

        const recordReference = recordWorkflowService.getModuleConfig('loan-repayment').buildReferenceFromInput({ repayId });
        const savedRecord = await recordWorkflowService.fetchModuleRecord(resolvedCompanyId, 'loan-repayment', recordReference, connection);
        await recordWorkflowService.ensureDraftItemForExistingRecord({
            companyId: resolvedCompanyId,
            module: 'loan-repayment',
            recordReference,
            record: savedRecord,
            previousReference,
            user: actor,
            connection
        });

        await connection.commit();
        return { repayId, workflowReference: recordReference };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function getWelfareMedicalPageData({ companyId }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const [mCodes, staffList] = await Promise.all([
        pool.query('SELECT TCode, TransName FROM tblmcode ORDER BY TransName'),
        pool.query(staffStatusService.getActiveStaffQuery({ fields: 'PFNo, SName', orderBy: 'PFNo' }))
    ]);

    return {
        mCodes: mCodes[0],
        staffList: staffList[0]
    };
}

async function getStaffMedicalHistoryData({ companyId, pfNo }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const [staffRows] = await pool.query(
        `
            SELECT s.PFNo, s.SName, g.Medical AS MedicalLimit
            FROM tblstaff s
            LEFT JOIN tblgrade g ON s.CGrade = g.GradeCode
            WHERE s.PFNo = ?
              AND (s.CompanyID = ? OR s.CompanyID IS NULL)
        `,
        [pfNo, resolvedCompanyId]
    );

    if (!staffRows.length) {
        return null;
    }

    const staff = staffRows[0];
    const [records] = await pool.query(
        `
            SELECT 
                m.TransNo,
                DATE_FORMAT(m.EntryDate, '%Y-%m-%d') AS EntryDate,
                m.PFNo,
                m.Dependant,
                m.MCode,
                mc.TransName,
                m.Amount,
                m.PicturePath
            FROM tblmedical m
            LEFT JOIN tblmcode mc ON m.MCode = mc.TCode
            WHERE m.PFNo = ?
              AND (m.CompanyID = ? OR m.CompanyID IS NULL)
            ORDER BY m.EntryDate DESC, m.TransNo DESC
        `,
        [pfNo, resolvedCompanyId]
    );

    const enrichedRecords = await enrichRowsWithWorkflowStatus(resolvedCompanyId, 'medical', records, {
        legacyApprovedField: null,
        noWorkflowImpliesApproved: true
    });

    const limit = Number(staff.MedicalLimit || 0);
    const used = enrichedRecords
        .filter((record) => record.WorkflowStatus === 'FINAL_APPROVED')
        .reduce((sum, record) => sum + Number(record.Amount || 0), 0);

    return {
        staff,
        records: enrichedRecords,
        balance: limit - used,
        limit,
        used
    };
}

async function saveMedicalDraft({ companyId, user, payload }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const actor = buildWorkflowActor(user);
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const transNoInput = Number(payload.transNo || 0);
        const entryDate = normalizeText(payload.entryDate);
        const pfNo = normalizeText(payload.pfno);
        const mCode = normalizeText(payload.mCode);
        const amount = Number(payload.amount || 0);
        const dependant = normalizeText(payload.dependant || payload.beneficiary || 'Self');
        const picturePath = payload.picturePath || null;

        let transNo = transNoInput;
        let previousReference = null;

        if (transNo > 0) {
            const [existingRows] = await connection.query(
                'SELECT * FROM tblmedical WHERE TransNo = ? AND (CompanyID = ? OR CompanyID IS NULL) LIMIT 1',
                [transNo, resolvedCompanyId]
            );
            if (!existingRows.length) {
                throw new Error('Medical draft not found.');
            }

            previousReference = recordWorkflowService.getModuleConfig('medical').buildReferenceFromRow(existingRows[0]);
            await recordWorkflowService.assertRecordEditableByReference(resolvedCompanyId, 'medical', previousReference, connection);

            const updateFields = ['EntryDate = ?', 'PFNo = ?', 'Dependant = ?', 'MCode = ?', 'Amount = ?'];
            const updateParams = [entryDate, pfNo, dependant, mCode, amount];
            if (picturePath) {
                updateFields.push('PicturePath = ?');
                updateParams.push(picturePath);
            }
            updateParams.push(transNo, resolvedCompanyId);

            await connection.query(
                `UPDATE tblmedical SET ${updateFields.join(', ')}, CompanyID = ? WHERE TransNo = ? AND (CompanyID = ? OR CompanyID IS NULL)`,
                [...updateParams.slice(0, -2), resolvedCompanyId, transNo, resolvedCompanyId]
            );
        } else {
            const [maxRows] = await connection.query('SELECT COALESCE(MAX(TransNo), 0) + 1 AS nextTransNo FROM tblmedical');
            transNo = Number(maxRows[0]?.nextTransNo || 1);
            await connection.query(
                `
                    INSERT INTO tblmedical (TransNo, EntryDate, PFNo, Dependant, MCode, Amount, PicturePath, TimeKeyed, CompanyID)
                    VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)
                `,
                [transNo, entryDate, pfNo, dependant, mCode, amount, picturePath, resolvedCompanyId]
            );
        }

        const recordReference = recordWorkflowService.getModuleConfig('medical').buildReferenceFromInput({ transNo });
        const savedRecord = await recordWorkflowService.fetchModuleRecord(resolvedCompanyId, 'medical', recordReference, connection);
        await recordWorkflowService.ensureDraftItemForExistingRecord({
            companyId: resolvedCompanyId,
            module: 'medical',
            recordReference,
            record: savedRecord,
            previousReference,
            user: actor,
            connection
        });

        await connection.commit();
        return { transNo, workflowReference: recordReference };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function getWelfareSurchargePageData({ companyId }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const [staffList, surchargeTypes, rowsResult] = await Promise.all([
        pool.query(staffStatusService.getActiveStaffQuery({ fields: 'PFNo, SName', orderBy: 'PFNo' })),
        getSurchargeTypes(),
        pool.query(
            `
                SELECT
                    s.*,
                    st.SName,
                    ty.Surcharge AS SurchargeTypeName
                FROM tblsurcharge s
                LEFT JOIN tblstaff st ON st.PFNo = s.PFNo
                LEFT JOIN tblsurchargetype ty ON ty.Code = s.SType
                WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
                ORDER BY COALESCE(s.EntryDate, s.StarDate) DESC, s.PFNo ASC
            `,
            [resolvedCompanyId]
        )
    ]);

    const rows = await enrichRowsWithWorkflowStatus(resolvedCompanyId, 'surcharge', rowsResult[0]);
    return {
        staffList: staffList[0],
        surchargeTypes,
        rows
    };
}

async function saveSurchargeDraft({ companyId, user, payload }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const actor = buildWorkflowActor(user);
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const pfNo = normalizeText(payload.pfNo || payload.pfno);
        const entryDate = normalizeText(payload.entryDate);
        const sType = normalizeText(payload.sType || payload.stype);
        const amountCode = normalizeText(payload.amountCode || payload.amount);
        const surchargeAmount = Number(payload.sAmount || payload.surchargeAmount || 0);
        const duration = Number(payload.duration || 0);
        const startDate = normalizeText(payload.startDate || payload.starDate);
        const expDate = normalizeText(payload.expDate);
        const bank = normalizeText(payload.bank);

        const previousReference = payload.previousReference ? normalizeText(payload.previousReference) : null;
        if (previousReference) {
            await recordWorkflowService.assertRecordEditableByReference(resolvedCompanyId, 'surcharge', previousReference, connection);
            const [prevPfNo, prevEntryDate, prevSType, prevStartDate] = previousReference.split('|').map((entry) => decodeURIComponent(entry));
            const sqlPrevEntryDate = prevEntryDate ? new Date(prevEntryDate).toISOString().slice(0, 19).replace('T', ' ') : null;
            const sqlPrevStartDate = prevStartDate ? new Date(prevStartDate).toISOString().slice(0, 19).replace('T', ' ') : null;

            await connection.query(
                `
                    UPDATE tblsurcharge
                    SET EntryDate = ?, PFNo = ?, SType = ?, Amount = ?, SAmount = ?, Duration = ?, StarDate = ?, ExpDate = ?,
                        TimeKeyed = NOW(), Approved = 0, Expired = 0, Bank = ?, CompanyID = ?
                    WHERE (CompanyID = ? OR CompanyID IS NULL)
                      AND PFNo = ?
                      AND (COALESCE(EntryDate, '1900-01-01') = COALESCE(?, COALESCE(EntryDate, '1900-01-01'))
                           OR COALESCE(EntryDate, '1900-01-01') = COALESCE(?, COALESCE(EntryDate, '1900-01-01'))
                           OR DATE(COALESCE(EntryDate, '1900-01-01')) = DATE(COALESCE(?, COALESCE(EntryDate, '1900-01-01'))))
                      AND SType = ?
                      AND (COALESCE(StarDate, '1900-01-01') = COALESCE(?, COALESCE(StarDate, '1900-01-01'))
                           OR COALESCE(StarDate, '1900-01-01') = COALESCE(?, COALESCE(StarDate, '1900-01-01'))
                           OR DATE(COALESCE(StarDate, '1900-01-01')) = DATE(COALESCE(?, COALESCE(StarDate, '1900-01-01'))))
                `,
                [
                    entryDate || null, pfNo, sType, amountCode || null, surchargeAmount, duration || null, startDate || null, expDate || null,
                    bank || null, resolvedCompanyId, resolvedCompanyId, prevPfNo,
                    sqlPrevEntryDate || null, prevEntryDate || null, sqlPrevEntryDate || null,
                    prevSType,
                    sqlPrevStartDate || null, prevStartDate || null, sqlPrevStartDate || null
                ]
            );
        } else {
            await connection.query(
                `
                    INSERT INTO tblsurcharge (
                        EntryDate, PFNo, SType, Amount, SAmount, Duration, StarDate, ExpDate,
                        TimeKeyed, Approved, Expired, Bank, CompanyID
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0, 0, ?, ?)
                `,
                [entryDate || null, pfNo, sType, amountCode || null, surchargeAmount, duration || null, startDate || null, expDate || null, bank || null, resolvedCompanyId]
            );
        }

        const recordReference = recordWorkflowService.getModuleConfig('surcharge').buildReferenceFromInput({
            pfNo,
            entryDate,
            sType,
            startDate
        });
        const savedRecord = await recordWorkflowService.fetchModuleRecord(resolvedCompanyId, 'surcharge', recordReference, connection);
        await recordWorkflowService.ensureDraftItemForExistingRecord({
            companyId: resolvedCompanyId,
            module: 'surcharge',
            recordReference,
            record: savedRecord,
            previousReference,
            user: actor,
            connection
        });

        await connection.commit();
        return { workflowReference: recordReference };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function getFinanceFinancialDeductionsData({ companyId, payrollDate = null }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedPayrollDate = normalizeDate(payrollDate) || new Date().toISOString().slice(0, 10);

    const [loanRowsResult, medicalRowsResult, surchargeRowsResult] = await Promise.all([
        pool.query(
            `
                SELECT
                    l.TransNo,
                    l.EntryDate,
                    l.PFNo,
                    s.SName,
                    d.Dept AS DeptName,
                    lc.TransName AS LoanTypeName,
                    l.Amount,
                    l.LoanBal,
                    l.MonthlyRepayment,
                    l.Interest,
                    l.MonthlyInt,
                    l.StartDate,
                    l.ExpDate,
                    l.RepaidAmount,
                    l.Approved
                FROM tblloan l
                LEFT JOIN tblstaff s ON s.PFNo = l.PFNo
                LEFT JOIN tbldept d ON d.Code = s.CDept
                LEFT JOIN tblloancode lc ON lc.TCode = l.LTrans
                WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
                  AND COALESCE(l.Approved, 0) IN (-1, 1)
                ORDER BY l.EntryDate DESC, l.TransNo DESC
                LIMIT 150
            `,
            [resolvedCompanyId]
        ),
        pool.query(
            `
                SELECT
                    m.TransNo,
                    m.EntryDate,
                    m.PFNo,
                    s.SName,
                    d.Dept AS DeptName,
                    m.Dependant,
                    m.MCode,
                    mc.TransName AS MedicalDescription,
                    m.Amount,
                    m.PicturePath
                FROM tblmedical m
                LEFT JOIN tblstaff s ON s.PFNo = m.PFNo
                LEFT JOIN tbldept d ON d.Code = s.CDept
                LEFT JOIN tblmcode mc ON mc.TCode = m.MCode
                WHERE (m.CompanyID = ? OR m.CompanyID IS NULL)
                ORDER BY m.EntryDate DESC, m.TransNo DESC
                LIMIT 150
            `,
            [resolvedCompanyId]
        ),
        pool.query(
            `
                SELECT
                    s.*,
                    st.SName,
                    d.Dept AS DeptName,
                    ty.Surcharge AS SurchargeTypeName
                FROM tblsurcharge s
                LEFT JOIN tblstaff st ON st.PFNo = s.PFNo
                LEFT JOIN tbldept d ON d.Code = st.CDept
                LEFT JOIN tblsurchargetype ty ON ty.Code = s.SType
                WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND COALESCE(s.Approved, 0) IN (-1, 1)
                ORDER BY COALESCE(s.EntryDate, s.StarDate) DESC, s.PFNo ASC
                LIMIT 150
            `,
            [resolvedCompanyId]
        )
    ]);

    const loans = await enrichRowsWithWorkflowStatus(resolvedCompanyId, 'loan', loanRowsResult[0]);
    const medical = (await enrichRowsWithWorkflowStatus(resolvedCompanyId, 'medical', medicalRowsResult[0], {
        legacyApprovedField: null,
        noWorkflowImpliesApproved: true
    })).filter((row) => row.WorkflowStatus === 'FINAL_APPROVED');
    const surcharges = await enrichRowsWithWorkflowStatus(resolvedCompanyId, 'surcharge', surchargeRowsResult[0]);

    return {
        payrollDate: normalizedPayrollDate,
        loans,
        medical,
        surcharges,
        totals: {
            activeLoanMonthlyRepayment: loans
                .filter((row) => Number(row.LoanBal || 0) > 0 && Number(row.Repaid || 0) === 0 && Number(row.Expired || 0) === 0)
                .reduce((sum, row) => sum + Number(row.MonthlyRepayment || 0), 0),
            medicalCurrentMonth: medical
                .filter((row) => {
                    const entry = normalizeDate(row.EntryDate);
                    return entry && entry.slice(0, 7) === normalizedPayrollDate.slice(0, 7);
                })
                .reduce((sum, row) => sum + Number(row.Amount || 0), 0),
            activeSurchargeAmount: surcharges
                .filter((row) => Number(row.Expired || 0) === 0)
                .reduce((sum, row) => sum + Number(row.SAmount || 0), 0)
        }
    };
}

module.exports = {
    getLoanBalanceEnquiryData,
    getMedicalEnquiryData,
    getLoanReportData,
    getStaffLoanHistoryData,
    getStaffMedicalHistoryData,
    getWelfareLoanPageData,
    getWelfareMedicalPageData,
    getWelfareSurchargePageData,
    getFinanceFinancialDeductionsData,
    saveLoanDraft,
    saveLoanRepaymentDraft,
    saveMedicalDraft,
    saveSurchargeDraft
};
