$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../src-tauri/src/terminal-startup.ps1" 3>$null

$cases = @{
    'codex' = 'codex'
    'codex resume --last' = 'codex'
    'CLAUDE.cmd --continue' = 'claude-code'
    'opencode.exe' = 'opencode'
    'agy .' = 'antigravity'
    'antigravity' = 'antigravity'
    '& "C:\Program Files\codex.exe" resume' = 'codex'
    'git status; claude' = 'claude-code'
    'Write-Output codex' = 'terminal'
    'echo "claude"' = 'terminal'
    'Write-Output "opencode.exe"' = 'terminal'
    'git commit -m codex' = 'terminal'
    'function example { codex }' = 'terminal'
    '"codex"' = 'terminal'
    '' = 'terminal'
}
foreach ($command in $cases.Keys) {
    $actual = Get-SprigTerminalIcon $command
    if ($actual -ne $cases[$command]) { throw "Wrong icon for '$command': $actual" }
}
Set-Alias sprigTestAgent opencode
if ((Get-SprigTerminalIcon 'sprigTestAgent') -ne 'opencode') { throw 'Alias detection failed' }

$global:SprigOriginalReadLine = { 'claude --continue' }
$capture = New-Object System.IO.StringWriter
$originalOut = [Console]::Out
try {
    [Console]::SetOut($capture)
    if ((PSConsoleHostReadLine) -ne 'claude --continue') { throw 'Command changed while detecting icon' }
    $null = prompt
} finally {
    [Console]::SetOut($originalOut)
}
$expected = "$([char]27)]777;sprig;shell=ready$([char]7)$([char]27)]777;sprig;shell=busy$([char]7)$([char]27)]777;sprig;app=claude-code$([char]7)$([char]27)]777;sprig;app=terminal$([char]7)"
if ($capture.ToString() -ne $expected) { throw 'App start and prompt reset markers are incorrect' }

function SprigPopupCommandOne {}
function SprigPopupCommandTwo {}
$history = @([pscustomobject]@{ CommandLine = 'SprigPopupCommandTwo --previous' })
$items = @(Get-SprigCompletions 'SprigPopupComm' 14 $history)
if (-not ($items | Where-Object { $_.Text -eq 'SprigPopupCommandTwo' -and $_.Kind -eq 'command' })) { throw 'Command suggestions missing' }
if (-not ($items | Where-Object { $_.Text -eq 'SprigPopupCommandTwo --previous' -and $_.Kind -eq 'history' })) { throw 'History suggestions missing' }
if ($items.Count -gt 8) { throw 'Too many suggestions' }
if (@(Get-SprigCompletions '' 0 @()).Count -ne 0) { throw 'Empty input should not suggest commands' }

$folder = Join-Path ([IO.Path]::GetTempPath()) ('sprig-completion-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $folder
$file = Join-Path $folder 'file with spaces.txt'
try {
    [IO.File]::WriteAllText($file, '')
    $line = "Get-Content '$folder\file"
    $paths = @(Get-SprigCompletions $line $line.Length @())
    if (-not ($paths | Where-Object { $_.Kind -eq 'path' -and $_.Text.Contains('file with spaces.txt') -and $_.Start -eq 12 })) { throw 'Quoted path suggestions missing' }
} finally {
    Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $folder
}
