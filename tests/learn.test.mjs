import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { redact } from '../scripts/learn.mjs';

const script = fileURLToPath(new URL('../scripts/learn.mjs', import.meta.url));
const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
let root;
let dir;
let project;
let id = 0;

// The folder name Claude Code gives a project: every character but a letter or digit becomes "-".
const folderOf = (path) => path.replace(/[^a-zA-Z0-9]/g, '-');

/** One tool call and its result, as two transcript lines. */
function call(name, input, result, { failed = false, timestamp = new Date().toISOString(), cwd = project } = {}) {
  id += 1;
  const use = { type: 'tool_use', id: `toolu_${id}`, name, input };
  const res = { type: 'tool_result', tool_use_id: `toolu_${id}`, content: result, is_error: failed };
  return [
    JSON.stringify({ type: 'assistant', cwd, timestamp, message: { role: 'assistant', content: [use] } }),
    JSON.stringify({ type: 'user', cwd, timestamp, message: { role: 'user', content: [res] } }),
  ];
}
const bash = (command, result = 'ok', options = {}) => call('Bash', { command }, result, options);
const fail = (command, result = 'Exit code 1\nerror', options = {}) => bash(command, result, { ...options, failed: true });

function transcript(folder, name, entries) {
  const path = join(dir, folder, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, entries.flat().join('\n') + '\n');
}

function learn(args = [], cwd = project) {
  const result = spawnSync(process.execPath, [script, '--dir', dir, ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const pairs = (args = []) => JSON.parse(learn(['--json', ...args])).pairs;
const find = (list, failed) => list.find((pair) => pair.failed === failed);

before(() => {
  // The long form of the path, as the script's process.cwd() gives it (not a Windows 8.3 name).
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'tew-learn-')));
  dir = join(root, 'projects');
  project = join(root, 'repo');
  mkdirSync(project);
  const folder = folderOf(project);
  const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
  for (const session of ['s1', 's2', 's3']) {
    transcript(folder, `${session}.jsonl`, [
      // The same fix with different arguments and wrappers each time.
      fail(`cd ${project} && pytest tests/test_${session}.py -q 2>&1 | tail -5`, 'Exit code 127\npytest: command not found'),
      bash(`cd ${project} && python -m pytest tests/test_${session}.py -q 2>&1 | tail -5`, '3 passed'),
      // Wrong path, then the right one, through the Read tool.
      call('Read', { file_path: join(project, 'src', 'util.ts') }, 'File does not exist.', { failed: true }),
      call('Read', { file_path: join(project, 'lib', 'util.ts') }, '1\tcode'),
      // A failing form that also works unchanged in another session.
      fail('go test', 'Exit code 1\nFAIL'),
      bash('go test ./...', 'ok'),
      // Noise that must not become a pair, three sessions over.
      fail('cargo build', 'Permission for this action was denied.'),
      bash('cargo build --release'),
      fail('make lint'),
      call('Edit', { file_path: join(project, 'a.c'), old_string: 'a', new_string: 'b' }, 'updated'),
      bash('make lint --keep-going'),
      fail('make docs'),
      bash('git status'),
      fail('make site'),
      bash('make site'),
      // A secret in the command.
      fail(`GITHUB_TOKEN=${SECRET} gh release list`),
      bash(`GITHUB_TOKEN=${SECRET} gh release list -R owner/repo`),
      // Keyed on `git push origin`, which works with other arguments in s4.
      fail(`git push origin feat-${session}`, 'Exit code 1\n! [rejected]'),
      bash(`git push --force origin feat-${session}`),
    ]);
  }
  // A subagent of s1 repeats the fix: still one session.
  transcript(folder, join('s1', 'subagents', 'agent-x.jsonl'), [fail('npm test'), bash('npm run test:unit')]);
  transcript(folder, 's4.jsonl', [fail('npm test'), bash('npm run test:unit'), bash('go test', 'ok'), bash('git push origin main')]);
  transcript(folder, 's5.jsonl', [fail('npm test', 'Exit code 1', { timestamp: old }), bash('npm run test:unit', 'ok', { timestamp: old })]);
  // Another project's sessions are left out unless --project names it.
  for (const session of ['o1', 'o2', 'o3']) transcript('other-project', `${session}.jsonl`, [fail('yarn test'), bash('yarn run test')]);
});
after(() => rmSync(root, { recursive: true, force: true }));

test('finds a fix seen in three sessions, keyed on the part that changed', () => {
  const list = pairs();
  const pytest = find(list, 'pytest');
  assert.ok(pytest, JSON.stringify(list));
  assert.equal(pytest.worked, 'python -m pytest');
  assert.equal(pytest.kind, 'command');
  assert.equal(pytest.sessions, 3);
  assert.equal(pytest.workedAsWritten, 0);
  assert.equal(pytest.written, true);
  const path = find(list, 'src/util.ts');
  assert.equal(path.kind, 'path');
  assert.equal(path.worked, 'lib/util.ts');
  assert.equal(path.sessions, 3);
});

test('skips denials, fixes made by an edit, unrelated next commands, unchanged retries and other projects', () => {
  const failed = pairs(['--min-sessions', '1']).map((pair) => pair.failed);
  for (const noise of ['cargo build', 'make lint', 'make docs', 'make site', 'yarn test']) {
    assert.ok(!failed.includes(noise), `${noise} in ${failed}`);
  }
});

test('counts sessions, not transcript files, and --min-sessions and --days narrow the list', () => {
  // s1 (its subagent), s4 and the old s5.
  assert.equal(find(pairs(), 'npm test').sessions, 3);
  assert.equal(find(pairs(['--days', '7']), 'npm test'), undefined);
  assert.equal(find(pairs(['--min-sessions', '2', '--days', '7']), 'npm test').sessions, 2);
});

test('a failing form that also worked as written is listed but not written', () => {
  const go = find(pairs(), 'go test');
  assert.equal(go.worked, 'go test ./...');
  assert.equal(go.workedAsWritten, 1);
  assert.equal(go.written, false);
  const push = find(pairs(), 'git push origin');
  assert.equal(push.worked, 'git push --force origin');
  assert.equal(push.workedAsWritten, 1);
  assert.equal(push.written, false);
});

test('redacts secrets in what it prints and never writes a rule that held one', () => {
  const text = learn(['--write']);
  const json = learn(['--json']);
  const file = readFileSync(join(project, 'CLAUDE.local.md'), 'utf8');
  for (const out of [text, json, file]) assert.ok(!out.includes(SECRET.slice(4)), out);
  assert.match(text, /GITHUB_TOKEN=\[REDACTED\]/);
  assert.ok(!file.includes('gh release'), file);
  rmSync(join(project, 'CLAUDE.local.md'));
});

test('redacts the common shapes of a secret and leaves ordinary words alone', () => {
  const cases = [
    ['curl -H "Authorization: Bearer abcdef123456789" https://x', 'Bearer [REDACTED]'],
    ['git clone https://user:hunter22@example.com/r.git', 'https://[REDACTED]@example.com'],
    ['psql --password=hunter22 db', '--password=[REDACTED]'],
    ['tool --api-key "k 1"', '--api-key [REDACTED]'],
    ['$env:OPENAI_API_KEY = "x1"; run', 'OPENAI_API_KEY = [REDACTED]'],
    [`deploy ${'sk-' + 'a1'.repeat(12)}`, 'deploy [REDACTED]'],
    ['aws s3 ls AKIAABCDEFGHIJKLMNOP', 'ls [REDACTED]'],
    [`run ${'Zx9'.repeat(15)}`, 'run [REDACTED]'],
    ['curl -u admin:hunter22 https://x', '-u [REDACTED] https'],
    ['curl -H "X-Api-Key: v123" https://x', '"X-Api-Key: [REDACTED]"'],
    ['curl -H "Authorization: rawvalue1" https://x', '"Authorization: [REDACTED]"'],
    [`curl -d '{"password":"v1","user":"me"}' https://x`, '"password":[REDACTED],"user":"me"'],
    ['DB_PASS=v1 MYSQL_PWD=v2 ./run', 'DB_PASS=[REDACTED] MYSQL_PWD=[REDACTED] ./run'],
  ];
  for (const [command, expected] of cases) assert.ok(redact(command).includes(expected), `${command} -> ${redact(command)}`);
  for (const plain of ['git log --author=me', 'npm token list', 'cat src/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p1.ts']) {
    assert.equal(redact(plain), plain);
  }
});

test('--project names other projects by part of their folder name', () => {
  assert.equal(find(pairs(['--project', 'other']), 'yarn test').worked, 'yarn run test');
});

test('--write keeps one managed block, updates it in place and leaves the rest of the file', () => {
  const file = join(root, 'notes', 'CLAUDE.local.md');
  mkdirSync(join(root, 'notes'));
  writeFileSync(file, '# My notes\r\n\r\nKeep this.\r\n');
  learn(['--write', '--file', file, '--days', '7']);
  const first = readFileSync(file, 'utf8');
  assert.ok(first.startsWith('# My notes\r\n\r\nKeep this.\r\n'), first);
  assert.ok(!/[^\r]\n/.test(first), 'kept CRLF line endings');
  assert.match(first, /- use `python -m pytest`, not `pytest`\r\n/);
  assert.match(first, /- the path is `lib\/util\.ts`, not `src\/util\.ts`\r\n/);
  assert.ok(!first.includes('go test') && !first.includes('npm'), first);
  learn(['--write', '--file', file, '--days', '7']);
  assert.equal(readFileSync(file, 'utf8'), first, 'a second run changes nothing');

  writeFileSync(file, first + 'Text after the block.\r\n');
  learn(['--write', '--file', file]);
  const second = readFileSync(file, 'utf8');
  assert.equal(second.match(/tew-learn:start/g).length, 1);
  assert.match(second, /- use `npm run test:unit`, not `npm test`\r\n/);
  assert.ok(second.endsWith('Text after the block.\r\n'), second);
});

test('--write leaves the block alone when a run learns nothing', () => {
  const file = join(root, 'kept.md');
  writeFileSync(file, '# Notes\n');
  learn(['--write', '--file', file]);
  const written = readFileSync(file, 'utf8');
  assert.match(written, /tew-learn:start/);
  assert.match(learn(['--write', '--file', file, '--min-sessions', '9']), /Nothing to write/);
  assert.equal(readFileSync(file, 'utf8'), written);
});

test('the sample in tests/fixtures/learn gives what the README shows', () => {
  const sample = fileURLToPath(new URL('./fixtures/learn', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--dir', sample, '--project', 'demo-project'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
  const rows = result.stdout.split('\n').filter((line) => /^\s+\d+\s+\d+\s/.test(line));
  assert.equal(rows.length, 2, result.stdout);
  for (const row of rows) assert.ok(readme.includes(row), row);
});

test('--write with nothing learned writes no file', () => {
  const empty = join(root, 'empty');
  mkdirSync(empty);
  const text = learn(['--write'], empty);
  assert.match(text, /No failed-then-working pair/);
  assert.equal(existsSync(join(empty, 'CLAUDE.local.md')), false);
});

test('the text report lists each pair with its counts', () => {
  const text = learn();
  assert.match(text, /3\s+3\s+pytest\s+->\s+python -m pytest/);
  assert.match(text, /go test.*also worked as written in 1 session/);
});
