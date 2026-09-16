[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("install", "status", "enable", "disable", "uninstall", "upgrade")]
    [string]$Action = "status",

    [string[]]$Cli = @(),

    [string[]]$Target = @("windows", "wsl"),

    [string]$WslDistro = "Ubuntu-24.04",

    [switch]$All,
    [switch]$Purge
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$installer = Join-Path $projectRoot "src\installer.mjs"

function Expand-Values([string[]]$Values) {
    $result = @()
    foreach ($value in $Values) {
        $result += $value -split "," | Where-Object { $_ } | ForEach-Object { $_.Trim().ToLowerInvariant() }
    }
    return $result
}

function Invoke-Enhancer([string]$TargetName) {
    $cliArgs = @(Expand-Values $Cli)
    $argsList = @($installer, $Action, "--target", $TargetName)
    if ($cliArgs.Count -gt 0) {
        $argsList += @("--cli", ($cliArgs -join ","))
    }
    if ($All) { $argsList += "--all" }
    if ($Purge) { $argsList += "--purge" }

    if ($TargetName -eq "windows") {
        & node @argsList
        if ($LASTEXITCODE -ne 0) { throw "Windows target failed with exit code $LASTEXITCODE" }
        return
    }

    $portableProjectRoot = $projectRoot.Replace("\", "/")
    $wslProjectRoot = (& wsl.exe -d $WslDistro -- wslpath -u $portableProjectRoot).Trim()
    if (-not $wslProjectRoot) { throw "Cannot resolve the project path in WSL." }
    $wslInstaller = "$wslProjectRoot/src/installer.mjs"
    $wslArgs = @($wslInstaller, $Action, "--target", "wsl")
    if ($cliArgs.Count -gt 0) { $wslArgs += @("--cli", ($cliArgs -join ",")) }
    if ($All) { $wslArgs += "--all" }
    if ($Purge) { $wslArgs += "--purge" }
    & wsl.exe -d $WslDistro -- node @wslArgs
    if ($LASTEXITCODE -ne 0) { throw "WSL target failed with exit code $LASTEXITCODE" }
}

$targets = @(Expand-Values $Target) | Select-Object -Unique
foreach ($targetName in $targets) {
    if ($targetName -notin @("windows", "wsl")) {
        throw "Unsupported target '$targetName'. Expected windows or wsl."
    }
    Invoke-Enhancer $targetName
}
