#!/usr/bin/env node
// Claude Code hook for Bash and PowerShell: notice when the same command keeps failing.
//
// An agent that retries a failing command unchanged pays for the same error output each time.
// Registered on PostToolUseFailure, this hook counts failures of the same command in a session.
// When the count reaches TEW_FAIL_LOOP_LIMIT (default 3), and again at every further multiple of
// it, it adds one line of context next to the error: stop retrying, change something. Registered
// on PostToolUse too, it clears the count when a command succeeds. A different failing command
// starts the count again. No model call; only a hash of the last failing command and its count
// are kept, in one small file per session.
//
// It is a cost guard, not a security guard: anything it cannot judge (bad input, no session id,
// a state file it cannot write) is ignored. It never refuses a call and always exits 0.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_LIMIT = 3;
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

function limit() {
  const value = Number.parseInt(process.env.TEW_FAIL_LOOP_LIMIT ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_LIMIT;
}

function stateFile(sessionId) {
  const dir = process.env.TEW_FAIL_LOOP_STATE_DIR || join(tmpdir(), 'tew-fail-loop');
  return { dir, path: join(dir, `${sessionId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128)}.json`) };
}

function readState(path) {
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    return typeof state?.h === 'string' && Number.isInteger(state?.n) ? state : null;
  } catch {
    return null;
  }
}

function decide(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!SHELL_TOOLS.has(payload?.tool_name)) return null;
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const command = typeof payload.tool_input?.command === 'string' ? payload.tool_input.command : '';
  const normalized = command.trim().replace(/\s+/g, ' ');
  if (!sessionId || !normalized) return null;
  const { dir, path } = stateFile(sessionId);

  if (payload.hook_event_name === 'PostToolUse') {
    rmSync(path, { force: true });
    return null;
  }
  if (payload.hook_event_name !== 'PostToolUseFailure' || payload.is_interrupt === true) return null;

  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  const previous = readState(path);
  const count = previous?.h === hash ? previous.n + 1 : 1;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ h: hash, n: count }));
  const max = limit();
  if (count % max !== 0) return null;
  return (
    `token-efficient-work: this same command has failed ${count} times in a row. Stop retrying ` +
    'it unchanged: read the error, check the command (path, flags, quoting, working directory), ' +
    'try a different approach, or ask the user.'
  );
}

let context = null;
try {
  context = decide(readFileSync(0, 'utf8'));
} catch {
  context = null;
}
if (context) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUseFailure', additionalContext: context } }) + '\n',
  );
}
