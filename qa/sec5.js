const B='http://127.0.0.1:3000';
const { execSync } = require('node:child_process');
const PSQL=`psql "postgres://postgres:devpass@127.0.0.1:5432/yanki" -t -A -c`;
const q=s=>execSync(`${PSQL} "${s}"`).toString().trim();
const OK=[],BAD=[];const chk=(n,c,i='')=>{(c?OK:BAD).push(n+(c?'':' → '+i))};

function jar(){let c={};return{headers(){return Object.keys(c).length?{cookie:Object.entries(c).map(([k,v])=>`${k}=${v}`).join('; ')}:{}},
 take(r){(r.headers.getSetCookie?r.headers.getSetCookie():[]).forEach(s=>{const[kv]=s.split(';');const i=kv.indexOf('=');c[kv.slice(0,i)]=kv.slice(i+1)})}}}
async function req(p,{method='GET',body,cookies}={}){
  const r=await fetch(B+p,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookies?cookies.headers():{})},
    body:body?JSON.stringify(body):undefined});
  if(cookies)cookies.take(r);let d=null;try{d=await r.json()}catch{}
  return {status:r.status,data:d};
}
(async()=>{
const J=jar();
await req('/api/auth/register',{method:'POST',cookies:J,body:{email:`conc${Date.now()}@x.test`,password:'correct-horse-battery-1'}});
const ws=(await req('/api/workspaces',{method:'POST',cookies:J,
  body:{brandName:'Concurrency Test',domain:'conc.example',sector:'Diğer',country:'Türkiye'}})).data.workspace;
await req(`/api/workspaces/${ws.id}/complete`,{method:'POST',cookies:J,body:{
  competitors:[{name:'Rival X'}],
  prompts:Array.from({length:8},(_,i)=>({text:'concurrency prompt '+i,intent:'evaluation',volume:100,source:'ai'}))}});

const queued=Number(q(`select count(*) from scan_jobs j join scans s on s.id=j.scan_id where s.workspace_id='${ws.id}'`));
chk('jobs queued', queued>0, String(queued));

/* six drains at once — SKIP LOCKED must stop any job running twice */
const results=await Promise.all(Array.from({length:6},()=>
  fetch(B+'/api/cron/drain',{headers:{authorization:'Bearer dev-cron-secret'}}).then(r=>r.json())));
const claimed=results.reduce((a,r)=>a+(r.claimed||0),0);
const failed=results.reduce((a,r)=>a+(r.failed||0),0);
console.log('  parallel drains:',JSON.stringify(results.map(r=>({c:r.claimed,ok:r.ok,f:r.failed}))));
chk('parallel drains did not fail jobs', failed===0, String(failed));

for(let i=0;i<8;i++) await fetch(B+'/api/cron/drain',{headers:{authorization:'Bearer dev-cron-secret'}});

const dupes=q(`select count(*) from (select scan_id,prompt_id,engine_key,run_index,count(*) c
  from answer_runs group by 1,2,3,4 having count(*)>1) d`);
chk('no duplicate answer rows', dupes==='0', dupes);
const orphan=q(`select count(*) from run_brands rb left join answer_runs ar on ar.id=rb.run_id where ar.id is null`);
chk('no orphan brand rows', orphan==='0', orphan);
const status=q(`select status from scans where workspace_id='${ws.id}'`);
chk('scan finalised', ['done','partial'].includes(status), status);
const score=q(`select score from daily_scores where workspace_id='${ws.id}'`);
chk('daily score written once', score!=='' && !score.includes('\n'), JSON.stringify(score));

/* what happens when every engine fails */
console.log('\n  simulating total provider failure…');
const before=q(`select count(*) from scans where workspace_id='${ws.id}'`);
execSync(`${PSQL} "update scan_jobs set done_at=null, attempts=4, error='simulated provider outage' where workspace_id='${ws.id}'"`);
const st=q(`select status from scans where workspace_id='${ws.id}'`);
await fetch(B+'/api/cron/drain',{headers:{authorization:'Bearer dev-cron-secret'}});
const after=q(`select status from scans where workspace_id='${ws.id}'`);
chk('exhausted jobs do not spin forever', after==='done'||after==='partial', after);
const res=(await req(`/api/results?workspace=${ws.id}`,{cookies:J})).data;
chk('results still render after a failure', !!res.workspace && Array.isArray(res.prompts), JSON.stringify(res).slice(0,60));

console.log(`\nPASS ${OK.length}   FAIL ${BAD.length}`);
if(BAD.length)console.log(BAD.map(x=>'  ✗ '+x).join('\n'));
})();
