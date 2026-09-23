# Installs the token-efficient-work skill for the current user on this
# machine (PowerShell version of install.sh, for native Windows without
# Git Bash/WSL). Safe to re-run.
$ErrorActionPreference = "Stop"
$Dir = $PSScriptRoot
$Marker = "Token-efficient work (global rule"

function Install-Skill([string]$Target) {
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    Copy-Item -Path (Join-Path $Dir "skills\token-efficient-work\SKILL.md") -Destination (Join-Path $Target "SKILL.md") -Force
    Write-Host "skill -> $Target\SKILL.md"
}

function Add-Hook([string]$Target) {
    $ParentDir = Split-Path -Parent $Target
    if ($ParentDir -and -not (Test-Path $ParentDir)) { New-Item -ItemType Directory -Force -Path $ParentDir | Out-Null }
    if ((Test-Path $Target) -and (Select-String -Path $Target -Pattern $Marker -SimpleMatch -Quiet)) {
        Write-Host "hook already present, skipped -> $Target"
        return
    }
    $Snippet = Get-Content (Join-Path $Dir "hooks\global-rule.snippet.md") -Raw
    if (Test-Path $Target) {
        $Existing = Get-Content $Target -Raw
        Set-Content -Path $Target -Value ($Snippet + "`n" + $Existing) -Encoding utf8
    } else {
        Set-Content -Path $Target -Value $Snippet -Encoding utf8
    }
    Write-Host "hook -> $Target"
}

Install-Skill (Join-Path $HOME ".agents\skills\token-efficient-work")
Install-Skill (Join-Path $HOME ".claude\skills\token-efficient-work")

Add-Hook (Join-Path $HOME ".codex\AGENTS.md")
Add-Hook (Join-Path $HOME ".gemini\GEMINI.md")
Add-Hook (Join-Path $HOME ".copilot\copilot-instructions.md")

Write-Host "Done."
