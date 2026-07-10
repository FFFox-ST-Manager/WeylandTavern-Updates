@echo off
title Weyland Tavern

if not exist "%~dp0SillyTavern/Start-WeylandTavern.js" (
    echo Start-WeylandTavern.js was not found in the SillyTavern directory.
    echo Please make sure the Start-WeylandTavern.js file is there.
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

node "%~dp0SillyTavern/Start-WeylandTavern.js" %* & exit /b
