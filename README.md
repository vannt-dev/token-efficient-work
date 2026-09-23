# token-efficient-work

A skill + global instruction hooks that stop coding agents (Claude Code,
Codex, Copilot CLI, Gemini CLI) from burning tokens on redundant work:
re-reading a file after a successful edit, reading a whole file for a
two-line change, adding unrequested "just to be safe" checks, or writing
over-long explanations.

## What's here

- `skills/token-efficient-work/SKILL.md` — the canonical skill (rules,
  rationalization table, red flags). Discovered natively by Codex,
  Copilot CLI, and Gemini CLI when placed under `~/.agents/skills/`;
  Claude Code reads its own copy under `~/.claude/skills/`.
- `hooks/global-rule.snippet.md` — a short (~70-word) always-loaded
  summary of the same 5 rules, for tools that don't reliably self-invoke
  skills. Installed into each tool's global instructions file
  (`~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`,
  `~/.copilot/copilot-instructions.md`).
- `install.sh` — copies/updates both onto the current machine. Safe to
  re-run; it skips a hook file if the marker is already there instead of
  duplicating it.

## Install for yourself (every project on this machine)

```bash
git clone https://github.com/vannt-dev/token-efficient-work.git
cd token-efficient-work
bash install.sh
```

Writes into your user dotfiles (`~/.claude`, `~/.agents`, `~/.codex`,
`~/.gemini`, `~/.copilot`) — applies everywhere you use these tools,
nothing to commit.

## Install into a project (share it with your team)

No clone needed — run this from the project's root directory:

```bash
curl -fsSL https://raw.githubusercontent.com/vannt-dev/token-efficient-work/master/install-project.sh | bash
```

This writes `.claude/skills/token-efficient-work/`,
`.agents/skills/token-efficient-work/`, and prepends the 5-rule summary
into `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and
`.github/copilot-instructions.md` (only the ones that make sense for
your project; existing content in those files is preserved, not
overwritten). Review the diff, then commit — anyone who clones the
project afterward gets the rule automatically, no install step for them.

## Updating the rule

Edit `skills/token-efficient-work/SKILL.md` (the source of truth) and,
if the 5-point summary changed, `hooks/global-rule.snippet.md` too. Then
re-run `install.sh` on each machine (or `git pull && bash install.sh`).
