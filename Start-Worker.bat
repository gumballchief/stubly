@echo off
title Stubly worker - leave this window open
cd /d "%~dp0"
echo.
echo   STUBLY WORKER
echo   Leave this window open. It settles paid jobs.
echo   Close it when you're done - nothing breaks.
echo.
node worker/orchestrator.js
echo.
echo   The worker stopped. Press any key to close.
pause >nul
