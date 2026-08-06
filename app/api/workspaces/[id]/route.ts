import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler } from '@/lib/auth';
import { sectorByLabel, normaliseDomain, COUNTRIES } from '@/lib/sectors';

export const dynamic = 'force-dynamic';

const Patch = z.object({
  brandName: z.string().min(2).max(120).optional(),
  domain: z.string().max(200).optional(),
  sector: z.string().max(80).optional(),
  country: z.string().max(40).optional(),
  city: z.string().max(80).nullable().optional(),
  description: z.string().max(1200).nullable().optional(),
  aliases: z.array(z.string().max(80)).max(30).optional(),
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
  await requireWorkspace(s, id);
  const b = Patch.parse(await req.json());

  const patch: Record<string, unknown> = {};
  if (b.brandName) patch.brand_name = b.brandName.trim();
  if (b.domain) patch.domain = normaliseDomain(b.domain) || undefined;
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

  if (!Object.keys(patch).length) return Response.json({ ok: true, unchanged: true });

  const [ws] = await sql`update workspaces set ${sql(patch)} where id = ${id} returning *`;
  return Response.json({ workspace: ws });
});
