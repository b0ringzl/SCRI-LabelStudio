@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto node_missing

if exist "package.json" (
  where npm >nul 2>&1
  if errorlevel 1 goto node_missing
  if not exist "node_modules\vite\package.json" (
    call npm ci
    if errorlevel 1 goto failed
  )
  call npm run build
  if errorlevel 1 goto failed
)

node "scripts\serve.mjs" %*
if errorlevel 1 goto failed
exit /b 0

:node_missing
echo 请先安装 Node.js 20 或更新版本，然后重新运行本脚本。
pause
exit /b 1

:failed
echo Atlas Studio 启动失败。请检查上方错误信息。
pause
exit /b 1
