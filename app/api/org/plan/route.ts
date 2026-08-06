import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, handler, HttpError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const Body = z.object({ plan: z.enum(['trial', 'starter', 'growth', 'business']) });

const RANK = { trial: 0, starter: 1, growth: 2, business: 3, agency: 3 } as const;

/**
 * Plan changes.
 *
 * A paid plan must never be self-granted: without this guard any signed-in
 * user could POST {plan:"business"} and take the top tier for free, along with
 * the provider spend that comes with it. Upgrades therefore come from the
 * billing provider's webhook (see /api/billing/webhook), and this route only
 * allows a customer to move *down* — cancelling or downgrading is their right
 * and needs no payment.
 *
 * ALLOW_SELF_UPGRADE=1 re-enables free upgrades for local development. It must
 * not be set in production.
 */
export const POST = handler(async (req) => {
  const s = await requireSession();
  if (s.role !== 'owner') throw new HttpError(403, 'Only the account owner can change the plan.');
  const { plan } = Body.parse(await req.json());

  const current = RANK[s.plan as keyof typeof RANK] ?? 0;
  const wanted = RANK[plan];
  const selfUpgradeAllowed = process.env.ALLOW_SELF_UPGRADE === '1';

  if (wanted > current && !selfUpgradeAllowed) {
    throw new HttpError(402,
      'Upgrades are completed through checkout. Connect a payment method to continue.');
  }

  await sql`update organizations set plan = ${plan} where id = ${s.orgId}`;
  return Response.json({ ok: true, plan, downgraded: wanted < current });
});
