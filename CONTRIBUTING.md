# Contributing to agent-ready

Thanks for helping make repos friendlier to AI agents!

## Setup

```bash
git clone <your fork> && cd agent-ready
npm install
npm run check        # typecheck + lint + tests
npm run build && node dist/bin.js .
```

Requires Node 22+. There are **no runtime dependencies** and we'd like to keep it that way.

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

Releases are tagged `vX.Y.Z`. The GitHub Action is consumed via the moving major tag
(`uses: ranjan-mohanty/agent-ready@v0`), and by default it runs the npm version in `package.json`
at that tag. The [release workflow](.github/workflows/release.yml) handles both: publishing a
GitHub Release publishes to npm (with provenance) **and then** moves `v0`.

1. Bump `version` in `package.json` (`src/version.ts` reads it at runtime), update `CHANGELOG.md`,
   add `docs/release-notes-vX.Y.Z.md`, commit and push.
2. `npm run check && npm run build && npm pack --dry-run` and sanity-check the file list.
3. Create the release; the workflow checks that the tag matches `package.json`, runs the checks,
   publishes to npm and moves `v0`:

   ```bash
   gh release create v0.2.0 --title "agent-ready v0.2.0" --notes-file docs/release-notes-v0.2.0.md
   ```

Only backwards-compatible releases should move `v0`. For a breaking change to the action's inputs
or outputs (or a 1.0), change the major tag in the release workflow to `v1` first.

**npm auth:** the workflow uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers)
(configure `ranjan-mohanty/agent-ready` + `release.yml` on the package's npm settings page), or
an `NPM_TOKEN` repository secret as a fallback. If a version is already on npm (for example the
first release, published by hand), the publish step is skipped.
