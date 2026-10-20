<#
.SYNOPSIS
    The local load test (PERF-001): one line, no AWS or Cognito traffic.

.DESCRIPTION
    Mints local perf ID tokens, brings up the compose `perf` profile
    (postgres-perf, backend-perf), waits for backend-perf's /health, seeds it,
    runs k6 against it, and compares the per-endpoint P95/P99 with the
    previous run of the same profile on this machine
    (perf/results/baseline-<profile>.json; the first run stores it). Always
    tears the perf services down, even on failure.

    Exits non-zero when a k6 threshold fails or an endpoint regressed by more
    than -MaxRegression percent. Works in Windows PowerShell 5.1 and pwsh 7.
    See perf/README.md.

.EXAMPLE
    powershell -File perf/run.ps1 -Profile smoke
#>
param(
    [ValidateSet('smoke', 'load', 'stress')]
    [string]$Profile = 'smoke',
    [double]$MaxRegression = 20
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$results = Join-Path $PSScriptRoot 'results'
$perfServices = @('postgres-perf', 'backend-perf', 'k6')

function Invoke-Compose {
    # Native commands write progress to stderr; judge them by exit code only.
    # Out-Host keeps their output on the console and out of the return value.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & docker compose --profile perf @args | Out-Host
        return $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Assert-Compose {
    $code = Invoke-Compose @args
    if ($code -ne 0) {
        throw "docker compose $($args -join ' ') failed with exit code $code"
    }
}

function Wait-Healthy([string]$Url, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) { return }
        }
        catch {
            # Not up yet (migrations still running, or the port not bound).
        }
        Start-Sleep -Seconds 2
    }
    throw "backend-perf did not answer $Url within $TimeoutSeconds seconds"
}

$port = $env:BACKEND_PERF_PORT
if (-not $port) { $port = '8002' }
$healthUrl = "http://localhost:$port/health"

$exitCode = 1
Push-Location $repoRoot
try {
    New-Item -ItemType Directory -Force -Path $results | Out-Null
    if ($IsLinux -or $IsMacOS) {
        # The k6 image runs as a non-root user and writes the summary here.
        & chmod 0777 $results
    }
    $resultsMount = "$((Resolve-Path $results).Path):/out"
    $summaryFile = Join-Path $results "summary-$Profile.json"
    $baselineFile = Join-Path $results "baseline-$Profile.json"
    if (Test-Path $summaryFile) { Remove-Item -Force $summaryFile }

    Write-Host "==> building backend-perf"
    Assert-Compose build backend-perf

    # First: backend-perf reads the JWKS on its first verify. backend-perf
    # mounts perf/results read-only, so the mint gets its own writable mount.
    Write-Host "==> minting perf ID tokens"
    Assert-Compose run --rm --no-deps -e ENVIRONMENT=perf -v $resultsMount backend-perf `
        python scripts/mint_perf_tokens.py --count 300 --out-dir /out

    Write-Host "==> starting postgres-perf and backend-perf"
    Assert-Compose up -d backend-perf
    Write-Host "==> waiting for $healthUrl"
    Wait-Healthy -Url $healthUrl -TimeoutSeconds 180

    Write-Host "==> seeding"
    Assert-Compose exec -T backend-perf python scripts/seed_perf.py

    Write-Host "==> running k6 ($Profile)"
    $k6Code = Invoke-Compose run --rm --no-deps k6 run --env PROFILE=$Profile fanwire.js
    if ($k6Code -ne 0) {
        Write-Host "k6 exited with $k6Code (a threshold failed or the run was aborted)"
    }

    if (-not (Test-Path $summaryFile)) {
        throw "k6 wrote no summary at $summaryFile"
    }

    $compareCode = 0
    if ($k6Code -ne 0 -and -not (Test-Path $baselineFile)) {
        # Never store a failed run as the baseline.
        Write-Host "==> skipping the comparison: no baseline yet, and this run failed"
    }
    else {
        Write-Host "==> comparing with the $Profile baseline"
        $compareCode = Invoke-Compose run --rm --no-deps -v $resultsMount backend-perf `
            python scripts/perf_compare.py --run "/out/summary-$Profile.json" `
            --baseline "/out/baseline-$Profile.json" --max-regression $MaxRegression
    }

    if ($k6Code -eq 0 -and $compareCode -eq 0) {
        Write-Host "==> PASS"
        $exitCode = 0
    }
    else {
        Write-Host "==> FAIL (k6 exit $k6Code, compare exit $compareCode)"
    }
}
catch {
    Write-Host "==> ERROR: $($_.Exception.Message)"
    $exitCode = 1
}
finally {
    Write-Host "==> tearing down the perf profile"
    # rm -v first so postgres-perf's anonymous data volume goes with it, then
    # down to stop and remove what is left. Both are limited to the perf
    # services, so a dev stack running in the same project is left alone.
    Invoke-Compose rm --force --stop --volumes @perfServices | Out-Null
    Invoke-Compose down @perfServices | Out-Null
    Pop-Location
}
exit $exitCode
