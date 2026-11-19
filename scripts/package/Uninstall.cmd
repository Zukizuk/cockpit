@echo off
rem Double-click to uninstall Cockpit. Your notes and board are kept.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
echo.
pause
