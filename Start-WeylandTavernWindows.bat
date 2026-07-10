@echo off
title Weyland Tavern

if not exist "%~dp0Start-WeylandTavern.cjs" (
    echo Start-WeylandTavern.cjs was not found next to this launcher.
    echo Please make sure the Start-WeylandTavern.cjs file is there.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is required to run Weyland Tavern.
    echo Please run the Weyland Tavern installer first, then try again.
    pause
    exit /b 1
)

node "%~dp0Start-WeylandTavern.cjs" %* & exit /b
