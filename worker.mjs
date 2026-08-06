/**
 * Long-running worker for VPS deployment.
 *
 * Identical drain logic to /api/cron/drain — the only difference is that
 * nothing kills the process at 60 seconds, so batches can be larger and there
 * is no cold start. On Vercel you do not need this file; on a VPS run:
 *
 *   pm2 start worker.mjs --name yanki-worker
 */
import { drainJobs } from './lib/scan.ts';

const BATCH = Number(process.env.WORKER_BATCH ?? 40);
const IDLE_MS = 5_000;

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

while (!stopping) {
  try {
    const r = await drainJobs(BATCH, 5 * 60_000);
    if (r.claimed === 0) await new Promise(res => setTimeout(res, IDLE_MS));
    else console.log(new Date().toISOString(), r);
  } catch (e) {
    console.error('drain failed:', e.message);
    await new Promise(res => setTimeout(res, IDLE_MS));
  }
}
console.log('worker stopped cleanly');
