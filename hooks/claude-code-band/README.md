# Cost band for Claude Code (opt-in)

A band above the prompt that shows what the current task costs while you work, and how many of
its file reads the skill's rules would have skipped:

```text
tew · task $0.25 · 1.5k out · 5 tools · 3 reads (2 whole) · 1 repeated · 1 after an edit · session $1.25 · context 25%
```

- **task**: from the prompt you sent to the end of the answer: its cost, output tokens and tool
  calls. The figures stay up after the answer until your next prompt.
- **reads**: `Read` calls, and how many read the whole file (no `offset` or `limit`).
- **repeated**: a second read of a file this task already read and did not change (rule 4).
- **after an edit**: a read of a file right after this task edited it successfully (rule 2).
- **session**: the session's cost, as `/cost` totals it, and how full the context window is.

**Details** shows two lines (the task, and the whole session with its input tokens and cache
share). **Hide** hides the band in every session until you show it again with `/tew-band`.

## Install

It is its own plugin in this repo's marketplace, separate from the skill and the read guard:

```text
/plugin marketplace add vannt-dev/token-efficient-work
/plugin install token-efficient-work-band@token-efficient-work
```

`/tew-band` shows or hides it, `/tew-band details` switches between one line and two, and
`/plugin uninstall token-efficient-work-band@token-efficient-work` removes it.

## Limits

- Claude Code only, in the terminal or the desktop app. It is built on Claude Code's hooks
  modules, an early-access API, and was checked on Claude Code 2.1.309. It does not show under
  `claude -p`.
- The counts are per task. A read refused by the [read guard](../claude-code/README.md) still
  counts as a read, and the tool calls and tokens of subagents are added to the task.
- "Repeated" and "after an edit" match files by path, without case. A file changed by a shell
  command or another process is not seen as changed.
- Nothing leaves your machine: the band reads the session's own figures, and the only value it
  stores is whether you hid it.

## Develop

```bash
claude plugin validate hooks/claude-code-band
claude plugin test hooks/claude-code-band
claude --plugin-dir hooks/claude-code-band
```
