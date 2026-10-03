// Screen-to-code search: find the files that contain the text Gemma read off the screenshot.
import { getRepoTree, getFile } from './github.js';

const MAX_FILES = 80;
const IMPORT_RESERVE = 10; // fetch slots kept free for import following in big repos
const SOURCE_EXT = /\.(jsx?|tsx?|mjs|cjs|vue|svelte|html|css)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.next|\.nuxt|\.git)\//i;
const SKIP_FILE = /(\.min\.(js|css)$|\.d\.ts$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.(test|spec|stories)\.[jt]sx?$)/i;
const RESOLVE_EXT = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.vue', '.svelte', '.css',
  '/index.js', '/index.jsx', '/index.ts', '/index.tsx'];

export async function searchRepo(repoRef, look, pathPrefix = '') {
  const { branch, paths } = await getRepoTree(repoRef);
  const prefix = cleanPrefix(pathPrefix);
  const allSource = paths.filter((p) => SOURCE_EXT.test(p) && !SKIP.test(p) && !SKIP_FILE.test(p) && p.startsWith(prefix));
  const treeSet = new Set(allSource);

  // Prefer likely UI files when the repo has more than the cap.
  const ranked = [...allSource].sort((a, b) => priority(a) - priority(b) || a.length - b.length);
  const budget = allSource.length > MAX_FILES ? MAX_FILES - IMPORT_RESERVE : MAX_FILES;
  const files = new Map(); // path -> text
  await fetchAll(repoRef, branch, ranked.slice(0, budget), files);

  const screenTerms = cleanTerms(look.on_screen_text);
  const keywordTerms = cleanTerms(look.keywords).filter((k) => k.length >= 3);

  // If a full string never appears (e.g. the model kept a dynamic value), fall back to its fixed parts.
  const allText = [...files.values()].join('\n').toLowerCase();
  const effectiveScreen = screenTerms.flatMap((t) => (allText.includes(t.toLowerCase()) ? [t] : fallbackParts(t, allText)));
  const uniqueScreen = [...new Set(effectiveScreen)];

  const scored = [...files.entries()].map(([path, text]) => scoreFile(path, text, uniqueScreen, keywordTerms))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length);

  const top = scored.slice(0, 5);

  // Follow relative imports one level from the strongest matches.
  const imported = [];
  for (const f of top.slice(0, 3)) {
    for (const spec of findImports(files.get(f.path))) {
      const target = resolveImport(f.path, spec, treeSet);
      if (!target || top.some((t) => t.path === target) || imported.some((i) => i.path === target)) continue;
      if (!files.has(target)) {
        if (files.size >= MAX_FILES) continue;
        await fetchAll(repoRef, branch, [target], files);
        if (!files.has(target)) continue;
      }
      imported.push({ ...scoreFile(target, files.get(target), uniqueScreen, keywordTerms), importedBy: f.path });
    }
  }

  const matches = [...top, ...imported.slice(0, 6)].map((f) => ({
    file: f.path,
    reason: f.importedBy ? `imported by ${f.importedBy}` : f.screenHits.length ? `contains ${f.screenHits.map((t) => `"${t}"`).join(', ')}` : `mentions ${f.keywordHits.join(', ')}`,
    importedBy: f.importedBy || null,
    terms: f.screenHits,
    matchedLines: f.matchedLines,
    lines: numberLines(files.get(f.path)),
  }));

  return {
    branch,
    matches,
    fetchedPaths: [...files.keys()],
    files, // path -> text, used by the grounding check
    stats: { sourceFiles: allSource.length, fetched: files.size, searchTerms: uniqueScreen },
  };
}

// "./demo-repo" or "/demo-repo/" -> "demo-repo/"
function cleanPrefix(prefix) {
  const p = String(prefix || '').trim().replace(/^\.?\/+/, '').replace(/\/+$/, '');
  return p ? `${p}/` : '';
}

function priority(path) {
  if (/\.(jsx|tsx|vue|svelte)$/i.test(path)) return 0;
  if (/(^|\/)(src|app|components|pages|views)\//i.test(path)) return 1;
  if (/\.html$/i.test(path)) return 2;
  if (/\.css$/i.test(path)) return 4;
  return 3;
}

async function fetchAll(repoRef, branch, paths, files) {
  const queue = [...paths];
  const worker = async () => {
    while (queue.length) {
      const path = queue.shift();
      try {
        const text = await getFile(repoRef, branch, path);
        if (text.length < 300_000) files.set(path, text);
      } catch (err) {
        if (err.status === 429 || err.status === 401) throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
}

function cleanTerms(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((t) => String(t).trim()).filter((t) => t.length >= 2))];
}

// "Welcome back, undefined!" -> ["Welcome back"] when only the fixed part exists in code.
function fallbackParts(term, allText) {
  return term.split(/[,!?.:;|()"'{}–—-]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4 && !/^(undefined|null|nan|\[object object\])$/i.test(p) && allText.includes(p.toLowerCase()));
}

function scoreFile(path, text, screenTerms, keywordTerms) {
  const lower = text.toLowerCase();
  const lines = text.split('\n');
  const screenHits = screenTerms.filter((t) => lower.includes(t.toLowerCase()));
  const keywordHits = keywordTerms.filter((k) => lower.includes(k.toLowerCase()) || path.toLowerCase().includes(k.toLowerCase()));
  const matchedLines = [];
  lines.forEach((line, i) => {
    const l = line.toLowerCase();
    if (screenHits.some((t) => l.includes(t.toLowerCase()))) matchedLines.push(i + 1);
  });
  // Distinct on-screen hits dominate; keywords only break ties.
  return { path, screenHits, keywordHits, matchedLines, score: screenHits.length * 10 + keywordHits.length };
}

function findImports(text) {
  const specs = [];
  const re = /(?:import\s[^'"`;]*?from\s*|import\s*\(?\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
  for (const m of text.matchAll(re)) specs.push(m[1]);
  return [...new Set(specs)];
}

function resolveImport(fromPath, spec, treeSet) {
  const base = fromPath.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '..') base.pop();
    else if (part !== '.') base.push(part);
  }
  const joined = base.join('/');
  for (const ext of RESOLVE_EXT) {
    if (treeSet.has(joined + ext)) return joined + ext;
  }
  return null;
}

// The trailing newline does not count as a line.
export function numberLines(text) {
  return text.replace(/\r?\n$/, '').split('\n').map((t, i) => ({ n: i + 1, text: t.replace(/\r$/, '') }));
}
