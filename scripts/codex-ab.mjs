#!/usr/bin/env node
// A/B the eval tasks in evals/ on Codex CLI: no guidance, the skill in the workspace, or the five
// rules in the workspace AGENTS.md. Each run gets a fresh workspace and a fresh CODEX_HOME holding
// only your auth.json and a small config, so nothing installed in your own home leaks in.
//
//   node scripts/codex-ab.mjs --work <dir outside %TEMP%> [--runs 2] [--task <name>]
//                             [--arms baseline,skill,rules] [--model gpt-5.6-terra] [--out file.json]
//   node scripts/codex-ab.mjs --summary <file.json>     medians per arm and ratios to the baseline
//
// It runs `codex exec` as you: every run uses your Codex plan. On Windows the work directory must
// not sit under %TEMP% (Codex refuses to set up its shell helpers there).
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseCase(text) {
  const prompt = (() => {
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex((l) => /^\s+prompt:/.test(l));
    const first = lines[at].replace(/^\s+prompt:\s*/, '');
    if (first !== '>-' && first !== '>') return first.replace(/^['"]|['"]$/g, '');
    const indent = lines[at + 1].match(/^\s*/)[0].length;
    const body = [];
    for (let i = at + 1; i < lines.length && (lines[i].trim() === '' || lines[i].match(/^\s*/)[0].length >= indent); i++) {
      body.push(lines[i].trim());
    }
    return body.join(' ').trim();
  })();
  const graders = [];
  const section = text.slice(text.indexOf('graders:'));
  for (const block of section.split(/\n\s+- name: /).slice(1)) {
    const field = (name) => block.match(new RegExp(`\\n\\s+${name}: (.*)`))?.[1]?.trim();
    const grader = { name: block.split(/\r?\n/)[0].trim(), type: field('type') };
    const pattern = field('pattern');
    if (pattern) grader.pattern = pattern.replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
    const match = field('match');
    if (match) grader.match = match.replace(/^'(.*)'$/, '$1');
    const path = block.match(/path: ([^ }]+)/)?.[1];
    if (path) grader.path = path;
    graders.push(grader);
  }
  return { prompt, graders };
}

export function grade(graders, workspace, answer) {
  const results = [];
  for (const g of graders) {
    if (g.type !== 'regex') continue;
    const text = g.path ? (existsSync(join(workspace, g.path)) ? readFileSync(join(workspace, g.path), 'utf8') : '') : answer;
    const re = new RegExp(g.pattern, 'g');
    const count = (text.match(re) || []).length;
    let pass;
    if (g.match === 'not_contains') pass = count === 0;
    else if (g.match?.startsWith('count:')) pass = count === Number(g.match.slice(6));
    else pass = count > 0;
    results.push({ name: g.name, pass });
  }
  return results;
}

function rules() {
  const snippet = readFileSync(join(root, 'hooks', 'global-rule.snippet.md'), 'utf8');
  const lines = snippet.split(/\r?\n/).filter((l) => /^\d\. /.test(l));
  return `## Token-efficient work\n\n${lines.join('\n')}\n`;
}

// The CLI's own script, so arguments reach it unquoted by any shell.
function codexEntry() {
  const npmRoot = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }).trim();
  return join(npmRoot, '@openai', 'codex', 'bin', 'codex.js');
}

function newestFile(dir) {
  let best = null;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (name.endsWith('.jsonl') && (!best || s.mtimeMs > best.t)) best = { p, t: s.mtimeMs };
    }
  };
  if (existsSync(dir)) walk(dir);
  return best?.p ?? null;
}

// The commands a run executed, from its session file.
export function commandsOf(rolloutText) {
  const commands = [];
  for (const line of rolloutText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const p = d.payload ?? d;
    if (p?.type === 'function_call' || p?.type === 'custom_tool_call') {
      commands.push(`${p.name}: ${typeof p.arguments === 'string' ? p.arguments : p.input ?? ''}`);
    }
  }
  return commands;
}

function runOnce({ task, arm, index, work, model }) {
  const caseDir = join(root, 'evals', task);
  const { prompt, graders } = parseCase(readFileSync(join(caseDir, 'case.yaml'), 'utf8'));
  const base = join(work, `${task}-${arm}-${index}`);
  rmSync(base, { recursive: true, force: true });
  const workspace = join(base, 'ws');
  const home = join(base, 'home');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(home, '.codex'), { recursive: true });
  cpSync(join(homedir(), '.codex', 'auth.json'), join(home, '.codex', 'auth.json'));
  // The Windows sandbox's setup; without it a fresh CODEX_HOME's shell is blocked or hangs.
  const capSid = join(homedir(), '.codex', 'cap_sid');
  if (existsSync(capSid)) cpSync(capSid, join(home, '.codex', 'cap_sid'));
  writeFileSync(
    join(home, '.codex', 'config.toml'),
    `model = "${model}"\nmodel_reasoning_effort = "medium"\n[windows]\nsandbox = "unelevated"\n`,
  );
  execFileSync('bash', [join(caseDir, 'fixture.sh')], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  if (arm === 'skill') {
    const dest = join(workspace, '.agents', 'skills', 'token-efficient-work');
    mkdirSync(dest, { recursive: true });
    cpSync(join(root, 'skills', 'token-efficient-work', 'SKILL.md'), join(dest, 'SKILL.md'));
  }
  if (arm === 'rules') writeFileSync(join(workspace, 'AGENTS.md'), rules());
  const started = Date.now();
  const run = spawnSync(
    process.execPath,
    [codexEntry(), 'exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-C', workspace, prompt],
    {
      env: { ...process.env, CODEX_HOME: join(home, '.codex'), USERPROFILE: home, HOME: home },
      input: '',
      encoding: 'utf8',
      timeout: 600_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const seconds = Math.round((Date.now() - started) / 1000);
  let usage = null;
  let answer = '';
  for (const line of (run.stdout || '').split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    const d = JSON.parse(line);
    if (d.type === 'turn.completed') usage = d.usage;
    if (d.type === 'item.completed' && d.item?.type === 'agent_message') answer = d.item.text;
  }
  const rollout = newestFile(join(home, '.codex', 'sessions'));
  const commands = rollout ? commandsOf(readFileSync(rollout, 'utf8')) : [];
  const checks = grade(graders, workspace, answer);
  return {
    task,
    arm,
    index,
    seconds,
    exit: run.status,
    passed: checks.length > 0 && checks.every((c) => c.pass),
    checks,
    usage,
    toolCalls: commands.length,
    skillOpened: commands.some((c) => c.includes('SKILL.md')),
    commands,
    answer: answer.slice(0, 400),
  };
}

const METRICS = {
  input: (r) => r.usage.input_tokens,
  uncached: (r) => r.usage.input_tokens - r.usage.cached_input_tokens,
  output: (r) => r.usage.output_tokens,
  tools: (r) => r.toolCalls,
};

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarize(results) {
  const tasks = [...new Set(results.map((r) => r.task))];
  const arms = [...new Set(results.map((r) => r.arm))];
  const cell = {};
  const lines = ['| task | arm | passed | skill read | input | uncached input | output | tool calls |', '|---|---|--:|--:|--:|--:|--:|--:|'];
  for (const task of tasks) {
    for (const arm of arms) {
      const rs = results.filter((r) => r.task === task && r.arm === arm && r.usage);
      if (rs.length === 0) continue;
      const c = { passed: rs.filter((r) => r.passed).length, opened: rs.filter((r) => r.skillOpened).length, runs: rs.length };
      for (const [k, f] of Object.entries(METRICS)) c[k] = median(rs.map(f));
      cell[`${task}/${arm}`] = c;
      lines.push(`| ${task} | ${arm} | ${c.passed}/${c.runs} | ${c.opened}/${c.runs} | ${Math.round(c.input)} | ${Math.round(c.uncached)} | ${Math.round(c.output)} | ${c.tools} |`);
    }
  }
  lines.push('', '| vs baseline (geometric mean across tasks) | ' + Object.keys(METRICS).join(' | ') + ' |', '|---|' + Object.keys(METRICS).map(() => '--:').join('|') + '|');
  for (const arm of arms.filter((a) => a !== 'baseline')) {
    const ratios = Object.keys(METRICS).map((k) => {
      const logs = tasks.filter((t) => cell[`${t}/${arm}`] && cell[`${t}/baseline`]?.[k] > 0).map((t) => Math.log(cell[`${t}/${arm}`][k] / cell[`${t}/baseline`][k]));
      return Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length).toFixed(2);
    });
    lines.push(`| ${arm} | ${ratios.join(' | ')} |`);
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--summary') {
    console.log(summarize(JSON.parse(readFileSync(args[1], 'utf8'))));
    return;
  }
  const opt = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at === -1 ? fallback : args[at + 1];
  };
  const work = opt('work');
  if (!work) {
    console.error('usage: node scripts/codex-ab.mjs --work <dir> [--runs 2] [--task name] [--arms a,b] [--out f]');
    process.exit(2);
  }
  const runs = Number(opt('runs', '2'));
  const arms = opt('arms', 'baseline,skill,rules').split(',');
  const model = opt('model', 'gpt-5.6-terra');
  const tasks = opt('task') ? [opt('task')] : readdirSync(join(root, 'evals')).filter((d) => existsSync(join(root, 'evals', d, 'case.yaml')));
  const out = opt('out', join(work, 'codex-ab.json'));
  // Codex finds ~/.agents/skills through the real home folder, not HOME or USERPROFILE, so the
  // baseline would see a skill installed there. Move the folder aside for the run, then back.
  const userSkills = join(homedir(), '.agents', 'skills');
  const aside = join(homedir(), '.agents', 'skills.codex-ab-aside');
  if (existsSync(aside)) throw new Error(`${aside} exists: move it back to ${userSkills} first.`);
  const restore = () => {
    if (existsSync(aside) && !existsSync(userSkills)) renameSync(aside, userSkills);
  };
  if (existsSync(userSkills)) {
    renameSync(userSkills, aside);
    console.log(`moved ${userSkills} aside for the run; it is put back at the end`);
  }
  process.on('SIGINT', () => {
    restore();
    process.exit(130);
  });
  try {
    runAll({ tasks, runs, arms, work, model, out });
  } finally {
    restore();
  }
}

function runAll({ tasks, runs, arms, work, model, out }) {
  const results = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : [];
  for (const task of tasks) {
    for (let index = 1; index <= runs; index++) {
      for (const arm of arms) {
        if (results.some((r) => r.task === task && r.arm === arm && r.index === index)) continue;
        const r = runOnce({ task, arm, index, work, model });
        results.push(r);
        writeFileSync(out, JSON.stringify(results, null, 2));
        const u = r.usage;
        console.log(
          `${task} ${arm} #${index}: ${r.passed ? 'pass' : 'FAIL'} in=${u?.input_tokens ?? '?'} cached=${u?.cached_input_tokens ?? '?'} out=${u?.output_tokens ?? '?'} tools=${r.toolCalls} skill=${r.skillOpened} ${r.seconds}s`,
        );
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
