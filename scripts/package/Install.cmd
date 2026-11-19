@echo off
rem Double-click to install (or update) Cockpit for this Windows user. No admin rights needed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
