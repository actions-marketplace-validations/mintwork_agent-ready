import type { RepoContext } from '../context.js';
import { GENERATED_MARKER, generateAgentsMd } from '../fix/agents-md.js';
import type { CheckResult } from '../types.js';
import { findContextDocs, isRootDoc } from './docs.js';

/**
 * Generated docs that nobody has edited are worth something (the commands are real), but not as
 * much as docs written by people who know the code. Otherwise `--fix` alone would add ~30 points.
 *
 * A root doc is "template-derived" if it still carries the generated marker, or most of its lines
 * are verbatim from the template agent-ready would generate today. For such a doc:
 *
 *   progress = min(share of the template's TODOs filled in, share of new human-written text)
 *   factor   = 0.5 + 0.4 * progress (+ 0.1 * progress once the marker is removed)
 *
 * Requiring both signals means deleting the TODO lines (or the marker) without writing anything
 * earns nothing; credit comes back as real content replaces the placeholders.
 */
export interface DocQuality {
  /** Multiplier (0.5..1) for content-quality context checks. */
  factor: number;
  /** Template-derived docs still holding back credit. */
  templateDocs: string[];
  /** TODO placeholders left across those docs. */
  todos: number;
}

const TODO_LINE = /\bTODO\b/;
/** Template boilerplate whose exact text depends on the project name or detected languages. */
const BOILERPLATE =
  /^(?:Guidance for AI coding agents \(.*\) working on \*\*.*\*\*\.|Languages: [\w, ]+\.)$/;
/** Chars of new prose after which a template doc counts as fully written by a human. */
const HUMAN_CHARS_FOR_FULL_CREDIT = 300;
const TEMPLATE_OVERLAP = 0.6;
const MIN_FACTOR = 0.5;

const cache = new WeakMap<RepoContext, DocQuality>();

function contentLines(md: string): string[] {
  return md
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^```/.test(l));
}

function isPointer(content: string): boolean {
  return (
    content.trim().split('\n').length < 12 &&
    /(^|\s)@[\w./-]+\.md\b|\]\((?:\.\/)?(?:AGENTS|CLAUDE)\.md\)/m.test(content)
  );
}

export function docQuality(ctx: RepoContext): DocQuality {
  const cached = cache.get(ctx);
  if (cached) return cached;
  const docs = findContextDocs(ctx).filter((d) => isRootDoc(d.path) && !isPointer(d.content));
  let template: string | null = null;
  let best = docs.length ? 0 : 1;
  const templateDocs: string[] = [];
  let todos = 0;
  for (const d of docs) {
    template ??= generateAgentsMd(ctx);
    const templateLines = new Set(contentLines(template));
    const lines = contentLines(d.content);
    const fromTemplate = lines.filter((l) => templateLines.has(l)).length;
    const marker = d.content.includes(GENERATED_MARKER);
    const derived = marker || (lines.length > 0 && fromTemplate / lines.length >= TEMPLATE_OVERLAP);
    if (!derived) {
      best = 1;
      continue;
    }
    const slots = contentLines(template).filter((l) => TODO_LINE.test(l)).length;
    const remaining = Math.min(slots, lines.filter((l) => TODO_LINE.test(l)).length);
    const filled = slots === 0 ? 1 : (slots - remaining) / slots;
    const humanChars = lines
      .filter(
        (l) =>
          !templateLines.has(l) &&
          !TODO_LINE.test(l) &&
          !BOILERPLATE.test(l) &&
          !l.includes(GENERATED_MARKER),
      )
      .reduce((n, l) => n + l.length, 0);
    const human = Math.min(1, humanChars / HUMAN_CHARS_FOR_FULL_CREDIT);
    const progress = Math.min(filled, human);
    const factor = MIN_FACTOR + 0.4 * progress + (marker ? 0 : 0.1 * progress);
    if (factor < 1) {
      templateDocs.push(d.path);
      todos += remaining;
    }
    best = Math.max(best, factor);
  }
  // A hand-written doc alongside a generated one earns full credit.
  const result: DocQuality =
    best >= 1 ? { factor: 1, templateDocs: [], todos: 0 } : { factor: best, templateDocs, todos };
  cache.set(ctx, result);
  return result;
}

/**
 * Scale a content-quality context result by how much of the doc is still template. Only the
 * `primary` check carries the "fill in the TODOs" advice, so it isn't repeated per check.
 */
export function capForTemplate(
  ctx: RepoContext,
  result: CheckResult,
  primary = false,
): CheckResult {
  if (result.score === null || result.score === 0) return result;
  const q = docQuality(ctx);
  if (q.factor >= 1) return result;
  const docs = q.templateDocs.join(', ');
  return {
    ...result,
    score: result.score * q.factor,
    potential: result.score,
    summary: `${result.summary} (capped at ${Math.round(q.factor * 100)}%: ${docs} is still the generated template)`,
    suggestion:
      result.suggestion ??
      (primary
        ? `Fill in the TODO sections in ${docs} and remove the "${GENERATED_MARKER}" note — generated docs earn partial credit until a human edits them.`
        : undefined),
  };
}
