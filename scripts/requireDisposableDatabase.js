module.exports=function requireDisposableDatabase(){
    const target=process.env.WAEC_QA_DATABASE;
    if(!/^waec_acceptance_\d{8}_[a-f0-9]{8}$/.test(target||'') || globalThis.__WAEC_DISPOSABLE_GUARD__!==target
        || process.env.DB_NAME!==target || process.env.DBNAME!==target || !/^waecqa_[a-f0-9]{8}$/.test(process.env.DB_USER||'')){
        throw new Error('Refusing mutation fixtures outside the restricted disposable database. Use node scripts/runDisposableStagingAcceptance.js.');
    }
};
