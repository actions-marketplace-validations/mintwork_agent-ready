import { describe, expect, it } from 'vitest';
import { scan } from '../src/scan.js';
import type { Report } from '../src/types.js';
import { bigFile, FAKE_AWS_KEY, fixture } from './helpers.js';

function check(report: Report, id: string) {
  const c = report.checks.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
}

describe('fixture scoring', () => {
  it('good TypeScript repo scores highly', async () => {
    const r = await scan(fixture('good-ts', { git: true }));
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.languages).toContain('typescript');
    expect(check(r, 'types.typescript').score).toBe(1);
  });

  it('good Python repo scores highly', async () => {
    const r = await scan(fixture('good-py', { git: true }));
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.languages).toEqual(['python']);
    expect(check(r, 'types.python').score).toBeGreaterThan(0.9);
    expect(check(r, 'feedback.test').score).toBe(1);
  });

  it('bad JS repo scores poorly and explains why', async () => {
    const dir = fixture('bad-js', {
      git: true,
      files: {
        'lib/huge.js': bigFile(1500),
        '.env': `AWS_ACCESS_KEY_ID=${FAKE_AWS_KEY}\n`,
        'lib/config.js': `module.exports = { key: '${FAKE_AWS_KEY}' };\n`,
      },
    });
    const r = await scan(dir);
    expect(r.score).toBeLessThan(40);
    expect(
      check(r, 'context.fresh')
        .findings?.map((f) => f.message)
        .join('\n'),
    ).toMatch(/old-entry\.js/);
    expect(
      check(r, 'context.fresh')
        .findings?.map((f) => f.message)
        .join('\n'),
    ).toMatch(/start:dev/);
    expect(check(r, 'nav.large-files').findings?.[0]?.file).toBe('lib/huge.js');
    const secrets = check(r, 'safety.secrets').findings ?? [];
    expect(secrets.map((f) => f.file)).toEqual(expect.arrayContaining(['.env', 'lib/config.js']));
    expect(check(r, 'safety.scripts').findings?.length).toBe(3);
    expect(check(r, 'feedback.test').score).toBe(0);
  });

  it('bad Python repo scores poorly', async () => {
    const r = await scan(fixture('bad-py', { git: true }));
    expect(r.score).toBeLessThan(40);
    expect(check(r, 'types.python').score).toBe(0);
    expect(check(r, 'context.exists').score).toBe(0);
    expect(check(r, 'safety.scripts').findings?.[0]?.message).toMatch(/force-push/);
  });

  it('works without git (filesystem walk)', async () => {
    const r = await scan(fixture('good-ts'));
    expect(r.score).toBeGreaterThanOrEqual(90);
  });

  it('flags unignored node_modules and tracked dist output', async () => {
    const dir = fixture('bad-js', {
      files: { 'node_modules/left-pad/index.js': 'module.exports=1' },
    });
    const r = await scan(dir);
    const nav = check(r, 'nav.gitignore');
    expect(nav.findings?.some((f) => f.message.includes('node_modules'))).toBe(true);
    // node_modules contents never count as agent-visible source
    expect(r.checks.find((c) => c.id === 'nav.large-files')?.summary).not.toMatch(/node_modules/);
  });

  it('ignores placeholder secrets and suppressed lines', async () => {
    const dir = fixture('good-ts', {
      git: true,
      files: {
        'src/example.ts': `export const k = 'AKIAIOSFODNN7EXAMPLE';\nexport const j = '${FAKE_AWS_KEY}'; // agent-ready-ignore\n`,
        '.env.example': 'API_KEY=\n',
      },
    });
    const r = await scan(dir);
    expect(check(r, 'safety.secrets').score).toBe(1);
  });

  it('respects config: disable and ignore', async () => {
    const dir = fixture('bad-js', {
      git: true,
      files: {
        'agent-ready.config.json': JSON.stringify({
          disable: ['safety.scripts'],
          ignore: ['vendor/**'],
        }),
        'vendor/huge.js': bigFile(2000),
      },
    });
    const r = await scan(dir);
    expect(r.checks.some((c) => c.id === 'safety.scripts')).toBe(false);
    expect(check(r, 'nav.large-files').findings ?? []).toHaveLength(0);
  });

  it('marks categories n/a when no language applies', async () => {
    const r = await scan(fixture(null, { files: { 'notes.txt': 'hello' } }));
    expect(r.categories.find((c) => c.id === 'types')?.score).toBeNull();
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('scans in well under 2s', async () => {
    const r = await scan(fixture('good-ts', { git: true }));
    expect(r.durationMs).toBeLessThan(2000);
  });
});
