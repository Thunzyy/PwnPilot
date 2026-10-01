[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$TempEnv = Join-Path ([System.IO.Path]::GetTempPath()) ("pwnpilot-start-config-" + [System.Guid]::NewGuid().ToString("N") + ".env")

@"
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8011
FRONTEND_HOST=127.0.0.1
FRONTEND_PORT=5181
AUTO_STOP_PORT_LISTENERS=false
DEBUG=false
"@ | Set-Content -LiteralPath $TempEnv -Encoding ASCII

try {
    . (Join-Path $RepoRoot "start.ps1") -NoRun

    $settings = Get-StartupSettings -EnvFilePath $TempEnv

    if ($settings.BackendPort -ne 8011) {
        throw "Expected BackendPort=8011, got $($settings.BackendPort)"
    }
    if ($settings.FrontendPort -ne 5181) {
        throw "Expected FrontendPort=5181, got $($settings.FrontendPort)"
    }
    if ($settings.AutoStopPortListeners -ne $false) {
        throw "Expected AutoStopPortListeners=false, got $($settings.AutoStopPortListeners)"
    }
    if ($settings.BackendApiUrl -ne "http://127.0.0.1:8011") {
        throw "Expected BackendApiUrl=http://127.0.0.1:8011, got $($settings.BackendApiUrl)"
    }
    if ($settings.BackendApiBaseUrl -ne "http://127.0.0.1:8011/api/v1") {
        throw "Expected BackendApiBaseUrl=http://127.0.0.1:8011/api/v1, got $($settings.BackendApiBaseUrl)"
    }

    Write-Host "Startup config test passed." -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $TempEnv -Force -ErrorAction SilentlyContinue
}
