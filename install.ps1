# Installs the token-efficient-work skill for the current user on this
# machine (PowerShell version of install.sh, for native Windows without
# Git Bash/WSL). Safe to re-run: re-running updates an existing rule block in place.
# -Check writes nothing: it reports each target as current, outdated or missing, and exits 0
# only when all are current, i.e. when a re-run would change nothing.
param([string]$UserHome = $HOME, [switch]$Check)
$ErrorActionPreference = "Stop"
$Dir = $PSScriptRoot
$Marker = "Token-efficient work (global rule"
$EndMarker = "<!-- /token-efficient-work -->"

$script:Status = 0

# -Check: print a target's state; anything but "current" makes the run exit 1.
function Write-State([string]$State, [string]$Path) {
    Write-Host "$State -> $Path"
    if ($State -ne "current") { $script:Status = 1 }
}

# Compare a file with the text an install would write: missing, current or outdated.
function Test-Text([string]$Path, [string]$Text) {
    if (-not (Test-Path $Path)) { Write-State "missing" $Path }
    elseif ([System.IO.File]::ReadAllText($Path) -ceq $Text) { Write-State "current" $Path }
    else { Write-State "outdated" $Path }
}

function Install-Skill([string]$Target) {
    $Source = Join-Path $Dir "skills\token-efficient-work\SKILL.md"
    if ($Check) {
        $Copy = Join-Path $Target "SKILL.md"
        if (-not (Test-Path $Copy)) { Write-State "missing" $Copy }
        elseif ((Get-FileHash $Copy).Hash -eq (Get-FileHash $Source).Hash) { Write-State "current" $Copy }
        else { Write-State "outdated" $Copy }
        return
    }
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    Copy-Item -Path $Source -Destination (Join-Path $Target "SKILL.md") -Force
    Write-Host "skill -> $Target\SKILL.md"
}

function Write-Utf8([string]$Path, [string]$Text) {
    # No BOM and no extra trailing newline, so re-running leaves an up-to-date file byte-identical.
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

# Return $Existing with its rule block replaced by $Snippet (block bounds: see Add-Hook).
function Get-UpdatedText([string]$Existing, [string]$Snippet) {
    $Heading = "(?m)^[^\r\n]*" + [regex]::Escape($Marker) + "[^\r\n]*\r?\n"
    $Pattern = if ($Existing.Contains($EndMarker)) { $Heading + "(?s:.*?)" + [regex]::Escape($EndMarker) + "[^\r\n]*(\r?\n)?" } else { $Heading + "(?:[^\r\n]+(\r?\n|$))*" }
    ([regex]$Pattern).Replace($Existing, [System.Text.RegularExpressions.MatchEvaluator] { $Snippet }, 1)
}

# Insert the rule block, or replace an existing one in place so re-running upgrades it.
# A block runs from the heading line to the end marker; installs from v0.1.0 have no end
# marker, so their block ends at the first blank line (v0.1.0 always wrote one after it).
function Add-Hook([string]$Target) {
    $Snippet = [System.IO.File]::ReadAllText((Join-Path $Dir "hooks\global-rule.snippet.md"))
    if ($Check) {
        if (-not (Test-Path $Target) -or -not [System.IO.File]::ReadAllText($Target).Contains($Marker)) {
            Write-State "missing" $Target
        } else {
            Test-Text $Target (Get-UpdatedText ([System.IO.File]::ReadAllText($Target)) $Snippet)
        }
        return
    }
    $ParentDir = Split-Path -Parent $Target
    if ($ParentDir -and -not (Test-Path $ParentDir)) { New-Item -ItemType Directory -Force -Path $ParentDir | Out-Null }
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
    $Updated = Get-UpdatedText $Existing $Snippet
    if ($Updated -ceq $Existing) {
        Write-Host "hook already up to date -> $Target"
    } else {
        Write-Utf8 $Target $Updated
        Write-Host "hook updated -> $Target"
    }
}

Install-Skill (Join-Path $UserHome ".agents\skills\token-efficient-work")
Install-Skill (Join-Path $UserHome ".claude\skills\token-efficient-work")

Add-Hook (Join-Path $UserHome ".codex\AGENTS.md")
Add-Hook (Join-Path $UserHome ".gemini\GEMINI.md")
Add-Hook (Join-Path $UserHome ".copilot\copilot-instructions.md")

if ($Check) {
    if ($script:Status -eq 0) {
        Write-Host "All installed and current."
    } else {
        Write-Host "Not all installed and current; run without -Check to install or update."
    }
    exit $script:Status
}
Write-Host "Done."
