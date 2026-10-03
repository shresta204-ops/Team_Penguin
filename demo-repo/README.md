# Penguin Dashboard (TraceLens demo repo)

A tiny React dashboard used to demo [TraceLens](../README.md), a tool that triages screenshot-only bug reports with Gemma 4.

**The bug in this repo is planted on purpose for the demo.** `src/components/Dashboard.jsx` line 17 renders
`Welcome back, {user.fullname}!`, but the mock API in `src/api/user.js` returns `name`, so the page shows
"Welcome back, undefined!".

Please do not fix it in the demo copy; it is the bug TraceLens is expected to find.

## Run

```bash
npm install
npm run dev
```

## License

MIT
