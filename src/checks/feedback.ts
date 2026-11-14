import { spawnSync } from 'node:child_process';
import { type RepoContext, runScriptCmd } from '../context.js';
import type { Check, CheckResult } from '../types.js';

const JS_TEST_DEPS = [
  'vitest',
  'jest',
  'mocha',
  'ava',
  'tap',
  'uvu',
  '@playwright/test',
  'jasmine',
  'node:test',
];

function pyHas(ctx: RepoContext, section: string): boolean {
  return ctx.pyproject?.includes(`[${section}`) ?? false;
}

function hasJs(ctx: RepoContext): boolean {
  return ctx.pkg !== null;
}

function hasPy(ctx: RepoContext): boolean {
  return ctx.languages.includes('python');
}

function realTestScript(ctx: RepoContext): string | null {
  const t = ctx.scripts().test;
  if (!t || /no test specified/i.test(t)) return null;
  return t;
}

function pyTestFiles(ctx: RepoContext): string[] {
  return ctx.files.filter((f) => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(f));
}

function pytestConfigured(ctx: RepoContext): boolean {
  return (
    pyHas(ctx, 'tool.pytest') ||
    ctx.has('pytest.ini') ||
    ctx.has('conftest.py') ||
    ctx.files.some((f) => f.endsWith('/conftest.py')) ||
    /\[tool:pytest\]/.test(ctx.read('setup.cfg') ?? '') ||
    /\[pytest\]/.test(ctx.read('tox.ini') ?? '') ||
    ctx.has('tox.ini') ||
    ctx.has('noxfile.py')
  );
}

function makeTarget(ctx: RepoContext, name: string): boolean {
  const mk = ctx.read('Makefile') ?? ctx.read('justfile') ?? '';
  return new RegExp(`^${name}\\s*:`, 'm').test(mk);
}

/** The command agent-ready would use to run tests, or null if unknown. */
export function testCommand(ctx: RepoContext): string | null {
  if (realTestScript(ctx)) return runScriptCmd(ctx, 'test');
  if (makeTarget(ctx, 'test')) return 'make test';
  if (hasPy(ctx) && (pytestConfigured(ctx) || pyTestFiles(ctx).length)) {
    if (ctx.has('uv.lock')) return 'uv run pytest -q';
    if (ctx.has('poetry.lock')) return 'poetry run pytest -q';
    return 'python3 -m pytest -q';
  }
  return null;
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export const feedbackChecks: Check[] = [
  {
    id: 'feedback.test',
    category: 'feedback',
    title: 'Test command is discoverable',
    weight: 4,
    run(ctx): CheckResult {
      const parts: number[] = [];
      const notes: string[] = [];
      if (hasJs(ctx)) {
        const deps = ctx.allDeps();
        const framework = JS_TEST_DEPS.find((d) => d in deps);
        const testFiles = ctx.files.filter(
          (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || /(^|\/)__tests__\//.test(f),
        );
        if (realTestScript(ctx)) {
          parts.push(1);
          notes.push(`\`${runScriptCmd(ctx, 'test')}\``);
        } else if (makeTarget(ctx, 'test')) {
          parts.push(1);
          notes.push('`make test`');
        } else if (framework || testFiles.length) {
          parts.push(0.4);
          notes.push(`tests exist but no "test" script`);
        } else {
          parts.push(0);
          notes.push('no JS tests');
        }
      }
      if (hasPy(ctx)) {
        const files = pyTestFiles(ctx);
        if (files.length && (pytestConfigured(ctx) || makeTarget(ctx, 'test'))) {
          parts.push(1);
          notes.push(`pytest (${files.length} test files)`);
        } else if (files.length) {
          parts.push(0.75);
          notes.push(`${files.length} test files, no pytest config`);
        } else if (pytestConfigured(ctx)) {
          parts.push(0.5);
          notes.push('pytest configured but no test files found');
        } else {
          parts.push(0);
          notes.push('no Python tests');
        }
      }
      const score = avg(parts);
      if (score === null) return { score: null, summary: 'No JS/TS or Python project detected' };
      return {
        score,
        summary: `Tests: ${notes.join('; ')}`,
        suggestion:
          score < 1
            ? 'Give agents one obvious command to verify their work: a "test" script in package.json, or pytest config in pyproject.toml.'
            : undefined,
      };
    },
  },
  {
    id: 'feedback.lint',
    category: 'feedback',
    title: 'Linter configured',
    weight: 2,
    run(ctx): CheckResult {
      const parts: number[] = [];
      const notes: string[] = [];
      if (hasJs(ctx)) {
        const deps = ctx.allDeps();
        const scripts = ctx.scripts();
        const eslint =
          ctx.files.some((f) => /(^|\/)(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.\w+)?)$/.test(f)) ||
          ctx.pkg?.eslintConfig !== undefined;
        const biome = ctx.has('biome.json') || ctx.has('biome.jsonc');
        const oxlint = ctx.has('.oxlintrc.json') || 'oxlint' in deps;
        const tool = eslint ? 'eslint' : biome ? 'biome' : oxlint ? 'oxlint' : null;
        if (tool) {
          parts.push(scripts.lint ? 1 : 0.8);
          notes.push(
            scripts.lint ? `${tool} via "lint" script` : `${tool} configured (no "lint" script)`,
          );
        } else if (scripts.lint) {
          parts.push(0.8);
          notes.push('"lint" script');
        } else if (ctx.files.some((f) => /(^|\/)\.prettierrc/.test(f)) || 'prettier' in deps) {
          parts.push(0.3);
          notes.push('formatter only (prettier)');
        } else {
          parts.push(0);
          notes.push('no JS linter');
        }
      }
      if (hasPy(ctx)) {
        const setupCfg = ctx.read('setup.cfg') ?? '';
        const ruff = pyHas(ctx, 'tool.ruff') || ctx.has('ruff.toml') || ctx.has('.ruff.toml');
        const other =
          ctx.has('.flake8') ||
          /\[flake8\]/.test(setupCfg) ||
          ctx.has('.pylintrc') ||
          pyHas(ctx, 'tool.pylint');
        const black = pyHas(ctx, 'tool.black');
        if (ruff || other) {
          parts.push(1);
          notes.push(ruff ? 'ruff' : 'flake8/pylint');
        } else if (black) {
          parts.push(0.3);
          notes.push('formatter only (black)');
        } else {
          parts.push(0);
          notes.push('no Python linter');
        }
      }
      const score = avg(parts);
      if (score === null) return { score: null, summary: 'No JS/TS or Python project detected' };
      return {
        score,
        summary: `Lint: ${notes.join('; ')}`,
        suggestion:
          score < 1
            ? 'Configure a fast linter (eslint/biome for JS, ruff for Python) and expose it as a `lint` script.'
            : undefined,
      };
    },
  },
  {
    id: 'feedback.typecheck',
    category: 'feedback',
    title: 'Typecheck command available',
    weight: 2,
    run(ctx): CheckResult {
      const parts: number[] = [];
      const notes: string[] = [];
      if (ctx.languages.includes('typescript')) {
        const scripts = Object.values(ctx.scripts());
        if (scripts.some((s) => /\b(tsc|vue-tsc|svelte-check|tsgo)\b/.test(s))) {
          parts.push(1);
          notes.push('tsc in scripts');
        } else if (ctx.has('tsconfig.json')) {
          parts.push(0.6);
          notes.push('tsconfig.json but no typecheck script');
        } else {
          parts.push(0.2);
          notes.push('TypeScript without tsconfig.json');
        }
      }
      if (hasPy(ctx)) {
        const mypy =
          pyHas(ctx, 'tool.mypy') ||
          ctx.has('mypy.ini') ||
          /\[mypy\]/.test(ctx.read('setup.cfg') ?? '');
        const pyright =
          pyHas(ctx, 'tool.pyright') ||
          pyHas(ctx, 'tool.basedpyright') ||
          ctx.has('pyrightconfig.json');
        if (mypy || pyright) {
          parts.push(1);
          notes.push(mypy ? 'mypy' : 'pyright');
        } else {
          parts.push(0);
          notes.push('no mypy/pyright config');
        }
      }
      const score = avg(parts);
      if (score === null) return { score: null, summary: 'No typed language detected' };
      return {
        score,
        summary: `Typecheck: ${notes.join('; ')}`,
        suggestion:
          score < 1
            ? 'Add a `typecheck` script (`tsc --noEmit`) or a mypy/pyright config so agents can catch type errors fast.'
            : undefined,
      };
    },
  },
  {
    id: 'feedback.ci',
    category: 'feedback',
    title: 'CI runs checks',
    weight: 1,
    run(ctx): CheckResult {
      const ci = ctx.files.find(
        (f) =>
          /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) ||
          f === '.gitlab-ci.yml' ||
          f.startsWith('.circleci/') ||
          f === 'azure-pipelines.yml' ||
          f === 'Jenkinsfile' ||
          f === '.travis.yml' ||
          f === 'bitbucket-pipelines.yml' ||
          f.startsWith('.buildkite/'),
      );
      return ci
        ? { score: 1, summary: `CI config: ${ci}` }
        : {
            score: 0,
            summary: 'No CI config found',
            suggestion:
              'Add CI (e.g. `.github/workflows/ci.yml`) so agents and reviewers share one definition of "green".',
          };
    },
  },
  {
    id: 'feedback.speed',
    category: 'feedback',
    title: 'Tests run fast',
    weight: 2,
    run(ctx, opts): CheckResult {
      if (!opts.run) return { score: null, summary: 'Skipped (pass --run to time the test suite)' };
      const cmd = testCommand(ctx);
      if (!cmd) return { score: 0, summary: 'No test command to run' };
      const start = Date.now();
      const res = spawnSync(cmd, {
        cwd: ctx.root,
        shell: true,
        stdio: 'ignore',
        timeout: opts.runTimeoutMs,
        env: { ...process.env, CI: '1' },
      });
      const secs = (Date.now() - start) / 1000;
      if (res.error && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
        return {
          score: 0.1,
          summary: `\`${cmd}\` timed out after ${Math.round(secs)}s`,
          suggestion: 'Provide a fast subset (e.g. `test:unit`) agents can run in seconds.',
        };
      }
      if (res.status !== 0) {
        return {
          score: 0.3,
          summary: `\`${cmd}\` failed (exit ${res.status}) in ${secs.toFixed(1)}s`,
          suggestion:
            'A red baseline means agents cannot tell whether they broke something. Fix or quarantine failing tests.',
        };
      }
      const score = secs < 10 ? 1 : secs < 30 ? 0.85 : secs < 60 ? 0.7 : secs < 180 ? 0.4 : 0.2;
      return {
        score,
        summary: `\`${cmd}\` passed in ${secs.toFixed(1)}s`,
        suggestion:
          score < 1
            ? 'Slow suites get skipped. Offer a quick target that runs in under 10s.'
            : undefined,
      };
    },
  },
];
