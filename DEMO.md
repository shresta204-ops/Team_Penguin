# TraceLens demo

## Before the demo

1. Push `demo-repo/` as its own public GitHub repo (for example `penguin-dashboard`).
2. Create a fine-grained token for that repo only (Issues read/write, Contents read) and put it in `server/.env` with the Gemini key.
3. Open the two issues below by hand, dragging in the screenshots from `demo-assets/`.
4. Run a live triage of both issues once. This writes `saved/<owner>-<repo>-<n>.json`, the backup if the API is rate-limited on stage.
5. Have these tabs open: issue 1 on GitHub, TraceLens, `server/gemma.js` in the editor.

### Issue 1: planted bug

- Title: `Profile page broken`
- Body: `after login my name is gone??`, plus `demo-assets/issue-1-welcome-undefined.png`

Expected: diagnosis mode, `src/components/Dashboard.jsx` matched with "Welcome back" highlighted, evidence near line 17, fix says `user.fullname` should be `user.name`, `good first issue` suggested.

### Issue 2: not enough information

- Title: `dashboard looks weird`
- Body: `something is off on this page, pls fix`, plus `demo-assets/issue-2-looks-normal.png` (a normal-looking dashboard)

Expected: ask-reporter mode, and the draft asks for the page, steps to reproduce and the expected result.

## Run of show (2 minutes)

| Time | Say | Show |
|---|---|---|
| 0:00 to 0:20 | "Maintainers get reports like this every day. No error to copy, just a picture." | Issue 1 on GitHub |
| 0:20 to 0:50 | "TraceLens sends the screenshot to Gemma 4." | Paste link, click Triage issue, point at what Gemma sees |
| 0:50 to 1:15 | "Gemma read 'Welcome back' off the screen, and we found that exact line in the repo." | Highlighted code match, then diagnosis |
| 1:15 to 1:35 | "Every line it cites is real code. Anything else is thrown out." | Post to GitHub, open the live comment |
| 1:35 to 1:50 | "When a screenshot isn't enough, it asks instead of guessing." | Saved result for issue 2 (`?saved=<owner>-<repo>-<n>`) |
| 1:50 to 2:00 | "Two Gemma 4 calls through the Gemini API, all in one file. MIT licensed." | `server/gemma.js` |

If the live call fails on stage: click **Load saved result for this issue** under the error and carry on.

## Judge Q&A

- **Why not paste the error text?** There isn't any. Visual bugs don't throw errors; the screenshot is the only evidence.
- **What if it hallucinates?** It can only cite files we fetched, the code shown is the real lines, and weak evidence leads to a question instead of a guess.
- **Does it work on big repos?** Today it fetches up to 80 files and narrows them using on-screen text. Large monorepos are on the roadmap.
- **Why Gemma?** Strong image understanding, and it is open-weight, so teams could later self-host it for private code.
- **Is the bug real?** It is planted in our demo repo so the demo is reliable. The pipeline works on any public issue with a screenshot.
