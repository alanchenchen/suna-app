# Suna App

Suna App 是 [Suna Runtime](https://github.com/alanchenchen/suna) 的官方 GUI 客户端。它将提供响应式 Web / PWA 体验，并在后续承载桌面 launcher。

Suna App 是独立应用和独立发版线，通过 Suna 的公开本地 protocol 连接已安装的 Suna Runtime；它不包含第二套 Agent runtime。

> **状态：** 项目脚手架。当前尚未实现 Runtime bridge 或产品 UI。

## 架构

```text
Browser / PWA
      │ HTTP + WebSocket
Suna App Gateway
      │ public TCP NDJSON protocol
Installed Suna Runtime daemon
```

Runtime 是 Session、Agent run、Guard、工具、附件、MCP、Skill 和本地持久化的唯一事实来源。Gateway 只是面向浏览器的安全 protocol client 与适配层。

参见[架构说明](docs/architecture.md)与 Runtime 的[第三方客户端指南](https://github.com/alanchenchen/suna/blob/main/docs/tcp-client.md)。

## 仓库结构

```text
frontend/                 React + TypeScript + Vite PWA
  src/                    UI、状态、API client、可复用组件
  public/                 公共静态资源

gateway/                  独立 Go module
  cmd/suna-app/           Gateway 二进制入口
  internal/               Runtime 发现、protocol client、HTTP/WS bridge

docs/                     架构、开发与部署说明
scripts/                  确定性的本地与 release 构建脚本
.github/workflows/        CI 与独立发版自动化
```

## 规划开发方式

Suna App 开发使用本机已安装的 Suna Runtime release，而不是依赖 Runtime 源码 checkout：

```text
installed suna release
        ↑
Suna App Gateway --dev
        ↑
Vite development server with HMR
        ↑
browser
```

项目初始命令直接在各组件目录中执行。Gateway 与 UI 实现开始后，使用 `docs/development.md` 中的项目专用命令。

## 发版模型

Suna App 与 Suna Runtime 独立版本化、独立发版：

```text
Suna Runtime: v0.x.y
Suna App:     v0.x.y
```

兼容性取决于公开 Runtime protocol 与 capabilities，而不是两个应用的版本号相同。每个 Suna App release 都会声明支持的 Runtime protocol 版本。

## 许可证

MIT。见 [LICENSE](LICENSE)。
