function prompt {
    $p = (Get-Location).Path
    $l = Split-Path -Leaf $p
    if (-not $l) { $l = $p }
    "PS $l> "
}

try {
    Import-Module PSReadLine -MinimumVersion 2.1.0 -ErrorAction Stop
    Set-PSReadLineOption -PredictionSource History -ErrorAction Stop
    if ((Get-Command Set-PSReadLineOption).Parameters.ContainsKey('PredictionViewStyle')) {
        Set-PSReadLineOption -PredictionViewStyle InlineView -ErrorAction Stop
    }
    Set-PSReadLineKeyHandler -Key RightArrow -Function ForwardChar -ErrorAction Stop
} catch {
    Write-Warning "History autocomplete unavailable: $($_.Exception.Message)"
    Write-Warning 'Install or update PSReadLine, then open a new terminal: Install-Module PSReadLine -Scope CurrentUser -Force'
}
