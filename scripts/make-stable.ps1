param(
  [string]$SourceWeb = "${PSScriptRoot}\..\web",
  [string]$DestRoot = "${PSScriptRoot}\..\manual_test_env",
  [switch]$Build,   # Build native + wasm (if toolchains present) then snapshot
  [switch]$Native,  # Only perform native CMake build before snapshot
  [switch]$Wasm,    # Only perform WASM build before snapshot
  [switch]$Strict   # Treat missing toolchain as fatal for the requested build(s)
)

$ErrorActionPreference = 'Stop'

function Copy-Clean {
  param([string]$src,[string]$dst)
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item -Recurse -Force "$src\*" $dst
}

function Invoke-NativeBuild {
  $engineDir = Resolve-Path (Join-Path $PSScriptRoot '..\engine')
  $buildDir = Join-Path $engineDir 'build'
  if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    if ($Strict) { throw "cmake not found; install CMake or run without -Strict." } else { Write-Warning "cmake not found; skipping native build."; return }
  }
  if (-not (Test-Path $buildDir)) { New-Item -ItemType Directory -Force -Path $buildDir | Out-Null }
  Write-Host "[make-stable] Native build (Release)..."
  Push-Location $buildDir | Out-Null
  & cmake .. -DCMAKE_BUILD_TYPE=Release | Write-Host
  & cmake --build . --config Release --target chess_engine | Write-Host
  if (Test-Path (Join-Path $buildDir 'chess_tests.exe')) { & ctest --output-on-failure -C Release | Write-Host }
  Pop-Location | Out-Null
  Write-Host "[make-stable] Native build complete. Artifacts in engine/build." 
}

function Invoke-WasmBuild {
  $engineDir = Resolve-Path (Join-Path $PSScriptRoot '..\engine')
  $webWasmDir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\web')) 'wasm'
  if (-not (Test-Path $webWasmDir)) { New-Item -ItemType Directory -Force -Path $webWasmDir | Out-Null }

  $empp = Get-Command em++ -ErrorAction SilentlyContinue
  if (-not $empp) {
    if ($Strict) { throw "em++ not found. Install/activate Emscripten or rerun without -Strict." }
    Write-Warning "em++ not found; skipping WASM build (use -Strict to make this fatal)."
    return
  }

  Write-Host "[make-stable] Building WASM via em++..."
  $argsList = @(
    '-std=c++17','-O3',
    (Join-Path $engineDir 'src\example.cpp'),
    (Join-Path $engineDir 'src\fen.cpp'),
    (Join-Path $engineDir 'src\descendants.cpp'),
    ("-I" + (Join-Path $engineDir 'include')),
    '-sEXPORTED_FUNCTIONS=["_evaluate_fen","_engine_version","_generate_descendants","_generate_descendants_opts","_list_legal_moves","_apply_move_if_legal"]',
    '-sEXPORTED_RUNTIME_METHODS=["cwrap"]',
    '-sMODULARIZE=1','-sEXPORT_NAME=EngineModule',
    '-o', (Join-Path $webWasmDir 'engine.js')
  )

  # Ensure emsdk environment provides Python (EMSDK_PYTHON) if not already active
  if (-not $env:EMSDK_PYTHON) {
    try {
      $emscriptenDir = Split-Path -Parent $empp.Path           # .../upstream/emscripten
      $upstreamDir   = Split-Path -Parent $emscriptenDir        # .../upstream
      $emsdkRoot     = Split-Path -Parent $upstreamDir          # .../emsdk
      $emsdkEnvPs1   = Join-Path $emsdkRoot 'emsdk_env.ps1'
      if (Test-Path $emsdkEnvPs1) {
        & $emsdkEnvPs1 | Out-Null
      }
    } catch {
      Write-Host "[make-stable] Warning: Couldn't auto-activate emsdk environment. Continuing..."
    }
  }

  # Invoke em++ (PowerShell entrypoint .ps1) directly to avoid Win32 association issues
  Push-Location $engineDir
  & $empp.Path @argsList
  $exit = $LASTEXITCODE
  Pop-Location
  if ($exit -ne 0) { throw "em++ build failed with exit code $exit." }

  # engine.wasm should be produced alongside engine.js by em++
  if (-not (Test-Path (Join-Path $webWasmDir 'engine.wasm'))) {
    $msg = "em++ completed but engine.wasm not found; verify your Emscripten installation and outputs."
    if ($Strict) { throw $msg } else { Write-Warning $msg }
  }
  Write-Host "[make-stable] WASM build complete."
}

Write-Host "Creating stable snapshot..."

# 0) Optional build step
if ($Build) {
  Invoke-NativeBuild
  Invoke-WasmBuild
} elseif ($Native) {
  Invoke-NativeBuild
} elseif ($Wasm) {
  Invoke-WasmBuild
}

# 1) Mirror web/ into manual_test_env/web so relative paths are identical
$destWeb = Join-Path $DestRoot 'web'
Copy-Clean -src $SourceWeb -dst $destWeb

# 2) Ensure wasm artifacts present if they exist in known places
$wasmDest = Join-Path $destWeb 'wasm'
New-Item -ItemType Directory -Force -Path $wasmDest | Out-Null
$possibleEngineJs = @(
  Join-Path $SourceWeb 'wasm\engine.js'
)
$possibleEngineWasm = @(
  Join-Path $SourceWeb 'wasm\engine.wasm'
)

$copied = $false
foreach ($p in $possibleEngineJs) { if (Test-Path $p) { Copy-Item -Force $p $wasmDest; $copied = $true } }
foreach ($p in $possibleEngineWasm) { if (Test-Path $p) { Copy-Item -Force $p $wasmDest; $copied = $true } }

if (-not $copied) {
  Write-Warning "No engine.js/engine.wasm found. UI will run with engine disabled. Build WASM per BUILDING.md or rerun with -Wasm or -Build to enable engine features."
}

# 3) Drop a README in manual_test_env with usage notes
$readmePath = Join-Path $DestRoot 'README.md'
@"
Manual Test Environment
=======================

This snapshot mirrors the 'web/' directory under manual_test_env/web so relative paths remain correct.
Open manual_test_env/web/index.html with your Live Server extension for a stable test instance.

WASM artifacts:
- If 'web/wasm/engine.js' and 'web/wasm/engine.wasm' existed at snapshot time, they were copied.
- If not present, the UI runs in JS-stub mode (EngineBridge will show stub version). Build per BUILDING.md to enable WASM.

To regenerate this snapshot after changes:
- Run scripts/make-stable.ps1 again.

This folder is ignored by git (.gitignore includes manual_test_env/).
"@ | Set-Content -Encoding UTF8 $readmePath

Write-Host "Stable snapshot created at: $DestRoot"
