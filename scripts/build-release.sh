#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:?release version is required}"
GATEWAY_DIR="$ROOT_DIR/gateway"
DIST_DIR="$ROOT_DIR/dist"
PACKAGE="github.com/alanchenchen/suna-app/gateway/cmd/suna-app"

# 统一分发模型：每个平台（darwin/linux/windows）× 每个架构（amd64/arm64）
# 恰好一个归档，内含同一份二进制的两种用法：
#   - CLI：直接运行二进制（前台，stderr 可见，可 Ctrl+C）
#   - launcher：平台双击入口（设 SUNA_APP_OPEN_BROWSER=1 后 exec 同一二进制）
# 归档名统一为 ${VERSION}-suna-app-${goos}-${goarch}.${ext}；Windows 用 zip，
# 其余用 tar.gz（保留可执行位）。

# write_launcher 写平台双击入口。所有平台共用同一语义：设置自动开浏览器标记
# 后 exec gateway 二进制（exec 替换 shell，进程管理器里只有 suna-app 一个进程）。
# Suna App 不落盘任何日志，stderr 是唯一出口（GUI 启动时由系统丢弃）；
# 排查问题用 CLI 启动即可在终端看到完整输出。
write_launcher() {
  local path="$1"
  cat > "$path" <<'LAUNCH'
#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
SUNA_APP_OPEN_BROWSER=1 exec "$DIR/suna-app" "$@"
LAUNCH
  chmod +x "$path"
}

# write_windows_launcher 写 Windows 双击入口。exe 是 GUI subsystem（无黑框），
# 用 start 启动避免 cmd 窗口残留。文件名用 ASCII：zip 归档里非 ASCII 文件名
# 不带 UTF-8 flag 时，Windows 自带解压在非中文系统上会乱码。
write_windows_launcher() {
  local path="$1"
  cat > "$path" <<'CMD'
@echo off
set SUNA_APP_OPEN_BROWSER=1
start "" "%~dp0suna-app.exe"
CMD
}

# build_platform 构建一个 goos/goarch 组合并打出统一命名归档。
# macOS 额外生成 .app bundle（LSUIElement：无 Dock 图标、不弹跳）；
# Linux 额外生成 .desktop 桌面入口；Windows 的 launcher 是 .cmd。
build_platform() {
  local goos="$1"
  local goarch="$2"
  local ext="tar.gz"
  local binary="suna-app"
  local gui_ldflags=""

  if [ "$goos" = "windows" ]; then
    ext="zip"
    binary="suna-app.exe"
    # GUI subsystem：双击无黑框（无控制台窗口）。
    gui_ldflags=" -H=windowsgui"
  fi

  local archive="${VERSION}-suna-app-${goos}-${goarch}.${ext}"
  local stage="$DIST_DIR/stage-${goos}-${goarch}"
  rm -rf "$stage"
  mkdir -p "$stage"

  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build \
    -trimpath \
    -ldflags "-s -w -X main.buildVersion=${VERSION}${gui_ldflags}" \
    -o "$stage/$binary" \
    "$PACKAGE"

  if [ "$goos" = "darwin" ]; then
    # .app bundle：双击入口（Info.plist 由 heredoc 展开 ${VERSION}，内容无 $ 字符）。
    local app_dir="$stage/Suna App.app"
    local contents="$app_dir/Contents"
    mkdir -p "$contents/MacOS"
    cp "$stage/$binary" "$contents/MacOS/suna-app"
    cat > "$contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>Suna App</string>
	<key>CFBundleDisplayName</key>
	<string>Suna App</string>
	<key>CFBundleIdentifier</key>
	<string>ai.suna.app</string>
	<key>CFBundleVersion</key>
	<string>${VERSION}</string>
	<key>CFBundleShortVersionString</key>
	<string>${VERSION}</string>
	<key>CFBundleExecutable</key>
	<string>suna-app-launcher</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>LSMinimumSystemVersion</key>
	<string>12.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>LSUIElement</key>
	<true/>
</dict>
</plist>
PLIST
    write_launcher "$contents/MacOS/suna-app-launcher"
    # ad-hoc 签名：无签名二进制首次打开会被 Gatekeeper 直接拦截；ad-hoc 至少
    # 保证包结构完整性校验可用（正式分发需 Developer ID + 公证，另行决策）。
    codesign --force --sign - "$app_dir" >/dev/null 2>&1 || true
  elif [ "$goos" = "linux" ]; then
    write_launcher "$stage/suna-app-launcher"
    cat > "$stage/Suna App.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Suna App
Comment=Suna Runtime cross-device session console
Exec=$stage/suna-app-launcher
Terminal=false
Categories=Development;Utility;
DESKTOP
  else
    write_windows_launcher "$stage/Start Suna App.cmd"
  fi

  # 打包：GitHub Actions 的 ubuntu runner 没有 zip 命令，缺失时用 python3
  # 的 zipfile 模块兜底，保证 CI/本地都可用。
  (
    cd "$stage"
    if [ "$ext" = "zip" ]; then
      rm -f "$DIST_DIR/$archive"
      if command -v zip >/dev/null 2>&1; then
        zip -qry "$DIST_DIR/$archive" .
      else
        python3 - "$DIST_DIR/$archive" <<'PY'
import sys, zipfile, os
archive, root = sys.argv[1], os.curdir
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
    for base, dirs, files in os.walk(root):
        for name in files:
            path = os.path.join(base, name)
            zf.write(path, os.path.relpath(path, root))
PY
      fi
    else
      rm -f "$DIST_DIR/$archive"
      tar -czf "$DIST_DIR/$archive" .
    fi
  )
  rm -rf "$stage"
  printf '%s\n' "$archive"
}

# 发版前必须用最新源码构建前端：stage-frontend.sh 只做嵌入，不校验
# 产物新旧；直接 build 保证嵌入的 UI 与当前源码一致（幂等）。
if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  printf '%s\n' "frontend dependencies missing: run 'cd frontend && pnpm install' first" >&2
  exit 1
fi
(
  cd "$ROOT_DIR/frontend"
  pnpm build
)

"$ROOT_DIR/scripts/stage-frontend.sh"

(
  cd "$GATEWAY_DIR"
  go test -tags=integration ./internal/webassets
)

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

(
  cd "$GATEWAY_DIR"
  for goarch in amd64 arm64; do
    build_platform darwin "$goarch"
    build_platform linux "$goarch"
    build_platform windows "$goarch"
  done
)

find "$DIST_DIR" -maxdepth 1 -type f -print