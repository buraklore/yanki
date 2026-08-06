import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/auth';
import { enforce, clientIp } from '@/lib/rate-limit';
import { sendMail, mailerConfigured } from '@/lib/mailer';

export const dynamic = 'force-dynamic';

const Body = z.object({ email: z.string().email() });

export const POST = handler(async (req) => {
  await enforce('login', clientIp(req));
  const { email } = Body.parse(await req.json());

  if (!mailerConfigured()) {
    throw new HttpError(503,
      'Password reset needs an email provider. Ask your administrator to set RESEND_API_KEY.');
  }

  const [user] = await sql`select id, email from users where email = ${email}`;

  // Always answer the same way. Telling the caller whether an address exists
  // turns this endpoint into an account-enumeration oracle.
  if (user) {
    const token = randomBytes(32).toString('base64url');
    await sql`
      insert into password_resets (token_hash, user_id, expires_at)
      values (${createHash('sha256').update(token).digest('hex')}, ${user.id}, now() + interval '1 hour')`;

    const base = process.env.APP_URL || new URL(req.url).origin;
    const link = `${base}/giris?reset=${token}`;
    await sendMail(user.email, 'YANKI — parola sıfırlama',
      `<p>Parolanızı sıfırlamak için bir saat içinde bu bağlantıyı kullanın:</p>
       <p><a href="${link}">${link}</a></p>
       <p>Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz; hesabınızda hiçbir şey değişmedi.</p>`,
      `Parolanızı sıfırlamak için bir saat içinde bu bağlantıyı kullanın: ${link}`);
  }

  return Response.json({ ok: true,
    message: 'If an account exists for that address, a reset link is on its way.' });
});
