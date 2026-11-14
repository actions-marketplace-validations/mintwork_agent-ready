import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { createContext } from '../src/context.js';
import { generateAgentsMd } from '../src/fix/agents-md.js';
import { applyFixes, planFixes } from '../src/fix/index.js';
import { scan } from '../src/scan.js';
import { fixture } from './helpers.js';

describe('--fix', () => {
  it('generates AGENTS.md + CLAUDE.md + .gitignore and raises the score', async () => {
    const dir = fixture('bad-py', { git: true });
    const before = await scan(dir);
    const ctx = createContext(dir);
    const changes = planFixes(ctx);
    expect(changes.map((c) => c.path).sort()).toEqual(['.gitignore', 'AGENTS.md', 'CLAUDE.md']);
    const res = applyFixes(ctx, changes, { force: false, dryRun: false });
    expect(res.written).toHaveLength(3);
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('pip install -r requirements.txt');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('@AGENTS.md');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('__pycache__/');
    const after = await scan(dir);
    expect(after.score).toBeGreaterThan(before.score + 5);
    // generated docs must not be stale themselves (full credit once a human fills them in)
    expect(after.checks.find((c) => c.id === 'context.fresh')?.potential).toBe(1);
  });

  it('generates docs with real commands for a JS/TS project', () => {
    const dir = fixture('good-ts', { git: true });
    const ctx = createContext(dir);
    const md = generateAgentsMd(ctx);
    expect(md).toContain('npm run build');
    expect(md).toContain('npm test');
    expect(md).toContain('`src/` — Main source code');
  });

  it('appends missing .gitignore entries without touching existing lines', () => {
    const dir = fixture('good-ts', {
      git: true,
      files: { '.gitignore': 'dist/\n', 'node_modules/x/index.js': '1' },
    });
    const ctx = createContext(dir);
    const change = planFixes(ctx).find((c) => c.path === '.gitignore');
    expect(change?.kind).toBe('append');
    applyFixes(ctx, change ? [change] : [], { force: false, dryRun: false });
    const text = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(text.startsWith('dist/\n')).toBe(true);
    expect(text).toContain('node_modules/');
  });

  it('never overwrites an existing file without --force', () => {
    const dir = fixture('bad-py');
    const ctx = createContext(dir);
    const changes = planFixes(ctx);
    // Simulate a race: someone created AGENTS.md after planning.
    writeFileSync(join(dir, 'AGENTS.md'), 'mine\n');
    const res = applyFixes(ctx, changes, { force: false, dryRun: false });
    expect(res.skipped.map((s) => s.change.path)).toContain('AGENTS.md');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('mine\n');
    const forced = applyFixes(ctx, changes, { force: true, dryRun: false });
    expect(forced.written.map((w) => w.path)).toContain('AGENTS.md');
  });

  it('dry-run writes nothing', () => {
    const dir = fixture('bad-py');
    const ctx = createContext(dir);
    applyFixes(ctx, planFixes(ctx), { force: false, dryRun: true });
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
  });

  it('adds AGENTS.md pointer when only CLAUDE.md exists', () => {
    const dir = fixture('bad-js', { git: true });
    const changes = planFixes(createContext(dir));
    const agents = changes.find((c) => c.path === 'AGENTS.md');
    expect(agents?.after).toContain('CLAUDE.md');
    // The existing (thin) CLAUDE.md gets missing sections appended, never rewritten.
    const claude = changes.find((c) => c.path === 'CLAUDE.md');
    expect(claude?.kind).toBe('append');
    expect(claude?.after.startsWith(claude.before ?? '\u0000')).toBe(true);
    expect(claude?.after).toContain('## Commands');
    expect(claude?.after).toContain('## Architecture');
  });
});

describe('generated docs safety', () => {
  it('never recommends a script that publishes or deletes', () => {
    const md = generateAgentsMd(createContext(fixture('bad-js')));
    expect(md).not.toContain('npm run build');
    expect(md).not.toContain('npm run clean');
  });
});

describe('--fix output for real-world layouts', () => {
  it("prefers a Python project's own scripts and points mypy at the package", () => {
    const dir = fixture(null, {
      git: true,
      files: {
        'pyproject.toml': '[project]\nname = "web-kit"\n[tool.mypy]\nstrict = true\n[tool.ruff]\n',
        'uv.lock': '',
        'web_kit/__init__.py': '',
        'tests/test_app.py': 'def test_a() -> None: ...\n',
        'scripts/test.sh': '#!/usr/bin/env bash\nexport PYTHONPATH=./docs_src\npytest tests\n',
      },
    });
    const md = generateAgentsMd(createContext(dir));
    expect(md).toContain('uv run bash scripts/test.sh');
    expect(md).not.toMatch(/uv run pytest/);
    expect(md).toContain('uv run mypy web_kit');
    expect(md).toContain('`web_kit/` — Main package source');
  });

  it('uses Makefile test/lint targets when they exist', () => {
    const dir = fixture(null, {
      git: true,
      files: {
        'pyproject.toml': '[project]\nname = "x"\n[tool.ruff]\n',
        Makefile: 'test:\n\tpytest\nlint:\n\truff check .\n',
        'tests/test_x.py': '',
      },
    });
    const md = generateAgentsMd(createContext(dir));
    expect(md).toContain('make test');
    expect(md).toContain('make lint');
    expect(md).not.toContain('ruff check .  #');
  });

  it('lists workspace crates and uses --workspace for Cargo workspaces', () => {
    const dir = fixture(null, {
      git: true,
      files: {
        'Cargo.toml': '[package]\nname = "tool"\n\n[workspace]\nmembers = ["crates/*"]\n',
        'src/main.rs': 'fn main() {}\n',
        'crates/core/src/lib.rs': '',
        'crates/cli/src/lib.rs': '',
        'pkg/brew/tool.rb': '',
      },
    });
    const md = generateAgentsMd(createContext(dir));
    expect(md).toContain('cargo test --workspace');
    expect(md).toContain('`crates/` — Workspace crates: `cli`, `core`');
    // `pkg/` only means "Go library packages" in Go repos
    expect(md).toContain('`pkg/` — TODO: describe');
  });

  it('describes Go layout dirs in Go repos', () => {
    const dir = fixture(null, {
      git: true,
      files: {
        'go.mod': 'module example.com/x\n',
        'cmd/x/main.go': 'package main\n',
        'pkg/api/api.go': 'package api\n',
        'pkg/api/api_test.go': 'package api\n',
      },
    });
    const md = generateAgentsMd(createContext(dir));
    expect(md).toContain('go test ./...');
    expect(md).toContain('`pkg/` — Library packages');
    expect(md).toContain('Languages: Go.');
  });
});

describe('generated docs earn partial credit until a human edits them', () => {
  const pyRepo = () =>
    fixture(null, {
      git: true,
      files: {
        'pyproject.toml': '[project]\nname = "shop"\n[tool.ruff]\n[tool.mypy]\n',
        'shop/__init__.py': '',
        'shop/cart.py': 'def total(x: int) -> int:\n    return x\n',
        'tests/test_cart.py': 'def test_total() -> None: ...\n',
        'billing/__init__.py': '',
        'README.md': `# shop\n${'\nline'.repeat(12)}\n`,
      },
    });

  async function fixAndRead(dir: string) {
    const ctx = createContext(dir);
    applyFixes(ctx, planFixes(ctx), { force: false, dryRun: false });
    return readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  }

  const ctxCheck = (r: Awaited<ReturnType<typeof scan>>, id: string) =>
    r.checks.find((c) => c.id === id);

  it('caps an unedited generated AGENTS.md at about half credit and reports what to unlock', async () => {
    const dir = pyRepo();
    const before = await scan(dir);
    await fixAndRead(dir);
    const after = await scan(dir);
    expect(ctxCheck(after, 'context.commands')?.score).toBeCloseTo(0.5);
    expect(ctxCheck(after, 'context.commands')?.potential).toBe(1);
    expect(ctxCheck(after, 'context.coverage')?.potential).toBeUndefined();
    expect(after.templateDocs).toEqual(['AGENTS.md']);
    expect(after.potentialScore).toBeGreaterThan(after.score + 5);
    // --fix alone is worth well under the full context category
    expect(after.score - before.score).toBeLessThan(20);
  });

  it('does not restore credit for deleting the TODOs and marker without writing anything', async () => {
    const dir = pyRepo();
    const md = await fixAndRead(dir);
    const stripped = md
      .split('\n')
      .filter((l) => !/TODO|Generated by agent-ready/.test(l))
      .join('\n');
    writeFileSync(join(dir, 'AGENTS.md'), stripped);
    const r = await scan(dir);
    expect(ctxCheck(r, 'context.commands')?.score).toBeCloseTo(0.5);
    expect(r.potentialScore).toBeGreaterThan(r.score);
  });

  it('restores full credit once the TODOs are filled in with real content and the marker is gone', async () => {
    const dir = pyRepo();
    const md = await fixAndRead(dir);
    const written = md
      .split('\n')
      .filter((l) => !l.includes('Generated by agent-ready'))
      .map((l) =>
        l.includes('TODO')
          ? l.startsWith('- `')
            ? l.replace(
                'TODO: describe',
                'Invoicing and tax rules; amounts are integer cents, never floats.',
              )
            : [
                '- Prices are stored as integer cents; never introduce floats in `shop/cart.py`.',
                '- Tests use an in-memory store; set `SHOP_DB=memory` when running a single test.',
                '- The public API is re-exported from `shop/__init__.py`; keep it backwards compatible.',
              ].join('\n')
          : l,
      )
      .join('\n');
    writeFileSync(join(dir, 'AGENTS.md'), written);
    const r = await scan(dir);
    expect(ctxCheck(r, 'context.commands')?.score).toBe(1);
    expect(r.potentialScore).toBe(r.score);
    expect(r.templateDocs).toEqual([]);
  });

  it('keeping the marker after filling in still leaves a little credit on the table', async () => {
    const dir = pyRepo();
    const md = await fixAndRead(dir);
    const filled = md
      .replace(
        /<!-- TODO: non-obvious[^\n]*-->/,
        '- Prices are integer cents everywhere; the billing package rounds only at invoice time.\n- Run a single test with `pytest tests/test_cart.py -k total`; the suite has no network calls.\n- Never import billing from shop: billing depends on shop, not the other way around.',
      )
      .replace(/TODO: describe/g, 'Invoicing and tax rules, kept separate from the cart logic.');
    writeFileSync(join(dir, 'AGENTS.md'), filled);
    const s = ctxCheck(await scan(dir), 'context.commands')?.score ?? 0;
    expect(s).toBeGreaterThan(0.85);
    expect(s).toBeLessThan(1);
  });

  it('does not cap a hand-written doc, and placeholder dir entries do not count as described', async () => {
    const dir = pyRepo();
    writeFileSync(
      join(dir, 'AGENTS.md'),
      [
        '# Shop',
        '',
        'Order and cart logic for the storefront; money is always integer cents.',
        '',
        '## Commands',
        '',
        '```bash',
        'uv run pytest',
        'uv run ruff check .',
        'uv run mypy shop',
        'uv sync',
        '```',
        '',
        '## Architecture',
        '',
        '- `billing/` — TODO: describe',
        '',
      ].join('\n'),
    );
    const r = await scan(dir);
    expect(r.templateDocs).toEqual([]);
    expect(ctxCheck(r, 'context.commands')?.score).toBe(1);
    expect(ctxCheck(r, 'context.architecture')?.summary).toMatch(/0 top-level dir/);
  });

  it('--fix prints how many points filling in the TODOs unlocks', async () => {
    let out = '';
    const sink = {
      write: (s: string) => {
        out += s;
        return true;
      },
    };
    await main([pyRepo(), '--fix', '--no-color'], {
      stdout: { ...sink, isTTY: false },
      stderr: sink,
    });
    expect(out).toMatch(/Score: \d+ → \d+/);
    expect(out).toMatch(
      /Fill in the TODO sections in AGENTS\.md to unlock the remaining \+\d+ points/,
    );
  });
});
