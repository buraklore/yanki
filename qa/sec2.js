const B='http://127.0.0.1:3000';
const R=[];
const note=(n,v)=>R.push([n,v]);
function jar(){let c={};return{headers(){return Object.keys(c).length?{cookie:Object.entries(c).map(([k,v])=>`${k}=${v}`).join('; ')}:{}},
 take(res){(res.headers.getSetCookie?res.headers.getSetCookie():[]).forEach(s=>{const[kv]=s.split(';');const i=kv.indexOf('=');c[kv.slice(0,i)]=kv.slice(i+1)})}}}
async function req(path,{method='GET',body,cookies,extra={}}={}){
  const res=await fetch(B+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookies?cookies.headers():{}),...extra},
    body:body?JSON.stringify(body):undefined});
  if(cookies)cookies.take(res);
  let d=null;try{d=await res.json()}catch{}
  return {status:res.status,data:d};
}
(async()=>{
const J=jar();
const em=`sec2${Date.now()}@x.test`;
await req('/api/auth/register',{method:'POST',cookies:J,body:{email:em,password:'correct-horse-battery-1'}});
const ws=(await req('/api/workspaces',{method:'POST',cookies:J,
  body:{brandName:'SSRF Test',domain:'example.com',sector:'Diğer',country:'Türkiye'}})).data.workspace;

console.log('=== 1. SSRF: can the audit reach internal targets? ===');
for(const target of [
  'http://169.254.169.254/latest/meta-data/',        // AWS/GCP metadata
  'http://metadata.google.internal/computeMetadata/v1/',
  'http://127.0.0.1:3000/api/health',                // our own server
  'http://127.0.0.1:5432',                           // postgres
  'http://localhost:3000/api/auth/me',
  'http://10.0.0.1/', 'http://192.168.1.1/',
  'file:///etc/passwd',
]){
  const r=await req('/api/audit',{method:'POST',cookies:J,body:{workspaceId:ws.id,url:target}});
  const reached = r.status===200;
  console.log(`  ${reached?'REACHED':'blocked'}  ${String(r.status).padEnd(4)} ${target}`);
  if(reached) note('SSRF',target);
}

console.log('\n=== 2. Can a user upgrade their own plan for free? ===');
let r=await req('/api/org/plan',{method:'POST',cookies:J,body:{plan:'business'}});
console.log('  POST /api/org/plan {business} →',r.status,JSON.stringify(r.data));
const me=(await req('/api/auth/me',{cookies:J})).data;
console.log('  plan is now:',me.org.plan,'| prompt limit:',me.limits.prompts);
if(me.org.plan==='business') note('self-upgrade','any owner can grant themselves the top plan');

console.log('\n=== 3. Brute force: how many login attempts are allowed? ===');
const t0=Date.now(); let attempts=0, blocked=false;
for(let i=0;i<25;i++){
  const x=await req('/api/auth/login',{method:'POST',body:{email:em,password:'wrong'+i}});
  attempts++;
  if(x.status===429){blocked=true;break}
}
console.log(`  ${attempts} wrong passwords in ${Date.now()-t0}ms · rate limited: ${blocked}`);
if(!blocked) note('brute force','no rate limit on login');

console.log('\n=== 4. Registration spam ===');
let regs=0, regBlocked=false;
for(let i=0;i<12;i++){
  const x=await req('/api/auth/register',{method:'POST',body:{email:`spam${Date.now()}_${i}@x.test`,password:'correct-horse-battery-1'}});
  if(x.status===429){regBlocked=true;break}
  if(x.status===200)regs++;
}
console.log(`  ${regs} accounts created back to back · rate limited: ${regBlocked}`);
if(!regBlocked) note('registration spam','no rate limit on register');

console.log('\n=== 5. Manual scan rate limit ===');
await req(`/api/workspaces/${ws.id}/complete`,{method:'POST',cookies:J,body:{
  competitors:[],prompts:[{text:'test prompt one',intent:'evaluation',volume:100,source:'ai'}]}});
for(let i=0;i<5;i++) await fetch(B+'/api/cron/drain',{headers:{authorization:'Bearer dev-cron-secret'}});
const s1=await req('/api/scan',{method:'POST',cookies:J,body:{workspaceId:ws.id,warm:false}});
const s2=await req('/api/scan',{method:'POST',cookies:J,body:{workspaceId:ws.id,warm:false}});
console.log('  first:',s1.status,'| immediate second:',s2.status,JSON.stringify(s2.data).slice(0,90));
if(s2.status===200) note('scan spam','manual rescan is not throttled');

console.log('\n=== 6. Input validation ===');
const cases=[
  ['huge prompt text',{workspaceId:ws.id,prompts:[{text:'x'.repeat(5000),intent:'evaluation',volume:1,source:'custom'}]}],
  ['bad intent',{workspaceId:ws.id,prompts:[{text:'ok',intent:'nonsense',volume:1,source:'custom'}]}],
  ['negative volume',{workspaceId:ws.id,prompts:[{text:'ok two',intent:'evaluation',volume:-5,source:'custom'}]}],
  ['array of 5000',{workspaceId:ws.id,prompts:Array.from({length:5000},(_,i)=>({text:'p'+i,intent:'evaluation',volume:1,source:'custom'}))}],
  ['workspaceId not a uuid',{workspaceId:'../../etc/passwd',prompts:[{text:'ok',intent:'evaluation',volume:1,source:'custom'}]}],
];
for(const [name,body] of cases){
  const x=await req('/api/prompts',{method:'POST',cookies:J,body});
  console.log(`  ${String(x.status).padEnd(4)} ${name}`);
  if(x.status===500) note('unhandled input',name);
}
const bad=await req('/api/auth/register',{method:'POST',body:{email:'not-an-email',password:'x'}});
console.log('  ',bad.status,'malformed register payload');
const noBody=await fetch(B+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:'{'});
console.log('  ',noBody.status,'malformed JSON body');
if(noBody.status===500) note('unhandled input','malformed JSON returns 500');

console.log('\n=== 7. SQL injection attempts ===');
for(const inj of ["'; drop table users; --","' OR '1'='1","%27%20OR%201=1"]){
  const x=await req('/api/workspaces',{method:'POST',cookies:J,
    body:{brandName:inj,domain:'inj.example',sector:'Diğer',country:'Türkiye'}});
  console.log(`  ${x.status} brandName=${inj.slice(0,26)}`);
}
const stillThere=await req('/api/auth/me',{cookies:J});
console.log('  users table intact:',stillThere.data.signedIn===true);

console.log('\n=== 8. Password reset ===');
const pr=await fetch(B+'/api/auth/reset',{method:'POST'});
console.log('  /api/auth/reset →',pr.status);
if(pr.status===404) note('no password reset','a user who forgets their password is locked out permanently');

console.log('\n\n──────── FINDINGS ────────');
if(!R.length) console.log('none');
R.forEach(([k,v])=>console.log(`  ⚠ ${k}: ${v}`));
})();
