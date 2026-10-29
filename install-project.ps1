# Installs token-efficient-work into a PROJECT (meant to be committed and
# shared with a team). PowerShell version of install-project.sh, for
# native Windows without Git Bash/WSL.
#
# Usage (from inside a local clone of this repo):
#   .\install-project.ps1 -TargetDir .
#   .\install-project.ps1 -TargetDir . -Check   # report only, change nothing
#
# Usage (no clone needed, straight from GitHub):
# x-release-please-start-version
#   iwr https://raw.githubusercontent.com/vannt-dev/token-efficient-work/v0.7.0/install-project.ps1 -UseBasicParsing | iex
# x-release-please-end
#
# Safe to re-run: re-running updates an existing rule block in place and keeps
# everything else in each file. Remote installs fetch files from the release tag
# matching this script (override with $env:TEW_REF = "<tag-or-branch>").
# -Check writes nothing: it reports each target as current, outdated or missing, and exits 0
# only when all are current, i.e. when a re-run would change nothing.
param(
    [string]$TargetDir = (Get-Location).Path,
    [switch]$Check
)
$ErrorActionPreference = "Stop"
# A misspelt parameter (-ProjectRoot, -Chek) lands in $args instead of failing; stop before
# writing anything, with exit 2 like the bash scripts. $args is empty under iwr | iex.
if ($args.Count) {
    [Console]::Error.WriteLine("unknown parameter: $args (usage: install-project.ps1 [-TargetDir DIR] [-Check])")
    exit 2
}
$TewVersion = "0.7.0" # x-release-please-version
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
    $Source = Join-Path $SrcDir "skills\token-efficient-work\SKILL.md"
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
    $Snippet = [System.IO.File]::ReadAllText((Join-Path $SrcDir "hooks\global-rule.snippet.md"))
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

Install-Skill (Join-Path $TargetDir ".claude\skills\token-efficient-work")
Install-Skill (Join-Path $TargetDir ".agents\skills\token-efficient-work")

Add-Hook (Join-Path $TargetDir "AGENTS.md")
Add-Hook (Join-Path $TargetDir "CLAUDE.md")
Add-Hook (Join-Path $TargetDir "GEMINI.md")
Add-Hook (Join-Path $TargetDir ".github\copilot-instructions.md")

# Cursor: project rule, must be .mdc with frontmatter or Cursor ignores it.
# The file belongs to this tool, so it is always regenerated from the current snippet.
$CursorRule = Join-Path $TargetDir ".cursor\rules\token-efficient-work.mdc"
$FrontMatter = "---`ndescription: Token-efficient work discipline`nalwaysApply: true`n---`n`n"
$CursorText = $FrontMatter + [System.IO.File]::ReadAllText((Join-Path $SrcDir "hooks\global-rule.snippet.md"))
if ($Check) {
    Test-Text $CursorRule $CursorText
} else {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CursorRule) | Out-Null
    Write-Utf8 $CursorRule $CursorText
    Write-Host "hook -> $CursorRule"
}

# Aider: reads CONVENTIONS.md only if .aider.conf.yml's `read:` lists it
Add-Hook (Join-Path $TargetDir "CONVENTIONS.md")
$AiderConf = Join-Path $TargetDir ".aider.conf.yml"
if ($Check) {
    if (-not (Test-Path $AiderConf)) { Write-State "missing" $AiderConf }
    elseif (Select-String -Path $AiderConf -Pattern "CONVENTIONS.md" -SimpleMatch -Quiet) { Write-State "current" $AiderConf }
    else { Write-State "outdated" $AiderConf }
    if ($script:Status -eq 0) {
        Write-Host "All installed and current."
    } else {
        Write-Host "Not all installed and current; run without -Check to install or update."
    }
    exit $script:Status
} elseif ((Test-Path $AiderConf) -and (Select-String -Path $AiderConf -Pattern "CONVENTIONS.md" -SimpleMatch -Quiet)) {
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
