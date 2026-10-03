import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedImageUrl, checkUpload, rateLimit, sameOriginOnly, requireSignIn } from '../security.js';

test('screenshot downloads only go to HTTPS GitHub/imgur image hosts (SSRF guard)', () => {
  for (const ok of [
    'https://github.com/user-attachments/assets/abc',
    'https://private-user-images.githubusercontent.com/1/2.png?jwt=x',
    'https://raw.githubusercontent.com/o/r/main/a.png',
    'https://i.imgur.com/a.png',
  ]) assert.ok(isAllowedImageUrl(ok), ok);
  for (const bad of [
    'http://github.com/a.png',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/a.png',
    'https://127.0.0.1/a.png',
    'https://github.com.evil.com/a.png',
    'https://evilgithub.com/a.png',
    'https://github.com:8443/a.png',
    'file:///etc/passwd',
    'not a url',
  ]) assert.equal(isAllowedImageUrl(bad), false, bad);
});

test('manual uploads must be an image type and at most 10 MB', () => {
  assert.doesNotThrow(() => checkUpload('aGVsbG8=', 'image/png'));
  assert.throws(() => checkUpload('aGVsbG8=', 'image/svg+xml'), (e) => e.status === 415);
  assert.throws(() => checkUpload('a'.repeat(15 * 1024 * 1024), 'image/jpeg'), (e) => e.status === 413);
});

function run(mw, req) {
  let status = 200, body = null, nexted = false;
  const res = { set() { return res; }, status(c) { status = c; return res; }, json(b) { body = b; return res; } };
  mw(req, res, () => { nexted = true; });
  return { status, body, nexted };
}

test('rate limit blocks after max requests per window', () => {
  const mw = rateLimit({ max: 2, windowMs: 60_000 });
  const req = { ip: '1.2.3.4' };
  assert.ok(run(mw, req).nexted);
  assert.ok(run(mw, req).nexted);
  const third = run(mw, req);
  assert.equal(third.status, 429);
  assert.ok(run(mw, { ip: '5.6.7.8' }).nexted, 'other clients are unaffected');
});

test('cross-site POSTs are rejected (CSRF guard)', () => {
  const req = (origin) => ({ method: 'POST', protocol: 'http', get: (h) => ({ origin, host: 'localhost:8787' })[h] });
  assert.ok(run(sameOriginOnly, req('http://localhost:8787')).nexted);
  assert.equal(run(sameOriginOnly, req('https://evil.example')).status, 403);
  assert.ok(run(sameOriginOnly, { method: 'GET', get: () => 'https://evil.example' }).nexted, 'reads are allowed');
});

test('REQUIRE_SIGN_IN blocks anonymous GitHub actions but allows saved replays', () => {
  process.env.REQUIRE_SIGN_IN = 'true';
  try {
    assert.equal(run(requireSignIn, { body: {} }).status, 401);
    assert.ok(run(requireSignIn, { body: {}, githubUser: 'octocat' }).nexted);
    assert.ok(run(requireSignIn, { body: { saved: 'x' } }).nexted);
  } finally {
    delete process.env.REQUIRE_SIGN_IN;
  }
  assert.ok(run(requireSignIn, { body: {} }).nexted, 'off by default for local use');
});
