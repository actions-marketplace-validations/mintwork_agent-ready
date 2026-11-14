import type { Colors } from './color.js';

type Op = { type: ' ' | '+' | '-'; line: string };

/** LCS line diff. Fine for the small files agent-ready generates. */
export function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i] as Uint32Array;
    const below = dp[i + 1] as Uint32Array;
    for (let j = m - 1; j >= 0; j--) {
      row[j] =
        a[i] === b[j]
          ? (below[j + 1] as number) + 1
          : Math.max(below[j] as number, row[j + 1] as number);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: ' ', line: a[i] as string });
      i++;
      j++;
    } else if (
      ((dp[i + 1] as Uint32Array)[j] as number) >= ((dp[i] as Uint32Array)[j + 1] as number)
    ) {
      ops.push({ type: '-', line: a[i] as string });
      i++;
    } else {
      ops.push({ type: '+', line: b[j] as string });
      j++;
    }
  }
  while (i < n) ops.push({ type: '-', line: a[i++] as string });
  while (j < m) ops.push({ type: '+', line: b[j++] as string });
  return ops;
}

function splitLines(s: string): string[] {
  if (s === '') return [];
  const lines = s.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Render a compact unified-style diff with `context` lines around changes. */
export function renderDiff(
  path: string,
  before: string | null,
  after: string,
  colors: Colors,
  context = 2,
): string {
  const ops = diffLines(splitLines(before ?? ''), splitLines(after));
  const out: string[] = [];
  out.push(colors.c('bold', `--- ${before === null ? '/dev/null' : `a/${path}`}`));
  out.push(colors.c('bold', `+++ b/${path}`));
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.type !== ' ') {
      for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) {
        keep[k] = true;
      }
    }
  });
  let skipped = false;
  ops.forEach((op, idx) => {
    if (!keep[idx]) {
      if (!skipped) out.push(colors.c('cyan', '@@ ... @@'));
      skipped = true;
      return;
    }
    skipped = false;
    const text = `${op.type}${op.line}`;
    out.push(
      op.type === '+' ? colors.c('green', text) : op.type === '-' ? colors.c('red', text) : text,
    );
  });
  return out.join('\n');
}
