#!/usr/bin/env bash
# Installs token-efficient-work into a PROJECT (meant to be committed and
# shared with a team), as opposed to install.sh which installs for the
# current user only.
#
# Usage (from inside a local clone of this repo):
#   bash install-project.sh [target-dir]        # default target: cwd
#
# Usage (no clone needed, straight from GitHub):
#   curl -fsSL https://raw.githubusercontent.com/vannt-dev/token-efficient-work/master/install-project.sh | bash
#
# Safe to re-run: skips a hook file if the marker is already present.
set -e
REPO_RAW="https://raw.githubusercontent.com/vannt-dev/token-efficient-work/master"
TARGET="${1:-$(pwd)}"
MARKER="Token-efficient work (global rule"

TMP=""
cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; }
trap cleanup EXIT

SELF="${BASH_SOURCE[0]:-}"
if [ -n "$SELF" ] && [ -f "$(dirname "$SELF")/skills/token-efficient-work/SKILL.md" ]; then
  SRC_DIR="$(cd "$(dirname "$SELF")" && pwd)"
else
  TMP="$(mktemp -d)"
  mkdir -p "$TMP/skills/token-efficient-work" "$TMP/hooks"
  curl -fsSL "$REPO_RAW/skills/token-efficient-work/SKILL.md" -o "$TMP/skills/token-efficient-work/SKILL.md"
  curl -fsSL "$REPO_RAW/hooks/global-rule.snippet.md" -o "$TMP/hooks/global-rule.snippet.md"
  SRC_DIR="$TMP"
fi

install_skill() {
  mkdir -p "$1"
  cp "$SRC_DIR/skills/token-efficient-work/SKILL.md" "$1/SKILL.md"
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
    cat "$SRC_DIR/hooks/global-rule.snippet.md" <(echo) "$target" > "$target.tmp" && mv "$target.tmp" "$target"
  else
    cp "$SRC_DIR/hooks/global-rule.snippet.md" "$target"
  fi
  echo "hook -> $target"
}

# Project-scoped skill dirs (Claude Code + cross-runtime spec, best effort for the latter)
install_skill "$TARGET/.claude/skills/token-efficient-work"
install_skill "$TARGET/.agents/skills/token-efficient-work"

# Project-root always-loaded instruction files, one per tool convention
add_hook "$TARGET/AGENTS.md"
add_hook "$TARGET/CLAUDE.md"
add_hook "$TARGET/GEMINI.md"
add_hook "$TARGET/.github/copilot-instructions.md"

echo "Done. Review the diff and commit these files so your team gets this automatically."
