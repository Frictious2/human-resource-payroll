const ACTIVITY_DEFINITIONS = {
    '01': 'Salary',
    '02': 'Rent Allowance',
    '05': 'Inducement',
    '07': 'Backlog / Arrears',
    '08': 'EOS Benefits',
    '09': 'Bonus',
    '13': 'Leave Allowance',
    '15': 'Long Service'
};

function createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function parsePositiveInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePayrollDate(payrollDate) {
    const rawValue = payrollDate instanceof Date
        ? payrollDate.toISOString().slice(0, 10)
        : String(payrollDate || '').trim();
    const parsedDate = new Date(`${rawValue}T00:00:00`);
    if (Number.isNaN(parsedDate.getTime())) {
        return null;
    }

    return parsedDate;
}

function validateProcessEmoluments(payload) {
    const companyId = parsePositiveInteger(payload.companyId);
    const activityCode = String(payload.activityCode || '').trim();
    const parsedDate = parsePayrollDate(payload.payrollDate);

    if (!companyId) {
        throw createError('Company is required.');
    }

    if (!activityCode) {
        throw createError('Activity is required.');
    }

    if (!ACTIVITY_DEFINITIONS[activityCode]) {
        throw createError('The selected activity is not supported.');
    }

    if (!parsedDate) {
        throw createError('A valid payroll date is required.');
    }

    return {
        companyId,
        activityCode,
        payrollDate: parsedDate,
        payrollMonth: parsedDate.getMonth() + 1,
        payrollYear: parsedDate.getFullYear(),
        activityName: ACTIVITY_DEFINITIONS[activityCode]
    };
}

function validateProcessRequest(payload) {
    return validateProcessEmoluments(payload);
}

module.exports = {
    ACTIVITY_DEFINITIONS,
    parsePayrollDate,
    parsePositiveInteger,
    validateProcessEmoluments,
    validateProcessRequest
};
