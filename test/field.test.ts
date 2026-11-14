import { describe, expect, it } from 'vitest';
import { scan } from '../src/scan.js';
import type { Report } from '../src/types.js';
import { FAKE_AWS_KEY, FAKE_GH_TOKEN, fakePrivateKey, fixture } from './helpers.js';

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
