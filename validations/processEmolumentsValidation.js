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

function parsePayrollDate(payrollDate) {
    const parsedDate = new Date(payrollDate);
    if (Number.isNaN(parsedDate.getTime())) {
        return null;
    }

    return parsedDate;
}

function validateProcessRequest({ companyId, activityCode, payrollDate }) {
    if (!companyId) {
        return 'Company is required.';
    }

    if (!activityCode) {
        return 'Activity is required.';
    }

    if (!ACTIVITY_DEFINITIONS[activityCode]) {
        return 'The selected activity is not supported.';
    }

    if (!payrollDate || !parsePayrollDate(payrollDate)) {
        return 'A valid payroll date is required.';
    }

    return null;
}

module.exports = {
    ACTIVITY_DEFINITIONS,
    parsePayrollDate,
    validateProcessRequest
};
