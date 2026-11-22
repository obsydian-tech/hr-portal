/**
 * ONB-21: the reminder email, one pure builder (no AWS import). Every word the person reads is in this file and
 * nowhere else. Same layout as the invite email. The link is exactly the one given, with nothing added to it.
 */
import { saDate } from './invite-email.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const BUTTON = 'Upload your documents';
const SIGNED = 'Naleko People';

/** { subject, html, text }. `dueIso` is a calendar date (YYYY-MM-DD); `typeNames` are the kit names, in list order. */
export function reminderEmail({ firstName, typeNames, dueIso, loginUrl }) {
  const date = saDate(`${dueIso}T12:00:00Z`);
  const heading = `Your documents are due on ${date}`;
  const lead = `Hi ${firstName}. Still to upload, due ${date}: ${typeNames.join(', ')}.`;
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#f7f3ec;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;"><tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;"><tr><td style="padding:24px;">
<h1 style="margin:0 0 12px;font-size:24px;color:#1a1a2e;">${esc(heading)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#333;">${esc(lead)}</p>
<p style="margin:0 0 24px;"><a href="${esc(loginUrl)}" style="display:inline-block;background:#6d4aff;color:#fff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 28px;line-height:20px;border-radius:8px;">${BUTTON}</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#666;">${SIGNED}</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${heading}

${lead}

Sign in to Naleko People to upload your documents: ${loginUrl}

${SIGNED}
`;
  return { subject: heading, html, text };
}
