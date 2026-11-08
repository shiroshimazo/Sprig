function prompt {
    [Console]::Write("$([char]27)]777;sprig;app=terminal$([char]7)")
    $p = (Get-Location).Path
    $l = Split-Path -Leaf $p
    if (-not $l) { $l = $p }
    "PS $l> "
}

function Get-SprigTerminalIcon([string]$CommandLine) {
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($CommandLine, [ref]$null, [ref]$null)
    $commands = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $false)
    foreach ($command in $commands) {
        $name = $command.GetCommandName()
        if (-not $name) { continue }
        $alias = Get-Alias -Name $name -ErrorAction SilentlyContinue
        if ($alias) { $name = $alias.ResolvedCommand.Name }
        $executable = (($name -split '[/\\]')[-1] -replace '\.(exe|cmd|bat|ps1)$', '').ToLowerInvariant()
        switch ($executable) {
            'codex' { return 'codex' }
            'claude' { return 'claude-code' }
            'antigravity' { return 'antigravity' }
            'agy' { return 'antigravity' }
            'opencode' { return 'opencode' }
        }
    }
    return 'terminal'
}

try {
    Import-Module PSReadLine -MinimumVersion 2.1.0 -ErrorAction Stop
    if (-not (Get-Variable SprigOriginalReadLine -Scope Global -ErrorAction SilentlyContinue)) {
        $global:SprigOriginalReadLine = ${function:PSConsoleHostReadLine}
    }
    function global:PSConsoleHostReadLine {
        $line = $global:SprigOriginalReadLine.Invoke()
        try {
            $icon = Get-SprigTerminalIcon $line
            [Console]::Write("$([char]27)]777;sprig;app=$icon$([char]7)")
        } catch {
            # Icon detection must never prevent a command from running.
        }
        return $line
    }
    Set-PSReadLineOption -PredictionSource History -ErrorAction Stop
    if ((Get-Command Set-PSReadLineOption).Parameters.ContainsKey('PredictionViewStyle')) {
        Set-PSReadLineOption -PredictionViewStyle InlineView -ErrorAction Stop
    }
    Set-PSReadLineKeyHandler -Key RightArrow -Function ForwardChar -ErrorAction Stop
} catch {
    Write-Warning "History autocomplete unavailable: $($_.Exception.Message)"
    Write-Warning 'Install or update PSReadLine, then open a new terminal: Install-Module PSReadLine -Scope CurrentUser -Force'
}
