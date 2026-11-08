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

function Get-SprigCompletions([string]$Line, [int]$Cursor, [object[]]$History) {
    if ([string]::IsNullOrWhiteSpace($Line)) { return }
    $seen = @{}
    $count = 0
    if ($Cursor -eq $Line.Length) {
        for ($i = $History.Count - 1; $i -ge 0 -and $count -lt 3; $i--) {
            $text = $History[$i].CommandLine
            if ($text -ne $Line -and $text.StartsWith($Line, [StringComparison]::OrdinalIgnoreCase) -and -not $seen.ContainsKey($text)) {
                [pscustomobject]@{ Label = $text; Kind = 'history'; Text = $text; Start = 0; Length = $Line.Length }
                $seen[$text] = $true
                $count++
            }
        }
    }
    $completion = [System.Management.Automation.CommandCompletion]::CompleteInput($Line, $Cursor, $null)
    foreach ($match in $completion.CompletionMatches) {
        if ($count -ge 8) { break }
        if ($seen.ContainsKey($match.CompletionText)) { continue }
        $kind = switch ($match.ResultType.ToString()) {
            'Command' { 'command' }
            'ProviderItem' { 'path' }
            'ProviderContainer' { 'path' }
            default { 'argument' }
        }
        [pscustomobject]@{ Label = $match.ListItemText; Kind = $kind; Text = $match.CompletionText; Start = $completion.ReplacementIndex; Length = $completion.ReplacementLength }
        $seen[$match.CompletionText] = $true
        $count++
    }
}

function Write-SprigSuggestions([object[]]$Items) {
    $json = @{ items = @($Items | ForEach-Object { @{ label = $_.Label; kind = $_.Kind } }) } | ConvertTo-Json -Compress
    [Console]::Write("$([char]27)]777;sprig;suggestions=$json$([char]7)")
}

function Complete-SprigSuggestion([int]$Index) {
    $line = $null; $cursor = 0
    [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
    $completion = $global:SprigCompletion
    if ($completion -and $completion.Line -ceq $line -and $completion.Cursor -eq $cursor -and $Index -lt $completion.Items.Count) {
        $choice = $completion.Items[$Index]
        [Microsoft.PowerShell.PSConsoleReadLine]::Replace($choice.Start, $choice.Length, $choice.Text)
    }
    $global:SprigCompletion = $null
    Write-SprigSuggestions @()
}

try {
    Import-Module PSReadLine -MinimumVersion 2.1.0 -ErrorAction Stop
    if (-not (Get-Variable SprigOriginalReadLine -Scope Global -ErrorAction SilentlyContinue)) {
        $global:SprigOriginalReadLine = ${function:PSConsoleHostReadLine}
    }
    function global:PSConsoleHostReadLine {
        $global:SprigCompletion = $null
        [Console]::Write("$([char]27)]777;sprig;shell=ready$([char]7)")
        $line = $global:SprigOriginalReadLine.Invoke()
        [Console]::Write("$([char]27)]777;sprig;shell=busy$([char]7)")
        try {
            $icon = Get-SprigTerminalIcon $line
            [Console]::Write("$([char]27)]777;sprig;app=$icon$([char]7)")
        } catch {
            # Icon detection must never prevent a command from running.
        }
        return $line
    }
    # These function keys carry completion requests without evaluating terminal input as code.
    Set-PSReadLineKeyHandler -Key F12 -ScriptBlock {
        try {
            $line = $null; $cursor = 0
            [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
            $items = @(Get-SprigCompletions $line $cursor ([Microsoft.PowerShell.PSConsoleReadLine]::GetHistoryItems()))
            $global:SprigCompletion = @{ Line = $line; Cursor = $cursor; Items = $items }
            Write-SprigSuggestions $items
        } catch {
            $global:SprigCompletion = $null
            Write-SprigSuggestions @()
        }
    }
    $chords = @('F11', 'Shift+F11', 'Alt+F11', 'Shift+Alt+F11', 'Ctrl+F11', 'Shift+Ctrl+F11', 'Ctrl+Alt+F11', 'Shift+Ctrl+Alt+F11')
    for ($i = 0; $i -lt $chords.Count; $i++) {
        $index = $i
        Set-PSReadLineKeyHandler -Key $chords[$i] -ScriptBlock { Complete-SprigSuggestion $index }.GetNewClosure()
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
