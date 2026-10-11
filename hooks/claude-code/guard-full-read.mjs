#!/usr/bin/env node
// Claude Code PreToolUse hook for the Read tool: refuse a whole-file read of a long source file.
//
// Rule 1 of the skill ("locate before you read") is advice, and advice gets skipped. This hook is
// the same rule as a gate: a Read with no offset and no limit on a source file longer than
// TEW_READ_GUARD_MAX_LINES (default 400) is refused, and the refusal says how to read the part
// that is needed. Naming a range is the way out, so an agent that really needs the whole file can
// still ask for it on purpose.
//
// It is a cost guard, not a security guard: anything it cannot judge (bad input, a missing file,
// a file type it does not know) is allowed. Exit 2 = refuse, and stderr goes to the model.
// Measure what it would catch on your own sessions first: scripts/read-report.mjs.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const DEFAULT_MAX_LINES = 400;
// Source code only. Markdown, JSON, YAML and logs are often read whole for good reason.
const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.dart', '.ex', '.go', '.h', '.hpp', '.java', '.js', '.jsx', '.kt',
  '.lua', '.m', '.mjs', '.php', '.py', '.rb', '.rs', '.scala', '.sh', '.sql', '.svelte', '.swift',
  '.ts', '.tsx', '.vue',
]);

function maxLines() {
  const value = Number.parseInt(process.env.TEW_READ_GUARD_MAX_LINES ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_LINES;
}

function countLines(path) {
  const bytes = readFileSync(path);
  let lines = 0;
  for (const byte of bytes) if (byte === 10) lines += 1;
  return bytes.length > 0 && bytes[bytes.length - 1] !== 10 ? lines + 1 : lines;
}

function decide(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (payload?.tool_name !== 'Read') return null;
  const input = payload.tool_input ?? {};
  const path = typeof input.file_path === 'string' ? input.file_path : '';
  if (!path || input.offset != null || input.limit != null) return null;
  if (!SOURCE_EXTENSIONS.has(extname(path).toLowerCase())) return null;
  let lines;
  try {
    lines = countLines(path);
  } catch {
    return null;
  }
  const limit = maxLines();
  if (lines <= limit) return null;
  return (
    `BLOCKED (token-efficient-work): ${path} is ${lines} lines, over the ${limit}-line limit for ` +
    'reading a source file whole.\n' +
    'Find the part you need first (Grep for the symbol or text), then call Read with offset and ' +
    'limit around it.\n' +
    'If the whole file really is needed, call Read again with an explicit limit.'
  );
}

const reason = decide(readFileSync(0, 'utf8'));
if (reason) {
  process.stderr.write(reason + '\n');
  process.exit(2);
}
