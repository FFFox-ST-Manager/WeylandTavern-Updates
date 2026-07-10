@echo off
title Weyland Tavern Repair

if not exist "%~dp0SillyTavern/Repair-WeylandTavern.js" (
    echo Repair-WeylandTavern.js was not found in the SillyTavern directory.
    echo Please make sure the Repair-WeylandTavern.js file is there.
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

node "%~dp0SillyTavern/Repair-WeylandTavern.js" %* & exit /b
