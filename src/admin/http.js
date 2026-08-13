export const ADMIN_COOKIE_NAME = 'zhenduan_admin';

export function applyAdminHeaders(res) {
  res.setHeader?.('Cache-Control', 'no-store');
  res.setHeader?.('X-Robots-Tag', 'noindex, nofollow');
}

export function readCookie(req, name) {
  const header = String(req?.headers?.cookie || '');
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ''; }
  }
  return '';
}

export function adminClientIdentity(req) {
  const raw = req?.headers?.['x-vercel-forwarded-for'] || req?.headers?.['x-forwarded-for'] || '';
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value).split(',')[0].trim().slice(0, 80);
}
