import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler, HttpError } from '@/lib/auth';
import { sectorByLabel, normaliseDomain, COUNTRIES } from '@/lib/sectors';
import { buildAliases } from '@/lib/entity';

export const dynamic = 'force-dynamic';

const Patch = z.object({
  brandName: z.string().min(2).max(120).optional(),
  domain: z.string().max(200).optional(),
  sector: z.string().max(80).optional(),
  country: z.string().max(40).optional(),
  city: z.string().max(80).nullable().optional(),
  description: z.string().max(1200).nullable().optional(),
  aliases: z.array(z.string().max(80)).max(30).optional(),
  /**
   * Set only after the user has been told what changing the brand does to the
   * history already attached to this workspace. See the identity guard below.
   */
  confirmRebrand: z.boolean().optional(),
});

export const GET = handler(async (req) => {
  const s = await requireSession();
  const id = new URL(req.url).pathname.split('/').pop()!;
  const ws = await requireWorkspace(s, id);
  return Response.json({ workspace: ws });
});

export const PATCH = handler(async (req) => {
  const s = await requireSession();
  const id = new URL(req.url).pathname.split('/').pop()!;
  const current = await requireWorkspace(s, id);
  const b = Patch.parse(await req.json());

  const patch: Record<string, unknown> = {};

  if (b.brandName) patch.brand_name = b.brandName.trim();

  // A domain that will not parse used to become `undefined`, which the db
  // client's `transform: { undefined: null }` turned into NULL against a NOT
  // NULL column — a 500 for what is plainly a typo. Reject it here with
  // something the user can act on, and never let the column go null.
  if (b.domain !== undefined) {
    const normalised = normaliseDomain(b.domain);
    if (!normalised) {
      throw new HttpError(400,
        'That does not look like a valid website address. Use a form like example.com, with no spaces.');
    }
    patch.domain = normalised;
  }

  if (b.sector) {
    const sec = sectorByLabel(b.sector);
    patch.sector = sec.label;
    patch.sector_term = sec.termTr;
  }
  if (b.country) {
    const c = COUNTRIES.find(x => x.name === b.country || x.nameTr === b.country) ?? COUNTRIES[0];
    patch.country = c.name; patch.country_code = c.code;
    patch.language = c.code === 'TR' ? 'tr' : 'en';
    if (patch.sector) patch.sector_term = c.code === 'TR' ? sectorByLabel(b.sector!).termTr : sectorByLabel(b.sector!).termEn;
  }
  if (b.city !== undefined) patch.city = b.city?.trim() || null;
  if (b.description !== undefined) patch.description = b.description?.trim() || null;
  if (b.aliases) patch.aliases = b.aliases;

  /* ------------------------------------------------------------------ */
  /* Identity guard                                                      */
  /* ------------------------------------------------------------------ */

  // Everything measured — answers, mentions, ranks, daily scores — hangs off
  // workspace_id, not off the brand name. Renaming a workspace that already
  // holds answers therefore re-attributes one company's history to another:
  // the score, the share of voice and the competitor table all keep their
  // numbers and quietly change whose numbers they are.
  //
  // This is the trap a Trial account walks into, because Trial allows one
  // workspace and renaming looks like the only way to measure a second brand.
  // Refuse by default and name the alternative, rather than doing the
  // destructive thing silently and reporting success.
  const renaming = patch.brand_name !== undefined && patch.brand_name !== current.brand_name;
  const redomaining = patch.domain !== undefined && patch.domain !== current.domain;

  if (renaming || redomaining) {
    const [{ n: answers }] = await sql`
      select count(*)::int as n from answer_runs where workspace_id = ${id}`;

    if (answers > 0 && !b.confirmRebrand) {
      throw new HttpError(409,
        `This brand already holds ${answers} stored answers for "${current.brand_name}". ` +
        `Renaming does not move that history — those scores stay here and become the new brand's scores. ` +
        `To measure a different brand, add a separate one instead. ` +
        `Continue only if "${current.brand_name}" itself changed its name or address.`);
    }

    // Aliases are what a scan matches a brand against. Leaving the previous
    // brand's variants in place after a rename means the new brand goes
    // unrecognised while the old one is still matched — the measurement keeps
    // running and keeps being wrong, which is worse than failing outright.
    if (!b.aliases) {
      const name = (patch.brand_name as string) ?? current.brand_name;
      const domain = (patch.domain as string) ?? current.domain;
      patch.aliases = buildAliases({ name, domain }).filter(a => a !== name);
    }
  }

  if (!Object.keys(patch).length) return Response.json({ ok: true, unchanged: true });

  const [ws] = await sql`update workspaces set ${sql(patch)} where id = ${id} returning *`;
  return Response.json({ workspace: ws, rebranded: renaming || redomaining });
});
