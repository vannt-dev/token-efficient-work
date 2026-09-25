# Installs token-efficient-work into a PROJECT (meant to be committed and
# shared with a team). PowerShell version of install-project.sh, for
# native Windows without Git Bash/WSL.
#
# Usage (from inside a local clone of this repo):
#   .\install-project.ps1 -TargetDir .
#
# Usage (no clone needed, straight from GitHub):
#   iwr https://raw.githubusercontent.com/vannt-dev/token-efficient-work/v0.2.0/install-project.ps1 -UseBasicParsing | iex
#
# Safe to re-run: re-running updates an existing rule block in place and keeps
# everything else in each file. Remote installs fetch files from the release tag
# matching this script (override with $env:TEW_REF = "<tag-or-branch>").
param(
    [string]$TargetDir = (Get-Location).Path
)
$ErrorActionPreference = "Stop"
$TewVersion = "0.2.0"
$Ref = if ($env:TEW_REF) { $env:TEW_REF } else { "v$TewVersion" }
$RepoRaw = "https://raw.githubusercontent.com/vannt-dev/token-efficient-work/$Ref"
$Marker = "Token-efficient work (global rule"
$EndMarker = "<!-- /token-efficient-work -->"

$LocalSkill = if ($PSScriptRoot) { Join-Path $PSScriptRoot "skills\token-efficient-work\SKILL.md" } else { $null }

if ($LocalSkill -and (Test-Path $LocalSkill)) {
    $SrcDir = $PSScriptRoot
} else {
    $SrcDir = Join-Path ([System.IO.Path]::GetTempPath()) ("tew-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Force -Path (Join-Path $SrcDir "skills\token-efficient-work") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $SrcDir "hooks") | Out-Null
    Invoke-WebRequest -Uri "$RepoRaw/skills/token-efficient-work/SKILL.md" -OutFile (Join-Path $SrcDir "skills\token-efficient-work\SKILL.md") -UseBasicParsing
    Invoke-WebRequest -Uri "$RepoRaw/hooks/global-rule.snippet.md" -OutFile (Join-Path $SrcDir "hooks\global-rule.snippet.md") -UseBasicParsing
}

function Install-Skill([string]$Target) {
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    Copy-Item -Path (Join-Path $SrcDir "skills\token-efficient-work\SKILL.md") -Destination (Join-Path $Target "SKILL.md") -Force
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
    $Snippet = [System.IO.File]::ReadAllText((Join-Path $SrcDir "hooks\global-rule.snippet.md"))
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

Install-Skill (Join-Path $TargetDir ".claude\skills\token-efficient-work")
Install-Skill (Join-Path $TargetDir ".agents\skills\token-efficient-work")

Add-Hook (Join-Path $TargetDir "AGENTS.md")
Add-Hook (Join-Path $TargetDir "CLAUDE.md")
Add-Hook (Join-Path $TargetDir "GEMINI.md")
Add-Hook (Join-Path $TargetDir ".github\copilot-instructions.md")

# Cursor: project rule, must be .mdc with frontmatter or Cursor ignores it.
# The file belongs to this tool, so it is always regenerated from the current snippet.
$CursorRule = Join-Path $TargetDir ".cursor\rules\token-efficient-work.mdc"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CursorRule) | Out-Null
$FrontMatter = "---`ndescription: Token-efficient work discipline`nalwaysApply: true`n---`n`n"
Write-Utf8 $CursorRule ($FrontMatter + [System.IO.File]::ReadAllText((Join-Path $SrcDir "hooks\global-rule.snippet.md")))
Write-Host "hook -> $CursorRule"

# Aider: reads CONVENTIONS.md only if .aider.conf.yml's `read:` lists it
Add-Hook (Join-Path $TargetDir "CONVENTIONS.md")
$AiderConf = Join-Path $TargetDir ".aider.conf.yml"
if ((Test-Path $AiderConf) -and (Select-String -Path $AiderConf -Pattern "CONVENTIONS.md" -SimpleMatch -Quiet)) {
    Write-Host "aider conf already references CONVENTIONS.md, skipped -> $AiderConf"
} elseif ((Test-Path $AiderConf) -and (Select-String -Path $AiderConf -Pattern "^read:" -Quiet)) {
    Write-Host "$AiderConf already has a 'read:' key -- add CONVENTIONS.md to it by hand (skipped to avoid a broken duplicate key)"
} elseif (Test-Path $AiderConf) {
    Add-Content -Path $AiderConf -Value "`nread:`n  - CONVENTIONS.md" -Encoding utf8
    Write-Host "aider conf -> $AiderConf (appended read: CONVENTIONS.md)"
} else {
    Set-Content -Path $AiderConf -Value "read:`n  - CONVENTIONS.md" -Encoding utf8
    Write-Host "aider conf -> $AiderConf"
}

Write-Host "Done. Review the diff and commit these files so your team gets this automatically."
