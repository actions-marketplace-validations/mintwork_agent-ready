import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { builtinChecks } from '../checks/index.js';
import type { RepoContext } from '../context.js';
import { enabledChecks } from '../scan.js';
import type { Check, FileChange } from '../types.js';

/** Collect proposed changes from every check with a fixer. Later changes to the same path are merged. */
export function planFixes(ctx: RepoContext, checks: Check[] = builtinChecks): FileChange[] {
  const byPath = new Map<string, FileChange>();
  for (const check of enabledChecks(ctx, checks)) {
    if (!check.fix) continue;
    for (const change of check.fix(ctx)) {
      if (!byPath.has(change.path)) byPath.set(change.path, change);
    }
  }
  return [...byPath.values()];
}

export interface ApplyResult {
  written: FileChange[];
  skipped: Array<{ change: FileChange; reason: string }>;
}

/**
 * Apply changes. New files are created; append-only edits (e.g. .gitignore) are applied;
 * anything that would overwrite existing content requires `force`.
 */
export function applyFixes(
  ctx: RepoContext,
  changes: FileChange[],
  opts: { force: boolean; dryRun: boolean },
): ApplyResult {
  const result: ApplyResult = { written: [], skipped: [] };
  for (const change of changes) {
    const abs = join(ctx.root, change.path);
    const existsNow = ctx.exists(change.path);
    if (change.kind === 'create' && existsNow && !opts.force) {
      result.skipped.push({ change, reason: 'file exists (use --force to overwrite)' });
      continue;
    }
    if (change.kind === 'overwrite' && !opts.force) {
      result.skipped.push({ change, reason: 'would overwrite existing content (use --force)' });
      continue;
    }
    if (
      change.kind === 'append' &&
      change.before !== null &&
      !change.after.startsWith(change.before)
    ) {
      result.skipped.push({ change, reason: 'not a pure append' });
      continue;
    }
    if (!opts.dryRun) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, change.after);
    }
    result.written.push(change);
  }
  return result;
}
