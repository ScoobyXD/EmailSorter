@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "Set-Clipboard -Value (Get-Content -Raw -LiteralPath '.private\pairing-code.txt')"
if errorlevel 1 goto done
echo Pairing code copied. Paste it into Dock settings.
:done
pause
