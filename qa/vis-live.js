const p=require('puppeteer'),fs=require('fs');
const SRC=fs.readFileSync('audit.fn.js','utf8')+'\n__audit()';
const B='http://127.0.0.1:3000';
(async()=>{
const br=await p.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
// sign in once, reuse the session
const login=await br.newPage();
await login.goto(B+'/giris',{waitUntil:'networkidle0'});
await login.evaluate(()=>document.querySelector('#tReg').click());
const email=`vis${Date.now()}@yanki.test`;
await login.type('#email',email); await login.type('#password','correct-horse-battery-1');
await login.click('#submit'); await new Promise(r=>setTimeout(r,3500));
await login.type('#i1','Vis Brand'); await login.type('#i2','visbrand.example');
await login.evaluate(()=>obNext1()); await new Promise(r=>setTimeout(r,400));
await login.evaluate(()=>{document.querySelector('#i6').value='Test.';obNext2()});
await new Promise(r=>setTimeout(r,2500));
await login.evaluate(()=>{S.step=4;renderOb();S.rivals[0].n='Rival A';obNext4()});
await new Promise(r=>setTimeout(r,3000));
await login.evaluate(()=>obFinish()); await new Promise(r=>setTimeout(r,6000));
await login.evaluate(()=>enterApp()); await new Promise(r=>setTimeout(r,2500));
for(let i=0;i<8;i++){
  await fetch(B+'/api/cron/drain',{headers:{authorization:'Bearer dev-cron-secret'}}).catch(()=>{});
  await new Promise(r=>setTimeout(r,700));
}
await login.evaluate(()=>loadResults()); await new Promise(r=>setTimeout(r,1200));
await login.close();

for(const [nm,w,h] of [['desktop',1440,950],['mobile',390,844]]){
  const pg=await br.newPage();
  await pg.setViewport({width:w,height:h});
  const errs=[];
  pg.on('pageerror',e=>errs.push('PE: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CE: '+m.text().slice(0,120))});

  for(const path of ['/','/yardim','/giris']){
    await pg.goto(B+path,{waitUntil:'networkidle0'});
    await new Promise(r=>setTimeout(r,700));
    const R=await pg.evaluate(SRC);
    report(nm,path,R,errs.splice(0));
  }
  await pg.close();
}

// app screens need the session cookie, so drive them in the same page
const pg=await br.newPage();
await pg.setViewport({width:1440,height:1000});
const errs=[];
pg.on('pageerror',e=>errs.push('PE: '+e.message));
pg.on('console',m=>{if(m.type()==='error')errs.push('CE: '+m.text().slice(0,120))});
await pg.goto(B+'/app',{waitUntil:'networkidle0'});
await new Promise(r=>setTimeout(r,2000));
if(!pg.url().includes('/app')){
  await pg.type('#email',email); await pg.type('#password','correct-horse-battery-1');
  await pg.click('#submit'); await new Promise(r=>setTimeout(r,4000));
}
await new Promise(r=>setTimeout(r,2500));

for(const [nm,w,h] of [['desktop',1440,1000],['mobile',390,844]]){
  await pg.setViewport({width:w,height:h});
  for(const r of ['dashboard','mentions','platforms','sources','opps','bots','traffic','search',
                  'rivals','prompts','plan','audit','tools','settings']){
    await pg.evaluate(rr=>go(rr),r);
    await new Promise(x=>setTimeout(x,300));
    const R=await pg.evaluate(SRC);
    report(nm,'/app#'+r,R,errs.splice(0));
    if(nm==='desktop'&&['dashboard','plan','settings'].includes(r))
      await pg.screenshot({path:`shots/live-${r}.png`,fullPage:true});
  }
}
await br.close();

function report(nm,path,R,errs){
  const L=[];
  if(errs.length)L.push('JS: '+[...new Set(errs)].slice(0,2).join(' | '));
  if(R.overflowX>1)L.push('overflowX '+R.overflowX+'px');
  if(R.dupIds.length)L.push('dup ids: '+R.dupIds.join(','));
  if(R.tiny.length)L.push('<10px: '+R.tiny.slice(0,4).join(' | '));
  if(R.lowContrast.length)L.push('contrast: '+R.lowContrast.slice(0,5).join(' | '));
  if(nm==='mobile'&&R.smallTap.length)L.push('tap<28: '+R.smallTap.slice(0,4).join(' | '));
  if(R.overflowEls.length)L.push('overflow: '+R.overflowEls.slice(0,4).join(' | '));
  if(R.noLabel.length)L.push('unlabelled: '+R.noLabel.join(','));
  if(L.length)console.log(`[${nm}] ${path}\n   `+L.join('\n   '));
}
})();
