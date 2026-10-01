[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$BackendPythonCandidates = @(
    (Join-Path $BackendDir ".venv\Scripts\python.exe"),
    (Join-Path $BackendDir "venv\Scripts\python.exe")
)
$BackendPython = $BackendPythonCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

function Assert-LastExitCode {
    param(
        [string]$StepName
    )

    if ($LASTEXITCODE -ne 0) {
        throw "$StepName failed with exit code $LASTEXITCODE"
    }
}

function Invoke-BackendRuff {
    & $BackendPython -m ruff --version *> $null
    if ($LASTEXITCODE -eq 0) {
        & $BackendPython -m ruff check .
        return
    }

    $ruffCommand = Get-Command ruff -ErrorAction SilentlyContinue
    if ($ruffCommand) {
        & $ruffCommand.Source check .
        return
    }

    throw "ruff not found. Install backend dev requirements or add ruff to PATH."
}

if (-not $BackendPython) {
    throw "Backend virtual environment not found. Expected one of: $($BackendPythonCandidates -join ', ')"
}

Write-Host "==> Backend lint" -ForegroundColor Cyan
Push-Location $BackendDir
try {
    Invoke-BackendRuff
    Assert-LastExitCode "Backend lint"

    Write-Host "==> Backend migrations" -ForegroundColor Cyan
    & $BackendPython -m alembic upgrade head
    Assert-LastExitCode "Backend migrations"

    Write-Host "==> Backend tests" -ForegroundColor Cyan
    & $BackendPython -m pytest -q
    Assert-LastExitCode "Backend tests"

    Write-Host "==> Backend import smoke" -ForegroundColor Cyan
    $env:DEBUG = "false"
    $env:CONSOLE_PROVIDER = "legacy"
    & $BackendPython -c "import app.main"
    Assert-LastExitCode "Backend import smoke"
} finally {
    Pop-Location
}

Write-Host "==> Frontend lint" -ForegroundColor Cyan
Push-Location $FrontendDir
try {
    npm run lint
    Assert-LastExitCode "Frontend lint"

    Write-Host "==> Frontend build" -ForegroundColor Cyan
    npm run build
    Assert-LastExitCode "Frontend build"

    Write-Host "==> Frontend tests" -ForegroundColor Cyan
    npm run test
    Assert-LastExitCode "Frontend tests"

    Write-Host "==> Frontend browser smoke" -ForegroundColor Cyan
    npm run test:e2e
    Assert-LastExitCode "Frontend browser smoke"
} finally {
    Pop-Location
}

Write-Host "Verification completed successfully." -ForegroundColor Green
