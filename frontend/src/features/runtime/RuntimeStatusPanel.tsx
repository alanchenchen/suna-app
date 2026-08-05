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
      <main aria-busy="true" className="grid min-h-dvh place-items-center p-6">
        <section
          aria-live="polite"
          className="w-[min(100%,456px)] animate-[message-in_480ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-[28px] border border-line bg-surface p-[42px] text-center shadow-lg backdrop-blur-2xl"
        >
          <span className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-blue-soft">
            <span className="h-3 w-3 animate-[breathe_1.8s_ease-in-out_infinite] rounded-full bg-blue shadow-[0_0_0_7px_var(--color-blue-glow)]" />
          </span>
          <p className="text-[10px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
            Suna App
          </p>
          <h1 className="mt-2.5 mb-2.5 text-[23px] font-extrabold tracking-tight text-ink">
            正在连接你的工作空间
          </h1>
          <p className="text-[13px] leading-relaxed text-ink-soft">
            正在检测本机 Suna Runtime…
          </p>
        </section>
      </main>
    );
  }

  if (state.kind === "ready") return null;

  const content = copy[state.kind];
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section
        aria-live="assertive"
        className="w-[min(100%,456px)] animate-[message-in_480ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-[28px] border border-line bg-surface p-[42px] text-center shadow-lg backdrop-blur-2xl"
      >
        <span className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-amber-soft text-amber">
          <Icon name="warning" size={22} />
        </span>
        <p className="text-[10px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
          连接需要你的注意
        </p>
        <h1 className="mt-2.5 mb-2.5 text-[23px] font-extrabold tracking-tight text-ink">
          {content.title}
        </h1>
        <p className="text-[13px] leading-relaxed text-ink-soft">
          {content.description}
        </p>
        <div className="mt-6 mb-3 rounded-xl border border-line bg-surface-subtle p-3.5 text-left text-[11px] leading-relaxed text-ink-soft">
          <strong className="block text-[10px] font-extrabold tracking-wide text-ink uppercase">
            下一步
          </strong>
          <span>{content.hint}</span>
        </div>
        <div className="flex justify-between px-0.5 text-[10px] text-ink-muted">
          <span>状态代码</span>
          <code className="font-mono text-ink-soft">{state.code}</code>
        </div>
        <button
          className="mt-6 inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue text-[12px] font-extrabold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-[background,transform] duration-150 hover:bg-blue-strong active:scale-[0.97]"
          onClick={onRetry}
          type="button"
        >
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
      className="inline-flex items-center gap-1.5 rounded-full bg-green-soft px-2 py-0.5 text-[10px] font-bold text-green max-[390px]:text-[0]"
    >
      <span
        aria-hidden="true"
        className="h-[6px] w-[6px] rounded-full bg-green"
      />
      Runtime 已就绪
    </span>
  );
}
