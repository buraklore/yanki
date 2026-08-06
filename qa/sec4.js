const p=require('puppeteer');
const B='http://127.0.0.1:3000';
const OK=[],BAD=[];const chk=(n,c,i='')=>{(c?OK:BAD).push(n+(c?'':' → '+i))};
(async()=>{
const br=await p.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
const pg=await br.newPage();
await pg.setViewport({width:1440,height:1000});
const errs=[]; pg.on('pageerror',e=>errs.push(e.message));

/* ---------- XSS through every user-controlled field ---------- */
const payload = '<img src=x onerror=window.__pwned=1>';
await pg.goto(B+'/giris',{waitUntil:'networkidle0'});
await pg.evaluate(()=>document.querySelector('#tReg').click());
await pg.type('#fullName', payload);
await pg.type('#email', `xss${Date.now()}@x.test`);
await pg.type('#password','correct-horse-battery-1');
await pg.click('#submit');
await new Promise(r=>setTimeout(r,4000));

await pg.type('#i1', payload+' Brand');
await pg.type('#i2','xsstest.example');
await pg.evaluate(()=>obNext1());
await new Promise(r=>setTimeout(r,400));
await pg.evaluate(pl=>{document.querySelector('#i5').value=pl;
  document.querySelector('#i6').value=pl;},payload);
await pg.evaluate(()=>obNext2());
await new Promise(r=>setTimeout(r,2500));
await pg.evaluate(pl=>{S.step=4;renderOb();S.rivals[0].n=pl+' Rival';S.rivals[0].d='rival.example';},payload);
await pg.evaluate(()=>obNext4());
await new Promise(r=>setTimeout(r,3000));
await pg.evaluate(pl=>{document.querySelector('#iq').value=pl+' prompt';addPrompt();},payload);
await pg.evaluate(()=>obFinish());
await new Promise(r=>setTimeout(r,6000));
await pg.evaluate(()=>enterApp());
await new Promise(r=>setTimeout(r,3000));
for(let i=0;i<8;i++) await fetch(B+'/api/cron/drain',{headers:{authorization:'Bearer dev-cron-secret'}});
await pg.evaluate(()=>loadResults());
await new Promise(r=>setTimeout(r,1500));

for(const r of ['dashboard','mentions','platforms','sources','opps','rivals','prompts','plan','audit','tools','settings']){
  await pg.evaluate(rr=>go(rr),r);
  await new Promise(x=>setTimeout(x,200));
}
await pg.evaluate(()=>{go('settings');setTab('brand')});
await new Promise(r=>setTimeout(r,400));
const pwned=await pg.evaluate(()=>({flag:!!window.__pwned,
  img:!!document.querySelector('img[src="x"]'),
  hasText:document.body.innerText.includes('onerror')}));
chk('no script executed from user input', !pwned.flag, 'window.__pwned set');
chk('no element injected from user input', !pwned.img, 'img[src=x] present');
chk('payload survives as visible text', pwned.hasText, 'payload not shown at all');

/* generators must escape too */
await pg.evaluate(()=>{go('tools');toolOpen('schema');runGen()});
await new Promise(r=>setTimeout(r,400));
const schema=await pg.evaluate(()=>document.getElementById('gc').textContent);
let valid=false;
try{ JSON.parse(schema.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]); valid=true; }catch{}
chk('schema stays valid JSON with hostile brand name', valid, schema.slice(0,80));
chk('no injection into the DOM from generators', !await pg.evaluate(()=>!!window.__pwned));

console.log(`\nPASS ${OK.length}   FAIL ${BAD.length}`);
if(BAD.length)console.log(BAD.map(x=>'  ✗ '+x).join('\n'));
if(errs.length)console.log('JS errors: '+[...new Set(errs)].slice(0,3).join(' | '));
await br.close();
})();
