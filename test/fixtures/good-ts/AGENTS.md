# AGENTS.md

## Commands

```bash
npm install        # install
npm run build      # build to dist/
npm test           # vitest
npm run lint       # biome
npm run typecheck  # tsc --noEmit
```

## Architecture

- `src/` — library source; `src/index.ts` is the public entry point.
- `test/` — vitest tests mirroring `src/`.

## Conventions

- No `any`. Keep functions pure.
- Add a test in `test/` for every change.
