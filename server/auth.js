// "Sign in with GitHub" (OAuth App web flow). Sessions live in memory; restart signs everyone out.
import crypto from 'node:crypto';
import { Router } from 'express';
import { withToken } from './github.js';
import { isHttps } from './security.js';

const sessions = new Map(); // session id -> { token, login, avatarUrl, expiresAt }
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const appUrl = () => (process.env.APP_URL || 'http://localhost:8787').replace(/\/$/, '');
const configured = () => Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, maxAgeSec) {
  const secure = isHttps() ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}

function session(req) {
  const id = cookies(req).tl_session;
  const s = sessions.get(id);
  if (s && s.expiresAt <= Date.now()) { sessions.delete(id); return null; }
  return s || null;
}

// Optional allowlist: ALLOWED_GITHUB_USERS=alice,bob (empty = anyone may sign in).
function userAllowed(login) {
  const list = String(process.env.ALLOWED_GITHUB_USERS || '').split(',').map((u) => u.trim().toLowerCase()).filter(Boolean);
  return !list.length || list.includes(String(login).toLowerCase());
}

// Runs every /api request with the signed-in user's token (falls back to GITHUB_TOKEN).
export function sessionToken(req, res, next) {
  const s = session(req);
  req.githubUser = s?.login || null;
  withToken(s?.token, next);
}

export const authRouter = Router();

authRouter.get('/login', (req, res) => {
  if (!configured()) {
    return res.status(500).json({ error: 'GitHub sign-in is not set up. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to server/.env and restart the server.' });
  }
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'tl_oauth_state', state, 600);
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: `${appUrl()}/api/auth/callback`,
    scope: 'public_repo',
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

authRouter.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== cookies(req).tl_oauth_state) {
    return res.status(400).send('Sign-in failed: the login link expired or was tampered with. Go back and click "Sign in with GitHub" again.');
  }
  setCookie(res, 'tl_oauth_state', '', 0);
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${appUrl()}/api/auth/callback`,
      }),
    });
    const { access_token: token, error_description } = await tokenRes.json();
    if (!token) throw new Error(error_description || 'no access token returned');

    const user = await (await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TraceLens' },
    })).json();

    if (!userAllowed(user.login)) {
      return res.status(403).send(`Sign-in refused: @${user.login} is not on this server's ALLOWED_GITHUB_USERS list.`);
    }
    const id = crypto.randomBytes(24).toString('hex');
    sessions.set(id, { token, login: user.login, avatarUrl: user.avatar_url, expiresAt: Date.now() + SESSION_MS });
    setCookie(res, 'tl_session', id, 60 * 60 * 24 * 7);
    res.redirect(`${appUrl()}/`);
  } catch (err) {
    res.status(502).send(`Sign-in failed: ${String(err.message).slice(0, 200)}. Check GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in server/.env.`);
  }
});

authRouter.get('/me', (req, res) => {
  const s = session(req);
  res.json({ signedIn: Boolean(s), login: s?.login || null, avatarUrl: s?.avatarUrl || null, oauthConfigured: configured() });
});

authRouter.post('/logout', (req, res) => {
  sessions.delete(cookies(req).tl_session);
  setCookie(res, 'tl_session', '', 0);
  res.json({ ok: true });
});
