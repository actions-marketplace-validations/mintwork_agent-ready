import { describe, expect, it } from 'vitest';
import { detectCommands, extractPathRefs, extractScriptRefs } from '../src/checks/context-docs.js';
import { pythonAnnotationCoverage, resolveCompilerOptions } from '../src/checks/type-safety.js';
import { createContext } from '../src/context.js';
import { fixture } from './helpers.js';

describe('context doc parsing', () => {
  it('detects command kinds in code', () => {
    const md = '```bash\nnpm test\npnpm lint\nnpm run build\n```';
    expect([...detectCommands(md)].sort()).toEqual(['build', 'lint', 'test']);
    expect(detectCommands('run the tests please').size).toBe(0);
    expect(detectCommands('`uv run pytest -q` and `ruff check .`').has('test')).toBe(true);
  });

  it('extracts path-like references and skips URLs/packages/flags', () => {
    const md = [
      'See `src/index.ts`, `README.md` and [guide](docs/guide.md#intro).',
      'Not paths: `https://x.dev/a`, `--flag`, `@scope/pkg`, `and/or`, `dist/out.js`, `npm test`.',
      '@AGENTS.md',
    ].join('\n');
    expect(extractPathRefs(md).sort()).toEqual([
      'AGENTS.md',
      'README.md',
      'docs/guide.md',
      'src/index.ts',
    ]);
  });

  it('extracts script references', () => {
    const md = '```\nnpm run build\npnpm dev:watch\nyarn install\n```';
    expect(extractScriptRefs(md).sort()).toEqual(['build', 'dev:watch']);
  });
});

describe('python annotations', () => {
  it('counts annotated vs bare functions, including multi-line signatures', () => {
    const src = [
      'def a(x: int) -> int:',
      '    return x',
      'def b(x):',
      '    pass',
      'class C:',
      '    def m(self, y: str):',
      '        pass',
      '    async def n(',
      '        self,',
      '        z,',
      '    ) -> None:',
      '        pass',
    ].join('\n');
    expect(pythonAnnotationCoverage(src)).toEqual({ total: 4, annotated: 3 });
  });
});

describe('tsconfig resolution', () => {
  it('follows relative extends', () => {
    const dir = fixture(null, {
      files: {
        'tsconfig.base.json': '{ "compilerOptions": { "strict": true } }',
        'tsconfig.json':
          '{ "extends": "./tsconfig.base", "compilerOptions": { "target": "ES2022" } }',
        'src/a.ts': 'export const a = 1;\n',
      },
    });
    const opts = resolveCompilerOptions(createContext(dir));
    expect(opts).toMatchObject({ strict: true, target: 'ES2022' });
  });
});
