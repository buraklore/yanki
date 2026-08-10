import type { DigestSummary } from './digest';

/**
 * digest-email.ts — the weekly message.
 *
 * The subject line carries the news on its own, because most people decide
 * from the inbox list whether to open. "Bynogame: 3 kayıp" gets opened;
 * "Haftalık raporunuz hazır" does not.
 *
 * Inline styles only: every serious mail client strips <style> blocks.
 */

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function digestSubject(d: DigestSummary): string {
  const losses = d.urgent.length;
  const delta = d.score.delta;
  if (losses && delta !== null && delta < 0) {
    return `${d.brand}: skor ${delta.toFixed(1)} puan düştü, ${losses} uyarı`;
  }
  if (losses) return `${d.brand}: ${losses} görünürlük uyarısı`;
  if (delta !== null && delta > 1) return `${d.brand}: skor ${delta.toFixed(1)} puan yükseldi`;
  return `${d.brand}: haftalık AI görünürlük özeti`;
}

export function digestHtml(d: DigestSummary, appUrl: string): string {
  const delta = d.score.delta;
  const arrow = delta === null ? '' : delta > 0 ? '▲' : delta < 0 ? '▼' : '■';
  const colour = delta === null ? '#94A3B8' : delta > 0 ? '#16A34A' : delta < 0 ? '#DC2626' : '#94A3B8';

  const row = (e: { detail: string; promptText?: string; severity: number }) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #E2E8F0">
      <div style="font-size:14px;color:#0F172A">${e.severity >= 3 ? '⚠ ' : ''}${esc(e.detail)}</div>
      ${e.promptText ? `<div style="font-size:12px;color:#64748B;margin-top:3px">“${esc(e.promptText)}”</div>` : ''}
    </td></tr>`;

  return `<!doctype html><html><body style="margin:0;background:#F1F5F9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">

  <tr><td style="padding:24px 28px;background:#0F172A">
    <div style="color:#fff;font-size:17px;font-weight:700;letter-spacing:-.2px">YANKI</div>
    <div style="color:#94A3B8;font-size:12.5px;margin-top:3px">
      ${esc(d.periodStart)} – ${esc(d.periodEnd)} · ${esc(d.brand)}</div>
  </td></tr>

  <tr><td style="padding:26px 28px 6px">
    <div style="font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:.6px">Görünürlük skoru</div>
    <div style="font-size:38px;font-weight:700;color:#0F172A;line-height:1.1;margin-top:6px">
      ${d.score.now === null ? '—' : d.score.now.toFixed(1)}
      ${delta === null ? '' : `<span style="font-size:16px;font-weight:600;color:${colour};margin-left:8px">${arrow} ${Math.abs(delta).toFixed(1)}</span>`}
    </div>
    <div style="font-size:12.5px;color:#64748B;margin-top:6px">
      ${d.counts.checks} kontrol · ${d.counts.mentions} bahis · ${d.counts.citations} atıf</div>
  </td></tr>

  ${d.urgent.length ? `
  <tr><td style="padding:22px 28px 0">
    <div style="font-size:14px;font-weight:700;color:#DC2626;margin-bottom:4px">Dikkat gerektirenler</div>
    <table width="100%" cellpadding="0" cellspacing="0">${d.urgent.map(row).join('')}</table>
  </td></tr>` : `
  <tr><td style="padding:22px 28px 0">
    <div style="font-size:14px;color:#16A34A;font-weight:600">Bu hafta kayıp yok.</div>
    <div style="font-size:13px;color:#64748B;margin-top:4px">
      Skorunuzu düşüren bir değişiklik tespit edilmedi.</div>
  </td></tr>`}

  ${d.wins.length ? `
  <tr><td style="padding:20px 28px 0">
    <div style="font-size:14px;font-weight:700;color:#16A34A;margin-bottom:4px">Kazanımlar</div>
    <table width="100%" cellpadding="0" cellspacing="0">${d.wins.map(row).join('')}</table>
  </td></tr>` : ''}

  ${d.rivals.length ? `
  <tr><td style="padding:20px 28px 0">
    <div style="font-size:14px;font-weight:700;color:#0F172A;margin-bottom:8px">Rakipler</div>
    ${d.rivals.map(r => `
      <div style="font-size:13.5px;color:#334155;padding:6px 0;border-bottom:1px solid #F1F5F9">
        ${esc(r.name)}<span style="float:right;color:#64748B">${r.mentions} bahis</span></div>`).join('')}
  </td></tr>` : ''}

  ${d.contentTargets.length ? `
  <tr><td style="padding:20px 28px 0">
    <div style="font-size:14px;font-weight:700;color:#0F172A;margin-bottom:4px">Bu ay ne yazmalısınız</div>
    <div style="font-size:12.5px;color:#64748B;margin-bottom:8px">
      Kapsamanızın en düşük olduğu, hacmi en yüksek sorgular:</div>
    ${d.contentTargets.map(t => `
      <div style="font-size:13.5px;color:#334155;padding:7px 0;border-bottom:1px solid #F1F5F9">
        “${esc(t.text)}”
        <span style="float:right;color:#64748B">%${Math.round(t.coverage * 100)} kapsama</span></div>`).join('')}
  </td></tr>` : ''}

  <tr><td style="padding:26px 28px 30px" align="center">
    <a href="${esc(appUrl)}/app" style="display:inline-block;background:#2563EB;color:#fff;
       text-decoration:none;font-size:14px;font-weight:600;padding:12px 26px;border-radius:9px">
       Panelde ayrıntıları görün</a>
  </td></tr>

  <tr><td style="padding:16px 28px;background:#F8FAFC;border-top:1px solid #E2E8F0">
    <div style="font-size:11.5px;color:#94A3B8;line-height:1.6">
      Bu özet haftalık gönderilir. Ayarlar → Profil bölümünden kapatabilirsiniz.<br>
      YANKI — markanızın yapay zekadaki yankısı.</div>
  </td></tr>

</table></td></tr></table></body></html>`;
}

export function digestText(d: DigestSummary, appUrl: string): string {
  const lines = [
    `${d.brand} — AI görünürlük özeti (${d.periodStart} – ${d.periodEnd})`,
    '',
    `Skor: ${d.score.now === null ? '—' : d.score.now.toFixed(1)}` +
      (d.score.delta === null ? '' : ` (${d.score.delta > 0 ? '+' : ''}${d.score.delta.toFixed(1)})`),
    `${d.counts.checks} kontrol · ${d.counts.mentions} bahis · ${d.counts.citations} atıf`,
    '',
  ];
  if (d.urgent.length) {
    lines.push('DİKKAT GEREKTİRENLER');
    d.urgent.forEach(e => lines.push(`- ${e.detail}${e.promptText ? ` ("${e.promptText}")` : ''}`));
    lines.push('');
  } else {
    lines.push('Bu hafta kayıp tespit edilmedi.', '');
  }
  if (d.contentTargets.length) {
    lines.push('BU AY NE YAZMALISINIZ');
    d.contentTargets.forEach(t => lines.push(`- "${t.text}" (%${Math.round(t.coverage * 100)} kapsama)`));
    lines.push('');
  }
  lines.push(`${appUrl}/app`);
  return lines.join('\n');
}
