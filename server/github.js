// GitHub REST helpers. Only the server talks to GitHub.
import { httpError } from './gemma.js';

const API = 'https://api.github.com';

export function parseIssueUrl(url) {
  const m = String(url || '').trim().match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/i);
  if (!m) {
    throw httpError(400, 'That is not a GitHub issue link. Paste a link like https://github.com/owner/repo/issues/12.');
  }
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

function token() {
  if (!process.env.GITHUB_TOKEN) {
    throw httpError(500, 'Missing GitHub token. Add GITHUB_TOKEN to server/.env and restart the server.');
  }
  return process.env.GITHUB_TOKEN;
}

async function gh(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'TraceLens',
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw await ghError(res);
  return raw ? res.text() : res.json();
}

async function ghError(res) {
  const text = await res.text().catch(() => '');
  if ((res.status === 403 || res.status === 429) && (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(text))) {
    return httpError(429, 'GitHub API rate limit reached. Wait a few minutes and try again.');
  }
  if (res.status === 401) return httpError(401, 'GitHub rejected the token. Check GITHUB_TOKEN in server/.env.');
  if (res.status === 404) return httpError(404, 'Repo or issue not found, or the token has no access to it. Check the link and the token permissions.');
  if (res.status === 403) return httpError(403, 'The GitHub token lacks permission for this. It needs Issues read/write and Contents read on this repo.');
  return httpError(502, `GitHub API error ${res.status}: ${text.slice(0, 160)}`);
}

export async function getIssue({ owner, repo, number }) {
  const issue = await gh(`/repos/${owner}/${repo}/issues/${number}`);
  return {
    title: issue.title,
    body: issue.body || '',
    url: issue.html_url,
    number: issue.number,
    labels: issue.labels.map((l) => (typeof l === 'string' ? l : l.name)),
  };
}

// First image in the issue body, from markdown ![](...) or <img src="...">.
export function findImageUrl(body) {
  const md = body.match(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/);
  const html = body.match(/<img[^>]+src=["']([^"']+)["']/i);
  const found = [md && { url: md[1], at: md.index }, html && { url: html[1], at: html.index }].filter(Boolean);
  found.sort((a, b) => a.at - b.at);
  return found[0]?.url || null;
}

// Downloads a screenshot as base64. GitHub user-attachments need the token and redirect to a signed URL.
// Returns null on failure so the caller can offer manual upload.
export async function downloadImage(url) {
  const tryFetch = async (headers) => {
    const res = await fetch(url, { headers: { 'User-Agent': 'TraceLens', ...headers }, redirect: 'follow' });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0];
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return { mimeType: type, data: buf.toString('base64') };
  };
  try {
    const isGithub = /(^|\.)github(usercontent)?\.com$/.test(new URL(url).hostname);
    return (isGithub && (await tryFetch({ Authorization: `Bearer ${token()}` }))) || (await tryFetch({}));
  } catch {
    return null;
  }
}

export async function getRepoTree({ owner, repo }) {
  const meta = await gh(`/repos/${owner}/${repo}`);
  const branch = meta.default_branch;
  const tree = await gh(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  return { branch, paths: tree.tree.filter((t) => t.type === 'blob').map((t) => t.path) };
}

export function getFile({ owner, repo }, branch, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return gh(`/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`, { raw: true });
}

// Issues in the same repo whose title or body mention any of the terms.
export async function searchIssues({ owner, repo }, terms) {
  const quoted = terms.map((t) => `"${String(t).replace(/"/g, '')}"`).join(' OR ');
  const q = `repo:${owner}/${repo} is:issue ${quoted}`;
  const res = await gh(`/search/issues?per_page=5&q=${encodeURIComponent(q)}`);
  return res.items.map((i) => ({ number: i.number, title: i.title, url: i.html_url, state: i.state }));
}

export async function postComment({ owner, repo, number }, body) {
  const res = await gh(`/repos/${owner}/${repo}/issues/${number}/comments`, { method: 'POST', body: { body } });
  return res.html_url;
}

// Adds labels that already exist on the repo. Only "bug" and "good first issue" are created if missing.
export async function addLabels({ owner, repo, number }, labels) {
  if (!labels?.length) return [];
  const existing = await gh(`/repos/${owner}/${repo}/labels?per_page=100`);
  const byLower = new Map(existing.map((l) => [l.name.toLowerCase(), l.name]));
  const creatable = { 'good first issue': '7057ff', bug: 'd73a4a' };
  const apply = [];
  for (const label of labels) {
    const key = label.toLowerCase();
    if (byLower.has(key)) apply.push(byLower.get(key));
    else if (creatable[key]) {
      await gh(`/repos/${owner}/${repo}/labels`, { method: 'POST', body: { name: key, color: creatable[key] } });
      apply.push(key);
    }
  }
  if (apply.length) {
    await gh(`/repos/${owner}/${repo}/issues/${number}/labels`, { method: 'POST', body: { labels: apply } });
  }
  return apply;
}
