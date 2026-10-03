# TraceLens demo

## Before the demo

The demo runs against this repo: **https://github.com/shresta204-ops/Team_Penguin**. The buggy dashboard lives in `demo-repo/`, and the two demo issues are already open:

- Issue 1: https://github.com/shresta204-ops/Team_Penguin/issues/1
- Issue 2: https://github.com/shresta204-ops/Team_Penguin/issues/2

1. Put `GEMINI_API_KEY` and `GITHUB_TOKEN` in `server/.env`. The token is a fine-grained token for Team_Penguin only, with Issues read/write and Contents read.
2. Start the app: run `npm start` in `server/` (it serves the built client at http://localhost:8787).
3. Triage both issues live once. This writes `saved/shresta204-ops-Team_Penguin-<n>.json`, your backup if the API is rate-limited on stage.
4. Have these tabs open: issue 1 on GitHub, TraceLens, and `server/gemma.js` in the editor.

### Issue 1: planted bug

- Title: `Profile page broken`
- Body: `after login my name is gone??` plus the screenshot of "Welcome back, undefined!"

Expected: diagnosis mode. `demo-repo/src/components/Dashboard.jsx` is matched with "Welcome back" highlighted, the evidence cites line 17, the fix says `user.fullname` should be `user.name`, and `good first issue` is suggested.

### Issue 2: not enough information

- Title: `dashboard looks weird`
- Body: `something is off on this page, pls fix` plus a normal-looking dashboard screenshot

Expected: ask-reporter mode. The draft asks what looks wrong, steps to reproduce and the expected result.

## Run of show (2 minutes)

| Time | Say | Show |
|---|---|---|
| 0:00 to 0:20 | "Maintainers get reports like this every day. No error to copy, just a picture." | Issue 1 on GitHub |
| 0:20 to 0:50 | "TraceLens sends the screenshot to Gemma 4." | Paste link, click Triage issue, point at what Gemma sees |
| 0:50 to 1:15 | "Gemma read 'Welcome back' off the screen, and we found that exact line in the repo." | Highlighted code match, then diagnosis |
| 1:15 to 1:35 | "Every line it cites is real code. Anything else is thrown out." | Post to GitHub, open the live comment |
| 1:35 to 1:50 | "When a screenshot isn't enough, it asks instead of guessing." | Issue 2 live, or the saved result (`?saved=shresta204-ops-Team_Penguin-2`) |
| 1:50 to 2:00 | "Two Gemma 4 calls through the Gemini API, all in one file. MIT licensed." | `server/gemma.js` |

If the live call fails on stage: click **Load saved result for this issue** under the error and carry on.

## Judge Q&A

- **Why not paste the error text?** There isn't any. Visual bugs don't throw errors; the screenshot is the only evidence.
- **What if it hallucinates?** It can only cite files we fetched, the code shown is the real lines, and weak evidence leads to a question instead of a guess.
- **Does it work on big repos?** Today it fetches up to 80 files and narrows them using on-screen text. Large monorepos are on the roadmap.
- **Why Gemma?** Strong image understanding, and it is open-weight, so teams could later self-host it for private code.
- **Is the bug real?** It is planted in our demo repo so the demo is reliable. The pipeline works on any public issue with a screenshot.
