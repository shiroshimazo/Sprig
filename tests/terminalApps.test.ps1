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
$expected = "$([char]27)]777;sprig;app=claude-code$([char]7)$([char]27)]777;sprig;app=terminal$([char]7)"
if ($capture.ToString() -ne $expected) { throw 'App start and prompt reset markers are incorrect' }
