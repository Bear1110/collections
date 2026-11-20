@echo off
rem Launcher: double-click to start, close this window to stop.
rem Only this computer can connect (127.0.0.1). Always use the same address:
rem data lives in the browser and is tied to http://localhost:8020
cd /d "%~dp0"
title App - http://localhost:8020
set PY=
where python >nul 2>nul && set PY=python
if not defined PY where py >nul 2>nul && set PY=py
if not defined PY goto nopython
echo.
echo   Starting... the browser will open http://localhost:8020
echo   Close this window when you are done.
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://localhost:8020/'"
%PY% -m http.server 8020 --bind 127.0.0.1
pause
exit /b

:nopython
echo   Python not found. Install it from https://www.python.org/downloads/
echo   (check "Add python.exe to PATH" during setup), then double-click this file again.
pause
