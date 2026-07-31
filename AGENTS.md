# AGENTS.md

## 项目介绍

Suna App 是 Suna Runtime 的官方 GUI 客户端，当前目标是 Web / PWA，后续可在同一仓库加入桌面 launcher。它服务两类用户：不希望使用 TUI 的桌面用户，以及需要从 iPhone / Android 继续查看、接管同一 Session 的用户。

```text
Browser / PWA
      │ HTTP + WebSocket
Suna App Gateway
      │ public Suna TCP NDJSON protocol
Installed Suna Runtime daemon
```

Suna App 是独立项目、独立技术栈、独立构建和独立发版线；Suna Runtime 保持轻量，继续专注 CLI、TUI、daemon 与 Agent runtime。

## 架构与职责

### Suna Runtime

Runtime 是唯一业务事实来源，拥有：

- daemon 生命周期与公开 protocol；
- Session、run、handoff 与持久化；
- Agent、Runner、Guard、工具、模型、附件、MCP、Skill；
- 本地文件、工作区、配置与权限边界。

### Gateway

Gateway 是独立 Go 二进制，只负责：

- 发现、按需启动、连接已安装的 `suna` release；
- 调用 `suna serve --json` 取得权威 TCP endpoint；
- 使用 `runtime.hello` 协商 protocol / capabilities；
- HTTP / WebSocket 与公开 TCP NDJSON protocol 的桥接；
- 浏览器认证、请求校验、取消、断线重连与安全错误映射；
- 后续的浏览器附件上传桥接。

Gateway 不是第二个 Runtime。不得复制、重做或猜测 Agent loop、Guard 决策、工具执行、Session 存储、模型调用或附件语义。

### Frontend

Frontend 是 React + TypeScript + Vite PWA，只通过 Gateway 的明确 HTTP / WebSocket contract 工作。浏览器不得直接连接 Runtime TCP，不得读取 Runtime DB、配置文件或本地文件系统。

## 严格边界

- 本仓库不得 import、vendor、复制或依赖 Suna Runtime 的 `internal/` 包。
- Gateway 只能依赖 Suna 已公开、已文档化的 CLI、transport 和 protocol；不得解析私有存储、依赖未文档化 endpoint 或解析人类可读 stdout。
- 跨层业务语义必须通过公开 protocol 演进，禁止私有后门。
- Runtime 不可用、protocol 不兼容、capability 缺失时必须清晰失败，不得静默 fallback、伪造状态或猜测兼容。
- 第一阶段只做 Runtime 检测、状态展示、安装指引与 Retry；不得静默下载、安装、覆盖或升级 Runtime。
- Suna App 不保存第二份 Session / Agent 数据，不执行模型，不持有模型凭据。
- 生产前端产物仅嵌入 `suna-app` 自己的 Gateway binary，绝不能嵌入 `suna` Runtime binary。

## 技术选型与目录结构

技术选型已确定，除非有明确设计评审，不替换为同类框架：

```text
frontend/
  React + TypeScript strict + Vite + PWA
  Zustand                    # 客户端 UI 状态
  TanStack Virtual           # 长 Session 虚拟列表
  Base UI / Radix primitives # 可访问的交互基础组件
  react-markdown + Shiki     # Markdown 与代码块

gateway/
  Go 独立 module
  HTTP + WebSocket server
  public Suna TCP NDJSON protocol client

future desktop/
  Tauri launcher，只复用 frontend 与启动 gateway
```

当前目录职责：

```text
frontend/
  src/app/           应用入口、路由与页面壳
  src/features/      按 Session、chat、guard、askuser、runtime 等能力组织
  src/components/    跨 feature 的可复用 UI primitives
  src/lib/           API client、schema、格式化和非业务辅助逻辑
  src/styles/        tokens、全局样式与主题
  public/            非敏感静态资源

gateway/
  cmd/suna-app/      binary entry point
  internal/runtime/  suna discovery、serve、hello、protocol client
  internal/bridge/   browser contract 与 Runtime protocol translation
  internal/httpapi/  HTTP、WebSocket、auth、upload endpoints
  internal/config/   Gateway 自身最小配置
  internal/observe/  脱敏日志和健康状态

docs/                架构、开发、部署、协议兼容与 UX 决策
scripts/             可复现的本地与 release 构建脚本
.github/workflows/   CI 与独立 release
```

- 不在 `frontend/` 引入 Gateway / Runtime 业务逻辑。
- 不在 `gateway/` 引入 React、Node 或 UI 状态。
- 不为尚未实现的 desktop、remote relay、后台任务、编辑器或文件树预建代码目录和抽象。

## 安全与隐私

- Gateway 默认只监听 loopback。LAN、Tailscale、Tunnel 等网络暴露必须显式启用，并在实现前单独设计认证与配对；不得默认监听公网或局域网。
- 浏览器 API、WebSocket、上传和状态修改必须校验身份、Origin、消息类型、消息大小、状态与权限边界。
- 非 loopback 部署必须使用 TLS 或明确文档化的可信安全代理；不得依赖 URL 保密。
- Runtime 输出、工具输出、用户内容、附件文件名、Markdown 与 URL 都是不可信输入。禁止 unsafe HTML、`eval`、不受控下载和隐式外链跳转。
- PWA 默认只缓存公开 UI shell；不得缓存 Session 内容、Runtime 响应、凭据或附件。
- 浏览器 storage 只能保存最小 UI 偏好与未来配对凭据；不得保存 transcript、Runtime token、模型凭据、本地文件路径或附件内容。
- 默认日志、测试夹具、截图和错误报告不得记录 prompt、工具参数、附件路径、会话内容、凭据或 token；使用 correlation ID 与稳定错误类别。
- 不得在代码、文档、示例、测试或用户可见内容中写入真实或仿真的 API key、token、Cookie、Authorization、私钥、带凭据 URL、私有 provider、内部域名或模型 ref。使用 `<API_KEY>`、`test-token`、`example-provider`、`https://api.example.com` 等占位符。
- 不引入 telemetry、analytics、crash upload 或远程日志，除非用户显式 opt-in、数据路径经过设计审查并有文档说明。

## UI / UX 原则

- Suna App 是专业 Session Client，不是 TUI 投屏、终端模拟器或第二套 Agent 产品。
- 手机优先：必须考虑窄屏、触控、安全区、软键盘/IME、锁屏、切后台、网络切换与恢复；桌面端在此基础上提高效率。
- 必须清晰展示 Runtime、连接、running / retrying / waiting、失败、取消与重连状态。
- Guard 与 AskUser 是一等交互。不得自动批准、隐藏或绕过；移动端优先使用清晰按钮与可读风险状态。
- 长 Session 必须虚拟化。流式 delta 必须批量合并更新，禁止 token 级全页 render；工具和 Subtask 默认折叠但可查看详情。
- 浏览器断线不得取消 Runtime run；重连后必须 attach 并以 Runtime authoritative state 恢复 UI。
- 必须使用语义化 HTML、键盘导航、焦点管理、屏幕阅读器标签、足够对比度和 reduced motion；不得只依赖颜色表达状态。
- 第一阶段不做代码编辑器、文件树、Git UI、终端模拟器、复杂配置管理、后台任务 UI、官方 relay 或桌面壳。

## 开发原则

- 前端使用 TypeScript strict。网络边界必须有显式类型与 schema validation；避免 `any`、隐式 JSON 假设和无边界 global store。
- React 组件、hooks 与 feature state 保持小而组合明确；始终处理 loading、empty、error、disconnected、permission 和 unsupported states。
- Gateway 使用 idiomatic Go：`context.Context`、明确 timeout、取消、有限缓冲、backpressure 和可分类错误。每个 goroutine 必须能说明启动者、退出条件、channel 所有者和共享状态锁。
- 必要 Go 注释必须使用中文，尤其是并发、状态机、错误恢复、安全边界、缓存稳定性与 protocol glue。提示词模板必须使用英文。
- 默认值、超时、路径、监听地址、权限和 token 规则放在所属层集中维护；禁止跨层重复猜测。
- 不为假想扩展预建 interface、兼容逻辑、远程服务、数据库或状态机。依赖必须有明确的维护、安全、许可证与体积理由。
- 单个 Go 文件尽量不超过 700 行；接近时按职责拆分。
- 不提交构建产物、Node 依赖、本地配置、开发证书、覆盖率、日志、测试输出或敏感数据。

## 测试与质量

前端每次功能开发后至少运行：

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Gateway 每次功能开发后至少运行：

```text
gofmt
go vet ./...
go test ./...
go build ./...
```

涉及 Gateway 并发、WebSocket、协议连接或取消时，补充：

```text
go test -race ./...
```

测试规则：

- 使用 fake Runtime 或公开 protocol fixtures，覆盖 hello、版本不兼容、malformed input、超时、取消、断线重连、backpressure、Runtime 不可用与脱敏错误；不得依赖 Suna 私有包、真实网络、真实模型或凭据。
- UI 测试优先验证关键交互、状态语义、可访问性和移动布局；避免脆弱的大型整页快照。
- 测试必须离线、快速、确定性；涉及真实 Runtime、浏览器端到端或外部网络的测试必须明确标记为 integration，不进入默认快速测试。
- 提交前运行 `git diff --check`、`git status --short` 和受影响的前后端检查；跨层改动优先运行完整质量命令。

## Git 提交规范

- 使用英文 Conventional Commits：`type(scope): imperative summary`。
- type 优先使用 `feat`、`fix`、`refactor`、`perf`、`docs`、`test`、`chore`；scope 使用稳定模块，如 `frontend`、`gateway`、`runtime`、`protocol`、`session`、`chat`、`guard`、`release`。
- summary 简洁、首字母小写、不加句号；避免泛泛 `update`、中文和实现细节堆砌。
- 重要 feature、安全行为、协议变更、兼容迁移或跨层改动必须写英文 body，说明设计意图、关键行为、兼容影响和用户可见变化。
- 不兼容变更使用 `!`，并在 body 末尾写 `BREAKING CHANGE:`。
- 一个提交只承载一个可 review 的目的；不得把前端、Gateway、生成物和无关重构混在一起。

## 发版规则

- Suna App 使用独立 SemVer tag：`v0.1.0`、`v0.1.1`；它与 Suna Runtime 的 tag 和发布节奏无关。
- 版本号来源以 Git tag 为准，不在代码、前端常量或脚本中维护固定版本号；Gateway 通过 build metadata 注入 release version。
- 让 Suna 代发版时，先根据改动范围建议版本号；用户确认后才能创建 tag 和推送。
- 发版前必须确认：
  ```text
  git status --short
  git diff --check
  frontend 的完整质量命令
  gateway 的完整质量命令
  release build dry run
  ```
- 发版必须使用 annotated tag，tag message 使用中文 release notes；不要使用 lightweight tag。示例：
  ```bash
  git tag -a v0.1.0 -m "v0.1.0" -m "- 新增本地 Runtime 状态页"
  ```
- 推送顺序建议先推主分支，再推 tag：
  ```bash
  git push origin main
  git push origin v0.1.0
  ```
- `v*` tag 触发独立 GitHub Actions：构建前端、嵌入其产物、构建平台 Gateway artifacts、生成 `checksums.txt`、创建 GitHub Release。
- Release notes 必须声明支持的 Suna Runtime protocol 版本 / capabilities，以及任何 Runtime 最低版本要求。
- protocol breaking change 时，先发布具有明确迁移说明的 Runtime，再发布兼容的 Suna App；不得用静默 fallback 掩盖不兼容。
- 发版后仅确认远端 tag 与 release assets；不要默认依赖 `gh` CLI 检查 workflow，除非环境明确安装且已授权。
