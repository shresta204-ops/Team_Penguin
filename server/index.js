// Express routes: /api/health, /api/triage, /api/post
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, httpError } from './gemma.js';
import { triage } from './pipeline.js';
import { parseIssueUrl, postComment, addLabels, listIssues, parseRepo, openFixPullRequest } from './github.js';
import { authRouter, sessionToken } from './auth.js';
import { securityHeaders, rateLimit, sameOriginOnly, requireSignIn } from './security.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAVED_DIR = path.join(here, '..', 'saved');
const CLIENT_DIST = path.join(here, '..', 'client', 'dist');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1); // behind Render/Railway/Fly: real client IPs
app.use(securityHeaders);
app.use(express.json({ limit: '15mb' })); // a 10 MB screenshot as base64
app.use('/api', sameOriginOnly);
app.use('/api', rateLimit({ max: 120 })); // general ceiling per IP per minute
app.use('/api', sessionToken); // GitHub calls use the signed-in user's token when there is one
app.use('/api/auth', rateLimit({ max: 20 }), authRouter);

// Expensive or GitHub-writing routes get tighter limits (per IP per minute).
const gemmaLimit = rateLimit({ max: 8 });
const writeLimit = rateLimit({ max: 10 });

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    // Which keys are set (never their values), for the Settings page.
    setup: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      githubToken: Boolean(process.env.GITHUB_TOKEN),
      oauth: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      requireSignIn: process.env.REQUIRE_SIGN_IN === 'true',
    },
  });
});

// Issue inbox: open issues in a repo, screenshot issues first. Query: ?repo=owner/repo
app.get('/api/issues', requireSignIn, async (req, res) => {
  try {
    const ref = parseRepo(req.query.repo);
    const issues = await listIssues(ref);
    issues.sort((a, b) => Number(b.hasScreenshot) - Number(a.hasScreenshot) || b.number - a.number);
    res.json({ repo: `${ref.owner}/${ref.repo}`, issues });
  } catch (err) {
    res.status(err.expose ? err.status : 500).json(errorBody(err));
  }
});

// Body: { issueUrl } | { issueUrl, imageBase64, mimeType } | { issueUrl, saved: true } | { saved: "name" }
// With "Accept: application/x-ndjson" the route streams {stage} lines, then {result} or {error}.
app.post('/api/triage', gemmaLimit, requireSignIn, async (req, res) => {
  const stream = (req.get('accept') || '').includes('application/x-ndjson');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');
  if (stream) res.type('application/x-ndjson');

  try {
    const result = req.body?.saved
      ? await loadSaved(req.body)
      : await triage(req.body || {}, (stage) => stream && send({ stage }));
    if (!req.body?.saved) saveResult(result).catch(() => {});
    if (stream) { send({ result }); res.end(); } else res.json(result);
  } catch (err) {
    const error = errorBody(err);
    if (stream) { send({ error: error.error, needsUpload: error.needsUpload }); res.end(); }
    else res.status(err.expose ? err.status : 500).json(error);
  }
});

// Body: { issueUrl, comment, labels }
// Body: { issueUrl, patch: { file, line, before, after } } -> { url, number, branch }
// Needs a token with Contents: write and Pull requests: write. Only opens a PR; never merges.
app.post('/api/fix-pr', writeLimit, requireSignIn, async (req, res) => {
  try {
    const { issueUrl, patch } = req.body || {};
    const ref = parseIssueUrl(issueUrl);
    if (!patch?.file || !patch.line || typeof patch.before !== 'string' || typeof patch.after !== 'string') {
      throw httpError(400, 'No verified fix to apply. Only a diagnosis with a suggested change can open a pull request.');
    }
    res.json(await openFixPullRequest(ref, patch));
  } catch (err) {
    if (err.status === 403 || err.status === 404) {
      err.message = 'The GitHub token cannot create branches or pull requests here. Give it Contents: Read and write and Pull requests: Read and write, or sign in with GitHub.';
    }
    res.status(err.expose ? err.status : 500).json(errorBody(err));
  }
});

app.post('/api/post', writeLimit, requireSignIn, async (req, res) => {
  try {
    const { issueUrl, comment, labels } = req.body || {};
    const ref = parseIssueUrl(issueUrl);
    if (!comment || !String(comment).trim()) throw httpError(400, 'The comment is empty. Write or restore the draft before posting.');
    if (String(comment).length > 65_000) throw httpError(413, 'The comment is longer than GitHub allows (65,000 characters). Shorten it.');
    const cleanLabels = (Array.isArray(labels) ? labels : []).map(String).filter((l) => l.trim() && l.length <= 50).slice(0, 10);
    const commentUrl = await postComment(ref, String(comment));
    let applied = [];
    let labelError = null;
    try {
      applied = await addLabels(ref, cleanLabels);
    } catch (err) {
      labelError = `Comment posted, but labels were not applied: ${err.message}`;
    }
    res.json({ commentUrl, labels: applied, labelError });
  } catch (err) {
    res.status(err.expose ? err.status : 500).json(errorBody(err));
  }
});

// Serve the built client if it exists (npm run build in client/).
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

function errorBody(err) {
  if (!err.expose) console.error(err);
  return {
    error: err.expose ? err.message : `Unexpected server error: ${String(err.message).slice(0, 160)}. Check the server log.`,
    ...(err.needsUpload && { needsUpload: true }),
  };
}

// Saved results let you rehearse the demo without spending API quota.
function savedName({ issueUrl, saved }) {
  if (typeof saved === 'string') return saved.replace(/[^\w.-]/g, '');
  const { owner, repo, number } = parseIssueUrl(issueUrl);
  return `${owner}-${repo}-${number}`;
}

async function loadSaved(body) {
  const file = path.join(SAVED_DIR, `${savedName(body).replace(/\.json$/, '')}.json`);
  try {
    return { ...JSON.parse(await fs.readFile(file, 'utf8')), fromSaved: true };
  } catch {
    throw httpError(404, `No saved result found (${path.basename(file)}). Run a live triage once to create it.`);
  }
}

async function saveResult(result) {
  await fs.mkdir(SAVED_DIR, { recursive: true });
  await fs.writeFile(path.join(SAVED_DIR, `${savedName({ issueUrl: result.issue.url })}.json`), JSON.stringify(result, null, 2));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`TraceLens server on http://localhost:${port} (model: ${MODEL})`);
  if (!process.env.GEMINI_API_KEY) console.warn('Warning: GEMINI_API_KEY is not set in server/.env');
  if (!process.env.GITHUB_TOKEN) console.warn('Warning: GITHUB_TOKEN is not set in server/.env');
});
