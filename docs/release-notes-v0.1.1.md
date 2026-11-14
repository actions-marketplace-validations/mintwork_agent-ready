# Agent Readiness Score v0.1.1

**Lighthouse for AI coding agents, now on the GitHub Marketplace.** Score how well Claude Code,
Codex and Cursor can work in your repository, and keep it from regressing in CI.

## Use the Action

```yaml
name: agent-ready
on: [pull_request]
jobs:
  score:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: mintwork/agent-ready@v0
        with:
          min-score: 75 # fail the check below this score
```

| Input       | Default              |                                            |
| ----------- | -------------------- | ------------------------------------------ |
| `path`      | `.`                  | Directory to scan                          |
| `min-score` | `0`                  | Fail if the score is below this (0–100)    |
| `version`   | the action's version | `@mintwork/agent-ready` npm version to run |

**Output:** `score` (0–100). The job summary shows the full report and a README badge.

## Or run it locally

```bash
npx @mintwork/agent-ready          # score this repo
npx @mintwork/agent-ready --fix    # write a starter AGENTS.md / CLAUDE.md and fix ignore gaps
npx @mintwork/agent-ready --badge  # README badge
```

## What's new in 0.1.1

- Action metadata for the GitHub Marketplace listing.
- Released with npm trusted publishing (OIDC): no npm token exists for this package, and every
  version carries signed provenance.

Full feature list: [v0.1.0](https://github.com/mintwork/agent-ready/releases/tag/v0.1.0) ·
[Changelog](https://github.com/mintwork/agent-ready/blob/main/CHANGELOG.md)
