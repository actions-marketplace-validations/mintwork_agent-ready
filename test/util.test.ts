import { describe, expect, it } from 'vitest';
import { makeColors } from '../src/util/color.js';
import { diffLines, renderDiff } from '../src/util/diff.js';
import { Matcher } from '../src/util/glob.js';
import { parseJsonc } from '../src/util/jsonc.js';

describe('Matcher (gitignore semantics)', () => {
  it('matches bare names at any depth', () => {
    const m = new Matcher(['node_modules']);
    expect(m.matches('node_modules/x/index.js')).toBe(true);
    expect(m.matches('packages/a/node_modules/y.js')).toBe(true);
    expect(m.matches('src/node_modules_helper.ts')).toBe(false);
  });
  it('anchors patterns containing a slash', () => {
    const m = new Matcher(['/dist', 'docs/build/']);
    expect(m.matches('dist/a.js')).toBe(true);
    expect(m.matches('pkg/dist/a.js')).toBe(false);
    expect(m.matches('docs/build/x.html')).toBe(true);
  });
  it('supports globs and negation', () => {
    const m = new Matcher(['*.log', '.env*', '!.env.example', 'test/fixtures/**']);
    expect(m.matches('logs/a.log')).toBe(true);
    expect(m.matches('.env.local')).toBe(true);
    expect(m.matches('.env.example')).toBe(false);
    expect(m.matches('test/fixtures/a/b.ts')).toBe(true);
    expect(m.matches('test/a.test.ts')).toBe(false);
  });
});

describe('parseJsonc', () => {
  it('handles comments, trailing commas and slashes inside strings', () => {
    const v = parseJsonc('{\n // c\n "a": "http://x", /* b */ "b": [1,2,],\n}') as Record<
      string,
      unknown
    >;
    expect(v).toEqual({ a: 'http://x', b: [1, 2] });
  });
  it('returns null on invalid input', () => {
    expect(parseJsonc('{nope')).toBeNull();
  });
});

describe('diff', () => {
  it('produces add/remove ops', () => {
    const ops = diffLines(['a', 'b', 'c'], ['a', 'c', 'd']);
    expect(ops.map((o) => o.type + o.line)).toEqual([' a', '-b', ' c', '+d']);
  });
  it('renders new files against /dev/null', () => {
    const out = renderDiff('X.md', null, 'hi\n', makeColors(false));
    expect(out).toContain('--- /dev/null');
    expect(out).toContain('+hi');
  });
});
