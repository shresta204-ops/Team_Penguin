// Express routes: /api/health, /api/triage, /api/post
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, httpError } from './gemma.js';
import { triage } from './pipeline.js';
import { parseIssueUrl, postComment, addLabels, listIssues, parseRepo } from './github.js';
import { authRouter, sessionToken } from './auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAVED_DIR = path.join(here, '..', 'saved');
const CLIENT_DIST = path.join(here, '..', 'client', 'dist');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use('/api', sessionToken); // GitHub calls use the signed-in user's token when there is one
app.use('/api/auth', authRouter);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    // Which keys are set (never their values), for the Settings page.
    setup: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      githubToken: Boolean(process.env.GITHUB_TOKEN),
      oauth: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    },
  });
});

// Issue inbox: open issues in a repo, screenshot issues first. Query: ?repo=owner/repo
app.get('/api/issues', async (req, res) => {
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
app.post('/api/triage', async (req, res) => {
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
app.post('/api/post', async (req, res) => {
  try {
    const { issueUrl, comment, labels } = req.body || {};
    const ref = parseIssueUrl(issueUrl);
    if (!comment || !String(comment).trim()) throw httpError(400, 'The comment is empty. Write or restore the draft before posting.');
    const commentUrl = await postComment(ref, String(comment));
    let applied = [];
    let labelError = null;
    try {
      applied = await addLabels(ref, Array.isArray(labels) ? labels : []);
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
