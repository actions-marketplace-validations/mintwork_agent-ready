import { basename } from 'node:path';
import { isDangerousScript } from '../checks/safety.js';
import { type RepoContext, runScriptCmd } from '../context.js';

const DIR_HINTS: Record<string, string> = {
  src: 'Main source code',
  lib: 'Library source code',
  app: 'Application code / routes',
  pages: 'Page routes',
  components: 'UI components',
  packages: 'Workspace packages (monorepo)',
  apps: 'Deployable apps (monorepo)',
  test: 'Tests',
  tests: 'Tests',
  __tests__: 'Tests',
  spec: 'Tests',
  docs: 'Documentation',
  scripts: 'Developer / build scripts',
  bin: 'CLI entry points',
  public: 'Static assets',
  assets: 'Static assets',
  examples: 'Usage examples',
  config: 'Configuration',
  migrations: 'Database migrations',
  api: 'API layer',
  server: 'Server code',
  client: 'Client code',
  cli: 'Command-line interface',
  utils: 'Shared utilities',
  types: 'Shared type definitions',
  fixtures: 'Test fixtures',
  '.github': 'CI workflows and GitHub config',
};

function pyHas(ctx: RepoContext, section: string): boolean {
  return ctx.pyproject?.includes(`[${section}`) ?? false;
}

interface Cmd {
  label: string;
  cmd: string;
}

export function detectCommands(ctx: RepoContext): Cmd[] {
  const cmds: Cmd[] = [];
  const scripts = ctx.scripts();
  if (ctx.pkg) {
    cmds.push({
      label: 'Install dependencies',
      cmd: ctx.packageManager === 'npm' ? 'npm install' : `${ctx.packageManager} install`,
    });
    const wanted: Array<[string, string]> = [
      ['dev', 'Start dev mode'],
      ['build', 'Build'],
      ['test', 'Run tests'],
      ['lint', 'Lint'],
      ['typecheck', 'Typecheck'],
      ['type-check', 'Typecheck'],
      ['format', 'Format'],
    ];
    for (const [name, label] of wanted) {
      const body = scripts[name];
      if (body && !/no test specified/.test(body) && !isDangerousScript(body))
        cmds.push({ label, cmd: runScriptCmd(ctx, name) });
    }
    if (!scripts.typecheck && !scripts['type-check'] && ctx.has('tsconfig.json')) {
      cmds.push({ label: 'Typecheck', cmd: 'npx tsc --noEmit' });
    }
  }
  if (ctx.languages.includes('python')) {
    const uv = ctx.has('uv.lock');
    const poetry = ctx.has('poetry.lock') || pyHas(ctx, 'tool.poetry');
    const run = uv ? 'uv run ' : poetry ? 'poetry run ' : '';
    if (uv) cmds.push({ label: 'Install dependencies', cmd: 'uv sync' });
    else if (poetry) cmds.push({ label: 'Install dependencies', cmd: 'poetry install' });
    else if (ctx.pyproject) cmds.push({ label: 'Install dependencies', cmd: 'pip install -e .' });
    else if (ctx.has('requirements.txt'))
      cmds.push({ label: 'Install dependencies', cmd: 'pip install -r requirements.txt' });
    const hasPyTests =
      ctx.files.some((f) => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(f)) ||
      pyHas(ctx, 'tool.pytest');
    if (hasPyTests) cmds.push({ label: 'Run tests', cmd: `${run}pytest` });
    if (pyHas(ctx, 'tool.ruff') || ctx.has('ruff.toml') || ctx.has('.ruff.toml')) {
      cmds.push({ label: 'Lint', cmd: `${run}ruff check .` });
    } else if (ctx.has('.flake8')) {
      cmds.push({ label: 'Lint', cmd: `${run}flake8` });
    }
    if (pyHas(ctx, 'tool.mypy') || ctx.has('mypy.ini'))
      cmds.push({ label: 'Typecheck', cmd: `${run}mypy .` });
    else if (pyHas(ctx, 'tool.pyright') || ctx.has('pyrightconfig.json'))
      cmds.push({ label: 'Typecheck', cmd: `${run}pyright` });
  }
  if (ctx.languages.includes('rust') && ctx.has('Cargo.toml')) {
    cmds.push({ label: 'Build (Rust)', cmd: 'cargo build' });
    cmds.push({ label: 'Run tests (Rust)', cmd: 'cargo test' });
    cmds.push({ label: 'Lint (Rust)', cmd: 'cargo clippy --all-targets' });
    cmds.push({ label: 'Format (Rust)', cmd: 'cargo fmt' });
  }
  if (ctx.languages.includes('go') && ctx.has('go.mod')) {
    cmds.push({ label: 'Build (Go)', cmd: 'go build ./...' });
    if (ctx.files.some((f) => f.endsWith('_test.go')))
      cmds.push({ label: 'Run tests (Go)', cmd: 'go test ./...' });
    const golangci = ctx.files.some((f) => /^\.golangci\.(ya?ml|toml|json)$/.test(f));
    cmds.push(
      golangci
        ? { label: 'Lint (Go)', cmd: 'golangci-lint run' }
        : { label: 'Vet (Go)', cmd: 'go vet ./...' },
    );
  }
  const makefile = ctx.read('Makefile');
  if (makefile && cmds.length <= 1) {
    for (const target of ['build', 'test', 'lint', 'check']) {
      if (new RegExp(`^${target}:`, 'm').test(makefile))
        cmds.push({ label: `make ${target}`, cmd: `make ${target}` });
    }
  }
  // de-dupe by command
  const seen = new Set<string>();
  return cmds.filter((c) => {
    if (seen.has(c.cmd)) return false;
    seen.add(c.cmd);
    return true;
  });
}

function projectName(ctx: RepoContext): string {
  if (ctx.pkg?.name) return ctx.pkg.name;
  const m = ctx.pyproject?.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  return m?.[1] ?? basename(ctx.root);
}

function projectDescription(ctx: RepoContext): string | null {
  if (ctx.pkg?.description) return ctx.pkg.description;
  const m = ctx.pyproject?.match(/^\s*description\s*=\s*["']([^"']+)["']/m);
  return m?.[1] ?? null;
}

export function commandsSection(ctx: RepoContext): string[] {
  const cmds = detectCommands(ctx);
  const lines = ['## Commands', ''];
  if (cmds.length) {
    lines.push('```bash');
    const width = Math.max(...cmds.map((c) => c.cmd.length));
    for (const c of cmds) lines.push(`${c.cmd.padEnd(width)}  # ${c.label}`);
    lines.push('```', '');
  } else {
    lines.push('<!-- TODO: add the exact commands to build, test and lint this project. -->', '');
  }
  lines.push('Always run the test and lint commands before declaring a task done.', '');
  return lines;
}

export function architectureSection(ctx: RepoContext): string[] {
  const topDirs = [
    ...new Set(ctx.files.filter((f) => f.includes('/')).map((f) => f.split('/')[0] as string)),
  ]
    .filter((d) => !d.startsWith('.') || d === '.github')
    .sort();
  const lines = ['## Architecture', ''];
  if (topDirs.length) {
    for (const d of topDirs) lines.push(`- \`${d}/\` — ${DIR_HINTS[d] ?? 'TODO: describe'}`);
    lines.push('');
  } else {
    lines.push('<!-- TODO: describe the main modules and how they fit together. -->', '');
  }
  return lines;
}

export function generateAgentsMd(ctx: RepoContext): string {
  const name = projectName(ctx);
  const desc = projectDescription(ctx);
  const LABELS: Record<string, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    python: 'Python',
    go: 'Go',
    rust: 'Rust',
  };
  const langs = ctx.languages.map((l) => LABELS[l] ?? l);
  const lines: string[] = [];
  lines.push('# AGENTS.md', '');
  lines.push(
    `Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot) working on **${name}**.`,
  );
  lines.push(
    '<!-- Generated by agent-ready. Review and edit: hand-written context beats generated context. -->',
    '',
  );
  lines.push('## Overview', '');
  if (desc) lines.push(desc, '');
  if (langs.length) lines.push(`Languages: ${langs.join(', ')}.`, '');

  lines.push(...commandsSection(ctx), ...architectureSection(ctx));

  lines.push('## Conventions', '');
  lines.push('- Keep changes small and focused; match the existing code style.');
  if (ctx.languages.includes('typescript'))
    lines.push('- TypeScript: avoid `any`; keep the typecheck passing.');
  if (ctx.languages.includes('python')) lines.push('- Python: add type hints to new functions.');
  lines.push('- Add or update tests alongside behavior changes.');
  lines.push('- Never commit secrets; use environment variables.', '');

  lines.push('## Gotchas', '');
  lines.push(
    '<!-- TODO: non-obvious things an agent should know (env setup, flaky tests, generated code). -->',
    '',
  );
  return lines.join('\n');
}

export function generateClaudeMd(): string {
  return [
    '# CLAUDE.md',
    '',
    'Project instructions are shared with other agents in AGENTS.md:',
    '',
    '@AGENTS.md',
    '',
  ].join('\n');
}
