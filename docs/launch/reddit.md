# Reddit drafts

Check each subreddit's self-promotion rules before posting. Post on different days. Reply to
every comment in the first few hours.

## r/ClaudeAI

**Title:** I made a free CLI that scores how well Claude Code can work in your repo (and writes your
AGENTS.md/CLAUDE.md)

**Flair:** Built with Claude / Tool (whichever the sub uses)

**Body:**

Claude Code is only as good as the repo you drop it into. The failures I kept hitting weren't
model failures:

- no CLAUDE.md, so it guessed the test command
- a CLAUDE.md pointing to files that were deleted months ago, which it trusted
- `dist/` not ignored, so it grepped minified bundles and burned context
- a `build` script that secretly ran `npm publish`

So I built **agent-ready**, Lighthouse for AI coding agents:

```
npx agent-ready
```

It scores your repo 0–100 across context docs, feedback loops, navigability, type safety and
safety, then tells you exactly what to fix. `--fix` generates a starter AGENTS.md + a CLAUDE.md
that imports it (`@AGENTS.md`), plus missing `.gitignore` entries, and always shows a diff first.

The generated docs only get partial credit until you fill in the TODOs, because the best
CLAUDE.md is written by someone who knows the code. The CLI tells you how many points you'd unlock.

There are paid "agent readiness" tools. This one is free, MIT, runs locally in under a second,
and has no runtime dependencies. I validated it against 13 well-known open-source repos, and the
scores tracked expert judgment of how agent-friendly each one is.

`npx agent-ready --badge` gives you a README badge. I'm curious what scores people get. Post yours
below.

[demo GIF]

GitHub: https://github.com/ranjan-mohanty/agent-ready

## r/programming

r/programming removes most direct project announcements. Post a write-up instead: a blog post or
the README "Why" section, with the tool as the example.

**Title:** Most AI coding agent failures I've seen were repo problems, not model problems

**Link:** (blog post URL; fall back to the GitHub repo if there is no post)

**Comment to add after posting:**

Author here. The post covers the failure modes I kept seeing: missing or stale agent docs,
undiscoverable test commands, unignored build output, dangerous scripts. It also explains how I
turned them into mechanical checks. The tool is open source (MIT, zero runtime deps):
`npx agent-ready` scores a repo 0–100 and `--fix` generates the missing docs. I calibrated it
against 13 well-known OSS repos. I'd be glad to hear about failure modes it doesn't cover.
