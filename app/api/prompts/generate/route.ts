import { z } from 'zod';
import { requireSession, requireWorkspace, handler } from '@/lib/auth';
import { generatePrompts, checkMix, type Intent } from '@/lib/prompts';
import { COUNTRIES } from '@/lib/sectors';

export const dynamic = 'force-dynamic';

const Body = z.object({ workspaceId: z.string().uuid() });

/**
 * Generates the starter prompt set from the workspace's own fields. Kept
 * server-side so the same logic produces the set during onboarding and when
 * the user later hits "Regenerate".
 */
export const POST = handler(async (req) => {
  const s = await requireSession();
  const { workspaceId } = Body.parse(await req.json());
  const ws = await requireWorkspace(s, workspaceId);

  // Prompts are written in the market's language, so the country name must be
  // localised too — "Turkey'deki" is not a Turkish sentence.
  const c = COUNTRIES.find(x => x.code === ws.country_code);
  const countryName = ws.language === 'tr' ? (c?.nameTr ?? ws.country) : (c?.name ?? ws.country);

  const prompts = generatePrompts({
    brandName: ws.brand_name,
    sector: ws.sector,
    sectorTerm: ws.sector_term,
    country: countryName,
    city: ws.city,
    language: ws.language === 'tr' ? 'tr' : 'en',
  });

  return Response.json({
    prompts,
    mix: checkMix(prompts as { intent: Intent }[]),
  });
});
