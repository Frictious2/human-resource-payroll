const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const root = path.resolve(__dirname, '..');
const { validateStagingTarget, validatePrivateRoot } = require('./stagingSetupSafety');
const roleDefinitions = [
    ['admin', 'Admin'], ['data_entry', 'Data Entry'], ['finance', 'Finance Officer'],
    ['finance_manager', 'Finance Manager'], ['manager', 'Manager'], ['auditor', 'Auditor'], ['entity_head', 'Entity Head']
];

function passwordValid(value) {
    return typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value) <= 72
        && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^a-zA-Z0-9]/.test(value);
}

async function hiddenPassword(label) {
    if (!process.stdin.isTTY) throw new Error('Use a terminal for hidden passwords, or --passwords-stdin with a private pipe. Never pass passwords as command arguments.');
    process.stdout.write(label + ': ');
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true); process.stdin.resume();
    return new Promise((resolve, reject) => {
        let value = '';
        function done(error) { process.stdin.off('keypress', onKey); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); error ? reject(error) : resolve(value); }
        function onKey(text, key = {}) {
            if (key.ctrl && key.name === 'c') return done(new Error('Setup cancelled.'));
            if (key.name === 'return') return done();
            if (key.name === 'backspace') value = value.slice(0, -1);
            else if (!key.ctrl && !key.meta && text) value += text;
        }
        process.stdin.on('keypress', onKey);
    });
}

async function readPasswords(fromStdin) {
    if (fromStdin) { let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 16384) throw new Error('Password input too large.'); } return JSON.parse(input); }
    const values = {};
    for (const [key] of roleDefinitions) values[key] = await hiddenPassword(`Choose a unique password for staging_${key} (hidden)`);
    return values;
}

async function insert(connection, table, values) {
    const [columns] = await connection.query(`SHOW COLUMNS FROM \`${table}\``);
    const row = {};
    for (const column of columns) {
        if (Object.hasOwn(values, column.Field)) row[column.Field] = values[column.Field];
        else if (column.Null === 'NO' && column.Default === null && !column.Extra.includes('auto_increment')) {
            row[column.Field] = /int|decimal|float|double|bit/i.test(column.Type) ? 0
                : /date|timestamp/i.test(column.Type) ? '2098-01-01' : /^time/i.test(column.Type) ? '00:00:00' : '';
        }
    }
    await connection.query(`INSERT INTO \`${table}\` SET ?`, [row]);
}

async function initialize({ schema = false, seed = false, passwords = {} } = {}) {
    const target = validateStagingTarget(); // Must run before creating ANY DB connection.
    const privateRoot = validatePrivateRoot(process.env.PRIVATE_UPLOAD_DIR, root);
    if (!schema && !seed) throw new Error('Choose --schema and/or --seed. This command never runs at application startup.');
    if (seed && (new Set(Object.values(passwords)).size !== roleDefinitions.length
        || roleDefinitions.some(([key]) => !passwordValid(passwords[key])))) throw new Error('Supply seven unique strong passwords (12-72 bytes, upper/lowercase, number, symbol).');
    require('../services/environmentValidationService').assertEnvironmentIsSafe();
    await fs.mkdir(privateRoot, { recursive: true, mode: 0o700 });
    const resolvedPrivate = validatePrivateRoot(await fs.realpath(privateRoot), root);
    await fs.chmod(resolvedPrivate, 0o700);
    for (const category of ['staff_photos', 'medical_receipts', 'logos']) {
        const directory = path.join(resolvedPrivate, category);
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const actual = await fs.realpath(directory);
        if (!actual.startsWith(resolvedPrivate + path.sep)) throw new Error('Unsafe private storage link.');
        await fs.chmod(directory, 0o700);
    }
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection(target);
    let inTransaction = false;
    try {
        const [[identity]] = await connection.query('SELECT DATABASE() AS db');
        if (identity.db !== target.database) throw new Error('Database identity mismatch.');
        const [tables] = await connection.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
        if (schema) {
            if (tables.length) throw new Error('Schema import requires a completely empty dedicated staging database. Nothing will be dropped.');
            const sql = await fs.readFile(path.join(root, 'database/staging/schema.sql'), 'utf8');
            if (/\b(?:INSERT\s+INTO|REPLACE\s+INTO|DROP\s+(?:TABLE|DATABASE)|TRUNCATE\s+TABLE|DELETE\s+FROM|CREATE\s+DATABASE|USE\s+`)/i.test(sql)) throw new Error('Unexpected statement in schema artifact.');
            // Generated table DDL only; DDL is deliberately outside the fixture transaction.
            for (const statement of sql.split(/;\s*(?:\r?\n|$)/).filter(value => value.trim())) await connection.query(statement);
        }
        if (seed) {
            const [current] = await connection.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
            const [engines] = await connection.query('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
            const seededTables = ['tblcominfo','tblpaytype','tblpayrollitems','tbltax','tbldept','tblgrade','tbljobtitle','tblallowance','tblrelation','tblleavetype','tblparams1','tblpassword','tblstaff','tblentitle','tblsalary','tblpayroll','tblaudittrail'];
            if (seededTables.some(table=>!engines.some(row=>row.TABLE_NAME===table && row.ENGINE==='InnoDB'))) throw new Error('All fixture/audit tables must already use InnoDB; no automatic engine conversion is performed.');
            for (const { TABLE_NAME: table } of current) {
                if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error('Unexpected staging table identifier.');
                const [[row]] = await connection.query(`SELECT COUNT(*) n FROM \`${table}\``);
                if (Number(row.n)) throw new Error('Seeding requires ALL staging tables to be empty. No existing records will be overwritten.');
            }
            const config = JSON.parse(await fs.readFile(path.join(root, 'database/staging/payroll-configuration.json'), 'utf8'));
            await connection.beginTransaction(); inTransaction = true;
            await insert(connection, 'tblcominfo', { CompanyID: 1, Com_Name: 'WAEC SYNTHETIC STAGING - NOT LIVE', Address: 'Synthetic test address', TinNo: 'SYNTHETIC', Email: 'staging@example.test', StaffCapacity: 100 });
            for (const table of ['tblpaytype', 'tblpayrollitems', 'tbltax']) for (const row of config[table]) await insert(connection, table, row);
            for (const [Code, Dept] of [['01', 'Staging HR'], ['03', 'Staging Finance']]) await insert(connection, 'tbldept', { Code, Dept, CompanyID: 1 });
            for (const [GradeCode, JobTitle, annual] of [['0800', '0802', 12000], ['0400', '0401', 24000]]) {
                await insert(connection, 'tblgrade', { GradeCode, JobTitle, Grade: 'Synthetic', NotchIncr: 1, CompanyID: 1 });
                await insert(connection, 'tbljobtitle', { Code: JobTitle, JobTitle: 'Staging Officer', CompanyID: 1 });
                await insert(connection, 'tblallowance', { Grade: GradeCode, ScaleDate: '2098-01-01', StartLevel: annual, EndLevel: annual, Notches: 1, Increment: 0, CompanyID: 1 });
            }
            await insert(connection, 'tblrelation', { RCode: '03', Relation: 'QA Child', CompanyID: 1 });
            await insert(connection, 'tblleavetype', { Code: '01', LeaveType: 'Synthetic Leave', CompanyID: 1 });
            await insert(connection, 'tblparams1', { SeqNo: 1, Max_Dependants: 5, AdvanceInt: 0, LoanDuration: 12, CompanyID: 1 });
            const bcrypt = require('bcrypt');
            const audit = require('../services/auditTrailService');
            for (const [key, level] of roleDefinitions) {
                const result = await connection.execute('INSERT INTO tblpassword (DateCreated, Username, FullName, Email, Level, Pword, CompanyID) VALUES (NOW(),?,?,?,?,?,1)',
                    [`staging_${key}`, `Synthetic ${level}`, `staging_${key}@example.test`, level, await bcrypt.hash(passwords[key], 12)]);
                await audit.writeAuditEntryWithExecutor(connection, { action: 'New', companyId: 1, userName: 'Authorized staging initializer', formName: 'staging-initialization', recordId: result[0].insertId, fieldName: 'PortalAccount', newValue: 'Synthetic staging account created' });
            }
            const rates = new Map(config.tblpayrollitems.map(row => [row.Code, Number(row.Percent)]));
            if (rates.get('32') !== 5 || rates.get('33') !== 10 || rates.get('41') !== 10) throw new Error('Unexpected NASSIT/provident configuration; do not silently substitute rates.');
            const paye = require('../services/payeTaxService');
            for (const [PFNo, SName, salary, grade, title] of [['S001', 'Synthetic Employee One', 1000, '0800', '0802'], ['S002', 'Synthetic Employee Two', 2000, '0400', '0401']]) {
                await insert(connection, 'tblstaff', { PFNo, SName, DOB: '2070-01-01', DOE: '2090-01-01', DateConfirmed: '2090-06-01', CGrade: grade, GradeCode: grade, JobTitle: title, CDept: '01', DEmp: '01', Notch: 1, EmpStatus: '01', EmpType: '01', PayCurrency: '01', NASSITR: 1, NASSITNo: 'SYNTHETIC', AccountNo: 'SYNTHETIC', Approved: 0, CompanyID: 1 });
                await insert(connection, 'tblentitle', { PFNo, Salary: 1, AccountNo: 'SYNTHETIC', Approved: 0, CompanyID: 1 });
                const nassitEmp = Math.round(salary * rates.get('32')) / 100;
                const provident = Math.round(salary * rates.get('33')) / 100;
                const nassitInst = Math.round(salary * rates.get('41')) / 100;
                const tax = await paye.calculateMonthlyPaye({ companyId: 1, payrollDate: '2098-08-31', taxableEarnings: salary, employeeNassit: nassitEmp, connection });
                const deductions = Math.round((tax.tax + nassitEmp + provident) * 100) / 100;
                await insert(connection, 'tblsalary', { PFNo, PDate: '2098-08-31', PType: '01', Dept: '01', Grade: grade, JobTitle: title, PayCurrency: '01', ExchRate: 1, AccountNo: 'SYNTHETIC', Annual: salary * 12, Salary: salary, TotalIncome: salary, Taxable: tax.chargeableIncome, Tax: tax.tax, NassitEmp: nassitEmp, NassitInst: nassitInst, GratEmp: provident, TotalDeduction: deductions, NetIncome: salary - deductions, FullPay: 1, Days: 30, Approved: 0, CompanyID: 1 });
                await insert(connection, 'tblpayroll', { PFNo, PDate: '2098-08-31', SalDate: '2098-08-31', PType: '01', PMonth: 0, PYear: 0, Dept: '01', Grade: grade, JobTitle: title, Salary: salary, FullPay: 1, Approved: 0, CompanyID: 1 });
                for (const table of ['tblstaff', 'tblentitle', 'tblsalary']) await audit.writeAuditEntryWithExecutor(connection, { action: 'New', companyId: 1, userName: 'Authorized staging initializer', formName: 'staging-initialization', recordId: PFNo, fieldName: table, newValue: 'Synthetic fixture created; Manager approval pending' });
            }
            await connection.commit(); inTransaction = false;
        }
        return { status: 'PASS', syntheticStaff: seed ? 2 : 0, syntheticAccounts: seed ? 7 : 0, approvals: 'PENDING', monthlyPayroll: 'NOT PROCESSED', credentialsPrinted: false };
    } catch (error) { if (inTransaction) await connection.rollback(); throw error; }
    finally { await connection.end(); }
}

if (require.main === module) {
    require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
    (async () => {
        validateStagingTarget();
        const seed = process.argv.includes('--seed');
        const passwords = seed ? await readPasswords(process.argv.includes('--passwords-stdin')) : {};
        console.log(JSON.stringify(await initialize({ schema: process.argv.includes('--schema'), seed, passwords })));
    })().catch(() => { console.error('Staging setup refused or failed. Check the dedicated empty database, configuration, permissions and password policy. No existing data is deleted.'); process.exitCode = 1; });
}

module.exports = { initialize, validateStagingTarget, passwordValid, roleDefinitions };
