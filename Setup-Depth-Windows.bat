@echo off
setlocal
cd /d "%~dp0"
py -3 scripts\setup_depth.py %*
if errorlevel 1 (
  echo DA2 setup failed. Python 3.10+, Git and network access are required.
  pause
  exit /b 1
)
echo DA2 setup complete. Start the platform and select DA2 in Registration.
pause
