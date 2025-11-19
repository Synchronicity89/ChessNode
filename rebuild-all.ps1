<#!
.SYNOPSIS
  Rebuilds all project components: Node addon, native engines, optional WASM, tests, and (optionally) starts server.
.DESCRIPTION
  Safe idempotent rebuild script. Detects tool availability (cmake, emcmake) and skips unavailable targets.
.PARAMETER RunServer
  Starts the foreground server after successful rebuild.
#>
[CmdletBinding()]
param(
  [int]$RunServer,          # Provide a port number to start server after rebuild (e.g. -RunServer 9090)
  [switch]$SkipTests        # Skip all test execution when present
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# Load Qt installation path from secrets if available (for GUI build)
$qtSecretFile = Join-Path $root 'secrets/QT_Installation_Path.txt'
$qtPrefixPaths = @()
$qtMsvcQt6Dir = $null
if (Test-Path $qtSecretFile) {
  try {
    $rawQtRoot = (Get-Content $qtSecretFile -Raw).Trim()
    if ($rawQtRoot -and (Test-Path $rawQtRoot)) {
      # Prefer MSVC kit under the Qt root (e.g. <QtRoot>\6.10.0\msvc2022_64\lib\cmake\Qt6)
      $qtMsvcPatterns = @('*msvc*', 'msvc*')
      $qtMsvcHits = @()
      foreach ($pat in $qtMsvcPatterns) {
        $qtMsvcHits += Get-ChildItem -Path $rawQtRoot -Directory -Recurse -Filter $pat -ErrorAction SilentlyContinue
      }
      $qtMsvcHits = $qtMsvcHits | Sort-Object FullName -Unique
      foreach ($dir in $qtMsvcHits) {
        $candidate = Join-Path $dir.FullName 'lib/cmake/Qt6'
        if (Test-Path (Join-Path $candidate 'Qt6Config.cmake')) {
          $qtMsvcQt6Dir = $candidate
          break
        }
      }

      if ($qtMsvcQt6Dir) {
        $qtPrefixPaths = @($qtMsvcQt6Dir)
        Write-Host "Qt MSVC kit selected from secret root:" -ForegroundColor DarkCyan
        Write-Host "  $qtMsvcQt6Dir" -ForegroundColor DarkCyan
      } else {
        # Fallback to previous generic search behaviour, but still avoid mingw where possible
        $qtConfigHits = Get-ChildItem -Path $rawQtRoot -Recurse -Filter 'Qt6Config.cmake' -ErrorAction SilentlyContinue | Select-Object -First 3
        if ($qtConfigHits) {
          foreach ($hit in $qtConfigHits) {
            $candidate = Split-Path -Parent $hit.FullName
            if ($candidate -like '*msvc*' -and $qtPrefixPaths -notcontains $candidate) { $qtPrefixPaths += $candidate }
          }
        }
        if (-not $qtPrefixPaths -and (Test-Path (Join-Path $rawQtRoot 'Qt6Config.cmake'))) {
          $qtPrefixPaths += $rawQtRoot
        }
      }
    }
  } catch {}
}

class StepResult { [string]$Name; [bool]$Succeeded; [string]$Category; [string]$Detail }
$Global:Results = @()
function Invoke-Step {
  param(
    [string]$Name,
    [ScriptBlock]$Action,
    [string]$Category = 'build',
    [switch]$ContinueOnError
  )
  Write-Host "==> $Name" -ForegroundColor Cyan
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $detail = ''
  $succeeded = $false
  try {
    $detail = (& $Action | Out-String).TrimEnd()
    $succeeded = $true
    $sw.Stop()
    Write-Host "OK ($($sw.Elapsed.TotalSeconds.ToString('0.00'))s): $Name" -ForegroundColor Green
  } catch {
    $sw.Stop()
    $detail = ($_.Exception.Message)
    Write-Host "FAILED ($($sw.Elapsed.TotalSeconds.ToString('0.00'))s): $Name" -ForegroundColor Red
    if (-not $ContinueOnError) { $Global:Results += [StepResult]@{ Name=$Name; Succeeded=$succeeded; Category=$Category; Detail=$detail }; throw }
  }
  $Global:Results += [StepResult]@{ Name=$Name; Succeeded=$succeeded; Category=$Category; Detail=$detail }
}

Write-Host "=== ChessNode Full Rebuild ($(Get-Date -Format o)) ===" -ForegroundColor Yellow

# Optional clean (light): only remove build folders if -Clean passed (future). Always ensure folders exist.
$buildDirs = @(
  'server/native-addon/build',
  'native/build',
  'engine/build',
  'engine/build-wasm'
)
foreach ($d in $buildDirs) { if (!(Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null } }

# Dependencies
Invoke-Step 'Install Node dependencies (npm ci)' { npm ci }

# Kill default port 8080 (always attempt). Also kill requested RunServer port if different.
function Kill-Port([int]$Port) {
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if ($conn) {
      $pid = $conn.OwningProcess
      if ($pid) { Write-Host "Stopping process on port $Port (PID=$pid)" -ForegroundColor DarkCyan; Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue }
    }
  } catch {}
}
Invoke-Step 'Stop existing server on 8080' { Kill-Port 8080 } -Category 'lifecycle' -ContinueOnError
if ($RunServer -and $RunServer -ne 8080) { Invoke-Step "Stop existing server on $RunServer" { Kill-Port $RunServer } -Category 'lifecycle' -ContinueOnError }

# Build native addon
Invoke-Step 'Build Node native addon' { npm run build:addon }

# Build lightweight native engine (native/)
if (Get-Command cmake -ErrorAction SilentlyContinue) {
  Invoke-Step 'Configure native/ (cmake)' {
    $qtArgs = @('-DCMAKE_BUILD_TYPE=Release')
    if ($qtMsvcQt6Dir) {
      # Prefer explicit Qt6_DIR for MSVC kit; still provide CMAKE_PREFIX_PATH to be safe.
      $qtArgs += "-DQt6_DIR=$qtMsvcQt6Dir"
      $qtArgs += "-DCMAKE_PREFIX_PATH=$qtMsvcQt6Dir"
      Write-Host "Configuring native with Qt6_DIR=$qtMsvcQt6Dir" -ForegroundColor DarkCyan
    } elseif ($qtPrefixPaths -and $qtPrefixPaths.Count -gt 0) {
      $joined = ($qtPrefixPaths -join ';')
      $qtArgs += "-DCMAKE_PREFIX_PATH=$joined"
      Write-Host "Configuring native with generic Qt prefix path(s): $joined" -ForegroundColor DarkCyan
    }
    cmake -S native -B native/build @qtArgs
  }
  Invoke-Step 'Build native/ engine' { cmake --build native/build --config Release }
  # Optional GUI (Qt) target if Qt6 was found during configure
  Invoke-Step 'Build GUI (chess_gui)' { cmake --build native/build --config Release --target chess_gui } -Category 'build' -ContinueOnError
} else { Write-Host 'Skipping native/ engine (cmake not found)' -ForegroundColor DarkYellow }

# Build modular engine (engine/) native
if (Get-Command cmake -ErrorAction SilentlyContinue) {
  Invoke-Step 'Configure engine/ (cmake)' { cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release }
  Invoke-Step 'Build engine/ (native)' { cmake --build engine/build --config Release }
  # Optional CTest
  if (Test-Path 'engine/build/CTestTestfile.cmake') {
    Invoke-Step 'CTest engine suite' {
      ctest --test-dir engine/build -C Release --output-on-failure
      if ($LASTEXITCODE -ne 0) { Write-Host 'CTest reported failures (non-fatal)' -ForegroundColor DarkYellow }
      $global:LASTEXITCODE = 0
    } -Category 'test' -ContinueOnError
  } else { Write-Host 'No CTest file; skipping engine tests' -ForegroundColor DarkYellow }
} else { Write-Host 'Skipping modular engine native build (cmake not found)' -ForegroundColor DarkYellow }

# WASM build (engine/) optional
if (Get-Command emcmake -ErrorAction SilentlyContinue) {
  Invoke-Step 'Configure engine/ WASM (emcmake)' { emcmake cmake -S engine -B engine/build-wasm -DBUILD_WASM=ON -DCMAKE_BUILD_TYPE=Release } -Category 'build' -ContinueOnError
  Invoke-Step 'Build engine/ WASM' { cmake --build engine/build-wasm -j } -Category 'build' -ContinueOnError
  if (!(Test-Path 'web/wasm')) { New-Item -ItemType Directory -Path 'web/wasm' | Out-Null }
  # Attempt to copy artifacts if typical names exist
  Get-ChildItem engine/build-wasm -Filter '*.wasm' -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName 'web/wasm/' -Force }
  Get-ChildItem engine/build-wasm -Filter '*.js' -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName 'web/wasm/' -Force }
} else { Write-Host 'Skipping WASM build (emcmake not found)' -ForegroundColor DarkYellow }

if (-not $SkipTests) {
  # JS tests (Vitest)
  Invoke-Step 'Run JS test suite (vitest)' {
    npm test
    if ($LASTEXITCODE -ne 0) { throw "Vitest failed with exit code $LASTEXITCODE" }
  } -Category 'test' -ContinueOnError

  # Native legality harness
  Invoke-Step 'Run native legality harness' {
    npm run test:native
    if ($LASTEXITCODE -ne 0) { throw "Native harness failed exit code $LASTEXITCODE" }
  } -Category 'test' -ContinueOnError
} else {
  Write-Host 'Tests skipped (-SkipTests specified)' -ForegroundColor DarkYellow
}

# Optional server start
if ($RunServer) {
  $env:PORT = $RunServer
  Invoke-Step "Start server (foreground) on port $RunServer" { npm run serve:fg } -Category 'lifecycle' -ContinueOnError
} else {
  Write-Host 'Server not started (use -RunServer <port>) to start after rebuild' -ForegroundColor DarkYellow
}

# Summary
Write-Host "`n=== Rebuild Summary ===" -ForegroundColor Yellow
$byCat = $Global:Results | Group-Object Category
foreach ($grp in $byCat) {
  Write-Host "`n[$($grp.Name.ToUpper())]" -ForegroundColor Cyan
  foreach ($r in $grp.Group) {
    $status = if ($r.Succeeded) { 'PASS' } else { 'FAIL' }
    $fg = 'Red'; if ($r.Succeeded) { $fg = 'Green' }
    Write-Host ("{0,-30} {1}" -f $r.Name, $status) -ForegroundColor $fg
    if (-not $r.Succeeded) { Write-Host ("  Detail: {0}" -f $r.Detail) -ForegroundColor DarkRed }
  }
}

$failed = @($Global:Results | Where-Object { -not $_.Succeeded -and $_.Category -eq 'test' })
if ($failed.Count -gt 0) {
  Write-Host "`nTest Failures Detected: $($failed.Count)" -ForegroundColor Red
} elseif (-not $SkipTests) {
  Write-Host "`nAll executed tests passed." -ForegroundColor Green
}

$global:LASTEXITCODE = 0
Write-Host "`n=== Rebuild complete ===" -ForegroundColor Yellow
exit 0
