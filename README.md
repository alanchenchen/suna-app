# Suna App

Suna App is the official GUI client for the [Suna Runtime](https://github.com/alanchenchen/suna). It will provide a responsive Web / PWA experience and, later, a desktop launcher.

Suna App is a separate application and release line. It connects to an already installed Suna Runtime through Suna's public local protocol; it does not contain a second Agent runtime.

> **Status:** project scaffold. No Runtime bridge or product UI has been implemented yet.

## Architecture

```text
Browser / PWA
      │ HTTP + WebSocket
Suna App Gateway
      │ public TCP NDJSON protocol
Installed Suna Runtime daemon
```

The Runtime remains the source of truth for sessions, agent runs, Guard, tools, attachments, MCP, Skills, and local persistence. The Gateway is only a secure browser-facing protocol client and adapter.

See [architecture notes](docs/architecture.md) and the Runtime's [third-party client guide](https://github.com/alanchenchen/suna/blob/main/docs/tcp-client.md).

## Repository layout

```text
frontend/                 React + TypeScript + Vite PWA
  src/                    UI, state, API client, reusable components
  public/                 public static assets

gateway/                  independent Go module
  cmd/suna-app/           Gateway binary entry point
  internal/               Runtime discovery, protocol client, HTTP/WS bridge

docs/                     architecture, development and deployment notes
scripts/                  deterministic local and release build helpers
.github/workflows/        CI and independent release automation
```

## Planned development workflow

Suna App development uses an installed Suna Runtime release rather than a checkout of the Runtime source:

```text
installed suna release
        ↑
Suna App Gateway --dev
        ↑
Vite development server with HMR
        ↑
browser
```

The initial project commands are run directly from each component directory. Once Gateway and UI work begins, use the project-specific commands documented in `docs/development.md`.

## Release model

Suna App is versioned and released independently from Suna Runtime:

```text
Suna Runtime: v0.x.y
Suna App:     v0.x.y
```

Compatibility is determined by the public Runtime protocol and advertised capabilities, not by matching application version numbers. Each Suna App release states its supported Runtime protocol versions.

## License

MIT. See [LICENSE](LICENSE).
