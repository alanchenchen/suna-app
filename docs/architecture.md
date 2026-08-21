# Architecture

Suna App is a standalone GUI client for an installed Suna Runtime. It has its own source repository, dependencies, CI, release artifacts and user-facing UI, while Suna Runtime remains responsible for all Agent business semantics.

## System boundary

```text
┌──────────────────────────────────────┐
│              Suna App                │
│                                      │
│  React Web / PWA                     │
│          │ HTTP + WebSocket          │
│  Go Gateway                           │
│          │ public TCP NDJSON protocol│
└──────────┼───────────────────────────┘
           │
┌──────────▼───────────────────────────┐
│            Suna Runtime              │
│                                      │
│  CLI / TUI / daemon                  │
│  Session / Agent / Runner / Guard    │
│  tools / attachments / MCP / Skills  │
└──────────────────────────────────────┘
```

Suna App never imports Runtime private Go packages and never reads Runtime storage directly.

## Runtime connection

The Gateway follows the documented third-party client flow:

1. discover or start the installed Runtime with `suna serve --json`;
2. read the returned authoritative `tcp_endpoint`;
3. open a TCP connection and send `runtime.hello` as the first request;
4. verify the advertised capability catalog: the runtime must declare the
   required methods (`session.list`, `session.attach`, `session.create`,
   `agent.sendMessage`) in `catalog.methods`;
5. expose approved public session, agent, Guard and AskUser methods and notifications through local HTTP and SSE.

The endpoint is loopback-only. The browser only talks to Gateway; it never accesses Runtime TCP directly.

## Ownership

| Layer | Owns | Must not own |
|---|---|---|
| Runtime | session state, Agent runs, Guard, tools, persistence, attachments | browser delivery or Web UI state |
| Gateway | Runtime discovery, public protocol client, browser contract, validation, auth, cancellation and reconnect adaptation | Agent policy, Guard decisions, storage or model execution |
| Frontend | UI state, responsive rendering, drafts and user interactions | local filesystem, Runtime credentials, protocol persistence |

## Initial product scope

The first usable increment is a loopback-only browser client with:

- clear Runtime discovery and compatibility status;
- Session list, create and attach;
- streamed chat output and run lifecycle;
- Guard and AskUser actions;
- stop/retry state and reconnect handling.

Remote exposure, pairing, PWA installation, image upload, desktop packaging and a full event replay cursor are later increments. They must be added through explicit public contracts, never as Gateway-only shortcuts.

## Development topology

Development uses a locally installed Suna Runtime release, not the Runtime source checkout:

```text
installed suna release
        ↑
Gateway
        ↑
Vite dev server / HMR
        ↑
browser
```

Vite proxies browser HTTP and SSE traffic to Gateway. Browser code must not use a separate direct Runtime connection in development.

## Release topology

Suna App and Suna Runtime are independently versioned and released. Compatibility is capability-based:

```text
Suna App requires catalog methods: session.list, session.attach, session.create, agent.sendMessage
Runtime advertises catalog methods via runtime.hello
→ compatible when the required methods are present
```

A release embeds the built frontend assets in the `suna-app` Gateway artifact. It never embeds the frontend in the `suna` Runtime artifact.
