# Read guard for Claude Code (opt-in)

The skill asks the agent to locate before it reads. `guard-full-read.mjs` turns that one rule
into a gate, for Claude Code only: a `Read` with no `offset` and no `limit` on a source file longer
than 400 lines is refused, and the refusal tells the agent to search first and read a range.

It is not installed by `install.sh`, `install-project.sh` or the `token-efficient-work` plugin.
Turn it on yourself after you have seen what it would catch.

## 1. Measure first

```bash
node scripts/read-report.mjs --days 30
```

The report reads Claude Code's transcripts under `~/.claude/projects` and prints how many reads
were whole-file, how many of those were over the limit, and how many reads only confirmed an edit
or repeated an earlier read. If the "source code (the guard refuses)" line is small, you do not
need the guard.

## 2. Turn it on

Requires Node.js 18 or newer on `PATH`.

### As a plugin (every project)

The guard is its own plugin in this repo's Claude Code marketplace, separate from the skill
plugin, so installing the skill never turns it on. Installing this plugin does:

```text
/plugin marketplace add vannt-dev/token-efficient-work
/plugin install token-efficient-work-read-guard@token-efficient-work
```

On Claude Code 2.1.275 or later one line does both:
`/plugin install token-efficient-work-read-guard --marketplace vannt-dev/token-efficient-work`.
`/plugin disable token-efficient-work-read-guard@token-efficient-work` turns it off again, and
`/plugin uninstall` removes it.

### By hand (one project)

Copy the hook into the project and register it in `.claude/settings.json`:

```bash
mkdir -p .claude/hooks
cp hooks/claude-code/guard-full-read.mjs .claude/hooks/guard-full-read.mjs
```

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-full-read.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Merge the `PreToolUse` entry into the file if it already has hooks. For every project on the
machine, put the file under `~/.claude/hooks/` and the entry in `~/.claude/settings.json`, with the
command `node "$HOME/.claude/hooks/guard-full-read.mjs"`.

## What it does and does not do

- Refuses only source code (`.ts`, `.py`, `.go`, `.cs`, ... the list is at the top of the file).
  Markdown, JSON, YAML, logs and diffs are read whole as before.
- A read that names `offset` or `limit` always passes, so an agent that needs the whole file asks
  for it on purpose.
- `TEW_READ_GUARD_MAX_LINES` changes the limit (default 400).
- It is a cost guard, not a security control: bad input, a missing file, or Node not being
  installed all let the read through.
- Other tools (Codex, Copilot CLI, Gemini CLI, Cursor, Aider) get the rule from the skill and the
  instruction snippet only.
