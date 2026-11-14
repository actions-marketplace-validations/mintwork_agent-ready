# Contributing to agent-ready

Thanks for helping make repos friendlier to AI agents!

## Setup

```bash
git clone <your fork> && cd agent-ready
npm install
npm run check        # typecheck + lint + tests
npm run build && node dist/bin.js .
```

Requires Node 20+. There are **no runtime dependencies** and we'd like to keep it that way.

## Adding a check

1. Pick the category file in `src/checks/` (`context-docs.ts`, `feedback.ts`, `navigability.ts`,
   `type-safety.ts`, `safety.ts`).
2. Add a `Check` object:

   ```ts
   {
     id: 'nav.my-check',          // <category-prefix>.<kebab-name>, stable forever
     category: 'navigability',
     title: 'Short, positive statement of the goal',
     weight: 1,                   // relative to other checks in the category
     run(ctx) {
       // ctx.files is the agent-visible file list; ctx.read / ctx.has / ctx.scripts() etc.
       return { score: 1, summary: 'one line', findings: [], suggestion: 'what to do' };
     },
     fix(ctx) { return []; },     // optional: propose FileChange[]; never write to disk
   }
   ```

   Return `score: null` when the check doesn't apply to the repo.
3. Add tests in `test/` using `fixture()` from `test/helpers.ts` — one repo that fails the check,
   one that passes. Generate large files or fake secrets in the test, not in `test/fixtures/`.
4. Keep it fast: the whole scan should stay well under 2 seconds on a typical repo. Don't execute
   project code outside of `--run`.

## Ground rules for checks

- **Every check should map to a real agent failure mode.** "Agents edited a deleted file because
  CLAUDE.md said it existed" is a great reason; "I prefer tabs" is not.
- Prefer false negatives over false positives. A noisy linter gets uninstalled.
- Changing weights changes everyone's badge — call it out in the PR description.

## Commits & PRs

Small, focused PRs with a test. Run `npm run check` before pushing.

## Demo GIF

`npm run demo:gif` rebuilds `docs/demo.gif` (and the still `docs/demo.png`) from the real CLI
running on a synthetic repo generated in a temp dir. It needs Google Chrome (driven by Playwright,
`channel: 'chrome'`) and `ffmpeg` (on `PATH`, at `/opt/homebrew/bin/ffmpeg`, or set `FFMPEG`).
Re-run it whenever the terminal output changes.

## Releasing

Releases are tagged `vX.Y.Z` (annotated). The GitHub Action is consumed via a moving major tag
(`uses: ranjan-mohanty/agent-ready@v0`), and by default it runs the npm version in `package.json`
at that tag, so **publish to npm before moving the tag**.

1. Bump `version` in `package.json` (`src/version.ts` reads it at runtime), update `CHANGELOG.md`, commit.
2. `npm run check && npm run build && npm pack --dry-run` and sanity-check the file list.
3. Tag and publish:

   ```bash
   git tag -a v0.2.0 -m "agent-ready v0.2.0"
   npm publish
   git push origin main v0.2.0
   ```

4. Move the major tag to the same commit and force-push it:

   ```bash
   git tag -fa v0 -m "agent-ready v0 -> v0.2.0" v0.2.0^{commit}
   git push origin v0 --force
   ```

   Only move `v0` for backwards-compatible releases. A breaking change to the action's inputs or
   outputs (or a 1.0) gets a new major tag (`v1`) instead.
