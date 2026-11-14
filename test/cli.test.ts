import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { fixture } from './helpers.js';

function io() {
  let out = '';
  let err = '';
  return {
    io: {
      stdout: {
        write: (s: string) => {
          out += s;
          return true;
        },
        isTTY: false,
      },
      stderr: {
        write: (s: string) => {
          err += s;
          return true;
        },
      },
    },
    out: () => out,
    err: () => err,
  };
}

describe('cli', () => {
  it('prints a human report', async () => {
    const t = io();
    const code = await main([fixture('good-ts', { git: true })], t.io);
    expect(code).toBe(0);
    expect(t.out()).toMatch(/Agent-ready score\s+\d+\/100/);
    expect(t.out().includes('\u001b[')).toBe(false); // no colors when not a TTY
  });

  it('emits valid JSON', async () => {
    const t = io();
    await main([fixture('bad-py', { git: true }), '--json'], t.io);
    const report = JSON.parse(t.out());
    expect(report.score).toBeTypeOf('number');
    expect(report.categories).toHaveLength(5);
    expect(report.checks.length).toBeGreaterThan(10);
  });

  it('prints a shields.io badge', async () => {
    const t = io();
    await main([fixture('good-ts', { git: true }), '--badge'], t.io);
    expect(t.out()).toMatch(
      /^\[!\[agent-ready: \d+\/100\]\(https:\/\/img\.shields\.io\/badge\/agent--ready-\d+%2F100-\w+\)\]/,
    );
    // badges drive people to the project repo
    expect(t.out()).toContain('](https://github.com/ranjan-mohanty/agent-ready)');
  });

  it('gates on --min-score', async () => {
    const t = io();
    expect(await main([fixture('bad-py'), '--min-score', '80'], t.io)).toBe(1);
    expect(t.err()).toMatch(/below --min-score 80/);
    expect(await main([fixture('good-py'), '--min-score', '80'], io().io)).toBe(0);
    expect(await main(['.', '--min-score', 'abc'], io().io)).toBe(2);
  });

  it('--fix --dry-run shows a diff and writes nothing', async () => {
    const t = io();
    const dir = fixture('bad-py');
    await main([dir, '--fix', '--dry-run'], t.io);
    expect(t.out()).toContain('Would write AGENTS.md');
    expect(t.out()).toContain('+++ b/AGENTS.md');
  });

  it('--fix reports the score delta', async () => {
    const t = io();
    await main([fixture('bad-py', { git: true }), '--fix'], t.io);
    expect(t.out()).toMatch(/Score: \d+ → \d+/);
  });

  it('errors on a missing directory', async () => {
    const t = io();
    expect(await main(['/definitely/not/here'], t.io)).toBe(2);
  });
});
