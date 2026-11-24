#!/usr/bin/env node
// Learn, from Claude Code's own transcripts, which commands keep failing in a project and what the
// agent ran instead that worked, so the next session can start with the working form.
//
//   node scripts/learn.mjs                     the current directory's project
//   node scripts/learn.mjs --project api       projects whose folder name contains "api"
//   node scripts/learn.mjs --write             also keep the rules in ./CLAUDE.local.md
//   node scripts/learn.mjs --json              machine-readable
//
// A pair is a failed call followed by a working variant of it, with no file edit in between:
//   a command   a Bash or PowerShell call that failed, then, within its next three calls of the
//               same tool, one that worked and differs from it in a single part of the command
//               (`pytest -q` then `python -m pytest -q`, `npm test` then `npm run test:unit`).
//               The two parts must share some text, so `npm test` then `git status` is not one.
//   a path      a Read that failed because the file does not exist, then, within the next three
//               Reads, one of a file with the same name elsewhere.
// Denials by a permission rule or the user, and the harness's own tool errors, are not failures;
// a hook's refusal is. The first call that works ends the search, and so does an unchanged retry.
// A pair counts once per session (a session's subagents are part of it) and is listed when it was
// seen in --min-sessions sessions (default 3). It is not written when the failing form also worked
// in some session, as written or with more after it (`pytest -q` for `pytest`): then the failure
// was something else, not the command. A run that learns nothing leaves the file alone.
//
// Secrets are redacted before anything is compared, printed or written: key prefixes such as
// ghp_ or sk-, Bearer and header values, passwords in URLs and JSON, `curl -u` credentials,
// secret-named variables and --token-like options. A rule that held a redacted value is listed but
// never written. No model call is made.

import { createReadStream, existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const LOOK_AHEAD = 3;
const MAX_CHANGED_WORDS = 5;
const MAX_RULES = 10;
const MAX_RULE_LENGTH = 120;
const START = '<!-- tew-learn:start -->';
const END = '<!-- tew-learn:end -->';
const REDACTED = '[REDACTED]';

// A failed call whose result starts like this was stopped by the harness or the user, not by the
// command itself.
const NOT_A_FAILURE = [
  /^<tool_use_error>/,
  /^Permission (for|to) /i,
  /auto mode classifier/i,
  /doesn't want to proceed|tool use was rejected|\[Request interrupted/i,
];
const MISSING_FILE = /does not exist|no such file|ENOENT/i;

// Output filters at the end of a pipeline: `npm test | tail -5` is still `npm test`.
const FILTERS = new Set([
  'head', 'tail', 'grep', 'rg', 'sort', 'uniq', 'wc', 'cut', 'tr', 'less', 'more', 'cat', 'column',
  'select-object', 'select-string', 'sort-object', 'measure-object', 'where-object', 'out-string',
  'out-host', 'format-table', 'format-list', 'findstr', 'select', 'sls',
]);
const REDIRECT = /^[0-9*]?>{1,2}(&[0-9]|\/dev\/null|\$null|nul)?$/i;
const NULL_TARGET = /^(\/dev\/null|\$null|nul)$/i;

const SECRET_PATTERNS = [
  [/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/g, REDACTED],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bnpm_[A-Za-z0-9]{30,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  [/(:\/\/)[^\s/@:'"]+:[^\s/@'"]+@/g, `$1${REDACTED}@`],
  // curl -u user:password
  [/((?:^|\s)(?:-u|--user)\s+)(["']?)[^\s'":]*:[^\s'"]+\2/g, `$1$2${REDACTED}$2`],
  // Header and JSON values: "X-Api-Key: v", "Authorization: v", {"password": "v"}.
  [
    /(["']?\b(authorization|[\w-]*(api[-_]?key|token|secret|password|passwd))["']?\s*:\s*)(?!(Bearer|Basic)\s)("[^"]*"|'[^']*'|[^\s"',}]+)/gi,
    `$1${REDACTED}`,
  ],
  // NAME=value, $env:NAME = "value" and --name value / --name=value for secret-looking names.
  [
    /(\b[A-Za-z_]*(TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|API_?KEY|CREDENTIALS?|PRIVATE_KEY)[A-Za-z_]*\s*=\s*)("[^"]*"|'[^']*'|[^\s;&|]+)/gi,
    `$1${REDACTED}`,
  ],
  [
    /(--?(token|password|passwd|secret|api-?key|auth-token|access-token|client-secret)(=|\s+))("[^"]*"|'[^']*'|[^\s;&|]+)/gi,
    `$1${REDACTED}`,
  ],
  // A long run of letters and digits (no slash, so not a path) is taken for a key.
  [/\b[A-Za-z0-9_-]{40,}={0,2}/g, (match) => (/[0-9]/.test(match) && /[A-Za-z]/.test(match) ? REDACTED : match)],
];

export function redact(text) {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

function parseArgs(argv) {
  const options = {
    dir: join(homedir(), '.claude', 'projects'),
    project: null,
    days: 0,
    minSessions: 3,
    write: false,
    file: join(process.cwd(), 'CLAUDE.local.md'),
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--write') options.write = true;
    else if (arg === '--file') options.file = argv[++i] ?? options.file;
    else if (arg === '--dir') options.dir = argv[++i] ?? options.dir;
    else if (arg === '--project') options.project = argv[++i] ?? '';
    else if (arg === '--days') options.days = Number(argv[++i]) || 0;
    else if (arg === '--min-sessions') options.minSessions = Math.max(1, Number(argv[++i]) || options.minSessions);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

/**
 * Transcripts under the project folders that match, as { path, session }. The default project is
 * the current directory, in the folder name Claude Code gives it (each character but a letter or
 * digit becomes "-"); --project matches part of a folder name instead.
 */
function transcripts(dir, project) {
  if (!existsSync(dir)) return [];
  const wanted = project === null ? process.cwd().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() : project.toLowerCase();
  const found = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.jsonl')) found.push(path);
    }
  };
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name.toLowerCase();
    if (!entry.isDirectory() || (project === null ? name !== wanted : !name.includes(wanted))) continue;
    walk(join(dir, entry.name));
  }
  // A session is <id>.jsonl, and its subagents live under <id>/subagents/.
  return found.map((path) => {
    const [folder, first] = relative(dir, path).split(sep);
    return { path, session: `${folder}/${first.replace(/\.jsonl$/, '')}` };
  });
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
}

/** Tool calls of one transcript in order, each with whether it failed. Calls seen before are skipped. */
async function loadCalls(path, seen) {
  const calls = [];
  const byId = new Map();
  const reader = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of reader) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === 'tool_use') {
        if (seen.has(part.id)) continue;
        seen.add(part.id);
        const call = {
          name: part.name,
          command: typeof part.input?.command === 'string' ? part.input.command : '',
          file: typeof part.input?.file_path === 'string' ? part.input.file_path : '',
          cwd: typeof entry.cwd === 'string' ? entry.cwd : '',
          time: Date.parse(entry.timestamp ?? '') || 0,
          result: null,
        };
        calls.push(call);
        byId.set(part.id, call);
      } else if (part?.type === 'tool_result' && byId.has(part.tool_use_id)) {
        const text = resultText(part.content).slice(0, 400);
        const call = byId.get(part.tool_use_id);
        if (part.is_error !== true) call.result = 'ok';
        else if (NOT_A_FAILURE.some((pattern) => pattern.test(text.trimStart()))) call.result = 'denied';
        else call.result = call.name === 'Read' && !MISSING_FILE.test(text) ? 'denied' : 'failed';
      }
    }
  }
  return calls;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Forms of the session directory a command may spell: F:\a\b, F:/a/b and /f/a/b. */
function directoryForms(cwd) {
  const slashed = cwd.replaceAll('\\', '/').replace(/\/+$/, '');
  if (!slashed) return [];
  const forms = new Set([slashed, cwd.replace(/[\\/]+$/, '')]);
  const drive = /^([a-z]):\//i.exec(slashed);
  if (drive) forms.add(`/${drive[1].toLowerCase()}${slashed.slice(2)}`);
  return [...forms].sort((a, b) => b.length - a.length);
}

/** Paths under the session directory become relative, so a rule reads the same in every checkout. */
function relativize(text, cwd) {
  let out = text;
  for (const form of directoryForms(cwd)) {
    out = out.replace(new RegExp(`${escapeRegExp(form)}[\\\\/]`, 'gi'), '');
    out = out.replace(new RegExp(`${escapeRegExp(form)}(?=$|[\\s'";&|)])`, 'gi'), '.');
  }
  return out;
}

/**
 * A command as segments of words, split at unquoted &&, ||, ; and |, with output filters at the end
 * of a pipeline and redirects to null left out. Null for what is not one plain line.
 */
function segments(command) {
  if (!command || /[\n\r`]/.test(command) || command.length > 400) return null;
  const parts = [];
  let words = [];
  let word = '';
  let quote = '';
  const endWord = () => {
    if (word) words.push(word);
    word = '';
  };
  const endSegment = (operator) => {
    endWord();
    parts.push({ words, operator });
    words = [];
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    const pair = command.slice(i, i + 2);
    if (quote) {
      word += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      word += ch;
    } else if (ch === ' ' || ch === '\t') {
      endWord();
    } else if (pair === '&&' || pair === '||') {
      endSegment(pair);
      i += 1;
    } else if (ch === ';' || (ch === '|' && command[i - 1] !== '>')) {
      endSegment(ch);
    } else {
      word += ch;
    }
  }
  if (quote) return null;
  endSegment('');
  for (const part of parts) {
    part.words = part.words.filter(
      (item, i, all) => !REDIRECT.test(item) && !(/^[0-9*]?>{1,2}$/.test(all[i - 1] ?? '') && NULL_TARGET.test(item)),
    );
  }
  while (parts.length > 1 && parts.at(-2).operator === '|' && FILTERS.has((parts.at(-1).words[0] ?? '').toLowerCase())) {
    parts.pop();
    parts.at(-1).operator = '';
  }
  const kept = parts.filter((part) => part.words.length);
  return kept.length ? kept : null;
}

/** Length of the longest substring the two strings share. */
function sharedText(a, b) {
  let best = 0;
  const row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : 0;
      best = Math.max(best, row[j]);
      diagonal = above;
    }
  }
  return best;
}

/**
 * Whether two changed spans are about the same thing: some word of one shares at least three
 * characters (or all of a shorter word) with a word of the other. Options such as -n are left out
 * of the match unless a side has nothing else.
 */
function related(from, to) {
  const plain = (words) => {
    const kept = words.filter((word) => !word.startsWith('-')).map((word) => word.replace(/^["']|["']$/g, ''));
    return kept.length ? kept : words;
  };
  const a = plain(from);
  const b = plain(to);
  return a.some((x) => b.some((y) => sharedText(x, y) >= Math.max(1, Math.min(3, x.length, y.length))));
}

/**
 * The part of the command that changed, as { failed, worked } text, when the two commands differ
 * in exactly one segment and the changed words share some text. The words before the change stay
 * as context; of the words after it, only one is kept when nothing else is left on a side
 * (`pytest -k a` then `python -m pytest -k a` gives `pytest` and `python -m pytest`).
 */
function commandChange(failedCommand, workedCommand) {
  const a = segments(failedCommand);
  const b = segments(workedCommand);
  if (!a || !b || a.length !== b.length) return null;
  let changed = -1;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].operator !== b[i].operator) return null;
    if (a[i].words.join(' ') === b[i].words.join(' ')) continue;
    if (changed !== -1) return null;
    changed = i;
  }
  if (changed === -1) return null;
  const x = a[changed].words;
  const y = b[changed].words;
  let prefix = 0;
  while (prefix < x.length && prefix < y.length && x[prefix] === y[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < x.length - prefix && suffix < y.length - prefix && x.at(-1 - suffix) === y.at(-1 - suffix)) suffix += 1;
  // Keep at least one word on each side of the change.
  while (prefix + suffix >= Math.min(x.length, y.length)) {
    if (suffix > 0) suffix -= 1;
    else prefix -= 1;
  }
  // A change of more than a few words is a different command, not a variant of the same one.
  if (x.length - suffix - prefix > MAX_CHANGED_WORDS || y.length - suffix - prefix > MAX_CHANGED_WORDS) return null;
  if (!related(x.slice(prefix, x.length - suffix), y.slice(prefix, y.length - suffix))) return null;
  return {
    failed: x.slice(0, x.length - suffix).join(' '),
    worked: y.slice(0, y.length - suffix).join(' '),
  };
}

const baseName = (path) => path.replaceAll('\\', '/').split('/').pop().toLowerCase();
const shownPath = (path, cwd) => relativize(path.replaceAll('\\', '/'), cwd.replaceAll('\\', '/'));

/** The failed-then-working pairs of one transcript, and every command segment and path that worked. */
function findPairs(calls, since) {
  const pairs = [];
  const worked = new Set();
  for (const call of calls) {
    if (call.result !== 'ok' || (since && call.time && call.time < since)) continue;
    if (SHELL_TOOLS.has(call.name)) {
      for (const part of segments(relativize(redact(call.command), call.cwd)) ?? []) worked.add(`command:${part.words.join(' ')}`);
    } else if (call.name === 'Read' && call.file) worked.add(`path:${shownPath(call.file, call.cwd).toLowerCase()}`);
  }
  for (let i = 0; i < calls.length; i += 1) {
    const failed = calls[i];
    if (failed.result !== 'failed' || (since && failed.time && failed.time < since)) continue;
    const shell = SHELL_TOOLS.has(failed.name);
    if (!shell && failed.name !== 'Read') continue;
    let tries = 0;
    for (let j = i + 1; j < calls.length && tries < LOOK_AHEAD; j += 1) {
      const next = calls[j];
      if (EDIT_TOOLS.has(next.name)) break;
      if (next.name !== failed.name) continue;
      tries += 1;
      if (shell) {
        const from = relativize(redact(failed.command), failed.cwd);
        const to = relativize(redact(next.command), next.cwd);
        if (from.trim() === to.trim()) break;
        const change = next.result === 'ok' ? commandChange(from, to) : null;
        if (change) pairs.push({ kind: 'command', ...change, example: { failed: from, worked: to } });
        if (next.result === 'ok') break;
      } else {
        const from = shownPath(failed.file, failed.cwd);
        const to = shownPath(next.file, next.cwd);
        if (from.toLowerCase() === to.toLowerCase()) break;
        if (next.result === 'ok' && baseName(from) === baseName(to)) {
          pairs.push({ kind: 'path', failed: from, worked: to, example: { failed: from, worked: to } });
        }
        if (next.result === 'ok') break;
      }
    }
  }
  return { pairs, worked };
}

function ruleText(pair) {
  return pair.kind === 'path'
    ? `the path is \`${pair.worked}\`, not \`${pair.failed}\``
    : `use \`${pair.worked}\`, not \`${pair.failed}\``;
}

const writable = (pair) =>
  pair.workedAsWritten === 0 &&
  ![pair.failed, pair.worked].some((text) => text.includes(REDACTED) || text.includes('`') || text.length > MAX_RULE_LENGTH);

const startsWith = (words, key) => words === key || words.startsWith(`${key} `);

/**
 * Sessions where the failing form worked as written: the same path, or a command whose words start
 * with the failed form and not with the working one (`pytest -q` worked, so `pytest` is not broken).
 */
function workedAsWritten(group, workedIn) {
  const sessions = new Set();
  for (const [key, where] of workedIn) {
    const words = key.slice(key.indexOf(':') + 1);
    const contradicts =
      group.kind === 'path'
        ? key.startsWith('path:') && words === group.failed.toLowerCase()
        : key.startsWith('command:') && startsWith(words, group.failed) && !startsWith(words, group.worked);
    if (contradicts) for (const session of where) sessions.add(session);
  }
  return sessions;
}

/** The file's text with the managed block set to these rules: replaced in place, or added at the end. */
function withBlock(text, rules) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const block = [START, '## Learned from past sessions', '', 'In this project:', ...rules.map((rule) => `- ${rule}`), END].join(eol);
  const start = text.indexOf(START);
  const end = start === -1 ? -1 : text.indexOf(END, start);
  if (start !== -1 && end !== -1) return text.slice(0, start) + block + text.slice(end + END.length);
  if (!text) return block + eol;
  const separator = text.endsWith(eol + eol) ? '' : text.endsWith(eol) ? eol : eol + eol;
  return text + separator + block + eol;
}

function render(result, options) {
  const window = options.days ? `last ${options.days} days` : 'all time';
  const out = [
    `token-efficient-work learn: ${result.transcripts} transcript${result.transcripts === 1 ? '' : 's'} in ` +
      `${result.sessions} session${result.sessions === 1 ? '' : 's'}, ${window}, pairs seen in ` +
      `${options.minSessions}+ session${options.minSessions === 1 ? '' : 's'}`,
    '',
  ];
  if (!result.pairs.length) {
    out.push(`No failed-then-working pair was seen in ${options.minSessions} or more sessions.`);
    if (options.minSessions > 1) out.push('Try --min-sessions with a lower number, or --project to pick other projects.');
    return out.join('\n');
  }
  out.push('sessions   times   failed -> worked');
  for (const pair of result.pairs) {
    const note = pair.workedAsWritten
      ? `   (also worked as written in ${pair.workedAsWritten} session${pair.workedAsWritten === 1 ? '' : 's'}; not written)`
      : '';
    const kind = pair.kind === 'path' ? '   (file path)' : '';
    out.push(`${String(pair.sessions).padStart(8)}   ${String(pair.times).padStart(5)}   ${pair.failed}  ->  ${pair.worked}${kind}${note}`);
  }
  return out.join('\n');
}

const HELP = `Usage: node scripts/learn.mjs [--min-sessions N] [--days N] [--project TEXT] [--write] [--file PATH] [--dir PATH] [--json]

  --min-sessions N  list a pair seen in at least N sessions (default: 3)
  --days N          only calls from the last N days (default: all)
  --project TEXT    projects whose transcript folder name contains TEXT (default: the current
                    directory's project)
  --write           keep the rules in a marked block of CLAUDE.local.md in the current directory,
                    replaced in place on every run
  --file PATH       the file --write writes (default: ./CLAUDE.local.md)
  --dir PATH        transcript directory (default: ~/.claude/projects)
  --json            print the pairs as JSON`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  const files = transcripts(options.dir, options.project);
  const since = options.days ? Date.now() - options.days * 24 * 3600 * 1000 : 0;
  const seen = new Set();
  const grouped = new Map();
  const workedIn = new Map();
  for (const { path, session } of files) {
    const { pairs, worked } = findPairs(await loadCalls(path, seen), since);
    for (const key of worked) {
      if (!workedIn.has(key)) workedIn.set(key, new Set());
      workedIn.get(key).add(session);
    }
    for (const pair of pairs) {
      const key = `${pair.kind}\0${pair.failed}\0${pair.worked}`;
      if (!grouped.has(key)) grouped.set(key, { ...pair, sessionSet: new Set(), times: 0 });
      const group = grouped.get(key);
      group.sessionSet.add(session);
      group.times += 1;
    }
  }
  const pairs = [...grouped.values()]
    .filter((group) => group.sessionSet.size >= options.minSessions)
    .map((group) => ({
      kind: group.kind,
      failed: group.failed,
      worked: group.worked,
      sessions: group.sessionSet.size,
      times: group.times,
      workedAsWritten: workedAsWritten(group, workedIn).size,
      example: group.example,
      written: false,
    }))
    .sort((a, b) => b.sessions - a.sessions || b.times - a.times || a.failed.localeCompare(b.failed) || a.worked.localeCompare(b.worked));
  const rules = [];
  for (const pair of pairs) {
    if (rules.length < MAX_RULES && writable(pair)) {
      pair.written = true;
      rules.push(ruleText(pair));
    }
  }
  const result = {
    transcripts: files.length,
    sessions: new Set(files.map((file) => file.session)).size,
    minSessions: options.minSessions,
    days: options.days,
    pairs,
  };
  console.log(options.json ? JSON.stringify(result, null, 2) : render(result, options));
  if (!options.write) return;
  if (!rules.length) {
    if (!options.json) console.log(`\nNothing to write; ${options.file} is left as it is.`);
    return;
  }
  const before = existsSync(options.file) ? readFileSync(options.file, 'utf8') : '';
  const after = withBlock(before, rules);
  if (after === before) {
    if (!options.json) console.log(`\n${options.file}: unchanged.`);
    return;
  }
  writeFileSync(options.file, after);
  if (!options.json) console.log(`\n${options.file}: ${rules.length} rule${rules.length === 1 ? '' : 's'} written.`);
}

// Run as a script; imported (by the tests), it only exports redact().
const samePath = (a, b) => {
  try {
    return realpathSync.native(a).toLowerCase() === realpathSync.native(b).toLowerCase();
  } catch {
    return false;
  }
};
if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
