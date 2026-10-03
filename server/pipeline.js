// The triage workflow: issue -> look -> search -> diagnose -> grounding -> draft comment.
import { askGemma, httpError, MODEL } from './gemma.js';
import { SYSTEM, lookPrompt, diagnosePrompt } from './prompts.js';
import { parseIssueUrl, getIssue, findImageUrl, downloadImage, searchIssues } from './github.js';
import { searchRepo, numberLines } from './search.js';
import { diagnosisComment, askReporterComment } from './comment.js';

const MAX_PROMPT_CHARS = 90_000;

// onStage(name) lets the route stream progress to the UI.
export async function triage({ issueUrl, imageBase64, mimeType }, onStage = () => {}) {
  const started = Date.now();
  const ref = parseIssueUrl(issueUrl);

  onStage('fetching');
  const issue = await getIssue(ref);
  const image = imageBase64 ? { mimeType: mimeType || 'image/png', data: stripDataUrl(imageBase64) } : await issueScreenshot(issue);
  const screenshot = `data:${image.mimeType};base64,${image.data}`;

  onStage('looking');
  const look = normalizeLook(await askGemma({ system: SYSTEM, prompt: lookPrompt(issue), images: [image] }));

  const base = {
    issue: { title: issue.title, url: issue.url, number: issue.number, body: bodyText(issue.body) },
    screenshot,
    look,
    model: MODEL,
    // Lets the maintainer switch to "ask the reporter" even when a diagnosis was made.
    askComment: askReporterComment({ look }),
  };

  if (!look.enough_info) {
    return {
      ...base,
      mode: 'ask_reporter',
      matches: [],
      diagnosis: null,
      comment: askReporterComment({ look }),
      labels: [],
      elapsedMs: Date.now() - started,
    };
  }

  onStage('searching');
  const [search, similar] = await Promise.all([searchRepo(ref, look), findSimilar(ref, look)]);

  onStage('diagnosing');
  let diagnosis;
  if (search.matches.length) {
    const files = fitToBudget(search.matches.map((m) => ({ path: m.file, lines: m.lines })));
    const raw = await askGemma({ system: SYSTEM, prompt: diagnosePrompt({ ...issue, look, files }), images: [image] });
    diagnosis = ground(normalizeDiagnosis(raw), search.files);
  } else {
    diagnosis = {
      root_cause: `None of the ${search.stats.fetched} fetched source files contain the on-screen text (${look.on_screen_text.join(', ') || 'none found'}).`,
      evidence: [],
      fix: 'Check whether this text comes from an API, a translation file or a dependency.',
      labels: ['bug'],
      difficulty: 'medium',
      confidence: 'low',
      dropped: 0,
    };
  }

  const labels = chooseLabels(diagnosis);
  return {
    ...base,
    mode: 'diagnosis',
    matches: search.matches,
    search: search.stats,
    similar,
    diagnosis,
    comment: diagnosisComment({ look, diagnosis, labels, similar }),
    labels,
    elapsedMs: Date.now() - started,
  };
}

async function issueScreenshot(issue) {
  const url = findImageUrl(issue.body);
  if (!url) {
    throw Object.assign(httpError(422, 'This issue has no screenshot in its description. Upload one manually below.'), { needsUpload: true });
  }
  const image = await downloadImage(url);
  if (!image) {
    throw Object.assign(httpError(422, 'Could not download the screenshot from the issue. Upload it manually below.'), { needsUpload: true });
  }
  return image;
}

// Grounding check: Gemma may only cite fetched files; code shown is always the real lines.
export function ground(diagnosis, files) {
  const evidence = [];
  let dropped = 0;
  for (const ev of diagnosis.evidence) {
    const path = normalizePath(ev.file);
    const text = files.get(path);
    if (text == null) { dropped++; continue; }
    const lines = numberLines(text).map((l) => l.text);
    const line = Math.min(Math.max(1, Math.round(Number(ev.line)) || 1), lines.length);
    if (evidence.some((e) => e.file === path && e.line === line)) continue;
    const from = Math.max(1, line - 2);
    const to = Math.min(lines.length, line + 2);
    const snippet = [];
    for (let n = from; n <= to; n++) snippet.push({ n, text: lines[n - 1] });
    // Note text comes from the model; code never does.
    evidence.push({ file: path, line, note: String(ev.note || '').slice(0, 400), snippet });
  }
  return {
    ...diagnosis,
    evidence,
    dropped,
    patch: groundPatch(diagnosis.patch, files),
    confidence: evidence.length ? diagnosis.confidence : 'low',
  };
}

// A suggested patch survives only if its "before" line really exists in a fetched file.
// "before" is then replaced by the real line; only "after" comes from the model.
export function groundPatch(patch, files) {
  if (!patch || typeof patch !== 'object' || !patch.before || !patch.after) return null;
  const path = normalizePath(patch.file || '');
  const text = files.get(path);
  if (text == null) return null;
  const lines = numberLines(text).map((l) => l.text);
  const want = String(patch.before).trim();
  const near = Math.round(Number(patch.line)) || 0;
  const candidates = lines.map((t, i) => i + 1).filter((n) => lines[n - 1].trim() === want);
  if (!candidates.length) return null;
  const line = candidates.reduce((best, n) => (Math.abs(n - near) < Math.abs(best - near) ? n : best));
  const before = lines[line - 1];
  const indent = before.match(/^\s*/)[0];
  const after = indent + String(patch.after).trim();
  if (after === before) return null;
  return { file: path, line, before, after };
}

// Other issues in the repo that mention the same on-screen text (possible duplicates).
async function findSimilar(ref, look) {
  const terms = look.on_screen_text.slice(0, 2);
  if (!terms.length) return [];
  try {
    const found = await searchIssues(ref, terms);
    return found.filter((i) => i.number !== ref.number).slice(0, 3);
  } catch {
    return []; // search is a nice-to-have; never fail triage over it
  }
}

function chooseLabels(diagnosis) {
  const labels = new Set(['bug']);
  for (const l of diagnosis.labels) {
    const key = l.toLowerCase();
    if (key !== 'good first issue') labels.add(key);
  }
  if (diagnosis.difficulty === 'easy' && diagnosis.confidence !== 'low') labels.add('good first issue');
  return [...labels].slice(0, 4);
}

function normalizeLook(raw) {
  const list = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return {
    enough_info: raw.enough_info === true || raw.enough_info === 'true',
    what_is_wrong: String(raw.what_is_wrong || ''),
    expected_result: String(raw.expected_result || ''),
    on_screen_text: list(raw.on_screen_text).slice(0, 8),
    keywords: list(raw.keywords).slice(0, 10),
    missing_details: list(raw.missing_details),
    problem_box: validBox(raw.problem_box),
  };
}

// [ymin, xmin, ymax, xmax] normalized to 0-1000, or null.
function validBox(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [y1, x1, y2, x2] = box.map(Number);
  if (![y1, x1, y2, x2].every((v) => Number.isFinite(v) && v >= 0 && v <= 1000)) return null;
  if (y2 - y1 < 5 || x2 - x1 < 5) return null;
  return [y1, x1, y2, x2];
}

function normalizeDiagnosis(raw) {
  const pick = (v, allowed, fallback) => (allowed.includes(String(v).toLowerCase()) ? String(v).toLowerCase() : fallback);
  return {
    root_cause: String(raw.root_cause || ''),
    evidence: Array.isArray(raw.evidence) ? raw.evidence.filter((e) => e && e.file).slice(0, 5) : [],
    fix: String(raw.fix || ''),
    labels: Array.isArray(raw.labels) ? raw.labels.map(String).filter((l) => l.length <= 50) : [],
    difficulty: pick(raw.difficulty, ['easy', 'medium', 'hard'], 'medium'),
    confidence: pick(raw.confidence, ['low', 'medium', 'high'], 'low'),
    patch: raw.patch && typeof raw.patch === 'object' ? raw.patch : null,
  };
}

// Keep the strongest files, in order, until the prompt budget is used.
function fitToBudget(files) {
  const kept = [];
  let size = 0;
  for (const f of files) {
    const len = f.lines.reduce((s, l) => s + l.text.length + 8, 0);
    if (kept.length && size + len > MAX_PROMPT_CHARS) continue;
    kept.push(f);
    size += len;
  }
  return kept;
}

function normalizePath(p) {
  return String(p).trim().replace(/^\.?\//, '');
}

// Issue text without images or HTML, for the overview card.
function bodyText(body) {
  return String(body || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]+>/g, '').trim().slice(0, 600);
}

function stripDataUrl(s) {
  return String(s).replace(/^data:[^;]+;base64,/, '');
}
