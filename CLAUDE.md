# PatchPilot: build brief for Claude Code

You are building **PatchPilot** (working name; alternative "PixelTrace"), a tool by Team Penguin for the Hacktoberfest Hack Day 2026 "Best Use of Gemma 4" challenge. Read this whole file before writing code. Follow the spec literally; where something is marked **(inferred)**, it was not in the original spec and you should pick a sensible default and note it in the README.

## One-line summary

PatchPilot turns screenshot-only GitHub bug reports into a grounded diagnosis. Gemma 4 reads what is wrong on screen, PatchPilot finds the exact code that renders it, and the maintainer posts a triage comment to the issue.

Pitch line: "Visual bugs don't throw errors. The screenshot is the only evidence, so we built a tool that reads it and finds the code behind it."

## Problem and users

- Maintainers get reports with only a screenshot and a line like "profile page broken". No error, no stack trace, no repro steps.
- The maintainer must (1) work out what is wrong in the image, (2) find the file that renders that part of the screen, (3) decide: fix it, label it for a contributor, or ask for more details.
- Primary user: open-source maintainer of a UI project (React, Vue, Svelte apps, component libraries, dashboards). Secondary: new contributors (Hacktoberfest first-timers) who benefit from issues labelled `good first issue` that point to the file.
- **Not built for:** backend-only/CLI projects, very large monorepos (v1 fetches up to 80 source files), bugs that already show a text error.

## Hard constraints

- Build time budget is 120 minutes. A working end-to-end flow must exist by minute 95; after that, polish only.
- **Never cut:** the on-screen text search, and posting the comment to GitHub. If behind, drop label suggestions and the ask-reporter path first.
- MIT license.
- Model: Gemma 4 through the Gemini API using the `@google/genai` SDK. Model id from the spec: `gemma-4-26ba4b-it`, or `gemma-4-31b-it`. Make the model id an env var (`GEMMA_MODEL`) so it can be swapped once the real id is confirmed on the key.
- Secrets (Gemini key, GitHub token) live only in `server/.env`. Never in React code, never committed. Provide `server/.env.example`.
- Only the Express server calls Gemma and GitHub. The browser only calls our own `/api/*`.
- Nothing is posted to GitHub without the maintainer clicking "Post to GitHub".

## Tech stack

| Layer | Choice |
|---|---|
| Front end | React 18 + Vite |
| Server | Node 18+ and Express |
| AI | Gemma 4 via Gemini API, `@google/genai` |
| Code and issues | GitHub REST API |
| License | MIT |

## Repository structure

```
patchpilot/
  server/
    gemma.js        Gemma 4 client (image + text in, JSON out)
    prompts.js      "look" and "diagnose" prompts
    pipeline.js     the triage workflow
    search.js       screen-to-code search, import following, snippets
    github.js       GitHub API helpers
    comment.js      triage comment builders
    index.js        Express routes: /api/health, /api/triage, /api/post
    .env.example
    package.json
  client/           React UI (Vite)
    index.html      page title lives here
    src/App.jsx     exports/uses APP_NAME constant
  demo-repo/        small dashboard with the planted bug (pushed as its own repo)
  README.md
  DEMO.md
  LICENSE           MIT
```

Renaming the product must only require changing: `APP_NAME` in `client/src/App.jsx`, the title in `client/index.html`, and the README title.

## User workflow (implement exactly)

1. Maintainer pastes a GitHub issue link and clicks **Triage issue**.
2. Server fetches the issue and its first screenshot. If the image cannot be downloaded, the UI offers **manual upload** of a screenshot.
3. **Gemma call 1 ("look")**: describes what is visibly wrong, the expected result, the fixed on-screen text, and keywords. It also decides whether there is enough information.
   - If not enough: skip to step 6 with a draft reply asking the reporter for specific details ("won't guess" mode).
4. Server searches the repo for the on-screen text, follows imports one level, and the UI shows each match next to the screenshot.
5. **Gemma call 2 ("diagnose")**: screenshot plus numbered code gives root cause, evidence (file and line), fix, labels, difficulty, confidence.
6. Maintainer reads and edits the draft comment.
7. Maintainer clicks **Post to GitHub**; the comment and labels appear on the issue.

Pipeline diagram (text form):

```
Issue link -> Fetch issue + screenshot (GitHub API or manual upload)
  -> Gemma call 1: look
  -> Enough info? --no--> Ask the reporter (list missing details) --> Draft triage comment
        | yes
  -> Search repo (on-screen text, follow imports)
  -> Gemma call 2: diagnose (screenshot + numbered code)
  -> Grounding check (drop evidence outside fetched files)
  -> Draft triage comment (maintainer edits)
  -> Post to GitHub (comment + labels)
```

## Server design

### Routes

- `GET /api/health` returns `{ ok: true, model: <GEMMA_MODEL> }`. Used by the UI header to show which model runs. **(response shape inferred)**
- `POST /api/triage` body `{ issueUrl }` or `{ issueUrl, imageBase64, mimeType }` for manual upload. Returns the full triage result (see schema below) including the draft comment, timing and model name.
- `POST /api/post` body `{ issueUrl, comment, labels }`. Posts the (edited) comment and applies labels. Returns the comment URL.

Errors: return a JSON `{ error: "<one line saying what went wrong and how to fix it>" }` with a sensible status. Required cases: invalid/unparseable issue link, missing Gemini key or GitHub token, GitHub or Gemini rate limit, issue has no screenshot (suggest manual upload), repo not found / no access.

### gemma.js

- Single file containing the Gemma client. This is the file shown to judges, so keep it small and readable.
- Function that takes `{ prompt, images: [{ mimeType, data }], system? }` and returns parsed JSON.
- JSON robustness: strip markdown code fences, `JSON.parse`, and **retry once** on failure.
- Request JSON output (`responseMimeType: "application/json"` if supported by the model; otherwise rely on the prompt plus fence stripping).

### prompts.js

Two prompts.

**Look prompt** (screenshot only plus issue title/body text). Must return JSON:

```json
{
  "enough_info": true,
  "what_is_wrong": "string, plain description of what is visibly wrong",
  "expected_result": "string",
  "on_screen_text": ["fixed UI strings visible in the screenshot, e.g. 'Welcome back'"],
  "keywords": ["extra search terms: button labels, headings, component names"],
  "missing_details": ["only when enough_info is false: page, steps to reproduce, expected result, etc."]
}
```

Rules to put in the prompt:
- `on_screen_text` must be the **fixed** text (labels, headings, buttons), not the broken dynamic value. Example: for "Welcome back, undefined!" return `"Welcome back"`.
- If the screenshot looks normal, is blurry, or the problem cannot be identified, set `enough_info` to false and list exactly what is missing. Do not guess.

**Diagnose prompt** (screenshot, Gemma call 1 output, and numbered code files). Must return JSON:

```json
{
  "root_cause": "string",
  "evidence": [
    { "file": "path/as/fetched.jsx", "line": 17, "note": "why this line is the cause" }
  ],
  "fix": "string, concise suggested change",
  "labels": ["bug", "good first issue"],
  "difficulty": "easy | medium | hard",
  "confidence": "low | medium | high"
}
```

Rules to put in the prompt:
- Cite only files that were provided. Use line numbers from the numbered listing.
- If the code does not explain the screenshot, say so and set confidence to low.

### search.js (screen to code)

1. Fetch the repo tree via GitHub API. Filter to source files by extension (js, jsx, ts, tsx, vue, svelte, html, css optional) and skip `node_modules`, `dist`, `build`, lockfiles, minified files. **Cap at 80 files fetched.**
2. Search file contents for each string in `on_screen_text` (case-insensitive), then `keywords` as a weaker signal. Rank files by number of distinct on-screen-text hits.
3. For top matches, **follow imports one level**: parse relative `import ... from './x'` / `require('./x')`, resolve to files in the tree (try extensions and `/index.*`), fetch them too. Stay within the 80-file cap.
4. Produce for each file: path, full content, numbered lines, and the matched line numbers (used for yellow highlight in the UI).
5. Snippets shown in the UI and comment come from the **fetched file text only**, never from model output.

### Grounding check (in pipeline.js, runs after call 2)

- Drop any `evidence` item whose `file` is not in the set of fetched files.
- Clamp `line` to `[1, fileLength]`.
- Replace any model-quoted code with the real lines read from the fetched file (a few lines of context around the cited line).
- If no evidence survives, force `confidence = "low"`.
- If the file is cited but the matched on-screen text is still present, still show the matched text.

### github.js

- Parse `https://github.com/{owner}/{repo}/issues/{n}`.
- Get issue (title, body, labels), find first image URL in body (markdown `![](...)` and `<img src>`), download it as base64 (handle GitHub user-attachments URLs; if download fails, return a specific error that triggers the manual upload path).
- Get repo tree (default branch), get file contents, post issue comment, add labels (create nothing; only add labels that exist, or create `good first issue` if missing **(inferred)**).
- Token needs only Issues read/write and Contents read on one repo.

### comment.js

Two builders returning markdown for the draft comment.

**Diagnosis comment** includes: what is wrong (from call 1), root cause, evidence list with `file:line` and the real code lines in a fenced block, suggested fix, difficulty, confidence, suggested labels, and a short footer saying it was drafted by PatchPilot with Gemma 4 and reviewed by a maintainer.

**Ask-reporter comment**: polite reply asking for the page, steps to reproduce, and expected result, tailored to `missing_details`. No diagnosis.

### Labels

- `good first issue` is applied automatically when difficulty is `easy` and confidence is not `low`. Plus `bug`. Labels are shown in the UI and sent with the post.

### Triage result schema returned by `/api/triage`

```json
{
  "mode": "diagnosis | ask_reporter",
  "issue": { "title": "", "url": "", "number": 0 },
  "screenshot": "data URL or image URL for display",
  "look": { },
  "matches": [
    { "file": "", "matchedLines": [17], "lines": [{ "n": 1, "text": "" }] }
  ],
  "diagnosis": { "root_cause": "", "evidence": [], "fix": "", "labels": [], "difficulty": "", "confidence": "" },
  "comment": "draft markdown",
  "labels": [],
  "model": "gemma-...",
  "elapsedMs": 0
}
```
**(exact shape inferred; keep it consistent between server and client)**

## Client UI

### Layout

- Header: app name (use `APP_NAME` constant) and the model name from `/api/health`.
- Input panel: issue link field and **Triage issue** button. Manual upload control appears when the screenshot cannot be fetched (and as a fallback option).
- Results: **screenshot and matched code side by side in two equal panels.** Matched on-screen text highlighted yellow; the cited focus line in a pale yellow row.
- Below: "What Gemma sees" summary (what is wrong, expected result, on-screen text found), diagnosis (root cause, evidence, fix, difficulty, confidence, labels).
- Editable textarea with the draft triage comment. Buttons: **Copy comment** (clipboard) and **Post to GitHub**.
- Show how long triage took and which model ran.
- Session history of the last few triaged issues (in memory is fine).
- Clear one-line errors: what went wrong and how to fix it.
- Loading states for each stage so the demo feels alive (fetching, looking, searching, diagnosing).

### Design rules (follow exactly)

Look like a classic developer tool: light, plain, readable, closer to an issue tracker than a landing page.

| Element | Choice |
|---|---|
| Page background | `#F6F7F9` |
| Panels | White `#FFFFFF`, 1px border `#D0D7DE`, 6px corners, no shadows |
| Panel headers | Grey bar `#F1F3F5` with panel title |
| Text | `#1F2328`, secondary `#57606A` |
| Primary button and links | `#1F4E8C` |
| On-screen text match | `#FFF2A8` (the one colour that draws the eye) |
| Headings | Source Serif 4, fallback Georgia |
| Body | System font stack (Segoe UI, San Francisco, Roboto) |
| Code | Panel `#F6F8FA`, system monospace, focus line pale yellow |

- No gradients, glows, emoji icons, pill badges or dark mode.
- Sentence case everywhere. Buttons say exactly what happens: "Triage issue", "Post to GitHub".
- Projector-friendly: body text at least 16px, strong contrast, no thin grey text.

## Trust, grounding, privacy (must hold)

- Gemma may only cite files PatchPilot fetched; other paths are dropped.
- Code snippets come from fetched files, never model output; line numbers are clamped.
- Low confidence is shown; no surviving evidence forces low.
- Weak screenshot yields a question to the reporter, not a diagnosis.
- Comment is a draft until the maintainer edits and posts.
- Keys stay server-side; least-privilege token.

## Demo repo (`demo-repo/`)

A small React dashboard (own repo, own `package.json`) with a **planted bug**:

- `Dashboard.jsx`: renders `Welcome back, {user.fullname}!` on roughly **line 17**, while the (mock) API/user object returns `name`. Result on screen: "Welcome back, undefined!".
- Include a few other components and files so search is meaningful (header, profile card, a data fetch helper), and make `Dashboard.jsx` import at least one of them so import-following is demonstrable.
- Add a README stating the bug is planted for the demo.
- Also prepare `DEMO.md` with the issue texts and run-of-show.

Demo issues (to be opened manually later, not by code):
1. Screenshot of "Welcome back, undefined!" with text "after login my name is gone??".
2. A normal-looking screenshot with a vague text, to trigger the ask-reporter path.

## Build order (follow this sequence)

1. **0 to 15 min**: scaffold server and client, `.env.example`, `/api/health`, first successful Gemma call with an image in `gemma.js`.
2. **15 to 45 min**: GitHub issue fetch + screenshot download, call 1 ("look") with JSON parsing and retry.
3. **45 to 75 min**: `search.js` (on-screen text search, import following), call 2 ("diagnose"), grounding check.
4. **75 to 95 min**: `comment.js`, `/api/post`, results UI, side-by-side panels. **Feature freeze at 95.**
5. **95 to 110 min**: ask-reporter path, error messages, manual upload, copy button, history.
6. **110 to 120 min**: README, DEMO.md, LICENSE, saved backup results, rehearsal.

## Deliverables checklist

- [ ] `server/` complete with the exact file layout above
- [ ] `client/` React UI following the design rules
- [ ] `demo-repo/` with planted bug at `Dashboard.jsx` ~line 17
- [ ] `README.md`: what it is, setup (`server/.env` keys: `GEMINI_API_KEY`, `GITHUB_TOKEN`, `GEMMA_MODEL`, `PORT`), run instructions, "not built for" list, honest-demo note, roadmap, rename instructions
- [ ] `DEMO.md`: 2-minute script and judge Q&A (below)
- [ ] `LICENSE` (MIT)
- [ ] Model name visible in the app header; Gemma integration confined to `server/gemma.js`

## Acceptance tests

1. Issue 1 (screenshot of "Welcome back, undefined!"): triage returns `mode: "diagnosis"`, `matches` includes `Dashboard.jsx` with "Welcome back" highlighted, evidence cites `Dashboard.jsx` near line 17, fix mentions `user.fullname` vs `name`, `good first issue` suggested, and posting creates a real comment with labels.
2. Issue 2 (normal-looking screenshot): `mode: "ask_reporter"` and the draft asks for page, steps and expected result.
3. Grounding: if the model cites a nonexistent file, it is dropped; with no surviving evidence, confidence is `low`.
4. Broken model JSON: fences stripped, one retry, then a clear error.
5. Invalid link, missing key, rate limit and missing screenshot each show a one-line fix-it error.
6. Result from "Triage issue" to visible "what Gemma sees" in about 30 seconds or less.

## Demo run-of-show (for DEMO.md)

| Time | Say | Show |
|---|---|---|
| 0:00 to 0:20 | "Maintainers get reports like this every day. No error to copy, just a picture." | Issue 1 on GitHub |
| 0:20 to 0:50 | "PatchPilot sends the screenshot to Gemma 4." | Paste link, click Triage issue, point at what Gemma sees |
| 0:50 to 1:15 | "Gemma read 'Welcome back' off the screen, and we found that exact line in the repo." | Highlighted code match, then diagnosis |
| 1:15 to 1:35 | "Every line it cites is real code. Anything else is thrown out." | Post to GitHub, open the live comment |
| 1:35 to 1:50 | "When a screenshot isn't enough, it asks instead of guessing." | Saved result for issue 2 |
| 1:50 to 2:00 | "Two Gemma 4 calls through the Gemini API, all in one file. MIT licensed." | `server/gemma.js` |

Judge Q&A to include:
- **Why not paste the error text?** There isn't any. Visual bugs don't throw errors; the screenshot is the only evidence.
- **What if it hallucinates?** It can only cite files we fetched, the code shown is the real lines, and weak evidence leads to a question instead of a guess.
- **Does it work on big repos?** Today it fetches up to 80 files and narrows them using on-screen text. Large monorepos are on the roadmap.
- **Why Gemma?** Strong image understanding, and it is open-weight, so teams could later self-host it for private code.
- **Is the bug real?** It is planted in our demo repo so the demo is reliable. The pipeline works on any public issue with a screenshot.

## Risks and fallbacks (build these in)

| Risk | Fallback |
|---|---|
| Free-tier rate limit | Clear rate-limit error; support loading saved results for rehearsal **(inferred: optional `?saved=` or a saved-results folder)** |
| Screenshot can't be downloaded | Manual upload option |
| Model returns broken JSON | Strip fences, parse, retry once |
| Gemma cites the wrong line | Grounding clamps lines; matched on-screen text still shown |
| Gemma 4 unavailable on key | Model id via env var; confirm id with organizers |

## Roadmap (README only, do not build)

1. GitHub Action that triages new issues with images automatically.
2. Self-hosted Gemma for private repositories.
3. Large repository support with code search and file ranking.
4. Mark the problem area directly on the screenshot.

## Working agreements for Claude Code

- Keep code simple and readable; this is a 2-hour hackathon build, not a framework.
- Start with the smallest working vertical slice (issue link in, Gemma description out), then widen.
- Run the server and client yourself and verify each stage before moving on.
- Don't add features outside this brief. Don't add dark mode, emoji icons, gradients or pill badges.
- Ask before changing the file layout or the three API routes.
