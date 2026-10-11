import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/read-report.mjs', import.meta.url));
let dir;
let id = 0;

const lines = (count) => Array.from({ length: count }, (_, i) => `${i + 1}\tcode`).join('\n');

/** One tool call and its result, as two transcript lines. */
function call(name, input, result, timestamp) {
  id += 1;
  const use = { type: 'tool_use', id: `toolu_${id}`, name, input };
  const res = { type: 'tool_result', tool_use_id: `toolu_${id}`, content: result };
  return [
    JSON.stringify({ type: 'assistant', timestamp, message: { role: 'assistant', content: [use] } }),
    JSON.stringify({ type: 'user', timestamp, message: { role: 'user', content: [res] } }),
  ];
}

function transcript(project, name, entries) {
  const folder = join(dir, project);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), entries.flat().join('\n') + '\n');
}

function report(...args) {
  const result = spawnSync(process.execPath, [script, '--dir', dir, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tew-report-'));
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
  transcript('proj-a', 'session.jsonl', [
    call('Read', { file_path: '/src/big.ts' }, lines(600), now),
    call('Read', { file_path: '/src/big.ts', offset: 100, limit: 40 }, lines(40), now),
    call('Edit', { file_path: '/src/app.ts', old_string: 'a', new_string: 'b' }, 'The file has been updated', now),
    call('Read', { file_path: '/src/app.ts' }, lines(50), now),
    call('Read', { file_path: '/src/util.ts' }, lines(20), now),
    call('Bash', { command: 'ls' }, 'a\nb', now),
    call('Read', { file_path: '/docs/notes.md' }, lines(700), now),
    call('Read', { file_path: '/src/util.ts' }, lines(20), now),
    'this line is not JSON',
  ]);
  transcript('proj-b', 'old.jsonl', [call('Read', { file_path: '/src/old.ts' }, lines(900), old)]);
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('counts whole-file reads, ranged reads and the three kinds of waste', () => {
  const data = JSON.parse(report('--json'));
  assert.equal(data.transcripts, 2);
  assert.equal(data.reads.total, 7);
  assert.equal(data.reads.ranged, 1);
  assert.equal(data.reads.whole, 6);
  assert.equal(data.wholeOverLimit.count, 3);
  assert.equal(data.wholeOverLimit.chars, lines(600).length + lines(700).length + lines(900).length);
  assert.equal(data.sourceOverLimit.count, 2);
  assert.equal(data.sourceOverLimit.chars, lines(600).length + lines(900).length);
  assert.equal(data.confirmationReads.count, 1);
  assert.equal(data.repeatReads.count, 1);
});

test('--days leaves out older tool calls and --project narrows to one project', () => {
  const recent = JSON.parse(report('--json', '--days', '7'));
  assert.equal(recent.reads.total, 6);
  assert.equal(recent.wholeOverLimit.count, 2);
  assert.equal(recent.sourceOverLimit.count, 1);
  const one = JSON.parse(report('--json', '--project', 'proj-b'));
  assert.equal(one.reads.total, 1);
});

test('--max-lines moves the line that separates a cheap whole-file read from a costly one', () => {
  const data = JSON.parse(report('--json', '--max-lines', '30'));
  assert.equal(data.wholeOverLimit.count, 4);
});

test('the report and the read guard agree on what source code is', () => {
  const extensions = (path) => {
    const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
    const start = source.indexOf('SOURCE_EXTENSIONS = new Set([');
    return source.slice(start, source.indexOf(']);', start)).replace(/\s/g, '');
  };
  assert.ok(extensions('../scripts/read-report.mjs').includes("'.ts'"));
  assert.equal(extensions('../scripts/read-report.mjs'), extensions('../hooks/claude-code/guard-full-read.mjs'));
});

test('the text report names the largest whole-file reads', () => {
  const text = report();
  assert.match(text, /whole-file/i);
  assert.match(text, /\/src\/old\.ts/);
});

test('an empty directory reports zero instead of failing', () => {
  const empty = mkdtempSync(join(tmpdir(), 'tew-empty-'));
  try {
    const result = spawnSync(process.execPath, [script, '--dir', empty, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).reads.total, 0);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
