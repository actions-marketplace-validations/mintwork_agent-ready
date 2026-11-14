<div align="center">

# agent-ready

**Lighthouse for AI coding agents.**
Score how well Claude Code, Codex and Cursor can work in your repo — then auto-fix the gaps.

[![agent-ready: 100/100](https://img.shields.io/badge/agent--ready-100%2F100-brightgreen)](https://www.npmjs.com/package/agent-ready)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-blue)](.github/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![zero dependencies](https://img.shields.io/badge/runtime_deps-0-brightgreen)](package.json)

```bash
npx agent-ready
```

</div>

---

Your agent is only as good as the repo you drop it into. No `AGENTS.md`? It guesses your test
command. Stale `CLAUDE.md`? It confidently edits files that were deleted months ago. `dist/` not
ignored? It greps your minified bundle and burns half its context window. A `build` script that
runs `npm publish`? Good luck.

`agent-ready` checks all of that in **under a second** and gives you a 0–100 score, a category
breakdown, and a punch list of fixes — many of which it can apply for you.

## What it looks like

```text
$ npx agent-ready ~/code/my-app

  agent-ready v0.1.0  ~/code/my-app
  5 files · javascript · 7ms

  Agent-ready score  31/100  ███████░░░░░░░░░░░░░░░░░  Poor

  Context docs      53  ███████████░░░░░░░░░  weight 30%
  Feedback loops     0  ░░░░░░░░░░░░░░░░░░░░  weight 25%
  Navigability      39  ████████░░░░░░░░░░░░  weight 20%
  Type safety       25  █████░░░░░░░░░░░░░░░  weight 15%
  Safety            38  ████████░░░░░░░░░░░░  weight 10%

  Context docs
   ✗ Docs are not stale (referenced paths/scripts exist) (40%) — 3 stale reference(s) out of 3
       · CLAUDE.md references missing path `lib/old-entry.js`
       · CLAUDE.md references missing package.json script "start:dev"
       → Update or remove references to files/scripts that no longer exist.
   ✗ Docs list build/test/lint commands (33%) — Missing test, lint command(s) in context docs
       → Add a "Commands" section with exact test/lint commands.  [fixable: --fix]

  Feedback loops
   ✗ Test command is discoverable (0%) — Tests: no JS tests
   ✗ Linter configured (0%) — Lint: no JS linter

  Navigability
   ✗ No oversized source files (>1000 lines) (0%) — 1 of 2 source files exceed 1000 lines
       · src/legacy.js 1400 lines

  Safety
   ✗ No secrets in the repo (50%) — 1 possible secret(s) visible to agents
       · .env dotenv file is visible in the repo
   ✗ No dangerous scripts (0%) — 3 risky script command(s)
       · package.json script "setup" pipes a remote script into a shell
       · package.json script "build" publishes a package — an agent running "build" would release

  Next: agent-ready --fix to auto-fix 3 check(s) · agent-ready --badge for a README badge
```

Then:

```text
$ npx agent-ready --fix

Updated CLAUDE.md — Append detected build/test/lint commands; Append an Architecture section
Created AGENTS.md — AGENTS.md pointing at the existing CLAUDE.md
Created .gitignore — Create .gitignore so dependency/build dirs stay out of agent context

  Score: 31 → 40
```

## Show off your score

```bash
npx agent-ready --badge
```

```markdown
[![agent-ready: 94/100](https://img.shields.io/badge/agent--ready-94%2F100-brightgreen)](https://www.npmjs.com/package/agent-ready)
```

Paste it at the top of your README. It tells contributors — human and AI — that your repo is
ready for them. (This repo scores 100/100, and CI fails if it drops below 90.)

## Install

```bash
npx agent-ready            # no install
npm i -D agent-ready       # or pin it in your project
```

Node 20+. Zero runtime dependencies. Works on JS/TS and Python repos. Read-only unless you pass `--fix`.

## Usage

```text
npx agent-ready [path] [options]

  --json             Machine-readable JSON report
  --badge            Print a shields.io badge (markdown) for your README
  --fix              Apply safe auto-fixes (AGENTS.md/CLAUDE.md, missing doc sections, .gitignore)
  --dry-run          With --fix: show the diff without writing
  --force            With --fix: allow overwriting existing files
  --run              Execute the test command and score its speed
  --min-score <n>    Exit 1 if the score is below n (CI gating)
  --verbose, -v      Show passing checks and all findings
  --no-color         Disable colors
```

**`--fix` is conservative.** It creates missing files and appends to existing ones (`.gitignore`,
missing sections in your context doc). It never rewrites content you wrote unless you pass
`--force`, and it always prints a diff. Generated docs never recommend scripts that publish or delete.

## What it checks

| Category           | Weight | Checks                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Context docs**   | 30%    | `AGENTS.md` / `CLAUDE.md` / `.cursor/rules` / Copilot / Gemini instructions exist · they list exact build, test and lint commands · they describe architecture and key directories · **not stale**: every referenced path and `npm run` script actually exists · not too long (or too thin) · both `AGENTS.md` and `CLAUDE.md` so every agent is covered |
| **Feedback loops** | 25%    | A discoverable test command (package.json `test`, pytest config, `make test`) · linter configured (eslint, biome, oxlint, ruff, flake8) · typecheck command (`tsc`, mypy, pyright) · CI config · `--run`: test suite passes and is fast                                                                                                                  |
| **Navigability**   | 20%    | `node_modules`, `.venv`, `dist`, caches ignored (and not committed) · no source files over 1000 lines · no minified/vendored/generated blobs in agent view · shallow directory tree · README                                                                                                                                                             |
| **Type safety**    | 15%    | TypeScript `strict` (follows `extends`), `any` / `@ts-ignore` / `@ts-nocheck` density · plain JS penalized · Python type-hint coverage estimate + mypy/pyright config                                                                                                                                                                                    |
| **Safety**         | 10%    | Committed `.env` / keys / credentials files · AWS, GitHub, Slack, Stripe, OpenAI, Anthropic, Google, npm token patterns · dangerous scripts: `rm -rf ~`, `curl \| sh`, force-push, `npm publish` hidden in `build`/`test`, network calls in install hooks                                                                                                |

Checks that don't apply (e.g. Python checks in a TS repo) are marked n/a and excluded from the score.
"Agent-visible" means what ripgrep-based agents actually see: `git ls-files` minus anything in
`.gitignore`, `.ignore`, `.rgignore` or `.cursorignore`.

## CI: fail PRs that make your repo worse for agents

```yaml
# .github/workflows/agent-ready.yml
name: agent-ready
on: [pull_request]
jobs:
  agent-ready:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx --yes agent-ready@latest . --min-score 75
```

A reusable composite action is also included (`action.yml`, inputs `path`, `min-score`, `version`;
output `score`, plus a job summary). See [`examples/github-action.yml`](examples/github-action.yml).

## Configuration

Optional `agent-ready.config.json` (or an `"agent-ready"` key in package.json):

```json
{
  "ignore": ["test/fixtures/**", "vendor/**"],
  "disable": ["nav.depth", "types"]
}
```

`disable` takes check ids (`--verbose` and `--json` show them) or whole categories. Silence a single
secret false positive with an `agent-ready-ignore` comment on the same line.

## Programmatic API

```ts
import { scan, builtinChecks, type Check } from 'agent-ready';

const noTodos: Check = {
  id: 'custom.no-todo-md',
  category: 'context',
  title: 'No TODO.md left lying around',
  weight: 1,
  run: (ctx) =>
    ctx.has('TODO.md') ? { score: 0, summary: 'TODO.md found' } : { score: 1, summary: 'clean' },
};

const report = await scan('.', { checks: [...builtinChecks, noTodos] });
console.log(report.score, report.categories);
```

Every check is a plain object with `run(ctx)` returning a 0–1 score and optional `fix(ctx)` that
proposes file changes. Adding one is ~30 lines — see [CONTRIBUTING.md](CONTRIBUTING.md).

## How is this different from a linter?

ESLint tells you your code is wrong. `agent-ready` tells you your **repo** is hard to work in —
for the coworker who reads every file literally, never asks a clarifying question, and runs
whatever `npm run build` does.

## Roadmap

- [ ] Go, Rust and Java/Kotlin support
- [ ] `--run` for lint/typecheck too, and flaky-test detection (run twice, compare)
- [ ] Monorepo awareness: score each workspace package, check nested `AGENTS.md`
- [ ] Doc staleness via git history (doc untouched while referenced code churned)
- [ ] MCP/tooling checks (`.mcp.json`, Claude Code hooks, `.claude/settings.json` permissions)
- [ ] Smarter `--fix`: `tsconfig` strict migration plan, `.cursorignore` for generated code, `.env.example`
- [ ] SARIF output for GitHub code scanning
- [ ] Public leaderboard of popular open-source repos

Ideas and PRs welcome — especially new checks backed by real agent failure modes.

## License

MIT
