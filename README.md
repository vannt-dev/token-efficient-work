# token-efficient-work

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![test-install](https://github.com/vannt-dev/token-efficient-work/actions/workflows/test-install.yml/badge.svg)](https://github.com/vannt-dev/token-efficient-work/actions/workflows/test-install.yml)
![Compatible with](https://img.shields.io/badge/compatible-Claude%20Code%20%7C%20Codex%20%7C%20Copilot%20CLI%20%7C%20Gemini%20CLI%20%7C%20Cursor%20%7C%20Aider-blue)

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
- `install.sh` / `install.ps1` — copies/updates both onto the current
  machine (bash and PowerShell versions). Safe to re-run; skips a hook
  file if the marker is already there instead of duplicating it.
- `install-project.sh` / `install-project.ps1` — same idea, scoped to a
  single project so it can be committed and shared with a team.
- `.github/workflows/test-install.yml` — CI: runs the project installer
  twice (bash on Linux, PowerShell on Windows) on every push/PR and
  fails if a file is missing or a hook gets duplicated on re-run.

## Install for yourself (every project on this machine)

```bash
git clone https://github.com/vannt-dev/token-efficient-work.git
cd token-efficient-work
bash install.sh
```

On native Windows without Git Bash/WSL, use `install.ps1` instead:

```powershell
git clone https://github.com/vannt-dev/token-efficient-work.git
cd token-efficient-work
.\install.ps1
```

Writes into your user dotfiles (`~/.claude`, `~/.agents`, `~/.codex`,
`~/.gemini`, `~/.copilot`) — applies everywhere you use these tools,
nothing to commit.

## Install into a project (share it with your team)

No clone needed — run this from the project's root directory:

```bash
curl -fsSL https://raw.githubusercontent.com/vannt-dev/token-efficient-work/master/install-project.sh | bash
```

On native Windows without Git Bash/WSL, use PowerShell instead:

```powershell
iwr https://raw.githubusercontent.com/vannt-dev/token-efficient-work/master/install-project.ps1 -UseBasicParsing | iex
```

Either way, this writes `.claude/skills/token-efficient-work/`,
`.agents/skills/token-efficient-work/`, prepends the 5-rule summary
into `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and
`.github/copilot-instructions.md`, adds a Cursor rule at
`.cursor/rules/token-efficient-work.mdc`, and sets up Aider's
`CONVENTIONS.md` (wiring it into `.aider.conf.yml`'s `read:` list if
that file doesn't already have one — existing content anywhere is
preserved, never overwritten). Review the diff, then commit — anyone
who clones the project afterward gets the rule automatically, no
install step for them.

## Does this actually save tokens?

A real paired Codex CLI run (with vs. without the skill, same task) is
in [EVIDENCE.md](EVIDENCE.md): 2 tool calls vs. 4, ~30% fewer input
tokens — the no-skill run read whole files it had already located and
added an unrequested re-verification pass, exactly what the skill's
rules target. Single trial, not a statistical study; see the file for
caveats.

## Updating the rule

Edit `skills/token-efficient-work/SKILL.md` (the source of truth) and,
if the 5-point summary changed, `hooks/global-rule.snippet.md` too. Then
re-run `install.sh` on each machine (or `git pull && bash install.sh`).
