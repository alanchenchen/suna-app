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
  local archive="suna-app-${VERSION}-${goos}-${goarch}.tar.gz"

  if [ "$goos" = "windows" ]; then
    binary="suna-app.exe"
    archive="suna-app-${VERSION}-${goos}-${goarch}.zip"
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
      zip -9 "$archive" "$binary"
    else
      rm -f "$archive"
      tar -czf "$archive" "$binary"
    fi
    rm -f "$binary"
  )
}

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
  build_one linux amd64 ""
  build_one windows amd64 ".exe"
)

find "$DIST_DIR" -maxdepth 1 -type f -print
