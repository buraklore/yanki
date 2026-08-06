import { destroySession, handler } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export const POST = handler(async () => {
  await destroySession();
  return Response.json({ ok: true });
});
