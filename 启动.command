#!/bin/zsh
cd "${0:A:h}"
if ! command -v node >/dev/null; then
  osascript -e 'display alert "需要 Node.js" message "请先安装 Node.js 22.12 或更新版本，再启动 Markflow。"'
  exit 1
fi
if [ ! -d node_modules ]; then
  npm install || exit 1
fi
npm start
