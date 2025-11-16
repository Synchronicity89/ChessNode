param(
  [int]$Port = 8080,
  [string]$Root = "web"
)

$ErrorActionPreference = 'Stop'

function Stop-PortListeners([int]$p){
  $stopped = $false
  try {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
      $procIds = $conns.OwningProcess | Sort-Object -Unique
      foreach($procId in $procIds){
        try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; Write-Host "Stopped PID $procId on port $p" -ForegroundColor Yellow; $stopped=$true } catch {}
      }
    }
  } catch {}

  if (-not $stopped) {
    try {
      $lines = netstat -ano | Select-String -Pattern ":$p"
      if ($lines) {
        $procIds = @()
        foreach($ln in $lines){
          $parts=$ln.ToString().Trim() -split '\s+'
          if ($parts.Length -ge 5) { $id=$parts[-1]; if ($id -match '^[0-9]+$') { $procIds += [int]$id } }
        }
        $procIds = $procIds | Sort-Object -Unique
        foreach($procId in $procIds){
          try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; Write-Host "Stopped PID $procId via netstat parse" -ForegroundColor Yellow } catch {}
        }
      } else {
        Write-Host "No process using port $p" -ForegroundColor Gray
      }
    } catch {}
  }
}

# Resolve repo root
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$nativeExe = Join-Path $repoRoot 'server\bin\chess_server.exe'
$staticPs1 = Join-Path $repoRoot 'scripts\static-server.ps1'

Write-Host "Ensuring port $Port is free…" -ForegroundColor Cyan
Stop-PortListeners -p $Port

# Small delay to allow socket closure
Start-Sleep -Milliseconds 150

$url = "http://127.0.0.1:$Port/"
if (Test-Path $nativeExe) {
  Write-Host "Starting native server: $nativeExe" -ForegroundColor Green
  Write-Host "Root: $Root | URL: $url" -ForegroundColor Green
  & $nativeExe $Port $Root
} elseif (Test-Path $staticPs1) {
  Write-Host "Native server not found. Starting static server: $staticPs1" -ForegroundColor Yellow
  Write-Host "Root: $Root | URL: $url" -ForegroundColor Green
  PowerShell -NoProfile -ExecutionPolicy Bypass -File $staticPs1 -Port $Port -Root $Root
} else {
  throw "No server available. Missing: $nativeExe and $staticPs1"
}
