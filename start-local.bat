@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm not found. Install Node.js first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

echo Starting local server...
start "Gemini Live Starter" cmd /k "cd /d "%~dp0" && npm run dev"

echo Waiting for http://localhost:3000 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $url='http://localhost:3000'; for ($i=0; $i -lt 60; $i++) { try { Invoke-WebRequest -Uri $url -UseBasicParsing ^| Out-Null; Start-Process $url; exit 0 } catch { Start-Sleep -Seconds 1 } }; Start-Process $url"

exit /b 0
