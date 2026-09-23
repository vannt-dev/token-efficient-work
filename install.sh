#!/usr/bin/env bash
# Installs the token-efficient-work skill for the current user on this machine.
# Safe to re-run: skips a hook file if the marker is already present.
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKER="Token-efficient work (global rule"

install_skill() {
  mkdir -p "$1"
  cp "$DIR/skills/token-efficient-work/SKILL.md" "$1/SKILL.md"
  echo "skill -> $1/SKILL.md"
}

add_hook() {
  local target="$1"
  mkdir -p "$(dirname "$target")"
  if [ -f "$target" ] && grep -q "$MARKER" "$target"; then
    echo "hook already present, skipped -> $target"
    return
  fi
  if [ -f "$target" ]; then
    cat "$DIR/hooks/global-rule.snippet.md" <(echo) "$target" > "$target.tmp" && mv "$target.tmp" "$target"
  else
    cp "$DIR/hooks/global-rule.snippet.md" "$target"
  fi
  echo "hook -> $target"
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
