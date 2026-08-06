/**
 * mailer.ts — transactional email.
 *
 * Deliberately tiny and pluggable. Password reset is the only thing that needs
 * it today, and requiring a full email stack to launch would be the wrong
 * trade. If no provider is configured the caller is told so explicitly rather
 * than the message vanishing silently — a reset that appears to work but never
 * arrives is worse than one that refuses up front.
 */

export const mailerConfigured = () => !!process.env.RESEND_API_KEY;

export async function sendMail(to: string, subject: string, html: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('No email provider configured');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'YANKI <onboarding@resend.dev>',
      to: [to], subject, html, text,
    }),
  });
  if (!res.ok) throw new Error(`Email provider returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
