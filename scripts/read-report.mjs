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
// Sizes are the characters the tool returned; tokens are an estimate at 4 characters each. The
// report shows where the cost sits. It cannot know what a ranged read would have cost instead.

import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, relative, sep } from 'node:path';
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
        const call = {
          name: part.name,
          file: normalize(part.input?.file_path),
          shown: String(part.input?.file_path ?? ''),
          ranged: part.input?.offset != null || part.input?.limit != null,
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
    if (call.name === 'Read' && call.file) {
      if (counted) {
        totals.reads.total += 1;
        if (call.ranged) totals.reads.ranged += 1;
        else {
          totals.reads.whole += 1;
          totals.reads.wholeChars += call.chars;
          if (call.lines > maxLines) {
            totals.wholeOverLimit.count += 1;
            totals.wholeOverLimit.chars += call.chars;
            if (SOURCE_EXTENSIONS.has(extname(call.file))) {
              totals.sourceOverLimit.count += 1;
              totals.sourceOverLimit.chars += call.chars;
            }
            totals.largest.push({ file: call.shown, lines: call.lines, chars: call.chars });
          }
        }
        if (previous && EDIT_TOOLS.has(previous.name) && !previous.failed && previous.file === call.file) {
          totals.confirmationReads.count += 1;
          totals.confirmationReads.chars += call.chars;
        } else if (!call.ranged && readWhole.has(call.file)) {
          totals.repeatReads.count += 1;
          totals.repeatReads.chars += call.chars;
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
  const { reads } = totals;
  const share = reads.total ? Math.round((reads.whole / reads.total) * 100) : 0;
  const window = options.days ? `last ${options.days} days` : 'all time';
  const row = (label, bucket, rule) =>
    `${label.padEnd(46)} ${String(bucket.count).padStart(6)}   about ${tokens(bucket.chars)} tokens${rule}`;
  const out = [
    `token-efficient-work read report: ${totals.transcripts} transcripts, ${window}`,
    '',
    `${'Read calls'.padEnd(46)} ${String(reads.total).padStart(6)}`,
    `${'  with a range'.padEnd(46)} ${String(reads.ranged).padStart(6)}`,
    `${'  whole-file'.padEnd(46)} ${String(reads.whole).padStart(6)}   ${share}% of reads, about ${tokens(reads.wholeChars)} tokens`,
    '',
    row(`Whole-file reads over ${options.maxLines} lines`, totals.wholeOverLimit, '   (rule 1)'),
    row('  of which source code (the guard refuses)', totals.sourceOverLimit, ''),
    row('Reads right after a successful edit', totals.confirmationReads, '   (rule 2)'),
    row('Repeat whole-file reads of an unchanged file', totals.repeatReads, '   (rule 4)'),
  ];
  if (totals.largest.length) {
    out.push('', 'Largest whole-file reads:');
    for (const item of totals.largest) {
      out.push(`  ${String(item.lines).padStart(6)} lines   about ${tokens(item.chars).padStart(6)} tokens   ${item.file}`);
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
    wholeOverLimit: { count: 0, chars: 0 },
    sourceOverLimit: { count: 0, chars: 0 },
    confirmationReads: { count: 0, chars: 0 },
    repeatReads: { count: 0, chars: 0 },
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
