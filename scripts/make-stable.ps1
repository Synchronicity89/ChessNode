param(
  [string]$SourceWeb = "${PSScriptRoot}\..\web",
  [string]$DestRoot = "${PSScriptRoot}\..\manual_test_env",
  [switch]$Build # When provided, compile WASM (em++) before snapshot
)

$ErrorActionPreference = 'Stop'

function Copy-Clean {
  param([string]$src,[string]$dst)
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item -Recurse -Force "$src\*" $dst
}

function Invoke-WasmBuild {
  $engineDir = Resolve-Path (Join-Path $PSScriptRoot '..\engine')
  $webWasmDir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\web')) 'wasm'
  if (-not (Test-Path $webWasmDir)) { New-Item -ItemType Directory -Force -Path $webWasmDir | Out-Null }

  $empp = Get-Command em++ -ErrorAction SilentlyContinue
  if (-not $empp) {
    throw "em++ not found. Please install/activate Emscripten (emsdk) so 'em++' is on PATH, then retry with -Build. See BUILDING.md."
  }

  Write-Host "[make-stable] Building WASM via em++..."
  $argsList = @(
    '-std=c++17','-O3',
    (Join-Path $engineDir 'src\example.cpp'),
    (Join-Path $engineDir 'src\fen.cpp'),
    ("-I" + (Join-Path $engineDir 'include')),
    '-sEXPORTED_FUNCTIONS=["_evaluate_fen","_engine_version"]',
    '-sEXPORTED_RUNTIME_METHODS=["cwrap"]',
    '-sMODULARIZE=1','-sEXPORT_NAME=EngineModule',
    '-o', (Join-Path $webWasmDir 'engine.js')
  )

  $proc = Start-Process -FilePath $empp.Path -ArgumentList $argsList -NoNewWindow -Wait -PassThru -WorkingDirectory $engineDir
  if ($proc.ExitCode -ne 0) { throw "em++ build failed with exit code $($proc.ExitCode)." }

  # engine.wasm will be produced alongside engine.js by em++
  if (-not (Test-Path (Join-Path $webWasmDir 'engine.wasm'))) {
    Write-Warning "em++ completed but engine.wasm not found; verify your Emscripten installation."
  }
  Write-Host "[make-stable] WASM build complete."
}

Write-Host "Creating stable snapshot..."

# 0) Optional build step
if ($Build) {
  try { Invoke-WasmBuild } catch { Write-Error $_; throw }
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
  Write-Warning "No engine.js/engine.wasm found. Pages will run in JS-stub mode. Build WASM per BUILDING.md to enable engine features."
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
