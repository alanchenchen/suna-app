#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FRONTEND_DIST="$ROOT_DIR/frontend/dist"
STAGED_ASSETS="$ROOT_DIR/gateway/internal/webassets/dist"
GITKEEP="$STAGED_ASSETS/.gitkeep"

if [ ! -f "$FRONTEND_DIST/index.html" ]; then
  printf '%s\n' "frontend build output is missing: run 'cd frontend && pnpm build' first" >&2
  exit 1
fi

mkdir -p "$STAGED_ASSETS"
if [ ! -f "$GITKEEP" ]; then
  printf '%s\n' '# Frontend production assets are staged here by the release build.' > "$GITKEEP"
fi

find "$STAGED_ASSETS" -mindepth 1 ! -name .gitkeep -exec rm -rf {} +
cp -R "$FRONTEND_DIST"/. "$STAGED_ASSETS"/

# Keep the tracked embed placeholder even after replacing staged build output.
if [ ! -f "$GITKEEP" ]; then
  printf '%s\n' '# Frontend production assets are staged here by the release build.' > "$GITKEEP"
fi
