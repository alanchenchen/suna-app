import { useEffect, useState } from "react";
import { useChangeLocale, useLocale, useT } from "../../lib/i18n";
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

/** session.usage 三周期返回结构（today/week/month 同构）。 */
type UsagePeriod = {
  input_tokens: number;
  output_tokens: number;
  requests: number;
};
type UsageSummary = {
  today?: UsagePeriod;
  week?: UsagePeriod;
  month?: UsagePeriod;
};

const stateLabels: Record<string, string> = {
  ready: "conn.status.ready",
  starting: "conn.status.starting",
  stopping: "conn.status.stopping",
  unavailable: "conn.status.unavailable",
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
  const t = useT();
  const locale = useLocale();
  const changeLocale = useChangeLocale();
  const [status, setStatus] = useState<DaemonStatus>();
  // 三周期用量：优先 session.usage（today/week/month），兜底 daemon.status.usage_today。
  const [usage, setUsage] = useState<UsageSummary>();
  useEffect(() => {
    let alive = true;
    rpc("daemon.status", {})
      .then((value) => {
        if (alive) setStatus(value);
      })
      .catch(() => {
        // 状态获取失败不阻塞设置面板；连接页已有错误提示。
      });
    // session.usage 返回三周期；daemon.status.usage_today 只作兜底。
    rpc("session.usage", {})
      .then((value) => {
        if (alive) setUsage(value);
      })
      .catch(() => {
        // 老 Runtime 可能没有 session.usage；保持只显示 today 的兜底。
        setUsage(undefined);
      });
    return () => {
      alive = false;
    };
  }, [rpc, connected]);

  const today = usage?.today ?? status?.usage_today;
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
            {connected ? t("sidebar.connected") : t("sidebar.disconnected")}
          </span>
          {!connected && (
            <button
              className="cursor-pointer rounded-lg bg-blue px-3 py-1.5 text-[12px] font-bold text-white transition-colors duration-150 hover:bg-blue-strong"
              onClick={onReconnect}
              type="button"
            >
              {t("conn.reconnect")}
            </button>
          )}
        </div>
        {/* 三列网格：面板宽度下比两列更宽松，长值（provider/model）不易截断。 */}
        <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-[12px]">
          <InfoRow
            label={t("conn.runtimeState")}
            value={
              t(stateLabels[status?.state ?? ""] ?? "") || status?.state || "—"
            }
          />
          <InfoRow label="Agent" value={status?.agent_status ?? "—"} />
          <InfoRow
            label={t("conn.currentModel")}
            value={status?.model ? `${status.provider}/${status.model}` : "—"}
          />
          <InfoRow
            label={t("conn.connections")}
            value={fmt(status?.connections)}
          />
          <InfoRow label={t("conn.uptime")} value={status?.uptime ?? "—"} />
          <InfoRow label="PID" value={status?.pid ? String(status.pid) : "—"} />
        </dl>
      </section>

      {/* 用量 + 版本：数字不截断（token 数用 tabular-nums + 缩写格式，
          10.4k / 1.2M 比全数字更易扫读，也避免窄面板下溢出）。 */}
      <section className="rounded-xl border border-line bg-surface-raised/60 p-3.5">
        <h3 className="m-0 text-[13px] font-extrabold text-ink">
          {t("conn.usage")}
        </h3>
        <dl className="mt-2.5 grid grid-cols-3 gap-2 text-[12px]">
          <InfoRow label={t("conn.requests")} value={fmt(today?.requests)} />
          <InfoRow
            label={t("conn.inputTokens")}
            value={fmtCompact(today?.input_tokens)}
          />
          <InfoRow
            label={t("conn.outputTokens")}
            value={fmtCompact(today?.output_tokens)}
          />
        </dl>
        {(usage?.week || usage?.month) && (
          /* 周/月行单列：in/out 两值拼接在半宽列里必然截断，
             改为整行展示（label 左、值右），宽度充裕。 */
          <dl className="mt-2 grid grid-cols-1 gap-y-1.5 border-t border-line pt-2 text-[12px]">
            <InfoRow
              label={t("conn.weekTokens")}
              value={`${fmtCompact(usage?.week?.input_tokens ?? 0)} / ${fmtCompact(usage?.week?.output_tokens ?? 0)}`}
            />
            <InfoRow
              label={t("conn.weekRequests")}
              value={fmt(usage?.week?.requests)}
            />
            <InfoRow
              label={t("conn.monthTokens")}
              value={`${fmtCompact(usage?.month?.input_tokens ?? 0)} / ${fmtCompact(usage?.month?.output_tokens ?? 0)}`}
            />
            <InfoRow
              label={t("conn.monthRequests")}
              value={fmt(usage?.month?.requests)}
            />
          </dl>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] font-bold text-ink-muted transition-colors duration-150 hover:text-ink">
            {t("conn.versionAdvanced")}
          </summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-2 text-[12px]">
            <InfoRow label="Runtime" value={hello?.runtime_version ?? "—"} />
            <InfoRow
              label={t("conn.protocol")}
              value={
                hello?.catalog ? `${hello.catalog.methods.length} methods` : "—"
              }
            />
            <InfoRow
              label={t("conn.context")}
              value={
                status?.context_tokens != null
                  ? `${fmtCompact(status.context_tokens)} / ${fmtCompact(status.context_window)}`
                  : "—"
              }
            />
          </dl>
        </details>
      </section>

      {/* 主题（原设置面板内容） */}
      {cap("config") && config && (
        <section className="rounded-xl border border-line bg-surface-raised/60 p-3.5">
          <h3 className="m-0 mb-2 text-[13px] font-extrabold text-ink">
            {t("conn.theme")}
          </h3>
          <div className="flex gap-1.5">
            {(
              [
                ["system", t("conn.theme.system")],
                ["light", t("conn.theme.light")],
                ["dark", t("conn.theme.dark")],
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
                  // 同步写入 DOM；支持 View Transition 的浏览器用过渡包裹。
                  const apply = () => {
                    document.documentElement.dataset.theme =
                      next === "system"
                        ? window.matchMedia("(prefers-color-scheme: dark)")
                            .matches
                          ? "dark"
                          : "light"
                        : next;
                  };
                  const doc = document as Document & {
                    startViewTransition?: (cb: () => void) => void;
                  };
                  if (doc.startViewTransition) {
                    doc.startViewTransition(apply);
                  } else {
                    apply();
                  }
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

      {/* 语言：机器检测（浏览器语言），可手动切换中英文（设计 §阶段 3）。 */}
      <section className="rounded-xl border border-line bg-surface-raised/60 p-3.5">
        <h3 className="m-0 mb-2 text-[13px] font-extrabold text-ink">
          {t("conn.language")}
        </h3>
        <div className="flex gap-1.5">
          {(
            [
              ["zh", t("conn.language.zh")],
              ["en", "English"],
            ] as const
          ).map(([value, label]) => (
            <button
              className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition-colors duration-150 ${
                locale === value
                  ? "border-blue/60 bg-blue-soft text-blue-strong"
                  : "border-line bg-surface-raised text-ink-soft hover:bg-surface-subtle"
              }`}
              key={value}
              onClick={() => changeLocale(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <dt className="shrink-0 text-[11px] font-semibold text-ink-muted">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-right font-mono text-[12px] font-bold text-ink tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/** token 数缩写：≥1B 显示 1.1B，≥1M 显示 10.4M，≥10k 显示 10.4k，其余原样。
    窄面板里全数字（34,523,190）必然截断；周/月行是两值拼接（in/out），
    用 B/M/k 缩写才能完整可读。 */
function fmtCompact(value?: number) {
  if (value == null) return "—";
  if (value >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 10_000)
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return value.toLocaleString();
}
