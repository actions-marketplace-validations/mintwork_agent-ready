import { dirname, posix } from 'node:path';
import type { RepoContext } from '../context.js';
import {
  architectureSection,
  commandsSection,
  generateAgentsMd,
  generateClaudeMd,
} from '../fix/agents-md.js';
import type { Check, FileChange, Finding } from '../types.js';
import { type ContextDoc, findContextDocs, isRootDoc } from './docs.js';

const NO_DOC = 'No agent context file (AGENTS.md / CLAUDE.md / .cursor/rules)';

function rootDocs(ctx: RepoContext): ContextDoc[] {
  return findContextDocs(ctx).filter((d) => isRootDoc(d.path));
}

/** Text inside inline code spans and fenced code blocks. */
export function codeText(md: string): string {
  const parts: string[] = [];
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  for (const m of md.matchAll(fence)) parts.push(m[1] ?? '');
  const withoutFences = md.replace(fence, '');
  for (const m of withoutFences.matchAll(/`([^`\n]+)`/g)) parts.push(m[1] ?? '');
  return parts.join('\n');
}

const RUNNERS =
  '(?:npm|pnpm|yarn|bun|npx|bunx|make|just|task|uv|poetry|pdm|hatch|tox|nox|python3?|pip|cargo|go|deno|turbo|nx)';

const COMMAND_KINDS: Record<string, RegExp> = {
  test: new RegExp(
    `(?:\\b${RUNNERS}\\b[^\\n]*\\b(?:test|tests|vitest|jest|pytest|mocha|ava)\\b)|^\\s*(?:pytest|vitest|jest|mocha)\\b`,
    'im',
  ),
  lint: new RegExp(
    `(?:\\b${RUNNERS}\\b[^\\n]*\\b(?:lint|eslint|biome|ruff|flake8|pylint|check|typecheck|tsc|mypy|pyright)\\b)|^\\s*(?:ruff|eslint|biome|flake8|pylint|mypy|pyright|tsc)\\b`,
    'im',
  ),
  build: new RegExp(
    `(?:\\b${RUNNERS}\\b[^\\n]*\\b(?:build|compile|bundle|install|sync|dev|start)\\b)|^\\s*(?:tsc|vite|webpack|esbuild)\\b`,
    'im',
  ),
};

export function detectCommands(md: string): Set<string> {
  const code = codeText(md);
  const found = new Set<string>();
  for (const [kind, re] of Object.entries(COMMAND_KINDS)) {
    if (re.test(code)) found.add(kind);
  }
  return found;
}

const NOT_PATHS = new Set(['n/a', 'i/o', 'and/or', 'true/false', 'yes/no', 'w/', 'w/o']);
const GENERATED_PREFIXES = [
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.venv',
  'venv',
  '.next',
  'target',
  'tmp',
  '.git',
];
const KNOWN_EXT =
  /\.(?:[cm]?[jt]sx?|json|jsonc|ya?ml|toml|md|mdx|py|pyi|sh|css|scss|html|sql|txt|cfg|ini|lock|env\.example|mdc)$/i;

/** Extract things that look like repo-relative paths from a markdown doc. */
export function extractPathRefs(md: string): string[] {
  const candidates = new Set<string>();
  const code = md.replace(/```[^\n]*\n[\s\S]*?```/g, '');
  for (const m of code.matchAll(/`([^`\n]+)`/g)) candidates.add((m[1] ?? '').trim());
  for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) candidates.add((m[1] ?? '').trim());
  // Claude Code @imports at the start of a line or after whitespace.
  for (const m of md.matchAll(/(?:^|\s)@([\w./-]+\.[\w]+)/gm)) candidates.add((m[1] ?? '').trim());

  const refs: string[] = [];
  for (let c of candidates) {
    c = c
      .replace(/^\.\//, '')
      .replace(/[#?].*$/, '')
      .replace(/[),.:;]+$/, '');
    if (!c || c.length > 200) continue;
    if (/^[a-z]+:\/\//i.test(c) || c.startsWith('mailto:') || c.startsWith('#')) continue;
    if (/[\s*<>{}$|"'`=\\[\]]/.test(c)) continue;
    if (c.startsWith('-') || c.startsWith('~') || c.startsWith('/') || c.startsWith('@')) continue;
    if (NOT_PATHS.has(c.toLowerCase())) continue;
    if (/^\d/.test(c)) continue;
    const looksLikePath =
      (c.includes('/') && /^[\w.-]+(\/[\w.@-]*)+$/.test(c)) ||
      (KNOWN_EXT.test(c) && /^[\w.-]+$/.test(c));
    if (!looksLikePath) continue;
    const first = c.split('/')[0] ?? '';
    if (GENERATED_PREFIXES.includes(first)) continue;
    refs.push(c);
  }
  return refs;
}

export function extractScriptRefs(md: string): string[] {
  const code = codeText(md);
  const refs = new Set<string>();
  for (const m of code.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+run\s+([\w:.-]+)/g))
    refs.add(m[1] ?? '');
  // pnpm/yarn shorthand: `pnpm build` (skip builtins)
  const builtins = new Set([
    'install',
    'i',
    'add',
    'remove',
    'rm',
    'up',
    'update',
    'upgrade',
    'dlx',
    'exec',
    'create',
    'init',
    'publish',
    'link',
    'unlink',
    'why',
    'outdated',
    'list',
    'ls',
    'audit',
    'run',
    'test',
    'start',
    'x',
    'global',
    'config',
    'set',
    'version',
    'info',
    'pack',
    'login',
    'logout',
    'cache',
    'workspace',
    'workspaces',
    'import',
    'patch',
    'store',
    'env',
    'prune',
    'rebuild',
    'dedupe',
    'help',
    'ci',
    'node',
    'npx',
    'tsc',
    'vitest',
    'jest',
    'eslint',
  ]);
  for (const m of code.matchAll(/^\s*(?:\$\s*)?(?:pnpm|yarn)\s+([\w:.-]+)/gm)) {
    const s = m[1] ?? '';
    if (!builtins.has(s) && !s.startsWith('-')) refs.add(s);
  }
  return [...refs].filter(Boolean);
}

function refExists(ctx: RepoContext, docPath: string, ref: string): boolean {
  const clean = ref.replace(/\/$/, '');
  if (ctx.exists(clean)) return true;
  const rel = posix.normalize(posix.join(dirname(docPath), clean));
  if (!rel.startsWith('..') && ctx.exists(rel)) return true;
  // Bare filenames (`index.ts`) are usually mentioned in the context of some directory.
  if (!clean.includes('/')) return ctx.files.some((f) => f === clean || f.endsWith(`/${clean}`));
  return false;
}

/** The doc an append-fix should target: AGENTS.md first, then CLAUDE.md, then any root markdown doc. */
function primaryDoc(ctx: RepoContext): ContextDoc | undefined {
  const docs = rootDocs(ctx).filter((d) => !isPointerDoc(d.content));
  return (
    docs.find((d) => d.path === 'AGENTS.md') ??
    docs.find((d) => d.path === 'CLAUDE.md' || d.path === '.claude/CLAUDE.md') ??
    docs.find((d) => d.path.endsWith('.md'))
  );
}

/** A short doc that just points at another context doc (`@AGENTS.md`, `[CLAUDE.md](CLAUDE.md)`). */
export function isPointerDoc(content: string): boolean {
  return (
    content.trim().split('\n').length < 12 &&
    /(^|\s)@[\w./-]+\.md\b|\]\((?:\.\/)?(?:AGENTS|CLAUDE)\.md\)/m.test(content)
  );
}

function appendSection(doc: ContextDoc, section: string[], description: string): FileChange {
  const sep = doc.content.endsWith('\n') ? '\n' : '\n\n';
  return {
    path: doc.path,
    before: doc.content,
    after: `${doc.content}${sep}${section.join('\n')}`,
    kind: 'append',
    description,
  };
}

function noDocResult(primary = false) {
  return primary
    ? {
        score: 0,
        summary: NO_DOC,
        suggestion: 'Run `agent-ready --fix` to generate a starter AGENTS.md + CLAUDE.md.',
      }
    : { score: 0, summary: 'needs a context file' };
}

export const contextChecks: Check[] = [
  {
    id: 'context.exists',
    category: 'context',
    title: 'Agent context file present',
    weight: 3,
    run(ctx) {
      const docs = rootDocs(ctx);
      if (docs.length === 0) return noDocResult(true);
      return { score: 1, summary: `Found ${docs.map((d) => d.path).join(', ')}` };
    },
    fix(ctx) {
      const docs = findContextDocs(ctx).filter((d) => isRootDoc(d.path));
      const changes: FileChange[] = [];
      const hasAgents = docs.some((d) => d.path === 'AGENTS.md');
      const hasClaude = docs.some((d) => d.path === 'CLAUDE.md' || d.path === '.claude/CLAUDE.md');
      if (!hasAgents && !hasClaude) {
        changes.push({
          path: 'AGENTS.md',
          before: null,
          after: generateAgentsMd(ctx),
          kind: 'create',
          description: 'Starter AGENTS.md generated from detected scripts and structure',
        });
      }
      return changes;
    },
  },
  {
    id: 'context.commands',
    category: 'context',
    title: 'Docs list build/test/lint commands',
    weight: 3,
    run(ctx) {
      const docs = rootDocs(ctx);
      if (docs.length === 0) return noDocResult();
      const found = new Set<string>();
      for (const d of docs) for (const k of detectCommands(d.content)) found.add(k);
      const expected = ['test', 'lint', 'build'];
      const missing = expected.filter((k) => !found.has(k));
      const score = (expected.length - missing.length) / expected.length;
      return {
        score,
        summary:
          missing.length === 0
            ? 'Build, test and lint commands documented'
            : `Missing ${missing.join(', ')} command(s) in context docs`,
        suggestion: missing.length
          ? `Add a "Commands" section with exact ${missing.join('/')} commands in code blocks.`
          : undefined,
      };
    },
    fix(ctx) {
      const doc = primaryDoc(ctx);
      if (
        !doc ||
        /^#{1,4}\s*(commands|scripts|development|getting started)\b/im.test(doc.content)
      ) {
        return [];
      }
      if (detectCommands(doc.content).size === 3) return [];
      return [appendSection(doc, commandsSection(ctx), 'Append detected build/test/lint commands')];
    },
  },
  {
    id: 'context.architecture',
    category: 'context',
    title: 'Docs describe architecture/layout',
    weight: 2,
    run(ctx) {
      const docs = rootDocs(ctx);
      if (docs.length === 0) return noDocResult();
      const all = docs.map((d) => d.content).join('\n');
      const heading =
        /^#{1,4}\s*.*\b(architecture|structure|layout|overview|organi[sz]ation|codebase|modules|directories|how it works|design)\b/im.test(
          all,
        );
      const topDirs = new Set(
        ctx.files
          .filter((f) => f.includes('/'))
          .map((f) => f.split('/')[0] as string)
          .filter((d) => !d.startsWith('.')),
      );
      const mentioned = [...topDirs].filter((d) =>
        new RegExp(`\\b${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`).test(all),
      );
      const dirCoverage =
        topDirs.size === 0 ? 1 : Math.min(1, mentioned.length / Math.min(3, topDirs.size));
      const score = (heading ? 0.6 : 0) + 0.4 * dirCoverage;
      return {
        score,
        summary: heading
          ? `Architecture section found; ${mentioned.length} top-level dir(s) described`
          : `No architecture/structure section; ${mentioned.length} top-level dir(s) mentioned`,
        suggestion:
          score < 1
            ? 'Add an "Architecture" section mapping key directories (e.g. `src/`, `tests/`) to their purpose.'
            : undefined,
      };
    },
    fix(ctx) {
      const doc = primaryDoc(ctx);
      const all = rootDocs(ctx)
        .map((d) => d.content)
        .join('\n');
      if (!doc || /^#{1,4}\s*.*\b(architecture|structure|layout)\b/im.test(all)) return [];
      return [appendSection(doc, architectureSection(ctx), 'Append an Architecture section')];
    },
  },
  {
    id: 'context.fresh',
    category: 'context',
    title: 'Docs are not stale (referenced paths/scripts exist)',
    weight: 2,
    run(ctx) {
      const docs = findContextDocs(ctx);
      if (docs.length === 0) return noDocResult();
      const findings: Finding[] = [];
      let total = 0;
      const scripts = ctx.scripts();
      for (const d of docs) {
        for (const ref of extractPathRefs(d.content)) {
          total++;
          if (!refExists(ctx, d.path, ref)) {
            findings.push({
              severity: 'warn',
              file: d.path,
              message: `references missing path \`${ref}\``,
            });
          }
        }
        if (ctx.pkg) {
          for (const s of extractScriptRefs(d.content)) {
            total++;
            if (!(s in scripts)) {
              findings.push({
                severity: 'warn',
                file: d.path,
                message: `references missing package.json script "${s}"`,
              });
            }
          }
        }
      }
      const score = Math.max(0, 1 - 0.2 * findings.length);
      return {
        score,
        summary:
          findings.length === 0
            ? `All ${total} referenced paths/scripts exist`
            : `${findings.length} stale reference(s) out of ${total}`,
        findings,
        suggestion: findings.length
          ? 'Update or remove references to files/scripts that no longer exist. Stale docs actively mislead agents.'
          : undefined,
      };
    },
  },
  {
    id: 'context.length',
    category: 'context',
    title: 'Docs are concise (fit in context)',
    weight: 1,
    run(ctx) {
      const docs = rootDocs(ctx);
      if (docs.length === 0) return noDocResult();
      const findings: Finding[] = [];
      let worst = 1;
      for (const d of docs) {
        const lines = d.content.split('\n').length;
        let s = 1;
        if (lines > 1000) s = 0.1;
        else if (lines > 600) s = 0.4;
        else if (lines > 300) s = 0.7;
        else if (d.content.trim().split('\n').length < 8 && !isPointerDoc(d.content)) s = 0.5;
        if (s < 1) {
          findings.push({
            severity: 'warn',
            file: d.path,
            message:
              s === 0.5
                ? `only ${lines} lines — too thin to be useful`
                : `${lines} lines — long docs dilute attention and burn context`,
          });
        }
        worst = Math.min(worst, s);
      }
      return {
        score: worst,
        summary:
          worst === 1
            ? 'Context docs are a healthy length'
            : 'Context doc length could be improved',
        findings,
        suggestion:
          worst < 1
            ? 'Aim for 30–300 lines. Move deep detail into linked docs (e.g. `docs/`).'
            : undefined,
      };
    },
  },
  {
    id: 'context.coverage',
    category: 'context',
    title: 'Works across agents (AGENTS.md + CLAUDE.md)',
    weight: 1,
    run(ctx) {
      const docs = rootDocs(ctx);
      if (docs.length === 0) return noDocResult();
      const agents = docs.find((d) => d.path === 'AGENTS.md');
      const claude = docs.find((d) => d.path === 'CLAUDE.md' || d.path === '.claude/CLAUDE.md');
      if (agents && claude) return { score: 1, summary: 'AGENTS.md and CLAUDE.md both present' };
      const missing = agents
        ? 'CLAUDE.md (Claude Code)'
        : 'AGENTS.md (Codex, Cursor, Copilot, ...)';
      return {
        score: agents || claude ? 0.6 : 0.4,
        summary: `Missing ${missing}`,
        suggestion: agents
          ? 'Add a CLAUDE.md containing `@AGENTS.md` so Claude Code loads the same instructions.'
          : claude
            ? 'Add an AGENTS.md (read by Codex, Cursor, Copilot, Gemini and others) — `agent-ready --fix` can create one that points at CLAUDE.md.'
            : 'Add AGENTS.md and a CLAUDE.md that imports it.',
      };
    },
    fix(ctx) {
      const docs = rootDocs(ctx);
      const hasAgents = docs.some((d) => d.path === 'AGENTS.md');
      const hasClaude = docs.some((d) => d.path === 'CLAUDE.md' || d.path === '.claude/CLAUDE.md');
      const changes: FileChange[] = [];
      if (!hasClaude) {
        changes.push({
          path: 'CLAUDE.md',
          before: null,
          after: generateClaudeMd(),
          kind: 'create',
          description: 'CLAUDE.md that imports AGENTS.md for Claude Code',
        });
      }
      if (hasClaude && !hasAgents) {
        changes.push({
          path: 'AGENTS.md',
          before: null,
          after:
            '# AGENTS.md\n\nAgent instructions for this repository live in [CLAUDE.md](CLAUDE.md). Read it before making changes.\n',
          kind: 'create',
          description: 'AGENTS.md pointing at the existing CLAUDE.md',
        });
      }
      return changes;
    },
  },
];
