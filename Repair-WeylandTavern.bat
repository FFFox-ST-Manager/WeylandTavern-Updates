@echo off
title Weyland Tavern Repair

if not exist "%~dp0Repair-WeylandTavern.cjs" (
    echo Repair-WeylandTavern.cjs was not found next to this script.
    echo Please make sure the Repair-WeylandTavern.cjs file is there.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is required to run the repair tool.
    echo Please run the Weyland Tavern installer first, then try again.
    pause
    exit /b 1
)

node "%~dp0Repair-WeylandTavern.cjs" %* & exit /b
