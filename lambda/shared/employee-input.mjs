/** ONB-03: what createEmployee accepts. Every problem is named at once; nothing is written when there is one. */

const REQUIRED = ['first_name', 'last_name', 'email', 'phone', 'department'];
const NAME_FIELDS = ['first_name', 'middle_name', 'last_name', 'department', 'job_title'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function realDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!m && realDate(+m[1], +m[2], +m[3]);
}

export function validSaId(id) {
  if (!/^\d{13}$/.test(id)) return false;
  const yy = +id.slice(0, 2), mm = +id.slice(2, 4), dd = +id.slice(4, 6);
  if (!realDate(1900 + yy, mm, dd) && !realDate(2000 + yy, mm, dd)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let n = +id[12 - i];
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

export function validateEmployee(body) {
  const problems = {};
  const missing = [];
  const clean = {};
  for (const f of REQUIRED) {
    const v = body[f];
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) { missing.push(f); problems[f] = 'This is required'; }
  }
  for (const f of NAME_FIELDS) {
    const v = body[f];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string') problems[f] ??= 'Use words';
    else if (v.length > 100) problems[f] ??= 'Use 100 characters or fewer';
  }
  const typedEmail = typeof body.email === 'string' ? body.email.trim() : '';
  if (typeof body.email === 'string' && typedEmail) {
    if (!EMAIL.test(typedEmail)) problems.email = 'Check the email address';
    else clean.email = typedEmail.toLowerCase();
  } else if (body.email !== undefined && body.email !== null && typeof body.email !== 'string') problems.email = 'Check the email address';
  if (body.phone !== undefined && body.phone !== null && body.phone !== '') {
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const digits = phone.replace(/\D/g, '').length;
    if (!/^\+?[\d ]+$/.test(phone) || digits < 9 || digits > 15) problems.phone = 'Use numbers and spaces only, like 081 234 5678.';
  }
  for (const f of ['planned_start_date', 'offer_accept_date']) {
    const v = body[f];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || !isoDate(v)) problems[f] = 'Use a real date, like 2026-12-01';
  }
  if (body.id_number !== undefined && body.id_number !== null && body.id_number !== '') {
    if (typeof body.id_number !== 'string' || !validSaId(body.id_number)) problems.id_number = 'Check the ID number. It has 13 digits.';
  }
  return Object.keys(problems).length ? { problems, missing, typedEmail } : { clean, typedEmail };
}
