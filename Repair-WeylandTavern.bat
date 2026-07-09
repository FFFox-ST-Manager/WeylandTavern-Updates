@echo off
if not "%OS%"=="Windows_NT" (
    echo This script only works on Windows.
    pause
    exit /b
)
title Weyland Tavern Repair

REM ÄÄ Self-update guard ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ
REM The git reset below may replace this very file. cmd reads batch files
REM by byte offset while running, so run from a temp copy instead.
if not defined WT_HOME set "WT_HOME=%~dp0"
if /i "%~f0"=="%TEMP%\WT-Repair.bat" goto RunningFromTemp
copy /y "%~f0" "%TEMP%\WT-Repair.bat" >nul
cd /d "%WT_HOME%"
call "%TEMP%\WT-Repair.bat" %*
exit /b
:RunningFromTemp
cd /d "%WT_HOME%"

REM Enable ANSI color support in legacy consoles (Windows Terminal has it already)
reg add HKCU\Console /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >nul 2>&1

REM Detect console codepage - CJK locales (932/936/949/950) treat certain
REM high-bit bytes as multi-byte lead bytes, which eats our '%' delimiters
REM inside the box-drawing header and corrupts the batch parser. Fall back
REM to a plain 7-bit ASCII header on those systems.
set "USE_FANCY=1"
for /f "tokens=* usebackq" %%a in (`chcp 2^>nul`) do echo(%%a| findstr /c:" 932" /c:" 936" /c:" 949" /c:" 950" >nul 2>&1 && set "USE_FANCY="

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
if not defined USE_FANCY goto WTPlainHeader
echo.
echo   %WINE%ÛÛ»    ÛÛ»ÛÛÛÛÛÛÛ»ÛÛ»   ÛÛ»ÛÛ»      ÛÛÛÛÛ» ÛÛÛ»   ÛÛ»ÛÛÛÛÛÛ»%R%
echo   %WINE%ÛÛº    ÛÛºÛÛÉÍÍÍÍ¼ÈÛÛ» ÛÛÉ¼ÛÛº     ÛÛÉÍÍÛÛ»ÛÛÛÛ»  ÛÛºÛÛÉÍÍÛÛ»%R%
echo   %PINK%ÛÛº Û» ÛÛºÛÛÛÛÛ»   ÈÛÛÛÛÉ¼ ÛÛº     ÛÛÛÛÛÛÛºÛÛÉÛÛ» ÛÛºÛÛº  ÛÛº%R%
echo   %PINK%ÛÛºÛÛÛ»ÛÛºÛÛÉÍÍ¼    ÈÛÛÉ¼  ÛÛº     ÛÛÉÍÍÛÛºÛÛºÈÛÛ»ÛÛºÛÛº  ÛÛº%R%
echo   %ROSE%ÈÛÛÛÉÛÛÛÉ¼ÛÛÛÛÛÛÛ»   ÛÛº   ÛÛÛÛÛÛÛ»ÛÛº  ÛÛºÛÛº ÈÛÛÛÛºÛÛÛÛÛÛÉ¼%R%
echo   %ROSE% ÈÍÍ¼ÈÍÍ¼ ÈÍÍÍÍÍÍ¼   ÈÍ¼   ÈÍÍÍÍÍÍ¼ÈÍ¼  ÈÍ¼ÈÍ¼  ÈÍÍÍ¼ÈÍÍÍÍÍ¼%R%
echo.
echo   %DIM%ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ%R%  %BLD%%PINK%R E P A I R%R%  %DIM%ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ%R%
echo             %DIM%V5.0 - by Kressa, Lucky Paw, Shiru ^& FFFox%R%
echo.
echo   %WINE%ÚÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ¿%R%
echo   %WINE%³%R%  %AMB%ş%R%  %GRY%This tool rebuilds a broken Weyland Tavern install%R%    %WINE%³%R%
echo   %WINE%³%R%     %GRY%after a wonky update.%R%                                 %WINE%³%R%
echo   %WINE%³%R%                                                           %WINE%³%R%
echo   %WINE%³%R%  %GRN%ş%R%  %GRY%KEEPS: chats, personas, characters, lorebooks,%R%        %WINE%³%R%
echo   %WINE%³%R%     %GRY%settings, themes and backgrounds.%R%                     %WINE%³%R%
echo   %WINE%³%R%                                                           %WINE%³%R%
echo   %WINE%³%R%  %PINK%ş%R%  %GRY%RESETS: all app files back to the latest official%R%     %WINE%³%R%
echo   %WINE%³%R%     %GRY%version, and reinstalls dependencies from scratch.%R%    %WINE%³%R%
echo   %WINE%ÀÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÙ%R%
echo.

goto WTHeaderDone

:WTPlainHeader
echo.
echo   %WINE%================================================================%R%
echo.
echo       %BLD%%PINK%W E Y L A N D   T A V E R N%R%
echo             %BLD%%WINE%R E P A I R%R%
echo.
echo                       %GRY%V5.0%R%
echo         %DIM%by Kressa, Lucky Paw, Shiru ^& FFFox%R%
echo.
echo   %WINE%================================================================%R%
echo.
echo      %AMB%[!]%R%  %GRY%This tool rebuilds a broken Weyland Tavern install%R%
echo           %GRY%after a wonky update.%R%
echo.
echo      %GRN%[+]%R%  %GRY%KEEPS: chats, personas, characters, lorebooks,%R%
echo           %GRY%settings, themes and backgrounds.%R%
echo.
echo      %PINK%[*]%R%  %GRY%RESETS: all app files back to the latest official%R%
echo           %GRY%version, and reinstalls dependencies from scratch.%R%
echo.

:WTHeaderDone

REM --- Locate the repo root ---
pushd "%WT_HOME%"

REM Verify we're in a git repo
git rev-parse --git-dir >nul 2>&1
if not errorlevel 1 goto RepoOK
echo   %WINE%x%R%  %WINE%This doesn't appear to be the Weyland Tavern folder.%R%
echo      %DIM%Place this script next to your launcher ^(beside the%R%
echo      %DIM%SillyTavern folder^) and run it again.%R%
echo.
pause
exit /b 1

:RepoOK
set "BRANCH="
for /f "tokens=*" %%a in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%a"
echo   %DIM%*%R%  %GRY%Detected branch:%R% %PINK%%BRANCH%%R%
echo.

set "confirm="
set /p confirm="  %PINK%¯%R% Start the repair? (Y/N) [Default: Y] "
if not defined confirm set "confirm=Y"
if /i not "%confirm%"=="Y" goto ExitNoChanges

REM --- Optional safety backup of user data ---
echo.
echo   %GRY%Before repairing, a backup copy of your personal data can be%R%
echo   %GRY%saved next to this script. Recommended, but it can take a few%R%
echo   %GRY%minutes and some disk space if you have a lot of chats.%R%
echo.
set "do_backup="
set /p do_backup="  %PINK%¯%R% Back up personal data first? (Y/N) [Default: Y] "
if not defined do_backup set "do_backup=Y"
if /i not "%do_backup%"=="Y" goto BackupDone

set "STAMP="
for /f "tokens=*" %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%t"
if not defined STAMP set "STAMP=unknown"
set "BACKUP_DIR=%WT_HOME%WT-DataBackup-%STAMP%"
echo.
echo   %DIM%*%R%  %GRY%Backing up SillyTavern\data to:%R%
echo      %PINK%%BACKUP_DIR%%R%
robocopy "SillyTavern\data" "%BACKUP_DIR%" /E /NFL /NDL /NJH /NJS /NP >nul 2>&1
if %ERRORLEVEL% geq 8 goto BackupFailed
echo   %GRN%+%R%  %GRY%Backup complete.%R%
goto BackupDone

:BackupFailed
echo   %AMB%­%R%  %AMB%The backup did not complete cleanly.%R%
echo.
set "keepgoing="
set /p keepgoing="  %PINK%¯%R% Continue the repair anyway? (Y/N) [Default: N] "
if not defined keepgoing set "keepgoing=N"
if /i not "%keepgoing%"=="Y" goto ExitNoChanges

:BackupDone
echo.
echo   %DIM%ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ%R%
echo.

REM --- Stop any running server so files aren't locked ---
set "WT_PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000.*LISTENING"') do set "WT_PID=%%p"
if not defined WT_PID goto ServerStopped
echo   %DIM%*%R%  %GRY%Closing the running Weyland Tavern server...%R%
taskkill /F /PID %WT_PID% >nul 2>&1
timeout /t 2 /nobreak >nul

:ServerStopped

REM --- Clear any stuck merge state ---
echo   %DIM%[1/4]%R%  %GRY%Clearing any stuck update state...%R%
git merge --abort >nul 2>&1
for /f "tokens=*" %%f in ('git diff --name-only --diff-filter^=U 2^>nul') do (git checkout --theirs "%%f" >nul 2>&1 & git add "%%f" >nul 2>&1)

REM --- Force-reset all app files to the official version ---
echo   %DIM%[2/4]%R%  %GRY%Downloading the latest official version...%R%
git fetch >nul 2>&1
git reset --hard origin/%BRANCH% >nul 2>&1
if not errorlevel 1 goto ResetOK
echo   %WINE%x%R%  %WINE%Reset failed. Please contact support with this output:%R%
echo.
git status
echo.
pause
exit /b 1

:ResetOK
echo   %GRN%+%R%  %GRY%App files restored to the official version.%R%

REM --- Rebuild dependencies from scratch ---
echo   %DIM%[3/4]%R%  %GRY%Removing old dependencies...%R%
if exist "SillyTavern\node_modules" rd /s /q "SillyTavern\node_modules" >nul 2>&1

echo   %DIM%[4/4]%R%  %GRY%Reinstalling dependencies from scratch...%R% %DIM%(this can take a few minutes)%R%
where node >nul 2>&1
if errorlevel 1 goto NodeMissing
pushd "SillyTavern"
set NODE_ENV=production
call npm install --no-audit --no-fund --loglevel=error --no-progress --omit=dev >nul 2>&1
if errorlevel 1 goto DepsFailed
popd
echo   %GRN%+%R%  %GRY%Dependencies reinstalled.%R%
goto AskCharFix

:DepsFailed
popd
echo   %AMB%­%R%  %GRY%Dependency install reported a problem.%R%
echo      %DIM%The launcher will retry automatically on next start.%R%
goto Verify

:NodeMissing
echo   %AMB%­%R%  %GRY%Node.js was not found in this window.%R%
echo      %DIM%Dependencies will install automatically on next launch.%R%
goto Verify

REM --- Optional: force re-download all installed characters ---
:AskCharFix
echo.
echo   %GRY%Optional: all installed characters can also be re-downloaded%R%
echo   %GRY%fresh from the character server - this fixes characters whose%R%
echo   %GRY%updates went wrong. Chats and personal data stay untouched.%R%
echo   %DIM%This can take a while if you have many characters installed.%R%
echo.
set "fix_chars="
set /p fix_chars="  %PINK%¯%R% Re-download all installed characters too? (Y/N) [Default: N] "
if not defined fix_chars set "fix_chars=N"
if /i not "%fix_chars%"=="Y" goto Verify

echo.
echo   %DIM%*%R%  %GRY%Starting a temporary local server for the re-download...%R%
pushd "SillyTavern"
start /b node server.js --listen false --port 8000 >nul 2>&1
popd

set /a CWAIT=0
:CharWaitLoop
netstat -ano | findstr ":8000.*LISTENING" >nul 2>&1
if not errorlevel 1 goto CharServerUp
set /a CWAIT+=1
if %CWAIT% geq 150 goto CharServerFail
timeout /t 2 /nobreak >nul
goto CharWaitLoop

:CharServerFail
echo   %AMB%­%R%  %GRY%The temporary server did not come online - skipping the%R%
echo      %GRY%character re-download. You can retry from the Character%R%
echo      %GRY%Downloader inside Weyland Tavern instead.%R%
goto CharCleanup

:CharServerUp
echo   %DIM%*%R%  %GRY%Re-downloading characters...%R% %DIM%(progress prints below)%R%
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $b='http://127.0.0.1:8000'; try { $t=(Invoke-RestMethod ($b+'/csrf-token') -SessionVariable ws).token; $h=@{'X-Csrf-Token'=$t;'X-User-Handle'='default-user';'X-Rebuild-Manifest'='1'}; $m=Invoke-RestMethod ($b+'/api/weyland/fetch-manifests') -Headers $h -WebSession $ws -TimeoutSec 300; $names=@($m.localManifest.characters | Where-Object { $_.version } | ForEach-Object { $_.name }); if ($names.Count -eq 0) { Write-Host '   No downloaded characters found - nothing to re-download.'; exit 3 }; Write-Host ('   Found ' + $names.Count + ' installed characters. Downloading fresh copies...'); $h2=@{'X-Csrf-Token'=$t;'X-User-Handle'='default-user';'X-Redownload'='true'}; $body=ConvertTo-Json @{characters=$names}; $r=Invoke-RestMethod ($b+'/api/weyland/download') -Method Post -ContentType 'application/json' -Headers $h2 -WebSession $ws -Body $body -TimeoutSec 7200; if ($r.success) { exit 0 }; exit 4 } catch { Write-Host ('   Character re-download failed: ' + $_.Exception.Message); exit 5 }"
set "CHAR_EXIT=%ERRORLEVEL%"
if "%CHAR_EXIT%"=="0" echo   %GRN%+%R%  %GRY%All installed characters re-downloaded fresh.%R%
if "%CHAR_EXIT%"=="3" echo   %DIM%*%R%  %GRY%No downloaded characters were found to refresh.%R%
if not "%CHAR_EXIT%"=="0" if not "%CHAR_EXIT%"=="3" echo   %AMB%­%R%  %GRY%The character re-download hit a problem - you can retry from%R% && echo      %GRY%the Character Downloader inside Weyland Tavern.%R%

:CharCleanup
set "TPID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000.*LISTENING"') do set "TPID=%%p"
if defined TPID taskkill /F /PID %TPID% >nul 2>&1
timeout /t 1 /nobreak >nul

:Verify
echo.
echo   %DIM%*%R%  %GRY%Verifying...%R%

set "STILL_BROKEN="
for /f "tokens=*" %%a in ('git diff --name-only --diff-filter^=U 2^>nul') do set "STILL_BROKEN=1"
if defined STILL_BROKEN goto VerifyFailed

set "STILL_AHEAD="
for /f "tokens=*" %%a in ('git rev-list --count origin/%BRANCH%..HEAD 2^>nul') do set "STILL_AHEAD=%%a"
if not defined STILL_AHEAD set "STILL_AHEAD=0"
if not "%STILL_AHEAD%"=="0" goto VerifyFailed

set "NOW_VERSION="
for /f "tokens=*" %%a in ('git rev-parse --short HEAD 2^>nul') do set "NOW_VERSION=%%a"

echo.
echo   %WINE%ÚÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ¿%R%
echo   %WINE%³%R%                                                           %WINE%³%R%
echo   %WINE%³%R%      %GRN%ş%R%  %BLD%%GRY%REPAIR COMPLETE%R%                                   %WINE%³%R%
echo   %WINE%³%R%         %DIM%Your chats and personal data are untouched.%R%       %WINE%³%R%
echo   %WINE%³%R%                                                           %WINE%³%R%
echo   %WINE%ÀÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÙ%R%
echo.
echo   %GRN%+%R%  %GRY%Now on official version%R% %PINK%%NOW_VERSION%%R%
echo   %DIM%*%R%  %GRY%You can start Weyland Tavern with your normal launcher~%R%
echo.
pause
popd
exit /b 0

:VerifyFailed
echo   %WINE%x%R%  %WINE%Something is still off. Please contact support with this output:%R%
echo.
git status
echo.
pause
popd
exit /b 1

:ExitNoChanges
echo.
echo   %DIM%*%R%  %GRY%No changes made. Exiting... see you soon~%R%
pause
popd
exit /b 0
