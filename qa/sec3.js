const B='http://127.0.0.1:3000';
function jar(){let c={};return{headers(){return Object.keys(c).length?{cookie:Object.entries(c).map(([k,v])=>`${k}=${v}`).join('; ')}:{}},
 take(r){(r.headers.getSetCookie?r.headers.getSetCookie():[]).forEach(s=>{const[kv]=s.split(';');const i=kv.indexOf('=');c[kv.slice(0,i)]=kv.slice(i+1)})}}}
async function req(p,{method='GET',body,cookies,extra={}}={}){
  const r=await fetch(B+p,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookies?cookies.headers():{}),...extra},
    body:body?JSON.stringify(body):undefined});
  if(cookies)cookies.take(r); let d=null;try{d=await r.json()}catch{}
  return {status:r.status,data:d};
}
const OK=[],BAD=[];const chk=(n,c,i='')=>{(c?OK:BAD).push(n+(c?'':' → '+i))};
(async()=>{
const J=jar(); const em=`sec3${Date.now()}@x.test`;
await req('/api/auth/register',{method:'POST',cookies:J,body:{email:em,password:'correct-horse-battery-1'}});

/* password change */
let r=await req('/api/auth/password',{method:'POST',cookies:J,body:{current:'wrong-one-here',next:'brand-new-password-2'}});
chk('wrong current password rejected', r.status===400, `${r.status} ${JSON.stringify(r.data)}`);
r=await req('/api/auth/password',{method:'POST',cookies:J,body:{current:'correct-horse-battery-1',next:'short'}});
chk('weak new password rejected', r.status===400 && /10 characters/.test(r.data.error||''), JSON.stringify(r.data));
r=await req('/api/auth/password',{method:'POST',cookies:J,body:{current:'correct-horse-battery-1',next:'brand-new-password-2'}});
chk('password changed', r.status===200, JSON.stringify(r.data));
r=await req('/api/auth/login',{method:'POST',body:{email:em,password:'correct-horse-battery-1'}});
chk('old password no longer works', r.status===401, String(r.status));
const J2=jar();
r=await req('/api/auth/login',{method:'POST',cookies:J2,body:{email:em,password:'brand-new-password-2'}});
chk('new password works', r.status===200, String(r.status));
r=await req('/api/auth/me',{cookies:J});
chk('session survives own password change', r.data.signedIn===true, JSON.stringify(r.data).slice(0,60));

/* forgot password without a mail provider */
r=await req('/api/auth/forgot',{method:'POST',body:{email:em}});
chk('forgot without mailer explains itself', r.status===503 && /email provider/i.test(r.data.error||''),
    `${r.status} ${JSON.stringify(r.data)}`);
r=await req('/api/auth/reset',{method:'POST',body:{token:'x'.repeat(40),password:'brand-new-password-3'}});
chk('bogus reset token rejected', r.status===400, `${r.status} ${JSON.stringify(r.data)}`);

/* audit still works against a real public site */
const ws=(await req('/api/workspaces',{method:'POST',cookies:J2,
  body:{brandName:'Sec Three',domain:'example.com',sector:'Diğer',country:'Türkiye'}})).data.workspace;
r=await req('/api/audit',{method:'POST',cookies:J2,body:{workspaceId:ws.id,url:'https://example.com'}});
chk('audit still works on a public site', r.status===200 && r.data.score>0,
    `${r.status} ${JSON.stringify(r.data).slice(0,90)}`);
r=await req('/api/audit',{method:'POST',cookies:J2,body:{workspaceId:ws.id,url:'http://169.254.169.254/'}});
chk('metadata address still blocked', r.status===400 && /link-local|metadata/i.test(r.data.error||''),
    JSON.stringify(r.data));

/* downgrade is allowed, upgrade is not */
r=await req('/api/org/plan',{method:'POST',cookies:J2,body:{plan:'business'}});
chk('upgrade blocked', r.status===402, String(r.status));
r=await req('/api/org/plan',{method:'POST',cookies:J2,body:{plan:'trial'}});
chk('staying on trial allowed', r.status===200, String(r.status));

/* session expiry */
const { execSync } = await import('node:child_process');
execSync(`psql "postgres://postgres:devpass@127.0.0.1:5432/yanki" -c "update sessions set expires_at = now() - interval '1 day'" >/dev/null`);
r=await req('/api/auth/me',{cookies:J2});
chk('expired session is not accepted', r.data.signedIn===false, JSON.stringify(r.data).slice(0,60));

console.log(`\nPASS ${OK.length}   FAIL ${BAD.length}`);
if(BAD.length)console.log(BAD.map(x=>'  ✗ '+x).join('\n'));
})();
