#!/usr/bin/env bash
# Installs the token-efficient-work skill for the current user on this machine.
# Safe to re-run: re-running updates an existing rule block in place.
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$DIR"
MARKER="Token-efficient work (global rule"
END_MARKER="<!-- /token-efficient-work -->"

install_skill() {
  mkdir -p "$1"
  cp "$DIR/skills/token-efficient-work/SKILL.md" "$1/SKILL.md"
  echo "skill -> $1/SKILL.md"
}

# Insert the rule block, or replace an existing one in place so re-running upgrades it.
# A block runs from the heading line to END_MARKER; installs from v0.1.0 have no END_MARKER,
# so their block ends at the first blank line (v0.1.0 always wrote a blank line after it).
add_hook() {
  local target="$1" snippet="$SRC_DIR/hooks/global-rule.snippet.md"
  mkdir -p "$(dirname "$target")"
  if [ ! -f "$target" ]; then
    cp "$snippet" "$target"
    echo "hook -> $target"
  elif ! grep -qF "$MARKER" "$target"; then
    cat "$snippet" <(echo) "$target" > "$target.tmp" && mv "$target.tmp" "$target"
    echo "hook -> $target"
  else
    awk -v BINMODE=3 -v marker="$MARKER" -v end="$END_MARKER" -v snip="$snippet" '
      BEGIN { while ((getline line < snip) > 0) block = block line "\n" }
      !done && index($0, marker) > 0 { printf "%s", block; skipping = 1; done = 1; next }
      skipping && index($0, end) > 0 { skipping = 0; next }
      skipping && /^\r?$/ { skipping = 0 }
      skipping { next }
      { print }
    ' "$target" > "$target.tmp"
    if cmp -s "$target.tmp" "$target"; then
      rm -f "$target.tmp"
      echo "hook already up to date -> $target"
    else
      mv "$target.tmp" "$target"
      echo "hook updated -> $target"
    fi
  fi
}

# Cross-runtime skill (Codex, Copilot CLI, Gemini CLI native discovery)
install_skill "$HOME/.agents/skills/token-efficient-work"
# Claude Code personal skill
install_skill "$HOME/.claude/skills/token-efficient-work"

# Always-loaded global instructions per tool, so the rule applies even without skill discovery
add_hook "$HOME/.codex/AGENTS.md"
add_hook "$HOME/.gemini/GEMINI.md"
add_hook "$HOME/.copilot/copilot-instructions.md"

echo "Done."
