import { runAudit } from '../lib/audit';
const url = process.argv[2] || 'https://www.wikipedia.org';
const r = await runAudit(url, process.argv[3] || 'Wikipedia');
console.log(`\n${r.url}  →  ${r.score.toFixed(1)}/100`);
console.log(`fetch: browser ${r.fetched.browserBytes}B · crawler ${r.fetched.crawlerBytes}B · ${r.fetched.ttfbMs}ms · HTTP ${r.fetched.status}\n`);
for (const c of r.categories) {
  console.log(`${c.name.padEnd(34)} ${c.score.toFixed(0).padStart(3)}`);
  for (const f of c.factors) {
    const m = { pass: '✓', partial: '~', fail: '✗' }[f.status];
    console.log(`   ${m} ${f.label.padEnd(46)} ${f.detail.slice(0, 70)}`);
  }
}
