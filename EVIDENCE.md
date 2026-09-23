# Does it actually save tokens?

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
