const payrollAuditService = require('../services/payrollAuditService');
const pool = require('../config/db');

function parseArgs(argv) {
    const options = {};

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) {
            continue;
        }

        const key = token.slice(2);
        const nextValue = argv[index + 1];
        if (!nextValue || nextValue.startsWith('--')) {
            options[key] = true;
            continue;
        }

        options[key] = nextValue;
        index += 1;
    }

    return options;
}

function formatDate(value) {
    if (!value) {
        return '-';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toISOString().slice(0, 10);
}

function printUsage() {
    console.log('Payroll rows for non-active staff after status change');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/payrollNonActiveAudit.js [--companyId 1] [--month 12] [--year 2025] [--activityCode 01] [--pfno 0711]');
    console.log('  npm run audit:payroll-non-active -- --companyId 1 --year 2025');
}

function printSummary(report) {
    console.log('Payroll rows for non-active staff after status change');
    console.log('='.repeat(56));
    console.log(`Company ID: ${report.filters.companyId}`);
    console.log(`Month: ${report.filters.payrollMonth || 'ALL'}`);
    console.log(`Year: ${report.filters.payrollYear || 'ALL'}`);
    console.log(`Activity: ${report.filters.activityCode || 'ALL'}`);
    console.log(`PF No: ${report.filters.pfNo || 'ALL'}`);
    console.log('');
    console.log(`Suspicious groups: ${report.totals.suspiciousGroups}`);
    console.log(`Suspicious payroll rows: ${report.totals.suspiciousPayrollRows}`);
    console.log(`Affected periods: ${report.totals.periodsAffected}`);
    console.log('');
}

function printPeriodSummary(summaryRows) {
    console.log('Summary by company and payroll period');
    console.log('-'.repeat(56));

    if (!summaryRows.length) {
        console.log('No suspicious payroll rows were found for the selected filters.');
        console.log('');
        return;
    }

    summaryRows.forEach((row) => {
        console.log(
            [
                `Company ${row.CompanyID}`,
                `Period ${String(row.PMonth).padStart(2, '0')}/${row.PYear}`,
                `Type ${row.PType} ${row.PayTypeName || ''}`.trim(),
                `Rows ${Number(row.SuspiciousPayrollRows || 0)}`,
                `Staff ${Number(row.StaffCount || 0)}`
            ].join(' | ')
        );
    });

    console.log('');
}

function printDetailRows(detailRows) {
    console.log('Grouped suspicious payroll rows');
    console.log('-'.repeat(56));

    if (!detailRows.length) {
        console.log('No suspicious payroll rows were found for the selected filters.');
        return;
    }

    detailRows.forEach((row) => {
        console.log(
            [
                `PFNo ${row.PFNo}`,
                row.SName || 'Unknown Staff',
                `Period ${String(row.PMonth).padStart(2, '0')}/${row.PYear}`,
                `Type ${row.PType} ${row.PayTypeName || ''}`.trim(),
                `Status ${row.CurrentStatus || '-'}`,
                `Effective ${formatDate(row.EffectiveStatusChangeDate)}`,
                `PayrollDate ${formatDate(row.PayrollDate)}`,
                `Rows ${Number(row.PayrollRowCount || 0)}`
            ].join(' | ')
        );
    });
}

async function main() {
    try {
        const args = parseArgs(process.argv.slice(2));
        if (args.help) {
            printUsage();
            return;
        }

        const companyId = Number(args.companyId || args.company || 1);
        if (!companyId) {
            throw new Error('A valid --companyId is required.');
        }

        const report = await payrollAuditService.getPayrollRowsForNonActiveStaffAfterStatusChange({
            companyId,
            payrollMonth: args.month || null,
            payrollYear: args.year || null,
            activityCode: args.activityCode || args.activity || null,
            pfNo: args.pfno || args.pfNo || null
        });

        printSummary(report);
        printPeriodSummary(report.summaryRows);
        printDetailRows(report.detailRows);
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
