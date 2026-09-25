# Installs the token-efficient-work skill for the current user on this
# machine (PowerShell version of install.sh, for native Windows without
# Git Bash/WSL). Safe to re-run: re-running updates an existing rule block in place.
$ErrorActionPreference = "Stop"
$Dir = $PSScriptRoot
$Marker = "Token-efficient work (global rule"
$EndMarker = "<!-- /token-efficient-work -->"

function Install-Skill([string]$Target) {
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    Copy-Item -Path (Join-Path $Dir "skills\token-efficient-work\SKILL.md") -Destination (Join-Path $Target "SKILL.md") -Force
    Write-Host "skill -> $Target\SKILL.md"
}

function Write-Utf8([string]$Path, [string]$Text) {
    # No BOM and no extra trailing newline, so re-running leaves an up-to-date file byte-identical.
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

# Insert the rule block, or replace an existing one in place so re-running upgrades it.
# A block runs from the heading line to the end marker; installs from v0.1.0 have no end
# marker, so their block ends at the first blank line (v0.1.0 always wrote one after it).
function Add-Hook([string]$Target) {
    $ParentDir = Split-Path -Parent $Target
    if ($ParentDir -and -not (Test-Path $ParentDir)) { New-Item -ItemType Directory -Force -Path $ParentDir | Out-Null }
    $Snippet = [System.IO.File]::ReadAllText((Join-Path $Dir "hooks\global-rule.snippet.md"))
    if (-not (Test-Path $Target)) {
        Write-Utf8 $Target $Snippet
        Write-Host "hook -> $Target"
        return
    }
    $Existing = [System.IO.File]::ReadAllText($Target)
    if (-not $Existing.Contains($Marker)) {
        Write-Utf8 $Target ($Snippet + "`n" + $Existing)
        Write-Host "hook -> $Target"
        return
    }
    $Heading = "(?m)^[^\r\n]*" + [regex]::Escape($Marker) + "[^\r\n]*\r?\n"
    $Pattern = if ($Existing.Contains($EndMarker)) { $Heading + "(?s:.*?)" + [regex]::Escape($EndMarker) + "[^\r\n]*(\r?\n)?" } else { $Heading + "(?:[^\r\n]+(\r?\n|$))*" }
    $Updated = ([regex]$Pattern).Replace($Existing, [System.Text.RegularExpressions.MatchEvaluator] { param($Match) $Snippet }, 1)
    if ($Updated -ceq $Existing) {
        Write-Host "hook already up to date -> $Target"
    } else {
        Write-Utf8 $Target $Updated
        Write-Host "hook updated -> $Target"
    }
}

Install-Skill (Join-Path $HOME ".agents\skills\token-efficient-work")
Install-Skill (Join-Path $HOME ".claude\skills\token-efficient-work")

Add-Hook (Join-Path $HOME ".codex\AGENTS.md")
Add-Hook (Join-Path $HOME ".gemini\GEMINI.md")
Add-Hook (Join-Path $HOME ".copilot\copilot-instructions.md")

Write-Host "Done."
