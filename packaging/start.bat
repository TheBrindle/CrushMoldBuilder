@echo off
title Eggshell Mold Maker
echo.
echo   Starting Eggshell Mold Maker...
echo   A browser window will open in a moment.
echo   Keep THIS window open while you use the app (close it to stop).
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
echo.
echo   The app has stopped.
pause
