# Runs the local verification for the 2026-10-17 design-alignment changes and saves
# every result under .\local-check-results\ so they can be reviewed afterwards.
#
# Usage (from the project folder, in PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\scripts\local\run-local-checks.ps1
# Options:
#   -SkipDatabase   skip the checks that need the local PostgreSQL database
#   -SkipBuild      skip the production build (the slowest step)
#
# Safety: it never contacts Render or the live site and never commits, pushes or
# deploys. The database checks create and delete temporary test rows, so they run
# only when DATABASE_URL (read from .env.local, then .env) points at this computer
# (localhost or 127.0.0.1). Otherwise they are skipped with a message.

param(
  [switch]$SkipDatabase,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $projectRoot

$resultsDir = Join-Path $projectRoot "local-check-results"
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null
$summary = New-Object System.Collections.Generic.List[object]

# Load .env.local first, then .env, without overriding values already set, so the
# Prisma CLI and the test scripts use the same local settings as the app.
foreach ($envFile in @(".env.local", ".env")) {
  $envPath = Join-Path $projectRoot $envFile
  if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
        $name = $Matches[1]
        $value = $Matches[2].Trim().Trim('"').Trim("'")
        if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
          [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
      }
    }
  }
}

function Invoke-Step {
  param([string]$Name, [string]$Command)
  Write-Host ""
  Write-Host "=== $Name ===" -ForegroundColor Cyan
  Write-Host "> $Command   (running, please wait...)"
  $log = Join-Path $resultsDir "$Name.log"
  $started = Get-Date
  $output = cmd /c "$Command 2>&1"
  $code = $LASTEXITCODE
  $output | ForEach-Object { Write-Host $_ }
  $output | Set-Content -Path $log -Encoding UTF8
  $seconds = [int]((Get-Date) - $started).TotalSeconds
  $status = if ($code -eq 0) { "PASS" } else { "FAIL" }
  $color = if ($code -eq 0) { "Green" } else { "Red" }
  Write-Host "$status ($Name, exit code $code, ${seconds}s)" -ForegroundColor $color
  $summary.Add([pscustomobject]@{ step = $Name; result = $status; exit_code = $code; seconds = $seconds })
}

function Add-Skipped {
  param([string]$Name, [string]$Reason)
  Write-Host ""
  Write-Host "=== $Name === SKIPPED: $Reason" -ForegroundColor Yellow
  $summary.Add([pscustomobject]@{ step = $Name; result = "SKIPPED"; exit_code = ""; seconds = 0 })
}

Invoke-Step "00-versions" "node --version 2>&1 && npm --version"
Invoke-Step "01-prisma-generate" "npx prisma generate"
Invoke-Step "02-typecheck" "npm run typecheck"
Invoke-Step "03-lint" "npm run lint"
Invoke-Step "04-design-alignment-checks" "npm run test:design-alignment"
Invoke-Step "05-dictionary-semantic-audit" "npx tsx prisma/student-data-dictionary-semantic-audit-smoke-test.ts"
Invoke-Step "06-dictionary-timing" "npx tsx prisma/student-data-dictionary-timing-smoke-test.ts"

$databaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
$databaseIsLocal = $databaseUrl -and ($databaseUrl -match '@(localhost|127\.0\.0\.1)(:\d+)?/')
if ($SkipDatabase) {
  Add-Skipped "10-database-checks" "-SkipDatabase was given"
} elseif (-not $databaseIsLocal) {
  Add-Skipped "10-database-checks" "DATABASE_URL is missing or does not point at localhost/127.0.0.1 (check .env.local)"
} else {
  Invoke-Step "10-database-migrations-status" "npx prisma migrate status"
  Invoke-Step "11-content-smoke" "npx tsx prisma/content-smoke-test.ts"
  Invoke-Step "12-feedback-display-completion" "npx tsx prisma/feedback-display-completion-smoke-test.ts"
  Invoke-Step "13-student-response-quality" "npx tsx prisma/student-response-quality-smoke-test.ts"
  Invoke-Step "13b-item-administration-audit" "npx tsx prisma/student-item-admin-audit-smoke-test.ts"
  Invoke-Step "14-profile-record-projection" "npx tsx prisma/profile-record-projection-smoke-test.ts"
  Invoke-Step "15-teacher-dashboard" "npx tsx prisma/teacher-dashboard-smoke-test.ts"
  Invoke-Step "16-teacher-item-builder" "npx tsx prisma/teacher-mcq-item-builder-smoke-test.ts"
  Invoke-Step "17-analysis-ready-export" "npx tsx prisma/student-analysis-ready-export-smoke-test.ts"
  Invoke-Step "18-student-script-review" "npx tsx prisma/student-script-review-smoke-test.ts"
}

if ($SkipBuild) {
  Add-Skipped "20-build" "-SkipBuild was given"
} else {
  Invoke-Step "20-build" "npm run build"
}

$summaryPath = Join-Path $resultsDir "SUMMARY.txt"
$summary | Format-Table -AutoSize | Out-String -Width 200 | Set-Content -Path $summaryPath -Encoding UTF8
Write-Host ""
Write-Host "=== Summary (also saved to $summaryPath) ===" -ForegroundColor Cyan
$summary | Format-Table -AutoSize
$failed = @($summary | Where-Object { $_.result -eq "FAIL" }).Count
if ($failed -gt 0) {
  Write-Host "$failed step(s) failed. The logs are in $resultsDir" -ForegroundColor Red
  exit 1
}
Write-Host "No step failed." -ForegroundColor Green
exit 0
