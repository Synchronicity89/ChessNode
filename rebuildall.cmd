@echo off
setlocal
:: Windows batch shim: allows running `rebuildall` from CMD or PowerShell
:: Pass all args through to PowerShell script
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rebuild-all.ps1" %*
endlocal
