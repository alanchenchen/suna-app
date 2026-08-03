import { Icon } from "../../components/Icon";
import type { RuntimeState } from "../../lib/runtimeStatus";

type RuntimeStatusPanelProps = {
  state: RuntimeState;
  onRetry: () => void;
};

const copy = {
  unavailable: {
    title: "未检测到 Suna Runtime",
    description: "请确认已在本机安装并启动 Suna Runtime，然后重试连接。",
    hint: "在终端运行 suna serve --json 后，保持本地 Gateway 运行。",
  },
  protocol_error: {
    title: "Runtime 响应不兼容",
    description: "本机 Runtime 返回了当前 Gateway 无法识别的响应。",
    hint: "请检查 Suna App 和 Suna Runtime 是否使用兼容版本，然后重试。",
  },
  capability_error: {
    title: "Runtime 版本不兼容",
    description: "已检测到 Suna Runtime，但它不支持所需的公开协议。",
    hint: "请更新 Suna Runtime 后重试。",
  },
} as const;

export function RuntimeStatusPanel({
  state,
  onRetry,
}: RuntimeStatusPanelProps) {
  if (state.kind === "loading") {
    return (
      <main aria-busy="true" className="runtime-gate">
        <section aria-live="polite" className="runtime-card">
          <span aria-hidden="true" className="runtime-orbit">
            <i />
          </span>
          <p className="eyebrow">Suna App</p>
          <h1>正在连接你的工作空间</h1>
          <p>正在检测本机 Suna Runtime…</p>
        </section>
      </main>
    );
  }

  if (state.kind === "ready") return null;

  const content = copy[state.kind];
  return (
    <main className="runtime-gate">
      <section aria-live="assertive" className="runtime-card runtime-error">
        <span aria-hidden="true" className="runtime-warning">
          <Icon name="warning" size={22} />
        </span>
        <p className="eyebrow">连接需要你的注意</p>
        <h1>{content.title}</h1>
        <p>{content.description}</p>
        <div className="runtime-hint">
          <strong>下一步</strong>
          <span>{content.hint}</span>
        </div>
        <div className="runtime-code">
          <span>状态代码</span>
          <code>{state.code}</code>
        </div>
        <button className="runtime-retry" onClick={onRetry} type="button">
          <Icon name="arrow-up" size={16} />
          重新检测
        </button>
      </section>
    </main>
  );
}

export function RuntimeStatusBadge({
  protocolVersion,
}: {
  protocolVersion: string;
}) {
  return (
    <span
      aria-label={`Runtime 已就绪，协议 ${protocolVersion}`}
      className="runtime-ready"
    >
      <span aria-hidden="true" />
      Runtime 已就绪
    </span>
  );
}
