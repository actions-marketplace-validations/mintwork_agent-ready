import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export interface FixtureOptions {
  /** Initialise a git repo and stage everything. */
  git?: boolean;
  /** Extra files to write (relative path -> content). */
  files?: Record<string, string>;
}

/** Copy a fixture repo into a fresh temp dir so tests never mutate the originals. */
export function fixture(name: string | null, opts: FixtureOptions = {}): string {
  const dir = mkdtempSync(join(tmpdir(), `agent-ready-${name ?? 'empty'}-`));
  if (name) cpSync(join(FIXTURES, name), dir, { recursive: true });
  for (const [rel, content] of Object.entries(opts.files ?? {})) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  if (opts.git) {
    const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    run('init', '-q');
    run('add', '-A');
  }
  return dir;
}

export function bigFile(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `export const v${i} = ${i};`).join('\n');
}

/** Built from pieces so this source file never contains a real-looking secret. */
export const FAKE_AWS_KEY = ['AKIA', 'Q3EGRZ7T', 'WNB4K2PL'].join('');

/** A PEM private key block with a plausible base64 body, assembled so this file never contains one. */
export function fakePrivateKey(): string {
  const header = ['-----BEGIN ', 'PRIVATE', ' KEY-----'].join('');
  const footer = ['-----END ', 'PRIVATE', ' KEY-----'].join('');
  const body = Array.from({ length: 4 }, (_, i) => `MIIB${'q7Rz'.repeat(15)}${i}`).join('\n');
  return `${header}\n${body}\n${footer}\n`;
}

/** A GitHub-token-shaped string, assembled from pieces. */
export const FAKE_GH_TOKEN = ['gh', 'p_', 'Zq4Lm8Rt2Wx6Np0Kv3Hs7Jd1Fb5Gc9Ya2Ue4'].join('');
