#!/usr/bin/env node
// Measure, from Claude Code's own transcripts, how much of your reading the skill's rules target.
//
//   node scripts/read-report.mjs                 every project, all time
//   node scripts/read-report.mjs --days 7        tool calls from the last 7 days
//   node scripts/read-report.mjs --project api   projects whose folder name contains "api"
//   node scripts/read-report.mjs --json          machine-readable
//
// It counts three things, each one a rule of the skill:
//   whole-file reads over the limit   a Read with no offset/limit that returned more than
//                                     --max-lines lines (rule 1); the source-code part of them
//                                     is what hooks/claude-code/guard-full-read.mjs refuses
//   confirmation reads                a Read of a file as the very next tool call after a
//                                     successful Edit or Write of that file (rule 2)
//   repeat reads                      a whole-file Read of a file already read whole in the same
//                                     transcript, with no edit to it in between (rule 4)
//
// A file read through the Bash or PowerShell tool counts too, under the same rules, and is shown
// on its own rows. Only one reader on one file is understood: `cat`, `less`, `more` (whole file),
// `head`, `tail` with -n N or -N, and `sed -n 'A,Bp'` (a range) in Bash; `Get-Content`, `gc`,
// `cat`, `type` in PowerShell, ranged with -TotalCount, -Head, -First, -Tail or -Last. Anything
// else is skipped, not guessed: a pipeline, `cd x && cat y`, a redirect, a glob, two files, a
// variable, an option not listed here. Relative paths resolve against the session's directory.
// Shell writes (`sed -i`, `>`) are not seen as edits.
//
// Sizes are the characters the tool returned; tokens are an estimate at 4 characters each. The
// report shows where the cost sits. It cannot know what a ranged read would have cost instead.

import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, posix, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';

const CHARS_PER_TOKEN = 4;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Kept identical to the list in hooks/claude-code/guard-full-read.mjs, which stays a single file
// so it can be copied on its own; tests/read-report.test.mjs fails when the two differ.
const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.dart', '.ex', '.go', '.h', '.hpp', '.java', '.js', '.jsx', '.kt',
  '.lua', '.m', '.mjs', '.php', '.py', '.rb', '.rs', '.scala', '.sh', '.sql', '.svelte', '.swift',
  '.ts', '.tsx', '.vue',
]);

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
// Characters, outside quotes, that make a command more than one plain reader on one file: both
// shells' operators, variables, globs and comments, bash's backslash escape, and PowerShell's
// array comma and splat.
const SHELL_SPECIAL = { Bash: '|&;<>()$`{}#*?[~\\\n\r', PowerShell: '|&;<>()$`{}#*?[~,@\n\r' };
const COUNT = /^\d+$/;
const SED_RANGE = /^(\d+|\$)(,(\d+|\$|\+\d+))?p$/;

/** The words of a command with quotes removed, or null if it holds anything but plain words. */
function shellWords(command, tool) {
  const words = [];
  let word = null;
  let quote = '';
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = '';
      else if (quote === '"' && (ch === '$' || ch === '`' || (ch === '\\' && tool === 'Bash'))) return null;
      else word += ch;
    } else if (ch === ' ' || ch === '\t') {
      if (word !== null) words.push(word);
      word = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      word ??= '';
    } else if (SHELL_SPECIAL[tool].includes(ch)) {
      return null;
    } else {
      word = (word ?? '') + ch;
    }
  }
  if (quote) return null;
  if (word !== null) words.push(word);
  return words;
}

const isOption = (word) => word.startsWith('-');
const oneFile = (words) => (words.length === 1 && !isOption(words[0]) ? { file: words[0], ranged: false } : null);

/** head and tail: -n N, -nN, -N or --lines=N (tail also +N), then one file. No count is 10 lines. */
function headTail(words, tail) {
  let file = null;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    let count;
    if (word === '-n' || word === '--lines') count = words[++i];
    else if (word.startsWith('--lines=')) count = word.slice('--lines='.length);
    else if (/^-n./.test(word)) count = word.slice(2);
    else if (/^-\d+$/.test(word)) count = word.slice(1);
    else if (isOption(word) || file !== null) return null;
    else {
      file = word;
      continue;
    }
    count = String(count ?? '');
    if (!COUNT.test(tail ? count.replace(/^\+/, '') : count)) return null;
  }
  return file === null ? null : { file, ranged: true };
}

/** Get-Content and its aliases: one path, -Raw, -Encoding X, and a line count for a range. */
function getContent(words) {
  let file = null;
  let ranged = false;
  for (let i = 0; i < words.length; i += 1) {
    const option = words[i].toLowerCase();
    if (option === '-path' || option === '-literalpath') {
      if (file !== null || words[i + 1] == null || isOption(words[i + 1])) return null;
      file = words[++i];
    } else if (option === '-encoding') {
      if (!/^[\w-]+$/.test(words[++i] ?? '')) return null;
    } else if (['-totalcount', '-head', '-first', '-tail', '-last'].includes(option)) {
      if (!COUNT.test(words[++i] ?? '')) return null;
      ranged = true;
    } else if (option !== '-raw') {
      if (isOption(option) || file !== null) return null;
      file = words[i];
    }
  }
  return file === null ? null : { file, ranged };
}

const BASH_READERS = {
  cat: (words) => oneFile(words.filter((word) => word !== '-n')),
  less: oneFile,
  more: oneFile,
  head: (words) => headTail(words, false),
  tail: (words) => headTail(words, true),
  sed: (words) =>
    words.length === 3 && words[0] === '-n' && SED_RANGE.test(words[1]) && !isOption(words[2])
      ? { file: words[2], ranged: true }
      : null,
};
// PowerShell names are case-insensitive; `type` here is Get-Content, not the bash builtin.
const POWERSHELL_READERS = { 'get-content': getContent, gc: getContent, cat: getContent, type: getContent };

/**
 * The file a Bash or PowerShell command reads, as { file, ranged }, or null when the command is
 * not one known reader on one file. A relative path resolves against the session's directory.
 */
function shellRead(tool, command, cwd) {
  if (typeof command !== 'string') return null;
  const words = shellWords(command.trim(), tool);
  if (!words || words.length < 2) return null;
  const readers = tool === 'Bash' ? BASH_READERS : POWERSHELL_READERS;
  const name = tool === 'Bash' ? words[0] : words[0].toLowerCase();
  const read = Object.hasOwn(readers, name) ? readers[name](words.slice(1)) : null;
  // A glob, a home path or a PowerShell drive such as env: is not a plain file.
  if (!read || /[*?[\]]/.test(read.file) || read.file.startsWith('~') || /^[a-z]{2,}:/i.test(read.file)) {
    return null;
  }
  const path = read.file.replaceAll('\\', '/');
  if (/^([a-z]:)?\//i.test(path)) return { file: posix.normalize(path), ranged: read.ranged };
  if (!cwd) return null;
  return { file: posix.normalize(`${String(cwd).replaceAll('\\', '/')}/${path}`), ranged: read.ranged };
}

function parseArgs(argv) {
  const envLimit = Number.parseInt(process.env.TEW_READ_GUARD_MAX_LINES ?? '', 10);
  const options = {
    dir: join(homedir(), '.claude', 'projects'),
    project: '',
    days: 0,
    maxLines: Number.isFinite(envLimit) && envLimit > 0 ? envLimit : 400,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dir') options.dir = argv[++i] ?? options.dir;
    else if (arg === '--project') options.project = argv[++i] ?? '';
    else if (arg === '--days') options.days = Number(argv[++i]) || 0;
    else if (arg === '--max-lines') options.maxLines = Number(argv[++i]) || options.maxLines;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function transcripts(dir, project) {
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.jsonl')) found.push(path);
    }
  };
  walk(dir);
  if (!project) return found;
  return found.filter((path) => relative(dir, path).split(sep)[0].includes(project));
}

const normalize = (path) => String(path ?? '').replaceAll('\\', '/').toLowerCase();

function resultSize(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
}

/** Tool calls of one transcript in order, each joined with the size of its result. */
async function loadCalls(path) {
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
        const shell = SHELL_TOOLS.has(part.name) ? shellRead(part.name, part.input?.command, entry.cwd) : null;
        const path = shell ? shell.file : part.input?.file_path;
        const call = {
          name: part.name,
          file: normalize(path),
          shown: String(path ?? ''),
          ranged: shell ? shell.ranged : part.input?.offset != null || part.input?.limit != null,
          shell: shell !== null,
          time: Date.parse(entry.timestamp ?? '') || 0,
          chars: 0,
          lines: 0,
          failed: false,
        };
        calls.push(call);
        byId.set(part.id, call);
      } else if (part?.type === 'tool_result' && byId.has(part.tool_use_id)) {
        const call = byId.get(part.tool_use_id);
        const text = resultSize(part.content);
        call.chars = text.length;
        call.lines = text ? text.split('\n').length : 0;
        call.failed = part.is_error === true;
      }
    }
  }
  return calls;
}

function analyse(calls, { since, maxLines }, totals) {
  const readWhole = new Set();
  let previous = null;
  for (const call of calls) {
    const counted = call.time === 0 || call.time >= since;
    // A rule counts reads of both kinds and keeps the shell's part apart as well.
    const add = (bucket) => {
      bucket.count += 1;
      bucket.chars += call.chars;
      if (call.shell) {
        bucket.shell.count += 1;
        bucket.shell.chars += call.chars;
      }
    };
    if ((call.name === 'Read' || call.shell) && call.file) {
      if (counted) {
        const reads = call.shell ? totals.shellReads : totals.reads;
        reads.total += 1;
        if (call.ranged) reads.ranged += 1;
        else {
          reads.whole += 1;
          reads.wholeChars += call.chars;
          if (call.lines > maxLines) {
            add(totals.wholeOverLimit);
            // The read guard sees only the Read tool.
            if (!call.shell && SOURCE_EXTENSIONS.has(extname(call.file))) {
              totals.sourceOverLimit.count += 1;
              totals.sourceOverLimit.chars += call.chars;
            }
            const item = { file: call.shown, lines: call.lines, chars: call.chars };
            totals.largest.push(call.shell ? { ...item, shell: true } : item);
          }
        }
        if (previous && EDIT_TOOLS.has(previous.name) && !previous.failed && previous.file === call.file) {
          add(totals.confirmationReads);
        } else if (!call.ranged && readWhole.has(call.file)) {
          add(totals.repeatReads);
        }
      }
      if (!call.ranged && !call.failed) readWhole.add(call.file);
    } else if (EDIT_TOOLS.has(call.name) && call.file && !call.failed) {
      readWhole.delete(call.file);
    }
    previous = call;
  }
}

const tokens = (chars) => {
  const value = Math.round(chars / CHARS_PER_TOKEN);
  return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);
};

function render(totals, options) {
  const { reads, shellReads } = totals;
  const share = (part) => (part.total ? Math.round((part.whole / part.total) * 100) : 0);
  const window = options.days ? `last ${options.days} days` : 'all time';
  const row = (label, bucket, rule) =>
    `${label.padEnd(46)} ${String(bucket.count).padStart(6)}   about ${tokens(bucket.chars)} tokens${rule}`;
  const tally = (label, part, of) => [
    `${label.padEnd(46)} ${String(part.total).padStart(6)}`,
    `${'  with a range'.padEnd(46)} ${String(part.ranged).padStart(6)}`,
    `${'  whole-file'.padEnd(46)} ${String(part.whole).padStart(6)}   ` +
      `${share(part)}% of ${of}, about ${tokens(part.wholeChars)} tokens`,
  ];
  const out = [
    `token-efficient-work read report: ${totals.transcripts} transcript${totals.transcripts === 1 ? '' : 's'}, ${window}`,
    '',
    ...tally('Read calls', reads, 'reads'),
    ...tally('Reads through the shell (cat, head, sed -n...)', shellReads, 'them'),
    '',
    row(`Whole-file reads over ${options.maxLines} lines`, totals.wholeOverLimit, '   (rule 1)'),
    row('  of which source code (the guard refuses)', totals.sourceOverLimit, ''),
    row('  of which through the shell', totals.wholeOverLimit.shell, ''),
    row('Reads right after a successful edit', totals.confirmationReads, '   (rule 2)'),
    row('  of which through the shell', totals.confirmationReads.shell, ''),
    row('Repeat whole-file reads of an unchanged file', totals.repeatReads, '   (rule 4)'),
    row('  of which through the shell', totals.repeatReads.shell, ''),
  ];
  if (totals.largest.length) {
    out.push('', 'Largest whole-file reads:');
    for (const item of totals.largest) {
      const via = item.shell ? '   (shell)' : '';
      const size = `${String(item.lines).padStart(6)} lines   about ${tokens(item.chars).padStart(6)} tokens`;
      out.push(`  ${size}   ${item.file}${via}`);
    }
  }
  return out.join('\n');
}

const HELP = `Usage: node scripts/read-report.mjs [--days N] [--project TEXT] [--max-lines N] [--dir PATH] [--json]

  --days N        only tool calls from the last N days (default: all)
  --project TEXT  only projects whose transcript folder name contains TEXT
  --max-lines N   a whole-file read above N lines counts as over the limit (default: 400,
                  or TEW_READ_GUARD_MAX_LINES)
  --dir PATH      transcript directory (default: ~/.claude/projects)
  --json          print the numbers as JSON`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  const files = transcripts(options.dir, options.project);
  const since = options.days ? Date.now() - options.days * 24 * 3600 * 1000 : 0;
  const totals = {
    transcripts: files.length,
    maxLines: options.maxLines,
    days: options.days,
    reads: { total: 0, ranged: 0, whole: 0, wholeChars: 0 },
    shellReads: { total: 0, ranged: 0, whole: 0, wholeChars: 0 },
    wholeOverLimit: { count: 0, chars: 0, shell: { count: 0, chars: 0 } },
    sourceOverLimit: { count: 0, chars: 0 },
    confirmationReads: { count: 0, chars: 0, shell: { count: 0, chars: 0 } },
    repeatReads: { count: 0, chars: 0, shell: { count: 0, chars: 0 } },
    largest: [],
  };
  for (const file of files) analyse(await loadCalls(file), { since, maxLines: options.maxLines }, totals);
  totals.largest = totals.largest.sort((a, b) => b.chars - a.chars).slice(0, 10);
  console.log(options.json ? JSON.stringify(totals, null, 2) : render(totals, options));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
