param(
    [int]$Port = 8080,
    [string]$Root = "manual_test_env/web"
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$exe = Join-Path $root 'server\bin\chess_server.exe'

if (!(Test-Path $exe)) {
    Write-Host "Server binary not found, building..." -ForegroundColor Yellow
    & (Join-Path $root 'scripts\build-server.ps1')
}

if (!(Test-Path $exe)) { throw "Server binary missing: $exe" }

Write-Host "Starting server on http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host "Serving root: $Root" -ForegroundColor Green

# Pass args: <port> <root>
& $exe $Port $Root
