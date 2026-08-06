import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, handler, HttpError } from '@/lib/auth';
import { limits } from '@/lib/plans';
import { sectorByLabel, normaliseDomain, COUNTRIES } from '@/lib/sectors';
import { buildAliases } from '@/lib/entity';

export const dynamic = 'force-dynamic';

const Body = z.object({
  brandName: z.string().min(2).max(120),
  domain: z.string().min(3).max(200),
  sector: z.string().max(80).default('Diğer'),
  country: z.string().max(40).default('Turkey'),
  city: z.string().max(80).optional().nullable(),
  description: z.string().max(1200).optional().nullable(),
  aliases: z.array(z.string().max(80)).max(20).optional(),
});

export const GET = handler(async () => {
  const s = await requireSession();
  const rows = await sql`
    select w.*, (select count(*)::int from prompts p where p.workspace_id = w.id and p.active) as prompt_count,
           (select count(*)::int from competitors c where c.workspace_id = w.id and c.active) as competitor_count
      from workspaces w where w.org_id = ${s.orgId} order by w.created_at`;
  return Response.json({ workspaces: rows });
});

export const POST = handler(async (req) => {
  const s = await requireSession();
  const b = Body.parse(await req.json());

  const [{ count }] = await sql`select count(*)::int from workspaces where org_id = ${s.orgId}`;
  const cap = limits(s.plan).workspaces;
  if (count >= cap) throw new HttpError(402, `Your plan allows ${cap} workspace${cap > 1 ? 's' : ''}.`);

  const domain = normaliseDomain(b.domain);
  if (!domain) throw new HttpError(400, 'That does not look like a valid website address.');

  const sector = sectorByLabel(b.sector);
  const country = COUNTRIES.find(c => c.name === b.country || c.nameTr === b.country) ?? COUNTRIES[0];
  const lang = country.code === 'TR' ? 'tr' : 'en';

  // Variants are derived here, not in the browser, so every consumer of the
  // data (scan worker, exports, API clients) sees the same alias set.
  const aliases = b.aliases?.length
    ? b.aliases
    : buildAliases({ name: b.brandName, domain }).filter(a => a !== b.brandName);

  const [ws] = await sql`
    insert into workspaces (org_id, brand_name, domain, sector, sector_term, country, country_code,
                            language, city, description, aliases)
    values (${s.orgId}, ${b.brandName.trim()}, ${domain}, ${sector.label},
            ${lang === 'tr' ? sector.termTr : sector.termEn}, ${country.name}, ${country.code},
            ${lang}, ${b.city?.trim() || null}, ${b.description?.trim() || null}, ${aliases})
    returning *`;

  return Response.json({ workspace: ws });
});
