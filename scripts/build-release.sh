#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:?release version is required}"
GATEWAY_DIR="$ROOT_DIR/gateway"
DIST_DIR="$ROOT_DIR/dist"
PACKAGE="github.com/alanchenchen/suna-app/gateway/cmd/suna-app"

build_one() {
  local goos="$1"
  local goarch="$2"
  local suffix="$3"
  local binary="suna-app${suffix}"
  # 产物名以版本号开头（v 前缀），与 Git tag 一致：v0.1.0-suna-app-darwin-arm64.tar.gz
  local archive="${VERSION}-suna-app-${goos}-${goarch}.tar.gz"
  local gui_ldflags=""

  if [ "$goos" = "windows" ]; then
    binary="suna-app.exe"
    archive="${VERSION}-suna-app-${goos}-${goarch}.zip"
    # GUI subsystem：双击无黑框（无控制台窗口）。
    gui_ldflags=" -H=windowsgui"
    # Windows launcher：设置自动开浏览器标记后启动 exe（双击入口）。
    # 用 start 启动避免 cmd 窗口残留；exe 是 GUI subsystem，本身无黑框。
    cat > "$DIST_DIR/启动 Suna App.cmd" <<'CMD'
@echo off
set SUNA_APP_OPEN_BROWSER=1
start "" "%~dp0suna-app.exe"
CMD
  fi

  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build \
    -trimpath \
    -ldflags "-s -w -X main.buildVersion=${VERSION}${gui_ldflags}" \
    -o "$DIST_DIR/$binary" \
    "$PACKAGE"

  (
    cd "$DIST_DIR"
    if [ "$goos" = "windows" ]; then
      rm -f "$archive"
      # GitHub Actions 的 ubuntu runner 没有 zip 命令（macOS 本地有）：
      # 缺失时用 python3 的 zipfile 模块打包，保证 CI/本地都可用。
      if command -v zip >/dev/null 2>&1; then
        zip -9 "$archive" "$binary" "启动 Suna App.cmd"
      else
        python3 - "$archive" "$binary" <<'PY'
import sys, zipfile
archive, binary = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
    zf.write(binary, binary)
    zf.write("启动 Suna App.cmd", "启动 Suna App.cmd")
PY
      fi
    else
      rm -f "$archive"
      tar -czf "$archive" "$binary"
    fi
    rm -f "$binary"
  )
}

# build_macos_app 生成 macOS .app bundle（保留 Dock 图标，非 LSUIElement）：
# 双击即开 + 自动开浏览器（二进制启动时检测 SUNA_APP_OPEN_BROWSER=1）。
build_macos_app() {
  local goarch="$1"
  local app_dir="$DIST_DIR/Suna App.app"
  local contents="$app_dir/Contents"
  local archive="${VERSION}-suna-app-darwin-${goarch}.app.zip"

  rm -rf "$app_dir"
  mkdir -p "$contents/MacOS"
  # 重新编译二进制（-H=windowsgui 不影响 darwin；.app 内嵌二进制）。
  CGO_ENABLED=0 GOOS=darwin GOARCH="$goarch" go build \
    -trimpath \
    -ldflags "-s -w -X main.buildVersion=${VERSION}" \
    -o "$contents/MacOS/suna-app" \
    "$PACKAGE"

  # 注意：heredoc 不带引号以展开 ${VERSION}；plist 内容无 $ 字符，安全。
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
</dict>
</plist>
PLIST

  # 启动脚本：设置自动开浏览器标记后启动 gateway（双击入口）。
  cat > "$contents/MacOS/suna-app-launcher" <<'LAUNCH'
#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
SUNA_APP_OPEN_BROWSER=1 "$DIR/suna-app" "$@"
LAUNCH
  chmod +x "$contents/MacOS/suna-app-launcher"

  # 打包 .app（递归 zip）。GitHub Actions 的 ubuntu runner 没有 zip 命令，
  # 缺失时用 python3 的 zipfile 模块递归打包，保证 CI/本地都可用。
  (cd "$DIST_DIR" && rm -f "$archive" && if command -v zip >/dev/null 2>&1; then
    zip -qry "$archive" "Suna App.app"
  else
    python3 - "$archive" <<'PY'
import sys, zipfile, os
archive = sys.argv[1]
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk("Suna App.app"):
        for name in files:
            path = os.path.join(root, name)
            zf.write(path, path)
PY
  fi)
  rm -rf "$app_dir"
  printf '%s\n' "$archive"
}

# build_linux_desktop 生成 .desktop 入口并打包（与二进制同归档）。
# 归档内包含 suna-app 二进制 + Suna App.desktop。
build_linux_desktop() {
  local goarch="$1"
  local archive="${VERSION}-suna-app-linux-${goarch}.tar.gz"
  local stage="$DIST_DIR/linux-${goarch}"

  rm -rf "$stage"
  mkdir -p "$stage"
  # 独立编译（build_one 产物已清理），保证归档内二进制与 .desktop 一致。
  CGO_ENABLED=0 GOOS=linux GOARCH="$goarch" go build \
    -trimpath \
    -ldflags "-s -w -X main.buildVersion=${VERSION}" \
    -o "$stage/suna-app" \
    "$PACKAGE"
  cat > "$stage/suna-app-launcher" <<'LAUNCH'
#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
SUNA_APP_OPEN_BROWSER=1 "$DIR/suna-app" "$@"
LAUNCH
  chmod +x "$stage/suna-app-launcher"
  cat > "$stage/Suna App.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Suna App
Comment=Suna Runtime cross-device session console
Exec=suna-app-launcher
Terminal=false
Categories=Development;Utility;
DESKTOP
  (cd "$DIST_DIR" && rm -f "$archive" && tar -czf "$archive" -C "linux-${goarch}" .)
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
  build_one darwin arm64 ""
  build_macos_app arm64
  build_one darwin amd64 ""
  build_macos_app amd64
  build_one linux arm64 ""
  build_linux_desktop arm64
  build_one linux amd64 ""
  build_linux_desktop amd64
  build_one windows arm64 ".exe"
  build_one windows amd64 ".exe"
)

find "$DIST_DIR" -maxdepth 1 -type f -print
