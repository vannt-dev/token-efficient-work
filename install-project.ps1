# Installs token-efficient-work into a PROJECT (meant to be committed and
# shared with a team). PowerShell version of install-project.sh, for
# native Windows without Git Bash/WSL.
#
# Usage (from inside a local clone of this repo):
#   .\install-project.ps1 -TargetDir .
#
# Usage (no clone needed, straight from GitHub):
#   iwr https://raw.githubusercontent.com/vannt-dev/token-efficient-work/master/install-project.ps1 -UseBasicParsing | iex
#
# Safe to re-run: skips a hook file if the marker is already present.
param(
    [string]$TargetDir = (Get-Location).Path
)
$ErrorActionPreference = "Stop"
$RepoRaw = "https://raw.githubusercontent.com/vannt-dev/token-efficient-work/master"
$Marker = "Token-efficient work (global rule"

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

function Add-Hook([string]$Target) {
    $ParentDir = Split-Path -Parent $Target
    if ($ParentDir -and -not (Test-Path $ParentDir)) { New-Item -ItemType Directory -Force -Path $ParentDir | Out-Null }
    if ((Test-Path $Target) -and (Select-String -Path $Target -Pattern $Marker -SimpleMatch -Quiet)) {
        Write-Host "hook already present, skipped -> $Target"
        return
    }
    $Snippet = Get-Content (Join-Path $SrcDir "hooks\global-rule.snippet.md") -Raw
    if (Test-Path $Target) {
        $Existing = Get-Content $Target -Raw
        Set-Content -Path $Target -Value ($Snippet + "`n" + $Existing) -Encoding utf8
    } else {
        Set-Content -Path $Target -Value $Snippet -Encoding utf8
    }
    Write-Host "hook -> $Target"
}

Install-Skill (Join-Path $TargetDir ".claude\skills\token-efficient-work")
Install-Skill (Join-Path $TargetDir ".agents\skills\token-efficient-work")

Add-Hook (Join-Path $TargetDir "AGENTS.md")
Add-Hook (Join-Path $TargetDir "CLAUDE.md")
Add-Hook (Join-Path $TargetDir "GEMINI.md")
Add-Hook (Join-Path $TargetDir ".github\copilot-instructions.md")

# Cursor: project rule, must be .mdc with frontmatter or Cursor ignores it
$CursorRule = Join-Path $TargetDir ".cursor\rules\token-efficient-work.mdc"
if ((Test-Path $CursorRule) -and (Select-String -Path $CursorRule -Pattern $Marker -SimpleMatch -Quiet)) {
    Write-Host "hook already present, skipped -> $CursorRule"
} else {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CursorRule) | Out-Null
    $FrontMatter = "---`ndescription: Token-efficient work discipline`nalwaysApply: true`n---`n`n"
    $Snippet = Get-Content (Join-Path $SrcDir "hooks\global-rule.snippet.md") -Raw
    Set-Content -Path $CursorRule -Value ($FrontMatter + $Snippet) -Encoding utf8
    Write-Host "hook -> $CursorRule"
}

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
