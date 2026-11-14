import type { RepoContext } from '../context.js';

export interface ContextDoc {
  path: string;
  tool: string;
  content: string;
}

const ROOT_DOCS: Array<[string, string]> = [
  ['AGENTS.md', 'Codex / Cursor / many'],
  ['CLAUDE.md', 'Claude Code'],
  ['.claude/CLAUDE.md', 'Claude Code'],
  ['CLAUDE.local.md', 'Claude Code'],
  ['GEMINI.md', 'Gemini CLI'],
  ['.cursorrules', 'Cursor (legacy)'],
  ['.github/copilot-instructions.md', 'GitHub Copilot'],
  ['.windsurfrules', 'Windsurf'],
];

/** All agent context docs: root-level docs, Cursor rules, and nested AGENTS.md/CLAUDE.md. */
export function findContextDocs(ctx: RepoContext): ContextDoc[] {
  const docs: ContextDoc[] = [];
  const seen = new Set<string>();
  const add = (path: string, tool: string) => {
    if (seen.has(path)) return;
    const content = ctx.read(path);
    if (content === null) return;
    seen.add(path);
    docs.push({ path, tool, content });
  };
  for (const [p, tool] of ROOT_DOCS) {
    if (ctx.has(p) || ctx.exists(p)) add(p, tool);
  }
  for (const f of ctx.files) {
    if (f.startsWith('.cursor/rules/') && (f.endsWith('.mdc') || f.endsWith('.md'))) {
      add(f, 'Cursor');
    } else if (/^\.github\/instructions\/[^/]+\.md$/.test(f)) {
      add(f, 'GitHub Copilot');
    } else if (/(^|\/)(AGENTS|CLAUDE)\.md$/.test(f)) {
      add(f, f.endsWith('AGENTS.md') ? 'Codex / Cursor / many' : 'Claude Code');
    }
  }
  return docs;
}

/** Docs that apply to the whole repo (vs. nested AGENTS.md/CLAUDE.md scoped to a subtree). */
export function isRootDoc(path: string): boolean {
  return (
    !path.includes('/') ||
    path.startsWith('.cursor/rules/') ||
    path === '.claude/CLAUDE.md' ||
    path === '.github/copilot-instructions.md' ||
    /^\.github\/instructions\/[^/]+\.md$/.test(path)
  );
}
