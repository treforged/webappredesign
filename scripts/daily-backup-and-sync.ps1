param()

# Entry point for the daily "Forgenta Backup Sync" Windows Scheduled Task.
# 1. Uploads any new backups/<timestamp>/ folders to Google Drive and prunes
#    local copies older than 14 days that are already confirmed uploaded.
# 2. Refreshes the graphify knowledge graph and mirrors it into the Obsidian
#    vault, so project history stays captured there even as raw local
#    backups get pruned.

# PATHS ARE DERIVED, NEVER HARDCODED. This file pointed at
# C:\Users\tvonh\Desktop\getforgenta until 2026-09-02 and had been Set-Location-ing into a
# folder that no longer existed since the 08-27 move. The task reported
# LastTaskResult 0 the whole time, so a DAILY backup silently did nothing for six
# days while looking healthy. A new absolute path would just break on the next
# move; $PSScriptRoot cannot.
if (-not $PSScriptRoot) {
    # Split-Path THROWS on an empty string, so this guard has to come first - a
    # check written after the call can never fire.
    throw "daily-backup-and-sync.ps1 must be run as a file (PSScriptRoot is empty)."
}
$RepoDir = Split-Path -Parent $PSScriptRoot
Set-Location $RepoDir

# A LINE ON EVERY RUN, INCLUDING WHEN IT DOES NOTHING AND WHEN IT FAILS.
#
# The comment above records this task doing nothing for six days while reporting
# LastTaskResult 0. It could do that because nothing here wrote down what
# happened and nothing checked either child's exit code - so "ran and worked",
# "ran and failed" and "never ran" were the same observation from outside. This
# task is WEEKLY, so that silence hides a failure for seven days.
#
# `backup-drive-sync.log` covers the python step's own internals. This log is
# about THIS wrapper: that it started, what each step returned, and its verdict.
#
# Add-Content -Encoding utf8 rather than Tee-Object: Tee-Object in Windows
# PowerShell 5.1 writes UTF-16LE with a BOM, which left two other routine logs
# on this machine unreadable to node, git bash and `cat` until 2026-09-06.
$Log = Join-Path $PSScriptRoot 'backup-sync.log'
function Say($m) {
    $line = "$(Get-Date -Format s)  $m"
    Write-Output $line
    Add-Content -Path $Log -Value $line -Encoding utf8
}

Say "run start ($RepoDir)"
$failed = @()

$out  = & python "$RepoDir\scripts\backup_drive_sync.py" 2>&1
$code = $LASTEXITCODE
if ($code -ne 0) {
    Say "FAIL backup_drive_sync.py exited $code"
    $out | Select-Object -Last 10 | ForEach-Object { Say "    $_" }
    $failed += 'backup_drive_sync.py'
} else {
    Say "OK   backup_drive_sync.py"
}

# The graph sync runs even when the backup failed. The two are independent, and
# skipping the second because the first broke would turn one failure into two
# while saying nothing about the second.
#
# $LASTEXITCODE MUST BE RESET FIRST, and this is not defensive padding - the
# first version of this file reported the graph sync as FAILED purely because
# the python step above had left $LASTEXITCODE at 2. A PowerShell script only
# sets it when it calls `exit`, and sync-graph-to-obsidian.ps1 exits explicitly
# on two early paths and falls off the end on the rest. So the reading was
# inherited, and it was wrong in BOTH directions: it would equally have reported
# a genuine failure as OK whenever the step before it succeeded.
#
# Found by breaking the python step on purpose in a COPY of this file and
# watching what the log said. A green run alone would never have shown it.
$global:LASTEXITCODE = 0
try {
    & "$RepoDir\scripts\sync-graph-to-obsidian.ps1"
    $code = $LASTEXITCODE
} catch {
    Say "FAIL sync-graph-to-obsidian.ps1 threw: $_"
    $code = 1
}
if ($code -ne 0) {
    Say "FAIL sync-graph-to-obsidian.ps1 exited $code"
    $failed += 'sync-graph-to-obsidian.ps1'
} else {
    Say "OK   sync-graph-to-obsidian.ps1"
}

# EXIT NON-ZERO WHEN A STEP FAILED. Before this the wrapper always returned 0,
# so Task Scheduler recorded success whatever happened underneath - which is
# exactly how six days of doing nothing looked healthy.
if ($failed.Count) {
    Say ("run complete - FAILED: " + ($failed -join ', '))
    exit 1
}
Say "run complete - all steps OK"
exit 0
