#!/bin/sh
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 20 或更新版本，然后重新运行本脚本。'
  exit 1
fi

if [ -f package.json ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo '未找到 npm，请重新安装 Node.js。'
    exit 1
  fi
  if [ ! -f node_modules/vite/package.json ]; then
    npm ci
  fi
  npm run build
fi

exec node scripts/serve.mjs "$@"
