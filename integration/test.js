'use strict';
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const shared = path.join(__dirname, 'privacy-lib');
const checks = [];
const policies = ['consent','lawful','information','access','rectification','erasure','restriction','portability','objection','complaint','breach'];
const sources = [path.join(shared,'gdpr-router.cjs'), ...fs.readdirSync(path.join(shared,'gdpr')).filter(x=>x.endsWith('.rego')).map(x=>path.join(shared,'gdpr',x))];
const hashes = () => sources.map(file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
const originalHashes = hashes();
async function check(name, action) { await action(); checks.push({name, passed:true}); console.log('PASS '+name); }
async function freePort() { const s=net.createServer().listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p; }
async function waitFor(port, child, output) {
  const deadline=Date.now()+90000;
  while(Date.now()<deadline) {
    if(child.exitCode!==null) throw new Error('Child exited: '+output());
    const up=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1');s.on('connect',()=>{s.destroy();resolve(true)});s.on('error',()=>resolve(false));s.setTimeout(500,()=>{s.destroy();resolve(false)});});
    if(up)return;
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('Startup timed out: '+output());
}
async function stop(child) {
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  const exited=once(child,'exit'); child.kill(); await exited;
}
(async()=>{
  const port=await freePort(), dbPort=await freePort(), opaPort=await freePort();
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'privacy-goalsetter-test-'));
  const children=[];
  let output='';
  function launch(executable,args,options={}) {
    const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...options});
    children.push(child);child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
    child.on('error',e=>output+=e.message);return child;
  }
  const base='http://127.0.0.1:'+port;
  async function request(route,{method='GET',body,token}={}) {
    const headers={}; if(body!==undefined)headers['Content-Type']='application/json';if(token)headers.Authorization='Bearer '+token;
    const r=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const text=await r.text();let value;try{value=JSON.parse(text)}catch{value=text}return {status:r.status,data:value};
  }
  const api=(token,policy,body={},method='POST')=>request('/gdpr/'+policy,{method,body,token});
  try {
    const mongo=launch(process.env.MONGOD_BINARY || 'mongod',['--bind_ip','127.0.0.1','--port',String(dbPort),'--dbpath',data,'--logpath',path.join(data,'mongo.log')]);
    await waitFor(dbPort,mongo,()=>output);
    const opa=launch(process.env.OPA_BINARY || 'opa',['run','--server','--addr','127.0.0.1:'+opaPort,path.join(shared,'gdpr')]);
    await waitFor(opaPort,opa,()=>output);
    const appEnv={...process.env,PORT:String(port),MONGO_URI:'mongodb://127.0.0.1:'+dbPort+'/integration',NODE_ENV:'production',JWT_SECRET:crypto.randomBytes(48).toString('hex'),BASELINE_SECRET_FILE:'',OPA_QUERY_URL:'http://127.0.0.1:'+opaPort+'/v1/query',GDPR_ADMIN_USER_IDS:''};
    let server=launch(process.execPath,[path.join(root,'backend/server.js')],{cwd:root,env:appEnv});
    await waitFor(port,server,()=>output);
    const alice={name:'Alice Private',password:'Integration123!',email:'alice-private@example.org'};
    const bob={name:'Bob Private',password:'Integration456!',email:'bob-private@example.org'};
    let a,b,subject;
    await check('Original registration works',async()=>{assert.equal((await request('/api/users',{method:'POST',body:alice})).status,201);assert.equal((await request('/api/users',{method:'POST',body:bob})).status,201)});
    await check('Original JWT login works',async()=>{a=(await request('/api/users/login',{method:'POST',body:alice})).data.token;b=(await request('/api/users/login',{method:'POST',body:bob})).data.token;assert.ok(a&&b)});
    await check('Original login returns the real profile',async()=>{const r=await request('/api/users/me',{token:a});assert.equal(r.data.email,'alice-private@example.org');subject=r.data._id;assert.ok(!('password'in r.data))});
    await stop(server);
    appEnv.GDPR_ADMIN_USER_IDS=subject;
    server=launch(process.execPath,[path.join(root,'backend/server.js')],{cwd:root,env:appEnv});
    await waitFor(port,server,()=>output);
    await check('Original owned goal creation works',async()=>{
      assert.equal((await request('/api/goals',{method:'POST',token:a,body:{text:'Alice secret goal'}})).status,200);
      assert.equal((await request('/api/goals',{method:'POST',token:b,body:{text:'Bob secret goal'}})).status,200);
    });
    await check('Original goal ownership checks still work',async()=>{
      const list=(await request('/api/goals',{token:a})).data;
      assert.equal(list.length,1);assert.equal(list[0].text,'Alice secret goal');
      assert.equal((await request('/api/goals/'+list[0]._id,{method:'PUT',token:b,body:{text:'Forbidden'}})).status,401);
    });
    await check('Privacy test UI is served without exposing account data',async()=>{const r=await request('/gdpr');assert.equal(r.status,200);assert.ok(r.data.includes('Your data. Your privacy checks.'));assert.ok(!r.data.includes('alice-private@example.org'));});
    await check('Missing JWT denied',async()=>assert.equal((await api(null,'access')).status,401));
    await check('Invalid JWT denied',async()=>assert.equal((await api('invalid','access')).status,401));
    await check('Missing consent defaults false',async()=>assert.equal((await api(a,'consent')).data,false));
    await check('Consent persists in MongoDB',async()=>assert.deepEqual((await api(a,'consent',{value:'yes',withdrawn:false},'PATCH')).data,{value:'yes',withdrawn:false}));
    for(const policy of ['consent','lawful'])await check(policy+' accepts stored consent',async()=>assert.equal((await api(a,policy)).data,true));
    await check('Information reflects consent',async()=>assert.equal((await api(a,'information')).data.consent_valid,true));
    await check('Access maps actual profile fields',async()=>{const r=await api(a,'access');assert.equal(r.status,200);const d=JSON.parse(r.data.download.content);assert.equal(d.user_id,subject);assert.deepEqual(d.data_collected_from_user.map(x=>x.field).sort(),['email','goals','name'])});
    await check('Rectification returns scoped update plan',async()=>{const r=await api(a,'rectification',{updates:{name:'Updated Alice'}});assert.equal(r.data.request.validated,true);assert.ok(r.data.db_update_plan.some(x=>x.field==='name'&&x.user_id===subject))});
    await check('Retention exception rejects email erasure',async()=>assert.equal((await api(a,'erasure',{fields:['email']})).data.decision,'reject'));
    await check('Restriction returns plan',async()=>assert.equal((await api(a,'restriction')).data.decision,'accept'));
    await check('Portability exports real values without password hash',async()=>{const r=await api(a,'portability');assert.equal(r.data.decision,'accept');assert.equal(r.data.actions.downloads.length,2);const text=JSON.stringify(r.data);assert.ok(text.includes('alice-private@example.org'));assert.ok(text.includes('Alice secret goal'));assert.ok(!text.includes('Bob secret goal'));assert.ok(!text.includes('\"password\"'));assert.ok(!text.includes('Integration123'));assert.ok(!text.includes('"hash"'))});
    await check('Objection returns stop plan',async()=>assert.equal((await api(a,'objection',{reason:'marketing'})).data.decision,'accept'));
    await check('Complaint returns forwarding plan',async()=>assert.equal((await api(a,'complaint',{authority_id:'cy-0000',description:'Local test only'})).data.decision,'accept'));
    await check('Configured admin can assess breach',async()=>assert.equal((await api(a,'breach',{incident_id:'local-test'})).data.decision,'notify_users'));
    await check('Ordinary user cannot assess breach',async()=>assert.equal((await api(b,'breach',{incident_id:'local-test'})).status,403));
    await check('Well-signed JWT for nonexistent user denied by GDPR adapter',async()=>{
      const jwt=require('jsonwebtoken');
      const ghost=jwt.sign({id:'507f1f77bcf86cd799439099'},appEnv.JWT_SECRET,{algorithm:'HS256'});
      assert.equal((await api(ghost,'access')).status,401);
    });
    await check('Second user has independent consent',async()=>assert.equal((await api(b,'consent')).data,false));
    await api(b,'consent',{value:'yes',withdrawn:false},'PATCH');
    await check('Bob export excludes Alice',async()=>{const text=JSON.stringify((await api(b,'portability')).data);assert.ok(text.includes('bob-private@example.org'));assert.ok(text.includes('Bob secret goal'));assert.ok(!text.includes('Alice secret goal'));assert.ok(!text.includes('alice-private@example.org'))});
    await check('Alice export excludes Bob',async()=>assert.ok(!JSON.stringify((await api(a,'portability')).data).includes('bob-private@example.org')));
    await check('Client cannot override subject identity',async()=>assert.equal((await api(b,'access',{user_id:subject})).status,400));
    await check('Client cannot override trusted checks',async()=>assert.equal((await api(a,'restriction',{checks:{data_correct:true}})).status,400));
    await check('Password rectification rejected',async()=>assert.equal((await api(a,'rectification',{updates:{hash:'forged'}})).status,400));
    await check('Invalid consent boolean rejected',async()=>assert.equal((await api(a,'consent',{value:'yes',withdrawn:'false'},'PATCH')).status,400));
    await check('Unknown operation rejected',async()=>assert.equal((await api(a,'unknown')).status,400));
    await check('Array request rejected',async()=>assert.equal((await api(a,'access',[])).status,400));
    await check('Consent withdrawal persists',async()=>assert.equal((await api(a,'consent',{value:'yes',withdrawn:true},'PATCH')).status,200));
    for(const policy of ['consent','lawful','portability'])await check(policy+' denies after withdrawal',async()=>{const d=(await api(a,policy)).data;assert.equal(policy==='portability'?d.decision:d,policy==='portability'?'reject':false)});
    await check('Access remains available after withdrawal',async()=>assert.equal((await api(a,'access')).data.request.validated,true));
    await check('Eligible erasure returns delete plan',async()=>assert.equal((await api(a,'erasure',{fields:['goals']})).data.decision,'accept'));
    await check('Action plans do not alter account',async()=>assert.equal((await request('/api/users/me',{token:a})).data.name,'Alice Private'));
    await check('Erasure plan does not delete stored goals',async()=>assert.equal((await request('/api/goals',{token:a})).data[0].text,'Alice secret goal'));
    await check('OPA failure returns 502',async()=>{await stop(opa);assert.equal((await api(a,'consent')).status,502)});
    await check('Shared router and Rego files unchanged',async()=>assert.deepEqual(hashes(),originalHashes));
    require('./test-support.cjs').recordResult({repository:'bradtraversy/mern-tutorial',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),timestamp:new Date().toISOString(),passed:checks.length,checks,policies,limitations:['Decisions and action plans only; no updates, deletions or messages executed','Synthetic controller and policy metadata','name, email and owned goal text/timestamps mapped; passwords and JWTs excluded','Breach permission uses a configured immutable user-ID allowlist; the host has no administrator role']});
    console.log(checks.length+'/'+checks.length+' assertions passed');
  } finally {
    for(const child of children.reverse())await stop(child);
    // Remove only this runner's unique temporary MongoDB directory.
    if(path.dirname(data)===os.tmpdir()&&path.basename(data).startsWith('privacy-goalsetter-test-'))fs.rmSync(data,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
