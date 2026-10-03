# TraceLens

**Visual bugs don't throw errors. The screenshot is the only evidence, so we built a tool that reads it and finds the code behind it.**

TraceLens turns screenshot-only GitHub bug reports into a grounded diagnosis. Gemma 4 reads what is wrong on screen, TraceLens finds the exact code that renders it, and the maintainer posts a triage comment to the issue.

Built by Team Penguin for Hacktoberfest Hack Day 2026, "Best Use of Gemma 4". MIT licensed.

## How it works

```
Issue link -> Fetch issue + screenshot (GitHub API or manual upload)
  -> Gemma call 1: look
  -> Enough info? --no--> Ask the reporter (list missing details) --> Draft triage comment
        | yes
  -> Search repo (on-screen text, follow imports one level)
  -> Gemma call 2: diagnose (screenshot + numbered code)
  -> Grounding check (drop evidence outside fetched files)
  -> Draft triage comment (maintainer edits)
  -> Post to GitHub (comment + labels)
```

1. Paste a GitHub issue link and click **Triage issue**.
2. The server fetches the issue and its first screenshot. If that fails, upload the screenshot manually.
3. **Gemma call 1 ("look")** describes what is visibly wrong, the expected result, the fixed on-screen text (for "Welcome back, undefined!" that is "Welcome back") and keywords. If the screenshot is not enough, TraceLens drafts a reply asking the reporter for details instead of guessing.
4. TraceLens searches the repo for the on-screen text, follows relative imports one level, and shows each match next to the screenshot, with the matched text highlighted.
5. **Gemma call 2 ("diagnose")** gets the screenshot and the numbered code and returns the root cause, evidence (file and line), fix, labels, difficulty and confidence.
6. You edit the draft comment, then click **Post to GitHub**. Nothing is posted before that.

### Trust and grounding

- Gemma may only cite files TraceLens fetched. Any other path is dropped, and the UI says how many were dropped.
- Line numbers are clamped to the file. Code in the UI and the comment comes from the fetched files, never from model output.
- If no evidence survives, confidence is forced to `low`.
- `good first issue` is suggested only when difficulty is `easy` and confidence is not `low`.
- Keys stay in `server/.env`. The browser only talks to our own `/api/*`.

## Setup

Requires Node 18 or newer.

```bash
cd server
npm install
cp .env.example .env    # then fill in the values below
npm start               # http://localhost:8787

cd ../client
npm install
npm run dev             # http://localhost:5173 (proxies /api to the server)
```

Or build the client once (`npm run build` in `client/`) and the server serves it at http://localhost:8787.

`server/.env`:

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | Gemini API key from Google AI Studio |
| `GITHUB_TOKEN` | Fine-grained token for the target repo: **Issues** read/write, **Contents** read. Nothing else. |
| `GEMMA_MODEL` | Gemma 4 model id. Default `gemma-4-26b-a4b-it`; `gemma-4-31b-it` also works if your key has it. |
| `PORT` | Server port, default `8787` |

Note on the model id: the brief listed `gemma-4-26ba4b-it`, which we read as a typo for `gemma-4-26b-a4b-it`. If you get "Model ... is not available on this key", set `GEMMA_MODEL` to the id your key lists.

## API

| Route | Body | Returns |
|---|---|---|
| `GET /api/health` | - | `{ ok, model }` |
| `POST /api/triage` | `{ issueUrl }`, or `{ issueUrl, imageBase64, mimeType }` for manual upload, or `{ issueUrl, saved: true }` to replay a saved result | Triage result (mode, issue, screenshot, look, matches, diagnosis, comment, labels, model, elapsedMs). Send `Accept: application/x-ndjson` to get `{stage}` progress lines first. |
| `POST /api/post` | `{ issueUrl, comment, labels }` | `{ commentUrl, labels, labelError }` |

Errors are `{ "error": "<what went wrong and how to fix it>" }`.

## Saved results (rehearsal and rate limits)

Every successful live triage is written to `saved/<owner>-<repo>-<number>.json`. To replay one without spending API quota:

- open `http://localhost:5173/?saved=<owner>-<repo>-<number>`, or
- after an error, click **Load saved result for this issue**.

## Project layout

```
server/       Express API. Gemma 4 lives only in server/gemma.js.
  gemma.js      Gemma 4 client (image + text in, JSON out, fence stripping, one retry)
  prompts.js    "look" and "diagnose" prompts
  pipeline.js   triage workflow + grounding check
  search.js     screen-to-code search, import following, numbered lines
  github.js     GitHub API helpers
  comment.js    triage comment builders
  index.js      routes
client/       React 18 + Vite UI
demo-repo/    small React dashboard with a planted bug (push as its own repo)
demo-assets/  screenshots for the two demo issues
saved/        saved triage results
```

## Not built for

- Backend-only or CLI projects (there is no screen to read).
- Very large monorepos: v1 fetches at most 80 source files.
- Bugs that already show a text error or stack trace. Paste those into your usual tools.

## Honest demo note

The bug in the demo (`demo-repo/src/components/Dashboard.jsx` line 17 renders `user.fullname`, but the mock API returns `name`) is planted so the demo is reliable. The pipeline itself works on any public issue with a screenshot.

## Roadmap

1. GitHub Action that triages new issues with images automatically.
2. Self-hosted Gemma for private repositories.
3. Large repository support with code search and file ranking.
4. Mark the problem area directly on the screenshot.

## UI

The client follows the team mockup in `UI_demo.jpeg`. It has a sidebar, a five-step progress bar, issue, Gemma and search cards, code evidence next to the diagnosis, and a right rail with the draft comment, labels and contributor info. This replaced the plainer issue-tracker style in the original brief.

## Renaming

The product name lives in three places: `APP_NAME` in `client/src/App.jsx`, the `<title>` in `client/index.html`, and the title of this README.

## License

MIT, see [LICENSE](LICENSE).
