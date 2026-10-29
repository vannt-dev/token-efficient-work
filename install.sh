#!/usr/bin/env bash
# Installs the token-efficient-work skill for the current user on this machine.
# Safe to re-run: re-running updates an existing rule block in place.
# --check writes nothing: it reports each target as current, outdated or missing, and exits 0
# only when all are current, i.e. when a re-run would change nothing.
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$DIR"
MARKER="Token-efficient work (global rule"
END_MARKER="<!-- /token-efficient-work -->"
CHECK=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    *)
      echo "unknown option: $arg (usage: install.sh [--check])" >&2
      exit 2
      ;;
  esac
done
STATUS=0

# --check: print a target's state; anything but "current" makes the run exit 1.
report() {
  echo "$1 -> $2"
  [ "$1" = "current" ] || STATUS=1
}

install_skill() {
  if [ "$CHECK" = 1 ]; then
    if [ ! -f "$1/SKILL.md" ]; then
      report missing "$1/SKILL.md"
    elif cmp -s "$SRC_DIR/skills/token-efficient-work/SKILL.md" "$1/SKILL.md"; then
      report current "$1/SKILL.md"
    else
      report outdated "$1/SKILL.md"
    fi
    return 0
  fi
  mkdir -p "$1"
  cp "$SRC_DIR/skills/token-efficient-work/SKILL.md" "$1/SKILL.md"
  echo "skill -> $1/SKILL.md"
}

# Insert the rule block, or replace an existing one in place so re-running upgrades it.
# A block runs from the heading line to END_MARKER; installs from v0.1.0 have no END_MARKER,
# so their block ends at the first blank line (v0.1.0 always wrote a blank line after it).
replace_block() {
  awk -v BINMODE=3 -v marker="$MARKER" -v end="$END_MARKER" -v snip="$SRC_DIR/hooks/global-rule.snippet.md" '
    BEGIN { while ((getline line < snip) > 0) block = block line "\n" }
    !done && index($0, marker) > 0 { printf "%s", block; skipping = 1; done = 1; next }
    skipping && index($0, end) > 0 { skipping = 0; next }
    skipping && /^\r?$/ { skipping = 0 }
    skipping { next }
    { print }
  ' "$1"
}

add_hook() {
  local target="$1" snippet="$SRC_DIR/hooks/global-rule.snippet.md"
  if [ "$CHECK" = 1 ]; then
    if [ ! -f "$target" ] || ! grep -qF "$MARKER" "$target"; then
      report missing "$target"
    elif replace_block "$target" | cmp -s - "$target"; then
      report current "$target"
    else
      report outdated "$target"
    fi
    return 0
  fi
  mkdir -p "$(dirname "$target")"
  if [ ! -f "$target" ]; then
    cp "$snippet" "$target"
    echo "hook -> $target"
  elif ! grep -qF "$MARKER" "$target"; then
    cat "$snippet" <(echo) "$target" >"$target.tmp" && mv "$target.tmp" "$target"
    echo "hook -> $target"
  else
    replace_block "$target" >"$target.tmp"
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

if [ "$CHECK" = 1 ]; then
  if [ "$STATUS" = 0 ]; then
    echo "All installed and current."
  else
    echo "Not all installed and current; run without --check to install or update."
  fi
  exit "$STATUS"
fi
echo "Done."
