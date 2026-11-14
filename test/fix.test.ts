import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createContext } from '../src/context.js';
import { generateAgentsMd } from '../src/fix/agents-md.js';
import { applyFixes, planFixes } from '../src/fix/index.js';
import { scan } from '../src/scan.js';
import { fixture } from './helpers.js';

describe('--fix', () => {
  it('generates AGENTS.md + CLAUDE.md + .gitignore and raises the score', async () => {
    const dir = fixture('bad-py', { git: true });
    const before = await scan(dir);
    const ctx = createContext(dir);
    const changes = planFixes(ctx);
    expect(changes.map((c) => c.path).sort()).toEqual(['.gitignore', 'AGENTS.md', 'CLAUDE.md']);
    const res = applyFixes(ctx, changes, { force: false, dryRun: false });
    expect(res.written).toHaveLength(3);
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('pip install -r requirements.txt');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('@AGENTS.md');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('__pycache__/');
    const after = await scan(dir);
    expect(after.score).toBeGreaterThan(before.score + 15);
    // generated docs must not be stale themselves
    expect(after.checks.find((c) => c.id === 'context.fresh')?.score).toBe(1);
  });

  it('generates docs with real commands for a JS/TS project', () => {
    const dir = fixture('good-ts', { git: true });
    const ctx = createContext(dir);
    const md = generateAgentsMd(ctx);
    expect(md).toContain('npm run build');
    expect(md).toContain('npm test');
    expect(md).toContain('`src/` — Main source code');
  });

  it('appends missing .gitignore entries without touching existing lines', () => {
    const dir = fixture('good-ts', {
      git: true,
      files: { '.gitignore': 'dist/\n', 'node_modules/x/index.js': '1' },
    });
    const ctx = createContext(dir);
    const change = planFixes(ctx).find((c) => c.path === '.gitignore');
    expect(change?.kind).toBe('append');
    applyFixes(ctx, change ? [change] : [], { force: false, dryRun: false });
    const text = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(text.startsWith('dist/\n')).toBe(true);
    expect(text).toContain('node_modules/');
  });

  it('never overwrites an existing file without --force', () => {
    const dir = fixture('bad-py');
    const ctx = createContext(dir);
    const changes = planFixes(ctx);
    // Simulate a race: someone created AGENTS.md after planning.
    writeFileSync(join(dir, 'AGENTS.md'), 'mine\n');
    const res = applyFixes(ctx, changes, { force: false, dryRun: false });
    expect(res.skipped.map((s) => s.change.path)).toContain('AGENTS.md');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('mine\n');
    const forced = applyFixes(ctx, changes, { force: true, dryRun: false });
    expect(forced.written.map((w) => w.path)).toContain('AGENTS.md');
  });

  it('dry-run writes nothing', () => {
    const dir = fixture('bad-py');
    const ctx = createContext(dir);
    applyFixes(ctx, planFixes(ctx), { force: false, dryRun: true });
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
  });

  it('adds AGENTS.md pointer when only CLAUDE.md exists', () => {
    const dir = fixture('bad-js', { git: true });
    const changes = planFixes(createContext(dir));
    const agents = changes.find((c) => c.path === 'AGENTS.md');
    expect(agents?.after).toContain('CLAUDE.md');
    expect(changes.some((c) => c.path === 'CLAUDE.md')).toBe(false);
  });
});
