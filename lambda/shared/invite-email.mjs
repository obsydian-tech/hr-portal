/**
 * ONB-18: the invite email, one builder for createEmployee and resendInvite. Imports no AWS package.
 */
const SA_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric' });
export function saDate(d) { return SA_DATE.format(new Date(d)).replace('Sept', 'Sep'); }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function footerText(c, w) {
  return `Sent by ${w.hr}, HR at ${c}, on ${w.sent}. The link works once and expires on ${w.expires}. If it has expired, ask ${w.hrFirst} for a new one.`;
}
function leadText(c, w) {
  return `Hi ${w.first}. ${c} uses Naleko People for new employees. Set your password, then upload your ID and bank letter.`;
}

export function inviteEmail({ company, firstName, hrName, link, sentAt, expiresAt }) {
  const w = { first: firstName, hr: hrName, hrFirst: String(hrName).split(' ')[0], link, sent: saDate(sentAt), expires: saDate(expiresAt) };
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${esc(company)}</title></head>
<body style="margin:0;padding:0;background:#f7f3ec;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;"><tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;"><tr><td style="padding:24px;">
<h1 style="margin:0 0 12px;font-size:24px;color:#1a1a2e;">Get ready for your first day</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#333;">${esc(leadText(company, w))}</p>
<p style="margin:0 0 24px;"><a href="${esc(w.link)}" style="display:inline-block;background:#6d4aff;color:#fff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 28px;line-height:20px;border-radius:8px;">Set your password</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#666;">${esc(footerText(company, w))}</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `Get ready for your first day

${leadText(company, w)}

Set your password:
${w.link}

${footerText(company, w)}
`;
  return { subject: `${company}: set your password for Naleko People`, html, text };
}
