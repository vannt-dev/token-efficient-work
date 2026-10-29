# Removes what install.ps1 wrote for the current user (PowerShell version of uninstall.sh): the
# two skill copies and the marked rule block in each tool's global instructions file. Text outside
# the block is left untouched. Safe to re-run.
param([string]$UserHome = $HOME)
$ErrorActionPreference = "Stop"
# A misspelt parameter (-ProjectRoot, -Chek) lands in $args instead of failing; stop before
# writing anything, with exit 2 like the bash scripts. $args is empty under iwr | iex.
if ($args.Count) {
    [Console]::Error.WriteLine("unknown parameter: $args (usage: uninstall.ps1 [-UserHome DIR])")
    exit 2
}
$Marker = "Token-efficient work (global rule"
$EndMarker = "<!-- /token-efficient-work -->"

function Uninstall-Skill([string]$Dir) {
    $Skill = Join-Path $Dir "SKILL.md"
    if (-not (Test-Path -LiteralPath $Skill)) { return }
    Remove-Item -LiteralPath $Skill -Force
    if (-not (Get-ChildItem -LiteralPath $Dir -Force)) { Remove-Item -LiteralPath $Dir -Force }
    Write-Host "skill removed -> $Dir"
}

# Delete the block the same way install.ps1 finds it: from the heading line to the end marker, or
# to the first blank line for v0.1.0 blocks that have no end marker. The blank line the installer
# adds after the block when it prepends to existing text goes too. A file left empty is deleted.
function Uninstall-Hook([string]$Target) {
    if (-not (Test-Path -LiteralPath $Target)) { return }
    $Existing = [System.IO.File]::ReadAllText($Target)
    if (-not $Existing.Contains($Marker)) { return }
    $Heading = "(?m)^[^\r\n]*" + [regex]::Escape($Marker) + "[^\r\n]*\r?\n"
    $Pattern = if ($Existing.Contains($EndMarker)) { $Heading + "(?s:.*?)" + [regex]::Escape($EndMarker) + "[^\r\n]*(\r?\n)?(\r?\n)?" } else { $Heading + "(?:[^\r\n]+(\r?\n|$))*(\r?\n)?" }
    $Updated = ([regex]$Pattern).Replace($Existing, "", 1)
    if ($Updated.Length -eq 0) {
        Remove-Item -LiteralPath $Target -Force
        Write-Host "hook removed, empty file deleted -> $Target"
    } else {
        # No BOM, matching install.ps1.
        [System.IO.File]::WriteAllText($Target, $Updated, (New-Object System.Text.UTF8Encoding $false))
        Write-Host "hook removed -> $Target"
    }
}

Uninstall-Skill (Join-Path $UserHome ".agents\skills\token-efficient-work")
Uninstall-Skill (Join-Path $UserHome ".claude\skills\token-efficient-work")

Uninstall-Hook (Join-Path $UserHome ".codex\AGENTS.md")
Uninstall-Hook (Join-Path $UserHome ".gemini\GEMINI.md")
Uninstall-Hook (Join-Path $UserHome ".copilot\copilot-instructions.md")

Write-Host "Done."
