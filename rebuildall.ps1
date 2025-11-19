# Thin wrapper so you can run ./rebuildall.ps1 with the same switches
$scriptPath = Join-Path -Path $PSScriptRoot -ChildPath 'rebuild-all.ps1'
& $scriptPath @args