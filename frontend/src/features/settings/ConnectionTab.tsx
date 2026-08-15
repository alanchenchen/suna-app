import { useEffect, useState } from "react";
import type { Theme } from "../../lib/models";
import type { SettingsTabProps } from "./RuntimeSettings";

type DaemonStatus = {
  state: string;
  pid?: number;
  uptime?: string;
  connections?: number;
  agent_status?: string;
  provider?: string;
  model?: string;
  context_tokens?: number;
  context_window?: number;
  usage_today?: {
    input_tokens: number;
    output_tokens: number;
    requests: number;
  };
};

const stateLabels: Record<string, string> = {
  ready: "已就绪",
  starting: "启动中",
  stopping: "停止中",
  unavailable: "不可用",
};

/** 连接 Tab：Runtime 状态、版本、用量、主题（设计 §10.1）。 */
export function ConnectionTab({
  cap,
  config,
  hello,
  // onConfig 由模型/安全 Tab 使用；连接 Tab 不需要，不接收避免未用警告。
  onThemeChange,
  rpc,
  theme,
  connected,
  onReconnect,
}: SettingsTabProps) {
  const [status, setStatus] = useState<DaemonStatus>();
  useEffect(() => {
    let alive = true;
    rpc("daemon.status", {})
      .then((value) => {
        if (alive) setStatus(value);
      })
      .catch(() => {
        // 状态获取失败不阻塞设置面板；连接页已有错误提示。
      });
    return () => {
      alive = false;
    };
  }, [rpc, connected]);

  const usage = status?.usage_today;
  const fmt = (value?: number) =>
    value == null ? "—" : value.toLocaleString();

  return (
    <div className="grid gap-4">
      {/* 连接状态卡 */}
      <section className="rounded-xl border border-line bg-surface-raised/60 p-3.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[13px] font-extrabold text-ink">
            <span
              aria-hidden="true"
              className={`h-[8px] w-[8px] rounded-full ${connected ? "bg-green" : "bg-[#8a8f9d]"}`}
            />
            {connected ? "Runtime 已连接" : "Runtime 未连接"}
          </span>
          {!connected && (
            <button
              className="cursor-pointer rounded-lg bg-blue px-3 py-1.5 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong"
              onClick={onReconnect}
              type="button"
            >
              重新连接
            </button>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          <InfoRow
            label="运行状态"
            value={stateLabels[status?.state ?? ""] ?? status?.state ?? "—"}
          />
          <InfoRow label="Agent" value={status?.agent_status ?? "—"} />
          <InfoRow
            label="当前模型"
            value={status?.model ? `${status.provider}/${status.model}` : "—"}
          />
          <InfoRow label="连接数" value={fmt(status?.connections)} />
          <InfoRow label="运行时长" value={status?.uptime ?? "—"} />
          <InfoRow label="PID" value={status?.pid ? String(status.pid) : "—"} />
        </dl>
      </section>

      {/* 用量 + 版本 */}
      <section className="rounded-xl border border-line bg-surface-raised/60 p-3.5">
        <h3 className="m-0 text-[13px] font-extrabold text-ink">今日用量</h3>
        <dl className="mt-2.5 grid grid-cols-3 gap-2 text-[12px]">
          <InfoRow label="请求" value={fmt(usage?.requests)} />
          <InfoRow label="输入 tokens" value={fmt(usage?.input_tokens)} />
          <InfoRow label="输出 tokens" value={fmt(usage?.output_tokens)} />
        </dl>
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] font-bold text-ink-muted transition-colors duration-150 hover:text-ink">
            版本信息（高级）
          </summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
            <InfoRow label="Runtime" value={hello?.runtime_version ?? "—"} />
            <InfoRow label="协议" value={hello?.protocol_version ?? "—"} />
            <InfoRow
              label="上下文"
              value={
                status?.context_tokens != null
                  ? `${fmt(status.context_tokens)} / ${fmt(status.context_window)}`
                  : "—"
              }
            />
          </dl>
        </details>
      </section>

      {/* 主题（原设置面板内容） */}
      {cap("config") && config && (
        <section className="rounded-xl border border-line bg-surface-raised/60 p-3.5">
          <h3 className="m-0 mb-2 text-[13px] font-extrabold text-ink">主题</h3>
          <div className="flex gap-1.5">
            {(
              [
                ["system", "跟随系统"],
                ["light", "浅色"],
                ["dark", "深色"],
              ] as const
            ).map(([value, label]) => (
              <button
                className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition-colors duration-150 ${
                  theme === value
                    ? "border-blue/60 bg-blue-soft text-blue-strong"
                    : "border-line bg-surface-raised text-ink-soft hover:bg-surface-subtle"
                }`}
                key={value}
                onClick={() => {
                  const next = value as Theme;
                  // 同步写入 DOM，避免 View Transition 或异步状态导致切换不生效。
                  document.documentElement.dataset.theme =
                    next === "system"
                      ? window.matchMedia("(prefers-color-scheme: dark)")
                          .matches
                        ? "dark"
                        : "light"
                      : next;
                  onThemeChange(next);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <dt className="shrink-0 text-[11px] font-semibold text-ink-muted">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-[12px] font-bold text-ink">
        {value}
      </dd>
    </div>
  );
}
