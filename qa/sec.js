const B='http://127.0.0.1:3000';
const OK=[],BAD=[];
const chk=(n,c,i='')=>{(c?OK:BAD).push(n+(c?'':' → '+i))};

function jar(){ let c={}; return {
  headers(){ return Object.keys(c).length ? {cookie:Object.entries(c).map(([k,v])=>`${k}=${v}`).join('; ')} : {} },
  take(res){ const sc=res.headers.getSetCookie?res.headers.getSetCookie():[];
    sc.forEach(s=>{const [kv]=s.split(';');const i=kv.indexOf('=');c[kv.slice(0,i)]=kv.slice(i+1);}); },
  raw(){ return c } };
}
async function req(path,{method='GET',body,cookies,extra={}}={}){
  const res=await fetch(B+path,{method,
    headers:{...(body?{'content-type':'application/json'}:{}),...(cookies?cookies.headers():{}),...extra},
    body:body?JSON.stringify(body):undefined, redirect:'manual'});
  if(cookies) cookies.take(res);
  let data=null; try{data=await res.json()}catch{}
  return {status:res.status,data,res};
}

(async()=>{
/* ---------- two independent tenants ---------- */
const A=jar(), Bj=jar();
const ea=`tenantA${Date.now()}@x.test`, eb=`tenantB${Date.now()}@x.test`;
await req('/api/auth/register',{method:'POST',cookies:A,body:{email:ea,password:'correct-horse-battery-1',orgName:'Tenant A'}});
await req('/api/auth/register',{method:'POST',cookies:Bj,body:{email:eb,password:'correct-horse-battery-1',orgName:'Tenant B'}});

const wsA=(await req('/api/workspaces',{method:'POST',cookies:A,
  body:{brandName:'Alpha Brand',domain:'alpha.example',sector:'Teknoloji & Bilişim',country:'Türkiye'}})).data;
const wsB=(await req('/api/workspaces',{method:'POST',cookies:Bj,
  body:{brandName:'Beta Brand',domain:'beta.example',sector:'Teknoloji & Bilişim',country:'Türkiye'}})).data;
chk('two tenants created', !!wsA.workspace && !!wsB.workspace);
const idA=wsA.workspace.id, idB=wsB.workspace.id;

/* ---------- CROSS-TENANT ACCESS ---------- */
let r;
r=await req(`/api/workspaces/${idB}`,{cookies:A});
chk('A cannot read B workspace', r.status===404, `${r.status} ${JSON.stringify(r.data).slice(0,80)}`);

r=await req(`/api/workspaces/${idB}`,{method:'PATCH',cookies:A,body:{brandName:'HACKED'}});
chk('A cannot patch B workspace', r.status===404, String(r.status));

r=await req(`/api/results?workspace=${idB}`,{cookies:A});
chk('A cannot read B results', r.status===404, String(r.status));

r=await req('/api/prompts?workspace='+idB,{cookies:A});
chk('A cannot list B prompts', r.status===404, String(r.status));

r=await req('/api/prompts',{method:'POST',cookies:A,
  body:{workspaceId:idB,prompts:[{text:'injected prompt',intent:'evaluation',volume:100,source:'custom'}]}});
chk('A cannot add prompts to B', r.status===404, String(r.status));

r=await req('/api/competitors',{method:'POST',cookies:A,body:{workspaceId:idB,name:'Injected'}});
chk('A cannot add competitors to B', r.status===404, String(r.status));

r=await req('/api/scan',{method:'POST',cookies:A,body:{workspaceId:idB}});
chk('A cannot trigger B scan', r.status===404, String(r.status));

r=await req('/api/audit',{method:'POST',cookies:A,body:{workspaceId:idB,url:'https://example.com'}});
chk('A cannot audit for B', r.status===404, String(r.status));

r=await req('/api/prompts/generate',{method:'POST',cookies:A,body:{workspaceId:idB}});
chk('A cannot generate for B', r.status===404, String(r.status));

/* B creates data, then A tries to reach it by id */
await req(`/api/workspaces/${idB}/complete`,{method:'POST',cookies:Bj,body:{
  competitors:[{name:'Beta Rival'}],
  prompts:[{text:'beta secret prompt',intent:'evaluation',volume:100,source:'ai'}]}});
for(let i=0;i<6;i++){ await fetch(B+'/api/cron/drain',{headers:{authorization:'Bearer dev-cron-secret'}}); }
const bRes=(await req(`/api/results?workspace=${idB}`,{cookies:Bj})).data;
const runId=(bRes.recentMentions&&bRes.recentMentions[0])?bRes.recentMentions[0].id
  :(bRes.cells.find(c=>c.runId)||{}).runId;
if(runId){
  r=await req(`/api/answers?run=${runId}`,{cookies:A});
  chk('A cannot read B raw answer', r.status===404, `${r.status}`);
  r=await req(`/api/answers?run=${runId}`,{cookies:Bj});
  chk('B can read own raw answer', r.status===200, String(r.status));
} else chk('run id available for answer test', false, 'no runs produced');

const pidB=(await req('/api/prompts?workspace='+idB,{cookies:Bj})).data.prompts[0].id;
r=await req(`/api/prompts?id=${pidB}`,{method:'DELETE',cookies:A});
chk('A cannot delete B prompt', r.status===404, String(r.status));
r=await req('/api/prompts',{method:'PATCH',cookies:A,body:{id:pidB,active:false}});
chk('A cannot toggle B prompt', r.status===404, String(r.status));

const cidB=(await req(`/api/results?workspace=${idB}`,{cookies:Bj})).data.competitors[0].id;
r=await req(`/api/competitors?id=${cidB}`,{method:'DELETE',cookies:A});
chk('A cannot delete B competitor', r.status===404, String(r.status));

/* ---------- unauthenticated ---------- */
for(const [p,o] of [['/api/results?workspace='+idA,{}],['/api/workspaces',{}],
    ['/api/prompts?workspace='+idA,{}],['/api/engines',{}],['/api/answers?run=1',{}]]){
  r=await req(p,o);
  chk('anon blocked on '+p.split('?')[0], r.status===401, String(r.status));
}
r=await req('/api/scan',{method:'POST',body:{workspaceId:idA}});
chk('anon blocked on /api/scan', r.status===401, String(r.status));

/* ---------- forged / expired session ---------- */
r=await req('/api/auth/me',{extra:{cookie:'yanki_session=totally-made-up-token'}});
chk('forged cookie is not a session', r.data && r.data.signedIn===false, JSON.stringify(r.data));

/* ---------- cron auth ---------- */
r=await req('/api/cron/drain');
chk('cron requires secret', r.status===401, String(r.status));
r=await req('/api/cron/drain',{extra:{authorization:'Bearer wrong'}});
chk('cron rejects wrong secret', r.status===401, String(r.status));
r=await req('/api/cron/enqueue',{extra:{authorization:'Bearer dev-cron-secret'}});
chk('cron accepts right secret', r.status===200, String(r.status));

console.log(`\nPASS ${OK.length}   FAIL ${BAD.length}`);
if(BAD.length)console.log(BAD.map(x=>'  ✗ '+x).join('\n'));
})();
