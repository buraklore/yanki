const p=require('puppeteer');
const OK=[],BAD=[];
const chk=(n,c,i='')=>{(c?OK:BAD).push(n+(c?'':' → '+i))};
const B='http://127.0.0.1:3000';

(async()=>{
const br=await p.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
const pg=await br.newPage();
await pg.setViewport({width:1440,height:1000});
const errs=[];
pg.on('pageerror',e=>errs.push('PE: '+e.message));
pg.on('console',m=>{if(m.type()==='error')errs.push('CE: '+m.text().slice(0,150))});
await pg.evaluateOnNewDocument(()=>{ window.__dl=[];
  const orig=window.URL.createObjectURL; window.URL.createObjectURL=()=>'blob:stub'; });

/* ---------- register + onboarding ---------- */
const email=`full${Date.now()}@yanki.test`;
await pg.goto(B+'/giris',{waitUntil:'networkidle0'});
await pg.evaluate(()=>document.querySelector('#tReg').click());
await pg.type('#email',email); await pg.type('#password','correct-horse-battery-1');
await pg.click('#submit');
await new Promise(r=>setTimeout(r,4000));
chk('register → app', pg.url().includes('/app'), pg.url());

await pg.evaluate(()=>{window.dl=(n,c)=>window.__dl.push({n,c});});
await pg.type('#i1','Zeytin CRM'); await pg.type('#i2','zeytincrm.com');
await pg.evaluate(()=>obNext1());
await new Promise(r=>setTimeout(r,400));
await pg.evaluate(()=>{document.querySelector('#i5').value='İstanbul';
  document.querySelector('#i6').value='KOBİ için bulut CRM.';});
await pg.evaluate(()=>obNext2());
await new Promise(r=>setTimeout(r,2500));
await pg.evaluate(()=>{S.step=4;renderOb();S.rivals[0].n='Bulut CRM';S.rivals[0].d='bulutcrm.com';
  S.rivals[1].n='Pikselo';});
await pg.evaluate(()=>obNext4());
await new Promise(r=>setTimeout(r,3000));
await pg.evaluate(()=>obFinish());
await new Promise(r=>setTimeout(r,7000));
await pg.evaluate(()=>enterApp());
await new Promise(r=>setTimeout(r,3000));

/* wait for the queue to drain */
for(let i=0;i<25;i++){
  const pending=await pg.evaluate(()=>S.scanState?S.scanState.pending:0);
  if(!pending) break;
  await fetch(B+'/api/cron/drain',{headers:{authorization:'Bearer dev-cron-secret'}}).catch(()=>{});
  await pg.evaluate(()=>loadResults());
  await new Promise(r=>setTimeout(r,900));
}
const ready=await pg.evaluate(()=>({ready:S.data.ready,total:S.data.total,cells:S.data.cells.length,
  prompts:S.prompts.length,rivals:S.rivals.length,sources:S.data.sources.length}));
chk('scan produced a score', ready.ready && ready.total>0, JSON.stringify(ready));
chk('cells present', ready.cells>0, String(ready.cells));
chk('prompts listed', ready.prompts>=10, String(ready.prompts));
chk('competitors saved', ready.rivals===2, String(ready.rivals));
chk('citations collected', ready.sources>0, String(ready.sources));

/* ---------- every route renders ---------- */
for(const r of ['dashboard','mentions','platforms','sources','opps','bots','traffic','search',
                'rivals','prompts','plan','audit','tools','settings']){
  await pg.evaluate(rr=>go(rr),r);
  await new Promise(x=>setTimeout(x,200));
  const html=await pg.evaluate(()=>document.getElementById('page').innerHTML.length);
  chk('route '+r, html>400, String(html));
}

/* ---------- answer inspector ---------- */
await pg.evaluate(()=>go('mentions'));
await new Promise(r=>setTimeout(r,300));
const runId=await pg.evaluate(()=>{const c=S.data.cells.find(c=>c.runId);return c?c.runId:null});
chk('cells carry run ids', !!runId, String(runId));
if(runId){
  await pg.evaluate(id=>answerModal(id),runId);
  await new Promise(r=>setTimeout(r,1200));
  const m=await pg.evaluate(()=>document.getElementById('mBody').innerHTML);
  chk('inspector loads answer', m.includes('Prompt')&&m.length>400, String(m.length));
  chk('inspector highlights brands', m.includes('<mark'), 'no marks');
  chk('inspector shows provenance', /collected via/.test(m));
  await pg.evaluate(()=>closeModal());
}

/* ---------- CRUD ---------- */
await pg.evaluate(()=>go('rivals'));
await pg.evaluate(()=>{addRivalModal();document.querySelector('#rn').value='Norma';
  document.querySelector('#rd').value='norma.com.tr';});
await pg.evaluate(()=>addRival());
await new Promise(r=>setTimeout(r,2500));
chk('competitor added via API', await pg.evaluate(()=>S.rivals.length)===3,
    String(await pg.evaluate(()=>S.rivals.length)));
const rid=await pg.evaluate(()=>S.rivals.find(r=>r.n==='Norma').id);
await pg.evaluate(id=>rmRival(id),rid);
await new Promise(r=>setTimeout(r,2000));
chk('competitor removed via API', await pg.evaluate(()=>S.rivals.length)===2);

await pg.evaluate(()=>go('prompts'));
const before=await pg.evaluate(()=>S.prompts.length);
const limit=await pg.evaluate(()=>S.planLimits?S.planLimits.prompts:0);
chk('trial prompt limit reported', limit===10, String(limit));

// At the cap, adding must be refused with a clear message rather than
// silently dropping the prompt.
await pg.evaluate(()=>{newPromptModal();document.querySelector('#np').value='crm fiyatları 2026';});
await pg.evaluate(()=>addPrompt2());
await new Promise(r=>setTimeout(r,2000));
const atCap=before>=limit;
if(atCap){
  const toastTxt=await pg.evaluate(()=>document.getElementById('toasts').innerText);
  chk('plan limit enforced with a clear message', /up to \d+ prompts/i.test(toastTxt), toastTxt.slice(0,80));
  chk('refused prompt was not added', await pg.evaluate(()=>S.prompts.length)===before);
  await pg.evaluate(()=>closeModal());
  // Free a slot, then the same add must succeed.
  const victim=await pg.evaluate(()=>S.prompts[S.prompts.length-1].id);
  await pg.evaluate(i=>delPrompt(i),victim);
  await new Promise(r=>setTimeout(r,2000));
  chk('prompt deleted via API', await pg.evaluate(()=>S.prompts.length)===before-1);
}
await pg.evaluate(()=>{newPromptModal();document.querySelector('#np').value='crm fiyatları 2026';});
await pg.evaluate(()=>addPrompt2());
await new Promise(r=>setTimeout(r,2500));
chk('prompt added via API once there is room',
    await pg.evaluate(()=>S.prompts.some(p=>/crm fiyat/i.test(p.text))),
    JSON.stringify(await pg.evaluate(()=>S.prompts.map(p=>p.text).slice(-2))));

/* ---------- audit ---------- */
await pg.evaluate(()=>go('audit'));
await pg.evaluate(()=>{document.querySelector('#auditUrl').value='https://example.com';});
await pg.evaluate(()=>runAudit());
await new Promise(r=>setTimeout(r,12000));
const audit=await pg.evaluate(()=>({score:S.data.auditScore,cats:S.data.audit.length,
  facs:S.data.audit.reduce((a,c)=>a+c.facs.length,0),
  fixes:S.data.audit.reduce((a,c)=>a+c.facs.filter(f=>f.fix).length,0)}));
chk('audit ran against a live URL', audit.cats===6 && audit.facs===58, JSON.stringify(audit));
chk('audit produced fixes', audit.fixes>0, String(audit.fixes));
chk('audit score in range', audit.score>0 && audit.score<=100, String(audit.score));

/* ---------- action plan from audit ---------- */
await pg.evaluate(()=>go('plan'));
const plan=await pg.evaluate(()=>({n:S.data.actions.length,
  withCode:S.data.actions.filter(a=>a.code).length,
  withSteps:S.data.actions.filter(a=>a.steps&&a.steps.length).length}));
chk('action plan built from findings', plan.n>=3, JSON.stringify(plan));
chk('plan tasks have steps', plan.withSteps===plan.n);
chk('plan includes copy-ready fixes', plan.withCode>0, String(plan.withCode));

/* ---------- tools ---------- */
await pg.evaluate(()=>go('tools'));
for(const [t,tests] of [['robots',[/User-agent:\s*GPTBot/,/Allow:\s*\//,/Sitemap:/]],
                        ['llms',[/^# Zeytin CRM/m,/## Key pages/]],
                        ['schema',[/"@type":\s*"Organization"/,/FAQPage/]],
                        ['meta',[/<title>/,/og:description/]]]){
  await pg.evaluate(x=>{toolOpen(x);runGen()},t);
  await new Promise(r=>setTimeout(r,300));
  const out=await pg.evaluate(()=>document.getElementById('gc')?document.getElementById('gc').textContent:'');
  chk('tool '+t+' output', out.length>80, String(out.length));
  tests.forEach((re,i)=>chk(`tool ${t} shape ${i+1}`, re.test(out), out.slice(0,60)));
  chk('tool '+t+' uses real brand', /Zeytin CRM|zeytincrm/.test(out));
}
await pg.evaluate(()=>{toolOpen('writer');document.querySelector('#wTopic').value='crm yazılımı';runWriter()});
await new Promise(r=>setTimeout(r,400));
const md=await pg.evaluate(()=>document.getElementById('wmd')?document.getElementById('wmd').textContent:'');
chk('content writer output', md.length>300 && /crm yazılımı/i.test(md), String(md.length));

/* ---------- exports ---------- */
await pg.evaluate(()=>{go('mentions');exportMentions();go('platforms');exportPlats();
  go('sources');exportSources();go('opps');exportOpps();go('plan');exportPlan();
  go('audit');exportAudit();go('settings');setTab('profile');exportAll();});
await new Promise(r=>setTimeout(r,600));
const dls=await pg.evaluate(()=>window.__dl.map(d=>({n:d.n,len:String(d.c||'').length,
  rows:String(d.c||'').trim().split('\n').length})));
chk('exports produced files', dls.length>=7, dls.map(d=>d.n).join(','));
dls.forEach(d=>chk('export '+d.n+' has data', d.len>50 && d.rows>1, `${d.len}b/${d.rows}r`));

/* ---------- engines panel ---------- */
await pg.evaluate(()=>{go('settings');setTab('integrations')});
await new Promise(r=>setTimeout(r,1500));
const eng=await pg.evaluate(()=>document.getElementById('engBox').innerHTML);
chk('provider panel renders', eng.includes('ChatGPT') && eng.includes('DeepSeek'), String(eng.length));
chk('provider panel warns about mock mode', eng.includes('MOCK_ENGINES'));
chk('Copilot is gone', !eng.includes('Copilot'));

/* ---------- reload persistence ---------- */
await pg.reload({waitUntil:'networkidle0'});
await new Promise(r=>setTimeout(r,3500));
const after=await pg.evaluate(()=>({app:document.querySelector('#app').classList.contains('on'),
  brand:S.brand.name,prompts:S.prompts.length,score:S.data.total}));
chk('reload stays in dashboard', after.app && after.brand==='Zeytin CRM', JSON.stringify(after));
chk('reload restores score', after.score>0, String(after.score));

/* ---------- sign out ---------- */
await pg.evaluate(()=>signOut());
await new Promise(r=>setTimeout(r,2500));
chk('sign out returns to login', pg.url().includes('/giris'), pg.url());
await pg.goto(B+'/app',{waitUntil:'networkidle0'});
await new Promise(r=>setTimeout(r,2000));
chk('signed-out /app redirects', pg.url().includes('/giris'), pg.url());

await br.close();
console.log(`\nPASS ${OK.length}   FAIL ${BAD.length}`);
if(BAD.length)console.log(BAD.map(x=>'  ✗ '+x).join('\n'));
const uniq=[...new Set(errs)];
if(uniq.length)console.log('\nJS errors:\n'+uniq.slice(0,8).map(e=>'  ! '+e).join('\n'));
})();
