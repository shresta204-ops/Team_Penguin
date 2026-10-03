// Guardrails for a server that holds API keys and can write to GitHub.
import { httpError } from './gemma.js';

// Security headers on every response (what helmet would set, without the dependency).
export function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://avatars.githubusercontent.com",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://github.com",
    ].join('; '),
  });
  if (isHttps()) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

// Fixed-window rate limit per client IP. Protects the Gemini quota and the GitHub token.
export function rateLimit({ windowMs = 60_000, max }) {
  const hits = new Map(); // ip -> { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests from this browser. Wait a minute and try again.' });
    }
    next();
  };
}

// CSRF guard: state-changing requests must come from this app's own pages.
export function sameOriginOnly(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.get('origin');
  if (!origin) return next(); // non-browser clients (curl, tests) send no Origin; cookies are SameSite=Lax anyway
  const allowed = new Set([`${req.protocol}://${req.get('host')}`, appOrigin()].filter(Boolean));
  if (!allowed.has(origin)) {
    return res.status(403).json({ error: 'Request blocked: it did not come from the TraceLens page.' });
  }
  next();
}

// With REQUIRE_SIGN_IN=true (recommended for any public deployment), GitHub actions need a signed-in user,
// and the server's own GITHUB_TOKEN is never used on a visitor's behalf.
export function requireSignIn(req, res, next) {
  if (process.env.REQUIRE_SIGN_IN !== 'true' || req.githubUser || req.body?.saved) return next();
  res.status(401).json({ error: 'Sign in with GitHub to use TraceLens on this server.' });
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Manual uploads: an allowed image type, at most 10 MB.
export function checkUpload(base64, mimeType) {
  if (!IMAGE_TYPES.has(mimeType)) throw httpError(415, 'Upload a PNG, JPEG, WebP or GIF screenshot.');
  const bytes = Math.floor((String(base64).length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) throw httpError(413, 'That screenshot is larger than 10 MB. Crop it or save it as JPEG.');
}

export function isImageType(type) {
  return IMAGE_TYPES.has(type);
}

// SSRF guard for screenshot downloads: HTTPS only, GitHub's image hosts (and imgur) only.
const IMAGE_HOSTS = ['github.com', 'githubusercontent.com', 'i.imgur.com'];
export function isAllowedImageUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:' || url.port) return false;
  const host = url.hostname.toLowerCase();
  return IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export function appOrigin() {
  try { return new URL(process.env.APP_URL).origin; } catch { return null; }
}

export function isHttps() {
  return String(process.env.APP_URL || '').startsWith('https://');
}
