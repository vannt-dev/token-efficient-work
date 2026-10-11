import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../hooks/claude-code/guard-full-read.mjs', import.meta.url));
let dir;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tew-guard-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

function file(name, lines) {
  const path = join(dir, name);
  writeFileSync(path, Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  return path;
}

function run(payload, env = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return spawnSync(process.execPath, [hook], { input, encoding: 'utf8', env: { ...process.env, ...env } });
}

const read = (file_path, extra = {}) => ({ tool_name: 'Read', tool_input: { file_path, ...extra } });

test('a whole-file read of a long source file is refused with the way out', () => {
  const result = run(read(file('long.ts', 401)));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /401 lines/);
  assert.match(result.stderr, /offset/);
  assert.match(result.stderr, /limit/);
});

test('a source file at the limit is read whole', () => {
  assert.equal(run(read(file('edge.ts', 400))).status, 0);
});

test('a read that names a range is never refused', () => {
  const path = file('ranged.py', 2000);
  assert.equal(run(read(path, { limit: 2000 })).status, 0);
  assert.equal(run(read(path, { offset: 900 })).status, 0);
});

test('files that are not source code are left alone', () => {
  assert.equal(run(read(file('notes.md', 5000))).status, 0);
  assert.equal(run(read(file('data.json', 5000))).status, 0);
});

test('the limit comes from TEW_READ_GUARD_MAX_LINES', () => {
  const path = file('small.go', 11);
  assert.equal(run(read(path), { TEW_READ_GUARD_MAX_LINES: '10' }).status, 2);
  assert.equal(run(read(path), { TEW_READ_GUARD_MAX_LINES: '11' }).status, 0);
  assert.equal(run(read(path), { TEW_READ_GUARD_MAX_LINES: 'not-a-number' }).status, 0);
});

test('anything the hook cannot judge is allowed', () => {
  assert.equal(run('not json').status, 0);
  assert.equal(run({ tool_name: 'Bash', tool_input: { command: 'ls' } }).status, 0);
  assert.equal(run(read(join(dir, 'missing.ts'))).status, 0);
  assert.equal(run({ tool_name: 'Read' }).status, 0);
});
