const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createZip, readZip } = require('./stagingArchive');
const root = path.resolve(__dirname, '..');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const runtimeFolders = ['config', 'controllers', 'middleware', 'routes', 'services', 'utils', 'validations', 'views'];
const extraFiles = ['app.js', 'server.js', 'package.json', 'package-lock.json', '.env.staging.example',
    'scripts/initializeCpanelStaging.js', 'scripts/stagingSetupSafety.js', 'scripts/checkCpanelStaging.js',
    'docs/WAEC-CPANEL-STAGING-INSTALLATION.md', 'docs/WAEC-CPANEL-STAGING-ACCEPTANCE.md'];

async function build() {
    const dotenv = require('dotenv');
    dotenv.config({ path: path.join(root, '.env'), quiet: true });
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection({ host: process.env.DBHOST || process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DBPORT || process.env.DB_PORT || 3306),
        user: process.env.DBUSER || process.env.DB_USER, password: process.env.DBPASS || process.env.DB_PASSWORD || '', database: process.env.DBNAME || process.env.DB_NAME, dateStrings: true });
    const entries = new Map(); let tables, configuration;
    try {
        await connection.query('SET SESSION TRANSACTION READ ONLY'); await connection.beginTransaction();
        [tables] = await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
        tables.sort((a,b)=>a.TABLE_NAME<b.TABLE_NAME?-1:a.TABLE_NAME>b.TABLE_NAME?1:0);
        const [[identity]] = await connection.query('SELECT DATABASE() AS db');
        let schema = '-- WAEC staging table definitions\nSET FOREIGN_KEY_CHECKS=0;\n';
        for (const { TABLE_NAME: table } of tables) {
            if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error('Unsafe schema identifier.');
            const [[row]] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
            let ddl = row['Create Table'].replace(/ AUTO_INCREMENT=\d+/g, '');
            ddl = ddl.split('`' + identity.db + '`.').join('');
            if (/\bDEFINER\s*=|\bDATA DIRECTORY\b|\bINDEX DIRECTORY\b/i.test(ddl)) throw new Error('Unsafe table definition.');
            schema += ddl + ';\n';
        }
        schema += 'SET FOREIGN_KEY_CHECKS=1;\n'; entries.set('database/staging/schema.sql', Buffer.from(schema));
        configuration = {};
        const allowed = {
            tblpayrollitems: ['Code','Income','Taxable','Threshhold','TPercent','TPercentage','TAmount','Mode','AddBack','Fixed','Percent','Freq','CompanyID'],
            tblpaytype: ['Code','PayType','CompanyID'],
            tbltax: ['BankID','TaxDate','R1','R1Tax','R2','R2Tax','R3','R3Tax','R4','R4Tax','R5','R5Tax','R6','R6Tax','R7','R7Tax','RentThreshold','AllwThreshold','NRA','Withholding_Tax','CompanyID']
        };
        for (const [table, columns] of Object.entries(allowed)) {
            const [rows] = await connection.query(`SELECT ${columns.map(x=>'`'+x+'`').join(',')} FROM \`${table}\` WHERE CompanyID=1`);
            configuration[table] = rows.sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
            if (!rows.length) throw new Error('Required payroll configuration is missing.');
        }
        const rates = new Map(configuration.tblpayrollitems.map(row=>[row.Code, Number(row.Percent)]));
        if (rates.get('32') !== 5 || rates.get('33') !== 10 || rates.get('41') !== 10) throw new Error('Required contribution definitions do not match the verified configuration.');
        entries.set('database/staging/payroll-configuration.json', Buffer.from(JSON.stringify(configuration, null, 2)+'\n'));
        await connection.rollback();
    } finally { await connection.end(); }
    async function add(relative) {
        const file = path.join(root, relative), stat = await fs.lstat(file);
        if (stat.isSymbolicLink()) throw new Error('Symlinks are not packaged.');
        if (stat.isDirectory()) { for (const name of (await fs.readdir(file)).sort()) await add(relative+'/'+name); }
        else {
            if (runtimeFolders.filter(folder=>folder!=='views').some(folder=>relative.startsWith(folder+'/')) && !relative.endsWith('.js')) throw new Error('Non-code file in a runtime code directory: '+relative);
            if (relative.startsWith('views/') && !relative.endsWith('.ejs')) throw new Error('Non-template file in views: '+relative);
            if (!/\.(?:js|ejs|css|map|json|sql|svg|woff2?|ttf|eot|png|jpe?g|ico|txt|md)$/.test(relative) && relative !== '.env.staging.example') throw new Error('Unreviewed runtime file type: '+relative);
            entries.set(relative, await fs.readFile(file));
        }
    }
    for (const folder of [...runtimeFolders, 'public/css', 'public/js', 'public/vendor', 'database/migrations']) await add(folder);
    for (const file of [...extraFiles, 'public/images/hr-vector.svg', 'public/images/nra-logo.jpg']) await add(file);
    const tableNames = new Map(tables.map(row=>[row.TABLE_NAME.toLowerCase(),row.TABLE_NAME]));
    let tableReferences = 0, imports = 0;
    for (const [name, data] of entries) {
        if (!/\.(?:js|sql)$/.test(name)) continue;
        const source = data.toString('utf8');
        for (const match of source.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+`?([A-Za-z_]\w*)/gi)) {
            const actual = tableNames.get(match[1].toLowerCase());
            if (actual && actual !== match[1]) throw new Error('Case-sensitive SQL table mismatch in '+name);
            if (actual) tableReferences++;
        }
        if (!name.endsWith('.js')) continue;
        for (const match of source.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
            if (![target,target+'.js',target+'.json',target+'/index.js'].some(value=>entries.has(value))) throw new Error('Missing or case-mismatched runtime import in '+name+': '+target);
            imports++;
        }
    }
    const env = dotenv.parse(await fs.readFile(path.join(root,'.env')).catch(()=>Buffer.alloc(0)));
    const ignoredDefaults = new Set(['secret_key','secret','changeme','password']);
    const secrets = Object.entries(env).filter(([key,value])=>/(?:PASS(?:WORD)?|SECRET|TOKEN)$/i.test(key) && value.length>=8 && !ignoredDefaults.has(value)).map(([,value])=>value);
    const rejected = [];
    for (const [name, data] of entries) {
        if (/^(?:private|node_modules|\.git|deploy)\/|(?:^|\/)(?:uploads|test-results)(?:\/|$)|\.env$|\.(?:log|xlsx?|pdf|dump|bak|gz)$/i.test(name)) rejected.push(name);
        if (secrets.some(secret=>data.includes(Buffer.from(secret)))) rejected.push(name+' (secret match)');
        if (/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|SyntheticAcceptanceOnly!123|Phase16A!123/.test(data.toString('utf8'))) rejected.push(name+' (credential pattern)');
        if (/Matilda\s+Jusu|['"](?:0489|0496|0692|0520|0684|0587)['"]/i.test(data.toString('utf8'))) rejected.push(name+' (known live employee marker)');
    }
    if (rejected.length) throw new Error('Package rejected; sensitive/unreviewed content in: '+[...new Set(rejected)].join(', '));
    const manifest = { format: 1, release: JSON.parse(entries.get('package.json')).version, nodeMajor: 22,
        schemaTables: tables.length, dataPolicy: 'No live employee/payroll/account/session/GL rows; schema plus Company 1 payroll configuration only',
        configurationRows: Object.fromEntries(Object.entries(configuration).map(([name,rows])=>[name,rows.length])),
        files: [...entries].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,data])=>({path:name,bytes:data.length,sha256:sha(data)})) };
    entries.set('DEPLOYMENT-MANIFEST.json', Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
    const zip = createZip(entries), verified = readZip(zip);
    if (verified.size !== entries.size || [...entries].some(([name,data])=>!data.equals(verified.get(name)))) throw new Error('Archive round-trip mismatch.');
    if (!zip.equals(createZip(entries))) throw new Error('Non-deterministic archive.');
    const directory = path.join(root,'deploy'); await fs.mkdir(directory,{recursive:true});
    const filename = path.join(directory,'waec-cpanel-staging.zip'), temporary = filename+'.'+crypto.randomUUID()+'.tmp';
    await fs.writeFile(temporary,zip,{flag:'wx',mode:0o600}); await fs.rename(temporary,filename);
    const report = { status:'PASS', archive:'deploy/waec-cpanel-staging.zip', sha256:sha(zip), bytes:zip.length, entries:entries.size,
        schemaTables:tables.length, configurationRows:manifest.configurationRows, sourceReadOnly:true, liveEmployeeRowsIncluded:false,
        knownSecretScan:'PASS', credentialPatternScan:'PASS', archiveIntegrity:'PASS', deterministicBytes:'PASS',
        sqlTableCaseCheck:'PASS',literalTableReferencesChecked:tableReferences,relativeImportsChecked:imports,files:manifest.files };
    await fs.writeFile(path.join(directory,'waec-cpanel-staging.manifest.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({status:report.status,archive:report.archive,sha256:report.sha256,bytes:report.bytes,entries:report.entries,schemaTables:report.schemaTables}));
    return report;
}
if(require.main===module)build().catch(error=>{console.error('Package build failed:', error.message);process.exitCode=1;});
module.exports={build};
