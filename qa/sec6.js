/* qa/sec6.js — tenant isolation for the v2–v5 endpoints.
 *
 * Same contract as qa/sec.js: two fresh tenants, then every new endpoint is
 * attacked cross-tenant. The rule being proven is the project's oldest one —
 * a workspace id in a request means requireWorkspace, and tenant A must get
 * 404 (not 403, which confirms existence) for anything of tenant B's.
 *
 * Run against a live server:  node qa/sec6.js
 */
const B = 'http://127.0.0.1:3000';
const OK = [], BAD = [];
const chk = (n, c, i = '') => { (c ? OK : BAD).push(n + (c ? '' : ' → ' + i)); };

function jar(){ let c = {}; return {
  headers(){ return Object.keys(c).length ? { cookie: Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ') } : {}; },
  take(res){ const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    sc.forEach(s => { const [kv] = s.split(';'); const i = kv.indexOf('='); c[kv.slice(0, i)] = kv.slice(i + 1); }); },
}; }

async function req(path, { method = 'GET', body, cookies, extra = {} } = {}){
  const res = await fetch(B + path, { method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookies ? cookies.headers() : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  if (cookies) cookies.take(res);
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

(async () => {
const A = jar(), Bj = jar();
const ea = `sec6A${Date.now()}@x.test`, eb = `sec6B${Date.now()}@x.test`;
await req('/api/auth/register', { method: 'POST', cookies: A,  body: { email: ea, password: 'correct-horse-battery-1', orgName: 'Sec6 A' } });
await req('/api/auth/register', { method: 'POST', cookies: Bj, body: { email: eb, password: 'correct-horse-battery-1', orgName: 'Sec6 B' } });

const wsA = (await req('/api/workspaces', { method: 'POST', cookies: A,
  body: { brandName: 'Alpha Six', domain: 'alpha6.example', sector: 'Teknoloji & Bilişim', country: 'Türkiye' } })).data;
const wsB = (await req('/api/workspaces', { method: 'POST', cookies: Bj,
  body: { brandName: 'Beta Six', domain: 'beta6.example', sector: 'Teknoloji & Bilişim', country: 'Türkiye' } })).data;
chk('two tenants created', !!(wsA && wsA.workspace) && !!(wsB && wsB.workspace));
const idA = wsA.workspace.id, idB = wsB.workspace.id;

let r;

/* ---------- candidates (v2) ---------- */
r = await req(`/api/competitors/candidates?workspace=${idB}`, { cookies: A });
chk('A cannot list B candidates', r.status === 404, String(r.status));
r = await req('/api/competitors/candidates', { method: 'POST', cookies: A,
  body: { workspaceId: idB, id: '00000000-0000-0000-0000-000000000001', action: 'add' } });
chk('A cannot promote candidates in B', r.status === 404, String(r.status));

/* ---------- recommendations (v2) ---------- */
r = await req('/api/recommendations', { method: 'POST', cookies: Bj,
  body: { workspaceId: idB, ref: 'audit:sec6', kind: 'audit', title: 'B secret task', severity: 'mid', status: 'done' } });
chk('B can persist a recommendation', r.status === 200 && r.data.recommendation, String(r.status));
const recB = r.data && r.data.recommendation ? r.data.recommendation.id : '00000000-0000-0000-0000-000000000002';

r = await req(`/api/recommendations?workspace=${idB}`, { cookies: A });
chk('A cannot list B recommendations', r.status === 404, String(r.status));
r = await req('/api/recommendations', { method: 'POST', cookies: A,
  body: { workspaceId: idB, ref: 'audit:injected', kind: 'audit', title: 'injected', status: 'done' } });
chk('A cannot write recommendations into B', r.status === 404, String(r.status));
r = await req('/api/recommendations', { method: 'PATCH', cookies: A, body: { id: recB, status: 'dismissed' } });
chk('A cannot patch B recommendation by id', r.status === 404, String(r.status));
r = await req(`/api/recommendations?workspace=${idB}`, { cookies: Bj });
chk('B recommendation untouched after attack',
  r.status === 200 && r.data.recommendations.some(x => x.id === recB && x.status === 'done'), JSON.stringify(r.data).slice(0, 80));

/* ---------- generated content (v3) ---------- */
r = await req('/api/content', { method: 'POST', cookies: Bj,
  body: { workspaceId: idB, kind: 'llms', title: 'llms.txt', body: '# beta secret llms' } });
chk('B can save generated content', r.status === 200 && r.data.item, String(r.status));
const genB = r.data && r.data.item ? r.data.item.id : '00000000-0000-0000-0000-000000000003';

r = await req(`/api/content?workspace=${idB}`, { cookies: A });
chk('A cannot list B generated content', r.status === 404, String(r.status));
r = await req('/api/content', { method: 'POST', cookies: A,
  body: { workspaceId: idB, kind: 'llms', title: 'x', body: 'injected' } });
chk('A cannot save content into B', r.status === 404, String(r.status));
r = await req('/api/content', { method: 'PUT', cookies: A, body: { workspaceId: idB, id: genB } });
chk('A cannot fetch B content body (own-ws param)', r.status === 404, String(r.status));
r = await req('/api/content', { method: 'PUT', cookies: A, body: { workspaceId: idA, id: genB } });
chk('A cannot fetch B content body via own workspace', r.status === 404, String(r.status));

/* ---------- variants (v4) ---------- */
r = await req(`/api/prompts/variants?workspace=${idB}&prompt=00000000-0000-0000-0000-000000000004`, { cookies: A });
chk('A cannot read B variant report', r.status === 404, String(r.status));
r = await req('/api/prompts/variants', { method: 'POST', cookies: A,
  body: { workspaceId: idB, promptId: '00000000-0000-0000-0000-000000000004' } });
chk('A cannot start variant test on B (isolation before plan gate)', r.status === 404, String(r.status));
r = await req('/api/prompts/variants', { method: 'POST', cookies: A,
  body: { workspaceId: idA, promptId: '00000000-0000-0000-0000-000000000004' } });
chk('trial plan gets 402 on own variant test', r.status === 402, String(r.status));

/* ---------- bots (v5) ---------- */
r = await req(`/api/bots?workspace=${idB}`, { cookies: A });
chk('A cannot read B bot screen', r.status === 404, String(r.status));
r = await req('/api/bots', { method: 'POST', cookies: A, body: { workspaceId: idB, action: 'rotate' } });
chk('A cannot rotate B ingest token', r.status === 404, String(r.status));

const botB = (await req(`/api/bots?workspace=${idB}`, { cookies: Bj })).data;
chk('B receives an ingest token', !!(botB && botB.token && botB.token.length >= 40), JSON.stringify(botB).slice(0, 60));

const line = '1.2.3.4 - - [21/Sep/2026:10:00:00 +0300] "GET /llms.txt HTTP/1.1" 200 10 "-" "GPTBot/1.2"';
r = await req('/api/bots/ingest', { method: 'POST', body: { lines: [line] },
  extra: { authorization: 'Bearer ' + 'x'.repeat(48) } });
chk('random ingest token is rejected', r.status === 401, String(r.status));
r = await req('/api/bots/ingest', { method: 'POST', body: { lines: [line] },
  extra: { authorization: 'Bearer ' + botB.token } });
chk('valid token ingests', r.status === 200 && r.data.matched === 1, JSON.stringify(r.data).slice(0, 80));

const rotated = (await req('/api/bots', { method: 'POST', cookies: Bj,
  body: { workspaceId: idB, action: 'rotate' } })).data;
r = await req('/api/bots/ingest', { method: 'POST', body: { lines: [line] },
  extra: { authorization: 'Bearer ' + botB.token } });
chk('old token dead after rotation', r.status === 401, String(r.status));
r = await req('/api/bots/ingest', { method: 'POST', body: { lines: [line] },
  extra: { authorization: 'Bearer ' + rotated.token } });
chk('new token works after rotation', r.status === 200, String(r.status));

const seen = (await req(`/api/bots?workspace=${idB}`, { cookies: Bj })).data;
chk('B sees GPTBot with llms.txt hit',
  seen.bots.some(b => b.bot === 'GPTBot' && b.llms > 0), JSON.stringify(seen.bots).slice(0, 100));

/* ---------- report ---------- */
console.log(`\nsec6: ${OK.length} passed, ${BAD.length} failed`);
OK.forEach(n => console.log('  ✓', n));
BAD.forEach(n => console.log('  ✕', n));
process.exit(BAD.length ? 1 : 0);
})().catch(e => { console.error('sec6 crashed:', e); process.exit(1); });
