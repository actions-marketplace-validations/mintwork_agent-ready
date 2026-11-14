# Show HN draft

**Title** (80 char max):

> Show HN: Agent-ready – Lighthouse for AI coding agents (score your repo 0–100)

**URL:** https://github.com/ranjan-mohanty/agent-ready

**First comment** (post right after submitting):

---

Hi HN, I built agent-ready because I kept watching coding agents fail in the same boring ways.
They guessed the test command because the repo had no AGENTS.md. They edited a file that CLAUDE.md
mentioned but that had been deleted months ago. They grepped a committed `dist/` and filled their
context with minified JS. In one case a `build` script ran `npm publish`.

None of these are model problems. They are repo problems, and you can check for them mechanically.

`npx agent-ready` scans a repo in under a second and gives a 0–100 score across five weighted
categories: context docs, feedback loops (tests/lint/typecheck/CI), navigability, type safety and
safety (committed secrets, dangerous scripts). Every finding comes with a concrete fix. It's
read-only, makes no network calls, and doesn't execute your code unless you pass `--run`.

A few design decisions you might want to argue with:

- **Staleness is the most valuable check.** Every path and `npm run` script mentioned in your
  agent docs is checked against the repo. Stale docs are worse than none, because the agent
  trusts them.
- **`--fix` can't game the score.** It generates a starter AGENTS.md/CLAUDE.md from your real
  scripts and layout, but an unedited template is capped at half credit. The CLI tells you how many
  points you unlock by filling in the TODOs. I didn't want a tool whose own output gets a perfect
  score.
- **Prefer false negatives.** A noisy linter gets uninstalled, so checks are tuned to stay quiet
  when unsure. Secrets in tests and fixtures are listed but don't cost points.

To calibrate it, I ran it against 13 well-known open-source repos and compared the scores with
expert judgment of how easy each one is for an agent to work in. The scores tracked that judgment.
Every false positive I found became a regression test.

There are paid tools that do "agent readiness" assessments. This one is MIT, has zero runtime
dependencies, and its checks are plain objects you can extend. It also ships a GitHub Action
(`--min-score` to fail PRs that make the repo worse) and a README badge, `npx agent-ready --badge`.

Supports JS/TS and Python well, Go and Rust at a basic level. I'd love feedback on the weights, and
on agent failure modes you've seen that it doesn't check for yet.

---

**Notes**

- Post Tuesday–Thursday, around 8–10am US Eastern. Stay in the thread for the first 2–3 hours.
- Don't ask for upvotes anywhere. Don't post the HN link in other communities on the same day.
- Likely questions to have answers ready for:
  - "Isn't this just a linter?" Linters judge code. This judges the environment the agent works
    in: docs, feedback loops, ignore files, scripts.
  - "How did you pick the weights?" Context and feedback loops cause the most agent failures in
    practice, so they get the most weight. Weights are public API and changes go in the changelog.
  - "Which 13 repos?" Share the well-scoring ones if asked. Don't single out low scorers.
