const B='http://127.0.0.1:3000';
function jar(){let c={};return{headers(){return Object.keys(c).length?{cookie:Object.entries(c).map(([k,v])=>`${k}=${v}`).join('; ')}:{}},
 take(r){(r.headers.getSetCookie?r.headers.getSetCookie():[]).forEach(s=>{const[kv]=s.split(';');const i=kv.indexOf('=');c[kv.slice(0,i)]=kv.slice(i+1)})}}}
async function req(p,{method='GET',body,cookies}={}){
  const r=await fetch(B+p,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookies?cookies.headers():{})},
    body:body?JSON.stringify(body):undefined});
  if(cookies)cookies.take(r);let d=null;try{d=await r.json()}catch{}
  return {status:r.status,data:d};
}
const OK=[],BAD=[];const chk=(n,c,i='')=>{(c?OK:BAD).push(n+(c?'':' → '+i))};
(async()=>{
console.log('Simulating the Vercel free tier: no cron calls at all.\n');
const J=jar();
await req('/api/auth/register',{method:'POST',cookies:J,body:{email:`hobby${Date.now()}@x.test`,password:'correct-horse-battery-1'}});
const ws=(await req('/api/workspaces',{method:'POST',cookies:J,
  body:{brandName:'Hobby Test',domain:'hobby.example',sector:'Diğer',country:'Türkiye'}})).data.workspace;

const gen=(await req('/api/prompts/generate',{method:'POST',cookies:J,body:{workspaceId:ws.id}})).data;
const done=await req(`/api/workspaces/${ws.id}/complete`,{method:'POST',cookies:J,body:{
  competitors:[{name:'Hobby Rival'}],
  prompts:gen.prompts.slice(0,10).map(p=>({text:p.text,intent:p.intent,volume:p.volume,source:'ai'}))}});
console.log('  onboarding queued', done.data.jobs, 'jobs across', done.data.engines.length, 'engines');
chk('jobs queued on completion', done.data.jobs>0, JSON.stringify(done.data));

// Only poll /api/results, exactly as the open dashboard does. No cron.
let polls=0, pending=null, score=null;
for(let i=0;i<40;i++){
  const r=await req(`/api/results?workspace=${ws.id}`,{cookies:J});
  polls++;
  pending=r.data.scan?r.data.scan.pending:0;
  score=r.data.latest?Number(r.data.latest.score):null;
  if(i%5===0) console.log(`  poll ${String(polls).padStart(2)} · pending ${String(pending).padStart(3)} · score ${score===null?'—':score}`);
  if(pending===0 && score!==null) break;
  await new Promise(r=>setTimeout(r,400));
}
console.log(`  finished after ${polls} polls · pending ${pending} · score ${score}`);
chk('queue drained with no cron at all', pending===0, String(pending));
chk('score produced', score!==null && score>=0, String(score));

const r2=(await req(`/api/results?workspace=${ws.id}`,{cookies:J})).data;
chk('scan marked complete', r2.scan && ['done','partial'].includes(r2.scan.status), r2.scan&&r2.scan.status);
chk('cells written', r2.cells.length>0, String(r2.cells.length));
chk('citations collected', r2.sources.length>0, String(r2.sources.length));

console.log(`\nPASS ${OK.length}   FAIL ${BAD.length}`);
if(BAD.length)console.log(BAD.map(x=>'  ✗ '+x).join('\n'));
})();
