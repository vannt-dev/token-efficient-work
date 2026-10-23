import assert from 'node:assert/strict';
import { test } from 'node:test';

import { median, summarize, toMarkdown, traceMetrics, workPassed } from '../scripts/eval-summary.mjs';

const assistant = (...tools) =>
  JSON.stringify({
    type: 'assistant',
    message: { content: tools.map(([name, input]) => ({ type: 'tool_use', name, input })) },
  });
const result = (input, output) =>
  JSON.stringify({ type: 'result', usage: { input_tokens: input, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: output } });

test('traceMetrics counts tool calls, whole-file reads, confirmation reads and the skill', () => {
  const lines = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    assistant(['Skill', { skill: 'token-efficient-work' }]),
    assistant(['Grep', { pattern: 'x' }], ['Read', { file_path: 'a.py', offset: 10, limit: 20 }]),
    assistant(['Edit', { file_path: 'a.py' }]),
    assistant(['Read', { file_path: 'a.py' }]),
    assistant(['Read', { file_path: 'b.py' }]),
    result(5, 300),
    '',
  ];
  assert.deepEqual(traceMetrics(lines), {
    inputTokens: 115,
    outputTokens: 300,
    toolCalls: 6,
    reads: 3,
    wholeFileReads: 2,
    confirmationReads: 1,
    skillOpened: true,
  });
});

test('a read of another file after an edit is not a confirmation read', () => {
  const m = traceMetrics([assistant(['Write', { file_path: 'a.py' }]), assistant(['Read', { file_path: 'b.py' }])]);
  assert.equal(m.confirmationReads, 0);
});

test('median ignores missing values', () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([4, 1]), 2.5);
  assert.equal(median([undefined]), null);
});

test('summarize takes medians per arm and a geometric mean of with/without ratios', () => {
  const traces = {
    w1: [assistant(['Read', { file_path: 'a' }]), result(0, 100)],
    w2: [assistant(['Read', { file_path: 'a' }]), result(0, 300)],
    o1: [assistant(['Read', { file_path: 'a' }], ['Read', { file_path: 'a' }]), result(0, 400)],
  };
  const run = (tracePath, costUsd, passed = true) => ({ tracePath, costUsd, durationSeconds: 10, passed });
  const s = summarize(
    {
      claudeVersion: '9.9.9',
      cases: [
        { name: 'one', arms: { with: [run('w1', 0.1), run('w2', 0.3)], without: [run('o1', 0.4)] } },
        { name: 'two', arms: { with: [run('gone', 0.2, false)], without: [run('gone', 0.2)] } },
      ],
    },
    (p) => traces[p] ?? null,
  );
  assert.equal(s.cases[0].with.outputTokens, 200);
  assert.equal(s.cases[0].without.toolCalls, 2);
  assert.equal(s.cases[1].with.passed, 0);
  assert.equal(s.cases[1].with.outputTokens, null);
  // cost: one 0.2/0.4 and two 0.2/0.2, so sqrt(0.5 * 1)
  assert.ok(Math.abs(s.ratios.costUsd - Math.SQRT1_2) < 1e-9);
  // output tokens only for the case with traces: 200/400
  assert.equal(s.ratios.outputTokens, 0.5);
  assert.match(toMarkdown(s), /\| one \| with \| 2\/2 \| 0\/2 \| 0\.200 \|/);
});

test('workPassed ignores the skill-opened indicator', () => {
  const g = (name, passed) => ({ name, passed });
  assert.equal(workPassed({ passed: false, graders: [g('fixed', true), g('skill-opened', false)] }), true);
  assert.equal(workPassed({ passed: false, graders: [g('fixed', false), g('skill-opened', true)] }), false);
  assert.equal(workPassed({ passed: true }), true);
});
