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
  summary of the same 5 rules, and the part that measurably saved tokens
  on Codex (see [Does this actually save tokens?](#does-this-actually-save-tokens)). Installed into each tool's global instructions file
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
- `scripts/read-report.mjs` — measures your own Claude Code sessions:
  how many reads were whole-file, how many only confirmed an edit, how
  many repeated an earlier read. See
  [Measure your own sessions](#measure-your-own-sessions).
- `uninstall.sh` / `uninstall.ps1` — removes what `install.sh` /
  `install.ps1` wrote: the two skill copies and the marked rule block in
  each global instructions file. Your own text in those files stays.
- `hooks/claude-code/guard-full-read.mjs` — an opt-in Claude Code hook
  that refuses a whole-file read of a long source file. Not installed by
  the scripts above; see [hooks/claude-code/README.md](hooks/claude-code/README.md).
- `hooks/claude-code-band/` — an opt-in Claude Code band above the
  prompt with the task's cost, tokens and repeated reads; see
  [hooks/claude-code-band/README.md](hooks/claude-code-band/README.md).
- `.claude-plugin/marketplace.json` — a Claude Code plugin marketplace
  with three plugins: the skill, and the read guard and the cost band as
  separate, optional plugins. See [Install in Claude Code](#install-in-claude-code-plugin).
- `docs/index.html` — the landing page, served via GitHub Pages.

## Install in Claude Code (plugin)

No clone and no script — inside Claude Code:

```text
/plugin marketplace add vannt-dev/token-efficient-work
/plugin install token-efficient-work@token-efficient-work
```

From a terminal, the same two steps are `claude plugin marketplace add
vannt-dev/token-efficient-work` and `claude plugin install
token-efficient-work@token-efficient-work`. On Claude Code 2.1.275 or later
one line does both:

```text
/plugin install token-efficient-work --marketplace vannt-dev/token-efficient-work
```

This plugin is the skill only; it adds no hooks. The
[read guard](hooks/claude-code/README.md) is a second plugin in the same
marketplace, and installing it turns the guard on, so add it only if you
want it:

```text
/plugin install token-efficient-work-read-guard@token-efficient-work
```

The [cost band](hooks/claude-code-band/README.md) is a third, optional
plugin: a line above the prompt with what the task costs and how many of
its file reads repeated an earlier read or followed an edit.

```text
/plugin install token-efficient-work-band@token-efficient-work
```

`/plugin uninstall <name>@token-efficient-work` removes any of them. The
plugins cover Claude Code only; for Codex, Copilot CLI, Gemini CLI, Cursor
and Aider use an installer below. If you ran `install.sh` before, Claude
Code loads both the plugin and the copy in `~/.claude/skills/`;
`uninstall.sh` removes the script's copies.

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

To undo it, run `bash uninstall.sh` (or `.\uninstall.ps1`) from the same
clone. It deletes the two skill copies and, in each instructions file, only
the rule block from its heading to the `<!-- /token-efficient-work -->` end
marker; a file the installer created that holds nothing else is deleted.

## Install into a project (share it with your team)

No clone needed — run this from the project's root directory:

<!-- x-release-please-start-version -->

```bash
curl -fsSL https://raw.githubusercontent.com/vannt-dev/token-efficient-work/v0.5.0/install-project.sh | bash
```

On native Windows without Git Bash/WSL, use PowerShell instead:

```powershell
iwr https://raw.githubusercontent.com/vannt-dev/token-efficient-work/v0.5.0/install-project.ps1 -UseBasicParsing | iex
```

<!-- x-release-please-end -->

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

It depends on the agent, and on which part you install. The measured
runs are in [EVIDENCE.md](EVIDENCE.md), with the commands to repeat them:

- **Codex CLI:** the five rules in `AGENTS.md` (what `install.sh` and
  `install-project.sh` write) used fewer tokens and fewer tool calls than
  no guidance on most of the six tasks in `evals/`, and every run was
  right. The skill on its own did not save: reading it cost about what it
  saved. One unguided run answered a question about a file without
  opening it, and got it wrong.
- **Claude Code (Opus 5.5):** no measurable saving. Even unguided, it
  searched first and read ranges on a 1,500-line file, so there was
  little to save. A trial description that made Claude Code open the
  skill every time cost more, so the shipped description was kept.

On Codex the rule block in the instructions file is the part that pays
off; the skill adds the detail behind each rule. Copilot CLI, Gemini CLI,
Cursor and Aider have not been measured.

## Measure your own sessions

Claude Code keeps a transcript of every session. With Node.js 18+ and a
clone of this repo:

```bash
node scripts/read-report.mjs --days 30
```

What it prints, here for the one made-up session under
`tests/fixtures/sample` (`--dir tests/fixtures/sample`):

```text
Read calls                                          8
  with a range                                      3
  whole-file                                        5   63% of reads, about 16.3K tokens

Whole-file reads over 400 lines                     3   about 14.8K tokens   (rule 1)
  of which source code (the guard refuses)          2   about 10.6K tokens
Reads right after a successful edit                 1   about 265 tokens   (rule 2)
Repeat whole-file reads of an unchanged file        1   about 715 tokens   (rule 4)
```

Tokens are estimated at 4 characters each from what the tool returned,
and the report cannot know what a ranged read would have cost instead,
so read it as where the cost sits, not as a saving. `--project`,
`--max-lines` and `--json` narrow or export it; `--help` lists them.

If the source-code line is large, the opt-in
[read guard](hooks/claude-code/README.md) turns rule 1 into a gate for
Claude Code.

## Updating the rule

Edit `skills/token-efficient-work/SKILL.md` (the source of truth) and,
if the 5-point summary changed, `hooks/global-rule.snippet.md` too — keep
its first line (the heading) and last line (the `<!-- /token-efficient-work -->`
end marker), which the installers use to find and replace the block. Then
re-run `install.sh` on each machine (or `git pull && bash install.sh`);
existing rule blocks are updated in place.

Releases are made by merging the release pull request that
release-please opens. It bumps the version everywhere it is written:
`TEW_VERSION` / `$TewVersion` in both project installers and the pinned
URLs in this README and `docs/index.html` (the lines marked
`x-release-please`, listed under `extra-files` in
`release-please-config.json`), then tags `v<version>` so the pinned URLs
resolve. A new place that names the version needs the same marker.
