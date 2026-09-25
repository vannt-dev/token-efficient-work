# token-efficient-work

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/vannt-dev/token-efficient-work)](https://github.com/vannt-dev/token-efficient-work/releases)
[![test-install](https://github.com/vannt-dev/token-efficient-work/actions/workflows/test-install.yml/badge.svg)](https://github.com/vannt-dev/token-efficient-work/actions/workflows/test-install.yml)
![Compatible with](https://img.shields.io/badge/compatible-Claude%20Code%20%7C%20Codex%20%7C%20Copilot%20CLI%20%7C%20Gemini%20CLI%20%7C%20Cursor%20%7C%20Aider-blue)

A skill + global instruction hooks that stop coding agents (Claude Code,
Codex, Copilot CLI, Gemini CLI, Cursor, Aider) from burning tokens on
redundant work: re-reading a file after a successful edit, reading a
whole file for a two-line change, adding unrequested "just to be safe"
checks, or writing over-long explanations.

**[→ Landing page](https://vannt-dev.github.io/token-efficient-work/)**
— the pitch, a real before/after transcript, and the install command.

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
  machine (bash and PowerShell versions). Safe to re-run: it replaces
  its own rule block in place (upgrading blocks written by older
  versions) and leaves the rest of each file untouched.
- `install-project.sh` / `install-project.ps1` — same idea, scoped to a
  single project so it can be committed and shared with a team.
- `.github/workflows/test-install.yml` — CI: runs the project installer
  twice (bash on Linux, PowerShell on Windows) on every push/PR and
  fails if a file is missing, a hook gets duplicated on re-run, an old
  or stale rule block isn't upgraded, or a re-run changes any file.
- `docs/index.html` — the landing page, served via GitHub Pages.

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
curl -fsSL https://raw.githubusercontent.com/vannt-dev/token-efficient-work/v0.2.0/install-project.sh | bash
```

On native Windows without Git Bash/WSL, use PowerShell instead:

```powershell
iwr https://raw.githubusercontent.com/vannt-dev/token-efficient-work/v0.2.0/install-project.ps1 -UseBasicParsing | iex
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

To upgrade later, run the command from a newer release. The installer
replaces its own rule block in place — including blocks written by
v0.1.0 — and regenerates the Cursor rule; nothing else changes, and a
re-run on an up-to-date project leaves every file byte-identical. The
remote installer fetches the skill and snippet from the release tag it
belongs to; set `TEW_REF` (e.g. `TEW_REF=master`) to use another tag
or branch.

## Does this actually save tokens?

A real paired Codex CLI run (with vs. without the skill, same task) is
in [EVIDENCE.md](EVIDENCE.md): 2 tool calls vs. 4, ~30% fewer input
tokens — the no-skill run read whole files it had already located and
added an unrequested re-verification pass, exactly what the skill's
rules target. Single trial, not a statistical study; see the file for
caveats.

## Updating the rule

Edit `skills/token-efficient-work/SKILL.md` (the source of truth) and,
if the 5-point summary changed, `hooks/global-rule.snippet.md` too — keep
its first line (the heading) and last line (the `<!-- /token-efficient-work -->`
end marker), which the installers use to find and replace the block. Then
re-run `install.sh` on each machine (or `git pull && bash install.sh`);
existing rule blocks are updated in place.

When releasing, bump the version (`TEW_VERSION` / `$TewVersion` in both
project installers and the pinned URLs in this README and
`docs/index.html`), then tag `v<version>` so the pinned URLs resolve.
