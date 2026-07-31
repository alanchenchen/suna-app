# Development

## Prerequisites

- Go 1.26 or later
- Node.js 22 or later
- pnpm 10 or later
- A compatible Suna Runtime release available on `PATH`

Suna App development connects to the installed Runtime through its documented public client interface. Do not require a Suna Runtime source checkout and do not import Runtime private packages.

## Component commands

Run commands directly from each component directory:

```bash
cd frontend
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

cd ../gateway
gofmt -w .
go vet ./...
go test ./...
go build ./...
```

Use separate terminals for `pnpm dev` and `go run ./cmd/suna-app --dev` once those development entry points are implemented.

## Runtime connection contract

Gateway must use this sequence:

```text
suna serve --json
→ tcp_endpoint
→ TCP NDJSON connection
→ runtime.hello
→ protocol/capability check
```

Do not hard-code a Runtime port. Do not parse stderr as a protocol. Do not connect browser code to Runtime TCP.

## Frontend development

Vite serves the frontend and provides HMR. It proxies `/api` and `/ws` to the local Gateway development address.

Frontend source is organized by product capability rather than one global component directory:

```text
src/app/          app shell and route composition
src/features/     runtime, session, chat, guard and AskUser features
src/components/   reusable cross-feature UI components
src/lib/          typed browser API client and utilities
src/styles/       design tokens and global styles
```

## Gateway development

Gateway is a standalone Go module. Its internal packages are separated by adapter responsibility:

```text
internal/runtime/  Runtime discovery, serve and public protocol client
internal/bridge/   browser-to-Runtime protocol translation
internal/httpapi/  HTTP, WebSocket, auth and upload endpoints
internal/config/   Gateway-only configuration
internal/observe/  redacted logs and health state
```

Gateway must never implement Runtime business policy.

## Quality checks

Run before committing:

```bash
cd frontend
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

cd ../gateway
gofmt -w .
go vet ./...
go test ./...
go build ./...

git diff --check
git status --short
```

Default checks must be offline, quick and deterministic. Use fake Runtime servers and public protocol fixtures for Gateway tests. Networked Runtime or browser end-to-end tests must be explicitly marked as integration tests.
