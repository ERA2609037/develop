#!/bin/bash
# 个人生活助手 —— macOS 打包脚本（免 electron-builder，直接组装 .app）
set -euo pipefail

PROJ="$(cd "$(dirname "$0")" && pwd)"
NAME="个人生活助手"
BUILD="$PROJ/release"
APP="$BUILD/$NAME.app"
PB=/usr/libexec/PlistBuddy

echo "==> 准备构建目录"
mkdir -p "$BUILD"

echo "==> 复制 Electron 运行时（rsync 保留符号链接，ditto 会展开导致体积翻倍）"
rsync -a --delete "$PROJ/node_modules/electron/dist/Electron.app/" "$APP/"

echo "==> 重命名可执行文件"
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$NAME"

echo "==> 写入 Info.plist"
$PB -c "Set :CFBundleExecutable $NAME" "$APP/Contents/Info.plist"
$PB -c "Set :CFBundleName $NAME" "$APP/Contents/Info.plist"
$PB -c "Set :CFBundleIdentifier com.xtech.personal-life-assistant" "$APP/Contents/Info.plist"
$PB -c "Set :CFBundleShortVersionString 1.0.0" "$APP/Contents/Info.plist"
$PB -c "Set :CFBundleVersion 1.0.0" "$APP/Contents/Info.plist"
$PB -c "Delete :CFBundleDisplayName" "$APP/Contents/Info.plist" 2>/dev/null || true
$PB -c "Add :CFBundleDisplayName string $NAME" "$APP/Contents/Info.plist" 2>/dev/null || true

echo "==> 安装图标"
if [ -f "$PROJ/assets/icon.icns" ]; then
  cp "$PROJ/assets/icon.icns" "$APP/Contents/Resources/icon.icns"
  $PB -c "Set :CFBundleIconFile icon.icns" "$APP/Contents/Info.plist" 2>/dev/null \
    || $PB -c "Add :CFBundleIconFile string icon.icns" "$APP/Contents/Info.plist"
fi

echo "==> 组装应用资源"
APPR="$APP/Contents/Resources/app"
mkdir -p "$APPR"
cp "$PROJ/main.js" "$APPR/"
cp "$PROJ/README.md" "$APPR/" 2>/dev/null || true
mkdir -p "$APPR/server"
cp "$PROJ/server/server.js" "$APPR/server/"
cp -R "$PROJ/server/ai" "$APPR/server/ai"
cp -R "$PROJ/public" "$APPR/public"
rm -f "$APPR/public/_cptest.txt"
mkdir -p "$APPR/data"
cp "$PROJ/data/life-assistant.db" "$APPR/data/life-assistant.db"

cat > "$APPR/package.json" <<'JSON'
{
  "name": "personal-life-assistant",
  "version": "1.0.0",
  "description": "个人生活助手 · Todo / 记账 / 日程 / 日记 / Life Dashboard / AI Daily Briefing",
  "main": "main.js",
  "dependencies": {
    "express": "^4.22.3",
    "sql.js": "^1.15.2",
    "three": "^0.160.0",
    "vue": "^3.5.44"
  }
}
JSON

echo "==> 复制运行时依赖（排除 electron）"
rsync -a --exclude 'electron' --exclude '.cache' "$PROJ/node_modules/" "$APPR/node_modules/"

echo "==> 移除隔离属性"
xattr -cr "$APP" 2>/dev/null || true

echo "==> 移除默认应用（可选，失败不影响）"
rm -rf "$APP/Contents/Resources/default_app.asar" 2>/dev/null || echo "  跳过（Electron 会优先使用 app 目录）"

echo "==> Ad-hoc 签名（Apple Silicon 必需）"
codesign --force --deep --sign - "$APP"

echo "==> 校验签名"
codesign --verify --deep --strict "$APP" && echo "签名校验通过"

echo "==> 输出到桌面"
# 先在项目内完成复制与校验，再整体移动到桌面，避免半成品留在目标位置
STAGE="$BUILD/deploy"
DEST="$HOME/Desktop/$NAME.app"
mkdir -p "$STAGE"
rsync -a --delete "$APP/" "$STAGE/$NAME.app/"
codesign --verify --deep --strict "$STAGE/$NAME.app"
if [ -e "$DEST" ]; then
  OLD="$HOME/.Trash/$NAME-old-$(date +%H%M%S).app"
  mv "$DEST" "$OLD" || { echo "✗ 无法移走旧版本：$DEST"; exit 1; }
  echo "  旧版本已移入废纸篓：$(basename "$OLD")"
fi
# 防止 mv 到已存在目录时变成嵌套（会在 .app 里套一个 .app）
if [ -e "$DEST" ]; then
  echo "✗ 目标位置仍被占用，已中止：$DEST"
  exit 1
fi
mv "$STAGE/$NAME.app" "$DEST"

echo "==> 完成：$DEST"
du -sh "$DEST"
