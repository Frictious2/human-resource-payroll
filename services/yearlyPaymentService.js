const crypto = require('crypto');
const pool = require('../config/db');
const auditTrailService = require('./auditTrailService');
const workflowNotificationService = require('./workflowNotificationService');
const workQueueService = require('./workQueueService');
const staffStatusService = require('./staffStatusService');

const YEARLY_PAYMENT_TYPES = Object.freeze({
    RENT: '02',
    INDUCEMENT: '05',
    LEAVE: '13'
});

const YEARLY_PAYMENT_TYPE_META = Object.freeze({
    [YEARLY_PAYMENT_TYPES.RENT]: {
        code: YEARLY_PAYMENT_TYPES.RENT,
        label: 'Rent',
        payrollItemCode: '02'
    },
    [YEARLY_PAYMENT_TYPES.INDUCEMENT]: {
        code: YEARLY_PAYMENT_TYPES.INDUCEMENT,
        label: 'Inducement',
        payrollItemCode: '05'
    },
    [YEARLY_PAYMENT_TYPES.LEAVE]: {
        code: YEARLY_PAYMENT_TYPES.LEAVE,
        label: 'Leave',
        payrollItemCode: '13'
    }
});

const YEARLY_PAYMENT_STATUSES = Object.freeze({
    DRAFT: 'DRAFT',
    CALCULATED: 'CALCULATED',
    SUBMITTED_TO_MANAGER: 'SUBMITTED_TO_MANAGER',
    MANAGER_ENDORSED: 'MANAGER_ENDORSED',
    RETURNED_BY_MANAGER: 'RETURNED_BY_MANAGER',
    SUBMITTED_TO_AUDITOR: 'SUBMITTED_TO_AUDITOR',
    AUDITOR_ENDORSED: 'AUDITOR_ENDORSED',
    RETURNED_BY_AUDITOR: 'RETURNED_BY_AUDITOR',
    SUBMITTED_TO_ENTITY_HEAD: 'SUBMITTED_TO_ENTITY_HEAD',
    FINAL_APPROVED: 'FINAL_APPROVED',
    FINAL_REJECTED: 'FINAL_REJECTED',
    APPLIED: 'APPLIED'
});

const LEGACY_APPROVED_VALUE = 1;
const YEARLY_TAX_RATE = 0.30;

function normalizeCompanyId(companyId) {
    return Number(companyId) || 1;
}

function normalizeYear(value) {
    return Number(value) || new Date().getFullYear();
}

function normalizePaymentDate(value, fallbackYear) {
    const raw = String(value || '').trim();
    if (raw) {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString().slice(0, 10);
        }
    }

    return `${fallbackYear}-12-31`;
}

function normalizeUser(user = {}, fallbackRole = 'finance-officer', fallbackName = 'Finance Officer') {
    return {
        id: Number(user.id || user.pfno || user.PFNo || 0) || 0,
        role: String(user.role || user.level || fallbackRole).trim(),
        name: String(user.name || user.fullName || user.username || fallbackName).trim()
    };
}

function roundCurrency(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function computeChecksum(value) {
    return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

async function ensureYearlyPaymentTables(connection = null) {
    const executor = connection || pool;
    await executor.query(`
        CREATE TABLE IF NOT EXISTS yearly_payment_batches (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            CompanyID INT NOT NULL,
            PaymentYear SMALLINT NOT NULL,
            PaymentType VARCHAR(10) NOT NULL,
            PaymentDate DATE NOT NULL,
            Status VARCHAR(50) NOT NULL,
            TotalStaff INT NOT NULL DEFAULT 0,
            TotalAmount DECIMAL(18,2) NOT NULL DEFAULT 0,
            PreparedBy VARCHAR(100) NOT NULL,
            PreparedByUserID INT NULL,
            PreparedAt DATETIME NOT NULL,
            SubmittedAt DATETIME NULL,
            ManagerEndorsedBy VARCHAR(100) NULL,
            ManagerEndorsedAt DATETIME NULL,
            ManagerComments TEXT NULL,
            AuditorEndorsedBy VARCHAR(100) NULL,
            AuditorEndorsedAt DATETIME NULL,
            AuditorComments TEXT NULL,
            FinalApprovedBy VARCHAR(100) NULL,
            FinalApprovedAt DATETIME NULL,
            EntityHeadComments TEXT NULL,
            RejectedBy VARCHAR(100) NULL,
            RejectedAt DATETIME NULL,
            RejectionReason TEXT NULL,
            AppliedAt DATETIME NULL,
            AppliedBy VARCHAR(100) NULL,
            AppliedByUserID INT NULL,
            SnapshotChecksum VARCHAR(128) NOT NULL,
            SnapshotMetadata LONGTEXT NULL,
            CreatedAt DATETIME NOT NULL,
            UpdatedAt DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_yearly_payment_batches_company_year_type (CompanyID, PaymentYear, PaymentType),
            KEY idx_yearly_payment_batches_company_status (CompanyID, Status),
            KEY idx_yearly_payment_batches_type_status (PaymentType, Status),
            KEY idx_yearly_payment_batches_submitted (SubmittedAt)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await executor.query(`
        CREATE TABLE IF NOT EXISTS yearly_payment_batch_actions (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            BatchID BIGINT UNSIGNED NOT NULL,
            CompanyID INT NOT NULL,
            Action VARCHAR(80) NOT NULL,
            FromStatus VARCHAR(50) NULL,
            ToStatus VARCHAR(50) NOT NULL,
            ActionBy VARCHAR(100) NOT NULL,
            ActionByUserID INT NULL,
            ActionAt DATETIME NOT NULL,
            Comments TEXT NULL,
            Metadata LONGTEXT NULL,
            Result VARCHAR(100) NULL,
            PRIMARY KEY (id),
            KEY idx_yearly_payment_batch_actions_batch (BatchID),
            KEY idx_yearly_payment_batch_actions_company (CompanyID)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await executor.query(`
        CREATE TABLE IF NOT EXISTS yearly_payment_batch_rows (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            BatchID BIGINT UNSIGNED NOT NULL,
            CompanyID INT NOT NULL,
            PFNo VARCHAR(50) NOT NULL,
            PaymentType VARCHAR(10) NOT NULL,
            RowOrder INT NOT NULL DEFAULT 0,
            StaffName VARCHAR(255) NOT NULL,
            DepartmentCode VARCHAR(50) NULL,
            DepartmentName VARCHAR(255) NULL,
            GradeCode VARCHAR(50) NULL,
            GradeName VARCHAR(255) NULL,
            JobTitleCode VARCHAR(50) NULL,
            JobTitleName VARCHAR(255) NULL,
            DateOfEmployment DATE NULL,
            YearsServed DECIMAL(10,2) NULL,
            BaseSalary DECIMAL(18,2) NOT NULL DEFAULT 0,
            PayrollItemPercent DECIMAL(18,2) NOT NULL DEFAULT 0,
            MonthlyAmount DECIMAL(18,2) NOT NULL DEFAULT 0,
            TotalIncome DECIMAL(18,2) NOT NULL DEFAULT 0,
            TaxableAmount DECIMAL(18,2) NOT NULL DEFAULT 0,
            TaxAmount DECIMAL(18,2) NOT NULL DEFAULT 0,
            NetIncome DECIMAL(18,2) NOT NULL DEFAULT 0,
            FixedFlag TINYINT NOT NULL DEFAULT 0,
            FirstYearRentReduction TINYINT NOT NULL DEFAULT 0,
            EligibilityStatus VARCHAR(50) NOT NULL DEFAULT 'ELIGIBLE',
            EligibilityReason VARCHAR(255) NULL,
            CalculationBasis VARCHAR(255) NULL,
            SourceSnapshot LONGTEXT NULL,
            CreatedAt DATETIME NOT NULL,
            UpdatedAt DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_yearly_payment_batch_rows_batch_pfno (BatchID, PFNo),
            KEY idx_yearly_payment_batch_rows_company_type (CompanyID, PaymentType)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function getPayrollItemFieldMapping(companyId) {
    const [rows] = await pool.query(
        `SELECT Code, Income, Taxable, Threshhold, TPercent, TPercentage, TAmount, Mode, AddBack, Fixed, Percent, Freq, CompanyID
         FROM tblpayrollitems
         WHERE CompanyID = ? OR CompanyID IS NULL
         ORDER BY Code`,
        [normalizeCompanyId(companyId)]
    );

    return rows.map((row) => ({
        code: row.Code,
        income: row.Income,
        fieldMapping: [
            { field: 'Code', legacyColumn: 'Code', businessMeaning: 'Payroll item code', usedBy: 'Payroll setup / calculations' },
            { field: 'Income', legacyColumn: 'Income', businessMeaning: 'Payroll item label', usedBy: 'Payroll setup / reports' },
            { field: 'Freq', legacyColumn: 'Freq', businessMeaning: 'Payment frequency: M monthly or Y yearly', usedBy: 'Process Emoluments duplicate checks and yearly-payment scoping' },
            { field: 'Taxable', legacyColumn: 'Taxable', businessMeaning: 'Whether the item contributes to taxable income', usedBy: 'Payroll tax treatment / yearly payment taxable amount' },
            { field: 'Threshhold', legacyColumn: 'Threshhold', businessMeaning: 'Legacy threshold flag for tax/base handling', usedBy: 'Legacy payroll item semantics' },
            { field: 'TPercent', legacyColumn: 'TPercent', businessMeaning: 'Legacy threshold-percentage flag', usedBy: 'Legacy payroll item semantics' },
            { field: 'TPercentage', legacyColumn: 'TPercentage', businessMeaning: 'Legacy threshold percentage value', usedBy: 'Legacy payroll item semantics' },
            { field: 'TAmount', legacyColumn: 'TAmount', businessMeaning: 'Legacy threshold amount or reference amount', usedBy: 'Legacy payroll item semantics' },
            { field: 'Mode', legacyColumn: 'Mode', businessMeaning: 'Legacy calculation mode', usedBy: 'Legacy payroll item semantics' },
            { field: 'AddBack', legacyColumn: 'AddBack', businessMeaning: 'Legacy add-back indicator', usedBy: 'Tax/base handling' },
            { field: 'Fixed', legacyColumn: 'Fixed', businessMeaning: 'Fixed versus variable item behavior', usedBy: 'Payroll item calculation path' },
            { field: 'Percent', legacyColumn: 'Percent', businessMeaning: 'Configured percentage used where the item is percentage-based', usedBy: 'Monthly/yearly allowance calculations' }
        ]
    }));
}

async function getCurrentLoanParameterSnapshot(companyId) {
    const [rows] = await pool.query(
        `SELECT SeqNo, AdvanceInt, LoanDuration, QueryLimit, RetireAge, CompanyID
         FROM tblparams1
         WHERE CompanyID = ? OR CompanyID IS NULL
         LIMIT 1`,
        [normalizeCompanyId(companyId)]
    );
    return rows[0] || null;
}

async function getSupportedYearlyTypes(companyId) {
    const [rows] = await pool.query(
        `SELECT Code, PayType
         FROM tblpaytype
         WHERE (CompanyID = ? OR CompanyID IS NULL)
           AND Code IN ('02', '05', '13')
         ORDER BY Code`,
        [normalizeCompanyId(companyId)]
    );

    return rows.map((row) => ({
        code: String(row.Code).padStart(2, '0'),
        label: row.PayType || YEARLY_PAYMENT_TYPE_META[String(row.Code).padStart(2, '0')]?.label || row.Code
    }));
}

async function getPaymentTypeConfig(connection, companyId, paymentType) {
    const normalizedType = String(paymentType || '').padStart(2, '0');
    const [payTypeRows] = await connection.query(
        `SELECT Code, PayType
         FROM tblpaytype
         WHERE (CompanyID = ? OR CompanyID IS NULL)
           AND Code = ?
         LIMIT 1`,
        [normalizeCompanyId(companyId), normalizedType]
    );

    const [itemRows] = await connection.query(
        `SELECT Code, Income, Taxable, Threshhold, TPercent, TPercentage, TAmount, Mode, AddBack, Fixed, Percent, Freq
         FROM tblpayrollitems
         WHERE (CompanyID = ? OR CompanyID IS NULL)
           AND Code = ?
         ORDER BY CompanyID DESC
         LIMIT 1`,
        [normalizeCompanyId(companyId), normalizedType]
    );

    if (!payTypeRows.length || !itemRows.length) {
        throw new Error('The selected yearly payment type is not configured.');
    }

    return {
        code: normalizedType,
        label: payTypeRows[0].PayType || itemRows[0].Income || normalizedType,
        payrollItem: itemRows[0]
    };
}

function buildYearlyRowSnapshot(row) {
    return {
        PFNo: row.PFNo,
        StaffName: row.StaffName,
        DepartmentCode: row.DepartmentCode,
        GradeCode: row.GradeCode,
        JobTitleCode: row.JobTitleCode,
        DateOfEmployment: row.DateOfEmployment,
        BaseSalary: row.BaseSalary,
        PayrollItemPercent: row.PayrollItemPercent,
        MonthlyAmount: row.MonthlyAmount,
        TotalIncome: row.TotalIncome,
        TaxableAmount: row.TaxableAmount,
        TaxAmount: row.TaxAmount,
        NetIncome: row.NetIncome,
        FirstYearRentReduction: row.FirstYearRentReduction,
        EligibilityStatus: row.EligibilityStatus,
        EligibilityReason: row.EligibilityReason
    };
}

async function calculatePreview(connection, { companyId, paymentYear, paymentType, paymentDate }) {
    const resolvedCompanyId = normalizeCompanyId(companyId);
    const resolvedYear = normalizeYear(paymentYear);
    const resolvedDate = normalizePaymentDate(paymentDate, resolvedYear);
    const config = await getPaymentTypeConfig(connection, resolvedCompanyId, paymentType);
    const percent = Number(config.payrollItem.Percent || 0);
    const fixedFlag = Number(config.payrollItem.Fixed || 0) !== 0;
    const taxableFlag = Number(config.payrollItem.Taxable || 0) !== 0;
    const paymentMonth = Number(resolvedDate.slice(5, 7));

    const [rows] = await connection.query(
        `
            SELECT
                s.PFNo,
                s.CompanyID AS StaffCompanyID,
                s.SName AS StaffName,
                s.CDept AS DepartmentCode,
                d.Dept AS DepartmentName,
                s.CGrade AS GradeCode,
                g.Grade AS GradeName,
                s.JobTitle AS JobTitleCode,
                j.JobTitle AS JobTitleName,
                DATE(s.DOE) AS DateOfEmployment,
                TIMESTAMPDIFF(MONTH, DATE(s.DOE), ?) / 12 AS YearsServed,
                COALESCE(sal.Salary, 0) AS BaseSalary
            FROM tblstaff s
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN tblgrade g
                ON g.GradeCode = s.CGrade
            LEFT JOIN tbljobtitle j
                ON j.Code = s.JobTitle
            LEFT JOIN (
                SELECT s1.PFNo, MAX(s1.Salary) AS Salary
                FROM tblsalary s1
                INNER JOIN (
                    SELECT PFNo, MAX(PDate) AS MaxPDate
                    FROM tblsalary
                    WHERE COALESCE(Approved, 0) IN (-1, 1)
                      AND (CompanyID = ? OR CompanyID IS NULL)
                    GROUP BY PFNo
                ) latest
                    ON latest.PFNo = s1.PFNo
                   AND latest.MaxPDate = s1.PDate
                WHERE COALESCE(s1.Approved, 0) IN (-1, 1)
                  AND (s1.CompanyID = ? OR s1.CompanyID IS NULL)
                GROUP BY s1.PFNo
            ) sal
                ON sal.PFNo = s.PFNo
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND ${staffStatusService.getActiveStaffFilter('s')}
            ORDER BY s.PFNo, (s.CompanyID = ?) DESC
        `,
        [resolvedDate, resolvedCompanyId, resolvedCompanyId, resolvedCompanyId, resolvedCompanyId]
    );

    const seenStaff = new Set();
    const uniqueRows = rows.filter((row) => {
        const pfno = String(row.PFNo || '').trim();
        if (!pfno || seenStaff.has(pfno)) return false;
        seenStaff.add(pfno);
        return true;
    });

    const previewRows = uniqueRows.map((row, index) => {
        const baseSalary = roundCurrency(row.BaseSalary || 0);
        const monthlyAmount = roundCurrency(baseSalary * (percent / 100));
        const employedThisYear = row.DateOfEmployment && String(row.DateOfEmployment).slice(0, 4) === String(resolvedYear);
        const firstYearRentReduction = config.code === YEARLY_PAYMENT_TYPES.RENT && employedThisYear;
        const multiplierMonths = firstYearRentReduction ? 6 : 12;
        const totalIncome = roundCurrency(monthlyAmount * multiplierMonths);
        const taxableAmount = taxableFlag ? totalIncome : 0;
        const taxAmount = taxableFlag ? roundCurrency(taxableAmount * YEARLY_TAX_RATE) : 0;
        const netIncome = roundCurrency(totalIncome - taxAmount);
        const eligibilityReason = baseSalary > 0 ? '' : 'No approved basic salary was found.';
        const eligibilityStatus = baseSalary > 0 ? 'ELIGIBLE' : 'EXCLUDED';
        const calculationBasis = `${percent}% of approved basic salary${firstYearRentReduction ? ' capped to six months for first employment year' : ' for twelve months'}`;

        return {
            PFNo: row.PFNo,
            PaymentType: config.code,
            RowOrder: index + 1,
            StaffName: row.StaffName || row.PFNo,
            DepartmentCode: row.DepartmentCode || '',
            DepartmentName: row.DepartmentName || '',
            GradeCode: row.GradeCode || '',
            GradeName: row.GradeName || '',
            JobTitleCode: row.JobTitleCode || '',
            JobTitleName: row.JobTitleName || '',
            DateOfEmployment: row.DateOfEmployment ? new Date(row.DateOfEmployment).toISOString().slice(0, 10) : null,
            YearsServed: row.YearsServed != null ? roundCurrency(row.YearsServed) : 0,
            BaseSalary: baseSalary,
            PayrollItemPercent: percent,
            MonthlyAmount: monthlyAmount,
            TotalIncome: totalIncome,
            TaxableAmount: taxableAmount,
            TaxAmount: taxAmount,
            NetIncome: netIncome,
            FixedFlag: fixedFlag ? 1 : 0,
            FirstYearRentReduction: firstYearRentReduction ? 1 : 0,
            EligibilityStatus: eligibilityStatus,
            EligibilityReason: eligibilityReason || null,
            CalculationBasis: calculationBasis,
            SourceSnapshot: JSON.stringify({
                paymentYear: resolvedYear,
                paymentMonth,
                paymentDate: resolvedDate,
                payTypeLabel: config.label,
                payrollItem: {
                    Code: config.payrollItem.Code,
                    Income: config.payrollItem.Income,
                    Percent: config.payrollItem.Percent,
                    Fixed: config.payrollItem.Fixed,
                    Taxable: config.payrollItem.Taxable,
                    Freq: config.payrollItem.Freq
                },
                staff: {
                    PFNo: row.PFNo,
                    StaffName: row.StaffName,
                    DepartmentCode: row.DepartmentCode,
                    GradeCode: row.GradeCode,
                    JobTitleCode: row.JobTitleCode,
                    DateOfEmployment: row.DateOfEmployment,
                    BaseSalary: baseSalary
                }
            })
        };
    });

    const eligibleRows = previewRows.filter((row) => row.EligibilityStatus === 'ELIGIBLE');
    const checksum = computeChecksum(eligibleRows.map((row) => buildYearlyRowSnapshot(row)));
    return {
        config,
        paymentYear: resolvedYear,
        paymentDate: resolvedDate,
        paymentMonth,
        rows: previewRows,
        eligibleRows,
        totalStaff: eligibleRows.length,
        totalAmount: roundCurrency(eligibleRows.reduce((sum, row) => sum + Number(row.TotalIncome || 0), 0)),
        checksum
    };
}

async function replaceBatchRows(connection, batchId, companyId, rows) {
    await connection.query('DELETE FROM yearly_payment_batch_rows WHERE BatchID = ?', [batchId]);
    for (const row of rows) {
        await connection.query(
            `
                INSERT INTO yearly_payment_batch_rows (
                    BatchID, CompanyID, PFNo, PaymentType, RowOrder, StaffName, DepartmentCode, DepartmentName,
                    GradeCode, GradeName, JobTitleCode, JobTitleName, DateOfEmployment, YearsServed,
                    BaseSalary, PayrollItemPercent, MonthlyAmount, TotalIncome, TaxableAmount, TaxAmount,
                    NetIncome, FixedFlag, FirstYearRentReduction, EligibilityStatus, EligibilityReason,
                    CalculationBasis, SourceSnapshot, CreatedAt, UpdatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `,
            [
                batchId,
                normalizeCompanyId(companyId),
                row.PFNo,
                row.PaymentType,
                row.RowOrder,
                row.StaffName,
                row.DepartmentCode || null,
                row.DepartmentName || null,
                row.GradeCode || null,
                row.GradeName || null,
                row.JobTitleCode || null,
                row.JobTitleName || null,
                row.DateOfEmployment || null,
                row.YearsServed,
                row.BaseSalary,
                row.PayrollItemPercent,
                row.MonthlyAmount,
                row.TotalIncome,
                row.TaxableAmount,
                row.TaxAmount,
                row.NetIncome,
                row.FixedFlag,
                row.FirstYearRentReduction,
                row.EligibilityStatus,
                row.EligibilityReason || null,
                row.CalculationBasis || null,
                row.SourceSnapshot || null
            ]
        );
    }
}

async function logBatchAction(connection, {
    batchId,
    companyId,
    action,
    fromStatus,
    toStatus,
    actor,
    comments = '',
    metadata = null,
    result = 'SUCCESS'
}) {
    await connection.query(
        `
            INSERT INTO yearly_payment_batch_actions (
                BatchID, CompanyID, Action, FromStatus, ToStatus, ActionBy, ActionByUserID,
                ActionAt, Comments, Metadata, Result
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
        `,
        [
            batchId,
            normalizeCompanyId(companyId),
            action,
            fromStatus || null,
            toStatus,
            actor.name,
            actor.id || null,
            comments || null,
            metadata ? JSON.stringify(metadata) : null,
            result || null
        ]
    );
}

async function getBatchById(companyId, batchId, connection = null) {
    await ensureYearlyPaymentTables(connection);
    const executor = connection || pool;
    const [rows] = await executor.query(
        `SELECT * FROM yearly_payment_batches WHERE id = ? AND CompanyID = ? LIMIT 1`,
        [Number(batchId) || 0, normalizeCompanyId(companyId)]
    );
    return rows[0] || null;
}

async function getBatchRows(batchId, connection = null) {
    await ensureYearlyPaymentTables(connection);
    const executor = connection || pool;
    const [rows] = await executor.query(
        `SELECT * FROM yearly_payment_batch_rows WHERE BatchID = ? ORDER BY RowOrder ASC, PFNo ASC`,
        [Number(batchId) || 0]
    );
    return rows;
}

async function getBatchActions(batchId, connection = null) {
    await ensureYearlyPaymentTables(connection);
    const executor = connection || pool;
    const [rows] = await executor.query(
        `SELECT * FROM yearly_payment_batch_actions WHERE BatchID = ? ORDER BY ActionAt ASC, id ASC`,
        [Number(batchId) || 0]
    );
    return rows;
}

async function getFinancePageData({ companyId, filters = {} }) {
    await ensureYearlyPaymentTables();
    const resolvedCompanyId = normalizeCompanyId(companyId);
    const paymentYear = normalizeYear(filters.paymentYear);
    const [companyRows, batches, supportedTypes, loanParams, fieldMapRows] = await Promise.all([
        pool.query('SELECT CompanyID, Com_Name, Address, LogoPath FROM tblcominfo LIMIT 1'),
        pool.query(
            `SELECT b.*, pt.PayType AS PaymentTypeName
             FROM yearly_payment_batches b
             LEFT JOIN tblpaytype pt
               ON pt.Code = b.PaymentType
              AND (pt.CompanyID = b.CompanyID OR pt.CompanyID IS NULL)
             WHERE b.CompanyID = ?
             ORDER BY b.PaymentYear DESC, b.PaymentType ASC, b.id DESC`,
            [resolvedCompanyId]
        ),
        getSupportedYearlyTypes(resolvedCompanyId),
        getCurrentLoanParameterSnapshot(resolvedCompanyId),
        getPayrollItemFieldMapping(resolvedCompanyId)
    ]);

    return {
        company: companyRows[0][0] || { CompanyID: resolvedCompanyId, Com_Name: 'Human Resource Payroll' },
        filters: {
            paymentYear
        },
        supportedTypes,
        loanParams,
        payrollItemFieldMap: fieldMapRows,
        batches: batches[0]
    };
}

async function createOrUpdateDraft({ companyId, user, payload }) {
    const actor = normalizeUser(user, 'finance-officer', 'Finance Officer');
    const resolvedCompanyId = normalizeCompanyId(companyId);
    const paymentYear = normalizeYear(payload.paymentYear);
    const paymentType = String(payload.paymentType || '').padStart(2, '0');
    const paymentDate = normalizePaymentDate(payload.paymentDate, paymentYear);
    const connection = await pool.getConnection();

    try {
        await ensureYearlyPaymentTables(connection);
        await workflowNotificationService.ensureNotificationTable(connection);
        await connection.beginTransaction();

        const preview = await calculatePreview(connection, {
            companyId: resolvedCompanyId,
            paymentYear,
            paymentType,
            paymentDate
        });

        const [existingRows] = await connection.query(
            `SELECT * FROM yearly_payment_batches WHERE CompanyID = ? AND PaymentYear = ? AND PaymentType = ? LIMIT 1`,
            [resolvedCompanyId, paymentYear, paymentType]
        );

        let batchId;
        let status = YEARLY_PAYMENT_STATUSES.CALCULATED;
        if (existingRows.length) {
            const existing = existingRows[0];
            if (![YEARLY_PAYMENT_STATUSES.DRAFT, YEARLY_PAYMENT_STATUSES.CALCULATED, YEARLY_PAYMENT_STATUSES.RETURNED_BY_MANAGER, YEARLY_PAYMENT_STATUSES.RETURNED_BY_AUDITOR].includes(existing.Status)) {
                throw new Error('This yearly payment batch can no longer be edited. Create a new year/type combination or use the existing approved batch.');
            }

            batchId = existing.id;
            status = existing.Status === YEARLY_PAYMENT_STATUSES.DRAFT ? YEARLY_PAYMENT_STATUSES.DRAFT : YEARLY_PAYMENT_STATUSES.CALCULATED;
            await connection.query(
                `UPDATE yearly_payment_batches
                 SET PaymentDate = ?, Status = ?, TotalStaff = ?, TotalAmount = ?, SnapshotChecksum = ?, SnapshotMetadata = ?, UpdatedAt = NOW()
                 WHERE id = ?`,
                [
                    preview.paymentDate,
                    status,
                    preview.totalStaff,
                    preview.totalAmount,
                    preview.checksum,
                    JSON.stringify({
                        config: preview.config,
                        paymentMonth: preview.paymentMonth,
                        paymentYear: preview.paymentYear
                    }),
                    batchId
                ]
            );

            await logBatchAction(connection, {
                batchId,
                companyId: resolvedCompanyId,
                action: 'RECALCULATE_DRAFT',
                fromStatus: existing.Status,
                toStatus: status,
                actor,
                comments: String(payload.reason || '').trim(),
                metadata: { paymentType, paymentYear, paymentDate: preview.paymentDate }
            });
        } else {
            const [insertResult] = await connection.query(
                `INSERT INTO yearly_payment_batches (
                    CompanyID, PaymentYear, PaymentType, PaymentDate, Status, TotalStaff, TotalAmount,
                    PreparedBy, PreparedByUserID, PreparedAt, SnapshotChecksum, SnapshotMetadata, CreatedAt, UpdatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW(), NOW())`,
                [
                    resolvedCompanyId,
                    paymentYear,
                    paymentType,
                    preview.paymentDate,
                    YEARLY_PAYMENT_STATUSES.DRAFT,
                    preview.totalStaff,
                    preview.totalAmount,
                    actor.name,
                    actor.id || null,
                    preview.checksum,
                    JSON.stringify({
                        config: preview.config,
                        paymentMonth: preview.paymentMonth,
                        paymentYear: preview.paymentYear
                    })
                ]
            );
            batchId = insertResult.insertId;
            status = YEARLY_PAYMENT_STATUSES.DRAFT;
            await logBatchAction(connection, {
                batchId,
                companyId: resolvedCompanyId,
                action: 'CREATE_DRAFT',
                fromStatus: null,
                toStatus: status,
                actor,
                comments: String(payload.reason || '').trim(),
                metadata: { paymentType, paymentYear, paymentDate: preview.paymentDate }
            });
        }

        await replaceBatchRows(connection, batchId, resolvedCompanyId, preview.rows);

        await auditTrailService.writeAuditEntryWithExecutor(connection, {
            action: existingRows.length ? 'UPDATE' : 'CREATE',
            tableName: 'yearly_payment_batches',
            recordId: String(batchId),
            description: `${existingRows.length ? 'Updated' : 'Created'} yearly payment batch ${paymentType}/${paymentYear}`,
            user: {
                PFNo: String(actor.id || 0),
                Username: actor.name,
                CompanyID: resolvedCompanyId
            }
        });

        await connection.commit();
        return getBatchDetail({ companyId: resolvedCompanyId, batchId });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function assertSubmittedBatchStillCurrent(connection, batch) {
    const preview = await calculatePreview(connection, {
        companyId: batch.CompanyID,
        paymentYear: batch.PaymentYear,
        paymentType: batch.PaymentType,
        paymentDate: batch.PaymentDate
    });
    if (preview.checksum !== batch.SnapshotChecksum) {
        throw new Error('The yearly payment source data changed after submission. Please return the batch for recalculation and resubmission.');
    }
}

async function notifyYearlyPaymentAction(connection, {
    batch,
    actor,
    notificationType,
    title,
    message,
    actionUrl,
    recipientRoles,
    eventKeyBase
}) {
    const recipients = [];
    for (const role of recipientRoles) {
        recipients.push(...await workflowNotificationService.getUsersByRole(batch.CompanyID, role, connection));
    }
    await workflowNotificationService.createNotifications(connection, {
        companyId: batch.CompanyID,
        recipients,
        notificationType,
        module: 'yearly-payment-batch',
        title,
        message,
        referenceType: 'yearly_payment_batch',
        referenceId: String(batch.id),
        actionUrl,
        createdBy: actor.id || null,
        metadata: {
            batchId: batch.id,
            paymentYear: batch.PaymentYear,
            paymentType: batch.PaymentType,
            status: batch.Status
        },
        eventKeyBase
    });
}

async function transitionBatch({
    companyId,
    batchId,
    actor,
    expectedStatuses,
    nextStatus,
    action,
    comments = '',
    roleRecipients = [],
    actionUrlBuilder = (id) => `/finance/payroll/yearly-payments/${id}`,
    updateFields = {}
}) {
    const connection = await pool.getConnection();
    try {
        await ensureYearlyPaymentTables(connection);
        await workflowNotificationService.ensureNotificationTable(connection);
        await connection.beginTransaction();

        const batch = await getBatchById(companyId, batchId, connection);
        if (!batch) {
            throw new Error('Yearly payment batch not found.');
        }
        if (!expectedStatuses.includes(batch.Status)) {
            throw new Error('This yearly payment batch is not in the correct status for that action.');
        }

        await assertSubmittedBatchStillCurrent(connection, batch);

        const fragments = ['Status = ?', 'UpdatedAt = NOW()'];
        const params = [nextStatus];
        for (const [field, value] of Object.entries(updateFields || {})) {
            fragments.push(`${field} = ?`);
            params.push(value);
        }
        params.push(batch.id);
        await connection.query(
            `UPDATE yearly_payment_batches SET ${fragments.join(', ')} WHERE id = ?`,
            params
        );

        await logBatchAction(connection, {
            batchId: batch.id,
            companyId,
            action,
            fromStatus: batch.Status,
            toStatus: nextStatus,
            actor,
            comments
        });

        const updatedBatch = await getBatchById(companyId, batch.id, connection);
        await notifyYearlyPaymentAction(connection, {
            batch: updatedBatch,
            actor,
            notificationType: action,
            title: `Yearly Payment ${updatedBatch.PaymentType} ${updatedBatch.PaymentYear}`,
            message: `${YEARLY_PAYMENT_TYPE_META[updatedBatch.PaymentType]?.label || updatedBatch.PaymentType} batch for ${updatedBatch.PaymentYear} is now ${nextStatus.replaceAll('_', ' ')}.`,
            actionUrl: actionUrlBuilder(updatedBatch.id),
            recipientRoles: roleRecipients,
            eventKeyBase: `yearly-payment:${updatedBatch.id}:${nextStatus}`
        });

        await connection.commit();
        return getBatchDetail({ companyId, batchId });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function submitToManager({ companyId, batchId, user, comments = '' }) {
    return transitionBatch({
        companyId,
        batchId,
        actor: normalizeUser(user, 'finance-officer', 'Finance Officer'),
        expectedStatuses: [
            YEARLY_PAYMENT_STATUSES.DRAFT,
            YEARLY_PAYMENT_STATUSES.CALCULATED,
            YEARLY_PAYMENT_STATUSES.RETURNED_BY_MANAGER,
            YEARLY_PAYMENT_STATUSES.RETURNED_BY_AUDITOR
        ],
        nextStatus: YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_MANAGER,
        action: 'SUBMIT_TO_MANAGER',
        comments,
        roleRecipients: ['manager'],
        actionUrlBuilder: (id) => `/manager/yearly-payments/${id}`,
        updateFields: {
            SubmittedAt: new Date()
        }
    });
}

async function managerEndorse({ companyId, batchId, user, comments = '' }) {
    return transitionBatch({
        companyId,
        batchId,
        actor: normalizeUser(user, 'manager', 'Manager'),
        expectedStatuses: [YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_MANAGER],
        nextStatus: YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_AUDITOR,
        action: 'MANAGER_ENDORSE',
        comments,
        roleRecipients: ['auditor'],
        actionUrlBuilder: (id) => `/auditor/yearly-payments/${id}`,
        updateFields: {
            ManagerEndorsedBy: normalizeUser(user, 'manager', 'Manager').name,
            ManagerEndorsedAt: new Date(),
            ManagerComments: comments || null
        }
    });
}

async function managerReturn({ companyId, batchId, user, comments }) {
    if (!String(comments || '').trim()) {
        throw new Error('Manager return comments are required.');
    }
    return transitionBatch({
        companyId,
        batchId,
        actor: normalizeUser(user, 'manager', 'Manager'),
        expectedStatuses: [YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_MANAGER],
        nextStatus: YEARLY_PAYMENT_STATUSES.RETURNED_BY_MANAGER,
        action: 'MANAGER_RETURN',
        comments,
        roleRecipients: ['finance-officer'],
        actionUrlBuilder: (id) => `/finance/payroll/yearly-payments/${id}`,
        updateFields: {
            ManagerComments: comments
        }
    });
}

async function auditorEndorse({ companyId, batchId, user, comments = '' }) {
    return transitionBatch({
        companyId,
        batchId,
        actor: normalizeUser(user, 'auditor', 'Auditor'),
        expectedStatuses: [YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_AUDITOR],
        nextStatus: YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_ENTITY_HEAD,
        action: 'AUDITOR_ENDORSE',
        comments,
        roleRecipients: ['entity-head'],
        actionUrlBuilder: (id) => `/entity-head/yearly-payments/${id}`,
        updateFields: {
            AuditorEndorsedBy: normalizeUser(user, 'auditor', 'Auditor').name,
            AuditorEndorsedAt: new Date(),
            AuditorComments: comments || null
        }
    });
}

async function auditorReturn({ companyId, batchId, user, comments }) {
    if (!String(comments || '').trim()) {
        throw new Error('Auditor findings are required when returning a yearly payment batch.');
    }
    return transitionBatch({
        companyId,
        batchId,
        actor: normalizeUser(user, 'auditor', 'Auditor'),
        expectedStatuses: [YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_AUDITOR],
        nextStatus: YEARLY_PAYMENT_STATUSES.RETURNED_BY_AUDITOR,
        action: 'AUDITOR_RETURN',
        comments,
        roleRecipients: ['finance-officer'],
        actionUrlBuilder: (id) => `/finance/payroll/yearly-payments/${id}`,
        updateFields: {
            AuditorComments: comments
        }
    });
}

async function applyApprovedBatch(connection, batch, actor) {
    const rows = await getBatchRows(batch.id, connection);
    const eligibleRows = rows.filter((row) => row.EligibilityStatus === 'ELIGIBLE');
    const paymentMonth = Number(String(batch.PaymentDate).slice(5, 7));

    for (const row of eligibleRows) {
        await connection.query(
            `
                INSERT INTO tblyearlypayments (
                    PDate, PFNo, SName, Dept, Grade, JobTitle, AccountNo, Fixed, Monthly, TotalIncome,
                    Taxable, Tax, NetIncome, PMonth, PYear, PType, Served, Selected, Paid, Operator,
                    DateKeyed, TimeKeyed, Approved, ApprovedBy, DateApproved, TimeApproved, CompanyID
                )
                VALUES (?, ?, ?, ?, ?, ?, (
                    SELECT AccountNo FROM tblstaff WHERE PFNo = ? LIMIT 1
                ), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, CURDATE(), CURTIME(), ?, ?, CURDATE(), CURTIME(), ?)
                ON DUPLICATE KEY UPDATE
                    SName = VALUES(SName),
                    Dept = VALUES(Dept),
                    Grade = VALUES(Grade),
                    JobTitle = VALUES(JobTitle),
                    Fixed = VALUES(Fixed),
                    Monthly = VALUES(Monthly),
                    TotalIncome = VALUES(TotalIncome),
                    Taxable = VALUES(Taxable),
                    Tax = VALUES(Tax),
                    NetIncome = VALUES(NetIncome),
                    Served = VALUES(Served),
                    Selected = VALUES(Selected),
                    Paid = 0,
                    Operator = VALUES(Operator),
                    DateKeyed = VALUES(DateKeyed),
                    TimeKeyed = VALUES(TimeKeyed),
                    Approved = VALUES(Approved),
                    ApprovedBy = VALUES(ApprovedBy),
                    DateApproved = VALUES(DateApproved),
                    TimeApproved = VALUES(TimeApproved),
                    CompanyID = VALUES(CompanyID)
            `,
            [
                batch.PaymentDate,
                row.PFNo,
                row.StaffName,
                row.DepartmentCode || null,
                row.GradeCode || null,
                row.JobTitleCode || null,
                row.PFNo,
                row.FixedFlag,
                row.MonthlyAmount,
                row.TotalIncome,
                row.TaxableAmount,
                row.TaxAmount,
                row.NetIncome,
                paymentMonth,
                batch.PaymentYear,
                batch.PaymentType,
                row.YearsServed,
                actor.name,
                LEGACY_APPROVED_VALUE,
                actor.name,
                batch.CompanyID
            ]
        );
    }
}

async function entityApprove({ companyId, batchId, user, comments = '' }) {
    const actor = normalizeUser(user, 'entity-head', 'Entity Head');
    const connection = await pool.getConnection();
    try {
        await ensureYearlyPaymentTables(connection);
        await workflowNotificationService.ensureNotificationTable(connection);
        await connection.beginTransaction();

        const batch = await getBatchById(companyId, batchId, connection);
        if (!batch) {
            throw new Error('Yearly payment batch not found.');
        }
        if (batch.Status !== YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_ENTITY_HEAD) {
            throw new Error('This yearly payment batch is not awaiting final approval.');
        }

        await assertSubmittedBatchStillCurrent(connection, batch);
        await applyApprovedBatch(connection, batch, actor);

        await connection.query(
            `UPDATE yearly_payment_batches
             SET Status = ?, FinalApprovedBy = ?, FinalApprovedAt = NOW(), EntityHeadComments = ?, AppliedAt = NOW(),
                 AppliedBy = ?, AppliedByUserID = ?, UpdatedAt = NOW()
             WHERE id = ?`,
            [
                YEARLY_PAYMENT_STATUSES.APPLIED,
                actor.name,
                comments || null,
                actor.name,
                actor.id || null,
                batch.id
            ]
        );

        await logBatchAction(connection, {
            batchId: batch.id,
            companyId,
            action: 'FINAL_APPROVE',
            fromStatus: batch.Status,
            toStatus: YEARLY_PAYMENT_STATUSES.APPLIED,
            actor,
            comments
        });

        await auditTrailService.writeAuditEntryWithExecutor(connection, {
            action: 'UPDATE',
            tableName: 'yearly_payment_batches',
            recordId: String(batch.id),
            description: `Approved and applied yearly payment batch ${batch.PaymentType}/${batch.PaymentYear}`,
            user: {
                PFNo: String(actor.id || 0),
                Username: actor.name,
                CompanyID: normalizeCompanyId(companyId)
            }
        });

        const updatedBatch = await getBatchById(companyId, batch.id, connection);
        await notifyYearlyPaymentAction(connection, {
            batch: updatedBatch,
            actor,
            notificationType: 'FINAL_APPROVE',
            title: `Yearly Payment ${updatedBatch.PaymentType} ${updatedBatch.PaymentYear} approved`,
            message: `${YEARLY_PAYMENT_TYPE_META[updatedBatch.PaymentType]?.label || updatedBatch.PaymentType} batch for ${updatedBatch.PaymentYear} has final approval and is now authorized.`,
            actionUrl: `/finance/payroll/yearly-payments/${updatedBatch.id}`,
            recipientRoles: ['finance-officer'],
            eventKeyBase: `yearly-payment:${updatedBatch.id}:applied`
        });

        await connection.commit();
        return getBatchDetail({ companyId, batchId });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function entityReturn({ companyId, batchId, user, comments }) {
    if (!String(comments || '').trim()) {
        throw new Error('Return comments are required.');
    }
    return transitionBatch({
        companyId,
        batchId,
        actor: normalizeUser(user, 'entity-head', 'Entity Head'),
        expectedStatuses: [YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_ENTITY_HEAD],
        nextStatus: YEARLY_PAYMENT_STATUSES.RETURNED_BY_AUDITOR,
        action: 'ENTITY_RETURN',
        comments,
        roleRecipients: ['finance-officer'],
        actionUrlBuilder: (id) => `/finance/payroll/yearly-payments/${id}`,
        updateFields: {
            EntityHeadComments: comments
        }
    });
}

async function entityReject({ companyId, batchId, user, comments }) {
    if (!String(comments || '').trim()) {
        throw new Error('Rejection reason is required.');
    }
    return transitionBatch({
        companyId,
        batchId,
        actor: normalizeUser(user, 'entity-head', 'Entity Head'),
        expectedStatuses: [YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_ENTITY_HEAD],
        nextStatus: YEARLY_PAYMENT_STATUSES.FINAL_REJECTED,
        action: 'ENTITY_REJECT',
        comments,
        roleRecipients: ['finance-officer'],
        actionUrlBuilder: (id) => `/finance/payroll/yearly-payments/${id}`,
        updateFields: {
            RejectedBy: normalizeUser(user, 'entity-head', 'Entity Head').name,
            RejectedAt: new Date(),
            RejectionReason: comments
        }
    });
}

async function getBatchDetail({ companyId, batchId }) {
    await ensureYearlyPaymentTables();
    const batch = await getBatchById(companyId, batchId);
    if (!batch) {
        return null;
    }
    const [rows, actions, supportedTypes, loanParams] = await Promise.all([
        getBatchRows(batch.id),
        getBatchActions(batch.id),
        getSupportedYearlyTypes(batch.CompanyID),
        getCurrentLoanParameterSnapshot(batch.CompanyID)
    ]);

    return {
        batch,
        rows,
        actions,
        supportedTypes,
        loanParams,
        paymentTypeMeta: YEARLY_PAYMENT_TYPE_META[batch.PaymentType] || { label: batch.PaymentType }
    };
}

async function getQueueData({ companyId, role }) {
    await ensureYearlyPaymentTables();
    const resolvedCompanyId = normalizeCompanyId(companyId);
    const normalizedRole = String(role || '').trim().toLowerCase();
    let statuses = [];
    if (normalizedRole === 'finance-officer') {
        statuses = [
            YEARLY_PAYMENT_STATUSES.DRAFT,
            YEARLY_PAYMENT_STATUSES.CALCULATED,
            YEARLY_PAYMENT_STATUSES.RETURNED_BY_MANAGER,
            YEARLY_PAYMENT_STATUSES.RETURNED_BY_AUDITOR,
            YEARLY_PAYMENT_STATUSES.APPLIED,
            YEARLY_PAYMENT_STATUSES.FINAL_REJECTED
        ];
    } else if (normalizedRole === 'manager') {
        statuses = [YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_MANAGER];
    } else if (normalizedRole === 'auditor') {
        statuses = [YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_AUDITOR];
    } else if (normalizedRole === 'entity-head') {
        statuses = [YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_ENTITY_HEAD];
    }

    const [rows] = await pool.query(
        `SELECT b.*, pt.PayType AS PaymentTypeName
         FROM yearly_payment_batches b
         LEFT JOIN tblpaytype pt
           ON pt.Code = b.PaymentType
          AND (pt.CompanyID = b.CompanyID OR pt.CompanyID IS NULL)
         WHERE b.CompanyID = ?
           ${statuses.length ? `AND b.Status IN (${statuses.map(() => '?').join(', ')})` : ''}
         ORDER BY b.UpdatedAt DESC, b.id DESC`,
        [resolvedCompanyId, ...statuses]
    );

    return rows;
}

module.exports = {
    LEGACY_APPROVED_VALUE,
    YEARLY_PAYMENT_STATUSES,
    YEARLY_PAYMENT_TYPE_META,
    YEARLY_PAYMENT_TYPES,
    createOrUpdateDraft,
    entityApprove,
    entityReject,
    entityReturn,
    ensureYearlyPaymentTables,
    getBatchDetail,
    getCurrentLoanParameterSnapshot,
    getFinancePageData,
    getPayrollItemFieldMapping,
    getQueueData,
    getSupportedYearlyTypes,
    managerEndorse,
    managerReturn,
    submitToManager,
    auditorEndorse,
    auditorReturn
};
