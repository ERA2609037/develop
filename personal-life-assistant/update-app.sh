#!/bin/bash
# 个人生活助手 —— 增量更新已安装的 .app
# 用途：改完代码后，只同步 main.js / server / public 到已安装的应用，无需整包重建。
# 用法：./update-app.sh                # 更新桌面上的「个人生活助手.app」
#       ./update-app.sh /Applications/个人生活助手.app
# 说明：不会碰 ~/Library/Application Support/personal-life-assistant/ 里的用户数据。
set -euo pipefail

PROJ="$(cd "$(dirname "$0")" && pwd)"
NAME="个人生活助手"
DEST="${1:-$HOME/Desktop/$NAME.app}"

if [ ! -d "$DEST" ]; then
  echo "✗ 找不到已安装的应用：$DEST"
  echo "  请先运行 ./build-mac.sh 做一次完整打包。"
  exit 1
fi

APPR="$DEST/Contents/Resources/app"
if [ ! -d "$APPR" ]; then
  echo "✗ 应用结构异常，缺少 $APPR"
  exit 1
fi

echo "==> 目标：$DEST"

echo "==> 同步 main.js"
rsync -a "$PROJ/main.js" "$APPR/main.js"

echo "==> 同步 server/"
rsync -a --delete "$PROJ/server/" "$APPR/server/"

echo "==> 同步 public/"
rsync -a --delete "$PROJ/public/" "$APPR/public/"

echo "==> 重新签名（内容变了签名必然失效，必须重签）"
xattr -cr "$DEST" 2>/dev/null || true
codesign --force --deep --sign - "$DEST"
codesign --verify --deep --strict "$DEST" && echo "  ✓ 签名校验通过"

echo "==> 完成"
echo "  代码已更新，用户数据保持不变。"
echo "  若应用正在运行，请退出后重新打开生效。"
