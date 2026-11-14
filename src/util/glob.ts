/**
 * Minimal gitignore-style matcher. Supports `*`, `**`, `?`, leading `/` anchors,
 * trailing `/` directory patterns and `!` negation (last match wins).
 * Paths are posix and relative to the repo root.
 */
interface CompiledPattern {
  re: RegExp;
  negate: boolean;
}

function escapeRe(ch: string): string {
  return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

function globToRe(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] as string;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` -> any number of directories, `**` -> anything
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += escapeRe(ch);
    }
  }
  return out;
}

export function compilePattern(raw: string): CompiledPattern | null {
  let p = raw.trim();
  if (!p || p.startsWith('#')) return null;
  let negate = false;
  if (p.startsWith('!')) {
    negate = true;
    p = p.slice(1);
  }
  if (p.startsWith('\\')) p = p.slice(1);
  let dirOnly = false;
  if (p.endsWith('/')) {
    dirOnly = true;
    p = p.replace(/\/+$/, '');
  }
  if (!p) return null;
  const anchored = p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  const body = globToRe(p);
  const suffix = dirOnly ? '/.*' : '(?:/.*)?';
  const prefix = anchored ? '^' : '(?:^|/)';
  return { re: new RegExp(`${prefix}${body}${suffix}$`), negate };
}

export class Matcher {
  private patterns: CompiledPattern[] = [];

  constructor(patterns: string[] = []) {
    this.add(patterns);
  }

  add(patterns: string[]): void {
    for (const p of patterns) {
      const c = compilePattern(p);
      if (c) this.patterns.push(c);
    }
  }

  get size(): number {
    return this.patterns.length;
  }

  matches(path: string): boolean {
    let matched = false;
    for (const p of this.patterns) {
      if (p.re.test(path)) matched = !p.negate;
    }
    return matched;
  }
}

export function parseIgnoreFile(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}
