param(
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$src = Join-Path $root 'server\src\main.cpp'
$outDir = Join-Path $root 'server\bin'
$outExe = Join-Path $outDir 'chess_server.exe'

if ($Clean) {
    if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
}
if (!(Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

if (!(Test-Path $src)) { throw "Source not found: $src" }

$cl = Get-Command cl -ErrorAction SilentlyContinue
$gpp = Get-Command g++ -ErrorAction SilentlyContinue

if ($cl) {
    Write-Host "Building with MSVC cl" -ForegroundColor Cyan
    Push-Location $outDir
    try {
        & cl /nologo /std:c++17 /O2 /EHsc `
            "$src" /Fe:"$outExe" /link Ws2_32.lib | Out-Host
        if (!(Test-Path $outExe)) { throw "Build failed (cl)" }
    }
    finally { Pop-Location }
}
elseif ($gpp) {
    Write-Host "Building with g++ (MinGW)" -ForegroundColor Cyan
    & $gpp -std=c++17 -O2 "$src" -o "$outExe" -lws2_32
    if (!(Test-Path $outExe)) { throw "Build failed (g++)" }
}
else {
    throw "No suitable C++ compiler found. Use VS Developer Prompt (cl) or install MinGW (g++)."
}

Write-Host "Built: $outExe" -ForegroundColor Green
