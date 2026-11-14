import type { RepoContext } from '../context.js';
import type { Check, CheckResult, Finding } from '../types.js';

interface SecretRule {
  name: string;
  re: RegExp;
}

// Patterns are assembled from pieces so this file doesn't flag itself.
const SECRET_RULES: SecretRule[] = [
  { name: 'AWS access key', re: new RegExp(`\\b(?:AK${'IA'}|AS${'IA'})[0-9A-Z]{16}\\b`) },
  {
    name: 'GitHub token',
    re: new RegExp(`\\bgh[pousr]_[A-Za-z0-9]{36,}\\b|github_${'pat'}_[A-Za-z0-9_]{50,}`),
  },
  { name: 'Slack token', re: new RegExp(`\\bxo${'x'}[baprs]-[A-Za-z0-9-]{10,}`) },
  {
    name: 'Private key',
    re: new RegExp(
      `-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE ${'KEY'}(?: BLOCK)?-----`,
    ),
  },
  { name: 'Stripe live key', re: new RegExp(`\\b[sr]k_${'live'}_[0-9a-zA-Z]{20,}`) },
  { name: 'Anthropic API key', re: new RegExp(`\\bsk-${'ant'}-[A-Za-z0-9_-]{20,}`) },
  {
    name: 'OpenAI API key',
    re: new RegExp(
      `\\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}T3Blbk${'FJ'}[A-Za-z0-9_-]{20,}|\\bsk-proj-[A-Za-z0-9_-]{40,}`,
    ),
  },
  { name: 'Google API key', re: new RegExp(`\\bAI${'za'}[0-9A-Za-z_-]{35}\\b`) },
  { name: 'npm token', re: new RegExp(`\\bnp${'m'}_[A-Za-z0-9]{36}\\b`) },
];

const PLACEHOLDER = /EXAMPLE|example|xxxx|XXXX|your[-_]?|<|placeholder|dummy|fake|redacted/i;
const SUPPRESS = 'agent-ready-ignore';

const SECRET_FILES = [
  {
    re: /(^|\/)\.env(\.(?:local|prod|production|staging|live)[\w.-]*)?$/,
    name: 'dotenv file',
  },
  { re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, name: 'SSH private key' },
  { re: /\.(pem|p12|pfx|key|keystore|jks)$/, name: 'key/certificate file' },
  { re: /(^|\/)(credentials|service-account|secrets?)\.json$/, name: 'credentials file' },
  { re: /(^|\/)\.(netrc|pgpass|htpasswd)$/, name: 'credentials file' },
];

const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|mp[34]|mov|wasm|so|dylib|dll|exe|bin|lockb|sqlite|db)$/i;

/** Non-production dotenv files (.env.test, .env.development, ...) are often committed with dummy values. */
const SOFT_ENV_FILE = /(^|\/)\.env\.(?!example$|sample$|template$|dist$|defaults?$)[\w.-]+$/;
const SECRET_KEY_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|HASH|PRIVATE|CREDENTIAL)/i;
const DUMMY_VALUE =
  /^(?:test|testing|dummy|fake|mock|changeme|change-me|password|secret|local|dev|none|null|x+|\*+|0+|1234\d*)$|test|dummy|fake|mock|example|xxx|placeholder|your/i;

function softEnvFinding(f: string, text: string): Finding | null {
  for (const [i, raw] of text.split('\n').entries()) {
    const m = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1] ?? '';
    const value = (m[2] ?? '').trim().replace(/^['"]|['"]$/g, '');
    if (
      SECRET_KEY_NAME.test(key) &&
      value.length >= 6 &&
      !DUMMY_VALUE.test(value) &&
      !value.startsWith('$')
    ) {
      return {
        severity: 'warn',
        file: f,
        line: i + 1,
        message: `${key} has a real-looking value in a committed env file`,
      };
    }
  }
  return null;
}

export function scanSecrets(ctx: RepoContext): Finding[] {
  const findings: Finding[] = [];
  for (const f of ctx.files) {
    if (SOFT_ENV_FILE.test(f) && !SECRET_FILES[0]?.re.test(f)) {
      const soft = softEnvFinding(f, ctx.read(f) ?? '');
      if (soft) findings.push(soft);
      continue;
    }
    const fileRule = SECRET_FILES.find((r) => r.re.test(f));
    if (fileRule && !/\.(pub|crt)$/.test(f)) {
      findings.push({
        severity: 'error',
        file: f,
        message: `${fileRule.name} is visible in the repo`,
      });
      continue;
    }
    if (
      BINARY_EXT.test(f) ||
      /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock)$/.test(f)
    )
      continue;
    const sz = ctx.size(f);
    if (sz <= 0 || sz > 512 * 1024) continue;
    const text = ctx.read(f);
    if (!text || text.includes('\0')) continue;
    for (const rule of SECRET_RULES) {
      const m = rule.re.exec(text);
      if (!m) continue;
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      const lineEnd = text.indexOf('\n', m.index);
      const lineText = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      if (PLACEHOLDER.test(m[0]) || lineText.includes(SUPPRESS)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({ severity: 'error', file: f, line, message: `possible ${rule.name}` });
      break;
    }
  }
  return findings;
}

interface DangerRule {
  re: RegExp;
  why: string;
}

const DANGER_RULES: DangerRule[] = [
  {
    re: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?[a-zA-Z]*\s+(?:--no-preserve-root\s+)?(?:\/(?:\s|$|\*)|~\/?(?:\s|$)|\$HOME\b|\$\{HOME\}|\.\.\/)/,
    why: 'recursive delete outside the repo',
  },
  {
    re: /\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/,
    why: 'pipes a remote script into a shell',
  },
  { re: /\bsudo\b/, why: 'uses sudo' },
  { re: /\bchmod\s+(?:-R\s+)?0?777\b/, why: 'world-writable permissions' },
  { re: /\bgit\s+push\b[^;&|]*(?:--force\b|-f\b)/, why: 'force-pushes' },
  { re: /\bgit\s+reset\s+--hard\b/, why: 'discards local changes' },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/, why: 'deletes untracked files' },
  { re: /\bDROP\s+(?:DATABASE|SCHEMA)\b/i, why: 'drops a database' },
  { re: /\bdocker\s+system\s+prune\b/, why: 'prunes all docker data' },
];

const PUBLISH = /\b(?:npm|pnpm|yarn)\s+publish\b|\btwine\s+upload\b|\bpoetry\s+publish\b/;
const RISKY_FOR_PUBLISH = new Set([
  'test',
  'build',
  'lint',
  'dev',
  'start',
  'check',
  'typecheck',
  'prepare',
  'postinstall',
  'install',
  'preinstall',
  'format',
]);

/** True if a package.json script is destructive or publishes — never recommend it to agents. */
export function isDangerousScript(body: string): boolean {
  return PUBLISH.test(body) || DANGER_RULES.some((r) => r.why !== 'uses sudo' && r.re.test(body));
}

export function scanScripts(ctx: RepoContext): Finding[] {
  const findings: Finding[] = [];
  for (const [name, body] of Object.entries(ctx.scripts())) {
    for (const rule of DANGER_RULES) {
      if (rule.re.test(body))
        findings.push({
          severity: 'warn',
          file: 'package.json',
          message: `script "${name}" ${rule.why}: \`${body.slice(0, 80)}\``,
        });
    }
    if (RISKY_FOR_PUBLISH.has(name) && PUBLISH.test(body)) {
      findings.push({
        severity: 'warn',
        file: 'package.json',
        message: `script "${name}" publishes a package — an agent running "${name}" would release`,
      });
    }
    if (/^(pre|post)?install$/.test(name) && /\b(curl|wget)\b/.test(body)) {
      findings.push({
        severity: 'warn',
        file: 'package.json',
        message: `install hook "${name}" downloads from the network`,
      });
    }
  }
  const targets = [
    'Makefile',
    'justfile',
    ...ctx.files.filter((f) => /^[^/]+\.sh$/.test(f) || /^scripts\/[^/]+\.sh$/.test(f)),
  ];
  for (const f of targets) {
    const text = ctx.read(f);
    if (!text) continue;
    text.split('\n').forEach((line, i) => {
      if (/^\s*#/.test(line) || line.includes(SUPPRESS)) return;
      for (const rule of DANGER_RULES) {
        if (rule.why === 'uses sudo') continue; // common and intentional in setup scripts
        if (rule.re.test(line))
          findings.push({
            severity: 'warn',
            file: f,
            line: i + 1,
            message: `${rule.why}: \`${line.trim().slice(0, 80)}\``,
          });
      }
    });
  }
  return findings;
}

export const safetyChecks: Check[] = [
  {
    id: 'safety.secrets',
    category: 'safety',
    title: 'No secrets in the repo',
    weight: 3,
    run(ctx): CheckResult {
      const findings = scanSecrets(ctx);
      const errors = findings.filter((f) => f.severity === 'error').length;
      const warns = findings.length - errors;
      const score =
        findings.length === 0
          ? 1
          : errors === 0
            ? Math.max(0.5, 0.85 - 0.1 * (warns - 1))
            : Math.max(0, 0.5 - 0.25 * (errors - 1) - 0.05 * warns);
      return {
        score,
        summary:
          findings.length === 0
            ? 'No committed secrets or credential files found'
            : `${findings.length} possible secret(s) visible to agents`,
        findings: findings.slice(0, 20),
        suggestion: findings.length
          ? 'Remove the secret, rotate it, and add the file to .gitignore. Agents read and paste whatever they can see.'
          : undefined,
      };
    },
  },
  {
    id: 'safety.scripts',
    category: 'safety',
    title: 'No dangerous scripts',
    weight: 1,
    run(ctx): CheckResult {
      const findings = scanScripts(ctx);
      const score = Math.max(0, 1 - 0.34 * findings.length);
      return {
        score,
        summary:
          findings.length === 0
            ? 'Scripts look safe for agents to run'
            : `${findings.length} risky script command(s)`,
        findings: findings.slice(0, 20),
        suggestion: findings.length
          ? 'Agents run scripts liberally. Move destructive/publishing steps behind explicit, clearly named scripts (e.g. `release`).'
          : undefined,
      };
    },
  },
];
