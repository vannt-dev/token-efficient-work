#!/usr/bin/env bash
# Removes what install.sh wrote for the current user: the two skill copies and the marked rule
# block in each tool's global instructions file. Text outside the block is left untouched.
# Safe to re-run.
set -e
MARKER="Token-efficient work (global rule"
END_MARKER="<!-- /token-efficient-work -->"

remove_skill() {
  local dir="$1"
  if [ -f "$dir/SKILL.md" ]; then
    rm -f "$dir/SKILL.md"
    rmdir "$dir" 2>/dev/null || true
    echo "skill removed -> $dir"
  fi
}

# Delete the block the same way install.sh finds it: from the heading line to END_MARKER, or to
# the first blank line for v0.1.0 blocks that have no end marker. The blank line install.sh adds
# after the block when it prepends to existing text goes too. A file left empty is deleted.
remove_hook() {
  local target="$1"
  if [ ! -f "$target" ] || ! grep -qF "$MARKER" "$target"; then return 0; fi
  awk -v BINMODE=3 -v marker="$MARKER" -v end="$END_MARKER" '
    !done && index($0, marker) > 0 { skipping = 1; done = 1; next }
    skipping && index($0, end) > 0 { skipping = 0; drop_blank = 1; next }
    skipping && /^\r?$/ { skipping = 0; next }
    skipping { next }
    drop_blank { drop_blank = 0; if ($0 ~ /^\r?$/) next }
    { print }
  ' "$target" >"$target.tmp"
  if [ -s "$target.tmp" ]; then
    mv "$target.tmp" "$target"
    echo "hook removed -> $target"
  else
    rm -f "$target.tmp" "$target"
    echo "hook removed, empty file deleted -> $target"
  fi
}

remove_skill "$HOME/.agents/skills/token-efficient-work"
remove_skill "$HOME/.claude/skills/token-efficient-work"

remove_hook "$HOME/.codex/AGENTS.md"
remove_hook "$HOME/.gemini/GEMINI.md"
remove_hook "$HOME/.copilot/copilot-instructions.md"

echo "Done."
