import { describe, expect, it } from 'vitest';
import { scan } from '../src/scan.js';
import type { Report } from '../src/types.js';
import { bigFile, FAKE_AWS_KEY, FAKE_GH_TOKEN, fakePrivateKey, fixture } from './helpers.js';

// Regressions for false positives found by field-testing agent-ready on popular open-source repos.
// Every snippet here is synthetic.

function check(report: Report, id: string) {
  const c = report.checks.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
}

describe('secrets: test fixtures and example values', () => {
  it('does not treat .env.*.example templates as dotenv files', async () => {
    const r = await scan(
      fixture('good-ts', {
        git: true,
        files: {
          '.env.local.example': 'API_KEY=your-key-here\n',
          'examples/demo/.env.production.sample': 'TOKEN=\n',
        },
      }),
    );
    expect(check(r, 'safety.secrets').score).toBe(1);
  });

  it('only flags .pem/.key files that contain a private key', async () => {
    const cert = [
      '-----BEGIN ',
      'CERTIFICATE-----\nMIIB',
      'q'.repeat(60),
      '\n-----END CERTIFICATE-----\n',
    ];
    const certOnly = await scan(
      fixture('good-ts', { git: true, files: { 'certs/ca.pem': cert.join('') } }),
    );
    expect(check(certOnly, 'safety.secrets').score).toBe(1);
    const key = await scan(
      fixture('good-ts', { git: true, files: { 'deploy/server.key': fakePrivateKey() } }),
    );
    expect(check(key, 'safety.secrets').score).toBeLessThan(1);
  });

  it('ignores a private-key header without a key body (docs, parsers)', async () => {
    const header = ['-----BEGIN RSA ', 'PRIVATE', ' KEY-----'].join('');
    const r = await scan(
      fixture('good-ts', {
        git: true,
        files: {
          'docs/env.md': `PRIVATE_KEY="${header}\n...\n-----END RSA PRIVATE KEY-----"\n`,
          'src/pem.ts': `export const isPem = (s: string) => s.startsWith('${header}');\n`,
        },
      }),
    );
    expect(check(r, 'safety.secrets').score).toBe(1);
  });

  it('reports keys in tests or next to "test"/"redacted" as info without penalty', async () => {
    const r = await scan(
      fixture('good-ts', {
        git: true,
        files: {
          'tests/fixtures/server-key.pem': fakePrivateKey(),
          'tests/conftest.py': `AWS_KEY = '${FAKE_AWS_KEY}'\n`,
          'src/lib.rs': `#[cfg(test)]\nfn test_key() -> &'static str {\n    r#"${fakePrivateKey()}"#\n}\n`,
          'src/mask.ts': `export const cases = [['${FAKE_GH_TOKEN}', '<redacted>']];\n`,
        },
      }),
    );
    const s = check(r, 'safety.secrets');
    expect(s.score).toBe(1);
    expect(s.findings?.every((f) => f.severity === 'info')).toBe(true);
    expect(s.summary).toMatch(/4 test\/example value/);
  });

  it('still flags a real-looking key in product code', async () => {
    const r = await scan(
      fixture('good-ts', {
        git: true,
        files: { 'src/client.ts': `export const token = '${FAKE_GH_TOKEN}';\n` },
      }),
    );
    expect(check(r, 'safety.secrets').score).toBeLessThan(1);
  });

  it('judges nested .env files under examples/ by content', async () => {
    const r = await scan(
      fixture('good-ts', {
        git: true,
        files: { 'examples/auth/.env': 'AUTH_SECRET=\nNEXT_PUBLIC_URL=http://localhost:3000\n' },
      }),
    );
    expect(check(r, 'safety.secrets').score).toBe(1);
  });
});

describe('dangerous scripts', () => {
  it('does not flag scripts whose name says what they do', async () => {
    const r = await scan(
      fixture('good-ts', {
        git: true,
        files: {
          'package.json': JSON.stringify({
            name: 'x',
            scripts: {
              'git-reset': 'git reset --hard HEAD',
              clean: 'git clean -fdx',
              test: 'vitest',
            },
          }),
        },
      }),
    );
    expect(check(r, 'safety.scripts').score).toBe(1);
  });

  it('still flags destructive commands hidden behind innocuous names', async () => {
    const r = await scan(
      fixture('good-ts', {
        git: true,
        files: {
          'package.json': JSON.stringify({
            name: 'x',
            scripts: { dev: 'git reset --hard && vite' },
          }),
        },
      }),
    );
    expect(check(r, 'safety.scripts').score).toBeLessThan(1);
  });
});

describe('context docs: staleness and discovery', () => {
  const agents = (body: string) => ['# AGENTS.md', '', '## Architecture', '', body, ''].join('\n');

  it('resolves monorepo-relative, gitignored and build-output paths', async () => {
    const r = await scan(
      fixture('good-ts', {
        git: true,
        files: {
          'packages/core/src/cli/main.ts': 'export {};\n',
          '.gitignore': 'node_modules/\ndist/\n.cache-local/\n',
          'AGENTS.md': agents(
            'Entry: `src/cli/main.ts` (in `packages/core`). Output goes to `packages/core/dist/` and `.cache-local/run.json`.',
          ),
        },
      }),
    );
    const f = check(r, 'context.fresh');
    expect(f.findings ?? []).toEqual([]);
  });

  it('skips import specifiers, owner/repo names, hosts and bare extensions', async () => {
    const md = agents(
      [
        'Use `next/font` and `zod/mini`; upstream is `vercel/next.js` and `cli/cli`.',
        'Module path `github.com/acme/tool/v2`. Applies to `.ts` and `.tsx` files.',
        'The run writes `manifest.json` and `.opencode/`.',
      ].join('\n'),
    );
    const r = await scan(fixture('good-ts', { git: true, files: { 'AGENTS.md': md } }));
    expect(check(r, 'context.fresh').findings ?? []).toEqual([]);
  });

  it('still flags stale paths under real directories', async () => {
    const md = agents('Main logic lives in `src/legacy/old-entry.ts`; see `docs/GUIDE.md`.');
    const r = await scan(
      fixture('good-ts', { git: true, files: { 'AGENTS.md': md, 'docs/intro.md': '# x\n' } }),
    );
    const msgs = (check(r, 'context.fresh').findings ?? []).map((f) => f.message);
    expect(msgs).toEqual([
      'references missing path `src/legacy/old-entry.ts`',
      'references missing path `docs/GUIDE.md`',
    ]);
  });

  it('counts a duplicated CLAUDE.md (symlink/copy of AGENTS.md) once', async () => {
    const md = agents('See `src/legacy/gone.ts`.');
    const r = await scan(
      fixture('good-ts', { git: true, files: { 'AGENTS.md': md, 'CLAUDE.md': md } }),
    );
    expect(check(r, 'context.fresh').findings).toHaveLength(1);
  });

  it('does not treat `pnpm <dependency-bin>` as a missing script', async () => {
    const pkg = { name: 'x', scripts: { test: 'vitest' }, devDependencies: { prettier: '3' } };
    const md = agents('```bash\npnpm prettier --write .\n```');
    const r = await scan(
      fixture('good-ts', {
        git: true,
        files: { 'package.json': JSON.stringify(pkg), 'AGENTS.md': md },
      }),
    );
    expect(check(r, 'context.fresh').findings ?? []).toEqual([]);
  });

  it('does not count nested workflow docs under .github/ as repo-wide docs', async () => {
    const r = await scan(
      fixture(null, {
        git: true,
        files: { 'index.js': '', '.github/workflows/AGENTS.md': agents('Workflow notes.') },
      }),
    );
    expect(check(r, 'context.exists').score).toBe(0);
  });

  it('detects commands run through any task runner', async () => {
    const { detectCommands } = await import('../src/checks/context-docs.js');
    const md = '- `nub run build`\n- `nub exec --node vitest run`\n- `mise run lint`';
    expect([...detectCommands(md)].sort()).toEqual(['build', 'lint', 'test']);
    expect(detectCommands('```\ncargo clippy --workspace\n```').has('lint')).toBe(true);
    expect(detectCommands('`./runtests.py admin_views`').has('test')).toBe(true);
  });
});

describe('navigability: fixtures, generated code and big repos', () => {
  it('does not flag dependency dirs committed as test fixtures, or a source package named venv', async () => {
    const r = await scan(
      fixture('good-ts', {
        git: true,
        files: {
          'test/fixtures/resolve/node_modules/pkg/index.js': 'module.exports = 1;\n',
          'stubs/stdlib/venv/__init__.pyi': 'def create(env_dir: str) -> None: ...\n',
          'examples/auth/.env': 'AUTH_SECRET=\n',
        },
      }),
    );
    expect(check(r, 'nav.gitignore').findings ?? []).toEqual([]);
  });

  it('still flags a committed node_modules or real virtualenv', async () => {
    const r = await scan(
      fixture(null, {
        git: true,
        files: {
          'package.json': '{"name":"x"}',
          'node_modules/left-pad/index.js': 'module.exports = 1;\n',
          '.venv/pyvenv.cfg': 'home = /usr/bin\n',
        },
      }),
    );
    const msgs = (check(r, 'nav.gitignore').findings ?? []).map((f) => f.message).join('\n');
    expect(msgs).toMatch(/2 file\(s\) committed inside \.venv, node_modules/);
  });

  it('skips fixtures, baselines and files marked as generated when looking for oversized files', async () => {
    const long = (head: string) => `${head}\n${bigFile(1500)}\n`;
    const r = await scan(
      fixture('good-ts', {
        git: true,
        files: {
          'testdata/baselines/reference/big.js': long('// baseline'),
          'tests/fixtures/input.py': long('# fixture'),
          'crates/ast/src/generated.rs': long(
            '// This is a generated file. Do not modify it by hand!',
          ),
          'pkg/api/zz_generated.deepcopy.go': long('// Code generated by controller-gen.'),
        },
      }),
    );
    expect(check(r, 'nav.large-files').score).toBe(1);
  });

  it('scores a small share of large files in a big repo above zero', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 400; i++) files[`src/m${i}.ts`] = `export const v = ${i};\n`;
    for (let i = 0; i < 20; i++) files[`src/big${i}.ts`] = `${bigFile(1200)}\n`;
    const r = await scan(fixture('good-ts', { git: true, files }));
    const s = check(r, 'nav.large-files').score ?? 0;
    expect(s).toBeGreaterThan(0.1);
    expect(s).toBeLessThan(0.9);
  });
});

describe('type safety: python hints and monorepo tsconfigs', () => {
  it('counts annotations containing commas and defaults with calls', async () => {
    const { pythonAnnotationCoverage } = await import('../src/checks/type-safety.js');
    const src = [
      'def a(x: Dict[str, int], y: Annotated[str, Query(min_length=1, max_length=5)]):',
      '    pass',
      'def b(x: int = compute(1, 2), *, flag: bool = False):',
      '    pass',
      'def c(',
      '    items: list[tuple[int, str]],  # pairs (id, name)',
      '    **kwargs: Any,',
      '):',
      '    pass',
      'def d(x, y=f(1, 2)):',
      '    pass',
    ].join('\n');
    expect(pythonAnnotationCoverage(src)).toEqual({ total: 4, annotated: 3 });
  });

  it('measures product code, not test functions or docs examples', async () => {
    const typed = 'def handler(x: int) -> int:\n    return x\n';
    const files: Record<string, string> = {
      'pyproject.toml': '[project]\nname = "x"\n[tool.mypy]\nstrict = true\n',
      'pkg/core.py': typed.repeat(3),
      'tests/test_core.py': 'def test_a():\n    pass\n'.repeat(10),
      'docs_src/tutorial.py': 'def read(q=None):\n    return q\n'.repeat(10),
    };
    const r = await scan(fixture(null, { git: true, files }));
    expect(check(r, 'types.python').summary).toMatch(/~100% of 3 Python functions/);
  });

  it('judges strictness across package tsconfigs, resolving workspace extends', async () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'mono', private: true, scripts: { test: 'vitest' } }),
      // root config only covers repo scripts and is loose
      'tsconfig.json': '{ "compilerOptions": { "strict": false }, "include": ["scripts"] }',
      'packages/config/package.json': '{ "name": "@repo/tsconfig" }',
      'packages/config/base.json': '{ "compilerOptions": { "strict": true } }',
      'packages/a/tsconfig.json': '{ "extends": "@repo/tsconfig/base.json" }',
      'packages/b/tsconfig.json': '{ "extends": "@repo/tsconfig/base" }',
      'packages/c/tsconfig.json': '{ "extends": "../config/base.json" }',
      'packages/a/src/index.ts': 'export const a: number = 1;\n',
    };
    const r = await scan(fixture(null, { git: true, files }));
    const t = check(r, 'types.typescript');
    expect(t.summary).toMatch(/strict mode on in 3 of 4 tsconfigs/);
    expect(t.score).toBeGreaterThan(0.8);
  });

  it('skips solution-style tsconfigs that only hold references', async () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'x', scripts: { typecheck: 'tsc -b' } }),
      'tsconfig.json': '{ "files": [], "references": [{ "path": "./packages/a" }] }',
      'packages/a/tsconfig.json': '{ "compilerOptions": { "strict": true } }',
      'packages/a/src/index.ts': 'export const a = 1;\n',
    };
    const r = await scan(fixture(null, { git: true, files }));
    expect(check(r, 'types.typescript').score).toBe(1);
  });

  it('finds typecheck tasks run through monorepo runners and nested tsconfigs', async () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({
        name: 'x',
        scripts: { 'check-types': 'turbo run check-types' },
      }),
      'apps/web/tsconfig.json': '{ "compilerOptions": { "strict": true } }',
      'apps/web/src/index.ts': 'export const a = 1;\n',
    };
    const r = await scan(fixture(null, { git: true, files }));
    expect(check(r, 'feedback.typecheck').score).toBe(1);
    const noScript = await scan(
      fixture(null, {
        git: true,
        files: { ...files, 'package.json': '{"name":"x"}' },
      }),
    );
    expect(check(noScript, 'feedback.typecheck').summary).toMatch(/tsconfig.json but no typecheck/);
  });
});
