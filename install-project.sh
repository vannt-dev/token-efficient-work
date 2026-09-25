#!/usr/bin/env bash
# Installs token-efficient-work into a PROJECT (meant to be committed and
# shared with a team), as opposed to install.sh which installs for the
# current user only.
#
# Usage (from inside a local clone of this repo):
#   bash install-project.sh [target-dir]        # default target: cwd
#
# Usage (no clone needed, straight from GitHub):
#   curl -fsSL https://raw.githubusercontent.com/vannt-dev/token-efficient-work/v0.2.0/install-project.sh | bash
#
# Safe to re-run: re-running updates an existing rule block in place and keeps
# everything else in each file. Remote installs fetch files from the release tag
# matching this script (override with TEW_REF=<tag-or-branch>).
set -e
TEW_VERSION="0.2.0"
REPO_RAW="https://raw.githubusercontent.com/vannt-dev/token-efficient-work/${TEW_REF:-v$TEW_VERSION}"
TARGET="${1:-$(pwd)}"
MARKER="Token-efficient work (global rule"
END_MARKER="<!-- /token-efficient-work -->"

TMP=""
cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; return 0; }
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

# Project-scoped skill dirs (Claude Code + cross-runtime spec, best effort for the latter)
install_skill "$TARGET/.claude/skills/token-efficient-work"
install_skill "$TARGET/.agents/skills/token-efficient-work"

# Project-root always-loaded instruction files, one per tool convention
add_hook "$TARGET/AGENTS.md"
add_hook "$TARGET/CLAUDE.md"
add_hook "$TARGET/GEMINI.md"
add_hook "$TARGET/.github/copilot-instructions.md"

# Cursor: project rule, must be .mdc with frontmatter or Cursor ignores it.
# The file belongs to this tool, so it is always regenerated from the current snippet.
CURSOR_RULE="$TARGET/.cursor/rules/token-efficient-work.mdc"
mkdir -p "$(dirname "$CURSOR_RULE")"
{ printf -- '---\ndescription: Token-efficient work discipline\nalwaysApply: true\n---\n\n'; cat "$SRC_DIR/hooks/global-rule.snippet.md"; } > "$CURSOR_RULE"
echo "hook -> $CURSOR_RULE"

# Aider: reads CONVENTIONS.md only if .aider.conf.yml's `read:` lists it
add_hook "$TARGET/CONVENTIONS.md"
AIDER_CONF="$TARGET/.aider.conf.yml"
if [ -f "$AIDER_CONF" ] && grep -q "CONVENTIONS.md" "$AIDER_CONF"; then
  echo "aider conf already references CONVENTIONS.md, skipped -> $AIDER_CONF"
elif [ -f "$AIDER_CONF" ] && grep -q "^read:" "$AIDER_CONF"; then
  echo "$AIDER_CONF already has a 'read:' key — add CONVENTIONS.md to it by hand (skipped to avoid a broken duplicate key)"
elif [ -f "$AIDER_CONF" ]; then
  printf '\nread:\n  - CONVENTIONS.md\n' >> "$AIDER_CONF"
  echo "aider conf -> $AIDER_CONF (appended read: CONVENTIONS.md)"
else
  printf 'read:\n  - CONVENTIONS.md\n' > "$AIDER_CONF"
  echo "aider conf -> $AIDER_CONF"
fi

echo "Done. Review the diff and commit these files so your team gets this automatically."
