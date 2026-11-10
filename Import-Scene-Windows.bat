@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv-scene-import\Scripts\python.exe" (
  python -m venv ".venv-scene-import"
  if errorlevel 1 goto failed
)
".venv-scene-import\Scripts\python.exe" -c "import numpy, cv2" >nul 2>&1
if errorlevel 1 (
  ".venv-scene-import\Scripts\python.exe" -m pip install -r "scripts\requirements-scene-import.txt"
  if errorlevel 1 goto failed
)
".venv-scene-import\Scripts\python.exe" "scripts\import_and_open.py" %*
if errorlevel 1 goto failed
exit /b 0
:failed
echo Import failed. See the error above. Requires Python 3.10+ and Node.js 20+.
pause
exit /b 1
