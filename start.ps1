[CmdletBinding()]
param(
    [switch]$NoRun,
    [string]$EnvFilePath
)

$ErrorActionPreference = "Stop"

$script:RootDir = Split-Path -Parent $PSCommandPath
$script:BackendDir = Join-Path $script:RootDir "backend"
$script:FrontendDir = Join-Path $script:RootDir "frontend"

if (-not $EnvFilePath) {
    $EnvFilePath = Join-Path $script:RootDir ".env"
}

function Get-EnvFileValues {
    param([string]$Path)

    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $values
    }

    foreach ($rawLine in Get-Content -LiteralPath $Path) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            continue
        }

        $separatorIndex = $line.IndexOf("=")
        if ($separatorIndex -lt 1) {
            continue
        }

        $key = $line.Substring(0, $separatorIndex).Trim()
        $value = $line.Substring($separatorIndex + 1).Trim()

        if ($value.Length -ge 2) {
            if (
                ($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))
            ) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }

        $values[$key] = $value
    }

    return $values
}

function Get-ConfigValue {
    param(
        [string]$Name,
        [string]$Default,
        [hashtable]$EnvFileValues
    )

    $processValue = Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue
    if ($null -ne $processValue -and $processValue.Value -ne "") {
        return [string]$processValue.Value
    }

    if ($EnvFileValues.ContainsKey($Name) -and $EnvFileValues[$Name] -ne "") {
        return [string]$EnvFileValues[$Name]
    }

    return $Default
}

function Get-ConfigInt {
    param(
        [string]$Name,
        [int]$Default,
        [hashtable]$EnvFileValues
    )

    $rawValue = Get-ConfigValue -Name $Name -Default ([string]$Default) -EnvFileValues $EnvFileValues
    $parsedValue = 0
    if (-not [int]::TryParse($rawValue, [ref]$parsedValue)) {
        throw "Invalid integer value for ${Name}: '$rawValue'"
    }
    return $parsedValue
}

function Get-ConfigBool {
    param(
        [string]$Name,
        [bool]$Default,
        [hashtable]$EnvFileValues
    )

    $rawValue = (Get-ConfigValue -Name $Name -Default ($Default.ToString().ToLowerInvariant()) -EnvFileValues $EnvFileValues).Trim().ToLowerInvariant()
    switch ($rawValue) {
        "1" { return $true }
        "true" { return $true }
        "yes" { return $true }
        "on" { return $true }
        "0" { return $false }
        "false" { return $false }
        "no" { return $false }
        "off" { return $false }
        default { throw "Invalid boolean value for ${Name}: '$rawValue'" }
    }
}

function Escape-SingleQuotedValue {
    param([string]$Value)

    return $Value -replace "'", "''"
}

function Resolve-NpmCli {
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCommand) {
        return $npmCommand.Source
    }

    throw "npm.cmd not found. Install Node.js and ensure it is available on PATH."
}

function Get-ListeningProcessInfo {
    param([int]$Port)

    $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if (-not $listeners) {
        return @()
    }

    $processIds = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
    $processInfos = @()

    foreach ($processId in $processIds) {
        $processRecord = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        $processInfos += [pscustomobject]@{
            ProcessId = $processId
            Name = $processRecord.Name
            CommandLine = $processRecord.CommandLine
            ExecutablePath = $processRecord.ExecutablePath
        }
    }

    return $processInfos
}

function Test-RepoOwnedListener {
    param(
        [pscustomobject]$ProcessInfo,
        [string]$RootDir
    )

    if (-not $ProcessInfo) {
        return $false
    }

    foreach ($candidate in @($ProcessInfo.CommandLine, $ProcessInfo.ExecutablePath)) {
        if ($candidate -and $candidate.IndexOf($RootDir, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return $true
        }
    }

    return $false
}

function Get-StartupSettings {
    param(
        [string]$EnvFilePath = (Join-Path $script:RootDir ".env")
    )

    $envFileValues = Get-EnvFileValues -Path $EnvFilePath

    $backendHost = Get-ConfigValue -Name "BACKEND_HOST" -Default "127.0.0.1" -EnvFileValues $envFileValues
    $backendPort = Get-ConfigInt -Name "BACKEND_PORT" -Default 8000 -EnvFileValues $envFileValues
    $frontendHost = Get-ConfigValue -Name "FRONTEND_HOST" -Default "127.0.0.1" -EnvFileValues $envFileValues
    $frontendPort = Get-ConfigInt -Name "FRONTEND_PORT" -Default 5173 -EnvFileValues $envFileValues
    $backendApiUrl = Get-ConfigValue -Name "BACKEND_URL" -Default "http://${backendHost}:${backendPort}" -EnvFileValues $envFileValues
    $backendApiBaseUrl = Get-ConfigValue -Name "API_BASE_URL" -Default "${backendApiUrl}/api/v1" -EnvFileValues $envFileValues
    $viteApiUrl = Get-ConfigValue -Name "VITE_API_URL" -Default $backendApiUrl -EnvFileValues $envFileValues
    $debug = Get-ConfigValue -Name "DEBUG" -Default "false" -EnvFileValues $envFileValues
    $windowsConsoleProvider = Get-ConfigValue -Name "WINDOWS_CONSOLE_PROVIDER" -Default "" -EnvFileValues $envFileValues
    $sharedConsoleProvider = Get-ConfigValue -Name "CONSOLE_PROVIDER" -Default "legacy" -EnvFileValues $envFileValues
    $consoleProvider = if ($windowsConsoleProvider) { $windowsConsoleProvider } else { $sharedConsoleProvider }
    $projectsRoot = Get-ConfigValue -Name "PROJECTS_ROOT" -Default "" -EnvFileValues $envFileValues
    $autoStopPortListeners = Get-ConfigBool -Name "AUTO_STOP_PORT_LISTENERS" -Default $true -EnvFileValues $envFileValues
    $attackGraphAutoSeed = Get-ConfigBool -Name "ATTACK_GRAPH_AUTO_SEED_DEMO" -Default $false -EnvFileValues $envFileValues
    $seedAdminEnabled = Get-ConfigBool -Name "SEED_ADMIN_ENABLED" -Default $false -EnvFileValues $envFileValues
    $seedAdminUsername = Get-ConfigValue -Name "SEED_ADMIN_USERNAME" -Default "admin" -EnvFileValues $envFileValues
    $seedAdminPassword = Get-ConfigValue -Name "SEED_ADMIN_PASSWORD" -Default "admin" -EnvFileValues $envFileValues
    $seedAdminEmail = Get-ConfigValue -Name "SEED_ADMIN_EMAIL" -Default "admin@example.com" -EnvFileValues $envFileValues
    $seedAdminProjectName = Get-ConfigValue -Name "SEED_ADMIN_PROJECT_NAME" -Default "CTF Demo Admin" -EnvFileValues $envFileValues
    $seedAdminProjectType = Get-ConfigValue -Name "SEED_ADMIN_PROJECT_TYPE" -Default "ctf" -EnvFileValues $envFileValues

    return [pscustomobject]@{
        RootDir = $script:RootDir
        BackendDir = $script:BackendDir
        FrontendDir = $script:FrontendDir
        EnvFilePath = $EnvFilePath
        BackendHost = $backendHost
        BackendPort = $backendPort
        FrontendHost = $frontendHost
        FrontendPort = $frontendPort
        BackendApiUrl = $backendApiUrl
        BackendApiBaseUrl = $backendApiBaseUrl
        ViteApiUrl = $viteApiUrl
        Debug = $debug
        ConsoleProvider = $consoleProvider
        ProjectsRoot = $projectsRoot
        AutoStopPortListeners = $autoStopPortListeners
        AttackGraphAutoSeed = $attackGraphAutoSeed
        SeedAdminEnabled = $seedAdminEnabled
        SeedAdminUsername = $seedAdminUsername
        SeedAdminPassword = $seedAdminPassword
        SeedAdminEmail = $seedAdminEmail
        SeedAdminProjectName = $seedAdminProjectName
        SeedAdminProjectType = $seedAdminProjectType
    }
}

function Ensure-PortAvailable {
    param(
        [int]$Port,
        [bool]$AutoStop = $false,
        [string]$EnvFilePath = ""
    )

    $processInfos = Get-ListeningProcessInfo -Port $Port
    if (-not $processInfos) {
        return
    }

    $processIds = $processInfos | Select-Object -ExpandProperty ProcessId -Unique
    $repoOwnedListeners = @($processInfos | Where-Object { Test-RepoOwnedListener -ProcessInfo $_ -RootDir $script:RootDir })
    $canAutoRestart = $repoOwnedListeners.Count -eq $processInfos.Count
    $shouldStop = $AutoStop -or $canAutoRestart

    if (-not $shouldStop) {
        $envHint = if ($EnvFilePath) {
            " Update '$EnvFilePath' to use another port or stop the process manually."
        } else {
            " Stop the existing process or choose another port."
        }
        throw "Port $Port is already in use by PID(s): $($processIds -join ', ').$envHint"
    }

    if ($AutoStop) {
        Write-Host "Port $Port is in use. Stopping existing listener(s)..." -ForegroundColor Yellow
    } else {
        Write-Host "Port $Port is already used by a previous PwnPilot process. Restarting listener(s)..." -ForegroundColor Yellow
    }

    foreach ($processId in $processIds) {
        $procName = ($processInfos | Where-Object { $_.ProcessId -eq $processId } | Select-Object -First 1).Name
        Write-Host "  Killing PID $processId ($procName)..." -ForegroundColor DarkYellow
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        # Fallback: taskkill also terminates child processes (/T) and is more forceful on Windows
        & taskkill.exe /PID $processId /F /T 2>$null | Out-Null
    }

    $maxWaitSeconds = 5
    for ($i = 0; $i -lt $maxWaitSeconds; $i++) {
        Start-Sleep -Seconds 1
        if (-not (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) {
            return
        }
    }

    $remainingInfos = Get-ListeningProcessInfo -Port $Port
    $remainingIds = $remainingInfos | Select-Object -ExpandProperty ProcessId -Unique
    $remainingDetail = ($remainingInfos | ForEach-Object { "$($_.ProcessId) ($($_.Name))" }) -join ', '
    throw "Unable to free port $Port automatically after $maxWaitSeconds s. Still held by PID(s): $remainingDetail. Try running this shell as Administrator, or stop the process manually."
}

function Resolve-BackendPython {
    $dotVenvPython = Join-Path $script:BackendDir ".venv\\Scripts\\python.exe"
    if (Test-Path $dotVenvPython) {
        return $dotVenvPython
    }

    $legacyVenvPython = Join-Path $script:BackendDir "venv\\Scripts\\python.exe"
    if (Test-Path $legacyVenvPython) {
        return $legacyVenvPython
    }

    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        & py -3 -m venv (Join-Path $script:BackendDir ".venv")
    } else {
        & python -m venv (Join-Path $script:BackendDir ".venv")
    }

    if (-not (Test-Path $dotVenvPython)) {
        throw "Failed to create backend virtual environment at $dotVenvPython"
    }

    return $dotVenvPython
}

function Start-PwnPilot {
    param(
        [string]$EnvFilePath = (Join-Path $script:RootDir ".env")
    )

    $settings = Get-StartupSettings -EnvFilePath $EnvFilePath

    Write-Host "Starting PwnPilot for Windows..." -ForegroundColor Cyan
    if (Test-Path -LiteralPath $settings.EnvFilePath) {
        Write-Host "Using startup config from $($settings.EnvFilePath)" -ForegroundColor DarkGray
    } else {
        Write-Host "No repo .env found at $($settings.EnvFilePath). Using built-in defaults." -ForegroundColor DarkGray
    }

    Ensure-PortAvailable -Port $settings.BackendPort -AutoStop $settings.AutoStopPortListeners -EnvFilePath $settings.EnvFilePath
    Ensure-PortAvailable -Port $settings.FrontendPort -AutoStop $settings.AutoStopPortListeners -EnvFilePath $settings.EnvFilePath

    $backendPython = Resolve-BackendPython
    $npmCli = Resolve-NpmCli

    Push-Location $settings.BackendDir
    try {
        & $backendPython -m pip install -q -r requirements.txt
        & $backendPython -m alembic upgrade head
    } finally {
        Pop-Location
    }

    Push-Location $settings.FrontendDir
    try {
        if (-not (Test-Path (Join-Path $settings.FrontendDir "node_modules"))) {
            & $npmCli install
        }
    } finally {
        Pop-Location
    }

    $backendCommandLines = @(
        "Set-Location '$(Escape-SingleQuotedValue $settings.BackendDir)'",
        "`$env:DEBUG = '$(Escape-SingleQuotedValue $settings.Debug)'",
        "`$env:CONSOLE_PROVIDER = '$(Escape-SingleQuotedValue $settings.ConsoleProvider)'",
        "`$env:API_BASE_URL = '$(Escape-SingleQuotedValue $settings.BackendApiBaseUrl)'",
        "`$env:ATTACK_GRAPH_AUTO_SEED_DEMO = '$(Escape-SingleQuotedValue $settings.AttackGraphAutoSeed)'",
        "`$env:SEED_ADMIN_ENABLED = '$(Escape-SingleQuotedValue $settings.SeedAdminEnabled)'",
        "`$env:SEED_ADMIN_USERNAME = '$(Escape-SingleQuotedValue $settings.SeedAdminUsername)'",
        "`$env:SEED_ADMIN_PASSWORD = '$(Escape-SingleQuotedValue $settings.SeedAdminPassword)'",
        "`$env:SEED_ADMIN_EMAIL = '$(Escape-SingleQuotedValue $settings.SeedAdminEmail)'",
        "`$env:SEED_ADMIN_PROJECT_NAME = '$(Escape-SingleQuotedValue $settings.SeedAdminProjectName)'",
        "`$env:SEED_ADMIN_PROJECT_TYPE = '$(Escape-SingleQuotedValue $settings.SeedAdminProjectType)'"
    )
    if ($settings.ProjectsRoot) {
        $backendCommandLines += "`$env:PROJECTS_ROOT = '$(Escape-SingleQuotedValue $settings.ProjectsRoot)'"
    }
    $backendCommandLines += "& '$(Escape-SingleQuotedValue $backendPython)' -m uvicorn app.main:app --reload --host $($settings.BackendHost) --port $($settings.BackendPort)"

    $frontendCommandLines = @(
        "Set-Location '$(Escape-SingleQuotedValue $settings.FrontendDir)'",
        "`$env:VITE_API_URL = '$(Escape-SingleQuotedValue $settings.ViteApiUrl)'",
        "& '$(Escape-SingleQuotedValue $npmCli)' run dev -- --host $($settings.FrontendHost) --port $($settings.FrontendPort)"
    )

    $backendCommand = $backendCommandLines -join "`n"
    $frontendCommand = $frontendCommandLines -join "`n"

    $backendProcess = Start-Process powershell -ArgumentList @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-Command", $backendCommand) -PassThru
    $frontendProcess = Start-Process powershell -ArgumentList @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-Command", $frontendCommand) -PassThru

    Write-Host ""
    Write-Host "PwnPilot launched." -ForegroundColor Green
    Write-Host "  Backend : $($settings.BackendApiUrl)"
    Write-Host "  Frontend: http://$($settings.FrontendHost):$($settings.FrontendPort)"
    Write-Host "  Terminal provider: $($settings.ConsoleProvider)"
    Write-Host "  Auto-stop conflicting listeners: $($settings.AutoStopPortListeners)"
    Write-Host ""
    Write-Host "Processes:"
    Write-Host "  Backend PID : $($backendProcess.Id)"
    Write-Host "  Frontend PID: $($frontendProcess.Id)"
}

if (-not $NoRun) {
    Start-PwnPilot -EnvFilePath $EnvFilePath
}
