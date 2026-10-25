import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { commandsOf, grade, parseCase } from '../scripts/codex-ab.mjs';

const evals = fileURLToPath(new URL('../evals', import.meta.url));

test('every eval case parses into a prompt and at least one regex grader', () => {
  for (const name of readdirSync(evals).filter((d) => !d.startsWith('results'))) {
    const { prompt, graders } = parseCase(readFileSync(join(evals, name, 'case.yaml'), 'utf8'));
    assert.ok(prompt.length > 20, `${name} prompt`);
    assert.ok(!prompt.startsWith('>'), `${name} folded prompt is joined`);
    assert.ok(graders.some((g) => g.type === 'regex'), `${name} regex grader`);
    for (const g of graders.filter((x) => x.type === 'regex')) assert.doesNotThrow(() => new RegExp(g.pattern), `${name}/${g.name}`);
  }
});

test('grade applies contains, not_contains and count to files or the answer', () => {
  const ws = mkdtempSync(join(tmpdir(), 'codex-ab-'));
  writeFileSync(join(ws, 'a.py'), 'def f():\n    pass\ndef g():\n    pass\n');
  const graders = [
    { name: 'has-f', type: 'regex', path: 'a.py', pattern: 'def f\\(' },
    { name: 'no-h', type: 'regex', path: 'a.py', pattern: 'def h', match: 'not_contains' },
    { name: 'two-defs', type: 'regex', path: 'a.py', pattern: 'def ', match: 'count:2' },
    { name: 'answer', type: 'regex', pattern: '\\b45\\b' },
    { name: 'skipped', type: 'tool_used' },
  ];
  assert.deepEqual(
    grade(graders, ws, 'It is 45 seconds.').map((r) => r.pass),
    [true, true, true, true],
  );
  assert.equal(grade(graders, ws, 'It is 30.').at(-1).pass, false);
});

test('commandsOf lists the tool calls of a Codex session file', () => {
  const lines = [
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'exec', arguments: '{"cmd":"Get-Content SKILL.md"}' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant' } }),
    'not json',
  ].join('\n');
  assert.deepEqual(commandsOf(lines), ['exec: {"cmd":"Get-Content SKILL.md"}']);
});
