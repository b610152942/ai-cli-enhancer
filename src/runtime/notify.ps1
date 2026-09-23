param(
    [ValidateSet("Capture", "Notify")]
    [string]$Mode,
    [string]$PayloadBase64
)

$ErrorActionPreference = "Stop"

try {
    $payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64))
    $payload = $payloadJson | ConvertFrom-Json
    $stateRoot = Join-Path $env:TEMP "ai-cli-enhancer"
    [IO.Directory]::CreateDirectory($stateRoot) | Out-Null
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$payload.session)))).Replace("-", "").Substring(0, 24)
    } finally { $sha.Dispose() }
    $stateFile = Join-Path $stateRoot "$hash.json"

    if (-not ("EnhancerForegroundWindow" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class EnhancerForegroundWindow {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
    }
    $foreground = [EnhancerForegroundWindow]::GetForegroundWindow().ToInt64()

    if ($Mode -eq "Capture") {
        @{ startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); foreground = $foreground } |
            ConvertTo-Json -Compress | Set-Content -LiteralPath $stateFile -Encoding UTF8
        exit 0
    }

    $category = [string]$payload.category
    $stampFile = Join-Path $stateRoot "$hash-$category.stamp"
    if (Test-Path -LiteralPath $stampFile) {
        $age = (Get-Date) - (Get-Item -LiteralPath $stampFile).LastWriteTime
        if ($age.TotalSeconds -lt 3) { exit 0 }
    }
    Set-Content -LiteralPath $stampFile -Value ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) -Encoding ASCII

    $title = [Security.SecurityElement]::Escape(([string]$payload.title).Substring(0, [Math]::Min(80, ([string]$payload.title).Length)))
    $bodyText = [string]$payload.body
    $body = [Security.SecurityElement]::Escape($bodyText.Substring(0, [Math]::Min(240, $bodyText.Length)))
    $shown = $false
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
        $app = Get-StartApps | Where-Object { $_.AppID -and $_.Name -match "PowerShell" } | Select-Object -First 1
        if ($app) {
            $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
            $duration = if ($payload.requiresAnswer) { " duration='long'" } else { "" }
            $xml.LoadXml("<toast$duration><visual><binding template='ToastGeneric'><text>$title</text><text>$body</text></binding></visual><audio silent='true'/></toast>")
            $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
            [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app.AppID).Show($toast)
            $shown = $true
        }
    } catch { $shown = $false }

    if (-not $shown) {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $icon = New-Object System.Windows.Forms.NotifyIcon
        try {
            $icon.Icon = [System.Drawing.SystemIcons]::Information
            $icon.Visible = $true
            $icon.BalloonTipTitle = [string]$payload.title
            $icon.BalloonTipText = $bodyText
            $icon.ShowBalloonTip(5000)
            Start-Sleep -Milliseconds 750
        } finally {
            $icon.Visible = $false
            $icon.Dispose()
        }
    }
} catch {
    # Fail open: a notification error must not surface in or block the CLI.
    exit 0
}
