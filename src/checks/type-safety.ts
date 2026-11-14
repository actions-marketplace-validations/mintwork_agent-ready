import { join, posix } from 'node:path';
import type { RepoContext } from '../context.js';
import type { Check, CheckResult, Finding } from '../types.js';

interface TsConfig {
  extends?: string | string[];
  compilerOptions?: Record<string, unknown>;
}

/** Resolve compilerOptions through local and node_modules `extends` chains. */
export function resolveCompilerOptions(
  ctx: RepoContext,
  rel = 'tsconfig.json',
  depth = 0,
): Record<string, unknown> {
  if (depth > 8) return {};
  const cfg = ctx.readJson<TsConfig>(rel);
  if (!cfg) return {};
  let base: Record<string, unknown> = {};
  const exts =
    cfg.extends === undefined ? [] : Array.isArray(cfg.extends) ? cfg.extends : [cfg.extends];
  for (const ext of exts) {
    let target: string | null = null;
    if (ext.startsWith('.')) {
      target = posix.normalize(posix.join(posix.dirname(rel), ext));
      if (!target.endsWith('.json')) target += '.json';
    } else {
      // package config, e.g. "@tsconfig/strictest/tsconfig.json" or "@tsconfig/node20"
      const candidates = [
        join('node_modules', ext),
        join('node_modules', `${ext}.json`),
        join('node_modules', ext, 'tsconfig.json'),
      ];
      target = candidates.find((c) => ctx.exists(c) && c.endsWith('.json')) ?? null;
      if (!target && /strictest|strict/.test(ext)) base = { ...base, strict: true };
    }
    if (target) base = { ...base, ...resolveCompilerOptions(ctx, target, depth + 1) };
  }
  return { ...base, ...(cfg.compilerOptions ?? {}) };
}

function tsCheck(ctx: RepoContext): { score: number; summary: string; findings: Finding[] } {
  const findings: Finding[] = [];
  const tsconfigs = [
    'tsconfig.json',
    ...ctx.files.filter((f) => /(^|\/)tsconfig\.json$/.test(f) && f !== 'tsconfig.json'),
  ];
  const primary = tsconfigs.find((t) => ctx.exists(t));
  let base: number;
  let summary: string;
  if (!primary) {
    base = 0.2;
    summary = 'TypeScript files but no tsconfig.json';
  } else {
    const opts = resolveCompilerOptions(ctx, primary);
    if (opts.strict === true) {
      base = 1;
      summary = `strict mode on (${primary})`;
    } else {
      const partial = ['noImplicitAny', 'strictNullChecks', 'strictFunctionTypes'].filter(
        (k) => opts[k] === true,
      );
      base = 0.3 + 0.15 * partial.length;
      summary = partial.length
        ? `strict off; ${partial.join(', ')} on`
        : `strict mode off (${primary})`;
      findings.push({
        severity: 'warn',
        file: primary,
        message: 'set "strict": true in compilerOptions',
      });
    }
  }
  // Penalize escape hatches.
  const tsFiles = ctx
    .filesWithExt('.ts', '.tsx', '.mts', '.cts')
    .filter((f) => !f.endsWith('.d.ts'));
  let nocheck = 0;
  let ignores = 0;
  let anys = 0;
  for (const f of tsFiles.slice(0, 3000)) {
    const text = ctx.read(f);
    if (!text) continue;
    if (/^\s*(?:\/\/|\/\*+)\s*@ts-nocheck/m.test(text)) {
      nocheck++;
      if (nocheck <= 5)
        findings.push({ severity: 'warn', file: f, message: '@ts-nocheck disables type checking' });
    }
    ignores += (text.match(/(?:\/\/|\/\*+)\s*@ts-ignore/g) ?? []).length;
    anys += (text.match(/:\s*any\b|as any\b|<any>/g) ?? []).length;
  }
  const n = Math.max(1, tsFiles.length);
  const escapeRate = (nocheck * 5 + ignores + anys * 0.5) / n;
  const penalty = Math.min(0.3, escapeRate * 0.3);
  if (ignores + anys > 0) summary += `; ${anys} any, ${ignores} @ts-ignore`;
  return { score: Math.max(0, base - penalty), summary, findings };
}

/** Estimate fraction of Python functions with type annotations. */
export function pythonAnnotationCoverage(source: string): { total: number; annotated: number } {
  let total = 0;
  let annotated = 0;
  const re = /^[ \t]*(?:async[ \t]+)?def[ \t]+\w+[ \t]*\(/gm;
  for (const m of source.matchAll(re)) {
    // Walk forward to the matching paren, then look for "->" before ":".
    let i = (m.index ?? 0) + m[0].length;
    let depth = 1;
    const start = i;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      i++;
    }
    const params = source.slice(start, i - 1);
    const after = source.slice(i, source.indexOf(':', i) + 1 || i + 200);
    total++;
    const paramList = params
      .split(',')
      .map((p) => p.trim())
      .filter(
        (p) =>
          p &&
          p !== 'self' &&
          p !== 'cls' &&
          p !== '*' &&
          p !== '/' &&
          !p.startsWith('**') &&
          !/^\*\w*$/.test(p),
      );
    const hasReturn = /->/.test(after);
    const paramsAnnotated =
      paramList.length > 0 && paramList.every((p) => /^\*{0,2}\w+\s*:/.test(p));
    if (hasReturn || paramsAnnotated) annotated++;
  }
  return { total, annotated };
}

function pyCheck(ctx: RepoContext): { score: number; summary: string; findings: Finding[] } {
  const pyFiles = ctx.filesWithExt('.py').filter((f) => !/(^|\/)(migrations|_pb2)/.test(f));
  let total = 0;
  let annotated = 0;
  for (const f of pyFiles.slice(0, 2000)) {
    const text = ctx.read(f);
    if (!text) continue;
    const r = pythonAnnotationCoverage(text);
    total += r.total;
    annotated += r.annotated;
  }
  const coverage = total === 0 ? 1 : annotated / total;
  const pyproject = ctx.pyproject ?? '';
  const checker =
    /\[tool\.(mypy|pyright|basedpyright)/.test(pyproject) ||
    ctx.has('mypy.ini') ||
    ctx.has('pyrightconfig.json');
  const strict =
    /^\s*strict\s*=\s*true/m.test(pyproject) || /typeCheckingMode\s*=\s*["']strict/.test(pyproject);
  const score = Math.min(1, coverage * 0.8 + (checker ? 0.15 : 0) + (strict ? 0.05 : 0));
  const pct = Math.round(coverage * 100);
  return {
    score,
    summary: `~${pct}% of ${total} Python functions annotated${checker ? `; type checker configured${strict ? ' (strict)' : ''}` : '; no type checker'}`,
    findings: [],
  };
}

export const typeSafetyChecks: Check[] = [
  {
    id: 'types.typescript',
    category: 'types',
    title: 'TypeScript strictness',
    weight: 1,
    run(ctx): CheckResult {
      if (!ctx.languages.includes('typescript')) {
        if (
          ctx.languages.includes('javascript') &&
          ctx.filesWithExt('.js', '.jsx', '.mjs', '.cjs').length > 0
        ) {
          const jsconfig = ctx.readJson<TsConfig>('jsconfig.json');
          const checkJs = jsconfig?.compilerOptions?.checkJs === true;
          return {
            score: checkJs ? 0.6 : 0.25,
            summary: checkJs
              ? 'JavaScript with checkJs enabled'
              : 'Plain JavaScript — no static types for agents to lean on',
            suggestion:
              'Migrate to TypeScript (or enable `checkJs` in jsconfig.json). Types are the cheapest feedback loop an agent has.',
          };
        }
        return { score: null, summary: 'No TypeScript/JavaScript' };
      }
      const r = tsCheck(ctx);
      const strictOn = r.summary.startsWith('strict mode on');
      return {
        ...r,
        suggestion:
          r.score < 1
            ? strictOn
              ? 'Burn down `any` and `@ts-ignore` escape hatches.'
              : 'Enable `"strict": true` and burn down `any` / `@ts-ignore`.'
            : undefined,
      };
    },
  },
  {
    id: 'types.python',
    category: 'types',
    title: 'Python type hint coverage',
    weight: 1,
    run(ctx): CheckResult {
      if (!ctx.languages.includes('python')) return { score: null, summary: 'No Python' };
      const r = pyCheck(ctx);
      return {
        ...r,
        suggestion:
          r.score < 0.9
            ? 'Annotate function signatures and configure mypy or pyright in pyproject.toml.'
            : undefined,
      };
    },
  },
];
