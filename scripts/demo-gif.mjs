#!/usr/bin/env node
// Generates docs/demo.gif (and docs/demo.png, a still of the first report) from the real CLI.
//
//   npm run demo:gif
//
// 1. Writes a small synthetic TypeScript repo ("acme-api") to a temp dir. No real repos are shown.
// 2. Runs dist/bin.js against it with colors forced: scan, --fix, --badge.
// 3. Renders the ANSI output into a styled terminal page in Google Chrome (Playwright,
//    channel: 'chrome'), screenshotting one frame per visual state (typing, line reveal).
// 4. Encodes the frames with ffmpeg palettegen/paletteuse into a GIF with per-frame delays.
//
// Env: FFMPEG (default: ffmpeg on PATH, then /opt/homebrew/bin/ffmpeg), DEMO_KEEP=1 keeps frames.

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'dist', 'bin.js');
const OUT_GIF = join(ROOT, 'docs', 'demo.gif');
const OUT_PNG = join(ROOT, 'docs', 'demo.png');
const SHOWN_PATH = '~/code/acme-api';

const WIDTH = 1200;
const FONT_SIZE = 14;
const LINE_H = 20;
const PROMPT = `<span class="c-cyan">${SHOWN_PATH}</span> <span class="c-green">❯</span> `;

// ---------------------------------------------------------------------------------------------
// Synthetic fixture: a plausible, mediocre TS service (no agent docs, no linter, no .gitignore).

const FIXTURE = {
  'package.json': `${JSON.stringify(
    {
      name: 'acme-api',
      version: '1.4.0',
      private: true,
      type: 'module',
      scripts: { dev: 'tsx watch src/server.ts', build: 'tsc', test: 'vitest run' },
      devDependencies: { tsx: '^4.19.0', typescript: '^5.6.0', vitest: '^2.1.0' },
    },
    null,
    2,
  )}\n`,
  'tsconfig.json': `${JSON.stringify(
    {
      compilerOptions: { strict: true, target: 'ES2022', module: 'NodeNext', outDir: 'dist' },
      include: ['src'],
    },
    null,
    2,
  )}\n`,
  'README.md': [
    '# acme-api',
    '',
    'Internal orders API for the Acme storefront.',
    '',
    '## Setup',
    '',
    '```bash',
    'npm install',
    'npm run dev',
    '```',
    '',
    '## Usage',
    '',
    'The server listens on port 3000. `GET /orders` returns recent orders.',
    '',
    '## Deploy',
    '',
    'Deploys run from CI on every merge to `main`.',
    '',
  ].join('\n'),
  '.github/workflows/ci.yml': [
    'name: ci',
    'on: [push]',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - run: npm ci && npm test',
    '',
  ].join('\n'),
  'src/server.ts': [
    "import { createServer } from 'node:http';",
    "import { orders } from './routes/orders.js';",
    '',
    'createServer((req, res) => orders(req as any, res)).listen(3000);',
    '',
  ].join('\n'),
  'src/routes/orders.ts': [
    'export function orders(req: any, res: any) {',
    '  res.end(JSON.stringify({ ok: true, path: req.url }));',
    '}',
    '',
  ].join('\n'),
  'test/orders.test.ts': [
    "import { expect, test } from 'vitest';",
    '',
    "test('orders responds', () => expect(1).toBe(1));",
    '',
  ].join('\n'),
  // Committed build output, so the .gitignore finding is real.
  'dist/server.js': 'import{createServer as e}from"node:http";e(()=>{}).listen(3e3);\n',
};

function makeFixture() {
  const base = mkdtempSync(join(tmpdir(), 'agent-ready-demo-'));
  const dir = join(base, 'acme-api');
  for (const [rel, content] of Object.entries(FIXTURE)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.com', ...args], {
      cwd: dir,
      stdio: 'ignore',
    });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { base, dir };
}

function runCli(dir, args) {
  const env = { ...process.env, FORCE_COLOR: '1' };
  delete env.NO_COLOR;
  const out = execFileSync(process.execPath, [BIN, '.', ...args], {
    cwd: dir,
    env,
    encoding: 'utf8',
  });
  let text = out;
  for (const p of new Set([realpathSync(dir), dir])) text = text.split(p).join(SHOWN_PATH);
  return text.replace(/\n+$/, '').split('\n');
}

// ---------------------------------------------------------------------------------------------
// ANSI SGR -> HTML

const SGR = {
  1: 'b',
  2: 'dim',
  31: 'c-red',
  32: 'c-green',
  33: 'c-yellow',
  34: 'c-blue',
  35: 'c-magenta',
  36: 'c-cyan',
  90: 'c-gray',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ansiToHtml(line) {
  let html = '';
  let classes = [];
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the point
  const re = /\x1b\[([\d;]*)m/g;
  let last = 0;
  const flush = (text) => {
    if (!text) return;
    html += classes.length ? `<span class="${classes.join(' ')}">${esc(text)}</span>` : esc(text);
  };
  for (let m = re.exec(line); m; m = re.exec(line)) {
    flush(line.slice(last, m.index));
    last = re.lastIndex;
    for (const code of (m[1] || '0').split(';').map(Number)) {
      if (code === 0) classes = [];
      else if (SGR[code])
        classes = [
          ...classes.filter((c) => !c.startsWith('c-') || !SGR[code].startsWith('c-')),
          SGR[code],
        ];
    }
  }
  flush(line.slice(last));
  return html || ' ';
}

// ---------------------------------------------------------------------------------------------
// Timeline: a list of { lines, cursor, overlay, ms } states. Identical neighbours are merged.

function buildTimeline({ scan, fix, badge }) {
  const states = [];
  let screen = [];
  const push = (ms, extra = {}) => {
    states.push({
      lines: screen.slice(),
      cursor: extra.cursor ?? null,
      overlay: extra.overlay ?? false,
      poster: extra.poster ?? false,
      ms,
    });
  };
  const hold = (ms, extra = {}) => {
    // Blink the cursor during long holds.
    if (!extra.cursor) return push(ms, extra);
    for (let t = 0; t < ms; t += 500)
      push(Math.min(500, ms - t), { ...extra, cursor: (t / 500) % 2 === 0 ? extra.cursor : 'off' });
  };
  const type = (cmd) => {
    screen.push(PROMPT);
    const idx = screen.length - 1;
    hold(500, { cursor: 'on' });
    for (let i = 1; i <= cmd.length; i++) {
      screen[idx] = PROMPT + esc(cmd.slice(0, i));
      push(cmd[i - 1] === ' ' ? 90 : 50 + ((i * 37) % 40), { cursor: 'on' });
    }
    push(350, { cursor: 'on' });
  };
  const reveal = (lines, perFrame, ms) => {
    for (let i = 0; i < lines.length; i += perFrame) {
      screen.push(...lines.slice(i, i + perFrame).map(ansiToHtml));
      push(ms);
    }
  };
  const prompt = () => screen.push(PROMPT);

  // 1. Score the repo.
  type('npx agent-ready');
  push(250);
  reveal(scan, 2, 30);
  prompt();
  hold(4000, { cursor: 'on', poster: true });

  // 2. --fix: diff, score jump, nudge.
  screen = [];
  type('npx agent-ready --fix');
  push(200);
  const scoreAt = fix.findIndex((l) => l.includes('Score'));
  reveal(fix.slice(0, 18), 2, 40); // let "Created AGENTS.md" register before it scrolls away
  push(900);
  reveal(fix.slice(18, scoreAt), 3, 30);
  push(500);
  reveal([fix[scoreAt]], 1, 900);
  reveal(fix.slice(scoreAt + 1), 1, 300);
  prompt();
  hold(3500, { cursor: 'on' });

  // 3. --badge, plus how it renders in a README.
  screen = [];
  type('npx agent-ready --badge');
  push(200);
  reveal(badge, 1, 300);
  prompt();
  hold(700, { cursor: 'on' });
  hold(3000, { cursor: 'off', overlay: true });

  const merged = [];
  for (const s of states) {
    const prev = merged.at(-1);
    if (
      prev &&
      prev.poster === s.poster &&
      prev.cursor === s.cursor &&
      prev.overlay === s.overlay &&
      prev.lines.join('\n') === s.lines.join('\n')
    )
      prev.ms += s.ms;
    else merged.push({ ...s });
  }
  return merged;
}

// ---------------------------------------------------------------------------------------------
// Page

function pageHtml(score) {
  const color =
    score >= 90
      ? '#4c1'
      : score >= 75
        ? '#97ca00'
        : score >= 60
          ? '#dfb317'
          : score >= 40
            ? '#fe7d37'
            : '#e05d44';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${WIDTH}px; background: #0b0e14; }
  body { padding: 28px 30px 30px; font-family: Menlo, 'SF Mono', ui-monospace, monospace; }
  .win { background: #11151c; border: 1px solid #262c36; border-radius: 12px; overflow: hidden; position: relative;
         box-shadow: 0 20px 50px rgba(0,0,0,.45); }
  .bar { height: 38px; display: flex; align-items: center; padding: 0 14px; background: #181d26; border-bottom: 1px solid #232a35; }
  .dot { width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; }
  .title { flex: 1; text-align: center; color: #7d8590; font: 13px -apple-system, 'Helvetica Neue', sans-serif; margin-right: 60px; }
  .pad { padding: 16px 22px 18px; }
  #term { color: #d6dbe2; font-size: ${FONT_SIZE}px; line-height: ${LINE_H}px;
          white-space: pre-wrap; overflow: hidden; -webkit-font-smoothing: antialiased; }
  .b { font-weight: 700; color: #f0f3f6; } .dim { opacity: .65; }
  .c-red { color: #ff7b72; } .c-green { color: #56d364; } .c-yellow { color: #e3b341; } .c-blue { color: #79c0ff; }
  .c-magenta { color: #d2a8ff; } .c-cyan { color: #56d4dd; } .c-gray { color: #7d8590; }
  .b.c-red { color: #ff7b72; } .b.c-green { color: #56d364; } .b.c-yellow { color: #e3b341; }
  .cur { display: inline-block; width: .6em; height: 1.2em; background: #d6dbe2; vertical-align: -.25em; }
  .cur.off { visibility: hidden; }
  #overlay { position: absolute; left: 0; right: 0; top: 210px; display: none; justify-content: center; }
  .card { background: #ffffff; border-radius: 10px; padding: 0; overflow: hidden; min-width: 620px; box-shadow: 0 12px 40px rgba(0,0,0,.5);
          font: 15px -apple-system, 'Helvetica Neue', sans-serif; color: #1f2328; }
  .card .file { background: #f6f8fa; border-bottom: 1px solid #d1d9e0; padding: 10px 20px; font-size: 13px; font-weight: 600; color: #59636e; }
  .card .body { padding: 22px 28px 24px; }
  .card h1 { font-size: 30px; margin-bottom: 14px; font-weight: 600; padding-bottom: 8px; border-bottom: 1px solid #d1d9e0; }
  .card .row { display: flex; gap: 6px; align-items: center; }
  .shield { display: inline-flex; font: 16px Verdana, 'DejaVu Sans', sans-serif; border-radius: 4px; overflow: hidden; height: 30px;
            color: #fff; text-shadow: 0 1px 0 rgba(1,1,1,.3); }
  .shield span { padding: 0 9px; line-height: 30px; }
  .note { color: #59636e; font-size: 13px; margin-top: 14px; }
</style></head><body>
<div class="win">
  <div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span>
    <span class="dot" style="background:#28c840"></span><span class="title">acme-api — zsh</span></div>
  <div class="pad"><div id="term"></div></div>
  <div id="overlay"><div class="card"><div class="file">README.md</div><div class="body"><h1>acme-api</h1>
    <div class="row"><span class="shield"><span style="background:#555">agent-ready</span><span style="background:${color}">${score}/100</span></span></div>
    <div class="note">Paste it into your README. It tells contributors, human and AI, that your repo is ready for them.</div>
  </div></div></div>
</div></body></html>`;
}

// ---------------------------------------------------------------------------------------------

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    if (existsSync('/opt/homebrew/bin/ffmpeg')) return '/opt/homebrew/bin/ffmpeg';
    throw new Error('ffmpeg not found; set FFMPEG=/path/to/ffmpeg');
  }
}

async function main() {
  if (!existsSync(BIN)) throw new Error('dist/bin.js missing; run `npm run build` first');
  const ffmpeg = findFfmpeg();
  const { base, dir } = makeFixture();
  const frames = join(base, 'frames');
  mkdirSync(frames);
  try {
    const scan = runCli(dir, []);
    const fixAll = runCli(dir, ['--fix']);
    // --fix re-prints the full report after the nudge; the demo stops at the nudge.
    const nudgeEnd = fixAll.findIndex((l) => l.includes('Generated docs earn partial credit'));
    const fix = fixAll.slice(0, nudgeEnd === -1 ? fixAll.length : nudgeEnd + 1);
    if (!fix.some((l) => l.includes('Score'))) throw new Error('--fix printed no score line');
    const badge = runCli(dir, ['--badge']);
    const score = Number(/agent-ready: (\d+)\/100/.exec(badge.join('\n'))?.[1] ?? 0);

    const states = buildTimeline({ scan, fix, badge });

    const browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: 400 },
      deviceScaleFactor: 1,
    });
    await page.setContent(pageHtml(score));
    // Size the terminal so the whole first report (the poster frame) fits without scrolling.
    const poster = states.find((s) => s.poster);
    await page.evaluate(
      (html) => {
        const term = document.getElementById('term');
        term.innerHTML = html;
        term.style.height = `${term.scrollHeight}px`;
      },
      `${poster.lines.join('\n')}<span class="cur"></span>`,
    );
    const height = await page.evaluate(() =>
      Math.ceil(document.body.getBoundingClientRect().height),
    );
    await page.setViewportSize({ width: WIDTH, height: height + (height % 2) });

    const list = [];
    let posterFrame = null;
    for (const [i, s] of states.entries()) {
      await page.evaluate(({ lines, cursor, overlay }) => {
        const out = lines.slice();
        if (cursor)
          out[out.length - 1] += `<span class="cur${cursor === 'off' ? ' off' : ''}"></span>`;
        const term = document.getElementById('term');
        term.innerHTML = out.join('\n');
        term.scrollTop = term.scrollHeight; // scroll like a real terminal
        document.getElementById('overlay').style.display = overlay ? 'flex' : 'none';
      }, s);
      const file = join(frames, `f${String(i).padStart(4, '0')}.png`);
      await page.screenshot({ path: file });
      if (s.poster && !posterFrame) posterFrame = file;
      list.push(`file '${file}'`, `duration ${(Math.round(s.ms / 10) / 100).toFixed(2)}`);
    }
    await browser.close();
    list.push(`file '${join(frames, `f${String(states.length - 1).padStart(4, '0')}.png`)}'`);
    writeFileSync(join(frames, 'list.txt'), `${list.join('\n')}\n`);

    mkdirSync(dirname(OUT_GIF), { recursive: true });
    execFileSync(
      ffmpeg,
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        join(frames, 'list.txt'),
        '-vf',
        'split[a][b];[a]palettegen=max_colors=256:stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
        '-fps_mode',
        'vfr',
        '-loop',
        '0',
        OUT_GIF,
      ],
      { stdio: 'inherit' },
    );
    if (posterFrame) copyFileSync(posterFrame, OUT_PNG);
    const total = states.reduce((n, s) => n + s.ms, 0) / 1000;
    const mb = (statSync(OUT_GIF).size / 1024 / 1024).toFixed(2);
    console.log(
      `wrote ${OUT_GIF} (${WIDTH}x${height}, ${states.length} frames, ${total.toFixed(1)}s, ${mb} MB)`,
    );
    if (posterFrame) console.log(`wrote ${OUT_PNG}`);
  } finally {
    if (process.env.DEMO_KEEP) console.log(`kept ${base}`);
    else rmSync(base, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
