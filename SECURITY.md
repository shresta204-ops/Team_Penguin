# Security and guardrails

TraceLens holds API keys and can write to GitHub, so it is built to be safe by default. Each guardrail below is enforced in code and covered by tests in `server/test/`.

## AI guardrails (trusting the output)

| Risk | Guardrail | Where |
|---|---|---|
| Gemma cites a file that does not exist | Evidence for files that were not fetched is dropped, and the UI shows how many were dropped | `ground()` in `server/pipeline.js` |
| Gemma invents line numbers | Lines are clamped to the real file | `ground()` |
| Gemma invents code | Code snippets always come from the fetched file, never from model output | `ground()` |
| Gemma proposes a bad patch | A patch is kept only if its "before" line exists word-for-word. The repo is re-checked before a pull request is opened | `groundPatch()`, `openFixPullRequest()` |
| Weak evidence presented as fact | With no surviving evidence, confidence is forced to `low` | `ground()` |
| Guessing from an unclear screenshot | Gemma must set `enough_info: false`, and TraceLens asks the reporter instead of diagnosing | `server/prompts.js` |
| Prompt injection in the issue text ("ignore previous instructions…") | Issue text, screenshot and code are framed as untrusted data, and the model is told never to follow instructions inside them. Its output is grounded anyway | `SYSTEM` in `server/prompts.js` |
| Broken model JSON | Code fences are stripped, then one retry, then a clear error | `server/gemma.js` |

## Human in the loop

- Nothing is posted to GitHub until the maintainer clicks **Post to GitHub**. The comment is an editable draft.
- Fix pull requests are only opened on click and are never merged by TraceLens. If opening one fails, the new branch is deleted.
- Labels: only labels that already exist on the repo are applied. `bug` and `good first issue` are the only labels TraceLens creates. At most 10 labels, 50 characters each.

## Server security

| Threat | Guardrail |
|---|---|
| Leaked keys | Keys live only in `server/.env` (gitignored) or the host's secret store. The browser only calls `/api/*`, and the Settings page shows whether a key is set, never its value |
| SSRF (making the server fetch internal URLs) | Screenshot downloads are HTTPS only, limited to GitHub and imgur image hosts, and every redirect hop is re-checked. The GitHub token is sent only to `github.com`. Images over 10 MB are refused |
| Malicious uploads | Only PNG, JPEG, WebP and GIF, up to 10 MB. Request bodies are capped at 15 MB |
| CSRF | State-changing `/api` requests from another site's page are rejected (Origin check). Session cookies are `HttpOnly` and `SameSite=Lax`, and `Secure` on HTTPS |
| Abuse and quota drain | Per-IP rate limits: 8 triages, 10 GitHub writes, 20 sign-in requests and 120 API calls per minute |
| Clickjacking, XSS, sniffing | `Content-Security-Policy` (scripts only from this site), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, and HSTS on HTTPS. The comment preview is sanitized with DOMPurify |
| Shared-token misuse on a public server | `REQUIRE_SIGN_IN=true` makes visitors sign in with GitHub and act as themselves. The server's `GITHUB_TOKEN` is then never used. `ALLOWED_GITHUB_USERS` can restrict who may sign in |
| OAuth login tampering | A random `state` is checked against a short-lived cookie. Sessions are random 192-bit ids that expire after 7 days |
| Oversized comments | Capped at GitHub's 65,000-character limit |

## Least privilege

- **Local use:** a fine-grained token for one repo only, with **Issues: Read and write** and **Contents: Read-only**. Add **Contents: write** and **Pull requests: write** only if you want the "open pull request with this fix" button.
- **Deployed:** no shared token. Visitors sign in with GitHub (OAuth scope `public_repo`).

## Known limits

- Sessions, the rate-limit counters and the Gemma cache are in memory, so a restart clears them. Run one instance, or move them to Redis before scaling out.
- Saved results in `saved/` hold full triage results, including screenshots. They are gitignored; do not deploy them to a public server.

## Reporting a vulnerability

Please do not open a public issue. Email the maintainers through the contact on the [Team_Penguin repository](https://github.com/shresta204-ops/Team_Penguin) profile, with steps to reproduce.
