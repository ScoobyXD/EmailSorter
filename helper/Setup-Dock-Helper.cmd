@echo off
cd /d "%~dp0"
call npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 goto done
node src\setup.ts
if errorlevel 1 goto done
powershell -NoProfile -Command "Set-Clipboard -Value (Get-Content -Raw -LiteralPath '.private\pairing-code.txt')"
echo The local pairing code has been copied to your clipboard. Paste it into Dock settings.
:done
pause
