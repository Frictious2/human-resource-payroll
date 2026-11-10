const assert = require('node:assert/strict');
const { calculateProgressivePaye, calculateMonthlyPaye } = require('../services/payeTaxService');
const { calculatePayrollSetupForStaff } = require('../services/payrollSetupAutoCalculationService');
const pool = require('../config/db');
const taxConfig = { R1:600,R1Tax:0,R2:1200,R2Tax:15,R3:1800,R3Tax:20,R4:2400,R4Tax:25,R5:99000,R5Tax:30,AllwThreshold:500 };

function independentReference(income) {
    const cents = Math.max(0, Math.round(income*100));
    const slices = [Math.min(cents,60000),Math.min(Math.max(cents-60000,0),60000),Math.min(Math.max(cents-120000,0),60000),Math.min(Math.max(cents-180000,0),60000),Math.max(cents-240000,0)];
    return Math.round(slices.reduce((sum,x,i)=>sum+x*[0,15,20,25,30][i],0)/100)/100;
}

async function main() {
    for (const value of [0,599.99,600,600.01,1000,1199.99,1200,1200.01,1799.99,1800,1800.01,2000,2399.99,2400,2400.01,3000,5000,10000,100000]) {
        assert.equal(calculateProgressivePaye(value,taxConfig),independentReference(value));
    }
    let basic = 2000, allowanceTaxable = true, allowance = 500;
    const executor = { query: async (sql,args) => {
        assert(!/\b(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i.test(sql), 'Calculation must remain read-only');
        if (sql.includes('FROM tblstaff')) {
            assert.equal(args[1], 1);
            return [[{ PFNo:'0001',GradeCode:'FIXTURE',Notch:1,CompanyID:1 }]];
        }
        if (sql.includes('FROM tblgrade')) return [[{GradeCode:'FIXTURE',NotchIncr:1,StartLevel:basic*12,EndLevel:basic*12,Notches:1,Increment:0}]];
        if (sql.includes('FROM tblsalary')) return [[{Ded1:25}]];
        if (sql.includes('FROM tblpayrollitems')) return [[
            {Code:'01',Freq:'M',Taxable:1,CompanyID:1},
            {Code:'03',Freq:'M',Fixed:1,TAmount:allowance,Taxable:allowanceTaxable?1:0,CompanyID:1},
            {Code:'32',Freq:'M',Percent:5,CompanyID:1},
            {Code:'33',Freq:'M',Percent:10,CompanyID:1},
            {Code:'41',Freq:'M',Percent:10,CompanyID:1}
        ]];
        if (sql.includes('FROM tbltax')) { assert.equal(args[0],1); return [[taxConfig]]; }
        throw new Error('Unexpected calculation query');
    } };
    for (const scenario of [{basic:1000,allowance:0,tax:52.5},{basic:2000,allowance:0,tax:235},{basic:2000,allowance:500,tax:360},{basic:100000,allowance:500,tax:28290}]) {
        basic=scenario.basic; allowance=scenario.allowance;
        const result = (await calculatePayrollSetupForStaff({companyId:1,pfNo:'0001',executor})).fields;
        const expectedTax=independentReference(basic+allowance-basic*.05);
        assert.equal(result.Tax,expectedTax);
        assert.equal(result.NassitEmp,Math.round(basic*.05*100)/100);
        assert.equal(result.NassitInst,Math.round(basic*.1*100)/100);
        assert.equal(result.GratEmp,Math.round(basic*.1*100)/100);
        assert.equal(result.NetIncome,Math.round((basic+allowance-result.Tax-result.NassitEmp-result.GratEmp-25)*100)/100);
    }
    basic=2000; allowance=500; allowanceTaxable=false;
    const nonTaxable=(await calculatePayrollSetupForStaff({companyId:1,pfNo:'0001',executor})).fields;
    assert.equal(nonTaxable.Taxable,1900); assert.equal(nonTaxable.Tax,235); assert.equal(nonTaxable.TotalIncome,2500);
    const integrated=await calculateMonthlyPaye({companyId:1,taxableEarnings:1000,employeeNassit:50,connection:executor});
    assert.equal(integrated.tax,52.5);
    console.log('PASS: 19 independent PAYE boundaries, NASSIT 5/10%, PROV-EMP once, taxable/non-taxable fixed allowance, deductions/net, effective company tax lookup and high-income excess. No financial records written.');
}

main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>pool.end());
