@echo off
if not "%OS%"=="Windows_NT" (
    echo This start script only works on Windows.
    echo Use the script for Other systems instead.
    pause
    exit /b
)
title Weyland Tavern

REM Enable ANSI color support in legacy consoles (Windows Terminal has it already)
reg add HKCU\Console /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >nul 2>&1

REM Grab the ESC character for ANSI sequences
for /F "tokens=1,2 delims=#" %%a in ('"prompt #$H#$E# & echo on & for %%b in (1) do rem"') do set "ESC=%%b"

REM Weyland palette (matches the Weyland-Router extension theme)
set "R=%ESC%[0m"
set "WINE=%ESC%[38;2;180;38;58m"
set "PINK=%ESC%[38;2;224;68;92m"
set "ROSE=%ESC%[38;2;255;150;165m"
set "DIM=%ESC%[38;2;125;125;125m"
set "GRY=%ESC%[38;2;190;190;190m"
set "GRN=%ESC%[38;2;97;191;124m"
set "AMB=%ESC%[38;2;230;180;80m"
set "BLD=%ESC%[1m"

cls
echo.
echo   %WINE%ÛÛ»    ÛÛ»ÛÛÛÛÛÛÛ»ÛÛ»   ÛÛ»ÛÛ»      ÛÛÛÛÛ» ÛÛÛ»   ÛÛ»ÛÛÛÛÛÛ»%R%
echo   %WINE%ÛÛº    ÛÛºÛÛÉÍÍÍÍ¼ÈÛÛ» ÛÛÉ¼ÛÛº     ÛÛÉÍÍÛÛ»ÛÛÛÛ»  ÛÛºÛÛÉÍÍÛÛ»%R%
echo   %PINK%ÛÛº Û» ÛÛºÛÛÛÛÛ»   ÈÛÛÛÛÉ¼ ÛÛº     ÛÛÛÛÛÛÛºÛÛÉÛÛ» ÛÛºÛÛº  ÛÛº%R%
echo   %PINK%ÛÛºÛÛÛ»ÛÛºÛÛÉÍÍ¼    ÈÛÛÉ¼  ÛÛº     ÛÛÉÍÍÛÛºÛÛºÈÛÛ»ÛÛºÛÛº  ÛÛº%R%
echo   %ROSE%ÈÛÛÛÉÛÛÛÉ¼ÛÛÛÛÛÛÛ»   ÛÛº   ÛÛÛÛÛÛÛ»ÛÛº  ÛÛºÛÛº ÈÛÛÛÛºÛÛÛÛÛÛÉ¼%R%
echo   %ROSE% ÈÍÍ¼ÈÍÍ¼ ÈÍÍÍÍÍÍ¼   ÈÍ¼   ÈÍÍÍÍÍÍ¼ÈÍ¼  ÈÍ¼ÈÍ¼  ÈÍÍÍ¼ÈÍÍÍÍÍ¼%R%
echo.
echo   %DIM%ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ%R%  %BLD%%PINK%T A V E R N%R%  %DIM%ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ%R%
echo             %DIM%V5.0 - by Kressa, Lucky Paw, Shiru ^& FFFox%R%
echo.
echo   %WINE%ÚÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ¿%R%
echo   %WINE%³%R%  %AMB%þ%R%  %GRY%Keep this window open while using Weyland Tavern.%R%     %WINE%³%R%
echo   %WINE%³%R%     %DIM%Closing it will shut down the server.%R%                 %WINE%³%R%
echo   %WINE%ÀÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÙ%R%
echo.

REM ================= git update check =================
REM Label-based flow: no multi-line ( ) blocks, no delayed expansion.
REM Every line parses independently, so a bad line fails visibly at
REM its own position instead of killing the whole section as one
REM parse unit.

where git >nul 2>&1
if errorlevel 1 goto GitMissing

set "CURRENT_BRANCH="
for /f "tokens=*" %%a in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "CURRENT_BRANCH=%%a"

set "CURRENT_VERSION="
for /f "tokens=*" %%a in ('git rev-parse --short HEAD 2^>nul') do set "CURRENT_VERSION=%%a"
if not defined CURRENT_VERSION set "CURRENT_VERSION=unknown"

echo   %DIM%ú%R%  %GRY%Checking for Weyland Tavern updates...%R%
echo.

git fetch >nul 2>&1
set "NEW_VERSION="
for /f "tokens=*" %%a in ('git rev-parse --short origin/%CURRENT_BRANCH% 2^>nul') do set "NEW_VERSION=%%a"
if not defined NEW_VERSION set "NEW_VERSION=unknown"

if "%CURRENT_VERSION%"=="%NEW_VERSION%" goto GitUpToDate

echo   %PINK%*%R%  %BLD%%GRY%Update found.%R%
echo      %DIM%Current version:%R% %GRY%%CURRENT_VERSION%%R%
echo      %DIM%New version:    %R% %PINK%%NEW_VERSION%%R%
echo.
set "apply_update="
set /p apply_update="  %PINK%¯%R% Apply update? (Y/N) [Default: Y] "
if not defined apply_update set "apply_update=Y"
if /i not "%apply_update%"=="Y" goto GitSkipUpdate

echo.
echo   %DIM%ú%R%  %GRY%Applying update...%R%
git pull > SillyTavern\WTUpdate.log 2>&1
if not errorlevel 1 goto GitUpdateOK

echo.
echo   %AMB%­%R%  %AMB%Update failed - there may be file conflicts.%R%
echo      %DIM%Generating log file: SillyTavern\WTUpdate.log%R%
echo.
git --no-pager diff --compact-summary
echo.
set "do_reset="
set /p do_reset="  %PINK%¯%R% Reset to latest official version? Your personal files won't be affected. (Y/N) [Default: Y] "
if not defined do_reset set "do_reset=Y"
if /i not "%do_reset%"=="Y" goto GitAskContinue

echo.
echo   %DIM%ú%R%  %GRY%Resetting to latest version...%R%
git merge --abort >nul 2>&1
for /f "tokens=*" %%f in ('git diff --name-only --diff-filter^=U 2^>nul') do (git checkout --theirs "%%f" >nul 2>&1 & git add "%%f" >nul 2>&1)
git reset --hard origin/%CURRENT_BRANCH% >nul 2>&1
if errorlevel 1 goto GitResetFailed
echo   %GRN%û%R%  %GRN%Update applied successfully.%R%
goto GitDone

:GitResetFailed
echo   %WINE%x%R%  %WINE%Reset failed. Please contact support.%R%
echo      %DIM%Log saved to: SillyTavern\WTUpdate.log%R%

:GitAskContinue
set "keepgoing="
set /p keepgoing="  %PINK%¯%R% Continue without update? (Y/N) [Default: N] "
if not defined keepgoing set "keepgoing=N"
if /i "%keepgoing%"=="N" exit /b 0
goto GitDone

:GitUpdateOK
echo   %GRN%û%R%  %GRN%Update applied successfully.%R%
goto GitDone

:GitSkipUpdate
echo   %DIM%ú%R%  %GRY%Proceeding without update...%R%
goto GitDone

:GitUpToDate
echo   %GRN%û%R%  %GRY%Weyland Tavern is up to date.%R%  %DIM%(version %CURRENT_VERSION%)%R%
goto GitDone

:GitMissing
echo   %AMB%­%R%  %GRY%Git is not installed - cannot check for updates.%R%
echo      %DIM%Please install git manually to receive the latest updates.%R%
set "continue_nogit="
set /p continue_nogit="  %PINK%¯%R% Continue without update checking? (Y/N) [Default: Y] "
if not defined continue_nogit set "continue_nogit=Y"
if /i "%continue_nogit%"=="N" exit /b 0

:GitDone

echo.
echo   %DIM%ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ%R%
echo.

:: Install npm dependencies
pushd %~dp0
if exist "SillyTavern\config.yaml" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Join-Path (Get-Location) 'SillyTavern\config.yaml'; if (Test-Path -LiteralPath $p) { $c = [System.IO.File]::ReadAllText($p); if ($c -match '(?m)^[ \t]*enableCorsProxy:[^\r\n]*') { $c = $c -replace '(?m)^[ \t]*enableCorsProxy:[^\r\n]*', 'enableCorsProxy: true' } else { $c = $c.TrimEnd() + [Environment]::NewLine + 'enableCorsProxy: true' + [Environment]::NewLine }; [System.IO.File]::WriteAllText($p, $c) }"
)

if not exist "SillyTavern\server.js" goto MissingServer

echo   %DIM%ú%R%  %GRY%Preparing dependencies...%R% %DIM%(first run can take a few minutes)%R%
set NODE_ENV=production
cd SillyTavern
call npm install --no-audit --no-fund --loglevel=error --no-progress --omit=dev >nul 2>&1
if errorlevel 1 goto NpmWarn
goto NpmDone

:NpmWarn
echo   %AMB%­%R%  %GRY%Dependency install reported a problem - starting anyway...%R%

:NpmDone
echo.
echo   %DIM%ú%R%  %GRY%Starting the Weyland Tavern server...%R%
echo.

:: Close any stale server still holding port 8000 (e.g. orphaned from a previous session)
set "STALE_PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000.*LISTENING"') do set "STALE_PID=%%p"
if defined STALE_PID taskkill /F /PID %STALE_PID% >nul 2>&1
if defined STALE_PID timeout /t 2 /nobreak >nul

:: Start the SillyTavern server
start /b node server.js --listen true --listen-host 0.0.0.0 --listen-port 8000 %* >nul 2>&1

:: Wait until the server is actually listening before declaring it active.
:: On the very first launch, SillyTavern downloads extra components
:: (image captioning model and such) BEFORE it starts listening, which
:: can take several minutes - the old launcher claimed the server was
:: up while that was still happening.
echo   %DIM%ú%R%  %GRY%Waiting for the server to come online...%R%
echo      %DIM%First launch can take several minutes while extra%R%
echo      %DIM%components download - this is normal. Hang tight~%R%
echo.
set /a WAIT_TICKS=0

:WaitForServer
netstat -ano | findstr ":8000.*LISTENING" >nul 2>&1
if not errorlevel 1 goto ServerUp
set /a WAIT_TICKS+=1
if %WAIT_TICKS% geq 300 goto ServerSlow
timeout /t 2 /nobreak >nul
goto WaitForServer

:ServerSlow
echo   %AMB%­%R%  %GRY%The server is taking unusually long to start ^(10+ minutes^).%R%
echo      %DIM%It may still be downloading, or something went wrong.%R%
echo      %DIM%If this keeps happening, please contact support.%R%
echo.
goto ServerPrompt

:ServerUp
echo   %WINE%ÚÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ¿%R%
echo   %WINE%³%R%                                                           %WINE%³%R%
echo   %WINE%³%R%      %GRN%þ%R%  %BLD%%GRY%WEYLAND TAVERN IS NOW ACTIVE%R%                      %WINE%³%R%
echo   %WINE%³%R%         %DIM%Server running on%R% %PINK%localhost:8000%R%                  %WINE%³%R%
echo   %WINE%³%R%                                                           %WINE%³%R%
echo   %WINE%ÀÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÙ%R%
echo.
echo      %DIM%A browser window should open automatically.%R%
echo.
echo   %AMB%þ%R%  %GRY%Reminder: keep this window open!%R%
echo.

:ServerPrompt
echo   %DIM%Press any key to shut down and close Weyland Tavern...%R%
pause >nul

echo.
echo   %DIM%ú%R%  %GRY%Shutting down the Weyland Tavern server... see you soon~%R%
set "WT_PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000.*LISTENING"') do set "WT_PID=%%p"
if defined WT_PID taskkill /F /PID %WT_PID% >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq Weyland Tavern" >nul 2>&1
exit /b 0

:MissingServer
echo   %WINE%x%R%  %WINE%SillyTavern\server.js was not found next to this launcher.%R%
echo      %DIM%Make sure the launcher sits in your WeylandTavern folder.%R%
pause
exit /b 1
