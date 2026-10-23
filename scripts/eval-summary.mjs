#!/usr/bin/env node
// Summarise an A/B run of the evals in evals/: the same agent with the plugin (with) and
// without it (without), on the same tasks.
//
//   node scripts/eval-summary.mjs <aggregate-result.json>          Markdown tables
//   node scripts/eval-summary.mjs <aggregate-result.json> --json   machine-readable
//   node scripts/eval-summary.mjs <a.json> --without-from <b.json>  the without arm from another run
//                                                                   (for a single-arm run of a variant)
//
// Per run it reads the eval result (passed, cost, time) and the run's trace.jsonl (tokens, tool
// calls, whole-file reads, whether the skill was opened). "passed" counts the graders that check the
// work and leaves out the skill-opened indicator. Traces are kept only when the eval ran
// with --keep-temp; without them the token and tool columns stay empty.
// Each case shows the median of its runs per arm. The last table is the geometric mean, across
// cases, of with/without ratios of those medians: 0.80 means 20% less with the plugin.

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export function traceMetrics(lines) {
  const m = { inputTokens: null, outputTokens: null, toolCalls: 0, reads: 0, wholeFileReads: 0, confirmationReads: 0, skillOpened: false };
  let lastEdited = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.type === 'result' && event.usage) {
      const u = event.usage;
      m.inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      m.outputTokens = u.output_tokens ?? 0;
    }
    if (event.type !== 'assistant') continue;
    for (const block of event.message?.content ?? []) {
      if (block.type !== 'tool_use') continue;
      m.toolCalls += 1;
      const input = block.input ?? {};
      if (block.name === 'Skill') m.skillOpened = true;
      if (block.name === 'Read') {
        m.reads += 1;
        if (input.offset === undefined && input.limit === undefined) m.wholeFileReads += 1;
        if (lastEdited && input.file_path === lastEdited) m.confirmationReads += 1;
      }
      lastEdited = EDIT_TOOLS.has(block.name) ? input.file_path : null;
    }
  }
  return m;
}

export function median(values) {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// A run passes when every grader that checks the work passed; the skill-opened indicator does not count.
export function workPassed(run) {
  const graders = (run.graders ?? []).filter((g) => g && g.name !== 'skill-opened' && !g.withOnly);
  return graders.length ? graders.every((g) => g.passed) : Boolean(run.passed);
}

const METRICS = ['costUsd', 'durationSeconds', 'inputTokens', 'outputTokens', 'toolCalls', 'wholeFileReads', 'confirmationReads'];

export function summarize(result, readTrace = (p) => (p && existsSync(p) ? readFileSync(p, 'utf8').split('\n') : null)) {
  const cases = result.cases.map((c) => {
    const arms = {};
    for (const arm of ['with', 'without']) {
      const runs = (c.arms?.[arm] ?? []).map((run) => {
        const lines = readTrace(run.tracePath);
        return { passed: workPassed(run), costUsd: run.costUsd, durationSeconds: run.durationSeconds, ...(lines ? traceMetrics(lines) : {}) };
      });
      arms[arm] = {
        runs: runs.length,
        passed: runs.filter((r) => r.passed).length,
        skillOpened: runs.filter((r) => r.skillOpened).length,
        ...Object.fromEntries(METRICS.map((k) => [k, median(runs.map((r) => r[k]))])),
      };
    }
    return { name: c.name, ...arms };
  });
  const ratios = Object.fromEntries(
    METRICS.map((k) => {
      const logs = cases
        .map((c) => [c.with[k], c.without[k]])
        .filter(([w, wo]) => w > 0 && wo > 0)
        .map(([w, wo]) => Math.log(w / wo));
      return [k, logs.length ? Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length) : null];
    }),
  );
  return { claudeVersion: result.claudeVersion, cases, ratios };
}

const fmt = (v, digits = 0) => (v === null || v === undefined ? '-' : Number(v).toFixed(digits));

export function toMarkdown(s) {
  const out = [`Claude Code ${s.claudeVersion ?? '?'}; medians per arm.`, ''];
  out.push('| case | arm | passed | skill opened | cost USD | time s | input tok | output tok | tool calls | whole-file reads | confirmation reads |');
  out.push('|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|');
  for (const c of s.cases) {
    for (const arm of ['with', 'without']) {
      const a = c[arm];
      out.push(
        `| ${c.name} | ${arm} | ${a.passed}/${a.runs} | ${a.skillOpened}/${a.runs} | ${fmt(a.costUsd, 3)} | ${fmt(a.durationSeconds)} | ${fmt(a.inputTokens)} | ${fmt(a.outputTokens)} | ${fmt(a.toolCalls, 1)} | ${fmt(a.wholeFileReads, 1)} | ${fmt(a.confirmationReads, 1)} |`,
      );
    }
  }
  out.push('', '| with / without (geometric mean across cases) | ratio |', '|---|--:|');
  for (const [k, v] of Object.entries(s.ratios)) out.push(`| ${k} | ${fmt(v, 2)} |`);
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--without-from');
  if (!file) {
    console.error('usage: node scripts/eval-summary.mjs <aggregate-result.json> [--json] [--without-from <b.json>]');
    process.exit(2);
  }
  const load = (f) => JSON.parse(readFileSync(f, 'utf8'));
  const result = load(file);
  const other = args.includes('--without-from') ? load(args[args.indexOf('--without-from') + 1]) : null;
  if (other) {
    const byName = Object.fromEntries(other.cases.map((c) => [c.name, c.arms?.without ?? []]));
    for (const c of result.cases) c.arms = { ...c.arms, without: byName[c.name] ?? [] };
  }
  const summary = summarize(result);
  console.log(args.includes('--json') ? JSON.stringify(summary, null, 2) : toMarkdown(summary));
}
