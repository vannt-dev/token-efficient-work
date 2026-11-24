# Failure-loop guard for Claude Code (opt-in)

An agent that runs the same failing command again, unchanged, pays for the same error output each
time. `guard-fail-loop.mjs` notices that, for Claude Code only: when the same Bash or PowerShell
command has failed 3 times in a row in a session, it adds one line next to the error telling the
agent to stop retrying it and change something (read the error, check the command, try another
way, or ask you).

It never refuses a call and never calls a model. It is not installed by `install.sh`,
`install-project.sh` or the `token-efficient-work` plugin.

## Turn it on

Requires Node.js 18 or newer on `PATH`.

### As a plugin (every project)

The guard is its own plugin in this repo's Claude Code marketplace, separate from the skill and
the read guard. Installing it turns it on:

```text
/plugin marketplace add vannt-dev/token-efficient-work
/plugin install token-efficient-work-fail-loop@token-efficient-work
```

`/plugin disable token-efficient-work-fail-loop@token-efficient-work` turns it off again, and
`/plugin uninstall` removes it.

### By hand (one project)

Copy the hook into the project and register it in `.claude/settings.json` for both events: a
failure counts, a success clears the count.

```bash
mkdir -p .claude/hooks
cp hooks/claude-code-fail-loop/guard-fail-loop.mjs .claude/hooks/guard-fail-loop.mjs
```

```json
{
  "hooks": {
    "PostToolUseFailure": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-fail-loop.mjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-fail-loop.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Merge the entries into the file if it already has hooks. For every project on the machine, put the
file under `~/.claude/hooks/` and the entries in `~/.claude/settings.json`, with the command
`node "$HOME/.claude/hooks/guard-fail-loop.mjs"`. To remove it, delete the file and the two
entries.

## What it does and does not do

- "The same command" means the same text once spaces are collapsed. `npm test` and
  `npm test -- --verbose` are different commands, so changing the command starts the count again.
- Any shell command that succeeds clears the count. An interrupted command is not counted.
- The line comes at the 3rd failure and again at the 6th, 9th and so on, not on every failure.
  `TEW_FAIL_LOOP_LIMIT` changes the number (default 3).
- State is one small file per session under the system temp folder (`tew-fail-loop/`): a hash of
  the last failing command and how many times it failed. A success deletes it.
  `TEW_FAIL_LOOP_STATE_DIR` moves it.
- It runs `node` once after every shell call, which adds about a tenth of a second to each.
- It is a cost guard, not a security control: bad input, no session id, a state file it cannot
  write, or Node not being installed all mean it stays quiet.
- Other tools (Codex, Copilot CLI, Gemini CLI, Cursor, Aider) do not get it.
