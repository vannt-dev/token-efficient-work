# Does it actually save tokens?

## Claude Code A/B with a description that triggers (2026-10-25, not shipped)

The 23/10 run below found the skill was never opened. Its description names a moment inside the
agent's work ("about to read a file") that the agent never matches against a request. A trial
description named the requests instead ("Use at the start of any coding task in a repository,
such as a fix, a rename, an edit, or a question about the code, before the first file read or
search"). Same suite, same command; Claude Code 2.1.310, Opus 5.5.

| per task, median of 3 runs | baseline | skill |
|---|--:|--:|
| tasks done correctly | 12/12 | 12/12 |
| skill opened | - | 12/12 |
| cost, geometric mean vs baseline | 1.00 | 1.18 |
| time | 1.00 | 1.11 |
| input tokens | 1.00 | 1.15 |
| output tokens | 1.00 | 1.24 |
| tool calls | 1.00 | 1.35 |

- **The skill now loads, and on these tasks that costs more.** Opening it is one more tool call,
  and its text stays in the context for the rest of the run.
- **These four tasks leave it nothing to save.** The baseline made no confirmation reads and at
  most one whole-file read per task, so the suite can show the skill's fixed cost but not a
  saving. A task where the baseline over-reads (a long file, a change across several files)
  would be needed for that; the two tasks below were added for it.
- The 23/10 columns below measured the description in the skill list, not the skill: it was not
  in the agent's context in either arm.

Two tasks were then added to give the baseline room to over-read, with no location in the prompt
(same day, same setup, 3 runs per arm):

| task | fixture | baseline whole-file reads | skill whole-file reads | cost, skill vs baseline |
|---|---|--:|--:|--:|
| `long-file-symptom` | 1,500-line module, bug given only by its symptom | 0 | 0 | 1.10 |
| `three-file-rename` | a setting used in three 290-line files, file names not given | 1 | 0 | 0.97 |

Every run did the task (the rename grader had an anchoring bug in this run, fixed and rechecked
once per arm). Even here the baseline searched first and read ranges: on Opus 5.5 in Claude Code
the habits the rules ask for are already the default, so the skill saves at most a whole-file
read and costs its own load. Where it may still pay off is not measured: other models and agents,
long sessions, shell-heavy work.

**Decision:** the shipped description stays as it is. Making Claude Code open the skill costs
10-18% on these tasks and saved nothing measurable. In Claude Code the cheaper way to carry the
rules is the five-line snippet in `CLAUDE.md` (the third column of the 23/10 run). The new tasks
stay in `evals/`, so a later model or description can be measured against them.

## Codex CLI A/B, 6 tasks × 2 runs (2026-10-25)

The same six tasks on Codex CLI 0.164.0 (gpt-5.6-terra, medium effort, Windows), through
[`scripts/codex-ab.mjs`](scripts/codex-ab.mjs). Three arms: no guidance; the skill in the
workspace's `.agents/skills`; the five rules of `hooks/global-rule.snippet.md` in the workspace's
`AGENTS.md`. Each run gets a fresh workspace and a fresh `CODEX_HOME` with only the login copied in;
the user's own `~/.agents/skills` is moved aside for the run, since Codex finds it through the real
home folder.

| ratio to the baseline (geometric mean across tasks) | input tokens | uncached input | output tokens | tool calls |
|---|--:|--:|--:|--:|
| skill | 1.09 | 1.04 | 1.10 | 1.13 |
| rules in `AGENTS.md` | 0.83 | 0.72 | 0.83 | 0.84 |

- **On Codex the rules help; the skill does not.** The rules arm used fewer input tokens in four
  tasks, matched the baseline in `rename-symbol`, and did every task. It used more only in
  `answer-from-config`, where one baseline run answered without reading the file (below). The
  skill was read in every run, and reading it cost about what it saved.
- **One baseline run answered without looking.** Asked for the timeout in `config.py`, it replied
  "30" with no tool call; the file says 45. Both guided arms read the file every time.
- **Two runs per arm.** The direction holds across tasks, but the size is rough.

Reproduce (uses your Codex plan; the work folder must not sit under `%TEMP%` on Windows):

```bash
node scripts/codex-ab.mjs --work <folder> --runs 2
node scripts/codex-ab.mjs --summary <folder>/codex-ab.json
```

## Claude Code A/B, 4 tasks × 3 runs (2026-10-23)

The suite in [`evals/`](evals/) runs headless Claude Code on four small tasks, the same agent with
and without the plugin, through `claude plugin eval`. Each run starts in a fresh temporary home
and workspace, so the baseline does not see a skill installed on this machine.

| task | rules it targets | fixture |
|---|---|---|
| `rename-symbol` | 1, 2 | 60-function module + one caller |
| `one-line-fix` | 1, 2, 3 | 300-line module, wrong formula in one function |
| `answer-from-config` | 1, 5 | 80-line settings file, one-fact question |
| `comment-typo` | 2, 3 | typo in one comment, a test file nearby |

Regex graders check the files each run leaves behind (the question task: its answer), not what
the agent says it did.
Claude Code 2.1.309, Opus 5.5 at default effort, Windows.

| per task, median of 3 runs | baseline | skill | skill + rules in system prompt |
|---|--:|--:|--:|
| tasks done correctly | 12/12 | 12/12 | 12/12 |
| skill opened | - | 0/12 | 0/12 |
| cost, geometric mean vs baseline | 1.00 | 0.92 | 0.89 |
| time | 1.00 | 0.81 | 0.80 |
| input tokens | 1.00 | 0.85 | 0.89 |
| output tokens | 1.00 | 0.88 | 0.99 |
| tool calls | 1.00 | 0.80 | 0.96 |

The third column adds the five lines of `hooks/global-rule.snippet.md` to the system prompt, as an
install into `CLAUDE.md` does; its baseline is the baseline column of the same day.

What this shows, and what it does not:

- **The effect on Opus 5.5 is small.** The baseline already reads a file once and edits it; it
  made no confirmation reads at all. The gaps (8-11% cost) are within what three runs per arm can
  separate from noise. Treat them as "no worse, maybe a little better", not as a saving to quote.
- **The skill was never opened** in 24 runs. Whatever effect there is comes from text the agent
  always sees: the skill's name and description in its skill list, or the rules in the system
  prompt. The two columns are too close to say which of them helps more.
- **The rules changed how it reads, not always for less.** In `one-line-fix` the rules arm searched
  first and read a range (no whole-file read) but used four tool calls instead of two, so its input
  tokens went up on a 300-line file. Rule 1 pays off on large files, not small ones.
- **Not measured here:** shell use (on Windows `claude plugin eval` cannot sandbox a shell, so no
  case grants Bash, and rule 3's unrequested test runs never come up), long sessions, large repos,
  and other models. The earlier Codex trial below saw a larger gap.
- **No per-repo saving can be computed.** The run without the skill never happened in your repo,
  so there is nothing to subtract. To see where your own reading goes, use
  [`scripts/read-report.mjs`](README.md#measure-your-own-sessions).

Reproduce (each run costs about USD 0.05-0.10; `--keep-temp` keeps the traces the summary reads):

```bash
claude plugin eval . --scaffold --keep-temp --allow-tools Edit Write --runs 3 --threshold 0   --max-cost-usd 6 --no-publish --output-dir evals/results/ab
node scripts/eval-summary.mjs evals/results/ab/aggregate-result.json
```

`--scaffold` runs each case's `fixture.sh` (it only writes the fixture files). For the third
column, copy `evals/` to `evals-rules/`, add the snippet as `append_system_prompt:` under
`execution:` in each `case.yaml`, run with `--eval-dir evals-rules --ablation none`, and summarise
with `--without-from evals/results/ab/aggregate-result.json`. Delete the kept `claude-eval-*`
folders in your temp directory afterwards.

## Codex CLI, single trial (2026-10)

A single paired trial with real Codex CLI (`codex exec`, GPT-5.5), not a
simulation. Same task, same fresh 2-file fixture (a ~60-function Python
module + its one caller), run twice: once with the skill and global hook
installed (current normal state on this machine), once with both
temporarily moved out of the way to get a clean no-skill baseline, then
restored.

Task given to both: *"Rename the function `calc_total` to
`compute_total` in utils.py, and update its one call site in main.py to
match. Then tell me it's done."*

## What happened

**With skill:** read the skill file once, ran one targeted `rg` search
for both symbol occurrences, applied both edits in a single batched
change, replied "Done." — 2 tool calls total.

**Without skill (baseline):** ran the same targeted `rg` search, then
additionally read the *entire* contents of both files with
`Get-Content -Raw` even though the grep had already located the exact
lines, applied the edits, then ran a second, unrequested `rg` pass
afterward "to make sure no stale reference remains" — 4 tool calls
total. Final reply was still just "Done.", so the extra cost was all in
the middle steps, not the write-up.

That's exactly the two patterns the skill's rules target: whole-file
reads after already having the location, and an unrequested
re-verification pass after a successful edit.

## Token cost (from Codex's own usage report)

| | With skill | Baseline (no skill) | Delta |
|---|---:|---:|---:|
| Tool calls | 2 | 4 | +100% |
| Input tokens | 43,204 | 56,164 | +30% |
| — of which cached | 39,040 | 49,664 | — |
| — of which fresh (billed at full rate) | 4,164 | 6,500 | +56% |
| Output tokens | 382 | 601 | +57% |
| Reasoning tokens | 21 | 0 | — |

## Caveats

- **n = 1 per condition.** This is one paired run, not a statistically
  powered study — real model output varies between runs even with
  identical prompts. Treat the direction and rough magnitude as
  indicative, not as a guaranteed percentage.
- Both runs used the same trivial rename task; a task with more files
  or more ambiguity about location would likely widen the gap (more
  opportunities for whole-file reads and speculative re-checks), but
  that's not measured here.
- Restoring the baseline environment (moving the skill/hook aside, then
  back) was verified after the run; nothing about this test alters your
  normal setup.
