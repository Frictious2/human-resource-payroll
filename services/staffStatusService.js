const STAFF_STATUS_MODES = Object.freeze({
    ACTIVE: 'active',
    FORMER: 'former',
    RETIRED: 'retired',
    REDUNDANT: 'redundant',
    ALL: 'all'
});

const ACTIVE_EMP_STATUS_CODES = ['01', '1', '03', '3', '04', '4'];
const FORMER_EMP_STATUS_CODES = ['02', '2'];
const RETIRED_EMP_STATUS_CODES = ['05', '5'];

function getColumnRef(alias, columnName) {
    return alias ? `${alias}.${columnName}` : columnName;
}

function normalizeMode(mode) {
    const value = String(mode || STAFF_STATUS_MODES.ACTIVE).trim().toLowerCase();
    if (Object.values(STAFF_STATUS_MODES).includes(value)) {
        return value;
    }
    return STAFF_STATUS_MODES.ACTIVE;
}

function getActiveStaffFilter(alias = '') {
    const empStatus = getColumnRef(alias, 'EmpStatus');
    const redundant = getColumnRef(alias, 'Redundant');

    // Live personnel_master status codes currently map 01=CURRENT, 03=PROBATION, 04=PART-TIME.
    // Former staff are stored as 02 and redundant staff are separately marked in Redundant.
    return `COALESCE(${redundant}, 0) = 0 AND (${empStatus} IS NULL OR CAST(${empStatus} AS CHAR) IN (${ACTIVE_EMP_STATUS_CODES.map((code) => `'${code}'`).join(', ')}))`;
}

function getFormerStaffFilter(alias = '') {
    const empStatus = getColumnRef(alias, 'EmpStatus');
    const redundant = getColumnRef(alias, 'Redundant');
    return `COALESCE(${redundant}, 0) = 0 AND CAST(COALESCE(${empStatus}, '') AS CHAR) IN (${FORMER_EMP_STATUS_CODES.map((code) => `'${code}'`).join(', ')})`;
}

function getRetiredStaffFilter(alias = '') {
    const empStatus = getColumnRef(alias, 'EmpStatus');
    const redundant = getColumnRef(alias, 'Redundant');

    // No RETIRED code exists in the current live tblstatus rows, but we keep a dedicated
    // mode so explicitly retired pages can adopt the same helper if that code is introduced.
    return `COALESCE(${redundant}, 0) = 0 AND CAST(COALESCE(${empStatus}, '') AS CHAR) IN (${RETIRED_EMP_STATUS_CODES.map((code) => `'${code}'`).join(', ')})`;
}

function getRedundantStaffFilter(alias = '') {
    const redundant = getColumnRef(alias, 'Redundant');
    return `COALESCE(${redundant}, 0) <> 0`;
}

function getStaffStatusFilter(alias = '', mode = STAFF_STATUS_MODES.ACTIVE) {
    switch (normalizeMode(mode)) {
        case STAFF_STATUS_MODES.FORMER:
            return getFormerStaffFilter(alias);
        case STAFF_STATUS_MODES.RETIRED:
            return getRetiredStaffFilter(alias);
        case STAFF_STATUS_MODES.REDUNDANT:
            return getRedundantStaffFilter(alias);
        case STAFF_STATUS_MODES.ALL:
            return '';
        case STAFF_STATUS_MODES.ACTIVE:
        default:
            return getActiveStaffFilter(alias);
    }
}

function applyStaffStatusFilter(query, mode = STAFF_STATUS_MODES.ACTIVE, alias = '') {
    const clause = getStaffStatusFilter(alias, mode);
    if (!clause) {
        return query;
    }

    return /\bwhere\b/i.test(query)
        ? `${query} AND ${clause}`
        : `${query} WHERE ${clause}`;
}

function buildStaffQuery({
    fields = 'PFNo, SName',
    mode = STAFF_STATUS_MODES.ACTIVE,
    alias = '',
    orderBy = 'SName'
} = {}) {
    const fromClause = alias ? `tblstaff ${alias}` : 'tblstaff';
    const query = applyStaffStatusFilter(`SELECT ${fields} FROM ${fromClause}`, mode, alias);
    return orderBy ? `${query} ORDER BY ${orderBy}` : query;
}

function getActiveStaffQuery(options = {}) {
    return buildStaffQuery({ ...options, mode: STAFF_STATUS_MODES.ACTIVE });
}

function getFormerStaffQuery(options = {}) {
    return buildStaffQuery({ ...options, mode: STAFF_STATUS_MODES.FORMER });
}

function getRetiredStaffQuery(options = {}) {
    return buildStaffQuery({ ...options, mode: STAFF_STATUS_MODES.RETIRED });
}

function getRedundantStaffQuery(options = {}) {
    return buildStaffQuery({ ...options, mode: STAFF_STATUS_MODES.REDUNDANT });
}

function getPayrollStatusJoins({
    staffAlias = 's',
    statusAlias = 'status_lookup',
    formerAlias = 'former_status'
} = {}) {
    return `
        LEFT JOIN tblstatus ${statusAlias}
            ON ${statusAlias}.CODE = ${staffAlias}.EmpStatus
           AND (${statusAlias}.CompanyID = ${staffAlias}.CompanyID OR ${statusAlias}.CompanyID IS NULL)
        LEFT JOIN (
            SELECT
                f.PFNo,
                MAX(DATE(COALESCE(f.DateLeft, f.ExpDate, f.DateResigned, f.DateAccepted, f.NoticeDate, f.DateofLetter))) AS effective_former_date
            FROM tblformer f
            WHERE COALESCE(f.Approved, 0) IN (-1, 1)
              AND (f.CompanyID = ? OR f.CompanyID IS NULL)
            GROUP BY f.PFNo
        ) ${formerAlias}
            ON ${formerAlias}.PFNo = ${staffAlias}.PFNo
    `;
}

function getPayrollEligibilityClause({
    staffAlias = 's',
    statusAlias = 'status_lookup',
    formerAlias = 'former_status',
    payrollDateExpression = '?'
} = {}) {
    const empStatus = getColumnRef(staffAlias, 'EmpStatus');
    const redundant = getColumnRef(staffAlias, 'Redundant');
    const dateRedundant = getColumnRef(staffAlias, 'DateRedundant');
    const reasonDate = getColumnRef(staffAlias, 'ReasonDate');
    const statusName = getColumnRef(statusAlias, 'Status');
    const formerDate = getColumnRef(formerAlias, 'effective_former_date');
    const formerCodes = FORMER_EMP_STATUS_CODES.map((code) => `'${code}'`).join(', ');
    const retiredCodes = RETIRED_EMP_STATUS_CODES.map((code) => `'${code}'`).join(', ');

    // For payroll eligibility we use the payroll date against the effective exit dates already
    // present in the legacy schema. If a staff member is non-active but no effective date exists,
    // we treat them as ineligible rather than guessing that the payroll period is historical.
    return `
        (
            COALESCE(${redundant}, 0) = 0
            OR (
                ${dateRedundant} IS NOT NULL
                AND ${payrollDateExpression} <= DATE(${dateRedundant})
            )
        )
        AND (
            ${formerDate} IS NULL
            OR ${payrollDateExpression} <= ${formerDate}
        )
        AND (
            NOT (
                CAST(COALESCE(${empStatus}, '') AS CHAR) IN (${formerCodes}, ${retiredCodes})
                OR UPPER(COALESCE(${statusName}, '')) LIKE '%FORMER%'
                OR UPPER(COALESCE(${statusName}, '')) LIKE '%RETIR%'
            )
            OR (
                COALESCE(${formerDate}, DATE(${reasonDate})) IS NOT NULL
                AND ${payrollDateExpression} <= COALESCE(${formerDate}, DATE(${reasonDate}))
            )
        )
    `;
}

function getPayrollIneligibilityClause({
    staffAlias = 's',
    statusAlias = 'status_lookup',
    formerAlias = 'former_status',
    payrollDateExpression = '?'
} = {}) {
    return `NOT (${getPayrollEligibilityClause({ staffAlias, statusAlias, formerAlias, payrollDateExpression })})`;
}

module.exports = {
    STAFF_STATUS_MODES,
    ACTIVE_EMP_STATUS_CODES,
    FORMER_EMP_STATUS_CODES,
    RETIRED_EMP_STATUS_CODES,
    normalizeMode,
    getActiveStaffFilter,
    getFormerStaffFilter,
    getRetiredStaffFilter,
    getRedundantStaffFilter,
    getStaffStatusFilter,
    applyStaffStatusFilter,
    buildStaffQuery,
    getActiveStaffQuery,
    getFormerStaffQuery,
    getRetiredStaffQuery,
    getRedundantStaffQuery,
    getPayrollStatusJoins,
    getPayrollEligibilityClause,
    getPayrollIneligibilityClause
};
