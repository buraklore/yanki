import { sql } from '@/lib/db';
import { handler } from '@/lib/auth';
import { buildDigest, detectChanges } from '@/lib/digest';
import { digestHtml, digestText, digestSubject } from '@/lib/digest-email';
import { sendMail, mailerConfigured } from '@/lib/mailer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/**
 * Weekly digest.
 *
 * This is the endpoint that turns the product into a subscription. A customer
 * who fixes the audit once and never hears from us again has no reason to
 * renew; one who gets told "you dropped from second to fifth and Klasgame
 * passed you" cannot afford to cancel.
 *
 * Runs Monday morning. Idempotent per workspace and week: the unique index on
 * digests means a retry re-sends nothing.
 */
export const GET = handler(async (req) => {
  if (!authorised(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const dry = new URL(req.url).searchParams.get('dry') === '1';
  // Monday of the current week, so a retry on Tuesday lands in the same bucket.
  const [{ week_start: weekStart }] = await sql`select (date_trunc('week', current_date))::date as week_start`;

  const workspaces = await sql`
    select w.id, w.brand_name, o.id as org_id
      from workspaces w
      join organizations o on o.id = w.org_id
     where w.onboarded
       and exists (select 1 from daily_scores d where d.workspace_id = w.id)`;

  const results: Record<string, unknown>[] = [];

  for (const ws of workspaces) {
    try {
      // Detection first: the digest reads the events this writes.
      await detectChanges(ws.id as string);

      const [already] = await sql`
        select id, sent_at from digests
         where workspace_id = ${ws.id} and period = 'weekly' and period_start = ${weekStart}`;
      if (already?.sent_at) { results.push({ workspace: ws.id, skipped: 'already_sent' }); continue; }

      const digest = await buildDigest(ws.id as string, 7);
      if (!digest) { results.push({ workspace: ws.id, skipped: 'no_data' }); continue; }

      await sql`
        insert into digests (workspace_id, period, period_start, period_end, summary)
        values (${ws.id}, 'weekly', ${weekStart}, ${digest.periodEnd}, ${sql.json(digest as never)})
        on conflict (workspace_id, period, period_start)
          do update set summary = excluded.summary, period_end = excluded.period_end`;

      if (dry || !mailerConfigured()) {
        results.push({ workspace: ws.id, built: true, sent: false,
                       reason: dry ? 'dry_run' : 'no_mailer' });
        continue;
      }

      // One email per person who wants it, not one per account.
      const recipients = await sql`
        select distinct u.email
          from memberships m
          join users u on u.id = m.user_id
         where m.org_id = ${ws.org_id} and u.notify_weekly
           and m.role in ('owner','admin','analyst')`;

      const base = process.env.APP_URL || new URL(req.url).origin;
      let sent = 0, failed: string | null = null;
      for (const r of recipients) {
        try {
          await sendMail(r.email as string, digestSubject(digest),
                         digestHtml(digest, base), digestText(digest, base));
          sent++;
        } catch (e) { failed = (e as Error).message.slice(0, 200); }
      }

      await sql`
        update digests set sent_at = ${sent ? new Date() : null}, send_error = ${failed}
         where workspace_id = ${ws.id} and period = 'weekly' and period_start = ${weekStart}`;

      results.push({ workspace: ws.id, sent, urgent: digest.urgent.length, failed });
    } catch (e) {
      // One broken workspace must not stop the run for everyone else.
      results.push({ workspace: ws.id, error: (e as Error).message.slice(0, 200) });
    }
  }

  return Response.json({ weekStart, considered: workspaces.length, results });
});
