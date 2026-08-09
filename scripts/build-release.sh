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

  if [ "$goos" = "windows" ]; then
    binary="suna-app.exe"
    archive="${VERSION}-suna-app-${goos}-${goarch}.zip"
  fi

  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build \
    -trimpath \
    -ldflags "-s -w -X main.buildVersion=${VERSION}" \
    -o "$DIST_DIR/$binary" \
    "$PACKAGE"

  (
    cd "$DIST_DIR"
    if [ "$goos" = "windows" ]; then
      rm -f "$archive"
      # GitHub Actions 的 ubuntu runner 没有 zip 命令（macOS 本地有）：
      # 缺失时用 python3 的 zipfile 模块打包，保证 CI/本地都可用。
      if command -v zip >/dev/null 2>&1; then
        zip -9 "$archive" "$binary"
      else
        python3 - "$archive" "$binary" <<'PY'
import sys, zipfile
archive, binary = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
    zf.write(binary, binary)
PY
      fi
    else
      rm -f "$archive"
      tar -czf "$archive" "$binary"
    fi
    rm -f "$binary"
  )
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
  build_one darwin amd64 ""
  build_one linux arm64 ""
  build_one linux amd64 ""
  build_one windows arm64 ".exe"
  build_one windows amd64 ".exe"
)

find "$DIST_DIR" -maxdepth 1 -type f -print
