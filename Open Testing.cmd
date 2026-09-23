@echo off
cd /d "%~dp0"
node scripts/testing.mjs
if errorlevel 1 pause
