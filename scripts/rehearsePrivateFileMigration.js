require('dotenv').config({quiet:true,override:true});
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const express=require('express'),session=require('express-session'),signature=require('cookie-signature');
const pool=require('../config/db');
const {createPrivateFileHandler,privateRoot}=require('../services/privateFileService');
const root=path.resolve(__dirname,'..'),run=crypto.randomUUID();
const testRoot=path.join(root,'private','staging-file-rehearsal',run);
const report={runId:run,startedAt:new Date().toISOString(),companyId:1,entries:[],status:'RUNNING',sourceFilesChanged:false};
const manifest={runId:run,confidential:true,references:[],files:[]};
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
async function walk(dir,prefix=''){try{for(const item of await fs.readdir(dir,{withFileTypes:true})){const relative=path.join(prefix,item.name),file=path.join(dir,item.name);if(item.isDirectory())await walk(file,relative);else if(item.isFile())manifest.files.push({source:file,relative,sha256:hash(await fs.readFile(file))});}}catch(error){if(error.code!=='ENOENT')throw error;}}

async function main(){
    await fs.mkdir(testRoot,{recursive:true,mode:0o700});
    const [photos]=await pool.query("SELECT PFNo,CompanyID,PhotoPath AS reference FROM tblstaff WHERE CompanyID=1 AND COALESCE(PhotoPath,'')<>''");
    const [receipts]=await pool.query("SELECT TransNo,PFNo,CompanyID,PicturePath AS reference FROM tblmedical WHERE CompanyID=1 AND COALESCE(PicturePath,'')<>''");
    manifest.references=[...photos.map(x=>({...x,table:'tblstaff',field:'PhotoPath'})),...receipts.map(x=>({...x,table:'tblmedical',field:'PicturePath'}))];
    const roots=[privateRoot,path.join(root,'public/uploads')];for(const dir of roots)await walk(dir);
    const mappings=new Map(),copies=[];const baseline=path.join(testRoot,'baseline'),destination=path.join(testRoot,'destination');
    for(const entry of manifest.references){
        const result={table:entry.table,field:entry.field,fixtureId:crypto.randomUUID(),status:'PENDING'};report.entries.push(result);
        const match=String(entry.reference).match(/^\/uploads\/(staff_photos|medical_receipts)\/([a-zA-Z0-9_-]+\.(?:jpe?g|png|gif|webp))$/i);
        if(!match){result.status='INVALID_REFERENCE_REQUIRES_REVIEW';continue;}
        let source;
        for(const dir of roots){const candidate=path.join(dir,match[1],match[2]);try{const actual=await fs.realpath(candidate),base=await fs.realpath(dir);if(!actual.startsWith(base+path.sep))throw new Error('Source escapes approved root');source=actual;break;}catch(error){if(error.code!=='ENOENT')throw error;}}
        if(!source){result.status='MISSING_SOURCE_REQUIRES_REVIEW';continue;}
        const content=await fs.readFile(source),digest=hash(content),name=crypto.randomUUID()+path.extname(source).toLowerCase();
        const relative=path.join(match[1],name),url='/uploads/'+relative.replace(/\\/g,'/');
        for(const dir of [baseline,destination]){await fs.mkdir(path.dirname(path.join(dir,relative)),{recursive:true,mode:0o700});await fs.writeFile(path.join(dir,relative),content,{flag:'wx',mode:0o600});}
        mappings.set(url,{CompanyID:1,PFNo:'SYNTHETIC'});copies.push({source,relative,url,digest});
        result.sha256=digest;result.status='COPIED_FOR_REHEARSAL';entry.rehearsalRelative=relative;entry.source=source;entry.sha256=digest;
    }
    await fs.writeFile(path.join(testRoot,'migration-manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
    const secret=crypto.randomBytes(48).toString('hex'),store=new session.MemoryStore();
    async function cookie(company){const id=crypto.randomUUID();await new Promise((resolve,reject)=>store.set(id,{cookie:{maxAge:60000},user:{id:'synthetic-rehearsal-user',role:'manager',companyId:company}},error=>error?reject(error):resolve()));return 'rehearsal.sid='+encodeURIComponent('s:'+signature.sign(id,secret));}
    const owned=await cookie(1),foreign=await cookie(2),app=express();
    app.use(session({name:'rehearsal.sid',secret,store,resave:false,saveUninitialized:false}));app.use((req,res,next)=>{req.user=req.session.user;next();});
    app.use('/uploads',createPrivateFileHandler({roots:[destination,baseline],executor:{query:async(sql,args)=>{const owner=mappings.get(args[0]);return [owner&&owner.CompanyID===args[1]?[owner]:[]];}}}));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    try{for(const entry of copies){
        const allowed=await fetch(base+entry.url,{headers:{cookie:owned}});assert.equal(allowed.status,200);assert.equal(hash(Buffer.from(await allowed.arrayBuffer())),entry.digest);
        assert.equal((await fetch(base+entry.url)).status,401);assert.equal((await fetch(base+entry.url,{headers:{cookie:foreign}})).status,404);
        await fs.unlink(path.join(destination,entry.relative));
        const rollback=await fetch(base+entry.url,{headers:{cookie:owned}});assert.equal(rollback.status,200);assert.equal(hash(Buffer.from(await rollback.arrayBuffer())),entry.digest);
        assert.equal(hash(await fs.readFile(entry.source)),entry.digest,'Original file changed');
        report.entries.find(x=>x.sha256===entry.digest).status='PASS';
    }}finally{await new Promise(resolve=>server.close(resolve));store.clear();}
    for(const entry of copies)await fs.unlink(path.join(baseline,entry.relative));
    report.copyFilesRemoved=true;report.confidentialManifest=path.relative(root,path.join(testRoot,'migration-manifest.json'));report.inventoryFiles=manifest.files.length;report.references=manifest.references.length;
    const [after]=await pool.query("SELECT PFNo,CompanyID,PhotoPath AS reference FROM tblstaff WHERE CompanyID=1 AND COALESCE(PhotoPath,'')<>''");assert.deepEqual(after,photos);
    report.databaseReferencesUnchanged=true;report.status=report.entries.every(x=>x.status==='PASS')?'PASS':'BLOCKED';
    console.log(JSON.stringify({status:report.status,references:report.references,filesInventoried:report.inventoryFiles,sourceFilesChanged:false,copyFilesRemoved:true}));
}
main().catch(error=>{report.status='BLOCKED';report.error=error.code||error.message;console.log('PRIVATE_FILE_REHEARSAL_BLOCKED',report.error);}).finally(async()=>{report.completedAt=new Date().toISOString();await fs.writeFile(path.join(root,'docs/test-results/private-file-migration-rehearsal-latest.json'),JSON.stringify(report,null,2));await pool.end();if(report.status!=='PASS')process.exitCode=1;});
