import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { UserConfig } from './types.js';
import { Matcher, parseIgnoreFile } from './util/glob.js';
import { parseJsonc } from './util/jsonc.js';
import { isFixturePath } from './util/paths.js';

/** Directories that are always build output / dependency caches and never source. */
export const HEAVY_DIRS = [
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.nox',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '.svelte-kit',
  '.gradle',
] as const;

const MAX_FILES = 50_000;

export type Language = 'typescript' | 'javascript' | 'python' | 'go' | 'rust';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface PackageJson {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
  packageManager?: string;
  eslintConfig?: unknown;
  'agent-ready'?: UserConfig;
  [key: string]: unknown;
}

export interface RepoContext {
  root: string;
  isGit: boolean;
  /** Files an agent would see (respects .gitignore / .ignore), posix relative paths. */
  files: string[];
  /** Tracked files that live inside dependency/cache dirs (should never be committed). */
  trackedHeavy: string[];
  truncated: boolean;
  languages: Language[];
  /** Number of (non-fixture, non-vendored) code files per detected language. */
  codeFiles: Partial<Record<Language, number>>;
  /**
   * Share (0..1) of the detected languages' code written in the given language(s). Used to weight
   * per-language checks so a tooling package.json doesn't count as much as the main language.
   */
  share(...langs: Language[]): number;
  pkg: PackageJson | null;
  pyproject: string | null;
  packageManager: PackageManager;
  config: UserConfig;
  /** True if the path (file or dir) exists on disk. */
  exists(rel: string): boolean;
  /** True if the path is in the agent-visible file list. */
  has(rel: string): boolean;
  read(rel: string): string | null;
  readJson<T = unknown>(rel: string): T | null;
  size(rel: string): number;
  lineCount(rel: string): number;
  /** Whether a path is ignored by git (or the .gitignore matcher when not a git repo). */
  isIgnored(rel: string): boolean;
  /** Whether git tracks at least one file under this directory. */
  hasTracked(relDir: string): boolean;
  /** Visible files with one of the given extensions. */
  filesWithExt(...exts: string[]): string[];
  scripts(): Record<string, string>;
  allDeps(): Record<string, string>;
}

function git(root: string, args: string[], input?: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      input,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    // check-ignore exits 1 when nothing matched; stdout is still meaningful.
    if (e.status === 1 && typeof e.stdout === 'string') return e.stdout;
    return null;
  }
}

function splitZ(out: string | null): string[] {
  if (!out) return [];
  return out.split('\0').filter(Boolean);
}

function isHeavyPath(p: string): boolean {
  const parts = p.split('/');
  parts.pop();
  return parts.some((seg) => (HEAVY_DIRS as readonly string[]).includes(seg));
}

function walk(root: string, ignore: Matcher, out: string[], dir = ''): void {
  if (out.length >= MAX_FILES) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const rel = dir ? `${dir}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (ent.name === '.git' || (HEAVY_DIRS as readonly string[]).includes(ent.name)) continue;
      if (ignore.matches(`${rel}/x`)) continue;
      walk(root, ignore, out, rel);
    } else if (ent.isFile()) {
      if (!ignore.matches(rel)) out.push(rel);
    }
    if (out.length >= MAX_FILES) return;
  }
}

function detectPackageManager(root: string, pkg: PackageJson | null): PackageManager {
  const pm = pkg?.packageManager?.split('@')[0];
  if (pm === 'pnpm' || pm === 'yarn' || pm === 'bun' || pm === 'npm') return pm;
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

export function loadConfig(root: string, pkg: PackageJson | null): UserConfig {
  for (const name of ['agent-ready.config.json', '.agent-ready.json']) {
    const p = join(root, name);
    if (existsSync(p)) {
      const parsed = parseJsonc(readFileSync(p, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed as UserConfig;
    }
  }
  return pkg?.['agent-ready'] ?? {};
}

export function createContext(rootInput: string): RepoContext {
  const root = resolve(rootInput);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const readCache = new Map<string, string | null>();
  const read = (rel: string): string | null => {
    if (readCache.has(rel)) return readCache.get(rel) ?? null;
    let content: string | null = null;
    try {
      content = readFileSync(join(root, rel), 'utf8');
    } catch {
      content = null;
    }
    readCache.set(rel, content);
    return content;
  };

  let pkg: PackageJson | null = null;
  const pkgText = read('package.json');
  if (pkgText) {
    const parsed = parseJsonc(pkgText);
    if (parsed && typeof parsed === 'object') pkg = parsed as PackageJson;
  }
  const config = loadConfig(root, pkg);

  const gitDir = git(root, ['rev-parse', '--is-inside-work-tree']);
  const isGit = gitDir?.trim() === 'true';

  const gitignore = new Matcher(parseIgnoreFile(read('.gitignore') ?? ''));
  // ripgrep (used by Claude Code and Codex) and Cursor also honor these files.
  const agentIgnore = new Matcher([
    ...parseIgnoreFile(read('.ignore') ?? ''),
    ...parseIgnoreFile(read('.rgignore') ?? ''),
    ...parseIgnoreFile(read('.cursorignore') ?? ''),
    ...(config.ignore ?? []),
  ]);

  let files: string[] = [];
  let tracked = new Set<string>();
  const trackedHeavy: string[] = [];

  if (isGit) {
    const trackedList = splitZ(git(root, ['ls-files', '-c', '-z', '--', '.']));
    tracked = new Set(trackedList);
    const excludes = HEAVY_DIRS.map((d) => `:(exclude,glob)**/${d}/**`);
    const untracked = splitZ(
      git(root, ['ls-files', '-o', '--exclude-standard', '-z', '--', '.', ...excludes]),
    );
    for (const f of trackedList) {
      if (isHeavyPath(f)) trackedHeavy.push(f);
      else files.push(f);
    }
    files.push(...untracked);
  } else {
    walk(root, gitignore, files);
  }

  if (agentIgnore.size > 0) files = files.filter((f) => !agentIgnore.matches(f));
  // git ls-files -c lists deleted-but-unstaged files; drop them lazily on read.
  const truncated = files.length > MAX_FILES;
  if (truncated) files = files.slice(0, MAX_FILES);
  files.sort();
  const fileSet = new Set(files);

  const statCache = new Map<string, number>();
  const size = (rel: string): number => {
    const cached = statCache.get(rel);
    if (cached !== undefined) return cached;
    let s = -1;
    try {
      s = statSync(join(root, rel)).size;
    } catch {
      s = -1;
    }
    statCache.set(rel, s);
    return s;
  };

  const lineCache = new Map<string, number>();
  const lineCount = (rel: string): number => {
    const cached = lineCache.get(rel);
    if (cached !== undefined) return cached;
    const text = read(rel);
    let n = 0;
    if (text) {
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
      if (text.length > 0 && text[text.length - 1] !== '\n') n++;
    }
    lineCache.set(rel, n);
    return n;
  };

  const ignoredCache = new Map<string, boolean>();
  const isIgnored = (rel: string): boolean => {
    const cached = ignoredCache.get(rel);
    if (cached !== undefined) return cached;
    let ignored: boolean;
    if (isGit) {
      const out = git(root, ['check-ignore', '--no-index', '--stdin'], `${rel}\n${rel}/x\n`);
      ignored = Boolean(out?.trim());
    } else {
      ignored = gitignore.matches(rel) || gitignore.matches(`${rel}/x`);
    }
    ignoredCache.set(rel, ignored);
    return ignored;
  };

  const hasTracked = (relDir: string): boolean => {
    const prefix = `${relDir.replace(/\/$/, '')}/`;
    for (const f of tracked) if (f.startsWith(prefix)) return true;
    return false;
  };

  const filesWithExt = (...exts: string[]): string[] =>
    files.filter((f) => exts.some((e) => f.endsWith(e)));

  const pyproject = read('pyproject.toml');

  // A language counts if it has a manifest, or makes up a meaningful share of the code
  // (a couple of helper scripts don't make a JS repo a Python project). Fixtures and vendored
  // code don't count towards the share.
  const counted = files.filter(
    (f) => !isFixturePath(f) && !/(^|\/)(vendor|third[-_]party)\//.test(f),
  );
  const countExt = (re: RegExp) => counted.filter((f) => re.test(f)).length;
  const tsCount = countExt(/\.(?:ts|tsx|mts|cts)$/) - countExt(/\.d\.ts$/);
  const jsCount = countExt(/\.(?:js|jsx|mjs|cjs)$/);
  const pyCount = countExt(/\.py$/);
  const goCount = countExt(/\.go$/);
  const rsCount = countExt(/\.rs$/);
  const otherCount = countExt(/\.(?:java|kt|scala|c|cc|cpp|h|hpp|cs|rb|php|swift|m|zig|ex|exs)$/);
  const codeTotal = tsCount + jsCount + pyCount + goCount + rsCount + otherCount;
  const significant = (n: number) =>
    n > 0 && (n >= Math.max(3, codeTotal * 0.1) || n === codeTotal);
  const hasTsconfig = files.some(
    (f) => /(^|\/)tsconfig(\.[\w-]+)?\.json$/.test(f) && !isFixturePath(f),
  );
  const pyManifest =
    pyproject !== null ||
    fileSet.has('setup.py') ||
    fileSet.has('requirements.txt') ||
    fileSet.has('Pipfile');
  const languages: Language[] = [];
  if (hasTsconfig || significant(tsCount)) languages.push('typescript');
  if (significant(jsCount) || (pkg && !languages.includes('typescript'))) {
    languages.push('javascript');
  }
  if (pyManifest || significant(pyCount)) languages.push('python');
  if (fileSet.has('go.mod') || significant(goCount)) languages.push('go');
  if (fileSet.has('Cargo.toml') || significant(rsCount)) languages.push('rust');
  const codeFiles: Partial<Record<Language, number>> = {};
  const counts: Record<Language, number> = {
    typescript: tsCount,
    javascript: jsCount,
    python: pyCount,
    go: goCount,
    rust: rsCount,
  };
  for (const l of languages) codeFiles[l] = counts[l];
  const detectedTotal = languages.reduce((n, l) => n + counts[l], 0);
  const share = (...langs: Language[]): number => {
    const present = langs.filter((l) => languages.includes(l));
    if (present.length === 0) return 0;
    if (detectedTotal === 0) return present.length / languages.length;
    return present.reduce((n, l) => n + counts[l], 0) / detectedTotal;
  };

  return {
    root,
    isGit,
    files,
    trackedHeavy,
    truncated,
    languages,
    codeFiles,
    share,
    pkg,
    pyproject,
    packageManager: detectPackageManager(root, pkg),
    config,
    exists: (rel) => existsSync(join(root, rel)),
    has: (rel) => fileSet.has(rel),
    read,
    readJson<T>(rel: string): T | null {
      const text = read(rel);
      return text === null ? null : (parseJsonc(text) as T | null);
    },
    size,
    lineCount,
    isIgnored,
    hasTracked,
    filesWithExt,
    scripts: () => pkg?.scripts ?? {},
    allDeps: () => ({ ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }),
  };
}

/** Command to run a package.json script with the detected package manager. */
export function runScriptCmd(ctx: RepoContext, script: string): string {
  const pm = ctx.packageManager;
  if (script === 'test' && pm !== 'bun') return `${pm} test`;
  if (pm === 'npm') return `npm run ${script}`;
  return `${pm} ${pm === 'bun' ? 'run ' : ''}${script}`;
}
