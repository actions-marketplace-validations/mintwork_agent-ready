# X thread draft

Attach `docs/demo.gif` (or an MP4 export of it, since X recompresses GIFs) to post 1. Use
`docs/demo.png` as the image for post 3 if you want a still.

---

**1/**
Lighthouse, but for AI coding agents.

`npx @mintwork/agent-ready` scores how well Claude Code, Codex and Cursor can work in your repo, 0–100, in
under a second. Then `--fix` closes the easy gaps.

Open source, zero deps.

[demo.gif]

**2/**
Most agent failures I see aren't the model's fault:

– no AGENTS.md, so it guesses your test command
– stale CLAUDE.md, so it edits deleted files
– dist/ not ignored, so it burns context on minified JS
– `build` secretly runs `npm publish`

All of that can be checked mechanically.

**3/**
agent-ready scores 5 categories:

Context docs 30%
Feedback loops 25%
Navigability 20%
Type safety 15%
Safety 10%

Every finding comes with a concrete fix. Read-only by default, and no network calls.

**4/**
`--fix` writes a starter AGENTS.md + CLAUDE.md from your real scripts and layout, adds missing
.gitignore entries, and shows the diff.

But the generated docs only earn partial credit until a human fills in the TODOs, so you can't
game your way to 100.

**5/**
I calibrated it against 13 well-known open-source repos. The scores tracked expert judgment of
how agent-friendly each one is.

Every false positive became a regression test.

**6/**
The fun part:

`npx @mintwork/agent-ready --badge`

drops an agent-ready: NN/100 badge in your README, so contributors (human and AI) know the repo is
ready for them.

What does your repo score? Reply with your badge.

**7/**
There are paid agent-readiness tools. This one is MIT, runs locally, and its checks are ~30-line
plain objects you can extend.

GitHub Action included for CI gating.

https://github.com/mintwork/agent-ready
