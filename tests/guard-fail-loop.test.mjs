import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../hooks/claude-code-fail-loop/guard-fail-loop.mjs', import.meta.url));
let dir;

beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), 'tew-fail-loop-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

function run(payload, env = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync(process.execPath, [hook], {
    input,
    encoding: 'utf8',
    env: { ...process.env, TEW_FAIL_LOOP_STATE_DIR: dir, ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout) : null;
}

const failed = (command, extra = {}) => ({
  session_id: 'session-a',
  hook_event_name: 'PostToolUseFailure',
  tool_name: 'Bash',
  tool_input: { command },
  error: 'Exit code 1\nnpm ERR! missing script: tset',
  ...extra,
});
const succeeded = (command, extra = {}) => ({
  session_id: 'session-a',
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_input: { command },
  tool_response: { stdout: 'ok', stderr: '' },
  ...extra,
});

test('the third failure of the same command adds one line of context, the first two add none', () => {
  assert.equal(run(failed('npm run tset')), null);
  assert.equal(run(failed('npm run tset')), null);
  const out = run(failed('npm run tset'));
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
  const line = out.hookSpecificOutput.additionalContext;
  assert.match(line, /failed 3 times with no edit in between/);
  assert.match(line, /different approach/);
  assert.ok(!line.includes('\n'), 'one line');
});

test('the line comes back after every further run of the limit, not on every failure', () => {
  for (let i = 1; i <= 6; i += 1) {
    const out = run(failed('make build'));
    assert.equal(out !== null, i === 3 || i === 6, `failure ${i}`);
  }
});

test('whitespace differences count as the same command', () => {
  run(failed('npm  test'));
  run(failed(' npm test '));
  assert.notEqual(run(failed('npm\ttest')), null);
});

test('a different failing command starts the count again', () => {
  run(failed('npm test'));
  run(failed('npm test'));
  run(failed('npm test -- --verbose'));
  assert.equal(run(failed('npm test')), null);
  assert.equal(run(failed('npm test')), null);
  assert.notEqual(run(failed('npm test')), null);
});

test('a command that succeeds clears the count and prints nothing', () => {
  run(failed('npm test'));
  run(failed('npm test'));
  assert.equal(run(succeeded('npm test')), null);
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(run(failed('npm test')), null);
  assert.equal(run(failed('npm test')), null);
});

test('another command succeeding in between does not clear the count', () => {
  run(failed('npm test'));
  assert.equal(run(succeeded('cat npm-debug.log')), null);
  run(failed('npm test'));
  assert.equal(run(succeeded('ls')), null);
  assert.notEqual(run(failed('npm test')), null);
});

test('a file edit clears the count, so a fix-and-rerun is a new try', () => {
  run(failed('npm test'));
  run(failed('npm test'));
  for (const tool of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']) {
    assert.equal(run(succeeded('', { tool_name: tool, tool_input: { file_path: 'a.js' } })), null);
  }
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(run(failed('npm test')), null);
  assert.equal(run(failed('npm test')), null);
  assert.notEqual(run(failed('npm test')), null);
});

test('an edit with no count kept writes no state', () => {
  assert.equal(run(succeeded('', { tool_name: 'Edit', tool_input: { file_path: 'a.js' } })), null);
  assert.deepEqual(readdirSync(dir), []);
});

test('a success with no count kept writes no state', () => {
  assert.equal(run(succeeded('ls')), null);
  assert.ok(!existsSync(join(dir, 'session-a.json')));
});

test('each session keeps its own count', () => {
  run(failed('npm test'));
  run(failed('npm test'));
  assert.equal(run(failed('npm test', { session_id: 'session-b' })), null);
  assert.notEqual(run(failed('npm test')), null);
});

test('the limit comes from TEW_FAIL_LOOP_LIMIT', () => {
  const env = { TEW_FAIL_LOOP_LIMIT: '2' };
  assert.equal(run(failed('cargo build'), env), null);
  assert.match(run(failed('cargo build'), env).hookSpecificOutput.additionalContext, /2 times/);
  rmSync(join(dir, 'session-a.json'));
  const bad = { TEW_FAIL_LOOP_LIMIT: 'not-a-number' };
  assert.equal(run(failed('cargo build'), bad), null);
  assert.equal(run(failed('cargo build'), bad), null);
  assert.notEqual(run(failed('cargo build'), bad), null);
});

test('the PowerShell tool is counted the same way', () => {
  const ps = (command) => failed(command, { tool_name: 'PowerShell' });
  run(ps('Get-Item missing'));
  run(ps('Get-Item missing'));
  assert.notEqual(run(ps('Get-Item missing')), null);
});

test('an interrupt is not counted as a failure', () => {
  run(failed('npm test'));
  run(failed('npm test'));
  assert.equal(run(failed('npm test', { is_interrupt: true })), null);
  assert.notEqual(run(failed('npm test')), null);
});

test('the state file name comes from a cleaned session id', () => {
  run(failed('npm test', { session_id: '../../evil id' }));
  assert.deepEqual(readdirSync(dir), ['______evil_id.json']);
});

test('anything the hook cannot judge is left alone', () => {
  assert.equal(run('not json'), null);
  assert.equal(run(failed('npm test', { tool_name: 'Read' })), null);
  assert.equal(run(failed('npm test', { session_id: undefined })), null);
  assert.equal(run(failed('', {})), null);
  assert.equal(run({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', session_id: 's' }), null);
  assert.deepEqual(readdirSync(dir), []);
  writeFileSync(join(dir, 'a-file'), '');
  const unwritable = { TEW_FAIL_LOOP_STATE_DIR: join(dir, 'a-file', 'state') };
  for (let i = 0; i < 3; i += 1) assert.equal(run(failed('npm test'), unwritable), null);
});
